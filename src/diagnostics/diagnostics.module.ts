import { Module } from '@nestjs/common';
import { DbAuditService } from './db-audit.service.js';

/** TEMPORARY DIAGNOSTICS — remove once the data cleanup is done. */
@Module({
  providers: [DbAuditService],
  exports: [DbAuditService],
})
export class DiagnosticsModule {}
