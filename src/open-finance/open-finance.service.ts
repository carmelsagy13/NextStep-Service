import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BankConsent } from '../database/entities/bank-consent.entity.js';
import { BankToken } from '../database/entities/bank-token.entity.js';
import {
  RoadmapStep,
  CriteriaDetail,
} from '../database/entities/roadmap-step.entity.js';
import { RoadmapGoal, RoadmapGoalType } from '../database/entities/roadmap-goal.entity.js';
import { RoadmapState } from '../database/entities/roadmap-state.entity.js';
import {
  UserGoal,
  UserGoalStatus,
} from '../database/entities/user-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { UserProfileHistory } from '../database/entities/user-profile-history.entity.js';
import {
  UserAspiration,
  UserAspirationStatus,
} from '../database/entities/user-aspiration.entity.js';
import { LlmClientService } from '../llm-client/llm-client.service.js';
import { extractFeatures } from './financial-report.extractor.js';
import { FinancialFeatures } from './financial-features.model.js';
import { auditFeatures } from '../diagnostics/open-finance-audit.js';
import { computeLossAversion } from '../loss-aversion/loss-aversion.engine.js';
import type { LossAversionResult } from '../loss-aversion/loss-aversion.types.js';
import { FinancialAnalysisService } from '../financial-analysis/financial-analysis.service.js';
import { EventDetectionService } from '../event-detection/event-detection.service.js';
import { isMarketingGoalAllowed, MAX_ACTIVE_MARKETING_GOALS } from '../common/marketing-goal-policy.js';
import { GoalResponseDto } from '../goals/dto/goal-response.dto.js';
import {
  GOAL_RESPONSE_RELATIONS,
  resolveAssetBaseUrl,
  toGoalResponseList,
} from '../goals/goal-response.mapper.js';
import {
  QuestionnaireService,
  QuestionnaireSummary,
  buildQuestionnairePromptSection,
} from '../questionnaire/questionnaire.service.js';

export interface AiCriteriaProfile {
  cash_flow: number;
  credit_consumption: number;
  loans: number;
  savings_investments: number;
  pension_long_term: number;
  lifestyle_clubs: number;
  mortgage: number;
  system_indicators: number;
  risk_level: string | null;
  knowledge_level: string | null;
  /** Per-criterion explanation of the assigned 1–5 score (testing/debugging only, not persisted). */
  criteria_reasoning?: Record<string, string>;
}

export interface GeminiAnalysisResult {
  roadmap_state: {
    current_step: number;
    progress_percentage: number;
    state_description: string;
  };
  user_profile: AiCriteriaProfile;
  selected_tasks: Array<{
    roadmap_goal_id: string;
    target_amount: number | null;
    current_amount: number;
    target_date: string | null;
    is_completed: boolean;
    dynamic_params: Record<string, unknown>;
    ai_insight: string;
  }>;
}

export interface PersistAnalysisResult {
  roadmap_state: RoadmapState;
  user_goals: GoalResponseDto[];
  task_selection_reasoning: {
    why_not_added: string;
    relevant_but_premature: string[];
    /** Why a sponsored goal was or was not offered in this pass. */
    marketing_rationale?: string;
  };
}

/**
 * State-aware snapshot loaded BEFORE a reconciliation run. Lets the LLM compare
 * new financial information against the user's existing profile and task history
 * instead of recalculating from scratch.
 */
export interface UserReconciliationContext {
  currentProfile: UserProfile | null;
  currentState: RoadmapState | null;
  existingTasks: UserGoal[];
  history: UserProfileHistory[];
  /** The user's active overarching goals, used to detect changed targets. */
  aspirations: UserAspiration[];
}

/**
 * The diff the LLM returns during a state-aware reassessment. Every task is
 * referenced by ID — existing tasks by `user_goal_id`, new tasks by
 * `roadmap_goal_id` — so task identity is preserved across reassessments and
 * no duplicate instances are created.
 */
export interface ReconciliationDecision {
  task_reconciliation: {
    keep: Array<{ user_goal_id: string; new_priority?: number }>;
    remove: Array<{ user_goal_id: string; reason: string }>;
    reprioritize: Array<{ user_goal_id: string; new_priority: number }>;
    complete: Array<{ user_goal_id: string }>;
    update: Array<{
      user_goal_id: string;
      target_amount?: number | null;
      current_amount?: number | null;
      target_date?: string | null;
      dynamic_params?: Record<string, unknown> | null;
      ai_insight?: string | null;
      new_priority?: number | null;
      reason?: string;
    }>;
    add: Array<{
      roadmap_goal_id: string;
      aspiration_id?: string | null;
      target_amount: number | null;
      target_date: string | null;
      dynamic_params: Record<string, unknown>;
      ai_insight: string;
      priority: number;
    }>;
  };
  progress_assessment: {
    meaningful_progress: boolean;
    summary: string;
  };
  task_selection_reasoning: {
    why_not_added: string;
    relevant_but_premature: string[];
    marketing_rationale?: string;
  };
}

@Injectable()
export class OpenFinanceService {
  private readonly logger = new Logger(OpenFinanceService.name);

  constructor(
    @InjectRepository(BankConsent)
    private readonly consentRepo: Repository<BankConsent>,
    @InjectRepository(BankToken)
    private readonly tokenRepo: Repository<BankToken>,
    @InjectRepository(RoadmapStep)
    private readonly stepRepo: Repository<RoadmapStep>,
    @InjectRepository(RoadmapGoal)
    private readonly roadmapGoalRepo: Repository<RoadmapGoal>,
    @InjectRepository(UserProfileHistory)
    private readonly historyRepo: Repository<UserProfileHistory>,
    @InjectRepository(UserAspiration)
    private readonly aspirationRepo: Repository<UserAspiration>,
    private readonly dataSource: DataSource,
    private readonly llm: LlmClientService,
    private readonly financialAnalysis: FinancialAnalysisService,
    private readonly eventDetection: EventDetectionService,
    private readonly questionnaire: QuestionnaireService,
    private readonly config: ConfigService,
  ) {}

  async connect(body: any) {
    // TODO: create consent record, call Open Finance API, return consentUrl
    return { consentUrl: 'https://open-finance.co.il/consent/placeholder' };
  }

  async callback(query: any) {
    // TODO: exchange auth code for tokens, store encrypted, mark consent complete
    return { message: 'Consent finalized' };
  }

  async sync(body: any) {
    // TODO: fetch latest transactions, update DB indicators, trigger event detection
    return { message: 'Sync complete', transactionsProcessed: 0 };
  }

  /**
   * Parses the uploaded Open Banking JSON, calls Gemini to classify the user's
   * financial state and select relevant tasks, then persists everything to the DB.
   */
  async analyzeFile(
    fileBuffer: Buffer,
    userId: string,
  ): Promise<PersistAnalysisResult> {
    // 1. Parse the uploaded JSON file.
    let bankingData: unknown;
    try {
      bankingData = JSON.parse(fileBuffer.toString('utf-8'));
    } catch {
      throw new BadRequestException('Uploaded file is not valid JSON');
    }

    return this.analyzeBankingJson(bankingData, userId);
  }

  /**
   * Normalization Bridge: takes already-parsed Open Banking JSON (from any source —
   * file upload, Open Finance API, etc.), runs it through the LLM analyzer and
   * persists the resulting roadmap state / user profile / user goals.
   *
   * This is the single entry point reused by both the file-upload flow and the
   * Open Finance API integration so both paths produce identical DB writes.
   */
  async analyzeBankingJson(
    bankingData: unknown,
    userId: string,
  ): Promise<PersistAnalysisResult> {
    // 1. Fetch stage definitions and active goal templates from the DB in parallel.
    const [stages, goalTemplates] = await Promise.all([
      this.stepRepo.find({ order: { stepId: 'ASC' } }),
      this.roadmapGoalRepo.find({
        where: { isActive: true },
        relations: ['offer', 'offer.partner'],
        order: { stepId: 'ASC', priority: 'ASC' },
      }),
    ]);

    if (!stages.length) {
      throw new InternalServerErrorException(
        'No roadmap steps found in the database. Please seed the roadmap_steps table.',
      );
    }

    // 2. Deterministic feature extraction from the aggregated Open Finance
    //    report. Replaces the old transactions-based preprocessing — the real
    //    payload is an aggregated report, not a flat transactions list.
    const features: FinancialFeatures = extractFeatures(bankingData);
    const summaryJson = JSON.stringify(features);

    // Full open-finance data dump for LLM-mechanism testing/debugging.
    this.logger.log(
      `[OpenFinance] Extracted financial features (userId=${userId}):\n` +
        JSON.stringify(features, null, 2),
    );

    auditFeatures(
      this.logger,
      userId,
      features as unknown as Record<string, unknown>,
    );

    // 2a. Persist the raw snapshot and detect data-backed events. These run in
    //     parallel with the LLM round-trips below; they don't block them.
    const sideEffects = Promise.all([
      this.financialAnalysis.persistSnapshot(userId, features),
      this.eventDetection.detectEvents(userId, features),
    ]).catch((err) => {
      // Snapshot/event persistence is non-critical to the analysis result.
      this.logger.warn(
        `Snapshot/event persistence failed — userId=${userId}: ${String(
          err?.message,
        ).slice(0, 160)}`,
      );
    });

    // 2b. Load the user's existing state & task history in PARALLEL with the LLM
    //     calls. It is only consumed by the reconciliation step, so there is no
    //     reason to block the model round-trip on this DB read.
    const contextPromise = this.loadUserContext(userId);

    // 2c. Load the user's most recent questionnaire answers (off-platform
    //     context the bank data cannot see). Also parallel — feeds both LLM
    //     calls. Resolves to null when the user has not completed onboarding.
    const questionnairePromise = this.questionnaire.buildLatestSummary(userId);

    // 3. Single LLM round-trip. The focused profile classification runs in
    //    parallel with a MERGED state-determination + reconciliation call. This
    //    collapses the previous two sequential waves (state → reconciliation)
    //    into one, roughly halving the model latency that dominates the request.
    const questionnaire = await questionnairePromise;
    const [userProfile, { roadmapState, decision }] = await Promise.all([
      this.callLlmForProfile(summaryJson, stages, questionnaire),
      contextPromise.then((ctx) =>
        this.callLlmForStateAndReconciliation(
          summaryJson,
          stages,
          goalTemplates,
          ctx,
          questionnaire,
        ),
      ),
    ]);

    const currentStep = roadmapState.current_step;
    const context = await contextPromise;

    // 3a. Compute the loss-aversion projection: money the user misses out on by
    //     not advancing from their current stage to the next one. Pure, uses the
    //     rich in-memory features + the determined current step.
    const nextStageStep = stages.find((s) => s.stepId > currentStep) ?? null;
    const lossAversion = computeLossAversion({
      features,
      currentStep,
      nextStage: nextStageStep
        ? {
            stepId: nextStageStep.stepId,
            title: nextStageStep.title ?? null,
            titleHe: nextStageStep.titleHe ?? null,
          }
        : null,
    });

    // 4. Persist the reconciliation result (non-destructive) within a transaction.
    const clientResponse = await this.applyReconciliation({
      userId,
      currentStep,
      roadmapState,
      userProfile: this.normalizeCriteriaProfile(userProfile),
      decision,
      goalTemplates,
      context,
      features,
      lossAversion,
    });

    // Attach the task selection reasoning to the response
    clientResponse.task_selection_reasoning = decision.task_selection_reasoning;

    // Ensure snapshot/event persistence has settled before responding.
    await sideEffects;

    return clientResponse;
  }

  // ─── TASK 2 & 3: 2-Wave LLM Pipeline with Validation ─────────────────────

  private static readonly STRICT_JSON_SUFFIX =
    'IMPORTANT: Return raw JSON only. Do NOT wrap output in markdown code blocks (```json ... ```), do NOT output preamble or postscript text. Ensure all Hebrew text strings are cleanly escaped as valid UTF-8.';

  /**
   * Collects the 8 per-criteria JSONB definitions on a roadmap step into a
   * single keyed object for the LLM prompt. Criteria left empty (null) on a
   * step are omitted so the model only sees the dimensions actually defined.
   */
  private static assembleCriteria(
    step: RoadmapStep,
  ): Record<string, CriteriaDetail> {
    const entries: Array<[string, CriteriaDetail | null]> = [
      ['cash_flow', step.cashFlow],
      ['credit_consumption', step.creditConsumption],
      ['loans', step.loans],
      ['savings_investments', step.savingsInvestments],
      ['pension_long_term', step.pensionLongTerm],
      ['lifestyle_clubs', step.lifestyleClubs],
      ['mortgage', step.mortgage],
      ['system_indicators', step.systemIndicators],
    ];
    const result: Record<string, CriteriaDetail> = {};
    for (const [key, value] of entries) {
      if (value) {
        result[key] = value;
      }
    }
    return result;
  }

  private async callLlmForProfile(
    summaryJson: string,
    stages: RoadmapStep[],
    questionnaire: QuestionnaireSummary | null,
  ): Promise<AiCriteriaProfile> {
    const criteriaByStageSection = stages
      .map((s) => {
        const criteria = OpenFinanceService.assembleCriteria(s);
        const name = s.titleHe ? `${s.title} / ${s.titleHe}` : s.title;
        return [
          `### Stage ${s.stepId} – ${name}`,
          Object.keys(criteria).length
            ? JSON.stringify(criteria, null, 2)
            : '  (no criteria defined)',
        ].join('\n');
      })
      .join('\n\n');

    const systemPrompt = [
      'You are an expert Israeli financial analyst.',
      'Evaluate the user financial features below and return a JSON object representing their profile.',
      '',
      '## How to read the financial features block (all amounts in ILS, monthly unless noted)',
      '- currentBalance: total liquid balance across all checking accounts.',
      "- monthlyIncome / monthlyExpenses: average monthly income and spending. monthlyExpenses EXCLUDES loan/mortgage repayments and transfers into the user's own savings/investment accounts — those are reported separately and must NOT be treated as overspending.",
      '- monthlyNetCashFlow: provider-reported income minus expenses per month.',
      '- discretionarySurplus = monthlyIncome - monthlyExpenses, i.e. disposable income BEFORE debt service. POSITIVE means the user lives within their means and can build wealth.',
      '- savingsRate: % of monthly income left as surplus. Higher = more capacity to save/invest.',
      '- monthsCovered / avgMonthlyIncome / avgMonthlyExpense / deficitMonthsCount: the multi-month trend. deficitMonthsCount = number of months where expense exceeded income.',
      '- totalSavings / totalSecuritiesValue / totalInvestments / securitiesCount: accumulated wealth. A LARGE totalInvestments is a STRENGTH, never a deficit, and points to the higher stages.',
      '- IMPORTANT: totalSavings counts DEPOSIT accounts only. Money-market funds and other securities are liquid and appear in totalSecuritiesValue. totalSavings = 0 therefore does NOT mean the user has no emergency fund — judge the safety net on totalInvestments / savingsAndSecuritiesBalance, and never propose building one when those are already substantial.',
      '- totalLoans / totalMortgage / totalDebt / hasActiveLoans / hasMortgage: outstanding debt.',
      '- activeCreditCardsCount / avgMonthlyCreditCardSpend / creditCardFeesTotal: credit-card usage.',
      '- systemFlags (loanOverDueCount, foreclosureCount, alertNoticeCount, akamCount, cancelledCount): BDI distress counters. Any non-zero value signals instability — score system_indicators lower.',
      'Judge cash_flow on discretionarySurplus and the deficitMonthsCount trend. Reward high totalInvestments / savingsRate when scoring savings_investments and pension_long_term. Score loans/mortgage from totalDebt, and system_indicators worse when systemFlags are non-zero.',
      '',
      '## Macro debt-service & savings-flow metrics (consumer loans and mortgages are SEPARATE)',
      '- monthlyLoanPayments / monthlyMortgagePayments: average monthly repayment for CONSUMER loans vs MORTGAGE respectively (kept apart so each is scored independently — a mortgage is NOT a consumer loan).',
      '- loanBalance / mortgageBalance: outstanding consumer-loan vs mortgage balance.',
      '- loanVSaffordability / mortgageVSaffordability: that payment as a share of monthly disposable surplus (income - expenses). Higher = heavier burden; 0 = no such payment; 99 = payment exists but there is no positive surplus (unaffordable). Score `loans` from the consumer figures and `mortgage` from the mortgage figures.',
      '- savingsAndSecuritiesBalance: Σ savings balances + securities value (accumulated savings/investment wealth).',
      '- monthlyDeposits / monthlyWithdrawals: average monthly inflow to / outflow from savings & securities. Net positive deposits ⇒ active wealth-building (raise savings_investments / pension_long_term capacity).',
      '- avgBalanceLast3Month: mean recent checking balance — a higher, stable balance supports cash_flow.',
      '',
      '## Derived cash-flow metrics (compute BEFORE evaluating the cash-flow stage)',
      'Before evaluating the user’s financial stage, calculate the following derived metrics based on the raw Open Finance fields.',
      '',
      '1. Calculate weightedReturnedPaymentsScoreLast3Months:',
      'weightedReturnedPaymentsScoreLast3Months =',
      '  (countForAkamHokLast3Month * 1) +',
      '  (countForAkamChqLast3Month * 3) +',
      '  (countCancelledHokLast3Month * 2) +',
      '  (countForCancellChqLast3Month * 3)',
      'This score represents returned or cancelled payment behavior over the last 3 months, including returned direct debits, returned checks, cancelled direct debits, and checks marked for cancellation.',
      '',
      '2. Calculate weightedAccountDistressScoreLast3Months:',
      'weightedAccountDistressScoreLast3Months =',
      '  (countForPigurLast3Month * 4) +',
      '  (countExceededAlertLast3Month * 2) +',
      '  (countForLimitLast3Month * 1) +',
      '  (countForSilukPigurLast3Month * 3)',
      'This score represents account distress signals over the last 3 months, including arrears, exceeded limit alerts, limit-related warnings, and arrears settlement events.',
      '',
      'After calculating these derived metrics, evaluate the user’s cash-flow stage using the conditions stored in the database.',
      'For the cash-flow criterion, read the cash_flow JSONB field from the roadmap_steps table for each step. Use the database records as the source of truth for the stage definitions, descriptions, and conditions.',
      'Evaluate the user’s Open Finance data and the calculated derived metrics against the cash_flow conditions defined for each step.',
      '- If the user matches multiple stages, assign the lowest matching stage, because risk signals should override stronger indicators.',
      '- If the user does not exactly match any stage, choose the closest stage based on the overall cash-flow picture described in the DB.',
      'Do not hardcode the cash-flow stage conditions inside the prompt. Always use the current conditions stored in the roadmap_steps.cash_flow JSONB field.',
      '',
      '## 8 Granular Financial Criteria — Stage Definitions',
      'Each criterion may carry `openFinanceParameters` (banking signals) and',
      '`questionnaireParameters` (self-declared signals). Inside',
      '`questionnaireParameters`, a parameter whose value is an EMPTY string ("")',
      'is NOT a target to match — it simply flags a questionnaire question the model',
      'must INSPECT: read the user\'s answer to that question and weigh it into this',
      'criterion\'s score. A parameter WITH a value still means match against that',
      'specific value. If the referenced answer is missing, ignore that parameter.',
      criteriaByStageSection,
      '',
      '## Demographic Extraction',
      '- risk_level: one of "low" | "medium" | "high"',
      '- knowledge_level: one of "beginner" | "intermediate" | "advanced"',
      '',
      '## Per-Criteria Reasoning',
      'For EACH of the 8 criteria, write one short explanation of WHY you assigned',
      'that 1–5 score: name the specific financial features (and questionnaire',
      'answers, if present) you weighed and how they map to the stage definition.',
      'Return these under `criteria_reasoning`, keyed by the same 8 criteria names.',
      'Keep each explanation to one or two sentences.',
      '',
      '## Required Output Schema (flat JSON object):',
      JSON.stringify({
        cash_flow: '<integer 1–5>',
        credit_consumption: '<integer 1–5>',
        loans: '<integer 1–5>',
        savings_investments: '<integer 1–5>',
        pension_long_term: '<integer 1–5>',
        lifestyle_clubs: '<integer 1–5>',
        mortgage: '<integer 1–5>',
        system_indicators: '<integer 1–5>',
        risk_level: '<string or null>',
        knowledge_level: '<string or null>',
        criteria_reasoning: {
          cash_flow: '<short explanation of the cash_flow score>',
          credit_consumption: '<short explanation of the credit_consumption score>',
          loans: '<short explanation of the loans score>',
          savings_investments: '<short explanation of the savings_investments score>',
          pension_long_term: '<short explanation of the pension_long_term score>',
          lifestyle_clubs: '<short explanation of the lifestyle_clubs score>',
          mortgage: '<short explanation of the mortgage score>',
          system_indicators: '<short explanation of the system_indicators score>',
        },
      }),
      '',
      '## Mapping questionnaire answers to the 8 criteria',
      'If the questionnaire block below is present, factor its OFF-PLATFORM items',
      'into the relevant scores (the bank data cannot see them):',
      '- loans taken OUTSIDE the bank ⇒ weigh into `loans`.',
      '- off-platform savings / study funds / provident / pension ⇒ raise',
      '  `savings_investments` and `pension_long_term` capacity.',
      '- credit cards from OTHER providers ⇒ factor into `credit_consumption` and',
      '  `lifestyle_clubs`.',
      '- investment real-estate / other-bank balances ⇒ added accumulated wealth.',
      'Treat these as COMPLEMENTARY to the bank features; never double-count an item',
      'already reflected in the financial features block.',
      buildQuestionnairePromptSection(questionnaire),
      '',
      OpenFinanceService.STRICT_JSON_SUFFIX,
    ].join('\n');

    const rawText = await this.llm.generate(systemPrompt, summaryJson, 'profile');
    return this.llm.parseJson<AiCriteriaProfile>(rawText, 'profile');
  }

  /**
   * Loads the user's current profile, roadmap state, existing tasks (all
   * lifecycle states) and recent assessment history so the reconciliation LLM
   * call can reason about progression rather than recomputing from scratch.
   */
  private async loadUserContext(
    userId: string,
  ): Promise<UserReconciliationContext> {
    const [currentProfile, currentState, existingTasks, history, aspirations] =
      await Promise.all([
        this.dataSource
          .getRepository(UserProfile)
          .findOne({ where: { userId } }),
        this.dataSource
          .getRepository(RoadmapState)
          .findOne({ where: { userId } }),
        this.dataSource.getRepository(UserGoal).find({
          where: { userId },
          order: { priority: 'ASC' },
        }),
        this.historyRepo.find({
          where: { userId },
          order: { createdAt: 'DESC' },
          take: 5,
        }),
        this.aspirationRepo.find({
          where: { userId, status: UserAspirationStatus.ACTIVE },
        }),
      ]);

    return { currentProfile, currentState, existingTasks, history, aspirations };
  }

  /**
   * Merged state-determination + state-aware reconciliation in a SINGLE LLM
   * round-trip. Determines the user's pyramid step from the new summary AND, in
   * the same pass, cross-references their existing tasks/history against the
   * full goal task bank to produce an ID-based diff (keep/remove/reprioritize/
   * complete/add). Collapsing these two formerly-sequential calls roughly halves
   * the model latency. The persistence step still guards added goals to the
   * determined step, so sending the full task bank here is safe.
   *
   * Privacy: only abstracted prior assessments (criteria scores / step /
   * progress) are sent as history — never previously-stored raw financials.
   */
  private async callLlmForStateAndReconciliation(
    summaryJson: string,
    stages: RoadmapStep[],
    allGoalTemplates: RoadmapGoal[],
    context: UserReconciliationContext,
    questionnaire: QuestionnaireSummary | null,
  ): Promise<{
    roadmapState: GeminiAnalysisResult['roadmap_state'];
    decision: ReconciliationDecision;
  }> {
    const stagesSection = stages
      .map((s) => {
        const detail =
          s.description ??
          JSON.stringify(OpenFinanceService.assembleCriteria(s));
        const name = s.titleHe ? `${s.title} / ${s.titleHe}` : s.title;
        return `  Stage ${s.stepId} – ${name}: ${detail}`;
      })
      .join('\n');

    // Full task bank grouped by step. The model picks goals from the step it
    // determines; applyReconciliation re-validates step membership.
    const goalsByStep = new Map<number, RoadmapGoal[]>();
    for (const g of allGoalTemplates) {
      const list = goalsByStep.get(g.stepId) ?? [];
      list.push(g);
      goalsByStep.set(g.stepId, list);
    }
    const taskBankSection = allGoalTemplates.length
      ? Array.from(goalsByStep.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([stepId, goals]) => {
            const goalsText = goals
              .map((g) =>
                [
                  `  - roadmap_goal_id: "${g.goalId}"`,
                  `    type: ${g.type}`,
                  g.criteria ? `    criteria: "${g.criteria}"` : null,
                  `    title: "${g.title}"`,
                  `    description_template: "${g.descriptionTemplate}"`,
                  // Sponsored goals expose branding + targeting so the model can
                  // judge fit. The affiliate link is deliberately withheld.
                  g.type === RoadmapGoalType.MARKETING && g.offer
                    ? `    partner: "${g.offer.partner?.nameHe ?? ''}"`
                    : null,
                  g.type === RoadmapGoalType.MARKETING && g.offer
                    ? `    offer_headline: "${g.offer.headlineHe}"`
                    : null,
                  g.type === RoadmapGoalType.MARKETING && g.offer?.benefitTags?.length
                    ? `    benefit_tags: ${JSON.stringify(g.offer.benefitTags)}`
                    : null,
                  g.type === RoadmapGoalType.MARKETING && g.offer?.targeting
                    ? `    offer_targeting: ${JSON.stringify(g.offer.targeting)}`
                    : null,
                  g.requiredContext
                    ? `    required_context: "${g.requiredContext}"`
                    : null,
                  g.requiredContextText
                    ? `    required_context_text: "${g.requiredContextText}"`
                    : null,
                  g.dynamicParams
                    ? `    dynamic_params_schema: ${JSON.stringify(g.dynamicParams)}`
                    : null,
                  `    priority: ${g.priority}`,
                ]
                  .filter(Boolean)
                  .join('\n'),
              )
              .join('\n\n');
            return `### Step ${stepId} Goals\n${goalsText}`;
          })
          .join('\n\n')
      : '  (no goal templates available)';

    const existingTasksSection = context.existingTasks.length
      ? context.existingTasks
          .map((t) =>
            [
              `  - user_goal_id: "${t.goalId}"`,
              `    title: "${t.goalName}"`,
              `    status: ${t.status}`,
              `    priority: ${t.priority}`,
              `    progress: ${t.currentAmount ?? 0}/${t.targetAmount ?? 'n/a'}`,
              t.targetDate
                ? `    target_date: ${t.targetDate instanceof Date ? t.targetDate.toISOString().slice(0, 10) : t.targetDate}`
                : null,
              t.dynamicParams
                ? `    dynamic_params: ${JSON.stringify(t.dynamicParams)}`
                : null,
              t.aiInsight ? `    ai_insight: "${t.aiInsight}"` : null,
              t.roadmapGoalId
                ? `    roadmap_goal_id: "${t.roadmapGoalId}"`
                : null,
              t.aspirationId
                ? `    aspiration_id: "${t.aspirationId}"`
                : null,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n')
      : '  (user has no existing tasks — this is a first assessment)';

    // The user's overarching goals. A "changed" flag marks aspirations whose
    // target was edited since the linked tasks were last reconciled — the LLM
    // should UPDATE those tasks' parameters rather than leave them stale.
    const aspirationsSection = context.aspirations.length
      ? context.aspirations
          .map((a) => {
            const changed =
              a.lastSyncedRevision == null ||
              a.revision > a.lastSyncedRevision;
            return [
              `  - aspiration_id: "${a.aspirationId}"`,
              `    goal_type: ${a.goalTypeCode}`,
              `    title: "${a.title}"`,
              `    target_amount: ${a.targetAmount ?? 'null'}`,
              `    target_date: ${a.targetDate ? (a.targetDate instanceof Date ? a.targetDate.toISOString().slice(0, 10) : a.targetDate) : 'null'}`,
              a.attributes
                ? `    attributes: ${JSON.stringify(a.attributes)}`
                : null,
              `    changed_since_last_sync: ${changed}`,
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n')
      : '  (user has not declared any overarching goals)';

    const priorStep = context.currentProfile?.currentStep ?? null;
    const priorProgress = context.currentState?.progressPercent ?? null;

    const historySection = context.history.length
      ? context.history
          .map(
            (h) =>
              `  - ${h.createdAt instanceof Date ? h.createdAt.toISOString() : h.createdAt}: step ${h.step}, progress ${h.progressPercent}%, ` +
              `criteria {cash_flow:${h.cashFlow}, credit:${h.creditConsumption}, loans:${h.loans}, savings:${h.savingsInvestments}, pension:${h.pensionLongTerm}, lifestyle:${h.lifestyleClubs}, mortgage:${h.mortgage}, system:${h.systemIndicators}}`,
          )
          .join('\n')
      : '  (no prior assessments)';

    const systemPrompt = [
      'You are an expert Israeli financial analyst running a STATEFUL reassessment.',
      'All textual output (state_description, ai_insight, summary) MUST be in Hebrew.',
      '',
      'Do TWO things in ONE pass and return them together as a single JSON object:',
      '1) DETERMINE which of the 5 financial stages the user is in from the new summary.',
      "2) RECONCILE the user's existing tasks against that determined stage and",
      '   return an ID-based reconciliation diff.',
      '',
      '## How to read the financial features block (all amounts in ILS, monthly unless noted)',
      '- discretionarySurplus = monthlyIncome - monthlyExpenses, disposable income BEFORE debt service. POSITIVE = healthy cash flow; a comfortable surplus is a STRENGTH.',
      '- Money moved into savings or investment accounts is NOT an expense and NOT a deficit. Never infer an overdraft from it; only a negative currentBalance or a non-zero systemFlags counter indicates real distress.',
      '- A large totalInvestments / totalSecuritiesValue is wealth-building and a STRENGTH — never describe it as a deficit. Such users point toward the HIGHER stages (4–5).',
      '- deficitMonthsCount across monthsCovered shows cash-flow stability; more deficit months ⇒ weaker cash flow.',
      '- monthlyLoanPayments vs monthlyMortgagePayments are SEPARATE debt-service streams (consumer loans are not mortgages); loanVSaffordability / mortgageVSaffordability express each as a share of disposable surplus (higher = heavier; 99 = unaffordable, no positive surplus). loanBalance / mortgageBalance are the outstanding balances.',
      '- savingsAndSecuritiesBalance + net monthlyDeposits/monthlyWithdrawals show accumulated wealth and active saving; avgBalanceLast3Month is the recent average balance.',
      '- systemFlags (loanOverDueCount, foreclosureCount, alertNoticeCount) non-zero ⇒ instability/distress.',
      '',
      '## Financial Stage Definitions',
      stagesSection,
      '',
      'The user already has a profile, a pyramid level and a set of tasks. Do NOT',
      'rebuild from scratch. Compare the NEW financial summary against the existing',
      'tasks and history, then return an ID-based reconciliation diff.',
      '',
      '## Reconciliation Rules',
      '- FIRST set roadmap_state.current_step. Goals belonging to that step are the PRIMARY focus: prefer them and give them the strongest priority.',
      '- You MAY ALSO add goals from ANY other step (higher or lower) when they are genuinely suitable for this user\'s financial situation. Current-step goals should rank above cross-step goals unless a cross-step goal is clearly more urgent for the user right now.',
      '- Criteria-tagged goals (with a "criteria" field) are especially strong cross-step candidates: e.g. a "loans" goal at step 2 fits a user whose loans score is >= 2 even if their overall step is 1.',
      '- Reference existing tasks ONLY by their user_goal_id.',
      "- Reference new tasks ONLY by a roadmap_goal_id from the Available Goal Templates.",
      '- NEVER invent IDs. NEVER duplicate an existing task: if a relevant goal template',
      '  is already present among the existing tasks, KEEP or REPRIORITIZE it instead of adding it.',
      '- Put tasks that are no longer relevant (e.g. ones the user has outgrown or that no longer fit their situation) into "remove". Do NOT remove a task merely because it belongs to a different step than the current one — keep it if it is still suitable.',
      '- Put tasks the data shows are achieved into "complete".',
      '- Only "add" templates that are genuinely relevant and not already assigned.',
      '- When adding a goal, fill dynamic_params with REAL numbers taken from the financial features block (e.g. surplus, currentBalance, activeCreditCardsCount, totalInvestments). NEVER invent figures; if a value is not derivable from the features, use null.',
      '',
      '## Sponsored Goals (type = "marketing") — STRICT RULES',
      'Some templates promote a partner product and are marked `type: "marketing"`.',
      'They are commercial content, so they are held to a much higher bar than any',
      'other goal:',
      '- Add AT MOST ONE marketing goal in total, and only if the user does not already have one.',
      '- Add one ONLY when a concrete, numeric need in the financial features block matches the',
      '  goal\'s `offer_targeting` (e.g. a sustained discretionarySurplus above minMonthlySurplus).',
      '  If the numbers do not clearly support it, add NONE.',
      '- NEVER add one when the user shows any sign of distress: negative monthlyNetCashFlow,',
      '  any non-zero systemFlags, deficit months dominating monthsCovered, or current_step below 2.',
      '  Debt, cash-flow and emergency-buffer goals ALWAYS take precedence.',
      '- Give it a HIGHER priority number (= lower rank) than every personal goal you add, so it',
      '  never sits at the top of the list.',
      '- Write ai_insight in the same calm advisory Hebrew as any other goal: state the concrete',
      '  benefit for THIS user based on their numbers. No hype, no urgency, no superlatives, no',
      '  promises of returns.',
      '- NEVER invent partner names, rates, fees, terms, benefits or links. Use ONLY the `partner`,',
      '  `offer_headline` and `benefit_tags` values shown in the task bank.',
      '- Explain your decision in `task_selection_reasoning.marketing_rationale` (Hebrew) — including',
      '  when you deliberately added none.',
      'These rules are re-enforced by the server after you answer: a marketing goal that',
      'violates them is discarded regardless of what you return.',
      '',
      '## Overarching Goal (Aspiration) Sync — IMPORTANT',
      "The user declares OVERARCHING goals (\"aspirations\") separately — e.g. a wedding",
      'budget or a car target. An existing task may be LINKED to one via aspiration_id.',
      'When an aspiration is marked `changed_since_last_sync: true`, the linked task\'s',
      'parameters are STALE. Put such tasks into "update" (NOT remove+add) and recompute:',
      '- target_amount / target_date from the aspiration\'s new values;',
      '- dynamic_params that depend on the target (e.g. a monthly saving figure =',
      '  remaining amount / months until target_date). Use REAL numbers or null.',
      'Only "update" tasks that reference an aspiration_id present below and a',
      'user_goal_id present in Existing Tasks. Do NOT change a task\'s identity.',
      'If an aspiration has NO linked task yet and a suitable template exists in the',
      'task bank, ADD that template and set its `aspiration_id` to the aspiration it',
      'serves (a generic saving template with a {{goal}} placeholder is acceptable),',
      'so the new task is linked to the goal it advances.',
      '',
      '## Partial Progress Tracking — IMPORTANT',
      'For every ACTIVE task that has a target_amount, ESTIMATE the user\'s actual',
      'accumulated progress toward it from the new financial features (e.g.',
      'currentBalance, totalInvestments, totalSecuritiesValue, accumulated surplus,',
      'or a dedicated savings balance) — choose the figure that best reflects money',
      'already set aside for that specific goal. If that estimate MEANINGFULLY differs',
      'from the task\'s current `progress` value shown in Existing Tasks, return an',
      '"update" action for that user_goal_id carrying the recalculated `current_amount`:',
      '- current_amount is in ILS, must be >= 0 and SHOULD NOT exceed target_amount;',
      '- use REAL numbers derived from the features block — never invent figures; if no',
      '  meaningful progress is derivable, OMIT current_amount (do not send 0 to wipe it);',
      '- partial progress is an UPDATE only. Do NOT put a task in "complete" unless it is',
      '  fully achieved (current_amount has reached target_amount or the goal is clearly met).',
      'An "update" may carry current_amount alone, or together with the aspiration-driven',
      'target_amount/target_date/dynamic_params adjustments described above.',
      '',
      `## User's Current Pyramid Level: ${priorStep ?? 'unknown'} (progress ${priorProgress ?? 0}%)`,
      '',
      '## Previous Assessments (abstracted — no raw financial data)',
      historySection,
      '',
      '## Existing Tasks',
      existingTasksSection,
      '',
      "## User's Overarching Goals (Aspirations)",
      aspirationsSection,
      '',
      '## Available Goal Templates (task bank, grouped by step)',
      taskBankSection,
      '',
      '## Required Output Schema (single JSON object):',
      JSON.stringify({
        roadmap_state: {
          current_step: '<integer 1–5>',
          progress_percentage: '<integer 0–100>',
          state_description: '<Hebrew string describing current state>',
          step_reasoning:
            '<explanation of WHY this stage was chosen: which financial features and stage-definition conditions drove the decision>',
        },
        task_reconciliation: {
          keep: [
            {
              user_goal_id: '<existing UUID>',
              new_priority: '<integer or omit>',
            },
          ],
          remove: [
            { user_goal_id: '<existing UUID>', reason: '<Hebrew reason>' },
          ],
          reprioritize: [
            { user_goal_id: '<existing UUID>', new_priority: '<integer>' },
          ],
          complete: [{ user_goal_id: '<existing UUID>' }],
          update: [
            {
              user_goal_id:
                '<existing UUID whose progress and/or linked aspiration changed>',
              target_amount: '<number or null>',
              current_amount:
                '<number — recalculated accumulated progress in ILS, or omit if none>',
              target_date: '<ISO-8601 string or null>',
              dynamic_params: { key: 'value' },
              ai_insight: '<Hebrew justification of the adjustment>',
              new_priority: '<integer or omit>',
              reason: '<short Hebrew note on what changed>',
            },
          ],
          add: [
            {
              roadmap_goal_id: "<UUID from the Available Goal Templates (any step)>",
              aspiration_id:
                '<UUID of the aspiration this task serves, or omit if none>',
              target_amount: '<number or null>',
              target_date: '<ISO-8601 string or null>',
              dynamic_params: { key: 'value' },
              ai_insight: '<Hebrew justification>',
              priority: '<integer>',
            },
          ],
        },
        progress_assessment: {
          meaningful_progress:
            '<boolean — has the user meaningfully progressed toward the next level>',
          summary: '<Hebrew summary of the change since the last assessment>',
        },
        task_selection_reasoning: {
          why_not_added:
            '<Hebrew explanation: why were other available tasks from the task bank NOT added? Which goals were considered but rejected, and why?>',
          relevant_but_premature:
            '<array of roadmap_goal_id strings: goals that ARE relevant but the user is not ready for them yet>',
          marketing_rationale:
            '<Hebrew: which sponsored goal was added and what in the user\'s numbers justifies it — or why none was added>',
        },
      }),
      '',
      '## Task Selection Transparency',
      'IMPORTANT: In roadmap_state.step_reasoning, explain WHY you placed the user',
      'at the chosen stage: cite the financial features and the stage-definition',
      'conditions that drove the decision (and the lowest-matching-stage rule when',
      'risk signals override stronger indicators).',
      'IMPORTANT: In task_selection_reasoning.why_not_added, explain your decision-making:',
      '- Which goals from the Available Goal Templates were considered but NOT added, and why?',
      '- Are they irrelevant to this user\'s situation?',
      '- Does the user lack the financial prerequisites?',
      '- Are they redundant with existing tasks?',
      'In relevant_but_premature, list goal IDs that would be valuable but require',
      'the user to progress further (e.g., investment goals for someone still building',
      'an emergency fund). This helps track the user\'s journey.',
      '',
      'When the questionnaire block below is present, let the user\'s SELF-DECLARED',
      'goals (e.g. buying a car, wedding, home equity, safety net, early retirement)',
      'inform task prioritization. You may add suitable goals from ANY step in the',
      'Available Goal Templates. Do not invent tasks from questionnaire goals.',
      buildQuestionnairePromptSection(questionnaire),
      '',
      OpenFinanceService.STRICT_JSON_SUFFIX,
    ].join('\n');

    const rawText = await this.llm.generate(
      systemPrompt,
      summaryJson,
      'state+reconciliation',
    );
    const parsed = this.llm.parseJson<any>(rawText, 'state+reconciliation');

    const rs = parsed?.roadmap_state ?? {};
    const roadmapState: GeminiAnalysisResult['roadmap_state'] = {
      current_step: Number(rs.current_step) || 1,
      progress_percentage: Number(rs.progress_percentage) || 0,
      state_description: rs.state_description ?? '',
    };
    const decision = this.normalizeReconciliationDecision(parsed);
    return { roadmapState, decision };
  }

  /** Defensive normalization so missing arrays never crash the apply step. */
  private normalizeReconciliationDecision(raw: any): ReconciliationDecision {
    const tr = raw?.task_reconciliation ?? {};
    const arr = (v: any) => (Array.isArray(v) ? v : []);
    const tsr = raw?.task_selection_reasoning ?? {};
    return {
      task_reconciliation: {
        keep: arr(tr.keep),
        remove: arr(tr.remove),
        reprioritize: arr(tr.reprioritize),
        complete: arr(tr.complete),
        update: arr(tr.update),
        add: arr(tr.add),
      },
      progress_assessment: {
        meaningful_progress: Boolean(
          raw?.progress_assessment?.meaningful_progress,
        ),
        summary: raw?.progress_assessment?.summary ?? '',
      },
      task_selection_reasoning: {
        why_not_added: tsr.why_not_added ?? '',
        relevant_but_premature: arr(tsr.relevant_but_premature),
      },
    };
  }

  /**
   * Coerce all criteria fields to numbers clamped to 1–5 (defaulting to 1) so a
   * malformed LLM payload can never persist an out-of-range score.
   */
  private normalizeCriteriaProfile(raw: any): AiCriteriaProfile {
    const clamp = (v: any) => Math.min(5, Math.max(1, Number(v) || 1));
    return {
      cash_flow: clamp(raw?.cash_flow),
      credit_consumption: clamp(raw?.credit_consumption),
      loans: clamp(raw?.loans),
      savings_investments: clamp(raw?.savings_investments),
      pension_long_term: clamp(raw?.pension_long_term),
      lifestyle_clubs: clamp(raw?.lifestyle_clubs),
      mortgage: clamp(raw?.mortgage),
      system_indicators: clamp(raw?.system_indicators),
      risk_level: raw?.risk_level ?? null,
      knowledge_level: raw?.knowledge_level ?? null,
    };
  }

  /**
   * Non-destructive persistence of a state-aware reassessment.
   *
   * Unlike the previous delete-and-reinsert approach, this:
   *  - upserts the current RoadmapState + UserProfile projection,
   *  - appends an immutable UserProfileHistory row (level/criteria/progress only),
   *  - applies the LLM's ID-based task diff, preserving task identity and never
   *    creating duplicate task instances.
   *
   * No raw financial data is written anywhere.
   */
  private async applyReconciliation(params: {
    userId: string;
    currentStep: number;
    roadmapState: GeminiAnalysisResult['roadmap_state'];
    userProfile: AiCriteriaProfile;
    decision: ReconciliationDecision;
    goalTemplates: RoadmapGoal[];
    context: UserReconciliationContext;
    features: FinancialFeatures;
    lossAversion: LossAversionResult;
  }): Promise<PersistAnalysisResult> {
    const { userId, currentStep, decision } = params;
    const p = params.userProfile;
    const templateMap = new Map(params.goalTemplates.map((g) => [g.goalId, g]));

    // Stage/eligibility limit removed: a goal from ANY step (or any per-criteria
    // level) may be added. The only remaining guard is that the proposed id must
    // be a real goal template from the task bank (anti-hallucination).
    const allowedAddIds = new Set(params.goalTemplates.map((g) => g.goalId));

    const priorStep = params.context.currentProfile?.currentStep ?? null;
    const priorProgress = params.context.currentState?.progressPercent ?? null;
    const newProgress = params.roadmapState.progress_percentage;

    return this.dataSource.transaction(async (manager) => {
      const now = new Date();

      // --- Upsert RoadmapState (current projection) ---
      let state = await manager.findOne(RoadmapState, { where: { userId } });
      if (!state) {
        state = manager.create(RoadmapState, { userId });
      }
      state.progressPercent = newProgress;
      state.stateDescription = params.roadmapState.state_description;
      state.lossAversion = params.lossAversion;
      const savedState = await manager.save(RoadmapState, state);

      // --- Upsert UserProfile with 8 granular criteria + demographics ---
      let profile = await manager.findOne(UserProfile, { where: { userId } });
      if (!profile) {
        profile = manager.create(UserProfile, { userId });
      }
      profile.currentStep = currentStep;
      profile.cashFlow = p.cash_flow;
      profile.creditConsumption = p.credit_consumption;
      profile.loans = p.loans;
      profile.savingsInvestments = p.savings_investments;
      profile.pensionLongTerm = p.pension_long_term;
      profile.lifestyleClubs = p.lifestyle_clubs;
      profile.mortgage = p.mortgage;
      profile.systemIndicators = p.system_indicators;
      // Risk tolerance is OWNED EXCLUSIVELY by the Step-4 risk questionnaire
      // (CONSERVATIVE/MODERATE/AGGRESSIVE via UserProfileService.updateRiskTolerance).
      // The AI analysis must NEVER write it, so we intentionally do not touch
      // profile.riskTolerance here.
      if (p.knowledge_level !== null)
        profile.knowledgeLevel = p.knowledge_level;
      await manager.save(UserProfile, profile);

      // --- Append immutable assessment history (abstracted, no raw financials) ---
      const history = manager.create(UserProfileHistory, {
        userId,
        step: currentStep,
        progressPercent: newProgress,
        cashFlow: p.cash_flow,
        creditConsumption: p.credit_consumption,
        loans: p.loans,
        savingsInvestments: p.savings_investments,
        pensionLongTerm: p.pension_long_term,
        lifestyleClubs: p.lifestyle_clubs,
        mortgage: p.mortgage,
        systemIndicators: p.system_indicators,
        previousStep: priorStep,
        stepChanged: priorStep != null && priorStep !== currentStep,
        progressDelta:
          priorProgress != null ? newProgress - priorProgress : null,
        stateDescription: params.roadmapState.state_description,
        llmReasoning: decision.progress_assessment.summary,
      });
      const savedHistory = await manager.save(UserProfileHistory, history);
      const historyId = savedHistory.historyId;

      // --- Apply the ID-based task reconciliation (non-destructive) ---
      const existing = await manager.find(UserGoal, { where: { userId } });
      const byId = new Map(existing.map((t) => [t.goalId, t]));
      const byRoadmapId = new Map<string, UserGoal>();
      for (const t of existing) {
        if (t.roadmapGoalId && !byRoadmapId.has(t.roadmapGoalId)) {
          byRoadmapId.set(t.roadmapGoalId, t);
        }
      }
      const touched = new Set<UserGoal>();

      // Completions
      for (const c of decision.task_reconciliation.complete) {
        const t = byId.get(c.user_goal_id);
        if (!t) continue; // ownership / hallucination guard
        t.status = UserGoalStatus.COMPLETED;
        t.completedAt = now;
        touched.add(t);
      }

      // Removals (soft-delete; never un-complete a completed task)
      for (const r of decision.task_reconciliation.remove) {
        const t = byId.get(r.user_goal_id);
        if (!t || t.status === UserGoalStatus.COMPLETED) continue;
        t.status = UserGoalStatus.REMOVED;
        t.removedAt = now;
        t.removalReason = r.reason ?? null;
        touched.add(t);
      }

      // Reprioritization (explicit + any priority carried on keep[])
      const reprioritized = [
        ...decision.task_reconciliation.reprioritize,
        ...decision.task_reconciliation.keep
          .filter((k) => k.new_priority != null)
          .map((k) => ({
            user_goal_id: k.user_goal_id,
            new_priority: k.new_priority as number,
          })),
      ];
      for (const rp of reprioritized) {
        const t = byId.get(rp.user_goal_id);
        if (!t) continue;
        t.priority = Number(rp.new_priority) || t.priority;
        touched.add(t);
      }

      // Updates: re-tune an ACTIVE task's parameters when its linked aspiration
      // changed. Marks the task synced against the aspiration's current revision.
      const aspirationByIdForUpdate = new Map(
        params.context.aspirations.map((a) => [a.aspirationId, a]),
      );
      const syncedAspirationIds = new Set<string>();
      for (const u of decision.task_reconciliation.update) {
        const t = byId.get(u.user_goal_id);
        if (!t || t.status === UserGoalStatus.COMPLETED) continue;
        if (u.target_amount !== undefined && u.target_amount !== null) {
          t.targetAmount = u.target_amount;
        }
        // Automated partial-progress: map the LLM's recalculated accumulated
        // progress onto the task. Only ACTIVE tasks reach here (COMPLETED ones
        // were skipped above), so this never reverts a finished task. Clamp to
        // >= 0 and never overshoot a known target_amount.
        if (u.current_amount != null && Number.isFinite(Number(u.current_amount))) {
          let next = Math.max(0, Number(u.current_amount));
          if (t.targetAmount != null && Number(t.targetAmount) > 0) {
            next = Math.min(next, Number(t.targetAmount));
          }
          t.currentAmount = next;
        }
        if (u.target_date) t.targetDate = new Date(u.target_date);
        if (u.dynamic_params != null) {
          t.dynamicParams = u.dynamic_params as Record<string, any>;
        }
        if (u.ai_insight) t.aiInsight = u.ai_insight;
        if (u.new_priority != null && Number.isFinite(Number(u.new_priority))) {
          t.priority = Number(u.new_priority);
        }
        if (t.aspirationId) {
          const asp = aspirationByIdForUpdate.get(t.aspirationId);
          if (asp) {
            t.syncedAspirationRevision = asp.revision;
            syncedAspirationIds.add(asp.aspirationId);
          }
        }
        touched.add(t);
      }

      // Additions (dedup + reactivate to preserve identity, never duplicate)
      const aspirationByIdForAdd = aspirationByIdForUpdate;

      // Sponsored content is re-gated here: the prompt states the rules, but the
      // model is not trusted with them. Budget is consumed as offers are accepted.
      let marketingBudget = Math.max(
        0,
        MAX_ACTIVE_MARKETING_GOALS -
          existing.filter(
            (t) =>
              t.status === UserGoalStatus.ACTIVE &&
              t.roadmapGoalId &&
              templateMap.get(t.roadmapGoalId)?.type === RoadmapGoalType.MARKETING,
          ).length,
      );

      for (const a of decision.task_reconciliation.add) {
        if (!allowedAddIds.has(a.roadmap_goal_id)) continue; // hallucinated id guard

        const addedTemplate = templateMap.get(a.roadmap_goal_id);
        if (addedTemplate?.type === RoadmapGoalType.MARKETING) {
          const allowed =
            marketingBudget > 0 &&
            isMarketingGoalAllowed(addedTemplate, {
              currentStep,
              features: params.features,
              activeMarketingGoalCount: 0,
            });
          if (!allowed) {
            this.logger.log(
              `[Marketing] Rejected sponsored goal ${a.roadmap_goal_id} for userId=${userId} — policy gate`,
            );
            continue;
          }
          marketingBudget -= 1;
        }

        // Only honor an aspiration link the user actually owns.
        const linkedAspiration =
          a.aspiration_id && aspirationByIdForAdd.has(a.aspiration_id)
            ? aspirationByIdForAdd.get(a.aspiration_id)!
            : null;
        const dup = byRoadmapId.get(a.roadmap_goal_id);
        if (dup) {
          if (dup.status === UserGoalStatus.COMPLETED) continue; // preserve completion, no duplicate
          dup.status = UserGoalStatus.ACTIVE;
          dup.removedAt = null;
          dup.removalReason = null;
          dup.dynamicParams = a.dynamic_params ?? dup.dynamicParams ?? {};
          dup.aiInsight = a.ai_insight ?? dup.aiInsight;
          dup.priority = Number(a.priority) || dup.priority || 0;
          if (a.target_amount != null) dup.targetAmount = a.target_amount;
          if (a.target_date) dup.targetDate = new Date(a.target_date);
          dup.sourceProfileHistoryId = historyId;
          if (linkedAspiration) {
            dup.aspirationId = linkedAspiration.aspirationId;
            dup.syncedAspirationRevision = linkedAspiration.revision;
            syncedAspirationIds.add(linkedAspiration.aspirationId);
          }
          touched.add(dup);
        } else {
          const template = templateMap.get(a.roadmap_goal_id);
          const created = manager.create(UserGoal, {
            userId,
            roadmapGoalId: a.roadmap_goal_id,
            aspirationId: linkedAspiration?.aspirationId ?? null,
            syncedAspirationRevision: linkedAspiration?.revision ?? null,
            goalName: template?.title ?? 'Unknown Goal',
            dynamicParams: a.dynamic_params ?? {},
            targetAmount: a.target_amount ?? undefined,
            currentAmount: 0,
            targetDate: a.target_date ? new Date(a.target_date) : undefined,
            status: UserGoalStatus.ACTIVE,
            priority: Number(a.priority) || 0,
            sourceProfileHistoryId: historyId,
            aiInsight: a.ai_insight,
          });
          if (linkedAspiration) {
            syncedAspirationIds.add(linkedAspiration.aspirationId);
          }
          touched.add(created);
        }
      }

      if (touched.size) {
        await manager.save(UserGoal, Array.from(touched));
      }

      // Mark every aspiration whose linked tasks were just re-tuned as synced.
      if (syncedAspirationIds.size) {
        const syncedAspirations = params.context.aspirations.filter((a) =>
          syncedAspirationIds.has(a.aspirationId),
        );
        for (const a of syncedAspirations) a.lastSyncedRevision = a.revision;
        await manager.save(UserAspiration, syncedAspirations);
      }

      // Return the user's currently active tasks with their templates populated.
      const activeGoals = await manager.find(UserGoal, {
        where: { userId, status: UserGoalStatus.ACTIVE },
        relations: GOAL_RESPONSE_RELATIONS,
        order: { priority: 'ASC' },
      });

      return {
        roadmap_state: savedState,
        user_goals: toGoalResponseList(
          activeGoals,
          resolveAssetBaseUrl(this.config.get<string>('PUBLIC_ASSET_BASE_URL')),
        ),
        task_selection_reasoning: { why_not_added: '', relevant_but_premature: [] },
      };
    });
  }

  /**
   * Deletes all financial profile and roadmap data for the given user
   * within a single transaction. The User account itself is NOT touched.
   */
  async resetUserData(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserGoal, { userId });
      await manager.delete(UserProfileHistory, { userId });
      await manager.delete(UserProfile, { userId });
      await manager.delete(RoadmapState, { userId });
    });
  }
}
