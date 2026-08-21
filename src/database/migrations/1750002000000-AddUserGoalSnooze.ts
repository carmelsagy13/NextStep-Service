import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds "snooze" to `user_goals`: the user defers a task to a date they choose
 * instead of dismissing it outright.
 *
 * Deliberately NOT a sixth `UserGoalStatus` value — a snoozed task is still
 * ACTIVE, just hidden until `snoozed_until` passes. Keeping it a plain timestamp
 * means every existing `status = 'active'` query keeps working unchanged, and
 * un-snoozing is a single column reset rather than a state transition that would
 * wipe the user's dismissal feedback.
 *
 * `up`   : add the column (idempotent).
 * `down` : drop it.
 */
export class AddUserGoalSnooze1750002000000 implements MigrationInterface {
  name = 'AddUserGoalSnooze1750002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        ADD COLUMN IF NOT EXISTS "snoozed_until" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        DROP COLUMN IF EXISTS "snoozed_until"
    `);
  }
}
