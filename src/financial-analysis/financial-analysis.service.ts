import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinancialSnapshot } from '../database/entities/financial-snapshot.entity.js';
import type { FinancialFeatures } from '../open-finance/financial-features.model.js';

@Injectable()
export class FinancialAnalysisService {
  private readonly logger = new Logger(FinancialAnalysisService.name);

  constructor(
    @InjectRepository(FinancialSnapshot)
    private readonly snapshotRepo: Repository<FinancialSnapshot>,
  ) {}

  async getSnapshot(userId: string) {
    // TODO: compute and return financial metrics
    return this.snapshotRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Persists a raw financial snapshot derived deterministically from the Open
   * Finance report. Each analysis run appends one immutable row, giving a
   * time-series of the user's headline figures.
   *
   * Field mapping (all traceable to extracted features):
   *  - monthlyIncome   ← features.monthlyIncome
   *  - monthlyExpenses ← features.monthlyExpenses
   *  - totalSavings    ← features.totalInvestments (savings + securities)
   *  - totalDebt       ← features.totalDebt (loans + mortgage)
   */
  async persistSnapshot(
    userId: string,
    features: FinancialFeatures,
  ): Promise<FinancialSnapshot> {
    const latest = await this.snapshotRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    // Re-running the analysis on unchanged bank data must not append a
    // duplicate row — the table is a change history, not a run log.
    if (latest && this.isSameSnapshot(latest, features)) {
      this.logger.log(
        `Snapshot unchanged — userId=${userId}, reusing ${latest.snapshotId}`,
      );
      return latest;
    }

    const snapshot = this.snapshotRepo.create({
      userId,
      monthlyIncome: features.monthlyIncome,
      monthlyExpenses: features.monthlyExpenses,
      totalSavings: features.totalInvestments,
      totalDebt: features.totalDebt,
    });
    const saved = await this.snapshotRepo.save(snapshot);
    this.logger.log(
      `Snapshot saved — userId=${userId} income=${features.monthlyIncome} ` +
        `expenses=${features.monthlyExpenses} savings=${features.totalInvestments} ` +
        `debt=${features.totalDebt}`,
    );
    return saved;
  }

  /** Decimal columns come back as strings, so compare numerically. */
  private isSameSnapshot(
    snapshot: FinancialSnapshot,
    features: FinancialFeatures,
  ): boolean {
    const same = (stored: unknown, incoming: number): boolean =>
      Number(stored ?? 0) === Number(incoming ?? 0);
    return (
      same(snapshot.monthlyIncome, features.monthlyIncome) &&
      same(snapshot.monthlyExpenses, features.monthlyExpenses) &&
      same(snapshot.totalSavings, features.totalInvestments) &&
      same(snapshot.totalDebt, features.totalDebt)
    );
  }
}
