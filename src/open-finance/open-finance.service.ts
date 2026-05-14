import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BankConsent } from '../database/entities/bank-consent.entity.js';
import { BankToken } from '../database/entities/bank-token.entity.js';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { RoadmapState } from '../database/entities/roadmap-state.entity.js';
import { UserGoal } from '../database/entities/user-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

export interface AiCriteriaProfile {
  current_step: number;
  cash_flow: number;
  credit_consumption: number;
  loans: number;
  savings_investments: number;
  pension_long_term: number;
  lifestyle_clubs: number;
  mortgage: number;
  system_indicators: number;
  age: number | null;
  risk_level: string | null;
  knowledge_level: string | null;
  occupation: string | null;
}

export interface GeminiAnalysisResult {
  roadmap_state: {
    current_step: number;
    progress_percentage: number;
    state_description: string;
  };
  user_profile: AiCriteriaProfile;
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
  private readonly groq: Groq;
  private readonly geminiModel: string;
  private readonly groqModel: string;

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
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new InternalServerErrorException('GEMINI_API_KEY is not configured');
    }
    this.gemini = new GoogleGenerativeAI(geminiKey);
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      throw new InternalServerErrorException('GROQ_API_KEY is not configured');
    }
    this.groq = new Groq({ apiKey: groqKey });
    this.groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
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

    return this.analyzeBankingJson(bankingData, userId);
  }

  /**
   * Normalization Bridge: takes already-parsed Open Banking JSON (from any source —
   * file upload, Open Finance API, etc.), runs it through the LLM analyzer and
   * persists the resulting roadmap state / user profile / user goals.
   *
   * This is the single entry point reused by both the file-upload flow and the
   * Open Finance API integration so both paths produce identical DB writes.
   */
  async analyzeBankingJson(bankingData: unknown, userId: string): Promise<PersistAnalysisResult> {
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

    // 3. Build human-readable descriptions of each stage (used for overall roadmap classification).
    const stagesSection = stages
      .map((s) => {
        const detail = s.description ?? JSON.stringify(s.criteria ?? {});
        return `  Stage ${s.stepId} – ${s.title}: ${detail}`;
      })
      .join('\n');

    // 3b. Build the dynamic criteria section from the DB — one block per stage.
    const criteriaByStageSection = stages
      .map((s) =>
        [
          `### Stage ${s.stepId} – ${s.title}`,
          s.criteria
            ? JSON.stringify(s.criteria, null, 2)
            : '  (no criteria defined for this stage)',
        ].join('\n'),
      )
      .join('\n\n');

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
      "Analyze the user's Open Banking data below and produce THREE things:",
      '1. Determine the user\'s current Roadmap State (which of the 5 stages they are in and their progress %).',
      '2. Evaluate the user\'s financial status (a stage from 1 to 5) for each of the 8 granular criteria defined below.',
      '   Also extract demographic context: age, occupation, risk tolerance, and financial knowledge level.',
      '3. From the provided Task Bank, select ONLY the goals that are relevant to this specific user based on their data.',
      '   - For each selected goal, populate dynamic_params with actual values derived from the user data.',
      '   - Fill in target_amount, current_amount, and target_date where applicable (use null if not determinable).',
      '   - Provide a short Hebrew justification in ai_insight.',
      '   - EXCLUDE goals that are not applicable to the user.',
      '',
      '## Financial Stage Definitions (apply to both overall roadmap_state and each criterion)',
      stagesSection,
      '',
      '## 8 Granular Financial Criteria — Stage Definitions from Database',
      '  Below are the exact stage definitions (from our system) for all 5 stages across 8 financial categories.',
      '  For each category (cash_flow, credit_consumption, loans, savings_investments, pension_long_term,',
      '  lifestyle_clubs, mortgage, system_indicators), determine which stage (1–5) best matches the user\'s',
      '  behavior based on the financial_indicators defined for each stage.',
      '',
      criteriaByStageSection,
      '',
      '  The overall current_step in both roadmap_state and user_profile must be a weighted synthesis of these 8 criteria.',
      '',
      '## Demographic Extraction',
      '  From the banking data, infer:',
      '  - age: integer (null if not determinable)',
      '  - occupation: string in Hebrew (null if not determinable)',
      '  - risk_level: one of "low" | "medium" | "high" based on observed investment/spending behaviour',
      '  - knowledge_level: one of "beginner" | "intermediate" | "advanced" based on product complexity held',
      '',
      '## Task Bank (active goal templates)',
      taskBankSection || '  (no active goal templates found)',
      '',
      '## User Open Banking Data',
      JSON.stringify(bankingData, null, 2),
      '',
      '## Response Format',
      'Respond EXCLUSIVELY with a single valid JSON object — no markdown, no code fences, no extra text.',
      'Return ONLY a valid JSON object. Do not include any markdown formatting, backticks, or newlines outside the JSON structure. Ensure all Hebrew strings are properly escaped (use \\" for any embedded quote, never raw control characters). The response MUST parse with JSON.parse on the first try.',
      JSON.stringify(
        {
          roadmap_state: {
            current_step: '<integer 1–5>',
            progress_percentage: '<integer 0–100>',
            state_description: '<Hebrew string>',
          },
          user_profile: {
            current_step: '<integer 1–5, weighted synthesis of 8 criteria>',
            cash_flow: '<integer 1–5>',
            credit_consumption: '<integer 1–5>',
            loans: '<integer 1–5>',
            savings_investments: '<integer 1–5>',
            pension_long_term: '<integer 1–5>',
            lifestyle_clubs: '<integer 1–5>',
            mortgage: '<integer 1–5>',
            system_indicators: '<integer 1–5>',
            age: '<integer or null>',
            risk_level: '<"low" | "medium" | "high" or null>',
            knowledge_level: '<"beginner" | "intermediate" | "advanced" or null>',
            occupation: '<Hebrew string or null>',
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

    // 6. Call the AI provider and parse the structured response.
    const useBackup = process.env.USE_BACKUP_AI === 'true';
    let geminiResult: GeminiAnalysisResult;

    if (useBackup) {
      console.log(`[AI] USE_BACKUP_AI=true — using Groq (${this.groqModel}) as primary provider`);
      geminiResult = await this.callGroq(prompt);
    } else {
      try {
        const model = this.gemini.getGenerativeModel({ model: this.geminiModel });
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
        geminiResult.user_profile = this.normalizeCriteriaProfile(geminiResult.user_profile);
      } catch (err: any) {
        const status: number | undefined = err?.status ?? err?.response?.status;
        const isRetryable = status === 503 || status === 429;

        if (isRetryable) {
          console.warn(
            `[AI] Gemini returned ${status} — falling back to Groq (${this.groqModel})`,  
          );
          geminiResult = await this.callGroq(prompt);
        } else {
          console.error('--- Gemini Error Details ---');
          if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', JSON.stringify(err.response.data));
          } else {
            console.error('Error Message:', err.message);
          }
          throw new InternalServerErrorException(`Gemini analysis failed: ${err.message}`);
        }
      }
    }

    // 7. Persist the result to the database within a single transaction.
    return this.persistAnalysisResult(geminiResult, userId, goalTemplates);
  }

  private async callGroq(prompt: string): Promise<GeminiAnalysisResult> {
    try {
      const completion = await this.groq.chat.completions.create({
        model: this.groqModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 2048,
      });

      const rawText = completion.choices[0]?.message?.content ?? '';
      console.log('[AI] Groq raw response:', rawText);

      const result: GeminiAnalysisResult = JSON.parse(rawText);
      result.roadmap_state.current_step = Number(result.roadmap_state.current_step) || 1;
      result.roadmap_state.progress_percentage = Number(result.roadmap_state.progress_percentage) || 0;
      result.user_profile = this.normalizeCriteriaProfile(result.user_profile);
      return result;
    } catch (err: any) {
      console.error('--- Groq Error Details ---');
      console.error('Error Message:', err.message);
      throw new InternalServerErrorException(`Groq analysis failed: ${err.message}`);
    }
  }

  /** Coerce all integer criteria fields to numbers, clamp to 1–5, and keep strings as strings. */
  private normalizeCriteriaProfile(raw: any): AiCriteriaProfile {
    const clamp = (v: any) => Math.min(5, Math.max(1, Number(v) || 1));
    return {
      current_step:         clamp(raw?.current_step),
      cash_flow:            clamp(raw?.cash_flow),
      credit_consumption:   clamp(raw?.credit_consumption),
      loans:                clamp(raw?.loans),
      savings_investments:  clamp(raw?.savings_investments),
      pension_long_term:    clamp(raw?.pension_long_term),
      lifestyle_clubs:      clamp(raw?.lifestyle_clubs),
      mortgage:             clamp(raw?.mortgage),
      system_indicators:    clamp(raw?.system_indicators),
      age:                  raw?.age != null ? (Number(raw.age) || null) : null,
      risk_level:           raw?.risk_level ?? null,
      knowledge_level:      raw?.knowledge_level ?? null,
      occupation:           raw?.occupation ?? null,
    };
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

      // --- Upsert UserProfile with 8 granular criteria + demographics ---
      const p = geminiResult.user_profile;
      let profile = await manager.findOne(UserProfile, { where: { userId } });
      if (!profile) {
        profile = manager.create(UserProfile, { userId });
      }
      profile.currentStep        = p.current_step;
      profile.cashFlow           = p.cash_flow;
      profile.creditConsumption  = p.credit_consumption;
      profile.loans              = p.loans;
      profile.savingsInvestments = p.savings_investments;
      profile.pensionLongTerm    = p.pension_long_term;
      profile.lifestyleClubs     = p.lifestyle_clubs;
      profile.mortgage           = p.mortgage;
      profile.systemIndicators   = p.system_indicators;
      if (p.age !== null)            profile.age            = p.age;
      if (p.risk_level !== null)     profile.riskTolerance  = p.risk_level;
      if (p.knowledge_level !== null) profile.knowledgeLevel = p.knowledge_level;
      if (p.occupation !== null)     profile.occupation     = p.occupation;
      await manager.save(UserProfile, profile);

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

  /**
   * Deletes all financial profile and roadmap data for the given user
   * within a single transaction. The User account itself is NOT touched.
   */
  async resetUserData(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserGoal, { userId });
      await manager.delete(UserProfile, { userId });
      await manager.delete(RoadmapState, { userId });
    });
  }
}
