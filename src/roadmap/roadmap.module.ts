import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoadmapController } from './roadmap.controller.js';
import { RoadmapService } from './roadmap.service.js';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { RoadmapState } from '../database/entities/roadmap-state.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([RoadmapStep, RoadmapState, UserProfile])],
  controllers: [RoadmapController],
  providers: [RoadmapService],
  exports: [RoadmapService],
})
export class RoadmapModule {}
