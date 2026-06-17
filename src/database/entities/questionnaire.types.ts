/**
 * Shared types & enums for the dynamic questionnaire engine.
 *
 * The questionnaire is fully DB-driven: screens, questions, options and the
 * conditional-rendering rules all live as editable rows. These types describe
 * the small, stable vocabulary the engine understands so that content can be
 * added/edited/removed via DB rows WITHOUT code changes or schema migrations.
 */

/**
 * Bilingual label stored as JSONB. `he` is authoritative (the product ships in
 * Hebrew); `en` is optional and consumed by clients that render English views.
 */
export interface LocalizedText {
  he: string;
  en?: string;
}

/** Supported answer/input widgets. */
export enum QuestionType {
  SINGLE_CHOICE = 'SINGLE_CHOICE',
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
}

/**
 * Comparison applied between a trigger question's submitted answer and the
 * dependency's `triggerValue` to decide whether a dependent question is shown.
 */
export enum DependencyOperator {
  /** Single-choice answer strictly equals triggerValue (string). */
  EQUALS = 'EQUALS',
  /** Single-choice answer differs from triggerValue (string). */
  NOT_EQUALS = 'NOT_EQUALS',
  /** Multiple-choice answer array contains triggerValue (string). */
  INCLUDES = 'INCLUDES',
  /** Numeric answer greater than triggerValue (number). */
  GT = 'GT',
  /** Numeric answer less than triggerValue (number). */
  LT = 'LT',
  /** Any non-empty answer was provided (triggerValue ignored). */
  EXISTS = 'EXISTS',
}

/** Lifecycle of a questionnaire submission header. */
export enum SubmissionStatus {
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
}

/**
 * Optional, schema-free validation constraints stored on a question (JSONB).
 * Interpreted by the service at ingestion time against the answer value.
 */
export interface QuestionValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** Minimum number of selected choices for a MULTIPLE_CHOICE question. */
  minItems?: number;
  /** Maximum number of selected choices for a MULTIPLE_CHOICE question. */
  maxItems?: number;
  /** Regular-expression source string applied to TEXT answers. */
  pattern?: string;
}

/** A persisted answer value. Shape depends on the question's type. */
export type AnswerValue = string | string[] | number;
