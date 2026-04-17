import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { RoadmapState } from '../database/entities/roadmap-state.entity.js';

@Injectable()
export class RoadmapService {
  constructor(
    @InjectRepository(RoadmapStep)
    private readonly stepRepo: Repository<RoadmapStep>,
    @InjectRepository(RoadmapState)
    private readonly stateRepo: Repository<RoadmapState>,
  ) {}

  async getRoadmap(userId: string) {
    const state = await this.stateRepo.findOne({
      where: { userId },
      relations: ['currentStep'],
    });
    const steps = await this.stepRepo.find({ order: { stepId: 'ASC' } });
    return { state, steps };
  }

  async updateRoadmap(userId: string, body: any) {
    // TODO: update roadmap state in DB
    return { message: 'Roadmap updated' };
  }
}
