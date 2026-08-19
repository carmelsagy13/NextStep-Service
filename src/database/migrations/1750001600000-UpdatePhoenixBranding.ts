import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Swaps the Phoenix placeholder logo for the supplied brand asset and aligns the
 * accent colour with it. Both are plain data updates — branding changes never
 * require a code deploy.
 */
export class UpdatePhoenixBranding1750001600000 implements MigrationInterface {
  name = 'UpdatePhoenixBranding1750001600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "partners"
        SET "logo_path" = 'partners/phoenix/logo.png',
            "brand_color" = '#FD5C1D'
        WHERE "code" = 'phoenix'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "partners"
        SET "logo_path" = 'partners/phoenix/logo.svg',
            "brand_color" = '#E8452C'
        WHERE "code" = 'phoenix'
    `);
  }
}
