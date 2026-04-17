import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';
import { UserGoal } from '../database/entities/user-goal.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserGoal])],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
