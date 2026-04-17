import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module.js';
import { UserProfileModule } from './user-profile/user-profile.module.js';
import { QuestionnaireModule } from './questionnaire/questionnaire.module.js';
import { OpenFinanceModule } from './open-finance/open-finance.module.js';
import { FinancialAnalysisModule } from './financial-analysis/financial-analysis.module.js';
import { EventDetectionModule } from './event-detection/event-detection.module.js';
import { RoadmapModule } from './roadmap/roadmap.module.js';
import { GoalsModule } from './goals/goals.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { LlmOrchestratorModule } from './llm-orchestrator/llm-orchestrator.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // TypeOrmModule.forRootAsync({
    //   imports: [ConfigModule],
    //   inject: [ConfigService],
    //   useFactory: (config: ConfigService) => ({
    //     type: 'postgres',
    //     host: config.get<string>('DB_HOST', 'localhost'),
    //     port: config.get<number>('DB_PORT', 5432),
    //     username: config.get<string>('DB_USERNAME', 'postgres'),
    //     password: config.get<string>('DB_PASSWORD', 'postgres'),
    //     database: config.get<string>('DB_NAME', 'nextstep'),
    //     autoLoadEntities: true,
    //     synchronize: config.get<string>('NODE_ENV') !== 'production',
    //   }),
    // }),

    ScheduleModule.forRoot(),

    AuthModule,
    // UserProfileModule,
    // QuestionnaireModule,
    // OpenFinanceModule,
    // FinancialAnalysisModule,
    // EventDetectionModule,
    // RoadmapModule,
    // GoalsModule,
    // NotificationsModule,
    // LlmOrchestratorModule,
  ],
})
export class AppModule {}
