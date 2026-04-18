import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankConsent } from '../database/entities/bank-consent.entity.js';
import { BankToken } from '../database/entities/bank-token.entity.js';
import { RoadmapStep } from '../database/entities/roadmap-step.entity.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
   * Parses the uploaded Open Banking JSON and asks Gemini to classify
   * the user's financial stage.
   * Returns: { step_id: 1–5, explanation: string }
   */
  async analyzeFile(fileBuffer: Buffer): Promise<{ step_id: number; explanation: string }> {
    // 1. Parse the uploaded JSON file.
    let bankingData: unknown;
    try {
      bankingData = JSON.parse(fileBuffer.toString('utf-8'));
    } catch {
      throw new BadRequestException('Uploaded file is not valid JSON');
    }

    // 2. Fetch financial stage definitions dynamically from the database.
    const stages = await this.stepRepo.find({ order: { stepId: 'ASC' } });
    if (!stages.length) {
      throw new InternalServerErrorException(
        'No roadmap steps found in the database. Please seed the roadmap_steps table.',
      );
    }

    const stagesDescription = stages
      .map((s) => {
        // Use description text if available, otherwise fall back to the criteria JSON.
        const detail = s.description ?? JSON.stringify(s.criteria ?? {});
        return `Stage ${s.stepId} – ${s.title}: ${detail}`;
      })
      .join('\n');

    // 3. Build the Gemini prompt.
    const prompt = [
      'You are an expert financial analyst.',
      '',
      "You will be given a user's Open Banking JSON data and the definitions of financial stages.",
      "Your task is to determine which stage best describes the user's current financial situation.",
      '',
      '## Financial Stages',
      stagesDescription,
      '',
      '## User Open Banking Data',
      JSON.stringify(bankingData, null, 2),
      '',
      '## Instructions',
      'Respond EXCLUSIVELY with a single valid JSON object in this exact format — no markdown, no code fences, no extra text:',
      '{ "step_id": <integer matching one of the stage numbers above>, "explanation": "<one or two sentence reasoning>" }',
    ].join('\n');

    // 4. Call Gemini (v1 API for stability) and parse the response.
    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const rawText = response.text();

      const jsonText = rawText
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      console.log('Gemini raw response:', rawText);

      const parsed = JSON.parse(jsonText);

      return {
        step_id: Number(parsed.step_id) || 1,
        explanation: parsed.explanation || 'לא ניתן לספק הסבר כרגע.',
      };
    } catch (err: any) {
      console.error('--- Gemini Error Details ---');
      if (err.response) {
        console.error('Status:', err.response.status);
        console.error('Data:', JSON.stringify(err.response.data));
      } else {
        console.error('Error Message:', err.message);
      }

      throw new InternalServerErrorException(
        `Gemini analysis failed: ${err.message}`,
      );
    }
  }
}
