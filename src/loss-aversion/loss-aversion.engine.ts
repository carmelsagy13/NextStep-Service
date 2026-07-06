import {
  LOSS_CURRENCY,
  PROJECTION_MONTHS,
} from './loss-aversion.constants.js';
import { Logger } from '@nestjs/common';
import {
  IdleSurplusStrategy,
  type LossAversionStrategy,
} from './loss-aversion.strategy.js';
import type {
  LossAversionContext,
  LossAversionResult,
  LossComponent,
} from './loss-aversion.types.js';

const logger = new Logger('LossAversion');

/**
 * Registry of active loss-aversion strategies. Extend this array to introduce
 * new loss dimensions — the engine aggregates whatever is registered.
 */
const STRATEGIES: LossAversionStrategy[] = [new IdleSurplusStrategy()];

/** Build the zeroed result used when there is no next stage or no usable data. */
function emptyResult(context: LossAversionContext): LossAversionResult {
  return {
    nextStepId: context.nextStage?.stepId ?? null,
    nextStepTitle: context.nextStage?.title ?? null,
    nextStepTitleHe: context.nextStage?.titleHe ?? null,
    annualLossAmount: 0,
    lossPercentage: 0,
    timeframeMonths: PROJECTION_MONTHS,
    currency: LOSS_CURRENCY,
    components: [],
    computedAt: new Date().toISOString(),
  };
}

/**
 * Compute the aggregate loss-aversion result for a user: how much money they are
 * missing out on by not advancing from their current stage to the next one.
 *
 * Pure and deterministic (aside from the `computedAt` timestamp). Returns a
 * zeroed result when the user is already at the top stage or the report carried
 * no usable financial data.
 */
export function computeLossAversion(
  context: LossAversionContext,
): LossAversionResult {
  const { features, currentStep, nextStage } = context;
  logger.log(
    `computeLossAversion: currentStep=${currentStep}, ` +
      `nextStage=${nextStage ? `${nextStage.stepId} (${nextStage.titleHe ?? nextStage.title ?? 'n/a'})` : 'null'}, ` +
      `hasData=${features.hasData}, monthlyIncome=${features.monthlyIncome}, ` +
      `discretionarySurplus=${features.discretionarySurplus}, monthlyDeposits=${features.monthlyDeposits}`,
  );

  if (!context.nextStage || !context.features.hasData) {
    logger.log(
      `RETURN empty result: ${!context.nextStage ? 'no next stage (already at top stage)' : 'features.hasData=false (no usable financial data)'}.`,
    );
    return emptyResult(context);
  }

  const components: LossComponent[] = [];
  for (const strategy of STRATEGIES) {
    const component = strategy.compute(context);
    if (component) {
      components.push(component);
    } else {
      logger.log(`strategy "${strategy.key}" returned no component.`);
    }
  }

  const annualLossAmount = components.reduce(
    (sum, c) => sum + c.annualAmount,
    0,
  );

  const monthlyIncome = context.features.monthlyIncome;
  const annualIncome = monthlyIncome * 12;
  const lossPercentage =
    annualIncome > 0
      ? Math.round((annualLossAmount / annualIncome) * 100 * 10) / 10
      : 0;

  logger.log(
    `AGGREGATE: components=[${components
      .map((c) => `${c.key}: annual=${c.annualAmount}`)
      .join('; ')}] => annualLoss=${annualLossAmount}, ` +
      `lossPercentage=${lossPercentage}% of annual income ${annualIncome}.`,
  );

  return {
    nextStepId: context.nextStage.stepId,
    nextStepTitle: context.nextStage.title,
    nextStepTitleHe: context.nextStage.titleHe,
    annualLossAmount,
    lossPercentage,
    timeframeMonths: PROJECTION_MONTHS,
    currency: LOSS_CURRENCY,
    components,
    computedAt: new Date().toISOString(),
  };
}
