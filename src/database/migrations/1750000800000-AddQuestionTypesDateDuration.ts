import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends the questionnaire question-type enum with two new input widgets:
 *   - DATE     : answer is an ISO-8601 calendar date string (`YYYY-MM-DD`).
 *   - DURATION : answer is an ISO-8601 duration string (e.g. `P6M`, `P2Y6M`).
 *
 * `up`   : add both enum values (idempotent via IF NOT EXISTS). Requires
 *          PostgreSQL 12+, where `ALTER TYPE ... ADD VALUE` is permitted inside
 *          a transaction (the new values are not referenced in this same
 *          transaction, which is the only PG restriction).
 * `down` : no-op. PostgreSQL has no `ALTER TYPE ... DROP VALUE`; removing an
 *          enum label safely would require recreating the type and rewriting
 *          every dependent column. Since adding an unused label is harmless and
 *          no rows can reference it yet, the down migration intentionally does
 *          nothing (mirrors the repo's other additive/data migrations).
 */
export class AddQuestionTypesDateDuration1750000800000
  implements MigrationInterface
{
  name = 'AddQuestionTypesDateDuration1750000800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "questionnaire_questions_type_enum"
        ADD VALUE IF NOT EXISTS 'DATE'
    `);
    await queryRunner.query(`
      ALTER TYPE "questionnaire_questions_type_enum"
        ADD VALUE IF NOT EXISTS 'DURATION'
    `);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op — see the class doc comment.
  }
}
