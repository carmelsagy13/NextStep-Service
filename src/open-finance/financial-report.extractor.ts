import {
  OFCheckingAccount,
  OFFinancialReport,
  OFReportEnvelope,
} from './financial-report.types.js';
import {
  FinancialFeatures,
  MonthlyBalance,
} from './financial-features.model.js';

/** Coerces an unknown value to a finite number, defaulting to 0. */
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Rounds to whole shekels. */
function round(value: number): number {
  return Math.round(value);
}

/**
 * Accepts either the full report envelope (`{ status, financialReport }`, as the
 * file-upload flow provides) or a bare `financialReport` object (as the API flow
 * provides) and returns the inner report. Returns an empty object when the input
 * is missing or malformed so the extractor can still produce a zeroed result.
 */
export function normalizeReport(raw: unknown): OFFinancialReport {
  if (raw == null || typeof raw !== 'object') {
    return {};
  }
  const obj = raw as OFReportEnvelope & OFFinancialReport;
  // Envelope shape: unwrap to the inner report.
  if (obj.financialReport && typeof obj.financialReport === 'object') {
    return obj.financialReport;
  }
  // Already an inner report.
  return obj as OFFinancialReport;
}

/** Sums the ILS balance across the provided checking-account entries. */
function sumCheckingBalance(accounts?: OFCheckingAccount[]): number {
  if (!Array.isArray(accounts)) return 0;
  return accounts.reduce((acc, a) => acc + num(a?.amount), 0);
}


/** Produces a fully-zeroed feature set (used for empty/invalid reports). */
export function emptyFeatures(): FinancialFeatures {
  return {
    currentBalance: 0,
    monthlyIncome: 0,
    monthlyExpenses: 0,
    monthlyNetCashFlow: 0,
    monthlyBalances: [],
    monthsCovered: 0,
    deficitMonthsCount: 0,
    avgMonthlyIncome: 0,
    avgMonthlyExpense: 0,
    totalSavings: 0,
    totalSecuritiesValue: 0,
    totalInvestments: 0,
    securitiesCount: 0,
    totalLoans: 0,
    totalMortgage: 0,
    totalDebt: 0,
    hasActiveLoans: false,
    hasMortgage: false,
    activeCreditCardsCount: 0,
    avgMonthlyCreditCardSpend: 0,
    creditCardFeesTotal: 0,
    savingsRate: 0,
    discretionarySurplus: 0,
    systemFlags: {
      loanOverDueCount: 0,
      foreclosureCount: 0,
      alertNoticeCount: 0,
      akamCount: 0,
      cancelledCount: 0,
    },
    hasData: false,
  };
}

/**
 * Deterministically derives a {@link FinancialFeatures} object from an aggregated
 * Open Finance report. Pure function — no side effects, no LLM. Every output is
 * a direct read or a transparent arithmetic derivation of report fields.
 */
export function extractFeatures(raw: unknown): FinancialFeatures {
  const report = normalizeReport(raw);

  // Treat a structurally-empty report as "no data".
  if (!report || Object.keys(report).length === 0) {
    return emptyFeatures();
  }

  // ── Liquidity ───────────────────────────────────────────────────────────
  // Prefer the ILS-specific list; fall back to the generic checking list.
  const currentBalance = round(
    report.checkingAccountsILS?.length
      ? sumCheckingBalance(report.checkingAccountsILS)
      : sumCheckingBalance(report.checkingAccounts),
  );

  // ── Monthly cash flow ─────────────────────────────────────────────────────
  const tio = report.totalIncomesOutcome ?? {};
  const monthlyIncome = round(num(tio.sumIncomePerMonth));
  const monthlyExpenses = round(num(tio.sumExpansesPerMonth));
  const monthlyNetCashFlow = round(num(tio.sumNetIncomePerMonth));

  // ── Multi-month history ───────────────────────────────────────────────────
  const monthlyBalances: MonthlyBalance[] = Array.isArray(
    report.yearMonthBalance,
  )
    ? report.yearMonthBalance.map((m) => {
        const income = round(num(m?.sumIncome));
        const expense = round(num(m?.sumExpense));
        return {
          yearMonth: String(m?.yearMonth ?? ''),
          income,
          expense,
          net: income - expense,
        };
      })
    : [];
  const monthsCovered = monthlyBalances.length;
  const deficitMonthsCount = monthlyBalances.filter((m) => m.net < 0).length;
  const avgMonthlyIncome = monthsCovered
    ? round(
        monthlyBalances.reduce((acc, m) => acc + m.income, 0) / monthsCovered,
      )
    : 0;
  const avgMonthlyExpense = monthsCovered
    ? round(
        monthlyBalances.reduce((acc, m) => acc + m.expense, 0) / monthsCovered,
      )
    : 0;

  // ── Savings & investments ──────────────────────────────────────────────────
  const sas = report.savingsAndSecurities ?? {};
  const totalSavings = round(num(sas.totalSavings));
  const totalSecuritiesValue = round(num(sas.totalSecuritiesValue));
  const totalInvestments = totalSavings + totalSecuritiesValue;
  const securitiesCount = Array.isArray(report.securities)
    ? report.securities.length
    : 0;

  // ── Debt ───────────────────────────────────────────────────────────────────
  const loansTotal = report.loansTotal ?? {};
  const totalLoans = round(num(loansTotal.totalLoansAmount));
  const totalMortgage = round(num(loansTotal.totalMortgageAmount));
  const totalDebt = totalLoans + totalMortgage;

  // ── Credit cards ────────────────────────────────────────────────────────────
  const cardOutcomes = Array.isArray(report.creditCardOutcomes)
    ? report.creditCardOutcomes
    : [];
  const cardAccounts = new Set<string>();
  let cardSpendTotal = 0;
  const cardMonths = new Set<string>();
  for (const c of cardOutcomes) {
    if (c?.accountNumber) cardAccounts.add(c.accountNumber);
    if (c?.yearMonth) cardMonths.add(c.yearMonth);
    cardSpendTotal += num(c?.sumExpanse);
  }
  const activeCreditCardsCount = cardAccounts.size;
  const avgMonthlyCreditCardSpend = cardMonths.size
    ? round(cardSpendTotal / cardMonths.size)
    : 0;
  const creditCardFeesTotal = Array.isArray(report.creditCardFees)
    ? round(
        report.creditCardFees.reduce((acc, f) => acc + num(f?.avgCardFee), 0),
      )
    : 0;

  // ── Derived ratios ───────────────────────────────────────────────────────────
  // Savings rate based on what the user moves into savings/investments each
  // month is NOT directly available; we approximate "contribution capacity" with
  // the discretionary surplus relative to income (transparent derivation).
  const discretionarySurplus = monthlyIncome - monthlyExpenses;
  const savingsRate =
    monthlyIncome > 0
      ? Math.round((Math.max(0, discretionarySurplus) / monthlyIncome) * 100)
      : 0;

  // ── System / BDI counters ──────────────────────────────────────────────────
  const systemFlags = {
    loanOverDueCount: num(report.countLoanOverDue),
    foreclosureCount: num(report.countForeclosure),
    alertNoticeCount: num(report.countAlertNotice),
    akamCount: num(report.countAkam),
    cancelledCount: num(report.countCancelled),
  };

  return {
    currentBalance,
    monthlyIncome,
    monthlyExpenses,
    monthlyNetCashFlow,
    monthlyBalances,
    monthsCovered,
    deficitMonthsCount,
    avgMonthlyIncome,
    avgMonthlyExpense,
    totalSavings,
    totalSecuritiesValue,
    totalInvestments,
    securitiesCount,
    totalLoans,
    totalMortgage,
    totalDebt,
    hasActiveLoans: totalLoans > 0,
    hasMortgage: totalMortgage > 0,
    activeCreditCardsCount,
    avgMonthlyCreditCardSpend,
    creditCardFeesTotal,
    savingsRate,
    discretionarySurplus,
    systemFlags,
    hasData: true,
  };
}
