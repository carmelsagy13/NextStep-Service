import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinancialSnapshot } from '../database/entities/financial-snapshot.entity.js';

@Injectable()
export class FinancialAnalysisService {
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
}
