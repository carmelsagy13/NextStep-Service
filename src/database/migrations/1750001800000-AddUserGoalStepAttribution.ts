import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds step attribution to `user_goals`: `assigned_at_step` records the roadmap
 * step the user stood on when the task was handed out, `completed_at_step` the
 * step they stood on when they finished it. Without these the client can only
 * infer a step from `roadmap_goals.step_id`, which is an eligibility threshold
 * (criteria goals unlock below it) and is absent entirely for custom tasks.
 *
 * Existing rows are intentionally left NULL rather than guessed at; the client
 * falls back to the roadmap template's step for legacy history.
 *
 * `up`   : add both columns (idempotent).
 * `down` : drop both columns.
 */
export class AddUserGoalStepAttribution1750001800000 implements MigrationInterface {
  name = 'AddUserGoalStepAttribution1750001800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        ADD COLUMN IF NOT EXISTS "assigned_at_step" integer,
        ADD COLUMN IF NOT EXISTS "completed_at_step" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        DROP COLUMN IF EXISTS "assigned_at_step",
        DROP COLUMN IF EXISTS "completed_at_step"
    `);
  }
}
