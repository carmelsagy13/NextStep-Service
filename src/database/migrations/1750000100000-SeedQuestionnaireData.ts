import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the initial onboarding questionnaire (Screens 1–5) defined in the
 * product spec. Seeding is data-only and fully idempotent:
 *   • screens / questions / options use ON CONFLICT DO NOTHING on their natural
 *     keys, so re-running never duplicates rows;
 *   • dependencies are guarded with WHERE NOT EXISTS.
 *
 * After this runs, the questionnaire is editable entirely through DB rows — add
 * a screen/question/option/rule with a plain INSERT and it surfaces in
 * `GET /questionnaire` with no code change or further migration.
 *
 * NOTE: Screen 5's options are an intentional placeholder in the spec, so only
 * its screen + question are seeded; concrete options can be inserted later as
 * data.
 */

type LocalizedText = { he: string; en: string };

interface SeedOption {
  value: string;
  label: LocalizedText;
}

interface SeedDependency {
  /** question_key of the controlling question. */
  triggerKey: string;
  operator: 'EQUALS' | 'NOT_EQUALS' | 'INCLUDES' | 'GT' | 'LT' | 'EXISTS';
  value: string | number | string[] | null;
  /** AND within a group, OR across groups. */
  group: number;
}

interface SeedQuestion {
  key: string;
  text: LocalizedText;
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TEXT' | 'NUMBER';
  isRequired?: boolean;
  /** question_key of the parent question for nested sub-fields. */
  parentKey?: string;
  options?: SeedOption[];
  dependencies?: SeedDependency[];
}

interface SeedScreen {
  key: string;
  title: LocalizedText;
  questions: SeedQuestion[];
}

const SEED: SeedScreen[] = [
  // ── Screen 1: Family Status & Financial Partnership ────────────────────
  {
    key: 'screen_family_status',
    title: {
      he: 'סטטוס משפחתי ושותפות פיננסית',
      en: 'Family Status & Financial Partnership',
    },
    questions: [
      {
        key: 'q_family_status',
        text: {
          he: 'מה המצב המשפחתי שלך כיום?',
          en: 'What is your current family status?',
        },
        type: 'SINGLE_CHOICE',
        options: [
          { value: 'single', label: { he: 'רווק/ה', en: 'Single' } },
          {
            value: 'in_relationship_married',
            label: {
              he: 'בזוגיות / נשוי/ה',
              en: 'In a relationship / Married',
            },
          },
          {
            value: 'divorced_widowed',
            label: { he: 'גרוש/ה / אלמן/ה', en: 'Divorced / Widowed' },
          },
        ],
      },
      {
        key: 'q_has_children',
        text: { he: 'האם יש לך ילדים?', en: 'Do you have children?' },
        type: 'SINGLE_CHOICE',
        options: [
          { value: 'no', label: { he: 'לא', en: 'No' } },
          { value: 'yes', label: { he: 'כן', en: 'Yes' } },
        ],
      },
      {
        key: 'q_children_count',
        text: { he: 'כמה ילדים?', en: 'How many children?' },
        type: 'NUMBER',
        parentKey: 'q_has_children',
        dependencies: [
          {
            triggerKey: 'q_has_children',
            operator: 'EQUALS',
            value: 'yes',
            group: 0,
          },
        ],
      },
      {
        key: 'q_youngest_child_age',
        text: {
          he: 'מה גיל הילד הצעיר ביותר?',
          en: 'What is the age of the youngest child?',
        },
        type: 'NUMBER',
        parentKey: 'q_has_children',
        dependencies: [
          {
            triggerKey: 'q_has_children',
            operator: 'EQUALS',
            value: 'yes',
            group: 0,
          },
        ],
      },
      {
        key: 'q_shared_bank_account',
        text: {
          he: 'האם אתם מנהלים חשבון בנק משותף נוסף (שלך ושל בן/בת הזוג) שאינו החשבון שחיברת כרגע?',
          en: "Do you manage an additional joint bank account (yours and your partner's) other than the one you just connected?",
        },
        type: 'SINGLE_CHOICE',
        options: [
          {
            value: 'no_central_only',
            label: {
              he: 'לא, זה החשבון המרכזי היחיד שלנו.',
              en: 'No, this is our only central account.',
            },
          },
          {
            value: 'yes_other_bank',
            label: {
              he: 'כן, יש לנו חשבון משותף בבנק אחר שלא חיברתי.',
              en: "Yes, we have a joint account at another bank I haven't connected.",
            },
          },
        ],
      },
    ],
  },

  // ── Screen 2: Additional Bank Accounts & Credit Cards ──────────────────
  {
    key: 'screen_additional_accounts',
    title: {
      he: 'חשבונות בנקים וכרטיסי אשראי נוספים',
      en: 'Additional Bank Accounts & Credit Cards',
    },
    questions: [
      {
        key: 'q_other_bank_accounts',
        text: {
          he: 'האם יש ברשותך חשבונות עו"ש פעילים בבנקים נוספים?',
          en: 'Do you have active checking accounts at additional banks?',
        },
        type: 'SINGLE_CHOICE',
        options: [
          {
            value: 'no',
            label: {
              he: 'לא, אני מנהל/ת את כל העו"ש שלי בבנק שחובק.',
              en: 'No, I manage all my checking at the connected bank.',
            },
          },
          {
            value: 'yes',
            label: {
              he: 'כן, יש לי חשבון פעיל נוסף בבנק',
              en: 'Yes, I have an additional active bank account',
            },
          },
        ],
      },
      {
        key: 'q_other_bank_name',
        text: { he: 'בחירת בנק', en: 'Select bank' },
        type: 'TEXT',
        parentKey: 'q_other_bank_accounts',
        dependencies: [
          {
            triggerKey: 'q_other_bank_accounts',
            operator: 'EQUALS',
            value: 'yes',
            group: 0,
          },
        ],
      },
      {
        key: 'q_non_bank_credit_cards',
        text: {
          he: "כמה כרטיסי אשראי חוץ-בנקאיים יש ברשותך? (כרטיסים שלא הונפקו על ידי הבנק שלך, כגון כרטיסי מועדוני תעופה, שופרסל, כרטיסי אשראי של חברות המימון ישירות וכו').",
          en: 'How many non-bank credit cards do you have? (Cards not issued by your bank, e.g. airline clubs, Shufersal, direct finance-company cards, etc.)',
        },
        type: 'SINGLE_CHOICE',
        options: [
          {
            value: 'none',
            label: {
              he: 'אין לי כרטיסים חוץ-בנקאיים.',
              en: 'I have no non-bank cards.',
            },
          },
          {
            value: 'one',
            label: {
              he: 'יש לי כרטיס חוץ-בנקאי אחד.',
              en: 'I have one non-bank card.',
            },
          },
          {
            value: 'two_or_more',
            label: {
              he: 'יש לי 2 כרטיסים חוץ-בנקאיים או יותר.',
              en: 'I have 2 or more non-bank cards.',
            },
          },
        ],
      },
    ],
  },

  // ── Screen 3: Off-Platform Assets & Wealth ─────────────────────────────
  {
    key: 'screen_off_platform_assets',
    title: {
      he: 'נכסים והון מחוץ למערכת הבנקאית',
      en: 'Off-Platform Assets & Wealth',
    },
    questions: [
      {
        key: 'q_investment_real_estate',
        text: {
          he: 'האם יש בבעלותך נכס נדל"ן להשקעה (דירה שנייה, קרקע, נכס מסחרי) שמניב לך הכנסה או צובר שווי?',
          en: 'Do you own investment real estate (a second apartment, land, commercial property) that generates income or accrues value?',
        },
        type: 'SINGLE_CHOICE',
        options: [
          { value: 'no', label: { he: 'לא.', en: 'No.' } },
          { value: 'yes', label: { he: 'כן', en: 'Yes' } },
        ],
      },
      {
        key: 'q_real_estate_estimated_value',
        text: {
          he: 'שווי הנכס המוערך (פחות משכנתא עליו אם יש) הוא (בש"ח):',
          en: 'The estimated property value (less any mortgage on it) is (in NIS):',
        },
        type: 'NUMBER',
        parentKey: 'q_investment_real_estate',
        dependencies: [
          {
            triggerKey: 'q_investment_real_estate',
            operator: 'EQUALS',
            value: 'yes',
            group: 0,
          },
        ],
      },
      {
        key: 'q_long_term_savings_location',
        text: {
          he: 'היכן מנוהלים החסכונות ארוכי הטווח שלך? (סמן את הגופים מחוץ לבנק שבהם יש לך צבירה משמעותית):',
          en: 'Where are your long-term savings managed? (Mark the non-bank institutions where you have significant accrual):',
        },
        type: 'MULTIPLE_CHOICE',
        options: [
          {
            value: 'study_fund',
            label: {
              he: 'קרן השתלמות (בבית השקעות / חברת ביטוח)',
              en: 'Study fund (investment house / insurance company)',
            },
          },
          {
            value: 'provident_fund',
            label: {
              he: 'קופת גמל להשקעה / פוליסת חיסכון פיננסית',
              en: 'Provident fund for investment / financial savings policy',
            },
          },
          {
            value: 'pension_fund',
            label: {
              he: 'קרן פנסיה / ביטוח מנהלים',
              en: "Pension fund / managers' insurance",
            },
          },
          {
            value: 'none',
            label: {
              he: 'אין לי חסכונות מחוץ לבנק.',
              en: 'I have no savings outside the bank.',
            },
          },
        ],
      },
      {
        key: 'q_liquid_savings_estimated_amount',
        text: {
          he: 'מהו הסכום הנזיל המשוער שם כיום? (בש"ח)',
          en: 'What is the approximate liquid amount there today? (in NIS)',
        },
        type: 'NUMBER',
        isRequired: false,
        parentKey: 'q_long_term_savings_location',
        // study_fund OR provident_fund -> two rules in DIFFERENT groups.
        dependencies: [
          {
            triggerKey: 'q_long_term_savings_location',
            operator: 'INCLUDES',
            value: 'study_fund',
            group: 0,
          },
          {
            triggerKey: 'q_long_term_savings_location',
            operator: 'INCLUDES',
            value: 'provident_fund',
            group: 1,
          },
        ],
      },
    ],
  },

  // ── Screen 4: Off-Platform Liabilities & Debts ─────────────────────────
  {
    key: 'screen_off_platform_liabilities',
    title: {
      he: 'התחייבויות וחובות מחוץ לבנק',
      en: 'Off-Platform Liabilities & Debts',
    },
    questions: [
      {
        key: 'q_off_bank_loans',
        text: {
          he: 'האם יש לך הלוואות פעילות שנלקחו מחוץ לבנק? (הלוואת מימון לרכב, הלוואה מחברת כרטיסי אשראי, או הלוואה בלון/גישור מחברת הביטוח/פנסיה).',
          en: 'Do you have active loans taken outside the bank? (Auto-finance loan, credit-card-company loan, or balloon/bridge loan from the insurance/pension company).',
        },
        type: 'SINGLE_CHOICE',
        options: [
          {
            value: 'no',
            label: {
              he: 'לא, אין לי הלוואות מחוץ לבנק.',
              en: 'No, I have no loans outside the bank.',
            },
          },
          { value: 'yes', label: { he: 'כן', en: 'Yes' } },
        ],
      },
      {
        key: 'q_loan_monthly_repayment',
        text: {
          he: 'מהו ההחזר החודשי של הלוואה זו? (בש"ח)',
          en: 'What is the monthly repayment of this loan? (in NIS)',
        },
        type: 'NUMBER',
        parentKey: 'q_off_bank_loans',
        dependencies: [
          {
            triggerKey: 'q_off_bank_loans',
            operator: 'EQUALS',
            value: 'yes',
            group: 0,
          },
        ],
      },
      {
        key: 'q_loan_remaining_months',
        text: {
          he: 'בעוד כמה חודשים היא צפויה להסתיים?',
          en: 'In how many months is it expected to end?',
        },
        type: 'NUMBER',
        parentKey: 'q_off_bank_loans',
        dependencies: [
          {
            triggerKey: 'q_off_bank_loans',
            operator: 'EQUALS',
            value: 'yes',
            group: 0,
          },
        ],
      },
    ],
  },

  // ── Screen 5: Annual Expenses Preparation (options seeded later as data) ─
  {
    key: 'screen_annual_expenses',
    title: { he: 'היערכות להוצאות שנתיות', en: 'Annual Expenses Preparation' },
    questions: [
      {
        key: 'q_annual_expenses_prep',
        text: {
          he: 'סמן לפחות את הסעיפים הרלוונטיים עבורך להיערכות להוצאות שנתיות גדולות:',
          en: 'Mark at least the items relevant to you for preparing for large annual expenses:',
        },
        type: 'MULTIPLE_CHOICE',
        // Placeholder screen — options are added later as data, so this cannot
        // be required yet (a required choice with zero options is unanswerable).
        isRequired: false,
      },
    ],
  },
];

export class SeedQuestionnaireData1750000100000 implements MigrationInterface {
  name = 'SeedQuestionnaireData1750000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Resolve a question_key to its UUID (questions are inserted before this is used).
    const questionId = async (key: string): Promise<string> => {
      const rows: Array<{ question_id: string }> = await queryRunner.query(
        `SELECT question_id FROM questionnaire_questions WHERE question_key = $1`,
        [key],
      );
      return rows[0].question_id;
    };

    for (let s = 0; s < SEED.length; s++) {
      const screen = SEED[s];

      await queryRunner.query(
        `INSERT INTO questionnaire_screens (screen_key, order_index, title)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (screen_key) DO NOTHING`,
        [screen.key, s, JSON.stringify(screen.title)],
      );
      const screenRows: Array<{ screen_id: string }> = await queryRunner.query(
        `SELECT screen_id FROM questionnaire_screens WHERE screen_key = $1`,
        [screen.key],
      );
      const screenId = screenRows[0].screen_id;

      // Insert questions in declared order so any parent precedes its children.
      for (let q = 0; q < screen.questions.length; q++) {
        const question = screen.questions[q];
        const parentId = question.parentKey
          ? await questionId(question.parentKey)
          : null;

        await queryRunner.query(
          `INSERT INTO questionnaire_questions
             (question_key, screen_id, parent_question_id, text, type, is_required, order_index)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
           ON CONFLICT (question_key) DO NOTHING`,
          [
            question.key,
            screenId,
            parentId,
            JSON.stringify(question.text),
            question.type,
            question.isRequired ?? true,
            q,
          ],
        );

        const qId = await questionId(question.key);

        // Options.
        if (question.options) {
          for (let o = 0; o < question.options.length; o++) {
            const option = question.options[o];
            await queryRunner.query(
              `INSERT INTO questionnaire_options (question_id, option_value, label, order_index)
               VALUES ($1, $2, $3::jsonb, $4)
               ON CONFLICT (question_id, option_value) DO NOTHING`,
              [qId, option.value, JSON.stringify(option.label), o],
            );
          }
        }
      }
    }

    // Dependencies — inserted after all questions exist so both ends resolve.
    for (const screen of SEED) {
      for (const question of screen.questions) {
        if (!question.dependencies) continue;
        const qId = await questionId(question.key);
        for (const dep of question.dependencies) {
          const triggerId = await questionId(dep.triggerKey);
          await queryRunner.query(
            `INSERT INTO questionnaire_dependencies
               (question_id, trigger_question_id, operator, trigger_value, group_index)
             SELECT $1, $2, $3, $4::jsonb, $5
             WHERE NOT EXISTS (
               SELECT 1 FROM questionnaire_dependencies
               WHERE question_id = $1 AND trigger_question_id = $2 AND group_index = $5
             )`,
            [
              qId,
              triggerId,
              dep.operator,
              JSON.stringify(dep.value),
              dep.group,
            ],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const keys = SEED.map((s) => s.key);
    // Cascades remove questions -> options/dependencies/sub-fields automatically.
    await queryRunner.query(
      `DELETE FROM questionnaire_screens WHERE screen_key = ANY($1)`,
      [keys],
    );
  }
}
