import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialAnalysisController } from './financial-analysis.controller.js';
import { FinancialAnalysisService } from './financial-analysis.service.js';
import { FinancialSnapshot } from '../database/entities/financial-snapshot.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([FinancialSnapshot])],
  controllers: [FinancialAnalysisController],
  providers: [FinancialAnalysisService],
  exports: [FinancialAnalysisService],
})
export class FinancialAnalysisModule {}
