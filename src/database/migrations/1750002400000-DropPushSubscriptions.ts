import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `push_subscriptions`, the web-push half of the removed notifications
 * feature. Like the notification tables it was never created by a migration —
 * only by an early `synchronize` run — and has no entity in the code.
 *
 * `up`   : drop the table.
 * `down` : not reversible — the feature was removed entirely.
 */
export class DropPushSubscriptions1750002400000 implements MigrationInterface {
  name = 'DropPushSubscriptions1750002400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "push_subscriptions"`);
  }

  public async down(): Promise<void> {
    // Irreversible: the push-notification feature was removed entirely.
  }
}
