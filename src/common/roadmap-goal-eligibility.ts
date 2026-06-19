import { RoadmapGoal, RoadmapGoalCriteria } from '../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';

/**
 * Criteria scores extracted from a user profile, keyed by the 8 criteria names.
 * Each score is 1–5 or null (not yet assessed).
 */
export interface CriteriaScores {
  cash_flow: number | null;
  credit_consumption: number | null;
  loans: number | null;
  savings_investments: number | null;
  pension_long_term: number | null;
  lifestyle_clubs: number | null;
  mortgage: number | null;
  system_indicators: number | null;
}

/**
 * Extracts the 8 granular criteria scores from a UserProfile entity, mapping
 * camelCase field names to snake_case criteria keys.
 */
export function criteriaScoresFromProfile(profile: UserProfile): CriteriaScores {
  return {
    cash_flow: profile.cashFlow ?? null,
    credit_consumption: profile.creditConsumption ?? null,
    loans: profile.loans ?? null,
    savings_investments: profile.savingsInvestments ?? null,
    pension_long_term: profile.pensionLongTerm ?? null,
    lifestyle_clubs: profile.lifestyleClubs ?? null,
    mortgage: profile.mortgage ?? null,
    system_indicators: profile.systemIndicators ?? null,
  };
}

/**
 * Determines whether a roadmap goal is eligible for a user based on step and
 * per-criteria scoring.
 *
 * Eligibility rules:
 * - **General goals** (criteria = NULL): eligible when `stepId === currentStep`.
 *   Unchanged from today's behavior.
 * - **Criteria goals** (criteria set): eligible when the user has reached or
 *   passed the goal's step in that specific criterion:
 *   `criteriaScores[criteria] >= stepId`.
 *
 * Example: A "loans" goal at step 2 is eligible once the user's loans score
 * is >= 2, even if their overall currentStep is 1.
 *
 * @param goal - The roadmap goal template to check.
 * @param context - The user's current step and per-criteria scores.
 * @returns `true` if the goal is eligible, `false` otherwise.
 */
export function isRoadmapGoalEligible(
  goal: RoadmapGoal,
  context: { currentStep: number; criteriaScores: CriteriaScores },
): boolean {
  if (goal.criteria === null) {
    // General goal: exact step match (unchanged).
    return goal.stepId === context.currentStep;
  } else {
    // Criteria goal: user has reached the step in that specific criterion.
    const userScore = context.criteriaScores[goal.criteria];
    return userScore !== null && userScore >= goal.stepId;
  }
}
