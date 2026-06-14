import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinancialEvent } from '../database/entities/financial-event.entity.js';
import type { FinancialFeatures } from '../open-finance/financial-features.model.js';

/** Deterministic event types derived directly from the financial report. */
export const FinancialEventType = {
  /** A month in the reported window where expense exceeded income. */
  DEFICIT_MONTH: 'DEFICIT_MONTH',
} as const;

@Injectable()
export class EventDetectionService {
  private readonly logger = new Logger(EventDetectionService.name);

  constructor(
    @InjectRepository(FinancialEvent)
    private readonly eventRepo: Repository<FinancialEvent>,
  ) {}

  async getEvents(userId: string) {
    return this.eventRepo.find({
      where: { userId },
      order: { eventDate: 'DESC' },
      take: 20,
    });
  }

  /**
   * Detects deterministic, data-backed financial events from the extracted
   * features and persists any that are not already recorded.
   *
   * Currently emits DEFICIT_MONTH events — one per month in the report window
   * where expense exceeded income. This is the only event type derivable
   * without an externally-defined threshold. Detection is idempotent: months
   * already stored for the user are skipped, so re-running an analysis over an
   * overlapping window does not create duplicates.
   */
  async detectEvents(
    userId: string,
    features: FinancialFeatures,
  ): Promise<FinancialEvent[]> {
    const deficitMonths = features.monthlyBalances.filter((m) => m.net < 0);
    if (!deficitMonths.length) return [];

    // Load already-recorded deficit events to dedupe by month.
    const existing = await this.eventRepo.find({
      where: { userId, eventType: FinancialEventType.DEFICIT_MONTH },
    });
    const existingKeys = new Set(
      existing.map((e) => this.monthKey(e.eventDate)),
    );

    const toInsert: FinancialEvent[] = [];
    for (const m of deficitMonths) {
      const eventDate = this.parseYearMonth(m.yearMonth);
      if (!eventDate) continue;
      const key = this.monthKey(eventDate);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      toInsert.push(
        this.eventRepo.create({
          userId,
          eventType: FinancialEventType.DEFICIT_MONTH,
          amount: m.net,
          eventDate,
        }),
      );
    }

    if (!toInsert.length) return [];
    const saved = await this.eventRepo.save(toInsert);
    this.logger.log(
      `Detected ${saved.length} new DEFICIT_MONTH event(s) — userId=${userId}`,
    );
    return saved;
  }

  /** Parses a provider "YY-MM" label (e.g. "26-05") to the first of that month (UTC). */
  private parseYearMonth(yearMonth: string): Date | null {
    const match = /^(\d{2})-(\d{2})$/.exec(yearMonth);
    if (!match) return null;
    const year = 2000 + Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return new Date(Date.UTC(year, month - 1, 1));
  }

  /** Year-month dedupe key for a stored event date. */
  private monthKey(date: Date): string {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
  }
}
