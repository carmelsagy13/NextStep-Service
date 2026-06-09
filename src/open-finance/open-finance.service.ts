import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BankConsent } from '../database/entities/bank-consent.entity.js';
import { BankToken } from '../database/entities/bank-token.entity.js';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { RoadmapState } from '../database/entities/roadmap-state.entity.js';
import {
  UserGoal,
  UserGoalStatus,
} from '../database/entities/user-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { UserProfileHistory } from '../database/entities/user-profile-history.entity.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

export interface AiCriteriaProfile {
  current_step: number;
  cash_flow: number;
  credit_consumption: number;
  loans: number;
  savings_investments: number;
  pension_long_term: number;
  lifestyle_clubs: number;
  mortgage: number;
  system_indicators: number;
  age: number | null;
  risk_level: string | null;
  knowledge_level: string | null;
  occupation: string | null;
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
  user_goals: UserGoal[];
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
    add: Array<{
      roadmap_goal_id: string;
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
}

@Injectable()
export class OpenFinanceService {
  private readonly gemini: GoogleGenerativeAI;
  private readonly groq: Groq;
  private readonly geminiModel: string;
  private readonly groqModel: string;

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
    private readonly dataSource: DataSource,
  ) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured',
      );
    }
    this.gemini = new GoogleGenerativeAI(geminiKey);
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      throw new InternalServerErrorException('GROQ_API_KEY is not configured');
    }
    this.groq = new Groq({ apiKey: groqKey });
    this.groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }

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
    const __t0 = Date.now();
    console.log(
      `[TIMING] analyzeBankingJson START — ${new Date(__t0).toISOString()}`,
    );
    // 1. Fetch stage definitions and active goal templates from the DB in parallel.
    const [stages, goalTemplates] = await Promise.all([
      this.stepRepo.find({ order: { stepId: 'ASC' } }),
      this.roadmapGoalRepo.find({
        where: { isActive: true },
        order: { stepId: 'ASC', priority: 'ASC' },
      }),
    ]);

    if (!stages.length) {
      throw new InternalServerErrorException(
        'No roadmap steps found in the database. Please seed the roadmap_steps table.',
      );
    }

    // 2. Deterministic preprocessing — token diet.
    const summaryJson = this.preprocessBankingData(bankingData);

    // 2b. Load the user's existing state & task history in PARALLEL with the LLM
    //     calls. It is only consumed by the reconciliation step, so there is no
    //     reason to block the model round-trip on this DB read.
    const contextPromise = this.loadUserContext(userId);

    // 3. Single LLM round-trip. The focused profile classification runs in
    //    parallel with a MERGED state-determination + reconciliation call. This
    //    collapses the previous two sequential waves (state → reconciliation)
    //    into one, roughly halving the model latency that dominates the request.
    const [userProfile, { roadmapState, decision }] = await Promise.all([
      this.callGroqForProfile(summaryJson, stages),
      contextPromise.then((ctx) =>
        this.callLlmForStateAndReconciliation(
          summaryJson,
          stages,
          goalTemplates,
          ctx,
        ),
      ),
    ]);

    const currentStep = roadmapState.current_step;
    const context = await contextPromise;

    // 4. Persist the reconciliation result (non-destructive) within a transaction.
    const clientResponse = await this.applyReconciliation({
      userId,
      currentStep,
      roadmapState,
      userProfile: this.normalizeCriteriaProfile(userProfile),
      decision,
      goalTemplates,
      context,
    });

    console.log(
      '[AI] Response sent to client:',
      JSON.stringify(clientResponse, null, 2),
    );

    const __elapsed = Date.now() - __t0;
    console.log(
      `[TIMING] analyzeBankingJson END — took ${__elapsed} ms (${(__elapsed / 1000).toFixed(2)} s)`,
    );

    return clientResponse;
  }

  // ─── TASK 1: Deterministic Data Aggregation ────────────────────────────────

  private preprocessBankingData(rawData: unknown): string {
    if (
      rawData == null ||
      (typeof rawData === 'object' &&
        !Array.isArray(rawData) &&
        Object.keys(rawData as object).length === 0)
    ) {
      return JSON.stringify({
        metrics: {
          totalMonthlyIncome: 0,
          totalMonthlyExpenses: 0,
          totalMonthlySavingsInvestments: 0,
          totalMonthlyDebtPayments: 0,
          netCashFlow: 0,
          discretionarySurplus: 0,
          savingsRate: 0,
          currentBalance: 0,
        },
        aggregatedCategories: [],
        highImpactTransactions: [],
      });
    }

    const data = rawData as Record<string, any>;
    const transactions: Array<Record<string, any>> = Array.isArray(
      data.transactions,
    )
      ? data.transactions
      : Array.isArray(data)
        ? (data as any[])
        : [];

    // Calculate financial metrics
    let totalMonthlyIncome = 0;
    let totalMonthlyExpenses = 0;
    // Money intentionally directed toward wealth-building (NOT a living cost).
    let totalMonthlySavingsInvestments = 0;
    // Loan / mortgage repayments (debt servicing, tracked separately).
    let totalMonthlyDebtPayments = 0;
    const currentBalance: number =
      typeof data.balance === 'number'
        ? data.balance
        : typeof data.currentBalance === 'number'
          ? data.currentBalance
          : 0;

    // Outflows that build net worth rather than consume it — these must NOT be
    // counted as expenses, otherwise a disciplined investor looks cash-negative.
    const SAVINGS_INVEST_KEYWORDS =
      /invest|pension|saving|provident|gemel|securities|stock|etf|fund|deposit|השקע|פנסי|חיסכו|חסכו|גמל|השתלמות|ניירות ערך|מניות|קרן סל|קרן נאמנות|פיקדון|חיסכון/i;
    // Debt servicing — informative but distinct from discretionary spending.
    const DEBT_KEYWORDS =
      /loan|mortgage|repayment|הלוואה|משכנתא|החזר הלוואה|החזר משכנתא/i;
    const HIGH_IMPACT_KEYWORDS =
      /loan|הלוואה|mortgage|משכנתא|overdraft|מינוס|עמלה|invest|השקע|pension|פנסי|גמל|השתלמות/i;
    const HIGH_AMOUNT_THRESHOLD = 1000;

    const highImpactTransactions: Array<Record<string, any>> = [];
    const categoryBuckets = new Map<string, { sum: number; count: number }>();

    for (const tx of transactions) {
      const amount =
        typeof tx.amount === 'number' ? tx.amount : Number(tx.amount) || 0;
      const absAmount = Math.abs(amount);
      const description: string = tx.description ?? tx.memo ?? tx.name ?? '';
      const category: string = tx.category ?? tx.type ?? 'uncategorized';
      const haystack = `${category} ${description}`;

      // Income vs outflow classification. Outflows are split into three buckets
      // so the LLM can tell consumption apart from wealth-building and debt.
      if (amount > 0) {
        totalMonthlyIncome += amount;
      } else if (SAVINGS_INVEST_KEYWORDS.test(haystack)) {
        totalMonthlySavingsInvestments += absAmount;
      } else if (DEBT_KEYWORDS.test(haystack)) {
        totalMonthlyDebtPayments += absAmount;
      } else {
        totalMonthlyExpenses += absAmount;
      }

      // High-impact retention: keep raw if amount > threshold or keyword match
      const isHighAmount = absAmount > HIGH_AMOUNT_THRESHOLD;
      const isKeywordMatch =
        HIGH_IMPACT_KEYWORDS.test(description) ||
        HIGH_IMPACT_KEYWORDS.test(category);

      if (isHighAmount || isKeywordMatch) {
        highImpactTransactions.push(tx);
      } else {
        // Aggregate low-value transactions by category
        const bucket = categoryBuckets.get(category);
        if (bucket) {
          bucket.sum += absAmount;
          bucket.count += 1;
        } else {
          categoryBuckets.set(category, { sum: absAmount, count: 1 });
        }
      }
    }

    // Format aggregated categories
    const aggregatedCategories: string[] = [];
    for (const [cat, { sum, count }] of categoryBuckets) {
      aggregatedCategories.push(
        `${cat}: ${Math.round(sum)} ILS across ${count} transactions`,
      );
    }

    // Derived health indicators.
    // discretionarySurplus = what's left after living costs + debt, BEFORE voluntary
    //   saving/investing. Positive here means the user can afford to build wealth.
    // netCashFlow = actual change in liquid cash after everything (incl. investing).
    //   It can be negative for a healthy investor who deploys their surplus.
    const discretionarySurplus =
      totalMonthlyIncome - totalMonthlyExpenses - totalMonthlyDebtPayments;
    const netCashFlow = discretionarySurplus - totalMonthlySavingsInvestments;
    const savingsRate =
      totalMonthlyIncome > 0
        ? Math.round(
            (totalMonthlySavingsInvestments / totalMonthlyIncome) * 100,
          )
        : 0;

    const summary = {
      metrics: {
        totalMonthlyIncome: Math.round(totalMonthlyIncome),
        totalMonthlyExpenses: Math.round(totalMonthlyExpenses),
        totalMonthlySavingsInvestments: Math.round(
          totalMonthlySavingsInvestments,
        ),
        totalMonthlyDebtPayments: Math.round(totalMonthlyDebtPayments),
        netCashFlow: Math.round(netCashFlow),
        discretionarySurplus: Math.round(discretionarySurplus),
        savingsRate,
        currentBalance: Math.round(currentBalance),
      },
      aggregatedCategories,
      highImpactTransactions,
    };

    return JSON.stringify(summary);
  }

  // ─── TASK 2 & 3: 2-Wave Groq Pipeline with Validation ─────────────────────

  private static readonly STRICT_JSON_SUFFIX =
    'IMPORTANT: Return raw JSON only. Do NOT wrap output in markdown code blocks (```json ... ```), do NOT output preamble or postscript text. Ensure all Hebrew text strings are cleanly escaped as valid UTF-8.';

  private async callGroqForProfile(
    summaryJson: string,
    stages: RoadmapStep[],
  ): Promise<AiCriteriaProfile> {
    const criteriaByStageSection = stages
      .map((s) =>
        [
          `### Stage ${s.stepId} – ${s.title}`,
          s.criteria
            ? JSON.stringify(s.criteria, null, 2)
            : '  (no criteria defined)',
        ].join('\n'),
      )
      .join('\n\n');

    const systemPrompt = [
      'You are an expert Israeli financial analyst.',
      'Evaluate the user financial summary below and return a JSON object representing their profile.',
      '',
      '## How to read the metrics block',
      '- totalMonthlyIncome: all incoming money (salary, dividends, interest).',
      '- totalMonthlyExpenses: TRUE living/consumption costs only (rent, groceries, utilities, leisure).',
      '- totalMonthlySavingsInvestments: money the user DELIBERATELY moves into wealth-building (investments, pension, provident funds, savings). This is a STRENGTH, never a deficit or a problem.',
      '- totalMonthlyDebtPayments: loan/mortgage servicing.',
      '- discretionarySurplus = income - expenses - debt. This is the real cash-flow health signal: POSITIVE means the user lives within their means and can build wealth.',
      '- netCashFlow = discretionarySurplus - savingsInvestments. A NEGATIVE netCashFlow combined with a POSITIVE discretionarySurplus is HEALTHY — it means the user is investing their surplus, not overspending. Do NOT treat this as financial distress.',
      '- savingsRate: % of income directed to savings/investments. Higher = more advanced.',
      'Judge cash_flow on discretionarySurplus (and expenses vs income), NOT on netCashFlow. Reward high savingsRate and active investing/pension when scoring savings_investments and pension_long_term.',
      '',
      '## 8 Granular Financial Criteria — Stage Definitions',
      criteriaByStageSection,
      '',
      '## Demographic Extraction',
      '- age: integer (null if not determinable)',
      '- occupation: string in Hebrew (null if not determinable)',
      '- risk_level: one of "low" | "medium" | "high"',
      '- knowledge_level: one of "beginner" | "intermediate" | "advanced"',
      '',
      '## Required Output Schema (flat JSON object):',
      JSON.stringify({
        current_step: '<integer 1–5, weighted synthesis>',
        cash_flow: '<integer 1–5>',
        credit_consumption: '<integer 1–5>',
        loans: '<integer 1–5>',
        savings_investments: '<integer 1–5>',
        pension_long_term: '<integer 1–5>',
        lifestyle_clubs: '<integer 1–5>',
        mortgage: '<integer 1–5>',
        system_indicators: '<integer 1–5>',
        age: '<integer or null>',
        risk_level: '<string or null>',
        knowledge_level: '<string or null>',
        occupation: '<Hebrew string or null>',
      }),
      '',
      OpenFinanceService.STRICT_JSON_SUFFIX,
    ].join('\n');

    const rawText = await this.executeLlmCall(
      systemPrompt,
      summaryJson,
      'profile',
    );
    return this.parseGroqResponse<AiCriteriaProfile>(rawText, 'profile');
  }

  /**
   * Loads the user's current profile, roadmap state, existing tasks (all
   * lifecycle states) and recent assessment history so the reconciliation LLM
   * call can reason about progression rather than recomputing from scratch.
   */
  private async loadUserContext(
    userId: string,
  ): Promise<UserReconciliationContext> {
    const [currentProfile, currentState, existingTasks, history] =
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
      ]);

    return { currentProfile, currentState, existingTasks, history };
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
  ): Promise<{
    roadmapState: GeminiAnalysisResult['roadmap_state'];
    decision: ReconciliationDecision;
  }> {
    const stagesSection = stages
      .map((s) => {
        const detail = s.description ?? JSON.stringify(s.criteria ?? {});
        return `  Stage ${s.stepId} – ${s.title}: ${detail}`;
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
                  `    title: "${g.title}"`,
                  `    description_template: "${g.descriptionTemplate}"`,
                  g.requiredContext
                    ? `    required_context: "${g.requiredContext}"`
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
              t.roadmapGoalId
                ? `    roadmap_goal_id: "${t.roadmapGoalId}"`
                : null,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n')
      : '  (user has no existing tasks — this is a first assessment)';

    const priorStep = context.currentState?.currentStepId ?? null;
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
      '## How to read the metrics block',
      '- totalMonthlyExpenses is TRUE living costs only. Money in totalMonthlySavingsInvestments (investments, pension, savings) is wealth-building, NOT spending.',
      '- discretionarySurplus = income - expenses - debt. POSITIVE = healthy cash flow. Judge cash flow on THIS, not on netCashFlow.',
      '- A NEGATIVE netCashFlow with a POSITIVE discretionarySurplus is HEALTHY: the user is deploying surplus into wealth-building. NEVER classify such a user as Stage 1 and NEVER describe it as a "negative cash flow" or deficit.',
      '- Active investing + pension + high savingsRate point toward the HIGHER stages (4–5).',
      '',
      '## Financial Stage Definitions',
      stagesSection,
      '',
      'The user already has a profile, a pyramid level and a set of tasks. Do NOT',
      'rebuild from scratch. Compare the NEW financial summary against the existing',
      'tasks and history, then return an ID-based reconciliation diff.',
      '',
      '## Reconciliation Rules',
      '- FIRST set roadmap_state.current_step, then ONLY add goals whose step matches that current_step (the task bank below is grouped by step).',
      '- Reference existing tasks ONLY by their user_goal_id.',
      "- Reference new tasks ONLY by a roadmap_goal_id taken from the determined step's Available Goal Templates.",
      '- NEVER invent IDs. NEVER duplicate an existing task: if a relevant goal template',
      '  is already present among the existing tasks, KEEP or REPRIORITIZE it instead of adding it.',
      '- Put tasks that are no longer relevant (e.g. left over from a previous step) into "remove".',
      '- Put tasks the data shows are achieved into "complete".',
      '- Only "add" templates that are genuinely relevant and not already assigned.',
      '',
      `## User's Current Pyramid Level: ${priorStep ?? 'unknown'} (progress ${priorProgress ?? 0}%)`,
      '',
      '## Previous Assessments (abstracted — no raw financial data)',
      historySection,
      '',
      '## Existing Tasks',
      existingTasksSection,
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
          add: [
            {
              roadmap_goal_id: "<UUID from the determined step's task bank>",
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
      }),
      '',
      OpenFinanceService.STRICT_JSON_SUFFIX,
    ].join('\n');

    const rawText = await this.executeLlmCall(
      systemPrompt,
      summaryJson,
      'state+reconciliation',
    );
    const parsed = this.parseGroqResponse<any>(rawText, 'state+reconciliation');

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
    return {
      task_reconciliation: {
        keep: arr(tr.keep),
        remove: arr(tr.remove),
        reprioritize: arr(tr.reprioritize),
        complete: arr(tr.complete),
        add: arr(tr.add),
      },
      progress_assessment: {
        meaningful_progress: Boolean(
          raw?.progress_assessment?.meaningful_progress,
        ),
        summary: raw?.progress_assessment?.summary ?? '',
      },
    };
  }

  // ─── Shared Groq Execution & Validation Helpers ────────────────────────────

  private async executeLlmCall(
    systemPrompt: string,
    userContent: string,
    label: string,
  ): Promise<string> {
    const __t0 = Date.now();
    console.log(`[TIMING] LLM call "${label}" START`);

    // USE_GROQ=true makes Groq the primary provider; otherwise Gemini is.
    // Whichever is primary, the OTHER acts as an automatic fallback so a single
    // provider's outage (e.g. Gemini free-tier 503 "high demand") does not fail
    // the whole request. Disable the fallback with LLM_FALLBACK=false.
    const groqPrimary = process.env.USE_GROQ === 'true';
    const fallbackEnabled = process.env.LLM_FALLBACK !== 'false';

    const gemini = {
      name: 'gemini',
      run: () => this.executeGeminiCall(systemPrompt, userContent, label),
    };
    const groq = {
      name: 'groq',
      run: () => this.executeGroqCall(systemPrompt, userContent, label),
    };
    const primary = groqPrimary ? groq : gemini;
    const secondary = groqPrimary ? gemini : groq;

    try {
      const result = await primary.run();
      console.log(
        `[TIMING] LLM call "${label}" END — took ${Date.now() - __t0} ms (${primary.name})`,
      );
      return result;
    } catch (primaryErr: any) {
      if (!fallbackEnabled) {
        throw primaryErr;
      }
      console.warn(
        `[AI] Primary provider "${primary.name}" failed for "${label}" — ` +
          `falling back to "${secondary.name}": ${primaryErr?.message?.slice(0, 160)}`,
      );
      try {
        const result = await secondary.run();
        console.log(
          `[TIMING] LLM call "${label}" END — took ${Date.now() - __t0} ms ` +
            `(${secondary.name}, fallback)`,
        );
        return result;
      } catch (secondaryErr: any) {
        console.error(
          `--- LLM call "${label}" failed on BOTH providers ---`,
          `primary(${primary.name})=${primaryErr?.message}; ` +
            `fallback(${secondary.name})=${secondaryErr?.message}`,
        );
        throw new InternalServerErrorException(
          `LLM ${label} failed on both providers — ` +
            `${primary.name}: ${primaryErr?.message}; ` +
            `${secondary.name}: ${secondaryErr?.message}`,
        );
      }
    }
  }

  private async executeGeminiCall(
    systemPrompt: string,
    userContent: string,
    label: string,
  ): Promise<string> {
    const model = this.gemini.getGenerativeModel({
      model: this.geminiModel,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        // Disable "thinking" on 2.5 models. These are structured-JSON
        // classification tasks with explicit rules — extended reasoning adds
        // ~20s of latency and burns free-tier token quota (more 429/503s) for
        // no quality gain. thinkingBudget:0 is free; it does NOT enable billing.
        // The field is forwarded by the SDK even though its v0.24 types omit it.
        thinkingConfig: { thinkingBudget: 0 },
      } as any,
    });
    const prompt = `${systemPrompt}\n\n${userContent}`;

    // 503 ("high demand") and 429/500 are transient server-side conditions, not
    // bugs. Retry a few times with exponential backoff + jitter so a brief
    // Gemini spike self-heals. We keep this SHORT (3 attempts ≈ 1s+2s waits)
    // because executeLlmCall falls back to the other provider (Groq) once this
    // throws — better to hand off quickly than burn ~60s retrying one provider.
    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 1_000;
    const MAX_DELAY_MS = 30_000;

    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const rawText = (await result.response).text();
        console.log(`[AI] Gemini (${label}) raw response:`, rawText);
        return rawText;
      } catch (err: any) {
        lastErr = err;
        const msg: string = err?.message ?? '';
        const isTransient =
          /\b(503|500|429)\b|overloaded|high demand|UNAVAILABLE|Too Many Requests/i.test(
            msg,
          );

        if (!isTransient || attempt === MAX_ATTEMPTS) {
          break;
        }

        // Prefer the server-suggested retry delay when present, else backoff.
        const suggested = this.parseRetryDelayMs(msg);
        const backoff = Math.min(
          BASE_DELAY_MS * 2 ** (attempt - 1),
          MAX_DELAY_MS,
        );
        const jitter = Math.floor(Math.random() * 500);
        const delay = (suggested ?? backoff) + jitter;

        console.warn(
          `[AI] Gemini (${label}) transient error (attempt ${attempt}/${MAX_ATTEMPTS}). ` +
            `Retrying in ${delay}ms — ${msg.slice(0, 120)}`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    console.error(`--- Gemini (${label}) Error ---`, lastErr?.message);
    throw new InternalServerErrorException(
      `Gemini ${label} analysis failed: ${lastErr?.message}`,
    );
  }

  /** Extracts Google's suggested retry delay (e.g. "Please retry in 49.4s") in ms. */
  private parseRetryDelayMs(message: string): number | undefined {
    // Matches "retryDelay":"49s" or "retry in 49.41226617s"
    const match = message.match(/retry(?:Delay)?["\s:]*?(\d+(?:\.\d+)?)s/i);
    if (!match) return undefined;
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds)) return undefined;
    // Cap so a long server hint (e.g. daily quota) doesn't hang the request.
    return Math.min(Math.ceil(seconds * 1000), 30_000);
  }

  private async executeGroqCall(
    systemPrompt: string,
    userContent: string,
    label: string,
  ): Promise<string> {
    try {
      const completion = await this.groq.chat.completions.create({
        model: this.groqModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 3000,
      });

      const rawText = completion.choices[0]?.message?.content ?? '';
      console.log(`[AI] Groq (${label}) raw response:`, rawText);
      return rawText;
    } catch (err: any) {
      console.error(`--- Groq (${label}) Error ---`, err.message);
      throw new InternalServerErrorException(
        `Groq ${label} analysis failed: ${err.message}`,
      );
    }
  }

  private parseGroqResponse<T>(rawText: string, label: string): T {
    // First attempt: direct parse
    try {
      return JSON.parse(rawText) as T;
    } catch {
      // Fallback: strip markdown wrappers and retry
    }

    const sanitized = this.sanitizeLlmJson(rawText);
    try {
      return JSON.parse(sanitized) as T;
    } catch (err: any) {
      throw new InternalServerErrorException(
        `Failed to parse Groq (${label}) response as JSON after sanitization. ` +
          `Raw (first 500 chars): ${rawText.slice(0, 500)}`,
      );
    }
  }

  private sanitizeLlmJson(raw: string): string {
    // Strip markdown code fences: ```json ... ``` or ``` ... ```
    let cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '');
    // Remove any leading/trailing non-JSON characters (preamble/postscript)
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    const start =
      firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
        ? firstBrace
        : firstBracket;
    if (start > 0) {
      cleaned = cleaned.slice(start);
    }
    // Find last closing brace/bracket
    const lastBrace = cleaned.lastIndexOf('}');
    const lastBracket = cleaned.lastIndexOf(']');
    const end = lastBrace > lastBracket ? lastBrace : lastBracket;
    if (end >= 0 && end < cleaned.length - 1) {
      cleaned = cleaned.slice(0, end + 1);
    }
    return cleaned.trim();
  }

  /** Coerce all integer criteria fields to numbers, clamp to 1–5, and keep strings as strings. */
  private normalizeCriteriaProfile(raw: any): AiCriteriaProfile {
    const clamp = (v: any) => Math.min(5, Math.max(1, Number(v) || 1));
    return {
      current_step: clamp(raw?.current_step),
      cash_flow: clamp(raw?.cash_flow),
      credit_consumption: clamp(raw?.credit_consumption),
      loans: clamp(raw?.loans),
      savings_investments: clamp(raw?.savings_investments),
      pension_long_term: clamp(raw?.pension_long_term),
      lifestyle_clubs: clamp(raw?.lifestyle_clubs),
      mortgage: clamp(raw?.mortgage),
      system_indicators: clamp(raw?.system_indicators),
      age: raw?.age != null ? Number(raw.age) || null : null,
      risk_level: raw?.risk_level ?? null,
      knowledge_level: raw?.knowledge_level ?? null,
      occupation: raw?.occupation ?? null,
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
  }): Promise<PersistAnalysisResult> {
    const { userId, currentStep, decision } = params;
    const p = params.userProfile;
    const templateMap = new Map(params.goalTemplates.map((g) => [g.goalId, g]));
    const allowedAddIds = new Set(
      params.goalTemplates
        .filter((g) => g.stepId === currentStep)
        .map((g) => g.goalId),
    );

    const priorStep = params.context.currentState?.currentStepId ?? null;
    const priorProgress = params.context.currentState?.progressPercent ?? null;
    const newProgress = params.roadmapState.progress_percentage;

    return this.dataSource.transaction(async (manager) => {
      const now = new Date();

      // --- Upsert RoadmapState (current projection) ---
      let state = await manager.findOne(RoadmapState, { where: { userId } });
      if (!state) {
        state = manager.create(RoadmapState, { userId });
      }
      state.currentStepId = currentStep;
      state.progressPercent = newProgress;
      state.stateDescription = params.roadmapState.state_description;
      const savedState = await manager.save(RoadmapState, state);

      // --- Upsert UserProfile with 8 granular criteria + demographics ---
      let profile = await manager.findOne(UserProfile, { where: { userId } });
      if (!profile) {
        profile = manager.create(UserProfile, { userId });
      }
      profile.currentStep = p.current_step;
      profile.cashFlow = p.cash_flow;
      profile.creditConsumption = p.credit_consumption;
      profile.loans = p.loans;
      profile.savingsInvestments = p.savings_investments;
      profile.pensionLongTerm = p.pension_long_term;
      profile.lifestyleClubs = p.lifestyle_clubs;
      profile.mortgage = p.mortgage;
      profile.systemIndicators = p.system_indicators;
      if (p.age !== null) profile.age = p.age;
      if (p.risk_level !== null) profile.riskTolerance = p.risk_level;
      if (p.knowledge_level !== null)
        profile.knowledgeLevel = p.knowledge_level;
      if (p.occupation !== null) profile.occupation = p.occupation;
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

      // Additions (dedup + reactivate to preserve identity, never duplicate)
      for (const a of decision.task_reconciliation.add) {
        if (!allowedAddIds.has(a.roadmap_goal_id)) continue; // out-of-step / hallucinated id guard
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
          touched.add(dup);
        } else {
          const template = templateMap.get(a.roadmap_goal_id);
          const created = manager.create(UserGoal, {
            userId,
            roadmapGoalId: a.roadmap_goal_id,
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
          touched.add(created);
        }
      }

      if (touched.size) {
        await manager.save(UserGoal, Array.from(touched));
      }

      // Return the user's currently active tasks with their templates populated.
      const activeGoals = await manager.find(UserGoal, {
        where: { userId, status: UserGoalStatus.ACTIVE },
        relations: ['roadmapGoal'],
        order: { priority: 'ASC' },
      });

      return { roadmap_state: savedState, user_goals: activeGoals };
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
