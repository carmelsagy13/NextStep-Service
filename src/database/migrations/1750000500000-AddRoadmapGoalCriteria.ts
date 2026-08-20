import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a `criteria` column to `roadmap_goals` for per-criteria goal scoping.
 *
 * Goals can now be tagged with one of the 8 financial criteria (cash_flow,
 * loans, mortgage, etc.). A criteria-tagged goal becomes eligible when the
 * user reaches `step_id` in that specific criteria (profile[criteria] >= step_id),
 * independently of their overall current step. NULL criteria = general goal
 * (matched by overall step as today).
 *
 * Example: A "loans" goal for step 2 shows once the user's loans score >= 2,
 * even if their overall step is 1.
 *
 * `up`   : add `criteria` column (nullable varchar).
 * `down` : drop `criteria` column.
 */
export class AddRoadmapGoalCriteria1750000500000 implements MigrationInterface {
  name = 'AddRoadmapGoalCriteria1750000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals"
        ADD COLUMN IF NOT EXISTS "criteria" VARCHAR(50)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals"
        DROP COLUMN IF EXISTS "criteria"
    `);
  }
}
