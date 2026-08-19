import type {
  OFCheckingAccount,
  OFCreditCardFee,
  OFCreditCardOutcome,
  OFFinancialReport,
  OFLoan,
  OFLoanTransaction,
  OFSaving,
  OFSecurity,
  OFYearMonthBalance,
} from './financial-report.types.js';
import type {
  OFBalance,
  OFBalanceHistory,
  OFDataAccount,
  OFSlimTransaction,
} from './open-finance-data.types.js';
import { FLOW_WINDOW_MONTHS } from './open-finance-api.constants.js';

/**
 * Rebuilds the aggregated `financialReport` payload that the deprecated
 * `POST /v2/financial-report/{customerId}` + `GET /v2/financial-report/{jobId}`
 * job used to return, using only the raw data endpoints that are still
 * permitted (`/v2/data/accounts`, `/v2/data/transactions`,
 * `/v2/data/accounts/{id}/balances/history`).
 *
 * Keeping the same output shape means the downstream extractor, prompts,
 * persistence and event detection are untouched by the migration.
 */

/** Transaction statuses that must not influence balances or aggregates. */
const EXCLUDED_TX_STATUSES = new Set(['PENDING', 'DELETED', 'CANCELLED']);

/** Balance types preferred per account type, in order of preference. */
const BALANCE_PREFERENCE = ['closingBooked', 'interimBooked', 'expected'];

/**
 * FINANCE sub-categories that move the user's own money between their own
 * accounts. Treating a transfer into a savings or money-market account as
 * spending turns wealth-building into a fake monthly deficit.
 */
const INTERNAL_FLOW_SUBS = new Set(['SAVINGS', 'CAPITAL_MARKET']);

/**
 * Debt-service categories, keyed by `main > sub`. These are excluded from the
 * expense series because the extractor already models them from the LOAN
 * accounts as monthlyLoanPayments / monthlyMortgagePayments; counting them in
 * expenses too would subtract the same repayment from the surplus twice and
 * make the affordability ratios divide by an already-net figure.
 */
const DEBT_SERVICE_CATEGORIES = new Set([
  'FINANCE>LOANS',
  'HOUSEHOLD_&_SERVICES>MORTGAGE',
]);

export interface BuildReportInput {
  customerId: string;
  accounts: OFDataAccount[];
  transactions: OFSlimTransaction[];
  /** Daily balance series per checking account, when available. */
  balanceHistories?: OFBalanceHistory[];
  /** Injectable clock, so "the current month is partial" is testable. */
  now?: Date;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number): number {
  return Math.round(value);
}

/** Several fields documented as arrays arrive as a bare scalar from providers. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function accountTypeOf(account: OFDataAccount): string {
  return String(account?.accountType ?? '').toUpperCase();
}

/**
 * Resolves an account's balance. Prefers `closingBooked`, ignores entries that
 * fold the credit facility into the amount, and within a type takes the most
 * recent `referenceDate` — loans report their original amount as a
 * `closingBooked` entry back-dated to the contract start date.
 */
function pickBalance(balances: OFBalance[] | undefined): number {
  if (!Array.isArray(balances) || balances.length === 0) return 0;

  const amountOf = (b: OFBalance): number =>
    num(b?.balanceAmount?.amount ?? b?.amount);

  for (const type of BALANCE_PREFERENCE) {
    const matches = balances.filter(
      (b) => String(b?.balanceType ?? '') === type,
    );
    if (matches.length === 0) continue;
    // Checking accounts report closingBooked twice: once net, once with the
    // overdraft facility added in. The net figure is the real balance.
    const net = matches.filter((b) => b?.creditLimitIncluded !== true);
    const candidates = net.length > 0 ? net : matches;
    const latest = candidates.reduce((best, b) =>
      String(b?.referenceDate ?? '') > String(best?.referenceDate ?? '')
        ? b
        : best,
    );
    return amountOf(latest);
  }
  // Untyped/flat shape — fall back to the first entry.
  return amountOf(balances[0]);
}

function currencyOf(account: OFDataAccount): string | undefined {
  const fromBalance = account?.balances?.find(
    (b) => b?.balanceAmount?.currency ?? b?.currency,
  );
  return (
    account?.currency ??
    fromBalance?.balanceAmount?.currency ??
    fromBalance?.currency
  );
}

/** Signed transaction amount; negative = outflow. */
function txAmount(tx: OFSlimTransaction): number {
  return num(
    tx?.amount?.chargedAmount?.amount ?? tx?.amount?.originalAmount?.amount,
  );
}

/** Best available transaction date, preferring the booked date. */
function txDate(tx: OFSlimTransaction): string {
  return (
    tx?.date?.bookingDate ??
    tx?.date?.valueDate ??
    tx?.date?.transactionDate ??
    ''
  );
}

/** `YYYY-MM` bucket for a date string; empty when the date is unusable. */
function monthKey(date: string): string {
  if (/^\d{4}-\d{2}/.test(date)) return date.slice(0, 7);
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Shifts a `YYYY-MM` key back by n months. */
function shiftMonth(key: string, months: number): string {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 - months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isUsable(tx: OFSlimTransaction): boolean {
  // Duplicates are already excluded server-side via includeDuplicates=0.
  const status = String(tx?.status ?? '').toUpperCase();
  return !EXCLUDED_TX_STATUSES.has(status);
}

/** Effective category of a transaction — a user override wins over the system one. */
function categoryOf(tx: OFSlimTransaction): { main: string; sub: string } {
  return {
    main: String(tx?.changedCategory?.main ?? tx?.category?.main ?? ''),
    sub: String(tx?.changedCategory?.sub ?? tx?.category?.sub ?? ''),
  };
}

/** True when the movement is between the user's own accounts, not real cash flow. */
function isInternalFlow(tx: OFSlimTransaction): boolean {
  const { main, sub } = categoryOf(tx);
  return (
    main.toUpperCase() === 'FINANCE' &&
    INTERNAL_FLOW_SUBS.has(sub.toUpperCase())
  );
}

/** True when the movement is a loan or mortgage repayment. */
function isDebtService(tx: OFSlimTransaction): boolean {
  const { main, sub } = categoryOf(tx);
  return DEBT_SERVICE_CATEGORIES.has(
    `${main.toUpperCase()}>${sub.toUpperCase()}`,
  );
}

function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function buildFinancialReport(
  input: BuildReportInput,
): OFFinancialReport {
  const {
    customerId,
    accounts = [],
    transactions = [],
    balanceHistories = [],
    now = new Date(),
  } = input;

  const currentMonth = monthKey(now.toISOString());
  // The window used for "per month" flow figures. The extractor divides loan
  // repayments and savings movements by FLOW_WINDOW_MONTHS, so those movements
  // must be restricted to exactly that many complete months even though the
  // monthly history itself may span longer.
  const flowWindowStart = shiftMonth(currentMonth, FLOW_WINDOW_MONTHS);

  const usableTx = transactions.filter(isUsable);

  const byType = (type: string): OFDataAccount[] =>
    accounts.filter((a) => accountTypeOf(a) === type);
  const checkingAcc = byType('CHECKING');
  // A cancelled card is not part of the user's current credit picture.
  const cardAcc = byType('CARD').filter((a) => a?.creditStatus !== 'deleted');
  const loanAcc = byType('LOAN');
  const savingsAcc = byType('SAVINGS');
  const securitiesAcc = byType('SECURITIES');

  const accountIds = (list: OFDataAccount[]): Set<string> =>
    new Set(list.map((a) => String(a?.id ?? '')).filter(Boolean));
  const checkingIds = accountIds(checkingAcc);
  const cardIds = accountIds(cardAcc);

  const txFor = (ids: Set<string>): OFSlimTransaction[] =>
    usableTx.filter((tx) => ids.has(String(tx?.accountId ?? '')));
  const inFlowWindow = (tx: OFSlimTransaction): boolean => {
    const key = monthKey(txDate(tx));
    return key !== '' && key >= flowWindowStart && key < currentMonth;
  };

  // ── Checking accounts ────────────────────────────────────────────────────
  const toCheckingEntry = (a: OFDataAccount): OFCheckingAccount => ({
    customerId,
    amount: round(pickBalance(a?.balances)),
    providerId: a?.providerId,
    accountNumber: a?.accountNumber,
    accountId: a?.id,
    currency: currencyOf(a),
    // PARKED with the overdraft feature:
    // creditLimit: round(num(a?.creditLimit?.amount)),
  });
  const checkingAccounts = checkingAcc.map(toCheckingEntry);
  const checkingAccountsILS = checkingAccounts.filter(
    (a) => !a.currency || a.currency.toUpperCase() === 'ILS',
  );

  // ── Month-end balances ───────────────────────────────────────────────────
  // Preferred source: the reconstructed daily balance series. Fallback: the
  // `balancePerEndDay` carried on the last checking transaction of each month.
  const monthEndBalance = new Map<string, number>();
  for (const history of balanceHistories) {
    const perMonth = new Map<string, { date: string; balance: number }>();
    for (const point of toArray(history?.items)) {
      const key = monthKey(String(point?.date ?? ''));
      if (!key) continue;
      const existing = perMonth.get(key);
      const date = String(point?.date ?? '');
      if (!existing || date > existing.date) {
        perMonth.set(key, { date, balance: num(point?.balance) });
      }
    }
    for (const [key, value] of perMonth) {
      monthEndBalance.set(key, (monthEndBalance.get(key) ?? 0) + value.balance);
    }
  }

  const checkingTx = txFor(checkingIds);
  if (monthEndBalance.size === 0) {
    const latestPerMonth = new Map<string, { date: string; balance: number }>();
    for (const tx of checkingTx) {
      // Numerics arrive as strings, so this cannot be a typeof check.
      if (tx?.balancePerEndDay == null) continue;
      const balance = num(tx.balancePerEndDay);
      const date = txDate(tx);
      const key = monthKey(date);
      if (!key) continue;
      const existing = latestPerMonth.get(key);
      if (!existing || date >= existing.date) {
        latestPerMonth.set(key, { date, balance });
      }
    }
    for (const [key, value] of latestPerMonth) {
      monthEndBalance.set(key, value.balance);
    }
  }

  // ── Monthly income / expense history ─────────────────────────────────────
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const tx of checkingTx) {
    const key = monthKey(txDate(tx));
    // The running month is partial and would skew every average.
    if (!key || key >= currentMonth) continue;
    if (isInternalFlow(tx) || isDebtService(tx)) continue;
    const bucket = monthly.get(key) ?? { income: 0, expense: 0 };
    const amount = txAmount(tx);
    if (amount >= 0) bucket.income += amount;
    else bucket.expense += Math.abs(amount);
    monthly.set(key, bucket);
  }

  // Newest month first — the extractor reads the first 3 entries as "recent".
  const yearMonthBalance: OFYearMonthBalance[] = [...monthly.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([yearMonth, v]) => ({
      yearMonth,
      sumIncome: round(v.income),
      sumExpense: round(v.expense),
      balance: monthEndBalance.has(yearMonth)
        ? round(monthEndBalance.get(yearMonth) as number)
        : undefined,
    }));

  // ── Monthly averages ─────────────────────────────────────────────────────
  const avgIncome = averageOf(yearMonthBalance.map((m) => num(m.sumIncome)));
  const avgExpense = averageOf(yearMonthBalance.map((m) => num(m.sumExpense)));

  // Recurring income streams: income categories seen in at least two months.
  const incomeByCategory = new Map<string, Map<string, number>>();
  for (const tx of checkingTx) {
    const amount = txAmount(tx);
    if (amount <= 0) continue;
    if (isInternalFlow(tx)) continue;
    const key = monthKey(txDate(tx));
    if (!key || key >= currentMonth) continue;
    const label = categoryOf(tx).main || 'OTHER';
    const perMonth = incomeByCategory.get(label) ?? new Map<string, number>();
    perMonth.set(key, (perMonth.get(key) ?? 0) + amount);
    incomeByCategory.set(label, perMonth);
  }
  const regularIncomeSources = [...incomeByCategory.entries()]
    .filter(([, perMonth]) => perMonth.size >= 2)
    .map(([classificationSource, perMonth]) => ({
      classificationSource,
      amount: round(averageOf([...perMonth.values()])),
    }))
    .sort((a, b) => b.amount - a.amount);

  // ── Credit cards ─────────────────────────────────────────────────────────
  const cardTx = txFor(cardIds);
  const outcomeKey = new Map<string, OFCreditCardOutcome>();
  const cardFeeTotals = new Map<
    string,
    { total: number; months: Set<string> }
  >();

  // Seed a zero-spend row per card per month, as the old report did. Without it
  // a card with no transactions in the window would vanish from the outcomes and
  // activeCreditCardsCount would undercount.
  for (const a of cardAcc) {
    const accountNumber = String(a?.accountNumber ?? a?.id ?? '');
    for (let back = 1; back <= FLOW_WINDOW_MONTHS; back++) {
      const key = shiftMonth(currentMonth, back);
      outcomeKey.set(`${accountNumber}|${key}`, {
        accountNumber,
        yearMonth: key,
        customerId,
        providerId: a?.providerId,
        sumExpanse: 0,
      });
    }
  }

  for (const tx of cardTx) {
    const key = monthKey(txDate(tx));
    if (!key || key >= currentMonth) continue;
    const amount = txAmount(tx);
    if (amount >= 0) continue;
    const accountNumber = String(tx?.accountNumber ?? tx?.accountId ?? '');
    const id = `${accountNumber}|${key}`;
    const entry = outcomeKey.get(id) ?? {
      accountNumber,
      yearMonth: key,
      customerId,
      providerId: tx?.providerId,
      sumExpanse: 0,
    };
    entry.sumExpanse = num(entry.sumExpanse) + Math.abs(amount);
    outcomeKey.set(id, entry);

    if (categoryOf(tx).sub === 'FEES') {
      const fees = cardFeeTotals.get(accountNumber) ?? {
        total: 0,
        months: new Set<string>(),
      };
      fees.total += Math.abs(amount);
      fees.months.add(key);
      cardFeeTotals.set(accountNumber, fees);
    }
  }
  const creditCardOutcomes: OFCreditCardOutcome[] = [
    ...outcomeKey.values(),
  ].map((o) => ({ ...o, sumExpanse: round(num(o.sumExpanse)) }));
  const creditCardFees: OFCreditCardFee[] = cardAcc.map((a) => {
    const accountNumber = String(a?.accountNumber ?? a?.id ?? '');
    const fees = cardFeeTotals.get(accountNumber);
    return {
      accountNumber,
      customerId,
      providerId: a?.providerId,
      avgCardFee: fees ? round(fees.total / fees.months.size) : 0,
    };
  });
  // ── Capital flows ────────────────────────────────────────────────────
  // Measured at the SOURCE — checking movements tagged as savings/capital
  // market. Positive movements on a fund account would also capture switches
  // between funds, dividend accruals and reinvested redemptions, none of which
  // are new money out of income. Using the same set that is excluded from
  // monthlyExpenses keeps surplus and deposits consistent by construction.
  let contributions = 0;
  let redemptions = 0;
  for (const tx of checkingTx) {
    if (!isInternalFlow(tx) || !inFlowWindow(tx)) continue;
    const amount = txAmount(tx);
    if (amount < 0) contributions += Math.abs(amount);
    else redemptions += amount;
  }
  // ── Savings ──────────────────────────────────────────────────────────────
  const savings: OFSaving[] = savingsAcc.map((a) => {
    const id = String(a?.id ?? '');
    const movements = usableTx
      .filter((tx) => String(tx?.accountId ?? '') === id && inFlowWindow(tx))
      .map((tx) => txAmount(tx));
    return {
      accountNumber: a?.accountNumber,
      parsedAccountNumber: a?.parsedAccount?.number,
      providerId: a?.providerId,
      amount: round(pickBalance(a?.balances)),
      savingsTransactions: movements,
    };
  });
  const totalSavings = round(
    savings.reduce((acc, s) => acc + num(s.amount), 0),
  );

  // ── Securities ───────────────────────────────────────────────────────────
  // SECURITIES accounts come back with an empty `balances` array — the value
  // lives on each holding. One entry per holding, as the old report emitted,
  // so securitiesCount counts holdings rather than accounts.
  const securities: OFSecurity[] = [];
  for (const a of securitiesAcc) {
    const positions = toArray(a?.securityPositions);

    if (positions.length === 0) {
      securities.push({
        accountNumber: a?.accountNumber,
        parsedAccountNumber: a?.parsedAccount?.number,
        providerId: a?.providerId,
        name: a?.accountName,
        totalValue: round(pickBalance(a?.balances)),
      });
      continue;
    }

    positions.forEach((p) => {
      const units = num(p?.unitsNumber);
      const avgPrice = num(p?.averageBuyingPrice?.amount);
      const estimated = num(p?.estimatedCurrentValue?.amount?.amount);
      securities.push({
        accountNumber: a?.accountNumber,
        parsedAccountNumber: a?.parsedAccount?.number,
        providerId: a?.providerId,
        name: p?.financialInstrument?.name ?? p?.externalIdentifier,
        unitsNumber: units,
        averageBuyingPrice: p?.averageBuyingPrice
          ? { amount: avgPrice, currency: p.averageBuyingPrice.currency }
          : null,
        totalValue: round(estimated || units * avgPrice),
      });
    });
  }
  const totalSecuritiesValue = round(
    securities.reduce((acc, s) => acc + num(s.totalValue), 0),
  );

  const foreignCurrencyTotals = new Map<string, number>();
  for (const a of [...checkingAcc, ...savingsAcc]) {
    const currency = currencyOf(a);
    if (!currency || currency.toUpperCase() === 'ILS') continue;
    foreignCurrencyTotals.set(
      currency,
      (foreignCurrencyTotals.get(currency) ?? 0) + pickBalance(a?.balances),
    );
  }

  // ── Loans & mortgages ────────────────────────────────────────────────────
  const isMortgage = (a: OFDataAccount): boolean => {
    const types = toArray(a?.loanType).map((t) => String(t).toUpperCase());
    if (types.includes('MORTGAGE')) return true;
    return /MORTGAGE|משכנתא/i.test(String(a?.product ?? a?.accountName ?? ''));
  };
  const loans: OFLoan[] = loanAcc.map((a) => {
    const id = String(a?.id ?? '');
    const mainCategory = isMortgage(a) ? 'MORTGAGE' : 'LOANS';
    const loanTx: OFLoanTransaction[] = usableTx
      .filter((tx) => String(tx?.accountId ?? '') === id && inFlowWindow(tx))
      .map((tx) => ({ chargedAmount: txAmount(tx), mainCategory }));
    return {
      accountNumber: a?.accountNumber,
      parsedAccountNumber: a?.parsedAccount?.number,
      providerId: a?.providerId,
      mainCategory,
      balance: round(pickBalance(a?.balances)),
      transactions: loanTx,
    };
  });

  // Loan balances are reported as a positive amount owed, whatever the sign
  // convention of the provider.
  const sumLoanBalances = (mortgage: boolean): number =>
    round(
      loanAcc
        .filter((a) => isMortgage(a) === mortgage)
        .reduce((acc, a) => acc + Math.abs(pickBalance(a?.balances)), 0),
    );
  const totalMortgageAmount = sumLoanBalances(true);
  const totalLoansAmount = sumLoanBalances(false);

  // ── Behavioural counters ─────────────────────────────────────────────────
  // No endpoint currently exposes the BDI counters, so they stay unknown
  // (null) rather than 0 — see FinancialFeatures.systemFlagsAvailable.
  const counters = {
    countAkam: null,
    countAlertNotice: null,
    countCancelled: null,
    countForeclosure: null,
    countLoanOverDue: null,
  };

  const primaryAccount = checkingAcc[0] ?? accounts[0];

  return {
    currentDate: now.toISOString().slice(0, 10),
    customerId,
    ownerName: primaryAccount?.ownerInfo?.fullName,
    parsedAccountNumber: primaryAccount?.parsedAccount?.number,
    providerId: primaryAccount?.providerId,

    checkingAccountsILS,
    checkingAccounts,
    yearMonthBalance,
    totalIncomesOutcome: {
      date: now.toISOString().slice(0, 10),
      customerId,
      sumIncomePerMonth: round(avgIncome),
      sumExpansesPerMonth: round(avgExpense),
      sumNetIncomePerMonth: round(avgIncome - avgExpense),
      regularIncomeSources,
    },

    creditCardOutcomes,
    creditCardFees,

    savingsAndSecurities: {
      customerId,
      totalSavings,
      totalSecuritiesValue,
      totalForeignCurrencyAmount: [...foreignCurrencyTotals.entries()].map(
        ([currency, amount]) => ({ currency, amount: round(amount) }),
      ),
    },
    savings,
    securities,

    capitalFlows: {
      contributions: round(contributions),
      redemptions: round(redemptions),
      windowMonths: FLOW_WINDOW_MONTHS,
    },

    loansTotal: { customerId, totalMortgageAmount, totalLoansAmount },
    loans,

    ...counters,
  };
}
