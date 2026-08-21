import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Not, IsNull, Repository } from 'typeorm';
import {
  UserGoal,
  UserGoalStatus,
  GoalDismissalReason,
} from '../database/entities/user-goal.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';
import { DismissGoalDto } from './dto/dismiss-goal.dto.js';
import { SnoozeGoalDto } from './dto/snooze-goal.dto.js';
import { GoalResponseDto } from './dto/goal-response.dto.js';
import {
  GOAL_RESPONSE_RELATIONS,
  resolveAssetBaseUrl,
  toGoalResponseList,
} from './goal-response.mapper.js';
import {
  LlmOrchestratorService,
  PersonalizedGoalRecommendation,
} from '../llm-orchestrator/llm-orchestrator.service.js';
import { QuestionnaireService } from '../questionnaire/questionnaire.service.js';

/**
 * Fields the server owns exclusively. Stripped from POST /goals bodies so a
 * caller cannot self-assign a lifecycle state or forge step attribution.
 */
const SERVER_OWNED_GOAL_FIELDS = [
  'userId',
  'goalId',
  'status',
  'assignedAt',
  'assignedAtStep',
  'completedAt',
  'completedAtStep',
  'removedAt',
  'removalReason',
  'dismissalReason',
  'dismissalNote',
  'dismissedAt',
  'snoozedUntil',
  'sourceProfileHistoryId',
] as const;

/** Upper bound on how far ahead a task may be deferred (~2 months). */
const MAX_SNOOZE_DAYS = 60;

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(UserGoal)
    private readonly goalRepo: Repository<UserGoal>,
    @InjectRepository(RoadmapGoal)
    private readonly roadmapGoalRepo: Repository<RoadmapGoal>,
    @InjectRepository(UserProfile)
    private readonly userProfileRepo: Repository<UserProfile>,
    private readonly llmOrchestrator: LlmOrchestratorService,
    private readonly questionnaire: QuestionnaireService,
    private readonly config: ConfigService,
  ) {}

  /**
   * AI goal recommendation:
   *
   * Step 1 – Fetch all active roadmap_goals.
   *   The stage/eligibility limit has been removed, so the complete active goal
   *   set is forwarded to the LLM regardless of the user's step or per-criteria
   *   scores.
   *
   * Step 2 – Personalization (LLM Call)
   *   The full goal list is sent to the LLM, which reorders it by relevance and
   *   adds Hebrew insight text.
   */
  async getRecommendedGoals(
    userId: string,
  ): Promise<PersonalizedGoalRecommendation[]> {
    const profile = await this.userProfileRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('User profile not found');
    if (profile.currentStep === null || profile.currentStep === undefined) {
      throw new BadRequestException(
        'User has no current step assigned. Complete the financial analysis first.',
      );
    }

    // The user's latest questionnaire answers (off-platform context) sharpen the
    // LLM personalization. Resolves to null when onboarding was never completed.
    const questionnaire = await this.questionnaire.buildLatestSummary(userId);

    // Tasks the user rejected, so the model can steer away from similar ones.
    const dismissedGoals = await this.goalRepo.find({
      where: { userId, dismissalReason: Not(IsNull()) },
      order: { dismissedAt: 'DESC' },
    });

    // ── Step 1: Fetch all active goals ────────────────────────────────────
    // Stage/eligibility limit removed: the full active goal set is handed to the
    // LLM regardless of the user's step or per-criteria scores.
    const allActiveGoals = await this.roadmapGoalRepo.find({
      where: { isActive: true },
      relations: ['offer', 'offer.partner'],
      order: { priority: 'ASC' },
    });

    if (!allActiveGoals.length) {
      return [];
    }

    // ── Step 2: Personalization ────────────────────────────────────────────
    const result = await this.llmOrchestrator.personalizeGoals(
      profile,
      allActiveGoals,
      questionnaire,
      dismissedGoals,
    );
    return result;
  }

  /**
   * The user's current roadmap step, or null when no analysis has assigned one.
   * Deliberately non-throwing: step attribution is metadata, so a user without a
   * step must still be able to create and complete tasks.
   */
  private async resolveCurrentStepOrNull(
    userId: string,
  ): Promise<number | null> {
    const profile = await this.userProfileRepo.findOne({ where: { userId } });
    return profile?.currentStep ?? null;
  }

  async getGoals(
    userId: string,
    status?: UserGoalStatus,
  ): Promise<GoalResponseDto[]> {
    const where = status ? { userId, status } : { userId };
    const goals = await this.goalRepo.find({
      where,
      relations: GOAL_RESPONSE_RELATIONS,
      order: { priority: 'ASC' },
    });

    await this.clearExpiredSnoozes(goals);

    return toGoalResponseList(
      goals,
      resolveAssetBaseUrl(this.config.get<string>('PUBLIC_ASSET_BASE_URL')),
    );
  }

  /**
   * Brings back tasks whose snooze has run out. Done lazily on read rather than
   * on a schedule: this is the only path the client loads tasks through, so a
   * cron job would add a moving part without changing what the user sees.
   * Mutates the passed rows so the caller serializes the post-sweep state.
   */
  private async clearExpiredSnoozes(goals: UserGoal[]): Promise<void> {
    const now = Date.now();
    const expired = goals.filter(
      (goal) =>
        goal.snoozedUntil != null &&
        new Date(goal.snoozedUntil).getTime() <= now,
    );
    if (!expired.length) return;

    for (const goal of expired) goal.snoozedUntil = null;
    await this.goalRepo.save(expired);
  }

  async createGoal(userId: string, body: any) {
    const input = (body ?? {}) as Record<string, unknown>;

    // Validate the referenced roadmap goal exists when provided. The stage/
    // eligibility limit has been removed, so any existing goal may be assigned.
    if (input.roadmapGoalId) {
      const roadmapGoal = await this.roadmapGoalRepo.findOne({
        where: { goalId: input.roadmapGoalId as string },
      });
      if (!roadmapGoal) throw new NotFoundException('Roadmap goal not found');
    }

    const fields: Record<string, unknown> = { ...input };
    for (const key of SERVER_OWNED_GOAL_FIELDS) delete fields[key];

    const goal = this.goalRepo.create({
      ...fields,
      userId,
      assignedAtStep: await this.resolveCurrentStepOrNull(userId),
    } as DeepPartial<UserGoal>);
    return this.goalRepo.save(goal);
  }

  async updateGoal(userId: string, dto: UpdateGoalDto) {
    const goal = await this.goalRepo.findOne({
      where: { goalId: dto.goalId, userId },
    });

    if (!goal)
      throw new NotFoundException(
        'Goal not found or does not belong to this user',
      );

    // Only update the explicitly allowed fields to respect the goal's original structure
    if (dto.currentAmount !== undefined) {
      goal.currentAmount = dto.currentAmount;
    }
    if (dto.status !== undefined) {
      this.applyStatusTransition(
        goal,
        dto.status,
        await this.resolveCurrentStepOrNull(userId),
      );
    }

    return this.goalRepo.save(goal);
  }

  /**
   * Records that the user considers a task irrelevant and retires it. The reason
   * is fed back into the goal-selection prompts so later tasks fit better.
   */
  async dismissGoal(userId: string, dto: DismissGoalDto) {
    const goal = await this.goalRepo.findOne({
      where: { goalId: dto.goalId, userId },
    });

    if (!goal)
      throw new NotFoundException(
        'Goal not found or does not belong to this user',
      );

    if (goal.status === UserGoalStatus.COMPLETED)
      throw new BadRequestException(
        'A completed task cannot be marked as not relevant',
      );

    goal.dismissalReason = dto.reason;
    // The note only ever elaborates on `other`; it is meaningless otherwise.
    goal.dismissalNote =
      dto.reason === GoalDismissalReason.OTHER
        ? (dto.note?.trim() ?? null)
        : null;
    goal.dismissedAt = new Date();

    this.applyStatusTransition(
      goal,
      UserGoalStatus.ABANDONED,
      await this.resolveCurrentStepOrNull(userId),
    );

    return this.goalRepo.save(goal);
  }

  /**
   * Defers a task to a date the user picked, or brings it back when
   * `snoozedUntil` is null. Never touches `status`: a snoozed task stays ACTIVE,
   * so the user's dismissal feedback and step attribution are left intact.
   */
  async snoozeGoal(userId: string, dto: SnoozeGoalDto) {
    const goal = await this.goalRepo.findOne({
      where: { goalId: dto.goalId, userId },
    });

    if (!goal)
      throw new NotFoundException(
        'Goal not found or does not belong to this user',
      );

    if (dto.snoozedUntil === null) {
      goal.snoozedUntil = null;
      return this.goalRepo.save(goal);
    }

    if (goal.status !== UserGoalStatus.ACTIVE)
      throw new BadRequestException('Only an active task can be snoozed');

    const until = new Date(dto.snoozedUntil);
    const now = Date.now();
    if (until.getTime() <= now)
      throw new BadRequestException('Snooze date must be in the future');
    if (until.getTime() > now + MAX_SNOOZE_DAYS * 24 * 60 * 60 * 1000)
      throw new BadRequestException(
        `A task cannot be snoozed for more than ${MAX_SNOOZE_DAYS} days`,
      );

    goal.snoozedUntil = until;
    return this.goalRepo.save(goal);
  }

  private applyStatusTransition(
    goal: UserGoal,
    status: UserGoalStatus,
    currentStep: number | null,
  ): void {
    const completed = status === UserGoalStatus.COMPLETED;
    const alreadyCompleted = goal.status === UserGoalStatus.COMPLETED;
    goal.status = status;
    // Any lifecycle move settles the task, so a pending deferral is moot.
    goal.snoozedUntil = null;
    // Completion is stamped once. Re-sending `completed` for an already finished
    // task keeps the original step/time; only a real transition records new ones.
    if (!completed) {
      goal.completedAt = null;
      goal.completedAtStep = null;
    } else if (!alreadyCompleted) {
      goal.completedAt = new Date();
      goal.completedAtStep = currentStep;
    }
    goal.removedAt =
      status === UserGoalStatus.REMOVED ||
      status === UserGoalStatus.ABANDONED ||
      status === UserGoalStatus.EXPIRED
        ? new Date()
        : null;

    // Reactivating is the user retracting their "not relevant" verdict, so the
    // feedback is withdrawn too. An LLM-driven reactivation bypasses this and
    // deliberately keeps the history.
    if (status === UserGoalStatus.ACTIVE) {
      goal.dismissalReason = null;
      goal.dismissalNote = null;
      goal.dismissedAt = null;
    }
  }

  async deleteGoal(goalId: string) {
    const result = await this.goalRepo.delete(goalId);
    if (result.affected === 0) throw new NotFoundException('Goal not found');
    return { message: 'Goal deleted' };
  }
}
