import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoadmapGoal } from '../../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../../database/entities/user-profile.entity.js';
import {
  isRoadmapGoalEligible,
  criteriaScoresFromProfile,
} from '../../common/roadmap-goal-eligibility.js';

/**
 * Enforces strict step isolation: a roadmap goal can only be assigned to a user
 * if it's eligible based on their current step (for general goals) OR their
 * per-criteria score (for criteria-tagged goals).
 *
 * Applied on routes that receive a `roadmapGoalId` in the request body.
 * Passes through silently when no `roadmapGoalId` is present (custom goals).
 */
@Injectable()
export class StepIsolationGuard implements CanActivate {
  constructor(
    @InjectRepository(RoadmapGoal)
    private readonly roadmapGoalRepo: Repository<RoadmapGoal>,
    @InjectRepository(UserProfile)
    private readonly userProfileRepo: Repository<UserProfile>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.userId;
    const roadmapGoalId: string | undefined = request.body?.roadmapGoalId;

    if (!roadmapGoalId) {
      return true;
    }

    const [roadmapGoal, profile] = await Promise.all([
      this.roadmapGoalRepo.findOne({ where: { goalId: roadmapGoalId } }),
      this.userProfileRepo.findOne({ where: { userId } }),
    ]);

    if (!roadmapGoal) {
      throw new NotFoundException('Roadmap goal not found');
    }

    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    const currentStep = profile.currentStep;
    if (currentStep === null || currentStep === undefined) {
      throw new ForbiddenException('User has no current step assigned');
    }

    const criteriaScores = criteriaScoresFromProfile(profile);
    if (
      !isRoadmapGoalEligible(roadmapGoal, { currentStep, criteriaScores })
    ) {
      const reason = roadmapGoal.criteria
        ? `Goal requires ${roadmapGoal.criteria} >= ${roadmapGoal.stepId} (user: ${criteriaScores[roadmapGoal.criteria] ?? 'null'})`
        : `Goal requires step ${roadmapGoal.stepId} (user: ${currentStep})`;
      throw new ForbiddenException(
        `Goal is not eligible for this user. ${reason}`,
      );
    }

    return true;
  }
}
