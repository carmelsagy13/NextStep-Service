import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { OpenFinanceController } from './open-finance.controller.js';
import { OpenFinanceService } from './open-finance.service.js';
import { OpenFinanceApiService } from './open-finance-api.service.js';
import { BankConsent } from '../database/entities/bank-consent.entity.js';
import { BankToken } from '../database/entities/bank-token.entity.js';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { UserProfileHistory } from '../database/entities/user-profile-history.entity.js';
import { FinancialAnalysisModule } from '../financial-analysis/financial-analysis.module.js';
import { EventDetectionModule } from '../event-detection/event-detection.module.js';
import { QuestionnaireModule } from '../questionnaire/questionnaire.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankConsent, BankToken, RoadmapStep, RoadmapGoal, UserProfile, UserProfileHistory]),
    // Store uploaded files in memory so we can access file.buffer in the service.
    MulterModule.register({ storage: memoryStorage() }),
    FinancialAnalysisModule,
    EventDetectionModule,
    QuestionnaireModule,
  ],
  controllers: [OpenFinanceController],
  providers: [OpenFinanceService, OpenFinanceApiService],
  exports: [OpenFinanceService, OpenFinanceApiService],
})
export class OpenFinanceModule {}
