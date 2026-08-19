import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the first two commercial partners, their offers, and the matching
 * MARKETING rows in `roadmap_goals`.
 *
 * The goals are criteria-scoped (`savings_investments` / `pension_long_term`) at
 * step 3, so they only become eligible for users who already have a stable cash
 * flow — a user in distress can never reach them. `targeting` adds a second,
 * numeric gate that `isMarketingGoalAllowed` enforces at reconciliation time.
 *
 * Idempotent: every INSERT is keyed on the stable `code` / title.
 */
export class SeedMarketingGoals1750001500000 implements MigrationInterface {
  name = 'SeedMarketingGoals1750001500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "partners" ("code", "name", "name_he", "logo_path", "brand_color", "website_url")
      VALUES
        ('phoenix', 'The Phoenix', 'הפניקס', 'partners/phoenix/logo.png', '#FD5C1D', 'https://www.fnx.co.il'),
        ('migdal',  'Migdal',      'מגדל',   'partners/migdal/logo.svg',  '#0B4EA2', 'https://www.migdal.co.il')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "partner_offers" (
        "partner_id", "code", "headline_he", "subheadline_he", "benefit_tags",
        "cta_label_he", "cta_url", "disclaimer_he", "targeting", "priority"
      )
      SELECT
        p."partner_id",
        'phoenix_investment_account',
        'תיק השקעות מנוהל בתנאים מיוחדים ללקוחות NextStep',
        'פתיחת חשבון מקוונת, ללא מינימום הפקדה ראשוני',
        '["0% דמי ניהול בשנה הראשונה", "פתיחת חשבון דיגיטלית", "ליווי יועץ אישי"]'::jsonb,
        'לפרטים ולפתיחת חשבון',
        'https://www.fnx.co.il/investments?utm_source=nextstep&utm_medium=roadmap&utm_campaign=investment_account',
        'תוכן שיווקי בחסות הפניקס. אין באמור ייעוץ או שיווק השקעות המתחשב בנתוניך האישיים. הטבות בכפוף לתנאי המבצע ולתקנון החברה.',
        '{"minStep": 3, "minMonthlySurplus": 1000, "requiresNoDistressFlags": true}'::jsonb,
        10
      FROM "partners" p
      WHERE p."code" = 'phoenix'
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "partner_offers" (
        "partner_id", "code", "headline_he", "subheadline_he", "benefit_tags",
        "cta_label_he", "cta_url", "disclaimer_he", "targeting", "priority"
      )
      SELECT
        p."partner_id",
        'migdal_provident_fund',
        'קופת גמל להשקעה בדמי ניהול מוזלים',
        'חיסכון גמיש לטווח בינוני-ארוך, עם אפשרות משיכה בכל עת',
        '["דמי ניהול מוזלים", "משיכה בכל עת", "הטבת מס בפרישה"]'::jsonb,
        'בדיקת זכאות והצטרפות',
        'https://www.migdal.co.il/provident?utm_source=nextstep&utm_medium=roadmap&utm_campaign=provident_fund',
        'תוכן שיווקי בחסות מגדל. אין באמור ייעוץ פנסיוני המתחשב בנתוניך האישיים. הטבות בכפוף לתנאי המבצע ולתקנון החברה.',
        '{"minStep": 3, "minMonthlySurplus": 750, "requiresNoDistressFlags": true}'::jsonb,
        20
      FROM "partners" p
      WHERE p."code" = 'migdal'
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "roadmap_goals" (
        "step_id", "criteria", "type", "title", "description_template",
        "dynamic_params", "required_context_text", "is_active", "priority", "offer_id"
      )
      SELECT
        3,
        'savings_investments',
        'marketing',
        'פתיחת תיק השקעות מנוהל',
        'יש לך כ-{{monthly_surplus}} ₪ פנויים בחודש שאינם מושקעים. פתיחת תיק השקעות מנוהל יכולה להתחיל להעביר את הכסף הזה לעבוד עבורך.',
        '{"monthly_surplus": null, "idle_balance": null}'::jsonb,
        'להצגה רק כאשר קיים עודף חודשי יציב שאינו מושקע',
        true,
        90,
        o."offer_id"
      FROM "partner_offers" o
      WHERE o."code" = 'phoenix_investment_account'
        AND NOT EXISTS (
          SELECT 1 FROM "roadmap_goals" g WHERE g."offer_id" = o."offer_id"
        )
    `);

    await queryRunner.query(`
      INSERT INTO "roadmap_goals" (
        "step_id", "criteria", "type", "title", "description_template",
        "dynamic_params", "required_context_text", "is_active", "priority", "offer_id"
      )
      SELECT
        3,
        'pension_long_term',
        'marketing',
        'פתיחת קופת גמל להשקעה',
        'הפקדה חודשית של כ-{{monthly_amount}} ₪ לקופת גמל להשקעה יכולה לשמש כאפיק חיסכון גמיש לטווח הבינוני, לצד החיסכון הפנסיוני הקיים.',
        '{"monthly_amount": null}'::jsonb,
        'להצגה רק כאשר קיים עודף חודשי יציב וחיסכון פנסיוני פעיל',
        true,
        95,
        o."offer_id"
      FROM "partner_offers" o
      WHERE o."code" = 'migdal_provident_fund'
        AND NOT EXISTS (
          SELECT 1 FROM "roadmap_goals" g WHERE g."offer_id" = o."offer_id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "roadmap_goals"
      WHERE "offer_id" IN (
        SELECT "offer_id" FROM "partner_offers"
        WHERE "code" IN ('phoenix_investment_account', 'migdal_provident_fund')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "partner_offers"
      WHERE "code" IN ('phoenix_investment_account', 'migdal_provident_fund')
    `);
    await queryRunner.query(`
      DELETE FROM "partners" WHERE "code" IN ('phoenix', 'migdal')
    `);
  }
}
