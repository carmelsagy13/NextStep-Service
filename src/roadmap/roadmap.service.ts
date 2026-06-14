import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { RoadmapState } from '../database/entities/roadmap-state.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';

@Injectable()
export class RoadmapService {
  constructor(
    @InjectRepository(RoadmapStep)
    private readonly stepRepo: Repository<RoadmapStep>,
    @InjectRepository(RoadmapState)
    private readonly stateRepo: Repository<RoadmapState>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
  ) {}

  async getRoadmap(userId: string) {
    const [state, profile, steps] = await Promise.all([
      this.stateRepo.findOne({ where: { userId } }),
      this.profileRepo.findOne({ where: { userId } }),
      this.stepRepo.find({ order: { stepId: 'ASC' } }),
    ]);

    // current_step is owned by user_profiles; resolve the matching step row for
    // the client visualization.
    const currentStepId = profile?.currentStep ?? null;
    const currentStep =
      currentStepId != null
        ? (steps.find((s) => s.stepId === currentStepId) ?? null)
        : null;

    return { state, currentStepId, currentStep, steps };
  }

  async updateRoadmap(
    userId: string,
    body: { currentStepId?: number; progressPercent?: number },
  ) {
    // The user's current step is the single source of truth on user_profiles.
    if (body.currentStepId !== undefined) {
      let profile = await this.profileRepo.findOne({ where: { userId } });
      if (!profile) {
        profile = this.profileRepo.create({ userId });
      }
      profile.currentStep = body.currentStepId;
      await this.profileRepo.save(profile);
    }

    let state = await this.stateRepo.findOne({ where: { userId } });
    if (!state) {
      state = this.stateRepo.create({ userId, progressPercent: 0 });
    }
    if (body.progressPercent !== undefined) {
      state.progressPercent = body.progressPercent;
    }
    return this.stateRepo.save(state);
  }
}
