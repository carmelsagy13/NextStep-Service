/** Axios request timeout for a single Open Finance HTTP call. */
export const HTTP_TIMEOUT_MS = 30_000;

/** Default token TTL (seconds) when the auth response omits an expiry. */
export const TOKEN_DEFAULT_TTL_SECONDS = 3_600;

/** Skew applied to cached-token expiry so we refresh slightly early. */
export const TOKEN_EXPIRY_SKEW_MS = 5_000;

/** Page size for the cursor-paginated /v2/data list endpoints (provider max). */
export const DATA_PAGE_SIZE = 500;

/** Safety cap on pagination so a broken cursor cannot loop forever. */
export const DATA_MAX_PAGES = 20;

/**
 * How much transaction history to pull. Six complete months matches what the
 * deprecated aggregated report returned, which is what monthsCovered and
 * deficitMonthsCount are calibrated against.
 */
export const TX_HISTORY_MONTHS = 6;

/**
 * Window (in complete months) used for "per month" flow figures. Independent of
 * TX_HISTORY_MONTHS: the extractor divides loan repayments and capital flows by
 * this number, so the aggregator restricts those movements to exactly this many
 * months even though the monthly history spans longer.
 */
export const FLOW_WINDOW_MONTHS = 3;

/**
 * A freshly-activated connection is not immediately queryable: the bank data is
 * still syncing, so the first /v2/data calls can come back empty. Retry a few
 * times before giving up.
 */
export const DATA_FETCH_MAX_ATTEMPTS = 6;

/** Delay between data-readiness retry attempts. */
export const DATA_FETCH_RETRY_DELAY_MS = 2_000;
