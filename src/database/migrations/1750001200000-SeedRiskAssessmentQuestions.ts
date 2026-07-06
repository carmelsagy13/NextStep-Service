import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the 3 Step-4 risk-assessment questions (behavioural reaction, time
 * horizon, risk/return trade-off) and their 1-4 scored options as pure DATA on
 * the existing dynamic questionnaire schema (no DDL, no new tables).
 *
 * All three are top-level SINGLE_CHOICE, required questions attached to the
 * existing screen resolved by UUID below. Each option's `option_value` encodes
 * the risk score 1-4 (higher = greater risk appetite) and is rendered from its
 * bilingual `label`.
 *
 * Fully idempotent: questions use ON CONFLICT (question_key) DO NOTHING and
 * options use ON CONFLICT (question_id, option_value) DO NOTHING, so re-running
 * is safe.
 */

/** Target screen these risk questions belong to (Step 4). */
const RISK_SCREEN_ID = '0061857f-5ff7-4097-9144-75b1475cc8e9';

type LocalizedText = { he: string; en?: string };

interface SeedOption {
  /** Machine value == risk score 1-4. */
  value: string;
  label: LocalizedText;
  order: number;
}

interface SeedQuestion {
  key: string;
  text: LocalizedText;
  order: number;
  options: SeedOption[];
}

const RISK_QUESTIONS: SeedQuestion[] = [
  {
    key: 'risk_behavioral',
    text: {
      he: 'נניח שחלה ירידה חדה בבורסה ותיק ההשקעות שלך איבד 20% מערכו תוך חודשיים. מה סביר להניח שתעשה?',
      en: 'Suppose the market dropped sharply and your portfolio lost 20% of its value within two months. What would you most likely do?',
    },
    order: 1,
    options: [
      {
        value: '1',
        label: { he: 'אלחץ ואמכור את כל ההשקעות שנותרו כדי להגן על מה שנשאר.' },
        order: 1,
      },
      {
        value: '2',
        label: { he: 'אמכור חלק מההשקעות כדי להקטין את החשיפה שלי לסיכון.' },
        order: 2,
      },
      {
        value: '3',
        label: {
          he: 'לא אעשה דבר. אמתין שהשוק יתאושש כי מדובר בהשקעה לטווח ארוך.',
        },
        order: 3,
      },
      {
        value: '4',
        label: { he: 'אנצל את ההזדמנות ואשקיע כסף נוסף כשהמחירים נמוכים.' },
        order: 4,
      },
    ],
  },
  {
    key: 'risk_time_horizon',
    text: {
      he: 'מתי להערכתך תתחיל למשוך כספים משמעותיים מתיק זה עבור היעד שלך?',
      en: 'When do you estimate you will start withdrawing significant funds from this portfolio for your goal?',
    },
    order: 2,
    options: [
      {
        value: '1',
        label: { he: 'בטווח מיידי או במהלך השנתיים הקרובות.' },
        order: 1,
      },
      { value: '2', label: { he: 'בעוד 3 עד 5 שנים.' }, order: 2 },
      { value: '3', label: { he: 'בעוד 6 עד 10 שנים.' }, order: 3 },
      { value: '4', label: { he: 'בעוד מעל 10 שנים.' }, order: 4 },
    ],
  },
  {
    key: 'risk_tradeoff',
    text: {
      he: 'מהו המשפט שמתאר בצורה הטובה ביותר את מטרת ההשקעה שלך?',
      en: 'Which statement best describes the goal of your investment?',
    },
    order: 3,
    options: [
      {
        value: '1',
        label: {
          he: 'המטרה העיקרית שלי היא להימנע מהפסדים, גם אם התיק שלי בקושי ידביק את קצב האינפלציה.',
        },
        order: 1,
      },
      {
        value: '2',
        label: {
          he: 'אני רוצה להרוויח קצת יותר מהאינפלציה, תוך שמירה על רמת סיכון נמוכה ויציבה.',
        },
        order: 2,
      },
      {
        value: '3',
        label: {
          he: 'אני מחפש איזון – הגדלת ערך התיק לטווח ארוך לצד ניהול סיכונים מבוקר.',
        },
        order: 3,
      },
      {
        value: '4',
        label: {
          he: 'המטרה שלי היא למקסם תשואה לטווח ארוך, ואני מוכן לספוג תנודות חדות וכואבות בדרך.',
        },
        order: 4,
      },
    ],
  },
];

export class SeedRiskAssessmentQuestions1750001200000
  implements MigrationInterface
{
  name = 'SeedRiskAssessmentQuestions1750001200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const questionId = async (key: string): Promise<string> => {
      const rows: Array<{ question_id: string }> = await queryRunner.query(
        `SELECT question_id FROM questionnaire_questions WHERE question_key = $1`,
        [key],
      );
      return rows[0].question_id;
    };

    for (const question of RISK_QUESTIONS) {
      await queryRunner.query(
        `INSERT INTO questionnaire_questions
           (question_key, screen_id, parent_question_id, text, type, is_required, order_index)
         VALUES ($1, $2, NULL, $3::jsonb, 'SINGLE_CHOICE', true, $4)
         ON CONFLICT (question_key) DO NOTHING`,
        [
          question.key,
          RISK_SCREEN_ID,
          JSON.stringify(question.text),
          question.order,
        ],
      );

      const qId = await questionId(question.key);

      for (const option of question.options) {
        await queryRunner.query(
          `INSERT INTO questionnaire_options
             (question_id, option_value, label, order_index)
           VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (question_id, option_value) DO NOTHING`,
          [qId, option.value, JSON.stringify(option.label), option.order],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cascades remove the attached options automatically.
    await queryRunner.query(
      `DELETE FROM questionnaire_questions WHERE question_key = ANY($1)`,
      [RISK_QUESTIONS.map((q) => q.key)],
    );
  }
}
