import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEMPORARY DIAGNOSTICS — mirrors audit blocks to ./data-audit.log so the full
 * report survives terminal scrollback. Enabled with DATA_AUDIT=true.
 */
const AUDIT_FILE = join(process.cwd(), 'data-audit.log');

export function writeAudit(block: string): void {
  if (process.env.DATA_AUDIT !== 'true') return;
  try {
    appendFileSync(
      AUDIT_FILE,
      `\n[${new Date().toISOString()}]\n${block}\n`,
      'utf8',
    );
  } catch {
    // Diagnostics must never break the request that triggered them.
  }
}
