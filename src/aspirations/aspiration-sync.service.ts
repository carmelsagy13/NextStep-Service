import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  UserAspiration,
  UserAspirationStatus,
} from '../database/entities/user-aspiration.entity.js';
import {
  UserGoal,
  UserGoalStatus,
} from '../database/entities/user-goal.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import {
  criteriaScoresFromProfile,
  isRoadmapGoalEligible,
} from '../common/roadmap-goal-eligibility.js';
import { LlmClientService } from '../llm-client/llm-client.service.js';

/** A single `update` instruction the LLM returns for a stale linked task. */
interface TaskUpdate {
  user_goal_id: string;
  target_amount?: number | null;
  target_date?: string | null;
  dynamic_params?: Record<string, unknown> | null;
  ai_insight?: string | null;
  priority?: number | null;
  reason?: string;
}

/**
 * A single `add` instruction the LLM returns to create a NEW task that serves an
 * aspiration which has no linked task yet. `roadmap_goal_id` must reference an
 * eligible template and `aspiration_id` the stale aspiration it serves.
 */
interface TaskAdd {
  roadmap_goal_id: string;
  aspiration_id: string;
  target_amount?: number | null;
  target_date?: string | null;
  dynamic_params?: Record<string, unknown> | null;
  ai_insight?: string | null;
  priority?: number | null;
  reason?: string;
}

/** The full decision the focused-sync LLM returns. */
interface TaskSyncDecision {
  updates: TaskUpdate[];
  adds: TaskAdd[];
}

/**
 * Focused, aspiration-driven re-sync of roadmap TASKS.
 *
 * When a user edits an overarching goal (e.g. raises a wedding budget from 200k
 * to 250k, or moves the target date), the actionable {@link UserGoal} tasks that
 * serve that aspiration become stale. This service asks the LLM to recompute the
 * PARAMETERS of those existing tasks (target amount, target date, dynamic params
 * such as a monthly-saving figure) and applies the result in place — without
 * re-running the full profile/step classification done by the open-finance
 * pipeline.
 *
 * Staleness is detected via the aspiration's `revision` vs `lastSyncedRevision`
 * and each task's `syncedAspirationRevision`.
 */
@Injectable()
export class AspirationSyncService {
  private readonly logger = new Logger(AspirationSyncService.name);

  constructor(
    @InjectRepository(UserAspiration)
    private readonly aspirationRepo: Repository<UserAspiration>,
    @InjectRepository(UserGoal)
    private readonly goalRepo: Repository<UserGoal>,
    @InjectRepository(RoadmapGoal)
    private readonly roadmapGoalRepo: Repository<RoadmapGoal>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    private readonly dataSource: DataSource,
    private readonly llm: LlmClientService,
  ) {}

  /**
   * Reconcile every ACTIVE aspiration whose `revision` is ahead of its
   * `lastSyncedRevision`. For aspirations that already have a linked ACTIVE task
   * the task PARAMETERS are re-tuned; for aspirations with no linked task yet an
   * eligible roadmap template can be ADDED and linked. Eligibility is gated by
   * the user's profile (overall step + per-criteria scores), so a goal whose
   * serving template the user has not yet unlocked is simply left for a future
   * open-finance run. Safe to call repeatedly — it is a no-op when nothing is
   * stale.
   *
   * @returns the number of tasks created or updated.
   */
  async syncUserGoalsForAspirations(userId: string): Promise<number> {
    const aspirations = await this.aspirationRepo.find({
      where: { userId, status: UserAspirationStatus.ACTIVE },
    });

    const stale = aspirations.filter(
      (a) => a.lastSyncedRevision == null || a.revision > a.lastSyncedRevision,
    );
    if (!stale.length) return 0;

    const staleIds = new Set(stale.map((a) => a.aspirationId));

    const [profile, allTemplates, existingTasks] = await Promise.all([
      this.profileRepo.findOne({ where: { userId } }),
      this.roadmapGoalRepo.find({
        where: { isActive: true },
        order: { stepId: 'ASC', priority: 'ASC' },
      }),
      this.goalRepo.find({ where: { userId } }),
    ]);

    const activeTasks = existingTasks.filter(
      (t) => t.status === UserGoalStatus.ACTIVE,
    );
    const linkedTasks = activeTasks.filter(
      (t) => t.aspirationId && staleIds.has(t.aspirationId),
    );

    // Templates the user has actually unlocked, so the LLM can only ADD a task
    // the user is eligible for.
    let eligibleTemplates: RoadmapGoal[] = [];
    if (profile?.currentStep != null) {
      const currentStep = profile.currentStep;
      const criteriaScores = criteriaScoresFromProfile(profile);
      eligibleTemplates = allTemplates.filter((t) =>
        isRoadmapGoalEligible(t, { currentStep, criteriaScores }),
      );
    }

    // Nothing to re-tune and nothing eligible to add → mark synced and bail so a
    // future open-finance run can still create tasks once the user is eligible.
    if (!linkedTasks.length && !eligibleTemplates.length) {
      await this.markSynced(stale);
      return 0;
    }

    let decision: TaskSyncDecision = { updates: [], adds: [] };
    try {
      decision = await this.requestTaskChanges(
        stale,
        linkedTasks,
        eligibleTemplates,
      );
    } catch (err) {
      this.logger.warn(
        `Aspiration re-sync LLM call failed — userId=${userId}: ${String(
          (err as Error)?.message,
        ).slice(0, 160)}`,
      );
      // Do NOT mark synced on failure, so a later run retries.
      return 0;
    }

    return this.applyTaskChanges(
      userId,
      stale,
      existingTasks,
      linkedTasks,
      eligibleTemplates,
      decision,
    );
  }

  /** Build the focused prompt and ask the LLM for task `updates` and `adds`. */
  private async requestTaskChanges(
    staleAspirations: UserAspiration[],
    tasks: UserGoal[],
    eligibleTemplates: RoadmapGoal[],
  ): Promise<TaskSyncDecision> {
    const aspirationsSection = staleAspirations
      .map((a) =>
        [
          `  - aspiration_id: "${a.aspirationId}"`,
          `    goal_type: ${a.goalTypeCode}`,
          `    title: "${a.title}"`,
          `    target_amount: ${a.targetAmount ?? 'null'}`,
          `    target_date: ${a.targetDate ? this.toIsoDate(a.targetDate) : 'null'}`,
          a.attributes
            ? `    attributes: ${JSON.stringify(a.attributes)}`
            : null,
          `    has_linked_task: ${tasks.some((t) => t.aspirationId === a.aspirationId)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');

    const tasksSection = tasks.length
      ? tasks
          .map((t) =>
            [
              `  - user_goal_id: "${t.goalId}"`,
              `    aspiration_id: "${t.aspirationId}"`,
              `    title: "${t.goalName}"`,
              `    target_amount: ${t.targetAmount ?? 'null'}`,
              `    target_date: ${t.targetDate ? this.toIsoDate(t.targetDate) : 'null'}`,
              `    progress: ${t.currentAmount ?? 0}`,
              t.dynamicParams
                ? `    dynamic_params: ${JSON.stringify(t.dynamicParams)}`
                : null,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n')
      : '  (none — no task is linked to these aspirations yet)';

    const templatesSection = eligibleTemplates.length
      ? eligibleTemplates
          .map((g) =>
            [
              `  - roadmap_goal_id: "${g.goalId}"`,
              `    title: "${g.title}"`,
              `    description_template: "${g.descriptionTemplate}"`,
              `    step: ${g.stepId}`,
              `    criteria: ${g.criteria ?? 'null'}`,
              g.dynamicParams
                ? `    dynamic_params_template: ${JSON.stringify(g.dynamicParams)}`
                : null,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n')
      : '  (none — the user has not unlocked any template that can serve these goals)';

    const systemPrompt = [
      'You are an expert Israeli financial planner. The user has CHANGED one or',
      'more of their overarching financial goals (their "aspirations"). Your job',
      'is to make the actionable roadmap tasks reflect the new reality:',
      '  1. UPDATE an existing task whose parameters no longer match its aspiration.',
      '  2. ADD a new task (from the AVAILABLE TEMPLATES) for an aspiration that has',
      '     no linked task yet, when a suitable template is available.',
      'Do NOT remove tasks here. All textual output (ai_insight) MUST be in Hebrew.',
      '',
      '## Changed Aspirations (the new desired reality)',
      aspirationsSection,
      '',
      '## Existing Tasks linked to those Aspirations',
      tasksSection,
      '',
      '## Available Templates the user is eligible for (use ONLY these to ADD)',
      templatesSection,
      '',
      '## Rules',
      '- For each task whose parameters no longer match its aspiration, return an',
      '  entry in "updates" referencing the task by user_goal_id.',
      '- For each aspiration with has_linked_task=false, if a suitable template',
      '  exists above, return an entry in "adds" with the chosen roadmap_goal_id',
      '  and the aspiration_id it serves. Pick the template that best matches the',
      "  aspiration's goal_type (a generic saving template with a {{goal}} placeholder",
      '  is acceptable). If NO suitable template exists, do not add anything.',
      '- Recompute target_amount / target_date from the aspiration values.',
      '- Recompute dynamic_params that depend on the target — e.g. a monthly saving',
      "  figure = remaining amount / months until target_date. Use REAL numbers; if a",
      '  value is not derivable, use null.',
      '- Reference user_goal_id ONLY from the tasks list and roadmap_goal_id ONLY',
      '  from the templates list and aspiration_id ONLY from the aspirations list.',
      '  NEVER invent IDs. Do not add more than one task per aspiration.',
      '- If a task already matches its aspiration, omit it from "updates".',
      '',
      '## Required Output Schema (single JSON object):',
      JSON.stringify({
        updates: [
          {
            user_goal_id: '<existing UUID from the tasks list>',
            target_amount: '<number or null>',
            target_date: '<ISO-8601 string or null>',
            dynamic_params: { key: 'value' },
            ai_insight: '<Hebrew justification of the adjustment>',
            priority: '<integer or omit>',
            reason: '<short Hebrew note on what changed>',
          },
        ],
        adds: [
          {
            roadmap_goal_id: '<UUID from the templates list>',
            aspiration_id: '<UUID from the aspirations list>',
            target_amount: '<number or null>',
            target_date: '<ISO-8601 string or null>',
            dynamic_params: { key: 'value' },
            ai_insight: '<Hebrew explanation of the new task>',
            priority: '<integer or omit>',
            reason: '<short Hebrew note on why it was added>',
          },
        ],
      }),
      '',
      'IMPORTANT: Return raw JSON only. No markdown code fences, no preamble.',
    ].join('\n');

    const rawText = await this.llm.generate(
      systemPrompt,
      JSON.stringify({
        aspirations: staleAspirations.map((a) => a.aspirationId),
      }),
      'aspiration-task-sync',
    );
    const parsed = this.llm.parseJson<any>(rawText, 'aspiration-task-sync');
    return {
      updates: Array.isArray(parsed?.updates) ? parsed.updates : [],
      adds: Array.isArray(parsed?.adds) ? parsed.adds : [],
    };
  }

  /** Apply the LLM's task updates/adds and mark the aspirations as synced. */
  private async applyTaskChanges(
    userId: string,
    staleAspirations: UserAspiration[],
    existingTasks: UserGoal[],
    linkedTasks: UserGoal[],
    eligibleTemplates: RoadmapGoal[],
    decision: TaskSyncDecision,
  ): Promise<number> {
    const taskById = new Map(linkedTasks.map((t) => [t.goalId, t]));
    const revisionByAspiration = new Map(
      staleAspirations.map((a) => [a.aspirationId, a.revision]),
    );
    const staleIds = new Set(staleAspirations.map((a) => a.aspirationId));
    const templateById = new Map(
      eligibleTemplates.map((g) => [g.goalId, g]),
    );
    // Dedup key: a template already serving a given aspiration must not be added
    // twice (allows the same generic template to serve different aspirations).
    const existingByTemplateAspiration = new Map(
      existingTasks
        .filter((t) => t.roadmapGoalId && t.aspirationId)
        .map((t) => [`${t.roadmapGoalId}::${t.aspirationId}`, t]),
    );

    return this.dataSource.transaction(async (manager) => {
      const touched: UserGoal[] = [];

      // 1. Updates to existing linked tasks.
      for (const u of decision.updates) {
        const task = taskById.get(u.user_goal_id);
        if (!task) continue; // ownership / hallucination guard
        if (u.target_amount !== undefined && u.target_amount !== null) {
          task.targetAmount = u.target_amount;
        }
        if (u.target_date) {
          task.targetDate = new Date(u.target_date);
        }
        if (u.dynamic_params != null) {
          task.dynamicParams = u.dynamic_params as Record<string, any>;
        }
        if (u.ai_insight) {
          task.aiInsight = u.ai_insight;
        }
        if (u.priority != null && Number.isFinite(Number(u.priority))) {
          task.priority = Number(u.priority);
        }
        if (task.aspirationId) {
          task.syncedAspirationRevision =
            revisionByAspiration.get(task.aspirationId) ??
            task.syncedAspirationRevision;
        }
        touched.push(task);
      }

      // 2. Adds for aspirations that have no linked task yet.
      const addedForAspiration = new Set<string>();
      for (const a of decision.adds) {
        const template = templateById.get(a.roadmap_goal_id);
        if (!template) continue; // not eligible / hallucinated
        if (!staleIds.has(a.aspiration_id)) continue; // must serve a stale aspiration
        if (addedForAspiration.has(a.aspiration_id)) continue; // one task per aspiration
        const dupKey = `${a.roadmap_goal_id}::${a.aspiration_id}`;
        if (existingByTemplateAspiration.has(dupKey)) continue; // already exists

        const revision = revisionByAspiration.get(a.aspiration_id) ?? null;
        const aspiration = staleAspirations.find(
          (s) => s.aspirationId === a.aspiration_id,
        );
        const goalName = this.renderTaskName(
          template.title,
          aspiration?.title,
        );

        const task = manager.create(UserGoal, {
          userId,
          roadmapGoalId: template.goalId,
          aspirationId: a.aspiration_id,
          goalName,
          dynamicParams:
            (a.dynamic_params as Record<string, any>) ?? undefined,
          targetAmount:
            a.target_amount ?? aspiration?.targetAmount ?? undefined,
          targetDate: a.target_date
            ? new Date(a.target_date)
            : aspiration?.targetDate
              ? new Date(aspiration.targetDate)
              : undefined,
          currentAmount: 0,
          status: UserGoalStatus.ACTIVE,
          priority:
            a.priority != null && Number.isFinite(Number(a.priority))
              ? Number(a.priority)
              : template.priority,
          aiInsight: a.ai_insight ?? undefined,
          syncedAspirationRevision: revision,
        });
        touched.push(task);
        addedForAspiration.add(a.aspiration_id);
      }

      // 3. Mark every linked task as synced, even if the LLM left it unchanged —
      //    its parameters were considered and judged correct.
      for (const task of linkedTasks) {
        if (touched.includes(task)) continue;
        if (
          task.aspirationId &&
          revisionByAspiration.has(task.aspirationId)
        ) {
          task.syncedAspirationRevision = revisionByAspiration.get(
            task.aspirationId,
          )!;
          touched.push(task);
        }
      }

      if (touched.length) await manager.save(UserGoal, touched);

      for (const a of staleAspirations) {
        a.lastSyncedRevision = a.revision;
      }
      await manager.save(UserAspiration, staleAspirations);

      const validUpdates = decision.updates.filter((u) =>
        taskById.has(u.user_goal_id),
      ).length;
      return validUpdates + addedForAspiration.size;
    });
  }

  /** Substitute the `{{goal}}` placeholder in a template title and clamp length. */
  private renderTaskName(templateTitle: string, aspirationTitle?: string): string {
    const rendered = aspirationTitle
      ? templateTitle.replace(/\{\{\s*goal\s*\}\}/gi, aspirationTitle)
      : templateTitle;
    return rendered.slice(0, 100);
  }

  /** Mark aspirations synced without touching tasks (used when none are linked). */
  private async markSynced(aspirations: UserAspiration[]): Promise<void> {
    for (const a of aspirations) a.lastSyncedRevision = a.revision;
    await this.aspirationRepo.save(aspirations);
  }

  private toIsoDate(d: Date | string): string {
    return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  }
}
