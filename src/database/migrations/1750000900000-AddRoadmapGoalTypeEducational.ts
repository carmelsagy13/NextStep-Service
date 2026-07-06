import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends the roadmap-goal type enum with a new value:
 *   - educational : goals whose purpose is to teach / inform the user.
 *
 * `up`   : add the enum value (idempotent via IF NOT EXISTS). Requires
 *          PostgreSQL 12+, where `ALTER TYPE ... ADD VALUE` is permitted inside
 *          a transaction (the new value is not referenced in this same
 *          transaction, which is the only PG restriction).
 * `down` : no-op. PostgreSQL has no `ALTER TYPE ... DROP VALUE`; removing an
 *          enum label safely would require recreating the type and rewriting
 *          every dependent column. Since adding an unused label is harmless and
 *          no rows can reference it yet, the down migration intentionally does
 *          nothing (mirrors the repo's other additive enum migrations).
 */
export class AddRoadmapGoalTypeEducational1750000900000
  implements MigrationInterface
{
  name = 'AddRoadmapGoalTypeEducational1750000900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "roadmap_goals_type_enum"
        ADD VALUE IF NOT EXISTS 'educational'
    `);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op — see the class doc comment.
  }
}
