/**
 * TEMPORARY DIAGNOSTICS — static "what is this data for" map.
 *
 * Hand-derived from the current code. It annotates the runtime audit output so
 * every table/column/feature printed to the terminal comes with who writes it,
 * who reads it and whether it can be dropped. Delete together with the
 * diagnostics module once the cleanup is done.
 */

export type Verdict =
  | 'ACTIVE'
  | 'WRITE-ONLY'
  | 'SEED-ONLY'
  | 'UNUSED'
  | 'UNKNOWN';

export interface TableUsage {
  entity: string;
  purpose: string;
  writtenBy: string;
  readBy: string;
  verdict: Verdict;
}

/** Keyed by Postgres table name. */
export const TABLE_USAGE: Record<string, TableUsage> = {
  users: {
    entity: 'User',
    purpose: 'Account + national ID (id) used as the Open Finance customerId',
    writtenBy: 'auth.service.register()',
    readBy:
      'auth.service.login/register, jwt.strategy.validate, open-finance-api.connectAndAnalyze',
    verdict: 'ACTIVE',
  },
  user_profiles: {
    entity: 'UserProfile',
    purpose: 'Current 8 roadmap criteria scores + risk/knowledge + currentStep',
    writtenBy:
      'open-finance.applyReconciliation, roadmap.updateRoadmap, user-profile.updateRiskTolerance',
    readBy:
      'goals.listGoals/createGoal, roadmap.getRoadmap, open-finance.loadUserContext, llm-orchestrator.classifyUserStep/personalizeGoals',
    verdict: 'ACTIVE',
  },
  user_profile_history: {
    entity: 'UserProfileHistory',
    purpose: 'Append-only log of every reconciliation (scores + LLM reasoning)',
    writtenBy: 'open-finance.applyReconciliation',
    readBy:
      'user-profile.getHistory/getLatestAndPrevious, open-finance.loadUserContext',
    verdict: 'ACTIVE',
  },
  user_aspirations: {
    entity: 'UserAspiration',
    purpose: 'User-declared long-term goals, synced into concrete tasks',
    writtenBy:
      'aspirations.service.*, aspiration-sync.service, open-finance.applyReconciliation',
    readBy:
      'aspirations.service.*, aspiration-sync.service, open-finance.loadUserContext',
    verdict: 'ACTIVE',
  },
  user_goals: {
    entity: 'UserGoal',
    purpose:
      'Concrete tasks assigned to a user from roadmap_goals templates, plus the user\u2019s "not relevant" feedback on them',
    writtenBy:
      'goals.createGoal/updateGoal/dismissGoal, open-finance.applyReconciliation, aspiration-sync',
    readBy:
      'goals.listGoals/updateGoal, open-finance.loadUserContext/applyReconciliation, llm-orchestrator.personalizeGoals (dismissal feedback)',
    verdict: 'ACTIVE',
  },
  roadmap_goals: {
    entity: 'RoadmapGoal',
    purpose: 'Goal templates per step/criteria (catalogue)',
    writtenBy: '— (seed/migration only)',
    readBy:
      'goals.listGoals/createGoal, step-isolation.guard, open-finance.analyzeBankingJson, llm-orchestrator.personalizeGoals',
    verdict: 'SEED-ONLY',
  },
  partners: {
    entity: 'Partner',
    purpose:
      'Commercial partner branding for MARKETING goals (logo, accent colour)',
    writtenBy: '— (seed/migration only)',
    readBy:
      'goals.getGoals, open-finance.analyzeBankingJson, llm-orchestrator.personalizeGoals (via roadmap_goals.offer)',
    verdict: 'SEED-ONLY',
  },
  partner_offers: {
    entity: 'PartnerOffer',
    purpose:
      'Sponsored campaigns: headline, benefit tags, affiliate CTA, disclaimer, targeting',
    writtenBy: '— (seed/migration only)',
    readBy:
      'goals.getGoals, open-finance.applyReconciliation (marketing policy gate), goal-response.mapper',
    verdict: 'SEED-ONLY',
  },
  roadmap_steps: {
    entity: 'RoadmapStep',
    purpose: 'The 8 criteria definitions per step — core LLM prompt input',
    writtenBy: '— (seed/migration only)',
    readBy:
      'roadmap.getRoadmap, open-finance.analyzeBankingJson/callLlmForProfile',
    verdict: 'SEED-ONLY',
  },
  roadmap_states: {
    entity: 'RoadmapState',
    purpose: 'Per-user progress %, narrative and loss-aversion projection',
    writtenBy: 'roadmap.updateRoadmap, open-finance.applyReconciliation',
    readBy: 'roadmap.getRoadmap, open-finance.loadUserContext',
    verdict: 'ACTIVE',
  },
  goal_type_catalog: {
    entity: 'GoalTypeCatalog',
    purpose: 'Aspiration type definitions + attribute schemas',
    writtenBy: '— (seed/migration only)',
    readBy: 'aspirations.getGoalTypes/createAspiration/syncAspirations',
    verdict: 'SEED-ONLY',
  },
  questionnaire_screens: {
    entity: 'QuestionnaireScreen',
    purpose: 'Onboarding screen definitions',
    writtenBy: '— (seed/migration only)',
    readBy: 'questionnaire.getStructure',
    verdict: 'SEED-ONLY',
  },
  questionnaire_questions: {
    entity: 'QuestionnaireQuestion',
    purpose: 'Onboarding question definitions',
    writtenBy: '— (seed/migration only)',
    readBy: 'questionnaire.getStructure/submitAnswers',
    verdict: 'SEED-ONLY',
  },
  questionnaire_options: {
    entity: 'QuestionnaireOption',
    purpose: 'Choice options per question',
    writtenBy: '— (seed/migration only)',
    readBy: 'questionnaire.submitAnswers (validation)',
    verdict: 'SEED-ONLY',
  },
  questionnaire_dependencies: {
    entity: 'QuestionnaireDependency',
    purpose: 'Conditional visibility rules between questions',
    writtenBy: '— (seed/migration only)',
    readBy: 'questionnaire.getStructure/validateAnswers',
    verdict: 'SEED-ONLY',
  },
  questionnaire_submissions: {
    entity: 'QuestionnaireSubmission',
    purpose: 'One row per onboarding submission version',
    writtenBy: 'questionnaire.submitAnswers',
    readBy:
      'questionnaire.getResponses/updateAnswers, open-finance.buildLatestSummary',
    verdict: 'ACTIVE',
  },
  questionnaire_responses: {
    entity: 'QuestionnaireResponse',
    purpose: 'The actual user answers (upserted per user+question)',
    writtenBy: 'questionnaire.submitAnswers',
    readBy:
      'questionnaire.getResponses/updateAnswers, open-finance.buildLatestSummary',
    verdict: 'ACTIVE',
  },
  financial_events: {
    entity: 'FinancialEvent',
    purpose:
      'Detected events (e.g. DEFICIT_MONTH) from features.monthlyBalances',
    writtenBy: 'event-detection.detectEvents',
    readBy:
      'event-detection.detectEvents (duplicate check) only — never surfaced to the user',
    verdict: 'WRITE-ONLY',
  },
  financial_snapshots: {
    entity: 'FinancialSnapshot',
    purpose: 'Persists only 4 of the ~40 extracted features',
    writtenBy: 'financial-analysis.persistSnapshot',
    readBy: 'financial-analysis.getLatestSnapshot',
    verdict: 'ACTIVE',
  },
  llm_guidance_logs: {
    entity: 'LlmGuidanceLog',
    purpose: 'Audit trail of LLM context + guidance',
    writtenBy: 'llm-orchestrator.persistGuidanceLog (failures swallowed)',
    readBy: '— never read',
    verdict: 'WRITE-ONLY',
  },
  bank_consents: {
    entity: 'BankConsent',
    purpose: 'Skeleton for the old bank-consent flow',
    writtenBy: '— never written',
    readBy: '— never read (repo injected in open-finance.module but unused)',
    verdict: 'UNUSED',
  },
  bank_tokens: {
    entity: 'BankToken',
    purpose: 'Skeleton for the old bank-token flow',
    writtenBy: '— never written',
    readBy: '— never read (repo injected in open-finance.module but unused)',
    verdict: 'UNUSED',
  },
};

/** Column-level notes, keyed by `table.column`. */
export const COLUMN_NOTES: Record<string, string> = {
  'user_goals.removal_reason': 'written on REMOVE, never queried back',
  'user_goals.dynamic_params': 'LLM-generated; verify it is still populated',
  'user_goals.source_profile_history_id': 'provenance only, never joined',
  'user_profile_history.previous_step':
    'written, only echoed in the response — never re-queried',
  'user_profile_history.step_changed':
    'written, only echoed in the response — never re-queried',
  'user_profile_history.progress_delta':
    'written, only echoed in the response — never re-queried',
  'user_profile_history.llm_reasoning':
    'debug text; large, never shown to the user',
  'roadmap_goals.required_context_text':
    'duplicate of required_context — check which one is used',
  'financial_snapshots.total_savings':
    'stores features.totalInvestments (savings + securities), NOT totalSavings',
  'bank_consents.status': 'dead column (unused table)',
  'bank_tokens.access_token_enc': 'dead column (unused table)',
  'bank_tokens.refresh_token_enc': 'dead column (unused table)',
};

/**
 * Every FinancialFeatures field → who consumes it.
 * Note: the whole object is JSON-serialised into the LLM prompts, so a field is
 * only truly unused when no prompt documents it either.
 */
export const FEATURE_USAGE: Record<string, string> = {
  currentBalance: 'LLM profile + state prompts',
  monthlyIncome: 'DB snapshot, LLM profile + state, loss-aversion',
  monthlyExpenses: 'DB snapshot, LLM profile + state',
  monthlyNetCashFlow: 'LLM profile prompt',
  monthlyBalances: 'event-detection (DEFICIT_MONTH), LLM profile + state',
  monthsCovered: 'LLM profile prompt',
  deficitMonthsCount: 'LLM profile + state prompts',
  avgMonthlyIncome: 'LLM profile prompt',
  avgMonthlyExpense: 'LLM profile prompt',
  totalSavings: 'LLM profile prompt',
  totalSecuritiesValue: 'LLM profile + state prompts',
  totalInvestments: 'DB snapshot (as total_savings), LLM profile + state',
  securitiesCount: 'LLM profile prompt',
  totalLoans: 'LLM profile prompt',
  totalMortgage: 'LLM profile prompt',
  totalDebt: 'DB snapshot, LLM profile + state',
  hasActiveLoans: 'LLM profile prompt',
  hasMortgage: 'LLM profile prompt',
  monthlyLoanPayments: 'LLM profile + state prompts',
  monthlyMortgagePayments: 'LLM profile + state prompts',
  loanBalance: 'LLM profile prompt',
  mortgageBalance: 'LLM profile prompt',
  loanVSaffordability: 'LLM profile prompt',
  mortgageVSaffordability: 'LLM profile prompt',
  savingsAndSecuritiesBalance: 'LLM state prompt',
  monthlyDeposits: 'loss-aversion (IdleSurplusStrategy), LLM profile',
  monthlyWithdrawals: 'LLM profile prompt (documented in the features legend)',
  avgBalanceLast3Month:
    'LLM profile prompt (documented in the features legend)',
  activeCreditCardsCount: 'LLM profile + state prompts',
  avgMonthlyCreditCardSpend: 'LLM profile prompt',
  creditCardFeesTotal: 'LLM profile prompt',
  // PARKED with the overdraft feature:
  // overdraftLimit: 'LLM profile prompt (credit_consumption / cash_flow)',
  // overdraftUsed: 'LLM profile prompt (credit_consumption / cash_flow)',
  // overdraftUtilisation: 'LLM profile prompt (credit_consumption / cash_flow)',
  savingsRate: 'LLM profile prompt',
  discretionarySurplus: 'LLM profile + state, loss-aversion',
  systemFlags: 'LLM profile prompt (BDI counters)',
  systemFlagsAvailable:
    'LLM profile + state prompts — guards against reading absent counters as a clean record',
  hasData: 'loss-aversion gate',
};

/**
 * Fields where a falsy value is a real reading, not a missing mapping.
 * `hasActiveLoans: false` means "no loans"; `systemFlagsAvailable: false`
 * means "counters unknown" — neither indicates broken extraction.
 */
export const MEANINGFUL_WHEN_FALSY = new Set([
  'systemFlagsAvailable',
  'hasData',
  'hasActiveLoans',
  'hasMortgage',
  // PARKED with the overdraft feature:
  // 'overdraftUsed',
  // 'overdraftUtilisation',
  'deficitMonthsCount',
  'loanVSaffordability',
  'mortgageVSaffordability',
]);

/**
 * Top-level fields our types expect from each Open Finance endpoint. Used to
 * detect provider-side schema drift (expected-but-absent / new-and-unmapped).
 */
export const OF_EXPECTED_FIELDS: Record<string, string[]> = {
  '/v2/data/accounts': [
    'id',
    'userId',
    'psuId',
    'providerId',
    'connectionId',
    'status',
    'accountNumber',
    'product',
    'parsedAccount',
    'accountType',
    'creditStatus',
    'currency',
    'accountName',
    'ownerInfo',
    'balances',
    'interest',
    'relatedDates',
    'usage',
    'creditLimit',
    'creditLimitInterestRate',
    'transactions',
    'applicableFees',
    'securityPositions',
    'securityOrders',
    'details',
    'loanType',
  ],
  '/v2/data/transactions': [
    'id',
    'SK',
    'userId',
    'connectionId',
    'accountId',
    'providerId',
    'accountNumber',
    'status',
    'amount',
    'description',
    'category',
    'changedCategory',
    'classification',
    'type',
    'date',
    'balancePerEndDay',
  ],
  '/v2/data/balances/history': [
    'accountId',
    'currency',
    'fromDate',
    'toDate',
    'count',
    'items',
  ],
};

/** Which aggregator/extractor output each raw endpoint feeds. */
export const OF_ENDPOINT_PURPOSE: Record<string, string> = {
  '/v2/data/accounts':
    'balances -> currentBalance/totalSavings; securityPositions -> securities; LOAN accounts -> loans/mortgage; CARD accounts -> credit-card counts',
  '/v2/data/transactions':
    'yearMonthBalance (income/expense per month), loan+mortgage repayments, card spend, savings deposits/withdrawals',
  '/v2/data/balances/history':
    'month-end balances -> yearMonthBalance.balance and avgBalanceLast3Month',
};
