import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

/**
 * Standalone TypeORM DataSource used by the migration CLI only.
 * The running app configures TypeORM via TypeOrmModule.forRootAsync in
 * app.module.ts; this file mirrors the same connection settings so that
 * `npm run migration:run` can apply schema changes against the same database.
 *
 * The CLI runs the COMPILED output (dist), so the entity/migration globs are
 * resolved relative to this file's location at runtime. Environment variables
 * are loaded by the npm script via Node's `--env-file` flag, so no dotenv
 * dependency is required here.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'next-step',
  // Migrations are the source of truth for the CLI; never auto-sync here.
  synchronize: false,
  entities: [join(__dirname, 'entities', '*.entity.js')],
  migrations: [join(__dirname, 'migrations', '*.js')],
});
