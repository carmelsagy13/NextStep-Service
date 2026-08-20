import {
  RoadmapGoal,
  RoadmapGoalType,
} from '../database/entities/roadmap-goal.entity.js';
import { PartnerOffer } from '../database/entities/partner-offer.entity.js';
import { FinancialFeatures } from '../open-finance/financial-features.model.js';

/**
 * How many MARKETING goals a user may hold at once. Sponsored content stays a
 * single, occasional suggestion — the task list must read as advice, not a feed.
 */
export const MAX_ACTIVE_MARKETING_GOALS = 1;

export interface MarketingEligibilityContext {
  /** The step the reassessment just determined for the user. */
  currentStep: number | null;
  /**
   * Deterministic financial projection. When null (e.g. the recommendation
   * endpoint, which has no report at hand) the profile-only signals below are
   * used instead and the numeric targeting thresholds are skipped.
   */
  features: FinancialFeatures | null;
  /** The user's `system_indicators` criteria score, used when `features` is null. */
  systemIndicatorsScore?: number | null;
  /** MARKETING goals the user already holds in ACTIVE state. */
  activeMarketingGoalCount: number;
}

/** Whether an offer is live today (active flag + validity window). */
export function isOfferLive(
  offer: PartnerOffer | null | undefined,
  now = new Date(),
): boolean {
  if (!offer || !offer.isActive) return false;
  if (!offer.partner?.isActive) return false;
  if (offer.validFrom && new Date(offer.validFrom) > now) return false;
  if (offer.validUntil && new Date(offer.validUntil) < now) return false;
  return true;
}

/** Any non-zero system flag marks instability — sponsored content is withheld. */
function hasDistressFlags(features: FinancialFeatures): boolean {
  const f = features.systemFlags;
  return (
    f.loanOverDueCount > 0 ||
    f.foreclosureCount > 0 ||
    f.alertNoticeCount > 0 ||
    f.akamCount > 0 ||
    f.cancelledCount > 0
  );
}

/**
 * The authoritative gate for surfacing a sponsored goal. The LLM prompt states
 * the same rules, but the model is never trusted with them: every MARKETING
 * goal it proposes is re-checked here before it is persisted.
 *
 * Non-marketing goals always pass — this function only narrows sponsored content.
 */
export function isMarketingGoalAllowed(
  goal: RoadmapGoal,
  context: MarketingEligibilityContext,
): boolean {
  if (goal.type !== RoadmapGoalType.MARKETING) return true;

  if (!isOfferLive(goal.offer)) return false;
  if (context.activeMarketingGoalCount >= MAX_ACTIVE_MARKETING_GOALS)
    return false;

  // Never monetise a user who is struggling or still finding their footing.
  if (context.currentStep === null || context.currentStep < 2) return false;

  const features = context.features;
  const targeting = goal.offer?.targeting ?? null;
  const distressBlocks = targeting?.requiresNoDistressFlags !== false;

  if (features) {
    if (!features.hasData) return false;
    if (features.monthlyNetCashFlow < 0) return false;
    if (distressBlocks && hasDistressFlags(features)) return false;
  } else if (
    distressBlocks &&
    context.systemIndicatorsScore != null &&
    context.systemIndicatorsScore < 3
  ) {
    return false;
  }

  if (!targeting) return true;

  if (
    targeting.minStep !== undefined &&
    context.currentStep < targeting.minStep
  )
    return false;
  if (
    targeting.maxStep !== undefined &&
    context.currentStep > targeting.maxStep
  )
    return false;

  // Monetary thresholds are only meaningful against a real financial report.
  if (features) {
    if (
      targeting.minMonthlySurplus !== undefined &&
      features.discretionarySurplus < targeting.minMonthlySurplus
    ) {
      return false;
    }
    if (
      targeting.minIdleBalance !== undefined &&
      features.currentBalance < targeting.minIdleBalance
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Applies {@link isMarketingGoalAllowed} across a candidate list while honouring
 * the global cap: allowed sponsored goals consume budget as they are accepted,
 * so at most `MAX_ACTIVE_MARKETING_GOALS` survive in total.
 */
export function filterMarketingGoals<T>(
  candidates: T[],
  context: MarketingEligibilityContext,
  resolve: (candidate: T) => RoadmapGoal | undefined,
): T[] {
  let marketingBudget = Math.max(
    0,
    MAX_ACTIVE_MARKETING_GOALS - context.activeMarketingGoalCount,
  );

  return candidates.filter((candidate) => {
    const goal = resolve(candidate);
    if (!goal || goal.type !== RoadmapGoalType.MARKETING) return true;
    if (marketingBudget <= 0) return false;
    if (
      !isMarketingGoalAllowed(goal, { ...context, activeMarketingGoalCount: 0 })
    ) {
      return false;
    }
    marketingBudget -= 1;
    return true;
  });
}
