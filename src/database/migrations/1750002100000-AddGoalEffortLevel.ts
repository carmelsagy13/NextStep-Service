import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an effort level to goals so the client can show "how much work is this"
 * and let the user filter for quick wins — a direct answer to the `no_time` and
 * `too_complex` dismissal reasons we already collect.
 *
 * Lives on BOTH tables on purpose: `roadmap_goals.effort_level` is the authored
 * default for a template, `user_goals.effort_level` is the per-user override the
 * reconciliation LLM may write when a user's parameters make the task materially
 * heavier or lighter. Resolution order (template fallback) happens in the goal
 * response mapper, so a NULL user value is never a problem.
 *
 * The seed below is a heuristic starting point over the 100+ existing templates
 * (which were not authored through migrations, so they cannot be enumerated by
 * title here): educational/marketing tasks are one-click, long-horizon financial
 * criteria are projects, everything else sits in the middle.
 *
 * `up`   : create the enum type, add both columns, seed template defaults.
 * `down` : drop the columns and the enum type.
 */
export class AddGoalEffortLevel1750002100000 implements MigrationInterface {
  name = 'AddGoalEffortLevel1750002100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no CREATE TYPE IF NOT EXISTS; swallow the duplicate instead.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "goal_effort_level_enum" AS ENUM (
          'quick',
          'moderate',
          'project'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "roadmap_goals"
        ADD COLUMN IF NOT EXISTS "effort_level" "goal_effort_level_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        ADD COLUMN IF NOT EXISTS "effort_level" "goal_effort_level_enum"
    `);

    await queryRunner.query(`
      UPDATE "roadmap_goals"
         SET "effort_level" = 'quick'
       WHERE "effort_level" IS NULL
         AND "type" IN ('educational', 'marketing')
    `);
    await queryRunner.query(`
      UPDATE "roadmap_goals"
         SET "effort_level" = 'project'
       WHERE "effort_level" IS NULL
         AND "criteria" IN ('mortgage', 'pension_long_term', 'savings_investments')
    `);
    await queryRunner.query(`
      UPDATE "roadmap_goals"
         SET "effort_level" = 'moderate'
       WHERE "effort_level" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        DROP COLUMN IF EXISTS "effort_level"
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals"
        DROP COLUMN IF EXISTS "effort_level"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "goal_effort_level_enum"`);
  }
}
