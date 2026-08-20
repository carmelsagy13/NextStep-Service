import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces the dedicated overarching-goal ("aspiration") store, replacing the
 * practice of persisting user goals as `q_financial_goals` answers inside
 * `questionnaire_responses`.
 *
 * Creates:
 *  - `goal_type_catalog`  : data-driven catalog of goal TYPES + their dynamic
 *                           attribute schema (adding a goal type is now an
 *                           INSERT here, not a questionnaire schema change).
 *  - `user_aspirations`   : per-user overarching goal instances with a free-form
 *                           `attributes` JSONB and a `revision` change counter.
 *
 * Alters:
 *  - `user_goals`         : adds `aspiration_id` (FK → user_aspirations, the
 *                           explicit task↔aspiration link) and
 *                           `synced_aspiration_revision` (staleness marker).
 *
 * Seeds `goal_type_catalog` from the 6 existing `q_financial_goals` options so
 * the new store is immediately usable. SCHEMA + SEED ONLY — the data backfill
 * from questionnaire_responses is a separate, later migration.
 */
export class AddAspirationStore1750000600000 implements MigrationInterface {
  name = 'AddAspirationStore1750000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure uuid_generate_v4() is available for the aspiration_id default.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── goal_type_catalog ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "goal_type_catalog" (
        "code"             VARCHAR(100) PRIMARY KEY,
        "label"            JSONB        NOT NULL,
        "category"         VARCHAR(50),
        "supports_amount"  BOOLEAN      NOT NULL DEFAULT true,
        "supports_timeframe" BOOLEAN    NOT NULL DEFAULT true,
        "attribute_schema" JSONB,
        "default_priority" INT          NOT NULL DEFAULT 0,
        "is_active"        BOOLEAN      NOT NULL DEFAULT true,
        "created_at"       TIMESTAMP    NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMP    NOT NULL DEFAULT now()
      )
    `);

    // ── user_aspirations ─────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_aspirations_status_enum') THEN
          CREATE TYPE "user_aspirations_status_enum" AS ENUM ('active', 'achieved', 'abandoned');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_aspirations" (
        "aspiration_id"         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id"               UUID NOT NULL,
        "goal_type_code"        VARCHAR(100) NOT NULL,
        "title"                 VARCHAR(255) NOT NULL,
        "target_amount"         DECIMAL(12,2),
        "target_date"           DATE,
        "attributes"            JSONB,
        "status"                "user_aspirations_status_enum" NOT NULL DEFAULT 'active',
        "revision"              INT NOT NULL DEFAULT 1,
        "last_synced_revision"  INT,
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uq_user_aspiration_type" UNIQUE ("user_id", "goal_type_code"),
        CONSTRAINT "fk_user_aspiration_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE,
        CONSTRAINT "fk_user_aspiration_goal_type"
          FOREIGN KEY ("goal_type_code") REFERENCES "goal_type_catalog" ("code") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_aspirations_user_id"
        ON "user_aspirations" ("user_id")
    `);

    // ── user_goals: task ↔ aspiration link ───────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        ADD COLUMN IF NOT EXISTS "aspiration_id" UUID,
        ADD COLUMN IF NOT EXISTS "synced_aspiration_revision" INT
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_goal_aspiration'
        ) THEN
          ALTER TABLE "user_goals"
            ADD CONSTRAINT "fk_user_goal_aspiration"
            FOREIGN KEY ("aspiration_id") REFERENCES "user_aspirations" ("aspiration_id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // ── Seed the catalog from the 6 existing q_financial_goals options ────
    const timeframeAttr = JSON.stringify([
      {
        key: 'timeframeMonths',
        type: 'number',
        required: false,
        label: { he: 'טווח זמן (בחודשים)', en: 'Timeframe (months)' },
      },
    ]);

    const goalTypes: Array<{
      code: string;
      labelHe: string;
      labelEn: string;
      category: string;
      supportsAmount: boolean;
      supportsTimeframe: boolean;
      attributeSchema: string | null;
      priority: number;
    }> = [
      {
        code: 'car_purchase',
        labelHe: 'רכישת רכב',
        labelEn: 'Car purchase',
        category: 'short_term',
        supportsAmount: true,
        supportsTimeframe: true,
        attributeSchema: timeframeAttr,
        priority: 1,
      },
      {
        code: 'wedding_event',
        labelHe: 'חתונה / אירוע משפחתי גדול',
        labelEn: 'Wedding / large family event',
        category: 'short_term',
        supportsAmount: true,
        supportsTimeframe: true,
        attributeSchema: timeframeAttr,
        priority: 2,
      },
      {
        code: 'home_equity',
        labelHe: 'הון עצמי לדירה (לקניית נכס)',
        labelEn: 'Home equity (for buying property)',
        category: 'mid_term',
        supportsAmount: true,
        supportsTimeframe: true,
        attributeSchema: timeframeAttr,
        priority: 3,
      },
      {
        code: 'big_trip_sabbatical',
        labelHe: 'טיול גדול בחו"ל / שנת שבתון',
        labelEn: 'Big trip abroad / sabbatical year',
        category: 'mid_term',
        supportsAmount: true,
        supportsTimeframe: true,
        attributeSchema: timeframeAttr,
        priority: 4,
      },
      {
        code: 'safety_net',
        labelHe: 'יצירת רשת ביטחון ("כסף ליום סגריר") – ללא יעד ספציפי.',
        labelEn: 'Build a safety net ("rainy-day money") – no specific target.',
        category: 'long_term',
        supportsAmount: false,
        supportsTimeframe: false,
        attributeSchema: null,
        priority: 5,
      },
      {
        code: 'early_retirement',
        labelHe: 'פרישה מוקדמת / עצמאות כלכלית מלאה (טווח ארוך).',
        labelEn: 'Early retirement / full financial independence (long term).',
        category: 'long_term',
        supportsAmount: false,
        supportsTimeframe: false,
        attributeSchema: null,
        priority: 6,
      },
    ];

    for (const g of goalTypes) {
      await queryRunner.query(
        `
        INSERT INTO "goal_type_catalog"
          ("code", "label", "category", "supports_amount", "supports_timeframe", "attribute_schema", "default_priority", "is_active")
        VALUES ($1, $2::jsonb, $3, $4, $5, $6::jsonb, $7, true)
        ON CONFLICT ("code") DO NOTHING
        `,
        [
          g.code,
          JSON.stringify({ he: g.labelHe, en: g.labelEn }),
          g.category,
          g.supportsAmount,
          g.supportsTimeframe,
          g.attributeSchema,
          g.priority,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        DROP CONSTRAINT IF EXISTS "fk_user_goal_aspiration"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_goals"
        DROP COLUMN IF EXISTS "synced_aspiration_revision",
        DROP COLUMN IF EXISTS "aspiration_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_aspirations"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "user_aspirations_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "goal_type_catalog"`);
  }
}
