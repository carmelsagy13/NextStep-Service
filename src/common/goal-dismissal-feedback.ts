import {
  GoalDismissalReason,
  UserGoal,
} from '../database/entities/user-goal.entity.js';

/**
 * English descriptors for the Hebrew reasons the user picks from. Prompt INPUT
 * is English throughout this codebase; only model output must be Hebrew.
 */
const REASON_DESCRIPTOR: Record<GoalDismissalReason, string> = {
  [GoalDismissalReason.ALREADY_DONE]:
    'the user says they already did this in the past',
  [GoalDismissalReason.NO_BUDGET]: 'the user has no budget for this right now',
  [GoalDismissalReason.NO_TIME]:
    'the user has no time or headspace for this right now',
  [GoalDismissalReason.RISK_MISMATCH]:
    "this does not match the user's risk preferences",
  [GoalDismissalReason.TOO_COMPLEX]: 'the user finds this task too complex',
  [GoalDismissalReason.NOT_RELEVANT]:
    'the user says this is not relevant to their situation',
  [GoalDismissalReason.OTHER]: 'other reason, see note',
};

/**
 * Builds the "not relevant" feedback block appended to goal-selection prompts.
 * Centralized so the guidance stays identical across every call site. Returns an
 * empty string when the user has dismissed nothing, so callers can append it
 * unconditionally.
 */
export function buildDismissalFeedbackSection(goals: UserGoal[]): string {
  const dismissed = goals.filter((g) => g.dismissalReason != null);
  if (!dismissed.length) return '';

  const entries = dismissed
    .map((g) =>
      [
        `  - title: "${g.goalName}"`,
        g.roadmapGoalId ? `    roadmap_goal_id: "${g.roadmapGoalId}"` : null,
        `    reason: ${REASON_DESCRIPTOR[g.dismissalReason!]}`,
        g.dismissalNote ? `    user_note: "${g.dismissalNote}"` : null,
        g.dismissedAt
          ? `    dismissed_at: ${g.dismissedAt instanceof Date ? g.dismissedAt.toISOString().slice(0, 10) : g.dismissedAt}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  return [
    '',
    '## Tasks The User Marked As NOT RELEVANT (direct user feedback — respect it)',
    'The user explicitly rejected these tasks and told us why. This is the',
    'strongest personalization signal we have: it describes a real constraint the',
    'financial data cannot show.',
    entries,
    '',
    'Apply it as follows:',
    '- Rank tasks that repeat a rejected PATTERN clearly lower, not just the exact',
    '  task that was rejected.',
    '- "no budget" ⇒ avoid tasks demanding a new or larger monthly outlay; prefer',
    '  ones that reorganize existing money or cut costs.',
    '- "no time" ⇒ prefer one-off or low-effort tasks over ongoing tracking habits.',
    '- "too complex" ⇒ prefer concrete, single-step tasks and write simpler',
    '  ai_insight text with less jargon.',
    '- "risk preferences" ⇒ avoid market-exposed or investment tasks; prefer',
    '  capital-preservation, buffer and debt-reduction tasks.',
    '- "already did this" ⇒ do not propose the same behaviour again; move the user',
    '  on to the next thing that builds on it.',
    '- "not relevant to their situation" ⇒ treat the whole topic as a weak fit.',
    'NEVER mention the rejection back to the user in any Hebrew text you write.',
    'This feedback NEVER overrides the financial data: it decides BETWEEN tasks of',
    'comparable merit and must not stop you selecting a task the numbers clearly',
    'demand (e.g. an emergency buffer for a user with none).',
  ].join('\n');
}
