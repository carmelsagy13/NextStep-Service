import {
  Injectable,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  OpenFinanceService,
  PersistAnalysisResult,
} from '../open-finance/open-finance.service.js';
import { OpenFinanceApiService } from '../open-finance/open-finance-api.service.js';
import { ConnectApiResult } from '../open-finance/open-finance-api.types.js';
import { AspirationSyncService } from '../aspirations/aspiration-sync.service.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';

export interface DemoTriggerResult {
  /** Whether the full LLM pipeline or the lightweight partial sync was run. */
  mode: 'full' | 'partial';
  /** Which source fed the full pipeline: local demo file or the live OF API. */
  source?: 'file' | 'api';
  /** Full analysis result when mode === 'full'. */
  full?: ConnectApiResult | PersistAnalysisResult;
  /** Number of aspiration-linked tasks refreshed when mode === 'partial'. */
  partial?: { updatedTasksCount: number };
}

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly openFinance: OpenFinanceService,
    private readonly openFinanceApi: OpenFinanceApiService,
    private readonly aspirationSync: AspirationSyncService,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
  ) {}

  /** Returns true when the DEMO_MODE environment variable is set to "true". */
  isDemoMode(): boolean {
    return this.config.get<string>('DEMO_MODE', '').toLowerCase() === 'true';
  }

  /**
   * FULL pipeline — runs on every LOGIN.
   *
   * Always re-runs the complete profile classification + state determination +
   * task reconciliation, regardless of whether the user already has a profile
   * (overwriting the existing roadmap/goals). The data SOURCE is selectable so
   * the demo works even when the live Open Finance API is unavailable:
   *   • DEMO_DATA_PATH set   → read that local JSON file and analyze it
   *     (same pipeline as POST /openfinance/upload).
   *   • DEMO_DATA_PATH unset → call the live Open Finance API using the user's
   *     national ID (same pipeline as POST /openfinance/connect-api).
   *
   * @throws ForbiddenException  when DEMO_MODE is not enabled.
   */
  async runFull(userId: string): Promise<DemoTriggerResult> {
    if (!this.isDemoMode()) {
      throw new ForbiddenException('Demo mode is not enabled on this server.');
    }

    const dataPath = this.config.get<string>('DEMO_DATA_PATH', '').trim();

    // ── Source A: local demo file ────────────────────────────────────────
    if (dataPath) {
      this.logger.log(
        `[Demo] LOGIN full pipeline for userId=${userId} from local file "${dataPath}".`,
      );
      const bankingData = await this.loadDemoData(dataPath);
      const full = await this.openFinance.analyzeBankingJson(bankingData, userId);
      return { mode: 'full', source: 'file', full };
    }

    // ── Source B: live Open Finance API ──────────────────────────────────
    this.logger.log(
      `[Demo] LOGIN full pipeline for userId=${userId} via Open Finance API.`,
    );
    const full = await this.openFinanceApi.connectAndAnalyze(userId);
    return { mode: 'full', source: 'api', full };
  }

  /**
   * PARTIAL sync — runs on a session REFRESH.
   *
   * Lightweight: re-tunes the roadmap tasks linked to stale aspirations without
   * re-running the expensive multi-pass LLM classification (that already ran at
   * login). Safe to call repeatedly; a no-op when nothing has changed.
   *
   * @throws ForbiddenException  when DEMO_MODE is not enabled.
   */
  async runPartial(userId: string): Promise<DemoTriggerResult> {
    if (!this.isDemoMode()) {
      throw new ForbiddenException('Demo mode is not enabled on this server.');
    }

    this.logger.log(`[Demo] REFRESH partial sync for userId=${userId}.`);
    const updatedTasksCount =
      await this.aspirationSync.syncUserGoalsForAspirations(userId);
    return { mode: 'partial', partial: { updatedTasksCount } };
  }

  /**
   * Reads and parses the local demo banking JSON.
   * The path is resolved against the process working directory.
   */
  private async loadDemoData(relativePath: string): Promise<unknown> {
    const absolutePath = resolve(process.cwd(), relativePath);

    let raw: string;
    try {
      raw = await readFile(absolutePath, 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Demo] Could not read demo data file at "${absolutePath}": ${msg}`);
      throw new InternalServerErrorException(
        `Demo data file not found. Check DEMO_DATA_PATH (resolved: "${absolutePath}").`,
      );
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new InternalServerErrorException(
        `Demo data file at "${absolutePath}" is not valid JSON.`,
      );
    }
  }
}
