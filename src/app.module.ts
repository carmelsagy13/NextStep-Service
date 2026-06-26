import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'node:path';
import { AuthModule } from './auth/auth.module.js';
import { UserProfileModule } from './user-profile/user-profile.module.js';
import { QuestionnaireModule } from './questionnaire/questionnaire.module.js';
import { OpenFinanceModule } from './open-finance/open-finance.module.js';
import { FinancialAnalysisModule } from './financial-analysis/financial-analysis.module.js';
import { EventDetectionModule } from './event-detection/event-detection.module.js';
import { RoadmapModule } from './roadmap/roadmap.module.js';
import { GoalsModule } from './goals/goals.module.js';
import { AspirationsModule } from './aspirations/aspirations.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { LlmOrchestratorModule } from './llm-orchestrator/llm-orchestrator.module.js';
import { LlmClientModule } from './llm-client/llm-client.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USER', 'postgres'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME', 'next-step'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: true,
        migrations: [join(__dirname, 'database', 'migrations', '*.js')],
      }),
    }),

    ScheduleModule.forRoot(),

    LlmClientModule,
    AuthModule,
    UserProfileModule,
    QuestionnaireModule,
    OpenFinanceModule,
    FinancialAnalysisModule,
    EventDetectionModule,
    RoadmapModule,
    GoalsModule,
    AspirationsModule,
    NotificationsModule,
    LlmOrchestratorModule,
  ],
})
export class AppModule {}
