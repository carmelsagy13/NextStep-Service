/**
 * Type definitions mirroring the REAL aggregated Open Finance `financialReport`
 * payload (see carmelsData.json for a representative sample).
 *
 * These intentionally describe the payload that the provider actually returns —
 * an aggregated report, NOT a flat transactions list. Every field is optional
 * because the provider omits empty sections, so the extractor must defend
 * against missing/partial data.
 */

/** A checking-account balance entry (`checkingAccountsILS[]` / `checkingAccounts[]`). */
export interface OFCheckingAccount {
  customerId?: string;
  amount?: number;
  providerId?: string;
  accountNumber?: string;
  accountId?: string;
  currency?: string;
}

/** A single month's income/expense roll-up (`yearMonthBalance[]`). */
export interface OFYearMonthBalance {
  yearMonth?: string;
  sumIncome?: number;
  sumExpense?: number;
  /**
   * Closing/period balance for the month, when the provider supplies it. Used
   * as the source for avgBalanceLast3Month; absent in some payloads (then we
   * fall back to currentBalance).
   */
  balance?: number;
  endBalance?: number;
  closingBalance?: number;
}

/** A daily balance snapshot (`balancesPerDays[]`). Often empty in payloads. */
export interface OFBalancePerDay {
  date?: string;
  balance?: number;
}

/** A regular income source inside `totalIncomesOutcome.regularIncomeSources[]`. */
export interface OFRegularIncomeSource {
  classificationSource?: string;
  amount?: number;
}

/** Aggregated monthly income/expense summary (`totalIncomesOutcome`). */
export interface OFTotalIncomesOutcome {
  date?: string;
  customerId?: string;
  sumIncomePerMonth?: number;
  sumExpansesPerMonth?: number;
  sumNetIncomePerMonth?: number;
  regularIncomeSources?: OFRegularIncomeSource[];
}

/** A credit-card monthly spend entry (`creditCardOutcomes[]`). */
export interface OFCreditCardOutcome {
  accountNumber?: string;
  parsedAccountNumber?: string;
  yearMonth?: string;
  customerId?: string;
  providerId?: string;
  sumExpanse?: number;
}

/** Average card fee per card (`creditCardFees[]`). */
export interface OFCreditCardFee {
  avgCardFee?: number | null;
  accountNumber?: string;
  customerId?: string;
  providerId?: string;
}

/** Savings & securities totals (`savingsAndSecurities`). */
export interface OFSavingsAndSecurities {
  customerId?: string;
  totalSavings?: number;
  totalSecuritiesValue?: number;
  totalForeignCurrencyAmount?: unknown[];
  foreignCurrency?: string;
}

/** A single security holding (`securities[]`). */
export interface OFSecurity {
  accountNumber?: string;
  parsedAccountNumber?: string;
  providerId?: string;
  name?: string;
  unitsNumber?: number;
  averageBuyingPrice?: { amount?: number; currency?: string } | null;
  normalisedPrice?: number | null;
  totalValue?: number;
  /**
   * Net amount added to this security position over the reported window (a
   * deposit/contribution figure). Summed into monthly_deposits when present.
   */
  securitiesAddition?: number;
}

/**
 * A single signed savings movement (`savings[].savingsTransactions[]`). The
 * provider may emit either a bare signed number or an object; the extractor
 * accepts both. Positive = deposit, negative = withdrawal.
 */
export interface OFSavingTransaction {
  amount?: number;
  chargedAmount?: number;
}

/** A savings account (`savings[]`). Empty for users with no savings products. */
export interface OFSaving {
  accountNumber?: string;
  parsedAccountNumber?: string;
  providerId?: string;
  /** Current accumulated balance of this savings account. */
  amount?: number;
  /** Signed deposit/withdrawal movements on this account. */
  savingsTransactions?: Array<number | OFSavingTransaction>;
}

/**
 * A single charge line on a loan/mortgage account (`loans[].transactions[]`).
 * `chargedAmount < 0` is an outflow (a repayment); `mainCategory` distinguishes
 * consumer loans ('LOANS') from mortgages ('MORTGAGE').
 */
export interface OFLoanTransaction {
  chargedAmount?: number;
  mainCategory?: string;
}

/** A loan or mortgage account (`loans[]`). Empty for users with no debt. */
export interface OFLoan {
  accountNumber?: string;
  parsedAccountNumber?: string;
  providerId?: string;
  /** Account-level category fallback when transactions omit mainCategory. */
  mainCategory?: string;
  /** Outstanding balance fallback when loansTotal is unavailable. */
  balance?: number;
  transactions?: OFLoanTransaction[];
}

/** Loans & mortgage totals (`loansTotal`). */
export interface OFLoansTotal {
  customerId?: string;
  totalMortgageAmount?: number;
  totalLoansAmount?: number;
}

/**
 * Money moved between the user's own accounts over the reported flow window,
 * measured from the checking side. Only the raw-data pipeline supplies this;
 * the legacy aggregated report did not, so the extractor falls back to summing
 * destination-account movements when it is absent.
 */
export interface OFCapitalFlows {
  /** Outflows from checking into savings/investments. */
  contributions?: number;
  /** Inflows to checking coming back out of savings/investments. */
  redemptions?: number;
  /** Number of complete months the two figures span. */
  windowMonths?: number;
}

/**
 * The aggregated financial report. Both the credit/BDI counters and the
 * collection sections are optional — the provider omits empty ones.
 */
export interface OFFinancialReport {
  currentDate?: string;
  customerId?: string;
  ownerName?: string;
  parsedAccountNumber?: string;
  providerId?: string;

  checkingAccountsILS?: OFCheckingAccount[];
  checkingAccounts?: OFCheckingAccount[];
  yearMonthBalance?: OFYearMonthBalance[];
  balancesPerDays?: OFBalancePerDay[];
  totalIncomesOutcome?: OFTotalIncomesOutcome;

  creditCardOutcomes?: OFCreditCardOutcome[];
  creditCardFees?: OFCreditCardFee[];

  savingsAndSecurities?: OFSavingsAndSecurities;
  savings?: OFSaving[];
  securities?: OFSecurity[];

  capitalFlows?: OFCapitalFlows;

  loansTotal?: OFLoansTotal;
  loans?: OFLoan[];
  totalLoans?: unknown[];

  // BDI / credit-behaviour counters (null when the provider has no data).
  countAkam?: number | null;
  countAlertNotice?: number | null;
  countCancelled?: number | null;
  countForeclosure?: number | null;
  countLoanOverDue?: number | null;
}

/**
 * The top-level payload as returned by the Open Finance report job. The file
 * upload flow receives this wrapper; the API flow receives the inner
 * `financialReport` directly. The extractor's `normalizeReport` handles both.
 */
export interface OFReportEnvelope {
  status?: string;
  financialReport?: OFFinancialReport;
}
