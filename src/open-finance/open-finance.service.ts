import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BankConsent } from '../database/entities/bank-consent.entity.js';
import { BankToken } from '../database/entities/bank-token.entity.js';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { RoadmapState } from '../database/entities/roadmap-state.entity.js';
import { UserGoal } from '../database/entities/user-goal.entity.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiAnalysisResult {
  roadmap_state: {
    current_step: number;
    progress_percentage: number;
    state_description: string;
  };
  selected_tasks: Array<{
    roadmap_goal_id: string;
    target_amount: number | null;
    current_amount: number;
    target_date: string | null;
    is_completed: boolean;
    dynamic_params: Record<string, unknown>;
    ai_insight: string;
  }>;
}

export interface PersistAnalysisResult {
  roadmap_state: RoadmapState;
  user_goals: UserGoal[];
}

@Injectable()
export class OpenFinanceService {
  private readonly gemini: GoogleGenerativeAI;

  constructor(
    @InjectRepository(BankConsent)
    private readonly consentRepo: Repository<BankConsent>,
    @InjectRepository(BankToken)
    private readonly tokenRepo: Repository<BankToken>,
    @InjectRepository(RoadmapStep)
    private readonly stepRepo: Repository<RoadmapStep>,
    @InjectRepository(RoadmapGoal)
    private readonly roadmapGoalRepo: Repository<RoadmapGoal>,
    private readonly dataSource: DataSource,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException('GEMINI_API_KEY is not configured');
    }
    this.gemini = new GoogleGenerativeAI(apiKey);
  }

  async connect(body: any) {
    // TODO: create consent record, call Open Finance API, return consentUrl
    return { consentUrl: 'https://open-finance.co.il/consent/placeholder' };
  }

  async callback(query: any) {
    // TODO: exchange auth code for tokens, store encrypted, mark consent complete
    return { message: 'Consent finalized' };
  }

  async sync(body: any) {
    // TODO: fetch latest transactions, update DB indicators, trigger event detection
    return { message: 'Sync complete', transactionsProcessed: 0 };
  }

  /**
   * Parses the uploaded Open Banking JSON, calls Gemini to classify the user's
   * financial state and select relevant tasks, then persists everything to the DB.
   */
  async analyzeFile(fileBuffer: Buffer, userId: string): Promise<PersistAnalysisResult> {
    // 1. Parse the uploaded JSON file.
    let bankingData: unknown;
    try {
      bankingData = JSON.parse(fileBuffer.toString('utf-8'));
    } catch {
      throw new BadRequestException('Uploaded file is not valid JSON');
    }

    // 2. Fetch stage definitions and active goal templates from the DB in parallel.
    const [stages, goalTemplates] = await Promise.all([
      this.stepRepo.find({ order: { stepId: 'ASC' } }),
      this.roadmapGoalRepo.find({
        where: { isActive: true },
        order: { stepId: 'ASC', priority: 'ASC' },
      }),
    ]);

    if (!stages.length) {
      throw new InternalServerErrorException(
        'No roadmap steps found in the database. Please seed the roadmap_steps table.',
      );
    }

    // 3. Build human-readable descriptions of each stage.
    const stagesSection = stages
      .map((s) => {
        const detail = s.description ?? JSON.stringify(s.criteria ?? {});
        return `  Stage ${s.stepId} – ${s.title}: ${detail}`;
      })
      .join('\n');

    // 4. Build the task-bank section, embedding the DB UUID so Gemini can echo it back.
    const taskBankSection = goalTemplates
      .map((g) =>
        [
          `  - roadmap_goal_id: "${g.goalId}"`,
          `    step_id: ${g.stepId}`,
          `    type: ${g.type}`,
          `    title: "${g.title}"`,
          `    description_template: "${g.descriptionTemplate}"`,
          g.requiredContext ? `    required_context: "${g.requiredContext}"` : null,
          `    priority: ${g.priority}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');

    // 5. Build the full structured prompt.
    const prompt = [
      'You are an expert Israeli financial analyst. All textual output (state_description, ai_insight) MUST be written in Hebrew.',
      '',
      '## Task',
      "Analyze the user's Open Banking data below and produce two things:",
      '1. Determine the user\'s current Roadmap State (which of the 5 stages they are in and their progress %).',
      '2. From the provided Task Bank, select ONLY the goals that are relevant to this specific user based on their data.',
      '   - For each selected goal, populate dynamic_params with actual values derived from the user data.',
      '   - Fill in target_amount, current_amount, and target_date where applicable (use null if not determinable).',
      '   - Provide a short Hebrew justification in ai_insight.',
      '   - EXCLUDE goals that are not applicable to the user.',
      '',
      '## Financial Stage Definitions',
      stagesSection,
      '',
      '## Task Bank (active goal templates)',
      taskBankSection || '  (no active goal templates found)',
      '',
      '## User Open Banking Data',
      JSON.stringify(bankingData, null, 2),
      '',
      '## Response Format',
      'Respond EXCLUSIVELY with a single valid JSON object — no markdown, no code fences, no extra text:',
      JSON.stringify(
        {
          roadmap_state: {
            current_step: '<integer 1–5>',
            progress_percentage: '<integer 0–100>',
            state_description: '<Hebrew string>',
          },
          selected_tasks: [
            {
              roadmap_goal_id: '<UUID from task bank>',
              target_amount: '<number or null>',
              current_amount: '<number>',
              target_date: '<ISO-8601 string or null>',
              is_completed: false,
              dynamic_params: { key: 'value' },
              ai_insight: '<Hebrew justification>',
            },
          ],
        },
        null,
        2,
      ),
    ].join('\n');

    // 6. Call Gemini and parse the structured response.
    let geminiResult: GeminiAnalysisResult;
    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const rawText = response.text();

      console.log('Gemini raw response:', rawText);

      const jsonText = rawText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      geminiResult = JSON.parse(jsonText);
      geminiResult.roadmap_state.current_step = Number(geminiResult.roadmap_state.current_step) || 1;
      geminiResult.roadmap_state.progress_percentage = Number(geminiResult.roadmap_state.progress_percentage) || 0;
    } catch (err: any) {
      console.error('--- Gemini Error Details ---');
      if (err.response) {
        console.error('Status:', err.response.status);
        console.error('Data:', JSON.stringify(err.response.data));
      } else {
        console.error('Error Message:', err.message);
      }
      throw new InternalServerErrorException(`Gemini analysis failed: ${err.message}`);
    }

    // 7. Persist the result to the database within a single transaction.
    return this.persistAnalysisResult(geminiResult, userId, goalTemplates);
  }

  private async persistAnalysisResult(
    geminiResult: GeminiAnalysisResult,
    userId: string,
    goalTemplates: RoadmapGoal[],
  ): Promise<PersistAnalysisResult> {
    const templateMap = new Map(goalTemplates.map((g) => [g.goalId, g]));
    const currentStep = geminiResult.roadmap_state.current_step;

    return this.dataSource.transaction(async (manager) => {
      // --- Upsert RoadmapState for this user ---
      let state = await manager.findOne(RoadmapState, { where: { userId } });
      if (!state) {
        state = manager.create(RoadmapState, { userId });
      }
      state.currentStepId = currentStep;
      state.progressPercent = geminiResult.roadmap_state.progress_percentage;
      state.stateDescription = geminiResult.roadmap_state.state_description;
      const savedState = await manager.save(RoadmapState, state);

      // --- Cleanup: delete existing user_goals linked to templates of the new step ---
      const stepGoalIds = goalTemplates
        .filter((g) => g.stepId === currentStep)
        .map((g) => g.goalId);

      if (stepGoalIds.length) {
        await manager.delete(UserGoal, { userId, roadmapGoalId: In(stepGoalIds) });
      }

      // --- Insert new user_goals from Gemini's selected_tasks ---
      const newGoals = geminiResult.selected_tasks.map((task) => {
        const template = templateMap.get(task.roadmap_goal_id);
        return manager.create(UserGoal, {
          userId,
          roadmapGoalId: task.roadmap_goal_id,
          goalName: template?.title ?? 'Unknown Goal',
          dynamicParams: task.dynamic_params ?? {},
          targetAmount: task.target_amount ?? undefined,
          currentAmount: task.current_amount ?? 0,
          targetDate: task.target_date ? new Date(task.target_date) : undefined,
          isCompleted: false,
          aiInsight: task.ai_insight,
        });
      });

      const savedGoals = await manager.save(UserGoal, newGoals);

      // Re-fetch saved goals with their RoadmapGoal template relation populated
      // so the client receives the full template data (title, type, priority, etc.)
      const goalIds = savedGoals.map((g) => g.goalId);
      const goalsWithRelation = goalIds.length
        ? await manager.find(UserGoal, {
            where: { goalId: In(goalIds) },
            relations: ['roadmapGoal'],
          })
        : [];

      return { roadmap_state: savedState, user_goals: goalsWithRelation };
    });
  }
}
