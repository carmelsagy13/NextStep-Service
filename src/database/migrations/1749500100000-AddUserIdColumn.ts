import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a 9-character external identifier column `id` to `users`.
 *
 * The column is NOT NULL + UNIQUE in the final schema, so existing rows are
 * backfilled with deterministic, zero-padded unique values before the
 * constraints are applied. The column is added idempotently (IF NOT EXISTS) so
 * it is safe to run even when `synchronize: true` has already created it.
 */
export class AddUserIdColumn1749500100000 implements MigrationInterface {
  name = 'AddUserIdColumn1749500100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add as nullable so existing rows don't violate NOT NULL.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "id" varchar(9)
    `);

    // 2. Backfill existing rows with unique, zero-padded 9-char values.
    await queryRunner.query(`
      UPDATE "users" AS u
      SET "id" = LPAD(seq.rn::text, 9, '0')
      FROM (
        SELECT "user_id", ROW_NUMBER() OVER (ORDER BY "created_at") AS rn
        FROM "users"
        WHERE "id" IS NULL
      ) AS seq
      WHERE u."user_id" = seq."user_id"
    `);

    // 3. Enforce NOT NULL + UNIQUE now that every row has a value.
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "UQ_users_id" UNIQUE ("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT IF EXISTS "UQ_users_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "id"
    `);
  }
}
