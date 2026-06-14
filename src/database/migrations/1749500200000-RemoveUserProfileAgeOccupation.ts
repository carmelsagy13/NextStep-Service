import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the demographic columns `age` and `occupation` from `user_profiles`.
 *
 * Columns are dropped idempotently (IF EXISTS) so the migration is safe to run
 * even when `synchronize: true` has already removed them in development. The
 * `down` migration re-adds both as nullable columns to keep the schema change
 * reversible (existing data is not restored).
 */
export class RemoveUserProfileAgeOccupation1749500200000
  implements MigrationInterface
{
  name = 'RemoveUserProfileAgeOccupation1749500200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
        DROP COLUMN IF EXISTS "age",
        DROP COLUMN IF EXISTS "occupation"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
        ADD COLUMN IF NOT EXISTS "age" INTEGER,
        ADD COLUMN IF NOT EXISTS "occupation" VARCHAR(100)
    `);
  }
}
