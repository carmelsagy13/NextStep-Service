/**
 * Risk-tolerance scoring for the Step-4 onboarding block.
 *
 * Three SINGLE_CHOICE questions each send an `option_value` string in the range
 * '1'..'4' (the per-choice risk score). The user's overall risk tolerance is the
 * sum of the three scores (range 3–12) mapped to a category. This is a pure,
 * dependency-free unit so the mapping is trivially unit-testable and the
 * thresholds live in exactly one place.
 */

/** The three questionnaire keys that make up the risk-tolerance assessment. */
export const RISK_QUESTION_KEYS = [
  'risk_behavioral',
  'risk_time_horizon',
  'risk_tradeoff',
] as const;

export type RiskQuestionKey = (typeof RISK_QUESTION_KEYS)[number];

/** Final risk-tolerance category persisted to user_profiles.risk_tolerance. */
export enum RiskTolerance {
  CONSERVATIVE = 'CONSERVATIVE',
  MODERATE = 'MODERATE',
  AGGRESSIVE = 'AGGRESSIVE',
}

export interface RiskToleranceResult {
  /** Sum of the three per-question scores (3–12). */
  total: number;
  category: RiskTolerance;
}

/** True for any of the three risk-assessment question keys. */
export function isRiskQuestionKey(key: string): key is RiskQuestionKey {
  return (RISK_QUESTION_KEYS as readonly string[]).includes(key);
}

/**
 * Inclusive score → category bands. Ordered by ascending `max`; the first band
 * whose `max` covers the total wins. Kept as data so the thresholds are easy to
 * tune without touching the logic.
 */
const RISK_BANDS: ReadonlyArray<{ max: number; category: RiskTolerance }> = [
  { max: 5, category: RiskTolerance.CONSERVATIVE }, // 3–5
  { max: 9, category: RiskTolerance.MODERATE }, // 6–9
  { max: 12, category: RiskTolerance.AGGRESSIVE }, // 10–12
];

/** Parse a single answer value into its integer score, validating the 1–4 range. */
function parseScore(key: RiskQuestionKey, value: unknown): number {
  const score = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 4) {
    throw new Error(
      `Invalid risk score for "${key}": expected an integer 1–4, got ${JSON.stringify(value)}.`,
    );
  }
  return score;
}

/**
 * Compute the risk-tolerance category from the merged answer set.
 *
 * Returns `null` when not all three risk answers are present (a partial edit of
 * unrelated fields must not force a recompute). Throws when a value IS present
 * but malformed — an invariant violation, since option values are validated
 * against the DB schema before this runs.
 */
export function computeRiskTolerance(
  answers: ReadonlyMap<string, unknown>,
): RiskToleranceResult | null {
  let total = 0;
  for (const key of RISK_QUESTION_KEYS) {
    const value = answers.get(key);
    if (value === undefined || value === null || value === '') return null;
    total += parseScore(key, value);
  }

  const band = RISK_BANDS.find((b) => total <= b.max);
  // Unreachable given valid 1–4 scores (total is always 3–12), but keeps the
  // return type non-nullable for callers reasoning about a complete answer set.
  if (!band) {
    throw new Error(`Risk score ${total} is outside the expected 3–12 range.`);
  }
  return { total, category: band.category };
}
