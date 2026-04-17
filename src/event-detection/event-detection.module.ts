import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventDetectionService } from './event-detection.service.js';
import { EventDetectionController } from './event-detection.controller.js';
import { FinancialEvent } from '../database/entities/financial-event.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([FinancialEvent])],
  controllers: [EventDetectionController],
  providers: [EventDetectionService],
  exports: [EventDetectionService],
})
export class EventDetectionModule {}
