import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { LlmGuidanceLog } from '../database/entities/llm-guidance-log.entity.js';

@Injectable()
export class LlmOrchestratorService {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(LlmGuidanceLog)
    private readonly logRepo: Repository<LlmGuidanceLog>,
  ) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.model = this.config.get<string>('GEMINI_MODEL', 'gemini-1.5-flash');
  }

  async generateGuidance(userId: string, context: {
    questionnaire: any;
    goals: any[];
    snapshot: any;
  }) {
    // TODO: build structured prompt with financial hierarchy definitions,
    // send to Gemini API, parse & validate response
    const prompt = this.buildPrompt(context);

    // Placeholder for actual Gemini API call
    const guidanceText = 'Placeholder guidance — Gemini integration pending';

    const log = this.logRepo.create({
      userId,
      contextSnapshot: context,
      guidanceText,
    });
    await this.logRepo.save(log);

    return {
      stage: 1,
      recommendation: guidanceText,
      suggestedGoals: [],
    };
  }

  private buildPrompt(context: any): string {
    // TODO: construct prompt with:
    // 1. Financial Hierarchy of Needs (5 stages) definitions
    // 2. User's financial snapshot metrics
    // 3. Questionnaire answers
    // 4. Current goals
    return `Analyze the following financial profile and determine the user's stage...`;
  }
}
