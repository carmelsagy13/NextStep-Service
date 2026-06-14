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

  // ── Credit cards ──────────────────────────────────────────────────────────
  /** Distinct credit-card accounts seen in creditCardOutcomes. */
  activeCreditCardsCount: number;
  /** Average monthly spend across all cards over the reported window. */
  avgMonthlyCreditCardSpend: number;
  /** Σ of avgCardFee across cards (nulls treated as 0). */
  creditCardFeesTotal: number;

  // ── Derived ratios ────────────────────────────────────────────────────────
  /** % of monthly income directed to savings/investments contributions. */
  savingsRate: number;
  /** monthlyIncome - monthlyExpenses (provider already nets debt into expenses). */
  discretionarySurplus: number;

  // ── System / BDI indicators (counts; null in report → 0) ─────────────────
  systemFlags: {
    loanOverDueCount: number;
    foreclosureCount: number;
    alertNoticeCount: number;
    akamCount: number;
    cancelledCount: number;
  };

  // ── Provenance ────────────────────────────────────────────────────────────
  /** Whether the report actually contained any usable financial data. */
  hasData: boolean;
}
