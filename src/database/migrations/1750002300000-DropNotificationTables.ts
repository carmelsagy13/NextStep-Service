import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the notification tables. The feature was never finished — the module,
 * entities and endpoints are gone, so these tables are unreferenced.
 *
 * They were never created by a migration (only by an early `synchronize` run),
 * so they may not exist at all; `IF EXISTS` keeps this a no-op in that case.
 *
 * `up`   : drop both tables (child first, it FKs the templates table).
 * `down` : not reversible — the entities no longer exist to restore.
 */
export class DropNotificationTables1750002300000 implements MigrationInterface {
  name = 'DropNotificationTables1750002300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_templates"`);
  }

  public async down(): Promise<void> {
    // Irreversible: the notifications feature was removed entirely.
  }
}
