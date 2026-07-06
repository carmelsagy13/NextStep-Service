/**
 * Tunable constants for the loss-aversion engine. Centralised here so the
 * business assumptions behind the numbers can be adjusted without touching the
 * calculation logic.
 */

/**
 * Assumed annual return, RESERVED for future return-/growth-based strategies.
 * The current v1 strategy reports the idle surplus principal directly (not a
 * return on it), so this rate is intentionally unused right now. Kept here so a
 * later future-value strategy has a single tunable knob.
 */
export const ASSUMED_ANNUAL_RETURN_RATE = 0.04;

/** Number of months the annual figure is projected over (idle surplus × 12). */
export const PROJECTION_MONTHS = 12;

/** Currency all loss-aversion amounts are expressed in. */
export const LOSS_CURRENCY = 'ILS' as const;
