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
}

/** Loans & mortgage totals (`loansTotal`). */
export interface OFLoansTotal {
  customerId?: string;
  totalMortgageAmount?: number;
  totalLoansAmount?: number;
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
  totalIncomesOutcome?: OFTotalIncomesOutcome;

  creditCardOutcomes?: OFCreditCardOutcome[];
  creditCardFees?: OFCreditCardFee[];

  savingsAndSecurities?: OFSavingsAndSecurities;
  savings?: unknown[];
  securities?: OFSecurity[];

  loansTotal?: OFLoansTotal;
  loans?: unknown[];
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
