/**
 * Deterministic, structured projection of a user's financial position, computed
 * from the aggregated Open Finance `financialReport` by the extractor.
 *
 * Every field is traceable to a concrete source field in the report (or a
 * derivation of such fields) — no inferred business rules. This is the single
 * object the rest of the pipeline consumes: it feeds the LLM prompts, the
 * FinancialSnapshot persistence and the FinancialEvent detection.
 *
 * All monetary values are in ILS and rounded to whole shekels.
 */

/** A per-month income/expense pair derived from `yearMonthBalance[]`. */
export interface MonthlyBalance {
  /** Provider month label, e.g. "26-05". */
  yearMonth: string;
  income: number;
  expense: number;
  /** income - expense for the month. */
  net: number;
}

export interface FinancialFeatures {
  // ── Liquidity ───────────────────────────────────────────────────────────
  /** Σ of all ILS checking-account balances. */
  currentBalance: number;

  // ── Monthly cash flow (from totalIncomesOutcome) ─────────────────────────
  monthlyIncome: number;
  monthlyExpenses: number;
  /** Provider-reported net (income - expenses) per month. */
  monthlyNetCashFlow: number;

  // ── Multi-month history (from yearMonthBalance) ──────────────────────────
  monthlyBalances: MonthlyBalance[];
  monthsCovered: number;
  /** Months in the window where expense exceeded income. */
  deficitMonthsCount: number;
  avgMonthlyIncome: number;
  avgMonthlyExpense: number;

  // ── Savings & investments ────────────────────────────────────────────────
  totalSavings: number;
  totalSecuritiesValue: number;
  /** totalSavings + totalSecuritiesValue. */
  totalInvestments: number;
  securitiesCount: number;

  // ── Debt ─────────────────────────────────────────────────────────────────
  totalLoans: number;
  totalMortgage: number;
  /** totalLoans + totalMortgage. */
  totalDebt: number;
  hasActiveLoans: boolean;
  hasMortgage: boolean;

  // ── Macro debt-service & flow metrics (consumer loans vs mortgage kept apart)
  /** Avg monthly CONSUMER-loan repayment: Σ|loan tx chargedAmount<0, mainCategory=LOANS| / 3. */
  monthlyLoanPayments: number;
  /** Avg monthly MORTGAGE repayment: Σ|loan tx chargedAmount<0, mainCategory=MORTGAGE| / 3. */
  monthlyMortgagePayments: number;
  /** Outstanding consumer-loan balance (maps to loansTotal.totalLoansAmount). */
  loanBalance: number;
  /** Outstanding mortgage balance (maps to loansTotal.totalMortgageAmount). */
  mortgageBalance: number;
  /**
   * Consumer-loan affordability: monthlyLoanPayments / discretionarySurplus.
   * Higher = larger share of disposable income consumed. 0 when no payment;
   * 99 sentinel when payments exist but surplus is non-positive (unaffordable).
   */
  loanVSaffordability: number;
  /** Mortgage affordability: monthlyMortgagePayments / discretionarySurplus (same scale/sentinel). */
  mortgageVSaffordability: number;

  // ── Savings/securities balance & flows ───────────────────────────────────
  /** Σ(savings[].amount) + totalSecuritiesValue. */
  savingsAndSecuritiesBalance: number;
  /** Avg monthly inflow to savings/securities: (Σ positive savingsTransactions + Σ securitiesAddition) / 3. */
  monthlyDeposits: number;
  /** Avg monthly outflow from savings: Σ|negative savingsTransactions| / 3. */
  monthlyWithdrawals: number;
  /** Mean balance across the last 3 yearMonthBalance entries (falls back to currentBalance). */
  avgBalanceLast3Month: number;

  // ── Credit cards ──────────────────────────────────────────────────────────
  /** Distinct credit-card accounts seen in creditCardOutcomes. */
  activeCreditCardsCount: number;
  /** Average monthly spend across all cards over the reported window. */
  avgMonthlyCreditCardSpend: number;
  /** Σ of avgCardFee across cards (nulls treated as 0). */
  creditCardFeesTotal: number;
  // ── Overdraft facility (checking accounts) ────────────────────────────
  /** Σ approved overdraft limits across checking accounts. */
  overdraftLimit: number;
  /** How much of the overdraft is actually drawn (Σ negative checking balances). */
  overdraftUsed: number;
  /** overdraftUsed / overdraftLimit as a percentage; 0 when no facility exists. */
  overdraftUtilisation: number;
  // ── Derived ratios ────────────────────────────────────────────────────────
  /** % of monthly income directed to savings/investments contributions. */
  savingsRate: number;
  /**
   * monthlyIncome - monthlyExpenses. Disposable surplus BEFORE debt service:
   * loan and mortgage repayments are excluded from monthlyExpenses and modelled
   * separately as monthlyLoanPayments / monthlyMortgagePayments.
   */
  discretionarySurplus: number;

  // ── System / BDI indicators (counts; null in report → 0) ─────────────────
  systemFlags: {
    loanOverDueCount: number;
    foreclosureCount: number;
    alertNoticeCount: number;
    akamCount: number;
    cancelledCount: number;
  };
  /**
   * False when no source supplied the behavioural counters. The zeros in
   * `systemFlags` are then placeholders, NOT evidence of a clean credit record.
   */
  systemFlagsAvailable: boolean;

  // ── Provenance ────────────────────────────────────────────────────────────
  /** Whether the report actually contained any usable financial data. */
  hasData: boolean;
}
