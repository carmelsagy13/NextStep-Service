import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces the sponsored-content store backing MARKETING roadmap goals.
 *
 * Creates:
 *  - `partners`       : commercial partner branding (name, logo, accent colour).
 *  - `partner_offers` : time-bound campaigns — headline, benefit tags, affiliate
 *                       CTA link, compliance disclaimer and declarative
 *                       `targeting` conditions.
 *
 * Alters:
 *  - `roadmap_goals`  : adds `offer_id` (FK → partner_offers) plus a CHECK
 *                       constraint enforcing the invariant
 *                       `type = 'marketing'` ⟺ `offer_id IS NOT NULL`.
 *
 * `roadmap_goals` deliberately stays the single catalog goals are authored in;
 * it only references the campaign so terms can expire without touching copy.
 *
 * Pre-existing rows typed 'marketing' predate this model and have no offer, so
 * they are reclassified to 'personal'. `down()` cannot distinguish them
 * afterwards and therefore leaves them as 'personal'.
 *
 * The `marketing` label already exists on `roadmap_goals_type_enum`, so no
 * `ALTER TYPE ... ADD VALUE` is needed (which also keeps this migration safe to
 * run in the same transaction as the seed that follows it).
 */
export class AddPartnerOffers1750001300000 implements MigrationInterface {
  name = 'AddPartnerOffers1750001300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "partners" (
        "partner_id"  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "code"        VARCHAR(50)  NOT NULL UNIQUE,
        "name"        VARCHAR(120) NOT NULL,
        "name_he"     VARCHAR(120) NOT NULL,
        "logo_path"   VARCHAR(255) NOT NULL,
        "brand_color" VARCHAR(9),
        "website_url" TEXT,
        "is_active"   BOOLEAN   NOT NULL DEFAULT true,
        "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "partner_offers" (
        "offer_id"        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "partner_id"      UUID NOT NULL,
        "code"            VARCHAR(80)  NOT NULL UNIQUE,
        "headline_he"     VARCHAR(160) NOT NULL,
        "subheadline_he"  VARCHAR(255),
        "benefit_tags"    JSONB,
        "cta_label_he"    VARCHAR(60)  NOT NULL,
        "cta_url"         TEXT         NOT NULL,
        "banner_path"     VARCHAR(255),
        "disclaimer_he"   TEXT,
        "valid_from"      DATE,
        "valid_until"     DATE,
        "targeting"       JSONB,
        "priority"        INT       NOT NULL DEFAULT 0,
        "is_active"       BOOLEAN   NOT NULL DEFAULT true,
        "created_at"      TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_partner_offers_partner"
          FOREIGN KEY ("partner_id") REFERENCES "partners" ("partner_id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_partner_offers_active"
        ON "partner_offers" ("is_active", "priority")
    `);

    await queryRunner.query(`
      ALTER TABLE "roadmap_goals" ADD COLUMN IF NOT EXISTS "offer_id" UUID
    `);

    // Rows typed 'marketing' before this model existed carry no partner offer,
    // so they are plain tasks that were mislabelled — reclassify them.
    await queryRunner.query(`
      UPDATE "roadmap_goals"
        SET "type" = 'personal'
        WHERE "type" = 'marketing' AND "offer_id" IS NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_roadmap_goals_offer'
        ) THEN
          ALTER TABLE "roadmap_goals"
            ADD CONSTRAINT "fk_roadmap_goals_offer"
            FOREIGN KEY ("offer_id") REFERENCES "partner_offers" ("offer_id")
            ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    // A marketing goal is meaningless without an offer, and a non-marketing goal
    // must never carry one — keep both halves enforced by the database.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_roadmap_goals_marketing_offer'
        ) THEN
          ALTER TABLE "roadmap_goals"
            ADD CONSTRAINT "chk_roadmap_goals_marketing_offer"
            CHECK (
              ("type" = 'marketing' AND "offer_id" IS NOT NULL)
              OR ("type" <> 'marketing' AND "offer_id" IS NULL)
            );
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals"
        DROP CONSTRAINT IF EXISTS "chk_roadmap_goals_marketing_offer"
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals" DROP CONSTRAINT IF EXISTS "fk_roadmap_goals_offer"
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals" DROP COLUMN IF EXISTS "offer_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_partner_offers_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "partner_offers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "partners"`);
  }
}
