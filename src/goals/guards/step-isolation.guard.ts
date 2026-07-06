import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoadmapGoal } from '../../database/entities/roadmap-goal.entity.js';

/**
 * Validates that a referenced roadmap goal exists.
 *
 * The stage/eligibility limit has been removed, so any existing roadmap goal may
 * be assigned to any user. Passes through silently when no `roadmapGoalId` is
 * present (custom goals).
 */
@Injectable()
export class StepIsolationGuard implements CanActivate {
  constructor(
    @InjectRepository(RoadmapGoal)
    private readonly roadmapGoalRepo: Repository<RoadmapGoal>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const roadmapGoalId: string | undefined = request.body?.roadmapGoalId;

    if (!roadmapGoalId) {
      return true;
    }

    const roadmapGoal = await this.roadmapGoalRepo.findOne({
      where: { goalId: roadmapGoalId },
    });

    if (!roadmapGoal) {
      throw new NotFoundException('Roadmap goal not found');
    }

    return true;
  }
}
