import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserGoal, UserGoalStatus } from '../database/entities/user-goal.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';
import {
  LlmOrchestratorService,
  PersonalizedGoalRecommendation,
} from '../llm-orchestrator/llm-orchestrator.service.js';
import { QuestionnaireService } from '../questionnaire/questionnaire.service.js';

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(UserGoal)
    private readonly goalRepo: Repository<UserGoal>,
    @InjectRepository(RoadmapGoal)
    private readonly roadmapGoalRepo: Repository<RoadmapGoal>,
    @InjectRepository(UserProfile)
    private readonly userProfileRepo: Repository<UserProfile>,
    private readonly llmOrchestrator: LlmOrchestratorService,
    private readonly questionnaire: QuestionnaireService,
  ) {}

  /**
   * AI goal recommendation:
   *
   * Step 1 – Fetch all active roadmap_goals.
   *   The stage/eligibility limit has been removed, so the complete active goal
   *   set is forwarded to the LLM regardless of the user's step or per-criteria
   *   scores.
   *
   * Step 2 – Personalization (LLM Call)
   *   The full goal list is sent to the LLM, which reorders it by relevance and
   *   adds Hebrew insight text.
   */
  async getRecommendedGoals(userId: string): Promise<PersonalizedGoalRecommendation[]> {
    const profile = await this.userProfileRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('User profile not found');
    if (profile.currentStep === null || profile.currentStep === undefined) {
      throw new BadRequestException('User has no current step assigned. Complete the financial analysis first.');
    }

    // The user's latest questionnaire answers (off-platform context) sharpen the
    // LLM personalization. Resolves to null when onboarding was never completed.
    const questionnaire = await this.questionnaire.buildLatestSummary(userId);

    // ── Step 1: Fetch all active goals ────────────────────────────────────
    // Stage/eligibility limit removed: the full active goal set is handed to the
    // LLM regardless of the user's step or per-criteria scores.
    const allActiveGoals = await this.roadmapGoalRepo.find({
      where: { isActive: true },
      order: { priority: 'ASC' },
    });

    if (!allActiveGoals.length) {
      return [];
    }

    // ── Step 2: Personalization ────────────────────────────────────────────
    const result = await this.llmOrchestrator.personalizeGoals(profile, allActiveGoals, questionnaire);
    return result;
  }

  private async resolveCurrentStep(userId: string): Promise<number> {
    const profile = await this.userProfileRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('User profile not found');
    if (profile.currentStep === null || profile.currentStep === undefined) {
      throw new BadRequestException('User has no current step assigned');
    }
    return profile.currentStep;
  }

  async getGoals(userId: string, status?: UserGoalStatus) {
    const where = status ? { userId, status } : { userId };
    return this.goalRepo.find({
      where,
      relations: ['roadmapGoal'],
      order: { priority: 'ASC' },
    });
  }

  async createGoal(userId: string, body: any) {
    // Validate the referenced roadmap goal exists when provided. The stage/
    // eligibility limit has been removed, so any existing goal may be assigned.
    if (body.roadmapGoalId) {
      const roadmapGoal = await this.roadmapGoalRepo.findOne({
        where: { goalId: body.roadmapGoalId },
      });
      if (!roadmapGoal) throw new NotFoundException('Roadmap goal not found');
    }

    const goal = this.goalRepo.create({ userId, ...body });
    return this.goalRepo.save(goal);
  }

  async updateGoal(userId: string, dto: UpdateGoalDto) {
    const goal = await this.goalRepo.findOne({ where: { goalId: dto.goalId, userId } });

    if (!goal) throw new NotFoundException('Goal not found or does not belong to this user');

    // Only update the explicitly allowed fields to respect the goal's original structure
    if (dto.currentAmount !== undefined) {
      goal.currentAmount = dto.currentAmount;
    }
    if (dto.status !== undefined) {
      this.applyStatusTransition(goal, dto.status);
    }

    return this.goalRepo.save(goal);
  }

  /**
   * Applies a lifecycle status change and keeps the associated timestamps
   * consistent. Centralized so every status mutation records when it happened.
   */
  private applyStatusTransition(goal: UserGoal, status: UserGoalStatus): void {
    goal.status = status;
    goal.completedAt = status === UserGoalStatus.COMPLETED ? new Date() : null;
    goal.removedAt =
      status === UserGoalStatus.REMOVED ||
      status === UserGoalStatus.ABANDONED ||
      status === UserGoalStatus.EXPIRED
        ? new Date()
        : null;
  }

  async deleteGoal(goalId: string) {
    const result = await this.goalRepo.delete(goalId);
    if (result.affected === 0) throw new NotFoundException('Goal not found');
    return { message: 'Goal deleted' };
  }
}
