import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds audit timestamp columns to `user_profiles`:
 *   created_at — set when a profile is first created (@CreateDateColumn)
 *   updated_at — refreshed on every profile modification (@UpdateDateColumn)
 *
 * Columns are added idempotently (IF NOT EXISTS) so the migration is safe to
 * run even when `synchronize: true` has already created them in development.
 * Existing rows are backfilled with the current timestamp so no NULLs remain.
 */
export class AddUserProfileTimestamps1749500000000
  implements MigrationInterface
{
  name = 'AddUserProfileTimestamps1749500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP NOT NULL DEFAULT now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profiles"
        DROP COLUMN IF EXISTS "created_at",
        DROP COLUMN IF EXISTS "updated_at"
    `);
  }
}
