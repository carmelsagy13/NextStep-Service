import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestionnaireScreen } from '../database/entities/questionnaire-screen.entity.js';
import { QuestionnaireQuestion } from '../database/entities/questionnaire-question.entity.js';
import { QuestionnaireDependency } from '../database/entities/questionnaire-dependency.entity.js';
import { QuestionnaireSubmission } from '../database/entities/questionnaire-submission.entity.js';
import { QuestionnaireResponse } from '../database/entities/questionnaire-response.entity.js';
import {
  AnswerValue,
  DependencyOperator,
  LocalizedText,
  QuestionType,
  QuestionValidation,
  SubmissionStatus,
} from '../database/entities/questionnaire.types.js';
import { RespondQuestionnaireDto } from './dto/respond-questionnaire.dto.js';
import {
  AspirationsService,
  OnboardingGoalInput,
} from '../aspirations/aspirations.service.js';
import { UserAspirationStatus } from '../database/entities/user-aspiration.entity.js';
import { UserProfileService } from '../user-profile/user-profile.service.js';
import { computeRiskTolerance, isRiskQuestionKey } from './risk-tolerance.js';

/**
 * The overarching goals captured by the onboarding questionnaire are NO LONGER
 * persisted as questionnaire_responses — they are routed into the dedicated
 * aspiration store. These constants map the questionnaire's goal keys to the
 * goal_type_catalog codes.
 *
 * The parent MULTIPLE_CHOICE option values (car_purchase, wedding_event, …) are
 * already identical to the catalog codes, so only the per-goal amount/timeframe
 * sub-field prefixes need a mapping.
 */
const GOAL_PARENT_KEY = 'q_financial_goals';
const GOAL_SUBFIELD_PREFIX_TO_TYPE: Record<string, string> = {
  q_goal_car: 'car_purchase',
  q_goal_wedding: 'wedding_event',
  q_goal_home: 'home_equity',
  q_goal_trip: 'big_trip_sabbatical',
};
const GOAL_TYPE_TO_SUBFIELD_PREFIX: Record<string, string> = Object.fromEntries(
  Object.entries(GOAL_SUBFIELD_PREFIX_TO_TYPE).map(([prefix, code]) => [
    code,
    prefix,
  ]),
);

/** True for any questionnaire key that now lives in the aspiration store. */
function isGoalKey(key: string): boolean {
  return key === GOAL_PARENT_KEY || key.startsWith('q_goal_');
}

/** A dependency rule projected with the trigger's stable key for the client. */
export interface SerializedDependency {
  triggerQuestionKey: string;
  operator: DependencyOperator;
  value: AnswerValue | null;
  group: number;
}

export interface SerializedQuestion {
  questionKey: string;
  type: QuestionType;
  isRequired: boolean;
  orderIndex: number;
  text: LocalizedText;
  validation: QuestionValidation | null;
  options: Array<{ value: string; label: LocalizedText; orderIndex: number }>;
  /** Visibility rules for THIS question (empty = always visible). */
  dependencies: SerializedDependency[];
  /** Nested conditional sub-fields. */
  children: SerializedQuestion[];
}

export interface SerializedScreen {
  screenKey: string;
  orderIndex: number;
  title: LocalizedText;
  subtitle: LocalizedText | null;
  questions: SerializedQuestion[];
}

/** A single answer projected for LLM/analytics consumption. */
export interface QuestionnaireAnswerView {
  questionKey: string;
  /** Hebrew question text. */
  question: string;
  /**
   * The answer in human-readable form: choice values are resolved to their
   * Hebrew option labels; numbers/texts pass through unchanged.
   */
  answer: string | string[] | number;
}

/** The user's most recent completed questionnaire pass, flattened for prompts. */
export interface QuestionnaireSummary {
  version: number;
  submittedAt: Date | null;
  answers: QuestionnaireAnswerView[];
}

/** Field-level validation failure surfaced to the caller. */
interface ResponseError {
  questionKey: string;
  message: string;
}

/** A persisted answer projected for the client, keyed by stable question key. */
export interface SavedAnswer {
  questionKey: string;
  /** Raw stored value: string for SINGLE_CHOICE/TEXT, number for NUMBER, string[] for MULTIPLE_CHOICE. */
  value: AnswerValue;
}

/**
 * Builds the questionnaire block appended to LLM system prompts. Centralized so
 * the general explanation of what this data represents stays consistent across
 * every call site. Returns an empty string when the user has no submission, so
 * callers can append it unconditionally.
 */
export function buildQuestionnairePromptSection(
  summary: QuestionnaireSummary | null,
): string {
  if (!summary || summary.answers.length === 0) return '';

  return [
    '',
    '## Self-Reported Onboarding Questionnaire',
    'The user answered an onboarding questionnaire capturing OFF-PLATFORM context',
    'that the connected bank data cannot see — e.g. accounts at other banks,',
    'non-bank credit cards, off-platform savings/pension (study funds, provident,',
    'pension), investment real-estate, loans taken outside the bank, large annual',
    "expenses, and the user's own declared financial goals.",
    'Use these answers to COMPLEMENT the bank-derived figures and refine your',
    'assessment where the bank data is blind. The connected bank data remains',
    'authoritative for on-platform balances and cash flow — do NOT double-count an',
    'item that already appears in the financial features. Answers are in Hebrew.',
    JSON.stringify(summary.answers, null, 2),
  ].join('\n');
}

@Injectable()
export class QuestionnaireService {
  constructor(
    @InjectRepository(QuestionnaireScreen)
    private readonly screenRepo: Repository<QuestionnaireScreen>,
    @InjectRepository(QuestionnaireQuestion)
    private readonly questionRepo: Repository<QuestionnaireQuestion>,
    @InjectRepository(QuestionnaireSubmission)
    private readonly submissionRepo: Repository<QuestionnaireSubmission>,
    @InjectRepository(QuestionnaireResponse)
    private readonly responseRepo: Repository<QuestionnaireResponse>,
    private readonly aspirations: AspirationsService,
    private readonly userProfile: UserProfileService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // GET /questionnaire — render-ready, ordered, nested structure
  // ──────────────────────────────────────────────────────────────────────
  async getStructure(): Promise<{ screens: SerializedScreen[] }> {
    const [screens, questions] = await Promise.all([
      this.screenRepo.find({
        where: { isActive: true },
        order: { orderIndex: 'ASC' },
      }),
      this.questionRepo.find({
        where: { isActive: true },
        relations: { options: true, dependencies: true },
        order: { orderIndex: 'ASC' },
      }),
    ]);

    const idToKey = new Map<string, string>(
      questions.map((q) => [q.questionId, q.questionKey]),
    );

    const childrenByParent = new Map<string, QuestionnaireQuestion[]>();
    const topLevelByScreen = new Map<string, QuestionnaireQuestion[]>();
    for (const question of questions) {
      if (question.parentQuestionId) {
        const list = childrenByParent.get(question.parentQuestionId) ?? [];
        list.push(question);
        childrenByParent.set(question.parentQuestionId, list);
      } else {
        const list = topLevelByScreen.get(question.screenId) ?? [];
        list.push(question);
        topLevelByScreen.set(question.screenId, list);
      }
    }

    const serializeQuestion = (
      q: QuestionnaireQuestion,
    ): SerializedQuestion => ({
      questionKey: q.questionKey,
      type: q.type,
      isRequired: q.isRequired,
      orderIndex: q.orderIndex,
      text: q.text,
      validation: q.validation ?? null,
      options: (q.options ?? [])
        .filter((o) => o.isActive)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((o) => ({
          value: o.optionValue,
          label: o.label,
          orderIndex: o.orderIndex,
        })),
      dependencies: (q.dependencies ?? [])
        .filter((d) => d.isActive)
        .sort((a, b) => a.groupIndex - b.groupIndex)
        .map((d) => ({
          triggerQuestionKey: idToKey.get(d.triggerQuestionId) ?? '',
          operator: d.operator,
          value: d.triggerValue,
          group: d.groupIndex,
        })),
      children: (childrenByParent.get(q.questionId) ?? [])
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(serializeQuestion),
    });

    return {
      screens: screens.map((screen) => ({
        screenKey: screen.screenKey,
        orderIndex: screen.orderIndex,
        title: screen.title,
        subtitle: screen.subtitle ?? null,
        questions: (topLevelByScreen.get(screen.screenId) ?? [])
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map(serializeQuestion),
      })),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // POST /questionnaire/respond — validate against the live schema & persist
  // ──────────────────────────────────────────────────────────────────────
  async respond(userId: string, dto: RespondQuestionnaireDto) {
    const questions = await this.questionRepo.find({
      where: { isActive: true },
      relations: { options: true, dependencies: true },
    });

    const byKey = new Map<string, QuestionnaireQuestion>(
      questions.map((q) => [q.questionKey, q]),
    );
    const byId = new Map<string, QuestionnaireQuestion>(
      questions.map((q) => [q.questionId, q]),
    );

    // Load the user's previously-saved answers so a PARTIAL payload (e.g. only
    // the goal answers being edited) is validated against the user's FULL answer
    // set — visibility/required-ness still resolve correctly — and is upserted in
    // place without wiping the answers the client did not resend.
    const existing = await this.responseRepo.find({
      where: { userId },
      relations: { question: true },
    });
    const answers = new Map<string, AnswerValue>();
    for (const row of existing) {
      if (row.question) answers.set(row.question.questionKey, row.answerValue);
    }
    // Overarching goals live in the aspiration store, not questionnaire_responses.
    // Hydrate the goal-related keys from the user's current aspirations so a
    // partial edit of OTHER fields still validates (visibility/required-ness of
    // the goal questions resolves against the user's real, current goals).
    await this.hydrateGoalAnswers(userId, answers);
    // Overlay the incoming answers on top of the saved ones.
    for (const item of dto.answers) {
      answers.set(item.questionKey, item.value);
    }

    const errors: ResponseError[] = [];

    // 1) Reject unknown keys and answers for currently-hidden questions.
    for (const item of dto.answers) {
      const question = byKey.get(item.questionKey);
      if (!question) {
        errors.push({
          questionKey: item.questionKey,
          message: 'Unknown or inactive question.',
        });
        continue;
      }
      if (!this.isVisible(question, byId, byKey, answers)) {
        errors.push({
          questionKey: item.questionKey,
          message:
            'Answer provided for a question that is not currently visible.',
        });
        continue;
      }
      const typeError = this.validateAnswerType(question, item.value);
      if (typeError)
        errors.push({ questionKey: item.questionKey, message: typeError });
    }

    // 2) Enforce required-ness for every currently-visible question, evaluated
    //    against the merged answer set (saved + incoming).
    for (const question of questions) {
      if (!question.isRequired) continue;
      if (!this.isVisible(question, byId, byKey, answers)) continue;
      if (this.isEmpty(answers.get(question.questionKey))) {
        errors.push({
          questionKey: question.questionKey,
          message: 'This question is required.',
        });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Questionnaire validation failed',
        errors,
      });
    }

    // 3) Persist: reuse the user's latest submission so it always reflects the
    //    COMPLETE current answer set; only the first submission creates a header.
    let submission = await this.submissionRepo.findOne({
      where: { userId, status: SubmissionStatus.SUBMITTED },
      order: { version: 'DESC' },
    });
    if (!submission) {
      submission = await this.submissionRepo.save(
        this.submissionRepo.create({
          userId,
          version: 1,
          status: SubmissionStatus.SUBMITTED,
          submittedAt: new Date(),
        }),
      );
    } else {
      submission.submittedAt = new Date();
      await this.submissionRepo.save(submission);
    }

    // Upsert by (user_id, question_id) — i.e. by question key — bumping
    // updated_at on each affected row (raw upsert does not auto-touch it).
    const now = new Date();
    let persisted = 0;
    for (const item of dto.answers) {
      const question = byKey.get(item.questionKey)!;
      if (!this.isVisible(question, byId, byKey, answers)) continue;
      if (this.isEmpty(item.value)) continue;
      // Goal answers are routed to the aspiration store below — never persisted
      // as questionnaire_responses (single source of truth = aspiration store).
      if (isGoalKey(item.questionKey)) continue;

      await this.responseRepo.upsert(
        {
          userId,
          questionId: question.questionId,
          submissionId: submission.submissionId,
          answerValue: this.normalizeAnswer(question, item.value),
          updatedAt: now,
        },
        { conflictPaths: ['userId', 'questionId'] },
      );
      persisted += 1;
    }

    // Route the (merged) overarching goal answers into the aspiration store when
    // the payload touched any goal field. Idempotent: unchanged goals bump no
    // revision and trigger no task re-sync.
    if (dto.answers.some((a) => isGoalKey(a.questionKey))) {
      await this.aspirations.upsertFromOnboarding(
        userId,
        this.extractGoalSelections(answers),
      );
    }

    // Risk tolerance (Step 4): recompute whenever the payload touched any risk
    // question. Uses the merged answer set (saved + incoming) so a partial edit
    // of one risk answer still scores against the other two. computeRiskTolerance
    // returns null until all three answers are present, in which case we skip.
    if (dto.answers.some((a) => isRiskQuestionKey(a.questionKey))) {
      const risk = computeRiskTolerance(answers);
      if (risk) {
        await this.userProfile.updateRiskTolerance(userId, risk.category);
      }
    }

    return {
      message: 'Questionnaire submitted',
      submissionId: submission.submissionId,
      version: submission.version,
      persistedAnswers: persisted,
    };
  }

  /**
   * Reconstruct the questionnaire's goal answers (parent selection + per-goal
   * amount/timeframe) from the user's ACTIVE aspirations and seed them into the
   * merged answer map. Only fills keys the questionnaire defines; never
   * overwrites an answer already present.
   */
  private async hydrateGoalAnswers(
    userId: string,
    answers: Map<string, AnswerValue>,
  ): Promise<void> {
    const aspirations = await this.aspirations.getAspirations(userId);
    const active = aspirations.filter(
      (a) => a.status === UserAspirationStatus.ACTIVE,
    );
    if (!active.length) return;

    if (!answers.has(GOAL_PARENT_KEY)) {
      answers.set(
        GOAL_PARENT_KEY,
        active.map((a) => a.goalTypeCode),
      );
    }
    for (const a of active) {
      const prefix = GOAL_TYPE_TO_SUBFIELD_PREFIX[a.goalTypeCode];
      if (!prefix) continue;
      const amountKey = `${prefix}_amount`;
      const timeframeKey = `${prefix}_timeframe`;
      if (!answers.has(amountKey) && a.targetAmount != null) {
        answers.set(amountKey, Number(a.targetAmount));
      }
      const months = (a.attributes as { timeframeMonths?: number } | null)
        ?.timeframeMonths;
      if (!answers.has(timeframeKey) && months != null) {
        answers.set(timeframeKey, Number(months));
      }
    }
  }

  /**
   * Translate the merged goal answers into the aspiration upsert payload: each
   * selected option becomes a goal, carrying its amount/timeframe sub-fields
   * where present.
   */
  private extractGoalSelections(
    answers: Map<string, AnswerValue>,
  ): OnboardingGoalInput[] {
    const selected = answers.get(GOAL_PARENT_KEY);
    const codes = Array.isArray(selected) ? selected : [];
    return codes.map((code) => {
      const prefix = GOAL_TYPE_TO_SUBFIELD_PREFIX[code];
      const amount = prefix ? answers.get(`${prefix}_amount`) : undefined;
      const timeframe = prefix ? answers.get(`${prefix}_timeframe`) : undefined;
      return {
        goalTypeCode: code,
        targetAmount: amount != null ? Number(amount) : null,
        timeframeMonths: timeframe != null ? Number(timeframe) : null,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // GET /questionnaire/responses — the user's saved answers, keyed by question
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Returns the current user's saved answers as a flat { questionKey, value }
   * list, scoped to the user's most recent SUBMITTED submission so only the
   * latest pass is returned (never stale answers from older submissions).
   * Values are the raw stored shapes (string / number / string[]); the client
   * filters for the keys it cares about (e.g. the q_goal_* fields).
   */
  async getResponses(userId: string): Promise<{ responses: SavedAnswer[] }> {
    const submission = await this.submissionRepo.findOne({
      where: { userId, status: SubmissionStatus.SUBMITTED },
      order: { version: 'DESC' },
    });
    if (!submission) return { responses: [] };

    const rows = await this.responseRepo.find({
      where: { submissionId: submission.submissionId },
      relations: { question: true },
    });

    const responses = rows
      .filter((r) => r.question)
      .sort((a, b) => a.question.orderIndex - b.question.orderIndex)
      .map((r) => ({
        questionKey: r.question.questionKey,
        value: r.answerValue,
      }));

    return { responses };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Latest-submission summary — consumed by the LLM pipelines
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Returns the user's most recent SUBMITTED questionnaire pass as a flat,
   * human-readable list of answers (choice values resolved to Hebrew labels),
   * or `null` when the user has never completed the questionnaire.
   *
   * Answers are scoped to a single submission id, so conditionally-revealed
   * sub-fields belonging to that pass are naturally included and stale answers
   * from older passes are excluded.
   */
  async buildLatestSummary(
    userId: string,
  ): Promise<QuestionnaireSummary | null> {
    const submission = await this.submissionRepo.findOne({
      where: { userId, status: SubmissionStatus.SUBMITTED },
      order: { version: 'DESC' },
    });
    if (!submission) return null;

    const responses = await this.responseRepo.find({
      where: { submissionId: submission.submissionId },
      relations: { question: { options: true } },
    });

    const answers: QuestionnaireAnswerView[] = responses
      .filter((r) => r.question)
      .sort((a, b) => a.question.orderIndex - b.question.orderIndex)
      .map((r) => ({
        questionKey: r.question.questionKey,
        question: r.question.text.he,
        answer: this.toReadableAnswer(r.question, r.answerValue),
      }));

    return {
      version: submission.version,
      submittedAt: submission.submittedAt,
      answers,
    };
  }

  /** Resolves choice values to Hebrew option labels; passes numbers/text through. */
  private toReadableAnswer(
    question: QuestionnaireQuestion,
    value: AnswerValue,
  ): string | string[] | number {
    const labelOf = (optionValue: string): string => {
      const option = (question.options ?? []).find(
        (o) => o.optionValue === optionValue,
      );
      return option?.label.he ?? optionValue;
    };

    if (
      question.type === QuestionType.SINGLE_CHOICE &&
      typeof value === 'string'
    ) {
      return labelOf(value);
    }
    if (
      question.type === QuestionType.MULTIPLE_CHOICE &&
      Array.isArray(value)
    ) {
      return value.map(labelOf);
    }
    return value;
  }

  // ── Visibility resolution ─────────────────────────────────────────────

  /**
   * A question is visible when its parent (if any) is visible AND its own
   * dependency rules are satisfied. Rules sharing a group are AND-ed; separate
   * groups are OR-ed. No active rules → visible by default.
   */
  private isVisible(
    question: QuestionnaireQuestion,
    byId: Map<string, QuestionnaireQuestion>,
    byKey: Map<string, QuestionnaireQuestion>,
    answers: Map<string, AnswerValue>,
  ): boolean {
    if (question.parentQuestionId) {
      const parent = byId.get(question.parentQuestionId);
      if (parent && !this.isVisible(parent, byId, byKey, answers)) return false;
    }

    const rules = (question.dependencies ?? []).filter((d) => d.isActive);
    if (rules.length === 0) return true;

    const groups = new Map<number, QuestionnaireDependency[]>();
    for (const rule of rules) {
      const list = groups.get(rule.groupIndex) ?? [];
      list.push(rule);
      groups.set(rule.groupIndex, list);
    }

    // OR across groups, AND within a group.
    for (const groupRules of groups.values()) {
      const groupSatisfied = groupRules.every((rule) =>
        this.evaluateRule(rule, byId, answers),
      );
      if (groupSatisfied) return true;
    }
    return false;
  }

  private evaluateRule(
    rule: QuestionnaireDependency,
    byId: Map<string, QuestionnaireQuestion>,
    answers: Map<string, AnswerValue>,
  ): boolean {
    const trigger = byId.get(rule.triggerQuestionId);
    if (!trigger) return false;
    const answer = answers.get(trigger.questionKey);

    switch (rule.operator) {
      case DependencyOperator.EQUALS:
        return answer === rule.triggerValue;
      case DependencyOperator.NOT_EQUALS:
        return answer !== rule.triggerValue;
      case DependencyOperator.INCLUDES:
        return (
          Array.isArray(answer) && answer.includes(rule.triggerValue as string)
        );
      case DependencyOperator.GT:
        return (
          !this.isEmpty(answer) && Number(answer) > Number(rule.triggerValue)
        );
      case DependencyOperator.LT:
        return (
          !this.isEmpty(answer) && Number(answer) < Number(rule.triggerValue)
        );
      case DependencyOperator.EXISTS:
        return !this.isEmpty(answer);
      default:
        return false;
    }
  }

  // ── Value validation & normalization ──────────────────────────────────

  /** Returns an error message if the value's shape/content is invalid, else null. */
  private validateAnswerType(
    question: QuestionnaireQuestion,
    value: unknown,
  ): string | null {
    const v = question.validation ?? {};
    const optionValues = new Set(
      (question.options ?? [])
        .filter((o) => o.isActive)
        .map((o) => o.optionValue),
    );

    switch (question.type) {
      case QuestionType.SINGLE_CHOICE: {
        if (typeof value !== 'string')
          return 'Expected a single string choice.';
        if (!optionValues.has(value))
          return `"${value}" is not a valid option.`;
        return null;
      }
      case QuestionType.MULTIPLE_CHOICE: {
        if (!Array.isArray(value)) return 'Expected an array of choices.';
        if (!value.every((x) => typeof x === 'string'))
          return 'All choices must be strings.';
        const invalid = value.find((x) => !optionValues.has(x));
        if (invalid !== undefined) return `"${invalid}" is not a valid option.`;
        if (new Set(value).size !== value.length)
          return 'Duplicate choices are not allowed.';
        // Count constraints only apply once at least one choice is made; an
        // empty selection is governed by the required-ness check instead.
        if (
          value.length > 0 &&
          v.minItems !== undefined &&
          value.length < v.minItems
        ) {
          return `Select at least ${v.minItems} option(s).`;
        }
        if (v.maxItems !== undefined && value.length > v.maxItems) {
          return `Select at most ${v.maxItems} option(s).`;
        }
        return null;
      }
      case QuestionType.NUMBER: {
        const num = typeof value === 'number' ? value : Number(value);
        if (typeof value !== 'number' && (value === '' || Number.isNaN(num))) {
          return 'Expected a number.';
        }
        if (Number.isNaN(num)) return 'Expected a number.';
        if (v.min !== undefined && num < v.min)
          return `Must be at least ${v.min}.`;
        if (v.max !== undefined && num > v.max)
          return `Must be at most ${v.max}.`;
        return null;
      }
      case QuestionType.TEXT: {
        if (typeof value !== 'string') return 'Expected a text value.';
        if (v.minLength !== undefined && value.length < v.minLength) {
          return `Must be at least ${v.minLength} characters.`;
        }
        if (v.maxLength !== undefined && value.length > v.maxLength) {
          return `Must be at most ${v.maxLength} characters.`;
        }
        if (v.pattern !== undefined && !new RegExp(v.pattern).test(value)) {
          return 'Value does not match the required format.';
        }
        return null;
      }
      case QuestionType.DATE: {
        if (typeof value !== 'string') {
          return 'Expected an ISO-8601 date string (YYYY-MM-DD).';
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return 'Expected a date in YYYY-MM-DD format.';
        }
        // Reject impossible dates (e.g. 2026-02-30) by round-tripping.
        const parsed = new Date(`${value}T00:00:00Z`);
        if (
          Number.isNaN(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== value
        ) {
          return 'Expected a valid calendar date.';
        }
        return null;
      }
      case QuestionType.DURATION: {
        const num = typeof value === 'number' ? value : Number(value);
        if (typeof value !== 'number' && (value === '' || Number.isNaN(num))) {
          return 'Expected a whole number of months.';
        }
        if (Number.isNaN(num)) return 'Expected a whole number of months.';
        if (!Number.isInteger(num)) {
          return 'Duration must be a whole number of months.';
        }
        if (num < 0) return 'Duration must be zero or more months.';
        if (v.min !== undefined && num < v.min) {
          return `Must be at least ${v.min} month(s).`;
        }
        if (v.max !== undefined && num > v.max) {
          return `Must be at most ${v.max} month(s).`;
        }
        return null;
      }
      default:
        return 'Unsupported question type.';
    }
  }

  /** Coerces NUMBER/DURATION answers to a number; leaves other types as-is. */
  private normalizeAnswer(
    question: QuestionnaireQuestion,
    value: AnswerValue,
  ): AnswerValue {
    if (
      (question.type === QuestionType.NUMBER ||
        question.type === QuestionType.DURATION) &&
      typeof value === 'string'
    ) {
      return Number(value);
    }
    return value;
  }

  private isEmpty(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  }
}
