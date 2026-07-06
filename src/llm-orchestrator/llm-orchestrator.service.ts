import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmGuidanceLog } from '../database/entities/llm-guidance-log.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { LlmClientService } from '../llm-client/llm-client.service.js';
import {
  QuestionnaireSummary,
  buildQuestionnairePromptSection,
} from '../questionnaire/questionnaire.service.js';

export interface PersonalizedGoalRecommendation {
  roadmap_goal_id: string;
  title: string;
  priority: number;
  ai_insight: string;
  dynamic_params: Record<string, any>;
}

@Injectable()
export class LlmOrchestratorService {
  private readonly logger = new Logger(LlmOrchestratorService.name);

  constructor(
    private readonly llm: LlmClientService,
    @InjectRepository(LlmGuidanceLog)
    private readonly logRepo: Repository<LlmGuidanceLog>,
  ) {}

  // ─── Step 1: Financial Classification ────────────────────────────────────

  /**
   * Analyzes the user's stored financial profile criteria and returns ONLY an
   * integer 1–5 representing the current financial step. No goal selection occurs
   * in this call — pure classification only.
   *
   * `questionnaire`, when provided, supplies self-reported off-platform context
   * that complements the bank-derived criteria scores.
   */
  async classifyUserStep(
    profile: UserProfile,
    questionnaire: QuestionnaireSummary | null = null,
  ): Promise<number> {
    const prompt = [
      'You are a financial classification engine.',
      'Your ONLY task is to determine which financial stage (1–5) this user belongs to.',
      'You must NOT suggest goals or produce any output beyond the required JSON.',
      '',
      '## User Financial Criteria (each value is already scored 1–5 per dimension)',
      JSON.stringify(
        {
          cash_flow: profile.cashFlow,
          credit_consumption: profile.creditConsumption,
          loans: profile.loans,
          savings_investments: profile.savingsInvestments,
          pension_long_term: profile.pensionLongTerm,
          lifestyle_clubs: profile.lifestyleClubs,
          mortgage: profile.mortgage,
          system_indicators: profile.systemIndicators,
          risk_tolerance: profile.riskTolerance,
          knowledge_level: profile.knowledgeLevel,
        },
        null,
        2,
      ),
      '',
      '## Stage Definitions',
      'Stage 1 – Financial Survival: Negative cash flow, unmanaged debt, no buffer.',
      'Stage 2 – Financial Stability: Positive cash flow, debt being managed, minimal savings.',
      'Stage 3 – Financial Security: Emergency fund built, debt reducing, consistent savings.',
      'Stage 4 – Financial Freedom: Investments growing, pension active, lifestyle balanced.',
      'Stage 5 – Financial Independence: Diversified portfolio, passive income, full wealth management.',
      '',
      '## Output',
      'Respond EXCLUSIVELY with valid JSON — no markdown, no extra text:',
      '{ "current_step": <integer 1-5>, "reasoning": "<short explanation of WHY this stage: which criteria drove the decision>" }',
      buildQuestionnairePromptSection(questionnaire),
    ].join('\n');

    const raw = await this.callAi(prompt);

    const parsed = JSON.parse(raw);
    const step = Math.min(5, Math.max(1, Number(parsed.current_step) || 1));

    return step;
  }

  // ─── Step 3: Personalized Task Selection ─────────────────────────────────

  /**
   * Receives ONLY the DB-pre-filtered goals (already hard-constrained to the
   * user's current step). The AI is strictly forbidden from adding or removing
   * goals — it may only reorder and write personalized Hebrew insight text.
   *
   * Returns ALL goals from the input list, sorted by relevance to the user.
   *
   * `questionnaire`, when provided, lets the user's self-declared goals and
   * off-platform context inform prioritization and the Hebrew insight text.
   */
  async personalizeGoals(
    profile: UserProfile,
    filteredGoals: RoadmapGoal[],
    questionnaire: QuestionnaireSummary | null = null,
  ): Promise<PersonalizedGoalRecommendation[]> {
    const goalList = filteredGoals.map((g) => ({
      roadmap_goal_id: g.goalId,
      title: g.title,
      priority: g.priority,
      description_template: g.descriptionTemplate,
      required_context: g.requiredContext ?? null,
      dynamic_params_schema: g.dynamicParams ?? {},
    }));

    const prompt = [
      'You are a personal financial coach.',
      '',
      '⚠️  HARD CONSTRAINT: You MUST work ONLY with the goals listed in "Available Goals" below.',
      '   Do NOT add goals. Do NOT remove goals. Do NOT reference goals outside this list.',
      '   All ai_insight text MUST be written in Hebrew.',
      '',
      '## User Financial Profile',
      JSON.stringify(
        {
          current_step: profile.currentStep,
          cash_flow: profile.cashFlow,
          credit_consumption: profile.creditConsumption,
          loans: profile.loans,
          savings_investments: profile.savingsInvestments,
          pension_long_term: profile.pensionLongTerm,
          lifestyle_clubs: profile.lifestyleClubs,
          mortgage: profile.mortgage,
          system_indicators: profile.systemIndicators,
          risk_tolerance: profile.riskTolerance,
          knowledge_level: profile.knowledgeLevel,
        },
        null,
        2,
      ),
      '',
      '## Available Goals — you MUST include every one of these, no additions',
      JSON.stringify(goalList, null, 2),
      '',
      '## Your Task',
      '1. For EACH goal in the list, write a brief personalized Hebrew ai_insight.',
      '2. Populate dynamic_params with any values derivable from the user profile.',
      '3. Return ALL goals ordered by relevance to this user (most relevant first).',
      '4. Preserve the exact roadmap_goal_id and title from the list.',
      '',
      '## Response Format',
      'Respond EXCLUSIVELY with valid JSON — no markdown, no extra text:',
      '{ "recommendations": ' +
        JSON.stringify(
          [
            {
              roadmap_goal_id: '<UUID from Available Goals>',
              title: '<exact title from Available Goals>',
              priority: '<integer — copy from Available Goals>',
              ai_insight: '<Hebrew personalized explanation>',
              dynamic_params: { key: 'value' },
            },
          ],
          null,
          2,
        ) +
        ' }',
      buildQuestionnairePromptSection(questionnaire),
    ].join('\n');

    const raw = await this.callAi(prompt);

    let parsed: { recommendations: any[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new InternalServerErrorException(
        'AI personalization returned invalid JSON',
      );
    }

    const recommendations = Array.isArray(parsed?.recommendations)
      ? parsed.recommendations
      : Array.isArray(parsed as any)
        ? (parsed as any)
        : [];

    // Security hard-stop: strip any goal IDs the AI invented outside the filtered list
    const allowedIds = new Set(filteredGoals.map((g) => g.goalId));
    const safe = recommendations.filter((r: any) =>
      allowedIds.has(r.roadmap_goal_id),
    );

    const dropped = recommendations.length - safe.length;

    const result = safe.map((r: any) => ({
      roadmap_goal_id: r.roadmap_goal_id,
      title:
        r.title ??
        filteredGoals.find((g) => g.goalId === r.roadmap_goal_id)?.title ??
        '',
      priority: Number(r.priority) || 0,
      ai_insight: r.ai_insight ?? '',
      dynamic_params: r.dynamic_params ?? {},
    }));

    await this.persistGuidanceLog(profile, filteredGoals, result, questionnaire);

    return result;
  }

  // ─── Private AI helpers ───────────────────────────────────────────────────

  private async callAi(prompt: string): Promise<string> {
    const raw = await this.llm.generate(prompt, '', 'orchestrator');
    return this.llm.sanitizeJson(raw);
  }

  /**
   * Records the AI guidance produced for a user into llm_guidance_logs.
   * Stores the decision context (financial criteria + step + candidate goals)
   * alongside the personalized recommendations the model returned, so guidance
   * is auditable and reproducible. Failures are non-fatal to the request.
   */
  private async persistGuidanceLog(
    profile: UserProfile,
    filteredGoals: RoadmapGoal[],
    recommendations: PersonalizedGoalRecommendation[],
    questionnaire: QuestionnaireSummary | null = null,
  ): Promise<void> {
    try {
      const contextSnapshot = {
        current_step: profile.currentStep,
        criteria: {
          cash_flow: profile.cashFlow,
          credit_consumption: profile.creditConsumption,
          loans: profile.loans,
          savings_investments: profile.savingsInvestments,
          pension_long_term: profile.pensionLongTerm,
          lifestyle_clubs: profile.lifestyleClubs,
          mortgage: profile.mortgage,
          system_indicators: profile.systemIndicators,
          risk_tolerance: profile.riskTolerance,
          knowledge_level: profile.knowledgeLevel,
        },
        candidate_goal_ids: filteredGoals.map((g) => g.goalId),
        questionnaire: questionnaire ?? null,
        recommendations,
      };

      const guidanceText = recommendations
        .map((r, i) => `${i + 1}. [${r.title}] ${r.ai_insight}`)
        .join('\n');

      const log = this.logRepo.create({
        userId: profile.userId,
        contextSnapshot,
        guidanceText,
      });
      await this.logRepo.save(log);
      this.logger.log(
        `[GuidanceLog] saved logId=${log.logId} userId=${profile.userId} ` +
          `recommendations=${recommendations.length}`,
      );
    } catch (err) {
      this.logger.warn(
        `[GuidanceLog] failed to persist guidance for userId=${profile.userId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
