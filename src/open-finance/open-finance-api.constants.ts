/** Default sandbox provider used when OF_SANDBOX_PROVIDER_ID is not set. */
export const DEFAULT_SANDBOX_PROVIDER_ID = 'open-finance-sandbox';

/** Axios request timeout for a single Open Finance HTTP call. */
export const HTTP_TIMEOUT_MS = 15_000;

/** Default token TTL (seconds) when the auth response omits an expiry. */
export const TOKEN_DEFAULT_TTL_SECONDS = 3_600;

/** Skew applied to cached-token expiry so we refresh slightly early. */
export const TOKEN_EXPIRY_SKEW_MS = 5_000;

/** Delay between financial-report poll attempts. */
export const POLL_INTERVAL_MS = 2_000;

/** Maximum time to wait for a financial-report job to complete. */
export const POLL_TIMEOUT_MS = 120_000;

/** Job statuses that indicate successful completion. */
export const TERMINAL_SUCCESS_STATUSES = [
  'done',
  'completed',
  'success',
  'succeeded',
];

/** Job statuses that indicate terminal failure. */
export const TERMINAL_FAILURE_STATUSES = [
  'failed',
  'error',
  'cancelled',
  'canceled',
];
