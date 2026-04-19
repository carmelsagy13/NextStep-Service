import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';
import { UserGoal } from '../database/entities/user-goal.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserGoal, RoadmapGoal])],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
