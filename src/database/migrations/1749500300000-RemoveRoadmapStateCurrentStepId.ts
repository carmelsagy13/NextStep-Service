import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the duplicated `current_step_id` column from `roadmap_states`.
 *
 * `user_profiles.current_step` is now the single source of truth for the user's
 * current financial step. Before dropping the column, any profile that is still
 * missing a step is backfilled from the roadmap state so no user loses their
 * step. The drop is idempotent (IF EXISTS); the `down` migration re-adds the
 * column as nullable (data is not restored).
 */
export class RemoveRoadmapStateCurrentStepId1749500300000 implements MigrationInterface {
  name = 'RemoveRoadmapStateCurrentStepId1749500300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "user_profiles" up
        SET "current_step" = rs."current_step_id"
        FROM "roadmap_states" rs
        WHERE rs."user_id" = up."user_id"
          AND up."current_step" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_states"
        DROP COLUMN IF EXISTS "current_step_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_states"
        ADD COLUMN IF NOT EXISTS "current_step_id" INTEGER
    `);
  }
}
