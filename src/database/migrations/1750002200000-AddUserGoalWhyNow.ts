import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `why_now` to `user_goals`: one Hebrew sentence naming the concrete
 * figures that made this task the right one for this user at this moment.
 *
 * Separate from `ai_insight`, which explains WHAT to do — `why_now` explains WHY
 * the system chose it, and is the field the client shows behind the
 * "why is this my task?" expander.
 *
 * `up`   : add the column (idempotent).
 * `down` : drop it.
 */
export class AddUserGoalWhyNow1750002200000 implements MigrationInterface {
  name = 'AddUserGoalWhyNow1750002200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        ADD COLUMN IF NOT EXISTS "why_now" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        DROP COLUMN IF EXISTS "why_now"
    `);
  }
}
