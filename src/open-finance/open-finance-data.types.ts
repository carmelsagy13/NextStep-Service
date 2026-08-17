/**
 * Type definitions for the Open Finance *raw data* APIs that replace the
 * deprecated aggregated financial-report job:
 *
 *  - GET /v2/data/accounts                    (balances, loans, savings, securities)
 *  - GET /v2/data/transactions                (categorised transaction stream)
 *  - GET /v2/data/accounts/{id}/balances/history (end-of-day balance series)
 *
 * Everything is optional: the provider omits sections it has no data for, and
 * several fields differ between the published OpenAPI schema and what the
 * service actually returns, so consumers must stay defensive.
 */

/**
 * A monetary amount as returned throughout the data API. The provider serialises
 * every numeric as a string, so consumers must coerce.
 */
export interface OFMoney {
  amount?: number | string;
  currency?: string;
}

/**
 * One entry of `account.balances[]`. The published schema documents a flat
 * `{ amount, currency }`, while the Berlin-Group shape actually returned carries
 * `{ balanceType, balanceAmount }`. Both are accepted.
 */
export interface OFBalance extends OFMoney {
  balanceType?: string;
  balanceAmount?: OFMoney;
  referenceDate?: string;
  creditLimitIncluded?: boolean;
}

/** Interest information; only present on SAVINGS and LOAN accounts. */
export interface OFInterest {
  rate?: Array<{
    percentage?: number | string;
    fromAmount?: OFMoney;
    toAmount?: OFMoney;
  }>;
  /** FIXD (fixed) or INDE (index-linked). */
  type?: string;
  relatedIndices?: Array<{ index?: string; additionalInformation?: string }>;
  currency?: string;
}

/**
 * A securities holding. The published schema nests everything under
 * `financialInstrument`; the live payload keeps the units, price and valuation
 * at the position root and only carries the name/ISIN in the instrument.
 */
export interface OFSecurityPosition {
  unitsNumber?: number | string;
  externalIdentifier?: string;
  balanceType?: string;
  averageBuyingPrice?: OFMoney;
  financialInstrument?: { isin?: string; name?: string };
  estimatedCurrentValue?: { amount?: OFMoney; evaluationDateTime?: string };
}

/** Account types exposed by GET /v2/data/accounts. */
export type OFAccountType =
  | 'CHECKING'
  | 'CARD'
  | 'LOAN'
  | 'SAVINGS'
  | 'SECURITIES';

/** A single account from GET /v2/data/accounts. */
export interface OFDataAccount {
  id?: string;
  userId?: string;
  /** National ID of the account owner. */
  psuId?: string;
  providerId?: string;
  connectionId?: string;
  status?: string;
  accountNumber?: string;
  product?: string;
  parsedAccount?: { bank?: string; branch?: string; number?: string };
  accountType?: string;
  creditStatus?: 'deleted' | 'enabled' | 'disabled';
  currency?: string;
  accountName?: string;
  ownerInfo?: { nationalId?: string; fullName?: string };
  balances?: OFBalance[];
  interest?: OFInterest[];
  relatedDates?: {
    contractAvailabilityDate?: string;
    contractStartDate?: string;
    contractEndDate?: string;
  };
  usage?: string;
  /** Documented as a number, but returned as an amount object. */
  creditLimit?: OFMoney;
  /** Overdraft pricing on a CREDIT_LIMIT account. */
  creditLimitInterestRate?: {
    fixedRate?: number;
    indexedRate?: number;
    totalRate?: number;
  };
  /** Count of transactions on the account, not the transactions themselves. */
  transactions?: number;
  applicableFees?: unknown[];
  securityPositions?: OFSecurityPosition[];
  securityOrders?: unknown[];
  /** Comma-separated key-value string; carries card billing dates. */
  details?: string;
  /** Documented as an array, but providers may send a single value. */
  loanType?: string | string[];
  [k: string]: unknown;
}

/** A single transaction from GET /v2/data/transactions. */
export interface OFDataTransaction {
  id?: string;
  SK?: string;
  userId?: string;
  connectionId?: string;
  accountId?: string;
  providerId?: string;
  accountNumber?: string;
  status?: string;
  amount?: { originalAmount?: OFMoney; chargedAmount?: OFMoney };
  description?: { description?: string; additionalInfo?: string };
  category?: { main?: string; sub?: string };
  changedCategory?: { main?: string; sub?: string };
  classification?: { type?: string; source?: string };
  type?: string;
  date?: { valueDate?: string; bookingDate?: string; transactionDate?: string };
  /** End-of-day account balance after this transaction (checking accounts). */
  balancePerEndDay?: number | string;
  [k: string]: unknown;
}

/**
 * The subset of transaction fields the aggregator reads. Transactions are
 * projected onto this shape as soon as they arrive, so the bulky provider
 * payload (descriptions, merchant addresses, securities details, creditor and
 * debtor accounts…) is never carried through the pipeline.
 */
export type OFSlimTransaction = Pick<
  OFDataTransaction,
  | 'accountId'
  | 'accountNumber'
  | 'providerId'
  | 'status'
  | 'amount'
  | 'date'
  | 'category'
  | 'changedCategory'
  | 'balancePerEndDay'
>;

/** Cursor-paginated envelope used by the /v2/data list endpoints. */
export interface OFPaginated<T> {
  nextPage?: string | null;
  items?: T[];
}

/** Response from GET /v2/data/accounts/{accountId}/balances/history. */
export interface OFBalanceHistory {
  accountId?: string;
  currency?: string;
  fromDate?: string;
  toDate?: string;
  count?: number;
  items?: Array<{ date?: string; balance?: number | string }>;
}
