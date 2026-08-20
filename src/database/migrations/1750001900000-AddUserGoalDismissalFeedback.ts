import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds user "not relevant" feedback to `user_goals`: when a user dismisses a
 * task they pick a structured reason, which is fed back into the goal-selection
 * prompts so future tasks avoid the same mismatch.
 *
 * Kept separate from `removal_reason` — that column is written by the
 * reconciliation LLM, and merging machine decisions with user feedback would
 * make the signal unusable.
 *
 * `up`   : create the reason enum type and add the three columns (idempotent).
 * `down` : drop the columns and the enum type.
 */
export class AddUserGoalDismissalFeedback1750001900000 implements MigrationInterface {
  name = 'AddUserGoalDismissalFeedback1750001900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no CREATE TYPE IF NOT EXISTS; swallow the duplicate instead.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_goals_dismissal_reason_enum" AS ENUM (
          'already_done',
          'no_budget',
          'no_time',
          'risk_mismatch',
          'too_complex',
          'not_relevant',
          'other'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "user_goals"
        ADD COLUMN IF NOT EXISTS "dismissal_reason" "user_goals_dismissal_reason_enum",
        ADD COLUMN IF NOT EXISTS "dismissal_note" text,
        ADD COLUMN IF NOT EXISTS "dismissed_at" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        DROP COLUMN IF EXISTS "dismissal_reason",
        DROP COLUMN IF EXISTS "dismissal_note",
        DROP COLUMN IF EXISTS "dismissed_at"
    `);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "user_goals_dismissal_reason_enum"`,
    );
  }
}
