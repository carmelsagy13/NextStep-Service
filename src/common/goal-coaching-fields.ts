import { GoalEffortLevel } from '../database/entities/goal-effort-level.enum.js';

/** Longest `why_now` we persist; protects the client card from a runaway model. */
const WHY_NOW_MAX_LENGTH = 300;

const EFFORT_LEVELS = new Set<string>(Object.values(GoalEffortLevel));

/**
 * Coerces an LLM-supplied effort level to the enum. Anything unrecognized
 * becomes NULL so the response mapper falls back to the template's authored
 * value rather than persisting a hallucinated one.
 */
export function parseEffortLevel(raw: unknown): GoalEffortLevel | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return EFFORT_LEVELS.has(value) ? (value as GoalEffortLevel) : null;
}

/** Trims and clamps an LLM-supplied `why_now`; empty input becomes NULL. */
export function normalizeWhyNow(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  return value.length > WHY_NOW_MAX_LENGTH
    ? value.slice(0, WHY_NOW_MAX_LENGTH).trimEnd()
    : value;
}

/**
 * Shared prompt guidance for the two coaching fields every goal-producing prompt
 * must now emit. Centralized so the wording cannot drift between the initial
 * selection, the reconciliation and the aspiration-sync prompts.
 */
export const COACHING_FIELDS_GUIDANCE = [
  '## why_now and effort_level (required on every goal you emit)',
  '- `why_now`: ONE short Hebrew sentence, max 120 characters, naming the 2-3',
  '  concrete figures from the financial features block that make this task the',
  '  right one for this user RIGHT NOW. NEVER invent a figure — use only values',
  '  present in the features block. Write it in the SECOND PERSON, addressed to',
  '  the user. It must explain WHY THIS TASK WAS CHOSEN, not what to do (that is',
  '  what ai_insight is for), and must never repeat the ai_insight text.',
  '- `effort_level`: exactly one of `quick` | `moderate` | `project`.',
  '  `quick` = a few minutes in one sitting, `moderate` = about half an hour or a',
  '  short ongoing habit, `project` = a multi-session effort over weeks.',
  "  Copy the template's effort_level unless THIS user's parameters make the task",
  '  materially heavier or lighter (e.g. a much larger target amount).',
].join('\n');
