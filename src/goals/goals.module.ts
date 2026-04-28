import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';
import { StepIsolationGuard } from './guards/step-isolation.guard.js';
import { UserGoal } from '../database/entities/user-goal.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { LlmOrchestratorModule } from '../llm-orchestrator/llm-orchestrator.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserGoal, RoadmapGoal, UserProfile]), LlmOrchestratorModule],
  controllers: [GoalsController],
  providers: [GoalsService, StepIsolationGuard],
  exports: [GoalsService],
})
export class GoalsModule {}
