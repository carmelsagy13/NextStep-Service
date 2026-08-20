import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a nullable JSONB `loss_aversion` column to `roadmap_states`, holding the
 * latest computed loss-aversion projection (money the user misses out on by not
 * advancing to the next stage). Written by the Open Finance analysis pipeline
 * and surfaced via GET /roadmap.
 *
 * `up`   : add `loss_aversion` (idempotent).
 * `down` : drop `loss_aversion`.
 */
export class AddRoadmapStateLossAversion1750001100000 implements MigrationInterface {
  name = 'AddRoadmapStateLossAversion1750001100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_states"
        ADD COLUMN IF NOT EXISTS "loss_aversion" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_states"
        DROP COLUMN IF EXISTS "loss_aversion"
    `);
  }
}
