import { PROJECTION_MONTHS } from './loss-aversion.constants.js';
import { Logger } from '@nestjs/common';
import type {
  LossAversionContext,
  LossComponent,
} from './loss-aversion.types.js';

/**
 * A loss-aversion strategy computes one named money-loss component from the
 * user's financial features and stage context. Returning `null` means the
 * strategy does not apply (no loss to report for this user right now).
 *
 * Adding a new loss dimension later (debt interest, credit-card fees,
 * savings-rate gap, …) is as simple as implementing this interface and adding
 * the instance to the registry in `loss-aversion.engine.ts` — the engine and
 * the API payload require no changes.
 */
export interface LossAversionStrategy {
  readonly key: string;
  compute(context: LossAversionContext): LossComponent | null;
}

/**
 * v1 aggregate strategy: the idle discretionary surplus the user is NOT putting
 * to work.
 *
 * The share of monthly disposable income that is NOT already being channelled
 * into savings/investments (`discretionarySurplus - monthlyDeposits`) is money
 * left idle. Projected over a year (× 12), it is the amount the user COULD be
 * setting aside annually but currently isn't. We report this principal directly
 * — not a return on it — because "you're leaving ~X ₪ a year unused" is a
 * clearer, more tangible figure for the user than a small projected yield.
 */
export class IdleSurplusStrategy implements LossAversionStrategy {
  readonly key = 'idle_surplus';
  private readonly logger = new Logger('LossAversion:IdleSurplus');

  compute(context: LossAversionContext): LossComponent | null {
    const { features } = context;

    const idleMonthly = Math.max(
      0,
      features.discretionarySurplus - features.monthlyDeposits,
    );

    this.logger.log(
      `[idle_surplus] inputs: discretionarySurplus=${features.discretionarySurplus}, ` +
        `monthlyDeposits=${features.monthlyDeposits} => idleMonthly=max(0, ${features.discretionarySurplus} - ${features.monthlyDeposits})=${idleMonthly} ` +
        `(projectionMonths=${PROJECTION_MONTHS})`,
    );

    if (idleMonthly <= 0) {
      this.logger.log(
        `[idle_surplus] SKIPPED: idleMonthly=${idleMonthly} <= 0 (surplus fully deposited or negative). No loss component.`,
      );
      return null;
    }

    const annualAmount = Math.round(idleMonthly * PROJECTION_MONTHS);

    this.logger.log(
      `[idle_surplus] math: annualAmount=${idleMonthly} * ${PROJECTION_MONTHS}=${annualAmount}. ` +
        `NOTE: this is the idle surplus NOT put toward savings over a year (the principal itself, not a return on it).`,
    );

    return {
      key: this.key,
      label: 'Idle surplus not put toward savings this year',
      annualAmount,
    };
  }
}
