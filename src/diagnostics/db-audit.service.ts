import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  COLUMN_NOTES,
  TABLE_USAGE,
  type TableUsage,
} from './data-usage.map.js';
import { writeAudit } from './audit-sink.js';

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

interface ColumnStat {
  name: string;
  type: string;
  nullable: boolean;
  nonNull: number;
  distinct: number;
  blank: number;
  min: string | null;
  max: string | null;
  avg: string | null;
  inEntity: boolean;
}

const NUMERIC_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'numeric',
  'real',
  'double precision',
]);

/** Never aggregate or print anything derived from these column values. */
const SENSITIVE_COLUMNS = new Set([
  'password_hash',
  'access_token_enc',
  'refresh_token_enc',
  'email',
]);

/**
 * TEMPORARY DIAGNOSTICS — profiles every table in the public schema and prints
 * fill-rates plus the static "who uses this" annotations, so dead columns and
 * garbage data can be spotted from the terminal.
 *
 * Enabled with DATA_AUDIT=true. Prints no column values, only aggregates.
 */
@Injectable()
export class DbAuditService implements OnModuleInit {
  private readonly logger = new Logger('DbAudit');

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (process.env.DATA_AUDIT !== 'true') return;
    try {
      await this.runAudit();
    } catch (err) {
      this.logger.error(
        `DB audit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runAudit(): Promise<void> {
    const columns: ColumnInfo[] = await this.dataSource.query(
      `select table_name, column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name not in ('migrations')
        order by table_name, ordinal_position`,
    );

    const byTable = new Map<string, ColumnInfo[]>();
    for (const col of columns) {
      const list = byTable.get(col.table_name) ?? [];
      list.push(col);
      byTable.set(col.table_name, list);
    }

    // Entity metadata lets us flag drift between the code and the real schema.
    const entityColumns = new Map<string, Set<string>>();
    const entityNames = new Map<string, string>();
    for (const meta of this.dataSource.entityMetadatas) {
      entityColumns.set(
        meta.tableName,
        new Set(meta.columns.map((c) => c.databaseName)),
      );
      entityNames.set(meta.tableName, meta.name);
    }

    const lines: string[] = [];
    lines.push(
      '\n══════════════════════ DB DATA AUDIT ══════════════════════',
      `database=${this.dataSource.options.database as string} | tables=${byTable.size}`,
      'blank% counts empty string / {} / [] / null-json / 0 values.',
      '',
    );

    const emptyTables: string[] = [];
    const droppable: string[] = [];

    for (const [table, cols] of [...byTable.entries()].sort()) {
      const usage: TableUsage | undefined = TABLE_USAGE[table];
      const entityCols = entityColumns.get(table);
      const rows = await this.countRows(table);

      lines.push(
        `── ${table} ${usage ? `(${usage.entity})` : '(NO ENTITY IN CODE)'} — rows=${rows}`,
      );
      if (usage) {
        lines.push(`   purpose : ${usage.purpose}`);
        lines.push(`   written : ${usage.writtenBy}`);
        lines.push(`   read    : ${usage.readBy}`);
        lines.push(`   verdict : ${usage.verdict}`);
      }

      if (rows === 0) {
        emptyTables.push(table);
        lines.push('   (table is empty — no column stats)', '');
        continue;
      }

      const stats = await this.profileColumns(table, cols, rows, entityCols);
      lines.push(
        '   ' +
          'column'.padEnd(32) +
          'type'.padEnd(18) +
          'null%'.padStart(7) +
          'blank%'.padStart(8) +
          'distinct'.padStart(10) +
          '  range',
      );
      for (const s of stats) {
        const nullPct = pct(rows - s.nonNull, rows);
        const blankPct = pct(s.blank, rows);
        const range =
          s.min !== null || s.max !== null
            ? `min=${s.min} max=${s.max} avg=${s.avg}`
            : '';
        lines.push(
          '   ' +
            (s.inEntity ? s.name : `${s.name} *`).padEnd(32) +
            s.type.slice(0, 17).padEnd(18) +
            nullPct.padStart(7) +
            blankPct.padStart(8) +
            String(s.distinct).padStart(10) +
            (range ? `  ${range}` : ''),
        );

        const note = COLUMN_NOTES[`${table}.${s.name}`];
        if (note) lines.push(`        ↳ note: ${note}`);
        if (s.nonNull === 0) {
          lines.push('        ↳ ALWAYS NULL — nothing ever writes this column');
          droppable.push(`${table}.${s.name} (always null)`);
        } else if (s.distinct === 1 && rows > 1) {
          lines.push(
            '        ↳ single distinct value across every row — carries no information',
          );
        }
      }

      if (entityCols) {
        const dbNames = new Set(cols.map((c) => c.column_name));
        for (const missing of [...entityCols].filter((c) => !dbNames.has(c))) {
          lines.push(
            `   ⚠ entity declares "${missing}" but the column does not exist in the DB`,
          );
        }
        const orphans = cols
          .map((c) => c.column_name)
          .filter((c) => !entityCols.has(c));
        if (orphans.length) {
          lines.push(
            `   ⚠ DB columns with no entity property (leftovers): ${orphans.join(', ')}`,
          );
          droppable.push(
            ...orphans.map((o) => `${table}.${o} (no entity property)`),
          );
        }
      }
      lines.push('');
    }

    lines.push('──────────────── CLEANUP CANDIDATES ────────────────');
    const unusedTables = Object.entries(TABLE_USAGE)
      .filter(([, u]) => u.verdict === 'UNUSED' || u.verdict === 'WRITE-ONLY')
      .map(([t, u]) => `${t} (${u.verdict})`);
    lines.push(`tables never read      : ${unusedTables.join(', ') || 'none'}`);
    lines.push(`tables with zero rows  : ${emptyTables.join(', ') || 'none'}`);
    lines.push(
      `columns to review      : ${droppable.length ? '\n  - ' + droppable.join('\n  - ') : 'none'}`,
    );
    lines.push(
      'legend: "*" after a column name = present in the DB but not declared on the entity.',
    );
    lines.push('════════════════════ END DB DATA AUDIT ════════════════════');

    const report = lines.join('\n');
    this.logger.log(report);
    writeAudit(report);
  }

  private async countRows(table: string): Promise<number> {
    const [{ count }] = await this.dataSource.query(
      `select count(*)::int as count from "${table}"`,
    );
    return Number(count);
  }

  private async profileColumns(
    table: string,
    cols: ColumnInfo[],
    rows: number,
    entityCols: Set<string> | undefined,
  ): Promise<ColumnStat[]> {
    const selects: string[] = [];
    cols.forEach((c, i) => {
      const q = `"${c.column_name}"`;
      selects.push(`count(${q})::int as n${i}`);
      if (SENSITIVE_COLUMNS.has(c.column_name)) {
        // Fill-rate only: never touch the values of credentials/PII.
        selects.push(`0::int as d${i}`, `0::int as b${i}`);
        return;
      }
      selects.push(`count(distinct ${q}::text)::int as d${i}`);
      selects.push(
        `count(*) filter (where btrim(${q}::text) in ` +
          `('', '{}', '[]', 'null', '0', '0.00', '0.0'))::int as b${i}`,
      );
      if (NUMERIC_TYPES.has(c.data_type)) {
        selects.push(
          `min(${q})::text as mn${i}`,
          `max(${q})::text as mx${i}`,
          `round(avg(${q})::numeric, 2)::text as av${i}`,
        );
      }
    });

    const [agg] = await this.dataSource.query(
      `select ${selects.join(', ')} from "${table}"`,
    );

    return cols.map((c, i) => ({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === 'YES',
      nonNull: Number(agg[`n${i}`] ?? 0),
      distinct: Number(agg[`d${i}`] ?? 0),
      blank: Number(agg[`b${i}`] ?? 0),
      min: agg[`mn${i}`] ?? null,
      max: agg[`mx${i}`] ?? null,
      avg: agg[`av${i}`] ?? null,
      inEntity: entityCols ? entityCols.has(c.column_name) : true,
    }));
  }
}

function pct(part: number, total: number): string {
  if (!total) return '-';
  return `${Math.round((part / total) * 100)}%`;
}
