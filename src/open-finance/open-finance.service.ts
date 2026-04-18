import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankConsent } from '../database/entities/bank-consent.entity.js';
import { BankToken } from '../database/entities/bank-token.entity.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// The 5 stages of the Financial Hierarchy of Needs used as Gemini context.
const FINANCIAL_STAGES = [
  {
    step_id: 1,
    name: 'Basic Needs',
    criteria: 'Income barely covers essential living expenses (rent, food, utilities). Little or no savings buffer.',
  },
  {
    step_id: 2,
    name: 'Financial Safety',
    criteria: 'Has an emergency fund (1–3 months of expenses), consistent income, and manageable debt.',
  },
  {
    step_id: 3,
    name: 'Wealth Accumulation',
    criteria: 'Actively saving and investing beyond emergency fund. Debt under control. Building net worth.',
  },
  {
    step_id: 4,
    name: 'Financial Freedom',
    criteria: 'Passive income or investments that could cover living expenses. High savings rate. Low or no debt.',
  },
  {
    step_id: 5,
    name: 'Future & Legacy',
    criteria: 'Wealth exceeds personal needs. Planning for generational wealth, philanthropy, or long-term estate goals.',
  },
];

@Injectable()
export class OpenFinanceService {
  private readonly gemini: GoogleGenerativeAI;

  constructor(
    @InjectRepository(BankConsent)
    private readonly consentRepo: Repository<BankConsent>,
    @InjectRepository(BankToken)
    private readonly tokenRepo: Repository<BankToken>,
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

    // 2. Build the Gemini prompt.
    const stagesDescription = FINANCIAL_STAGES.map(
      (s) => `Stage ${s.step_id} – ${s.name}: ${s.criteria}`,
    ).join('\n');

    const prompt = [
      'You are an expert financial analyst.',
      '',
      'You will be given a user\'s Open Banking JSON data and the definitions of 5 financial stages.',
      'Your task is to determine which stage best describes the user\'s current financial situation.',
      '',
      '## Financial Stages',
      stagesDescription,
      '',
      '## User Open Banking Data',
      JSON.stringify(bankingData, null, 2),
      '',
      '## Instructions',
      'Respond EXCLUSIVELY with a single valid JSON object in this exact format — no markdown, no code fences, no extra text:',
      '{ "step_id": <integer between 1 and 5>, "explanation": "<one or two sentence reasoning>" }',
    ].join('\n');

    // 3. Call Gemini and parse the response.
    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      const rawText = result.response.text().trim();

      // Strip accidental markdown fences if Gemini adds them despite instructions.
      const jsonText = rawText.replace(/^```[\w]*\n?/m, '').replace(/```$/m, '').trim();

      const parsed = JSON.parse(jsonText) as { step_id: number; explanation: string };

      if (typeof parsed.step_id !== 'number' || typeof parsed.explanation !== 'string') {
        throw new Error('Unexpected response shape from Gemini');
      }

      return parsed;
    } catch (err: any) {
      throw new InternalServerErrorException(
        `Gemini analysis failed: ${err?.message ?? 'unknown error'}`,
      );
    }
  }
}
