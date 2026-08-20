import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the dynamic questionnaire engine schema:
 *   questionnaire_screens
 *   questionnaire_questions      (self-referencing for nested sub-fields)
 *   questionnaire_options
 *   questionnaire_dependencies   (conditional-visibility rules)
 *   questionnaire_submissions    (optional audit header)
 *   questionnaire_responses      (per-user, per-question upsert target)
 *
 * Tables/enums/indexes are all created idempotently (IF NOT EXISTS / guarded
 * DO blocks) so the migration is safe to re-run. Once these tables exist, all
 * questionnaire CONTENT (screens, questions, options, rules) is editable via
 * plain row operations — no further migrations are required to evolve the form.
 */
export class CreateQuestionnaireSchema1750000000000 implements MigrationInterface {
  name = 'CreateQuestionnaireSchema1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Ensure uuid_generate_v4() is available for column defaults ─────────
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── Enums (guarded; CREATE TYPE has no IF NOT EXISTS) ──────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "questionnaire_questions_type_enum" AS ENUM
          ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TEXT', 'NUMBER');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "questionnaire_dependencies_operator_enum" AS ENUM
          ('EQUALS', 'NOT_EQUALS', 'INCLUDES', 'GT', 'LT', 'EXISTS');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "questionnaire_submissions_status_enum" AS ENUM
          ('in_progress', 'submitted');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // ── questionnaire_screens ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "questionnaire_screens" (
        "screen_id"  uuid NOT NULL DEFAULT uuid_generate_v4(),
        "screen_key" varchar(100) NOT NULL,
        "order_index" integer NOT NULL DEFAULT 0,
        "title"      jsonb NOT NULL,
        "subtitle"   jsonb,
        "is_active"  boolean NOT NULL DEFAULT true,
        "metadata"   jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_questionnaire_screens" PRIMARY KEY ("screen_id"),
        CONSTRAINT "uq_questionnaire_screens_key" UNIQUE ("screen_key")
      )
    `);

    // ── questionnaire_questions ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "questionnaire_questions" (
        "question_id"   uuid NOT NULL DEFAULT uuid_generate_v4(),
        "question_key"  varchar(100) NOT NULL,
        "screen_id"     uuid NOT NULL,
        "parent_question_id" uuid,
        "text"          jsonb NOT NULL,
        "type"          "questionnaire_questions_type_enum" NOT NULL,
        "is_required"   boolean NOT NULL DEFAULT true,
        "order_index"   integer NOT NULL DEFAULT 0,
        "validation"    jsonb,
        "is_active"     boolean NOT NULL DEFAULT true,
        "metadata"      jsonb,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_questionnaire_questions" PRIMARY KEY ("question_id"),
        CONSTRAINT "uq_questionnaire_questions_key" UNIQUE ("question_key"),
        CONSTRAINT "fk_questionnaire_questions_screen"
          FOREIGN KEY ("screen_id") REFERENCES "questionnaire_screens" ("screen_id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_questionnaire_questions_parent"
          FOREIGN KEY ("parent_question_id") REFERENCES "questionnaire_questions" ("question_id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_questionnaire_questions_screen"
        ON "questionnaire_questions" ("screen_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_questionnaire_questions_parent"
        ON "questionnaire_questions" ("parent_question_id")
    `);

    // ── questionnaire_options ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "questionnaire_options" (
        "option_id"    uuid NOT NULL DEFAULT uuid_generate_v4(),
        "question_id"  uuid NOT NULL,
        "option_value" varchar(100) NOT NULL,
        "label"        jsonb NOT NULL,
        "order_index"  integer NOT NULL DEFAULT 0,
        "is_active"    boolean NOT NULL DEFAULT true,
        "metadata"     jsonb,
        "created_at"   TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_questionnaire_options" PRIMARY KEY ("option_id"),
        CONSTRAINT "uq_option_question_value" UNIQUE ("question_id", "option_value"),
        CONSTRAINT "fk_questionnaire_options_question"
          FOREIGN KEY ("question_id") REFERENCES "questionnaire_questions" ("question_id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_questionnaire_options_question"
        ON "questionnaire_options" ("question_id")
    `);

    // ── questionnaire_dependencies ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "questionnaire_dependencies" (
        "dependency_id"       uuid NOT NULL DEFAULT uuid_generate_v4(),
        "question_id"         uuid NOT NULL,
        "trigger_question_id" uuid NOT NULL,
        "operator"            "questionnaire_dependencies_operator_enum" NOT NULL,
        "trigger_value"       jsonb,
        "group_index"         integer NOT NULL DEFAULT 0,
        "is_active"           boolean NOT NULL DEFAULT true,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_questionnaire_dependencies" PRIMARY KEY ("dependency_id"),
        CONSTRAINT "fk_questionnaire_dependencies_question"
          FOREIGN KEY ("question_id") REFERENCES "questionnaire_questions" ("question_id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_questionnaire_dependencies_trigger"
          FOREIGN KEY ("trigger_question_id") REFERENCES "questionnaire_questions" ("question_id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_questionnaire_dependencies_question"
        ON "questionnaire_dependencies" ("question_id")
    `);

    // ── questionnaire_submissions ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "questionnaire_submissions" (
        "submission_id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"       uuid NOT NULL,
        "version"       integer NOT NULL DEFAULT 1,
        "status"        "questionnaire_submissions_status_enum" NOT NULL DEFAULT 'submitted',
        "submitted_at"  TIMESTAMP,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_questionnaire_submissions" PRIMARY KEY ("submission_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_questionnaire_submissions_user"
        ON "questionnaire_submissions" ("user_id")
    `);

    // ── questionnaire_responses ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "questionnaire_responses" (
        "response_id"   uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"       uuid NOT NULL,
        "question_id"   uuid NOT NULL,
        "submission_id" uuid,
        "answer_value"  jsonb NOT NULL,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_questionnaire_responses" PRIMARY KEY ("response_id"),
        CONSTRAINT "uq_response_user_question" UNIQUE ("user_id", "question_id"),
        CONSTRAINT "fk_questionnaire_responses_question"
          FOREIGN KEY ("question_id") REFERENCES "questionnaire_questions" ("question_id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_questionnaire_responses_submission"
          FOREIGN KEY ("submission_id") REFERENCES "questionnaire_submissions" ("submission_id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_questionnaire_responses_user"
        ON "questionnaire_responses" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "questionnaire_responses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "questionnaire_submissions"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "questionnaire_dependencies"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "questionnaire_options"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "questionnaire_questions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "questionnaire_screens"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "questionnaire_submissions_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "questionnaire_dependencies_operator_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "questionnaire_questions_type_enum"`,
    );
  }
}
