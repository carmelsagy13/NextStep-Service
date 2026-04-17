import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmOrchestratorService } from './llm-orchestrator.service.js';
import { LlmGuidanceLog } from '../database/entities/llm-guidance-log.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([LlmGuidanceLog])],
  providers: [LlmOrchestratorService],
  exports: [LlmOrchestratorService],
})
export class LlmOrchestratorModule {}
