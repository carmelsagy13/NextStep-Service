import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinancialEvent } from '../database/entities/financial-event.entity.js';

@Injectable()
export class EventDetectionService {
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

  async detectEvents(userId: string, newTransactions: any[]) {
    // TODO: compare new transactions, detect salary, large expense, goal reached
    // Write detected events to DB and update progress state
    return [];
  }
}
