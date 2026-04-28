import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserGoal } from '../database/entities/user-goal.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';
import {
  LlmOrchestratorService,
  PersonalizedGoalRecommendation,
} from '../llm-orchestrator/llm-orchestrator.service.js';

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
  ) {}

  /**
   * Two-Step AI Reasoning Chain:
   *
   * Step 1 – Classification (LLM Call 1)
   *   The user profile criteria are sent to the LLM for pure classification.
   *   Output: a single integer (1–5) representing the user's current financial step.
   *   The AI is constrained to ONLY classify — no goal selection.
   *
   * Step 2 – Hard DB Pre-Filter
   *   Query roadmap_goals WHERE step_id = classifiedStep AND is_active = true.
   *   This is an absolute boundary: no goals from other steps can leak through.
   *
   * Step 3 – Personalization (LLM Call 2)
   *   The filtered goal list (and only that list) is sent to the LLM.
   *   The AI is strictly forbidden from suggesting goals outside the provided list.
   *   It may only reorder and add Hebrew insight text.
   */
  async getRecommendedGoals(userId: string): Promise<PersonalizedGoalRecommendation[]> {
    const profile = await this.userProfileRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('User profile not found');
    if (profile.currentStep === null || profile.currentStep === undefined) {
      throw new BadRequestException('User has no current step assigned. Complete the financial analysis first.');
    }

    // ── Step 1: Classification ─────────────────────────────────────────────
    process.stdout.write(`\n===== [GoalsService] STEP 1: Classify userId=${userId} =====\n`);
    const classifiedStep = await this.llmOrchestrator.classifyUserStep(profile);
    process.stdout.write(`\n===== [GoalsService] STEP 1 RESULT: classifiedStep=${classifiedStep} =====\n`);

    // ── Step 2: Hard DB pre-filter (the isolation boundary) ───────────────
    const filteredGoals = await this.roadmapGoalRepo.find({
      where: { stepId: classifiedStep, isActive: true },
      order: { priority: 'ASC' },
    });
    process.stdout.write(`\n===== [GoalsService] STEP 2: DB filter → ${filteredGoals.length} goals for step ${classifiedStep} =====\n`);

    if (!filteredGoals.length) {
      return [];
    }

    // ── Step 3: Personalization ────────────────────────────────────────────
    process.stdout.write(`\n===== [GoalsService] STEP 3: Personalize ${filteredGoals.length} goals =====\n`);
    const result = await this.llmOrchestrator.personalizeGoals(profile, filteredGoals);
    process.stdout.write(`\n===== [GoalsService] STEP 3 DONE: returned ${result.length} recommendations =====\n`);
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

  async getGoals(userId: string) {
    return this.goalRepo.find({ where: { userId } });
  }

  async createGoal(userId: string, body: any) {
    // Enforce step isolation: if a roadmapGoalId is provided the referenced
    // roadmap_goal must belong to the user's current step.
    if (body.roadmapGoalId) {
      const roadmapGoal = await this.roadmapGoalRepo.findOne({
        where: { goalId: body.roadmapGoalId },
      });
      if (!roadmapGoal) throw new NotFoundException('Roadmap goal not found');

      const currentStep = await this.resolveCurrentStep(userId);
      if (roadmapGoal.stepId !== currentStep) {
        throw new ForbiddenException(
          `Goal belongs to step ${roadmapGoal.stepId} but user is on step ${currentStep}. Only goals from the current step can be assigned.`,
        );
      }
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
    if (dto.isCompleted !== undefined) {
      goal.isCompleted = dto.isCompleted;
    }

    return this.goalRepo.save(goal);
  }

  async deleteGoal(goalId: string) {
    const result = await this.goalRepo.delete(goalId);
    if (result.affected === 0) throw new NotFoundException('Goal not found');
    return { message: 'Goal deleted' };
  }
}
