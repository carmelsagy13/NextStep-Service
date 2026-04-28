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

/**
 * Enforces strict step isolation: a roadmap goal can only be assigned to a user
 * whose current_step matches the goal's step_id.
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

    if (roadmapGoal.stepId !== profile.currentStep) {
      throw new ForbiddenException(
        `Goal belongs to step ${roadmapGoal.stepId} but user is on step ${profile.currentStep}. Step isolation enforced.`,
      );
    }

    return true;
  }
}
