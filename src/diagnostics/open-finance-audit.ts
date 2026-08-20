import { Logger } from '@nestjs/common';
import {
  FEATURE_USAGE,
  MEANINGFUL_WHEN_FALSY,
  OF_ENDPOINT_PURPOSE,
  OF_EXPECTED_FIELDS,
} from './data-usage.map.js';
import { writeAudit } from './audit-sink.js';

/**
 * TEMPORARY DIAGNOSTICS — Open Finance payload auditing.
 *
 * Prints, per endpoint, which fields the provider actually returns versus what
 * our types expect, so provider-side schema changes are visible immediately.
 * Field NAMES and counts only — no raw values are logged.
 *
 * Enabled with DATA_AUDIT=true.
 */

export function ofAuditEnabled(): boolean {
  return process.env.DATA_AUDIT === 'true';
}

/** Field coverage across a list of returned objects. */
export function auditRawCollection(
  logger: Logger,
  endpoint: string,
  items: unknown[],
  groupByKey?: string,
): void {
  if (!ofAuditEnabled()) return;

  const total = items.length;
  const lines: string[] = [
    `\n─── OF PAYLOAD AUDIT: ${endpoint} ───`,
    `items=${total} | feeds: ${OF_ENDPOINT_PURPOSE[endpoint] ?? 'unknown'}`,
  ];

  if (total === 0) {
    lines.push(
      'NO ITEMS RETURNED — every feature derived from this endpoint will be 0',
    );
    emit(logger, lines, 'warn');
    return;
  }

  const present = new Map<string, number>();
  const populated = new Map<string, number>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      present.set(key, (present.get(key) ?? 0) + 1);
      if (!isEmptyValue(value)) {
        populated.set(key, (populated.get(key) ?? 0) + 1);
      }
    }
  }

  const expected = OF_EXPECTED_FIELDS[endpoint] ?? [];
  const observed = [...present.keys()].sort();

  lines.push('field                          present%  populated%  status');
  for (const field of observed) {
    const status = expected.includes(field) ? 'mapped' : 'NEW / UNMAPPED';
    lines.push(
      field.padEnd(31) +
        pct(present.get(field) ?? 0, total).padStart(8) +
        pct(populated.get(field) ?? 0, total).padStart(12) +
        `  ${status}`,
    );
  }

  const missing = expected.filter((f) => !present.has(f));
  if (missing.length) {
    lines.push(
      `MISSING (our code expects, provider never sent): ${missing.join(', ')}`,
    );
  }
  const alwaysEmpty = observed.filter((f) => (populated.get(f) ?? 0) === 0);
  if (alwaysEmpty.length) {
    lines.push(
      `ALWAYS EMPTY across all ${total} items: ${alwaysEmpty.join(', ')}`,
    );
  }
  const unmapped = observed.filter((f) => !expected.includes(f));
  if (unmapped.length) {
    lines.push(
      `NEW FIELDS not in our types (provider added these): ${unmapped.join(', ')}`,
    );
  }

  if (groupByKey) {
    const groups = new Map<string, number>();
    for (const item of items) {
      const value = String(
        (item as Record<string, unknown>)?.[groupByKey] ?? '(none)',
      );
      groups.set(value, (groups.get(value) ?? 0) + 1);
    }
    lines.push(
      `${groupByKey} breakdown: ` +
        [...groups.entries()].map(([k, v]) => `${k}=${v}`).join(', '),
    );
  }

  emit(logger, lines, 'log');
}

/**
 * Per-account balance resolution. Answers why a LOAN/SAVINGS account can be
 * present while its derived feature stays 0.
 */
export function auditAccountBalances(
  logger: Logger,
  accounts: unknown[],
): void {
  if (!ofAuditEnabled()) return;

  const lines: string[] = [
    '\n─── OF ACCOUNT/BALANCE RESOLUTION ───',
    'type'.padEnd(12) +
      'ccy'.padEnd(6) +
      'balances'.padEnd(10) +
      'balanceTypes (amount@refDate, creditLimitIncluded)',
  ];

  for (const raw of accounts) {
    const a = (raw ?? {}) as Record<string, any>;
    const balances: any[] = Array.isArray(a.balances) ? a.balances : [];
    const detail = balances.length
      ? balances
          .map(
            (b) =>
              `${b?.balanceType ?? '(untyped)'}=` +
              `${b?.balanceAmount?.amount ?? b?.amount ?? '?'}` +
              `@${b?.referenceDate ?? '-'}` +
              `${b?.creditLimitIncluded === true ? ' [+creditLimit]' : ''}`,
          )
          .join(', ')
      : 'EMPTY ARRAY — pickBalance() returns 0';

    lines.push(
      String(a.accountType ?? '?').padEnd(12) +
        String(a.currency ?? '?').padEnd(6) +
        String(balances.length).padEnd(10) +
        detail,
    );

    const extras = [
      a.loanType ? `loanType=${JSON.stringify(a.loanType)}` : '',
      a.product ? `product=${String(a.product).slice(0, 40)}` : '',
      a.creditLimit
        ? `creditLimit=${JSON.stringify(a.creditLimit)}`
        : 'creditLimit=(absent)',
      a.creditLimitInterestRate
        ? `creditLimitInterestRate=${JSON.stringify(a.creditLimitInterestRate)}`
        : '',
      Array.isArray(a.securityPositions)
        ? `securityPositions=${a.securityPositions.length}`
        : '',
    ].filter(Boolean);
    if (extras.length) lines.push('            ' + extras.join(' | '));
  }

  emit(logger, lines, 'log');
}

/** Field coverage for a single returned object (monthly report, balance history). */ export function auditRawObject(
  logger: Logger,
  endpoint: string,
  obj: unknown,
): void {
  if (!ofAuditEnabled()) return;

  const lines: string[] = [
    `\n─── OF PAYLOAD AUDIT: ${endpoint} ───`,
    `feeds: ${OF_ENDPOINT_PURPOSE[endpoint] ?? 'unknown'}`,
  ];

  if (!obj || typeof obj !== 'object') {
    lines.push('ABSENT — endpoint returned nothing usable');
    emit(logger, lines, 'warn');
    return;
  }

  const expected = OF_EXPECTED_FIELDS[endpoint] ?? [];
  for (const [key, value] of Object.entries(obj)) {
    const shape = describeShape(value);
    const status = expected.includes(key) ? 'mapped' : 'NEW / UNMAPPED';
    lines.push(`${key.padEnd(34)}${shape.padEnd(28)}${status}`);
  }
  const missing = expected.filter(
    (f) => !Object.prototype.hasOwnProperty.call(obj, f),
  );
  if (missing.length) {
    lines.push(`MISSING (our code expects these): ${missing.join(', ')}`);
  }

  emit(logger, lines, 'log');
}

/**
 * Prints every extracted feature next to its consumer, flagging fields that are
 * zero/empty (nothing fed them) and fields nothing reads.
 */
export function auditFeatures(
  logger: Logger,
  userId: string,
  features: Record<string, unknown>,
): void {
  if (!ofAuditEnabled()) return;

  const lines: string[] = [
    `\n═══════ EXTRACTED FEATURE AUDIT (userId=${userId}) ═══════`,
    'field'.padEnd(30) + 'value'.padEnd(22) + 'consumed by',
  ];

  const zeroed: string[] = [];
  const meaningfulFalsy: string[] = [];
  const dead: string[] = [];
  const unmapped: string[] = [];

  for (const [key, value] of Object.entries(features)) {
    const usage = FEATURE_USAGE[key] ?? '❓ NOT IN USAGE MAP';
    if (!FEATURE_USAGE[key]) unmapped.push(key);
    if (usage.startsWith('DEAD')) dead.push(key);

    const rendered = renderValue(value);
    if (isEmptyValue(value)) {
      if (MEANINGFUL_WHEN_FALSY.has(key)) meaningfulFalsy.push(key);
      else zeroed.push(key);
    }

    lines.push(key.padEnd(30) + rendered.padEnd(22) + usage);
  }

  const missingFromPayload = Object.keys(FEATURE_USAGE).filter(
    (f) => !(f in features),
  );

  lines.push('');
  lines.push(`zero/empty values : ${zeroed.join(', ') || 'none'}`);
  lines.push(
    '   → check each is genuinely zero for this user and not a broken mapping',
  );
  lines.push(
    `falsy but meaningful: ${meaningfulFalsy.join(', ') || 'none'} (0/false is a real reading here)`,
  );
  lines.push(
    `dead fields       : ${dead.join(', ') || 'none'} (safe to delete from the extractor)`,
  );
  if (unmapped.length) {
    lines.push(
      `unknown fields    : ${unmapped.join(', ')} (added to the model but not in the usage map)`,
    );
  }
  if (missingFromPayload.length) {
    lines.push(`expected but absent: ${missingFromPayload.join(', ')}`);
  }
  lines.push('═════════ END EXTRACTED FEATURE AUDIT ═════════');

  emit(logger, lines, 'log');
}

function emit(logger: Logger, lines: string[], level: 'log' | 'warn'): void {
  const block = lines.join('\n');
  logger[level](block);
  writeAudit(block);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (value === 0 || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>);
    return entries.length === 0 || entries.every(isEmptyValue);
  }
  return false;
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === 'object') {
    return JSON.stringify(value).slice(0, 20);
  }
  return String(value).slice(0, 20);
}

function describeShape(value: unknown): string {
  if (value === null || value === undefined) return 'null/absent';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') {
    return `object{${Object.keys(value).length} keys}`;
  }
  return `${typeof value}${isEmptyValue(value) ? ' (empty)' : ''}`;
}

function pct(part: number, total: number): string {
  if (!total) return '-';
  return `${Math.round((part / total) * 100)}%`;
}
