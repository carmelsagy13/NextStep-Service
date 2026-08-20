import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Completes Screen 5 and adds Screen 6 — both as pure DATA on the existing
 * dynamic schema (no DDL, no new tables).
 *
 * Screen 5 (Annual Expenses): the placeholder question gains its real options
 * and a NUMBER "estimated annual cost" sub-field per expense, becomes required,
 * and enforces "select at least two" via validation.minItems = 2.
 *
 * Screen 6 (Goals): a new MULTIPLE_CHOICE question where each goal that carries
 * a target reveals two nested NUMBER sub-fields — timeframe (months) and
 * requested amount — driven by INCLUDES dependency rules. Goals without a
 * specific target (safety net, early retirement) reveal nothing.
 *
 * Fully idempotent: options use ON CONFLICT DO NOTHING, sub-field questions use
 * ON CONFLICT (question_key) DO NOTHING, dependencies are guarded with
 * WHERE NOT EXISTS, and the Screen 5 question UPDATE is naturally re-runnable.
 */

type LocalizedText = { he: string; en: string };

interface SeedOption {
  value: string;
  label: LocalizedText;
}

interface SeedSubField {
  key: string;
  text: LocalizedText;
  /** Option on the parent whose selection (INCLUDES) reveals this sub-field. */
  triggerOption: string;
}

const EXPENSE_OPTIONS: SeedOption[] = [
  {
    value: 'car_test_insurance',
    label: { he: 'טסט וביטוחים לרכב', en: 'Vehicle test & insurance' },
  },
  {
    value: 'periodic_maintenance',
    label: {
      he: 'טיפול תקופתי / תיקונים מתוכננים',
      en: 'Periodic service / planned repairs',
    },
  },
  {
    value: 'annual_vacation',
    label: { he: 'חופשה שנתית קבועה', en: 'Regular annual vacation' },
  },
  { value: 'other', label: { he: 'אחר', en: 'Other' } },
];

// One estimated-annual-cost NUMBER field per expense option (except "other").
const EXPENSE_SUBFIELDS: SeedSubField[] = [
  {
    key: 'q_expense_car_amount',
    text: {
      he: 'עלות שנתית מוערכת – טסט וביטוחים לרכב (בש"ח)',
      en: 'Estimated annual cost – vehicle test & insurance (NIS)',
    },
    triggerOption: 'car_test_insurance',
  },
  {
    key: 'q_expense_maintenance_amount',
    text: {
      he: 'עלות שנתית מוערכת – טיפול תקופתי / תיקונים (בש"ח)',
      en: 'Estimated annual cost – periodic service / repairs (NIS)',
    },
    triggerOption: 'periodic_maintenance',
  },
  {
    key: 'q_expense_vacation_amount',
    text: {
      he: 'עלות שנתית מוערכת – חופשה שנתית קבועה (בש"ח)',
      en: 'Estimated annual cost – regular annual vacation (NIS)',
    },
    triggerOption: 'annual_vacation',
  },
];

const GOAL_OPTIONS: SeedOption[] = [
  { value: 'car_purchase', label: { he: 'רכישת רכב', en: 'Car purchase' } },
  {
    value: 'wedding_event',
    label: {
      he: 'חתונה / אירוע משפחתי גדול',
      en: 'Wedding / large family event',
    },
  },
  {
    value: 'home_equity',
    label: {
      he: 'הון עצמי לדירה (לקניית נכס)',
      en: 'Home equity (for buying property)',
    },
  },
  {
    value: 'big_trip_sabbatical',
    label: {
      he: 'טיול גדול בחו"ל / שנת שבתון',
      en: 'Big trip abroad / sabbatical year',
    },
  },
  {
    value: 'safety_net',
    label: {
      he: 'יצירת רשת ביטחון ("כסף ליום סגריר") – ללא יעד ספציפי.',
      en: 'Build a safety net ("rainy-day money") – no specific target.',
    },
  },
  {
    value: 'early_retirement',
    label: {
      he: 'פרישה מוקדמת / עצמאות כלכלית מלאה (טווח ארוך).',
      en: 'Early retirement / full financial independence (long term).',
    },
  },
];

// Per-goal timeframe (months) + requested amount, for goals carrying a target.
const GOAL_SUBFIELDS: Array<{
  goal: string;
  timeframe: SeedSubField;
  amount: SeedSubField;
}> = [
  {
    goal: 'car_purchase',
    timeframe: {
      key: 'q_goal_car_timeframe',
      text: {
        he: 'רכישת רכב – טווח זמן (בחודשים)',
        en: 'Car purchase – timeframe (months)',
      },
      triggerOption: 'car_purchase',
    },
    amount: {
      key: 'q_goal_car_amount',
      text: {
        he: 'רכישת רכב – סכום מבוקש (בש"ח)',
        en: 'Car purchase – requested amount (NIS)',
      },
      triggerOption: 'car_purchase',
    },
  },
  {
    goal: 'wedding_event',
    timeframe: {
      key: 'q_goal_wedding_timeframe',
      text: {
        he: 'חתונה / אירוע – טווח זמן (בחודשים)',
        en: 'Wedding / event – timeframe (months)',
      },
      triggerOption: 'wedding_event',
    },
    amount: {
      key: 'q_goal_wedding_amount',
      text: {
        he: 'חתונה / אירוע – סכום מבוקש (בש"ח)',
        en: 'Wedding / event – requested amount (NIS)',
      },
      triggerOption: 'wedding_event',
    },
  },
  {
    goal: 'home_equity',
    timeframe: {
      key: 'q_goal_home_timeframe',
      text: {
        he: 'הון עצמי לדירה – טווח זמן (בחודשים)',
        en: 'Home equity – timeframe (months)',
      },
      triggerOption: 'home_equity',
    },
    amount: {
      key: 'q_goal_home_amount',
      text: {
        he: 'הון עצמי לדירה – סכום מבוקש (בש"ח)',
        en: 'Home equity – requested amount (NIS)',
      },
      triggerOption: 'home_equity',
    },
  },
  {
    goal: 'big_trip_sabbatical',
    timeframe: {
      key: 'q_goal_trip_timeframe',
      text: {
        he: 'טיול גדול / שנת שבתון – טווח זמן (בחודשים)',
        en: 'Big trip / sabbatical – timeframe (months)',
      },
      triggerOption: 'big_trip_sabbatical',
    },
    amount: {
      key: 'q_goal_trip_amount',
      text: {
        he: 'טיול גדול / שנת שבתון – סכום מבוקש (בש"ח)',
        en: 'Big trip / sabbatical – requested amount (NIS)',
      },
      triggerOption: 'big_trip_sabbatical',
    },
  },
];

const ALL_SUBFIELD_KEYS = [
  ...EXPENSE_SUBFIELDS.map((s) => s.key),
  ...GOAL_SUBFIELDS.flatMap((g) => [g.timeframe.key, g.amount.key]),
];

export class SeedQuestionnaireScreens5And61750000200000 implements MigrationInterface {
  name = 'SeedQuestionnaireScreens5And61750000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const questionId = async (key: string): Promise<string> => {
      const rows: Array<{ question_id: string }> = await queryRunner.query(
        `SELECT question_id FROM questionnaire_questions WHERE question_key = $1`,
        [key],
      );
      return rows[0].question_id;
    };

    const addOption = async (
      qId: string,
      option: SeedOption,
      order: number,
    ): Promise<void> => {
      await queryRunner.query(
        `INSERT INTO questionnaire_options (question_id, option_value, label, order_index)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (question_id, option_value) DO NOTHING`,
        [qId, option.value, JSON.stringify(option.label), order],
      );
    };

    const addNumberSubField = async (
      sub: SeedSubField,
      screenId: string,
      parentId: string,
      order: number,
    ): Promise<void> => {
      await queryRunner.query(
        `INSERT INTO questionnaire_questions
           (question_key, screen_id, parent_question_id, text, type, is_required, order_index)
         VALUES ($1, $2, $3, $4::jsonb, 'NUMBER', true, $5)
         ON CONFLICT (question_key) DO NOTHING`,
        [sub.key, screenId, parentId, JSON.stringify(sub.text), order],
      );
      const subId = await questionId(sub.key);
      await queryRunner.query(
        `INSERT INTO questionnaire_dependencies
           (question_id, trigger_question_id, operator, trigger_value, group_index)
         SELECT $1, $2, 'INCLUDES', $3::jsonb, 0
         WHERE NOT EXISTS (
           SELECT 1 FROM questionnaire_dependencies
           WHERE question_id = $1 AND trigger_question_id = $2 AND group_index = 0
         )`,
        [subId, parentId, JSON.stringify(sub.triggerOption)],
      );
    };

    // ── Screen 5: complete the placeholder question ────────────────────────
    const expenseQId = await questionId('q_annual_expenses_prep');
    const expenseScreenRows: Array<{ screen_id: string }> =
      await queryRunner.query(
        `SELECT screen_id FROM questionnaire_questions WHERE question_key = 'q_annual_expenses_prep'`,
      );
    const expenseScreenId = expenseScreenRows[0].screen_id;

    await queryRunner.query(
      `UPDATE questionnaire_questions
         SET text = $1::jsonb,
             is_required = true,
             validation = $2::jsonb
       WHERE question_key = 'q_annual_expenses_prep'`,
      [
        JSON.stringify({
          he: 'סמן לפחות שתי הוצאות גדולות שקורות אצלך פעם בשנה, והערך מה העלות השנתית שלהן:',
          en: 'Mark at least two large expenses that occur once a year, and estimate their annual cost:',
        }),
        JSON.stringify({ minItems: 2 }),
      ],
    );

    for (let i = 0; i < EXPENSE_OPTIONS.length; i++) {
      await addOption(expenseQId, EXPENSE_OPTIONS[i], i);
    }
    for (let i = 0; i < EXPENSE_SUBFIELDS.length; i++) {
      await addNumberSubField(
        EXPENSE_SUBFIELDS[i],
        expenseScreenId,
        expenseQId,
        i,
      );
    }

    // ── Screen 6: Goals ────────────────────────────────────────────────────
    await queryRunner.query(
      `INSERT INTO questionnaire_screens (screen_key, order_index, title)
       VALUES ('screen_goals', 5, $1::jsonb)
       ON CONFLICT (screen_key) DO NOTHING`,
      [JSON.stringify({ he: 'מטרות', en: 'Goals' })],
    );
    const goalScreenRows: Array<{ screen_id: string }> =
      await queryRunner.query(
        `SELECT screen_id FROM questionnaire_screens WHERE screen_key = 'screen_goals'`,
      );
    const goalScreenId = goalScreenRows[0].screen_id;

    await queryRunner.query(
      `INSERT INTO questionnaire_questions
         (question_key, screen_id, parent_question_id, text, type, is_required, order_index)
       VALUES ('q_financial_goals', $1, NULL, $2::jsonb, 'MULTIPLE_CHOICE', true, 0)
       ON CONFLICT (question_key) DO NOTHING`,
      [
        goalScreenId,
        JSON.stringify({
          he: 'סמן את המטרות הפיננסיות המרכזיות שלך לשנים הקרובות (ניתן לבחור יותר מאחת):',
          en: 'Mark your main financial goals for the coming years (you may choose more than one):',
        }),
      ],
    );
    const goalsQId = await questionId('q_financial_goals');

    for (let i = 0; i < GOAL_OPTIONS.length; i++) {
      await addOption(goalsQId, GOAL_OPTIONS[i], i);
    }

    let order = 0;
    for (const group of GOAL_SUBFIELDS) {
      await addNumberSubField(group.timeframe, goalScreenId, goalsQId, order++);
      await addNumberSubField(group.amount, goalScreenId, goalsQId, order++);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the new Screen 6 (cascades its question/options/dependencies).
    await queryRunner.query(
      `DELETE FROM questionnaire_screens WHERE screen_key = 'screen_goals'`,
    );

    // Remove the sub-fields added under Screen 5 (cascades their dependencies).
    await queryRunner.query(
      `DELETE FROM questionnaire_questions WHERE question_key = ANY($1)`,
      [ALL_SUBFIELD_KEYS],
    );

    // Remove the Screen 5 options and revert the question to its placeholder state.
    await queryRunner.query(
      `DELETE FROM questionnaire_options
         WHERE question_id = (SELECT question_id FROM questionnaire_questions WHERE question_key = 'q_annual_expenses_prep')
           AND option_value = ANY($1)`,
      [EXPENSE_OPTIONS.map((o) => o.value)],
    );
    await queryRunner.query(
      `UPDATE questionnaire_questions
         SET is_required = false, validation = NULL
       WHERE question_key = 'q_annual_expenses_prep'`,
    );
  }
}
