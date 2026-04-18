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

  async updateRoadmap(userId: string, body: { currentStepId?: number; progressPercent?: number }) {
    let state = await this.stateRepo.findOne({ where: { userId } });
    if (!state) {
      state = this.stateRepo.create({ userId, progressPercent: 0, currentStepId: body.currentStepId ?? 1 });
    }
    if (body.currentStepId !== undefined) state.currentStepId = body.currentStepId;
    if (body.progressPercent !== undefined) state.progressPercent = body.progressPercent;
    return this.stateRepo.save(state);
  }
}
