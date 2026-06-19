import {
  BadRequestException,
  ForbiddenException,
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
import {
  isRoadmapGoalEligible,
  criteriaScoresFromProfile,
} from '../common/roadmap-goal-eligibility.js';

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
   * Two-Step AI Reasoning Chain:
   *
   * Step 1 – Classification (LLM Call 1)
   *   The user profile criteria are sent to the LLM for pure classification.
   *   Output: a single integer (1–5) representing the user's current financial step.
   *   The AI is constrained to ONLY classify — no goal selection.
   *
   * Step 2 – Hard DB Pre-Filter
   *   Fetch all active roadmap_goals, then filter by eligibility. Goals are
   *   eligible if either:
   *     - General goal (criteria = NULL): stepId === classifiedStep
   *     - Criteria goal: user's score in that criterion >= goal's stepId
   *   This is an absolute boundary: no ineligible goals can leak through.
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
    // The user's latest questionnaire answers (off-platform context) are loaded
    // once and threaded into BOTH LLM calls to sharpen step classification and
    // personalization. Resolves to null when onboarding was never completed.
    const questionnaire = await this.questionnaire.buildLatestSummary(userId);
    process.stdout.write(`\n===== [GoalsService] STEP 1: Classify userId=${userId} =====\n`);
    const classifiedStep = await this.llmOrchestrator.classifyUserStep(profile, questionnaire);
    process.stdout.write(`\n===== [GoalsService] STEP 1 RESULT: classifiedStep=${classifiedStep} =====\n`);

    // ── Step 2: Hard DB pre-filter (the isolation boundary) ───────────────
    // Fetch all active goals, then filter by eligibility (general OR criteria-based).
    const allActiveGoals = await this.roadmapGoalRepo.find({
      where: { isActive: true },
      order: { priority: 'ASC' },
    });

    const criteriaScores = criteriaScoresFromProfile(profile);
    const filteredGoals = allActiveGoals.filter((goal) =>
      isRoadmapGoalEligible(goal, {
        currentStep: classifiedStep,
        criteriaScores,
      }),
    );

    process.stdout.write(
      `\n===== [GoalsService] STEP 2: DB filter → ${filteredGoals.length} eligible goals ` +
      `(${allActiveGoals.length} total active, classified step=${classifiedStep}) =====\n`,
    );

    if (!filteredGoals.length) {
      return [];
    }

    // ── Step 3: Personalization ────────────────────────────────────────────
    process.stdout.write(`\n===== [GoalsService] STEP 3: Personalize ${filteredGoals.length} goals =====\n`);
    const result = await this.llmOrchestrator.personalizeGoals(profile, filteredGoals, questionnaire);
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

  async getGoals(userId: string, status?: UserGoalStatus) {
    const where = status ? { userId, status } : { userId };
    return this.goalRepo.find({ where, order: { priority: 'ASC' } });
  }

  async createGoal(userId: string, body: any) {
    // Enforce step isolation: if a roadmapGoalId is provided the referenced
    // roadmap_goal must be eligible for the user (general step match OR
    // criteria-based eligibility).
    if (body.roadmapGoalId) {
      const [roadmapGoal, profile] = await Promise.all([
        this.roadmapGoalRepo.findOne({ where: { goalId: body.roadmapGoalId } }),
        this.userProfileRepo.findOne({ where: { userId } }),
      ]);

      if (!roadmapGoal) throw new NotFoundException('Roadmap goal not found');
      if (!profile) throw new NotFoundException('User profile not found');

      const currentStep = profile.currentStep;
      if (currentStep === null || currentStep === undefined) {
        throw new BadRequestException('User has no current step assigned');
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
