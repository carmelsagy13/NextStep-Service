import { UserGoal } from '../database/entities/user-goal.entity.js';
import { RoadmapGoalType } from '../database/entities/roadmap-goal.entity.js';
import { PartnerOffer } from '../database/entities/partner-offer.entity.js';
import { isOfferLive } from '../common/marketing-goal-policy.js';
import { GoalResponseDto, MarketingMetaDto } from './dto/goal-response.dto.js';

const DEFAULT_ASSET_BASE_URL = 'http://localhost:3000/static';

export function resolveAssetBaseUrl(configured?: string): string {
  return (configured ?? DEFAULT_ASSET_BASE_URL).replace(/\/+$/, '');
}

/**
 * Partner copy is operator-supplied data, so the link is re-validated at the
 * serialization boundary — a `javascript:` or `data:` URL smuggled into the DB
 * must never reach an anchor tag on the client.
 */
function toSafeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function toAssetUrl(
  path: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return toSafeExternalUrl(path);
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
}

/**
 * Builds the marketing block, or returns null when the goal must degrade to a
 * plain one: offer expired/deactivated, unsafe CTA link, missing logo, or a
 * missing compliance disclaimer (which is never optional for sponsored content).
 */
function buildMarketingMeta(
  offer: PartnerOffer | null | undefined,
  baseUrl: string,
): MarketingMetaDto | null {
  if (!isOfferLive(offer) || !offer) return null;

  const ctaUrl = toSafeExternalUrl(offer.ctaUrl);
  const partnerLogoUrl = toAssetUrl(offer.partner?.logoPath, baseUrl);
  const disclaimer = offer.disclaimerHe?.trim();

  if (!ctaUrl || !partnerLogoUrl || !disclaimer) return null;

  return {
    offerCode: offer.code,
    partnerName: offer.partner.nameHe,
    partnerLogoUrl,
    bannerUrl: toAssetUrl(offer.bannerPath, baseUrl),
    brandColor: offer.partner.brandColor ?? null,
    headline: offer.headlineHe,
    subheadline: offer.subheadlineHe ?? null,
    benefitTags: offer.benefitTags ?? [],
    ctaLabel: offer.ctaLabelHe,
    ctaUrl,
    disclaimer,
  };
}

export function toGoalResponse(
  goal: UserGoal,
  assetBaseUrl: string,
): GoalResponseDto {
  const template = goal.roadmapGoal ?? null;
  const marketing = buildMarketingMeta(template?.offer, assetBaseUrl);

  const goalType =
    template?.type === RoadmapGoalType.MARKETING && !marketing
      ? RoadmapGoalType.PERSONAL
      : (template?.type ?? RoadmapGoalType.PERSONAL);

  return {
    goalId: goal.goalId,
    userId: goal.userId,
    roadmapGoalId: goal.roadmapGoalId ?? null,
    aspirationId: goal.aspirationId ?? null,
    goalName: goal.goalName,
    targetAmount: goal.targetAmount ?? null,
    currentAmount: goal.currentAmount,
    targetDate: goal.targetDate ? String(goal.targetDate) : null,
    status: goal.status,
    priority: goal.priority,
    assignedAt: goal.assignedAt ?? null,
    assignedAtStep: goal.assignedAtStep ?? null,
    completedAt: goal.completedAt ?? null,
    completedAtStep: goal.completedAtStep ?? null,
    removedAt: goal.removedAt ?? null,
    removalReason: goal.removalReason ?? null,
    dismissalReason: goal.dismissalReason ?? null,
    dismissalNote: goal.dismissalNote ?? null,
    dismissedAt: goal.dismissedAt ?? null,
    sourceProfileHistoryId: goal.sourceProfileHistoryId ?? null,
    aiInsight: goal.aiInsight ?? null,
    dynamicParams: goal.dynamicParams ?? null,
    goalType,
    marketing,
    roadmapGoal: template
      ? {
          goalId: template.goalId,
          stepId: template.stepId,
          criteria: template.criteria,
          type: goalType,
          title: template.title,
          descriptionTemplate: template.descriptionTemplate,
          dynamicParams: template.dynamicParams ?? null,
          requiredContext: template.requiredContext ?? null,
          isActive: template.isActive,
          priority: template.priority,
        }
      : undefined,
  };
}

export function toGoalResponseList(
  goals: UserGoal[],
  assetBaseUrl: string,
): GoalResponseDto[] {
  return goals.map((goal) => toGoalResponse(goal, assetBaseUrl));
}

/** Relations required for {@link toGoalResponse} to resolve partner metadata. */
export const GOAL_RESPONSE_RELATIONS = [
  'roadmapGoal',
  'roadmapGoal.offer',
  'roadmapGoal.offer.partner',
];
