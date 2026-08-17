import {
  OFCheckingAccount,
  OFFinancialReport,
  OFLoan,
  OFReportEnvelope,
  OFSaving,
  OFSavingTransaction,
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

/**
 * Sums a loan/mortgage account's repayment outflows (chargedAmount < 0) for the
 * requested mainCategory. Repayments are negative, so we add their magnitude.
 * Falls back to the account-level mainCategory when a transaction omits its own.
 */
function sumLoanRepayments(
  loans: OFLoan[] | undefined,
  category: 'LOANS' | 'MORTGAGE',
): number {
  if (!Array.isArray(loans)) return 0;
  let total = 0;
  for (const loan of loans) {
    const txns = Array.isArray(loan?.transactions) ? loan.transactions : [];
    for (const tx of txns) {
      const cat = (tx?.mainCategory ?? loan?.mainCategory ?? '').toUpperCase();
      const amount = num(tx?.chargedAmount);
      if (cat === category && amount < 0) {
        total += Math.abs(amount);
      }
    }
  }
  return total;
}

/** Normalises a savings movement (number or object) to a signed amount. */
function savingTxnAmount(tx: number | OFSavingTransaction): number {
  if (typeof tx === 'number') return num(tx);
  return num(tx?.amount ?? tx?.chargedAmount);
}

/**
 * Affordability ratio of a monthly debt-service payment to monthly disposable
 * surplus. 0 when there is no payment; a 99 sentinel when a payment exists but
 * surplus is non-positive (i.e. the user cannot afford it from disposable income).
 */
function affordabilityRatio(payment: number, surplus: number): number {
  if (payment <= 0) return 0;
  if (surplus <= 0) return 99;
  return Math.round((payment / surplus) * 100) / 100;
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
    monthlyLoanPayments: 0,
    monthlyMortgagePayments: 0,
    loanBalance: 0,
    mortgageBalance: 0,
    loanVSaffordability: 0,
    mortgageVSaffordability: 0,
    savingsAndSecuritiesBalance: 0,
    monthlyDeposits: 0,
    monthlyWithdrawals: 0,
    avgBalanceLast3Month: 0,
    activeCreditCardsCount: 0,
    avgMonthlyCreditCardSpend: 0,
    creditCardFeesTotal: 0,
    overdraftLimit: 0,
    overdraftUsed: 0,
    overdraftUtilisation: 0,
    savingsRate: 0,
    discretionarySurplus: 0,
    systemFlags: {
      loanOverDueCount: 0,
      foreclosureCount: 0,
      alertNoticeCount: 0,
      akamCount: 0,
      cancelledCount: 0,
    },
    systemFlagsAvailable: false,
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

  // ── Macro debt-service (consumer loans vs mortgage, evaluated independently) ─
  // Monthly repayment = sum of repayment outflows over the window / 3 months.
  const loans = Array.isArray(report.loans)
    ? (report.loans as OFLoan[])
    : undefined;
  const monthlyLoanPayments = round(sumLoanRepayments(loans, 'LOANS') / 3);
  const monthlyMortgagePayments = round(
    sumLoanRepayments(loans, 'MORTGAGE') / 3,
  );
  // Outstanding balances map directly to the provider's loan/mortgage totals.
  const loanBalance = totalLoans;
  const mortgageBalance = totalMortgage;

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

  // ── Overdraft facility ─────────────────────────────────────────────────────
  // Only the CHECKING account carries a trustworthy limit: the provider reports
  // creditLimit=0 on the credit-line account itself and placeholder values on
  // cards, so card utilisation is deliberately not derived here.
  const checkingForLimits = report.checkingAccountsILS?.length
    ? report.checkingAccountsILS
    : (report.checkingAccounts ?? []);
  const overdraftLimit = round(
    checkingForLimits.reduce((acc, a) => acc + num(a?.creditLimit), 0),
  );
  const overdraftUsed = round(
    checkingForLimits.reduce((acc, a) => acc + Math.max(0, -num(a?.amount)), 0),
  );
  const overdraftUtilisation =
    overdraftLimit > 0
      ? Math.round((overdraftUsed / overdraftLimit) * 100)
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

  // Affordability of each debt-service stream against monthly disposable surplus.
  const loanVSaffordability = affordabilityRatio(
    monthlyLoanPayments,
    discretionarySurplus,
  );
  const mortgageVSaffordability = affordabilityRatio(
    monthlyMortgagePayments,
    discretionarySurplus,
  );

  // ── Savings/securities balance & monthly flows ─────────────────────────────
  const savingsAccounts = Array.isArray(report.savings)
    ? (report.savings as OFSaving[])
    : [];
  const savingsBalance = savingsAccounts.reduce(
    (acc, s) => acc + num(s?.amount),
    0,
  );
  const savingsAndSecuritiesBalance = round(
    savingsBalance + totalSecuritiesValue,
  );

  // Signed savings movements (deposits positive, withdrawals negative).
  const savingsTxns: number[] = [];
  for (const s of savingsAccounts) {
    const list = Array.isArray(s?.savingsTransactions)
      ? s.savingsTransactions
      : [];
    for (const tx of list) savingsTxns.push(savingTxnAmount(tx));
  }
  const positiveSavingsFlow = savingsTxns
    .filter((a) => a > 0)
    .reduce((acc, a) => acc + a, 0);
  const negativeSavingsFlow = savingsTxns
    .filter((a) => a < 0)
    .reduce((acc, a) => acc + Math.abs(a), 0);
  const securitiesAdditionTotal = Array.isArray(report.securities)
    ? report.securities.reduce((acc, s) => acc + num(s?.securitiesAddition), 0)
    : 0;

  // The raw-data pipeline measures capital movements from the checking side,
  // which excludes fund-internal churn (switches, accruals, reinvestments).
  // Legacy report payloads carry no capitalFlows, so they keep summing the
  // destination-account movements.
  const flows = report.capitalFlows;
  const flowMonths = num(flows?.windowMonths) || 3;
  const monthlyDeposits = flows
    ? round(num(flows.contributions) / flowMonths)
    : round((positiveSavingsFlow + securitiesAdditionTotal) / 3);
  const monthlyWithdrawals = flows
    ? round(num(flows.redemptions) / flowMonths)
    : round(negativeSavingsFlow / 3);

  // Mean balance over the last 3 monthly entries; closing-balance field when the
  // provider supplies one, otherwise the single currentBalance snapshot.
  const monthlyClosingBalances = (
    Array.isArray(report.yearMonthBalance) ? report.yearMonthBalance : []
  )
    .slice(0, 3)
    .map((m) => num(m?.balance ?? m?.endBalance ?? m?.closingBalance))
    .filter((b) => b !== 0);
  const avgBalanceLast3Month =
    monthlyClosingBalances.length > 0
      ? round(
          monthlyClosingBalances.reduce((acc, b) => acc + b, 0) /
            monthlyClosingBalances.length,
        )
      : currentBalance;

  // ── System / BDI counters ────────────────────────────────────────────
  // No endpoint currently supplies these. A null counter means "unknown", which
  // must not collapse into "zero = clean record".
  const rawCounters = [
    report.countLoanOverDue,
    report.countForeclosure,
    report.countAlertNotice,
    report.countAkam,
    report.countCancelled,
  ];
  const systemFlagsAvailable = rawCounters.some((c) => c != null);  const systemFlags = {
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
    monthlyLoanPayments,
    monthlyMortgagePayments,
    loanBalance,
    mortgageBalance,
    loanVSaffordability,
    mortgageVSaffordability,
    savingsAndSecuritiesBalance,
    monthlyDeposits,
    monthlyWithdrawals,
    avgBalanceLast3Month,
    activeCreditCardsCount,
    avgMonthlyCreditCardSpend,
    creditCardFeesTotal,
    overdraftLimit,
    overdraftUsed,
    overdraftUtilisation,
    savingsRate,
    discretionarySurplus,
    systemFlags,
    systemFlagsAvailable,
    hasData: true,
  };
}
