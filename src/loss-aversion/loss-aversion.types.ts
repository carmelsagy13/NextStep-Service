import type { FinancialFeatures } from '../open-finance/financial-features.model.js';

/**
 * Loss-Aversion feature: quantifies, in money, what a user is missing out on by
 * NOT advancing from their current roadmap stage to the next one. This module is
 * a pure, isolated engine (no NestJS DI) so it can be unit-tested in isolation
 * and reused wherever the financial features + stage context are available.
 *
 * All monetary values are in ILS and rounded to whole shekels (consistent with
 * FinancialFeatures).
 */

/** Minimal view of the next roadmap stage the user could advance to. */
export interface NextStageInfo {
  stepId: number;
  title: string | null;
  titleHe: string | null;
}

/** Everything a strategy needs to compute a loss component for the user. */
export interface LossAversionContext {
  features: FinancialFeatures;
  currentStep: number;
  /** The stage immediately above the current one, or null if already at the top. */
  nextStage: NextStageInfo | null;
}

/**
 * A single, named contribution to the total loss. The strategy pattern lets us
 * add richer components later (debt interest, card fees, savings-gap, …) without
 * touching the engine or the payload shape.
 */
export interface LossComponent {
  /** Stable machine key, e.g. "idle_surplus". */
  key: string;
  /** Human-readable label for the frontend. */
  label: string;
  /** Money lost over a year attributable to this component (ILS). */
  annualAmount: number;
}

/** The aggregate loss-aversion result persisted and returned to the client. */
export interface LossAversionResult {
  /** Next stage the user could reach, or null when already at the top stage. */
  nextStepId: number | null;
  nextStepTitle: string | null;
  nextStepTitleHe: string | null;
  /** Total money lost over a year across all components (ILS). */
  annualLossAmount: number;
  /** Annual loss as a percentage of annual income (0 when income is 0). */
  lossPercentage: number;
  /** Window the annual figure is projected over, in months (always 12). */
  timeframeMonths: number;
  currency: 'ILS';
  /** Per-component breakdown (empty when no loss is computed). */
  components: LossComponent[];
  /** ISO-8601 timestamp of when this result was computed. */
  computedAt: string;
}
