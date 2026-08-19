import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normalizes `roadmap_goals.criteria`: 14 seed rows carry the literal string
 * `'general'`, which is not one of the 8 criteria. The eligibility rule treats
 * NULL as "general goal, matched by exact step", so those rows resolved to an
 * undefined score lookup and could never become eligible.
 *
 * A CHECK constraint then prevents any value outside the 8 criteria from being
 * inserted again (NULL stays allowed and still means "general").
 *
 * `up`   : 'general' -> NULL, then add the constraint.
 * `down` : drop the constraint FIRST (it would reject 'general'), then restore
 *          the exact 14 rows by id so genuinely-NULL goals are left untouched.
 */
export class NormalizeRoadmapGoalGeneralCriteria1750001700000
  implements MigrationInterface
{
  name = 'NormalizeRoadmapGoalGeneralCriteria1750001700000';

  /** The rows that held 'general' when this migration was written. */
  private static readonly GENERAL_GOAL_IDS = [
    '00bff3c6-14c0-4b88-8f17-3ce3d4cb9a6c',
    '26c09da4-111b-47ee-a722-ddb8a9f35859',
    '36211f39-3d99-4600-8153-b35bae82e3dc',
    '5a8873c8-8895-4292-ae20-825b795dc918',
    '7acb7ecc-f5a9-45e4-adf9-3194b2493f99',
    '7e029361-6413-4f3b-af31-0ff8889cbae1',
    '88fa33d5-8150-4098-a912-abcdfb3e1f8e',
    'a186b440-d0be-4f88-920b-7128997d120e',
    'b97a46c0-2df1-428b-b339-260045683be9',
    'bb6b6ca7-cfdc-407a-bcba-20dfc6e04e46',
    'c75f0e3d-4627-438f-bfa5-0cc6cb045e19',
    'd1c4345b-cf0c-4c03-ba10-e61af3e87652',
    'df8abcd8-fc20-467f-ae0f-53dcbdbfb860',
    'dfecad2d-9358-4ea8-a9fe-d282b42108bf',
  ];

  private static readonly ALLOWED_CRITERIA = [
    'cash_flow',
    'credit_consumption',
    'loans',
    'savings_investments',
    'pension_long_term',
    'lifestyle_clubs',
    'mortgage',
    'system_indicators',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "roadmap_goals"
         SET "criteria" = NULL
       WHERE "criteria" = 'general'
    `);

    const allowed =
      NormalizeRoadmapGoalGeneralCriteria1750001700000.ALLOWED_CRITERIA.map(
        (c) => `'${c}'`,
      ).join(', ');
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals"
        DROP CONSTRAINT IF EXISTS "chk_roadmap_goals_criteria"
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals"
        ADD CONSTRAINT "chk_roadmap_goals_criteria"
        CHECK ("criteria" IS NULL OR "criteria" IN (${allowed}))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_goals"
        DROP CONSTRAINT IF EXISTS "chk_roadmap_goals_criteria"
    `);

    const ids =
      NormalizeRoadmapGoalGeneralCriteria1750001700000.GENERAL_GOAL_IDS.map(
        (id) => `'${id}'`,
      ).join(', ');
    await queryRunner.query(`
      UPDATE "roadmap_goals"
         SET "criteria" = 'general'
       WHERE "goal_id" IN (${ids})
    `);
  }
}
