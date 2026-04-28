import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { LlmGuidanceLog } from '../database/entities/llm-guidance-log.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';

export interface PersonalizedGoalRecommendation {
  roadmap_goal_id: string;
  title: string;
  priority: number;
  ai_insight: string;
  dynamic_params: Record<string, any>;
}

@Injectable()
export class LlmOrchestratorService {
  private readonly gemini: GoogleGenerativeAI;
  private readonly groq: Groq;
  private readonly geminiModel: string;
  private readonly groqModel: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(LlmGuidanceLog)
    private readonly logRepo: Repository<LlmGuidanceLog>,
  ) {
    const geminiKey = this.config.get<string>('GEMINI_API_KEY', '');
    if (!geminiKey) throw new InternalServerErrorException('GEMINI_API_KEY is not configured');
    this.gemini = new GoogleGenerativeAI(geminiKey);
    this.geminiModel = this.config.get<string>('GEMINI_MODEL', 'gemini-1.5-flash');

    const groqKey = this.config.get<string>('GROQ_API_KEY', '');
    if (!groqKey) throw new InternalServerErrorException('GROQ_API_KEY is not configured');
    this.groq = new Groq({ apiKey: groqKey });
    this.groqModel = this.config.get<string>('GROQ_MODEL', 'llama-3.3-70b-versatile');
  }

  // ─── Step 1: Financial Classification ────────────────────────────────────

  /**
   * Analyzes the user's stored financial profile criteria and returns ONLY an
   * integer 1–5 representing the current financial step. No goal selection occurs
   * in this call — pure classification only.
   */
  async classifyUserStep(profile: UserProfile): Promise<number> {
    const prompt = [
      'You are a financial classification engine.',
      'Your ONLY task is to determine which financial stage (1–5) this user belongs to.',
      'You must NOT suggest goals or produce any output beyond the required JSON.',
      '',
      '## User Financial Criteria (each value is already scored 1–5 per dimension)',
      JSON.stringify(
        {
          cash_flow: profile.cashFlow,
          credit_consumption: profile.creditConsumption,
          loans: profile.loans,
          savings_investments: profile.savingsInvestments,
          pension_long_term: profile.pensionLongTerm,
          lifestyle_clubs: profile.lifestyleClubs,
          mortgage: profile.mortgage,
          system_indicators: profile.systemIndicators,
          age: profile.age,
          risk_tolerance: profile.riskTolerance,
          knowledge_level: profile.knowledgeLevel,
          occupation: profile.occupation,
        },
        null,
        2,
      ),
      '',
      '## Stage Definitions',
      'Stage 1 – Financial Survival: Negative cash flow, unmanaged debt, no buffer.',
      'Stage 2 – Financial Stability: Positive cash flow, debt being managed, minimal savings.',
      'Stage 3 – Financial Security: Emergency fund built, debt reducing, consistent savings.',
      'Stage 4 – Financial Freedom: Investments growing, pension active, lifestyle balanced.',
      'Stage 5 – Financial Independence: Diversified portfolio, passive income, full wealth management.',
      '',
      '## Output',
      'Respond EXCLUSIVELY with valid JSON — no markdown, no extra text:',
      '{ "current_step": <integer 1-5> }',
    ].join('\n');

    console.error('\n\n##################################################');
    console.error('!!! DEBUG STEP 1: CLASSIFICATION PROMPT !!!');
    console.error(prompt);
    console.error('##################################################\n\n');

    const raw = await this.callAi(prompt);

    console.error('\n\n##################################################');
    console.error('!!! DEBUG STEP 1: CLASSIFICATION RAW RESPONSE !!!');
    console.error(raw);
    console.error('##################################################\n\n');

    const parsed = JSON.parse(raw);
    const step = Math.min(5, Math.max(1, Number(parsed.current_step) || 1));

    console.error(`[LLM][Step1-Classify] userId=${profile.userId} → step=${step}`);
    return step;
  }

  // ─── Step 3: Personalized Task Selection ─────────────────────────────────

  /**
   * Receives ONLY the DB-pre-filtered goals (already hard-constrained to the
   * user's current step). The AI is strictly forbidden from adding or removing
   * goals — it may only reorder and write personalized Hebrew insight text.
   *
   * Returns ALL goals from the input list, sorted by relevance to the user.
   */
  async personalizeGoals(
    profile: UserProfile,
    filteredGoals: RoadmapGoal[],
  ): Promise<PersonalizedGoalRecommendation[]> {
    const goalList = filteredGoals.map((g) => ({
      roadmap_goal_id: g.goalId,
      title: g.title,
      priority: g.priority,
      description_template: g.descriptionTemplate,
      required_context: g.requiredContext ?? null,
      dynamic_params_schema: g.dynamicParams ?? {},
    }));

    const prompt = [
      'You are a personal financial coach.',
      '',
      '⚠️  HARD CONSTRAINT: You MUST work ONLY with the goals listed in "Available Goals" below.',
      '   Do NOT add goals. Do NOT remove goals. Do NOT reference goals outside this list.',
      '   All ai_insight text MUST be written in Hebrew.',
      '',
      '## User Financial Profile',
      JSON.stringify(
        {
          current_step: profile.currentStep,
          cash_flow: profile.cashFlow,
          credit_consumption: profile.creditConsumption,
          loans: profile.loans,
          savings_investments: profile.savingsInvestments,
          pension_long_term: profile.pensionLongTerm,
          lifestyle_clubs: profile.lifestyleClubs,
          mortgage: profile.mortgage,
          system_indicators: profile.systemIndicators,
          age: profile.age,
          risk_tolerance: profile.riskTolerance,
          knowledge_level: profile.knowledgeLevel,
          occupation: profile.occupation,
        },
        null,
        2,
      ),
      '',
      '## Available Goals — you MUST include every one of these, no additions',
      JSON.stringify(goalList, null, 2),
      '',
      '## Your Task',
      '1. For EACH goal in the list, write a brief personalized Hebrew ai_insight.',
      '2. Populate dynamic_params with any values derivable from the user profile.',
      '3. Return ALL goals ordered by relevance to this user (most relevant first).',
      '4. Preserve the exact roadmap_goal_id and title from the list.',
      '',
      '## Response Format',
      'Respond EXCLUSIVELY with valid JSON — no markdown, no extra text:',
      '{ "recommendations": ' +
        JSON.stringify(
          [
            {
              roadmap_goal_id: '<UUID from Available Goals>',
              title: '<exact title from Available Goals>',
              priority: '<integer — copy from Available Goals>',
              ai_insight: '<Hebrew personalized explanation>',
              dynamic_params: { key: 'value' },
            },
          ],
          null,
          2,
        ) +
        ' }',
    ].join('\n');

    console.error('\n\n##################################################');
    console.error('!!! DEBUG STEP 3: PERSONALIZATION PROMPT !!!');
    console.error(prompt);
    console.error('##################################################\n\n');

    const raw = await this.callAi(prompt);

    console.error('\n\n##################################################');
    console.error('!!! DEBUG STEP 3: PERSONALIZATION RAW RESPONSE !!!');
    console.error(raw);
    console.error('##################################################\n\n');

    let parsed: { recommendations: any[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new InternalServerErrorException('AI personalization returned invalid JSON');
    }

    const recommendations = Array.isArray(parsed?.recommendations)
      ? parsed.recommendations
      : Array.isArray(parsed as any)
        ? (parsed as any)
        : [];

    // Security hard-stop: strip any goal IDs the AI invented outside the filtered list
    const allowedIds = new Set(filteredGoals.map((g) => g.goalId));
    const safe = recommendations.filter((r: any) => allowedIds.has(r.roadmap_goal_id));

    console.log(
      `[LLM][Step3-Personalize] userId=${profile.userId} filteredGoals=${filteredGoals.length} returned=${safe.length}`,
    );

    return safe.map((r: any) => ({
      roadmap_goal_id: r.roadmap_goal_id,
      title: r.title ?? filteredGoals.find((g) => g.goalId === r.roadmap_goal_id)?.title ?? '',
      priority: Number(r.priority) || 0,
      ai_insight: r.ai_insight ?? '',
      dynamic_params: r.dynamic_params ?? {},
    }));
  }

  // ─── Private AI helpers ───────────────────────────────────────────────────

  private async callAi(prompt: string): Promise<string> {
    const useBackup = this.config.get<string>('USE_BACKUP_AI') === 'true';
    if (useBackup) {
      console.log('Gemini raw prompt: ```\n' + prompt + '\n```');
      return this.callGroq(prompt);
    }
    try {
      const model = this.gemini.getGenerativeModel({ model: this.geminiModel });
      console.log('Gemini raw prompt: ```\n' + prompt + '\n```');
      const result = await model.generateContent(prompt);
      const text = (await result.response).text();
      return text.replace(/```json/gi, '').replace(/```/g, '').trim();
    } catch (err: any) {
      const status: number | undefined = err?.status ?? err?.response?.status;
      if (status === 503 || status === 429) {
        console.warn(`[LLM] Gemini ${status} — falling back to Groq`);
        return this.callGroq(prompt);
      }
      throw new InternalServerErrorException(`Gemini call failed: ${err.message}`);
    }
  }

  private async callGroq(prompt: string): Promise<string> {
    try {
      const completion = await this.groq.chat.completions.create({
        model: this.groqModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });
      const content = completion.choices[0]?.message?.content ?? '{}';
      return content;
    } catch (err: any) {
      throw new InternalServerErrorException(`Groq call failed: ${err.message}`);
    }
  }

  // ─── Legacy compatibility ─────────────────────────────────────────────────

  async generateGuidance(
    userId: string,
    context: { questionnaire: any; goals: any[]; snapshot: any },
  ) {
    const guidanceText =
      'Use GET /goals/recommended for AI-powered step-isolated recommendations.';
    const log = this.logRepo.create({ userId, contextSnapshot: context, guidanceText });
    await this.logRepo.save(log);
    return { stage: 1, recommendation: guidanceText, suggestedGoals: [] };
  }
}
