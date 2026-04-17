import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoadmapController } from './roadmap.controller.js';
import { RoadmapService } from './roadmap.service.js';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { RoadmapState } from '../database/entities/roadmap-state.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([RoadmapStep, RoadmapState])],
  controllers: [RoadmapController],
  providers: [RoadmapService],
  exports: [RoadmapService],
})
export class RoadmapModule {}
