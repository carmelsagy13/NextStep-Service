import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits the single `roadmap_steps.criteria` JSONB column into 8 per-criteria
 * JSONB columns — one for each granular financial dimension.
 *
 * Each new column holds a self-contained definition for that criteria at the
 * given step: `{ description, openFinanceData, questionnaireParameters }`.
 * - openFinanceData: free-text string with criteria definitions (formulas/thresholds).
 * - questionnaireParameters: structured key-value object for questionnaire mappings.
 * This gives the LLM explicit, criteria-scoped context so it can pinpoint the
 * user's current step per dimension and assign relevant goals.
 *
 * Schema-only change: the new columns are nullable and left empty for content
 * to be populated separately. The legacy `criteria` column is dropped.
 *
 * `up`   : add the 8 columns (idempotent), then drop `criteria`.
 * `down` : re-add `criteria` (nullable; data NOT restored), drop the 8 columns.
 */
export class SplitRoadmapStepCriteria1750000300000 implements MigrationInterface {
  name = 'SplitRoadmapStepCriteria1750000300000';

  private static readonly COLUMNS = [
    'loans',
    'mortgage',
    'cash_flow',
    'lifestyle_clubs',
    'pension_long_term',
    'system_indicators',
    'credit_consumption',
    'savings_investments',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of SplitRoadmapStepCriteria1750000300000.COLUMNS) {
      await queryRunner.query(`
        ALTER TABLE "roadmap_steps"
          ADD COLUMN IF NOT EXISTS "${column}" JSONB
      `);
    }
    await queryRunner.query(`
      ALTER TABLE "roadmap_steps"
        DROP COLUMN IF EXISTS "criteria"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_steps"
        ADD COLUMN IF NOT EXISTS "criteria" JSONB
    `);
    for (const column of SplitRoadmapStepCriteria1750000300000.COLUMNS) {
      await queryRunner.query(`
        ALTER TABLE "roadmap_steps"
          DROP COLUMN IF EXISTS "${column}"
      `);
    }
  }
}
