import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a Hebrew title column (`title_he`) to `roadmap_steps` for the localized
 * step name shown to the user, alongside the existing (English/internal)
 * `title`. Nullable and left empty for content to be populated separately.
 *
 * `up`   : add `title_he` (idempotent).
 * `down` : drop `title_he`.
 */
export class AddRoadmapStepTitleHe1750000400000 implements MigrationInterface {
  name = 'AddRoadmapStepTitleHe1750000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_steps"
        ADD COLUMN IF NOT EXISTS "title_he" VARCHAR(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_steps"
        DROP COLUMN IF EXISTS "title_he"
    `);
  }
}
