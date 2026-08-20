import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-off data backfill: migrate existing overarching goals out of
 * `questionnaire_responses` into the dedicated `user_aspirations` store.
 *
 * Reads each user's `q_financial_goals` selection plus the per-goal
 * `q_goal_*_amount` / `q_goal_*_timeframe` sub-fields and creates one aspiration
 * per selected goal type. Idempotent: aspirations are inserted ON CONFLICT DO
 * NOTHING on (user_id, goal_type_code), so re-running never duplicates.
 *
 * Runs AFTER 1750000600000 (which creates the tables + seeds the catalog). It
 * does NOT delete the source questionnaire_responses rows — that cleanup is a
 * separate, gated step performed once the backfill is verified in production.
 *
 * `down` is intentionally a no-op: we cannot safely distinguish backfilled
 * aspirations from ones created by the live app, so this data migration is not
 * auto-reversible.
 */
export class BackfillAspirationsFromQuestionnaire1750000700000 implements MigrationInterface {
  name = 'BackfillAspirationsFromQuestionnaire1750000700000';

  /** Maps a sub-field key prefix to its goal_type_catalog code. */
  private static readonly PREFIX_TO_TYPE: Record<string, string> = {
    q_goal_car: 'car_purchase',
    q_goal_wedding: 'wedding_event',
    q_goal_home: 'home_equity',
    q_goal_trip: 'big_trip_sabbatical',
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    const TYPE_TO_PREFIX = Object.fromEntries(
      Object.entries(
        BackfillAspirationsFromQuestionnaire1750000700000.PREFIX_TO_TYPE,
      ).map(([prefix, code]) => [code, prefix]),
    );

    // Catalog drives which codes are valid + supply the display title.
    const catalog: Array<{
      code: string;
      label: { he: string; en?: string };
      supports_amount: boolean;
      supports_timeframe: boolean;
    }> = await queryRunner.query(
      `SELECT "code", "label", "supports_amount", "supports_timeframe" FROM "goal_type_catalog"`,
    );
    const catalogByCode = new Map(catalog.map((c) => [c.code, c]));

    // All goal-related answers across all users, keyed for grouping.
    const rows: Array<{
      user_id: string;
      question_key: string;
      answer_value: unknown;
    }> = await queryRunner.query(
      `
      SELECT r."user_id", q."question_key", r."answer_value"
      FROM "questionnaire_responses" r
      JOIN "questionnaire_questions" q ON q."question_id" = r."question_id"
      WHERE q."question_key" = 'q_financial_goals'
         OR q."question_key" LIKE 'q_goal_%'
      `,
    );

    // Group answers per user.
    const byUser = new Map<string, Map<string, unknown>>();
    for (const row of rows) {
      const map = byUser.get(row.user_id) ?? new Map<string, unknown>();
      map.set(row.question_key, row.answer_value);
      byUser.set(row.user_id, map);
    }

    for (const [userId, answers] of byUser) {
      const selected = answers.get('q_financial_goals');
      const codes = Array.isArray(selected) ? (selected as string[]) : [];

      for (const code of codes) {
        const type = catalogByCode.get(code);
        if (!type) continue; // unknown/inactive goal type — skip

        const prefix = TYPE_TO_PREFIX[code];
        const rawAmount = prefix ? answers.get(`${prefix}_amount`) : undefined;
        const rawMonths = prefix
          ? answers.get(`${prefix}_timeframe`)
          : undefined;

        const months =
          rawMonths != null && type.supports_timeframe
            ? Number(rawMonths)
            : null;
        const targetAmount =
          rawAmount != null && type.supports_amount ? Number(rawAmount) : null;
        const attributes =
          months != null && Number.isFinite(months)
            ? JSON.stringify({ timeframeMonths: months })
            : null;

        await queryRunner.query(
          `
          INSERT INTO "user_aspirations"
            ("user_id", "goal_type_code", "title", "target_amount", "target_date",
             "attributes", "status", "revision", "last_synced_revision")
          VALUES (
            $1, $2, $3, $4,
            CASE WHEN $5::int IS NULL THEN NULL
                 ELSE (CURRENT_DATE + ($5::int * INTERVAL '1 month'))::date END,
            $6::jsonb, 'active', 1, NULL
          )
          ON CONFLICT ("user_id", "goal_type_code") DO NOTHING
          `,
          [
            userId,
            code,
            type.label?.he ?? code,
            targetAmount,
            months != null && Number.isFinite(months) ? months : null,
            attributes,
          ],
        );
      }
    }
  }

  public async down(): Promise<void> {
    // No-op: backfilled aspirations cannot be safely distinguished from
    // app-created ones, so this data migration is not auto-reversible.
  }
}
