import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { jsonrepair } from 'jsonrepair';

type LlmProvider = 'college' | 'gemini';
type CollegeApi = 'ollama' | 'openai';

interface ProviderRunner {
  name: LlmProvider;
  available: boolean;
  run: () => Promise<string>;
}

/**
 * Centralized LLM gateway used by every part of the service that needs text
 * generation. It speaks to the College LLM service (selected model via env)
 * as the PRIMARY provider and automatically falls back to Google Gemini when
 * the primary provider is unavailable.
 *
 * Which model is used is fully controlled from the environment — see the
 * `COLLEGE_LLM_*`, `LLM_PROVIDER`, `LLM_FALLBACK` and `GEMINI_*` variables.
 */
@Injectable()
export class LlmClientService {
  private readonly logger = new Logger(LlmClientService.name);

  // Primary provider selection + fallback toggle.
  private readonly provider: LlmProvider;
  private readonly fallbackEnabled: boolean;

  // ─── College LLM service config ─────────────────────────────────────────
  private readonly collegeHttp: AxiosInstance | null;
  private readonly collegeModel: string;
  private readonly collegeApi: CollegeApi;
  private readonly collegeNumPredict: number;

  // ─── Gemini config ───────────────────────────────────────────────────────
  private readonly gemini: GoogleGenerativeAI | null;
  private readonly geminiModel: string;

  constructor(private readonly config: ConfigService) {
    // 'college' (default) makes the College LLM primary; 'gemini' flips it.
    const provider = (
      this.config.get<string>('LLM_PROVIDER', 'college') || 'college'
    ).toLowerCase();
    this.provider = provider === 'gemini' ? 'gemini' : 'college';
    this.fallbackEnabled =
      (this.config.get<string>('LLM_FALLBACK', 'true') || 'true').toLowerCase() !==
      'false';

    // ─── College LLM setup ───────────────────────────────────────────────
    const baseUrl = this.config.get<string>('COLLEGE_LLM_BASE_URL', '');
    const username = this.config.get<string>('COLLEGE_LLM_USERNAME', '');
    const password = this.config.get<string>('COLLEGE_LLM_PASSWORD', '');
    this.collegeModel = this.config.get<string>(
      'COLLEGE_LLM_MODEL',
      'llama3.1:8b',
    );
    this.collegeNumPredict = Number(
      this.config.get<string>('COLLEGE_LLM_NUM_PREDICT', '3000'),
    );

    // The OpenAI-compatible endpoint is used for gpt-oss-120b; everything else
    // goes through the native Ollama API. An explicit COLLEGE_LLM_API wins.
    const explicitApi = (
      this.config.get<string>('COLLEGE_LLM_API', '') || ''
    ).toLowerCase();
    this.collegeApi =
      explicitApi === 'openai'
        ? 'openai'
        : explicitApi === 'ollama'
          ? 'ollama'
          : /^gpt-oss/i.test(this.collegeModel)
            ? 'openai'
            : 'ollama';

    if (baseUrl) {
      const credentials = Buffer.from(`${username}:${password}`).toString(
        'base64',
      );
      this.collegeHttp = axios.create({
        baseURL: baseUrl.replace(/\/$/, ''),
        timeout: Number(
          this.config.get<string>('COLLEGE_LLM_TIMEOUT_MS', '120000'),
        ),
        headers: {
          'Content-Type': 'application/json',
          ...(username
            ? { Authorization: `Basic ${credentials}` }
            : {}),
        },
      });
    } else {
      this.collegeHttp = null;
    }

    // ─── Gemini setup (fallback) ──────────────────────────────────────────
    const geminiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.gemini = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
    this.geminiModel = this.config.get<string>(
      'GEMINI_MODEL',
      'gemini-2.5-flash',
    );

    if (!this.collegeHttp && !this.gemini) {
      throw new InternalServerErrorException(
        'No LLM provider configured. Set COLLEGE_LLM_BASE_URL (and credentials) ' +
          'and/or GEMINI_API_KEY.',
      );
    }
  }

  /**
   * Generate a completion. The `systemPrompt` carries instructions/schema and
   * `userContent` the data payload. Returns the raw model text (JSON string for
   * JSON-formatted tasks) — callers handle parsing/validation.
   */
  async generate(
    systemPrompt: string,
    userContent = '',
    label = 'llm',
  ): Promise<string> {
    const college: ProviderRunner = {
      name: 'college',
      available: !!this.collegeHttp,
      run: () => this.runCollege(systemPrompt, userContent, label),
    };
    const gemini: ProviderRunner = {
      name: 'gemini',
      available: !!this.gemini,
      run: () => this.runGemini(systemPrompt, userContent, label),
    };

    const ordered =
      this.provider === 'gemini' ? [gemini, college] : [college, gemini];
    const primary = ordered[0];
    const secondary = ordered[1];

    const t0 = Date.now();

    if (primary.available) {
      try {
        const result = await primary.run();
        this.logger.log(
          `LLM "${label}" OK via ${primary.name} (${Date.now() - t0} ms)`,
        );
        return result;
      } catch (primaryErr: any) {
        if (!this.fallbackEnabled || !secondary.available) {
          throw new InternalServerErrorException(
            `LLM ${label} failed via ${primary.name}: ${primaryErr?.message}`,
          );
        }
        this.logger.warn(
          `LLM "${label}" failed via ${primary.name} — falling back to ` +
            `${secondary.name}: ${String(primaryErr?.message).slice(0, 160)}`,
        );
      }
    } else if (!secondary.available) {
      throw new InternalServerErrorException(
        `LLM ${label} has no available provider configured`,
      );
    }

    // Reached when primary is unavailable, or primary failed and fallback is on.
    try {
      const result = await secondary.run();
      this.logger.log(
        `LLM "${label}" OK via ${secondary.name} (fallback, ${Date.now() - t0} ms)`,
      );
      return result;
    } catch (secondaryErr: any) {
      throw new InternalServerErrorException(
        `LLM ${label} failed on all providers — ${secondary.name}: ${secondaryErr?.message}`,
      );
    }
  }

  // ─── College LLM execution ────────────────────────────────────────────────

  private async runCollege(
    systemPrompt: string,
    userContent: string,
    label: string,
  ): Promise<string> {
    if (!this.collegeHttp) {
      throw new InternalServerErrorException('College LLM is not configured');
    }

    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 1_000;
    const MAX_DELAY_MS = 8_000;

    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const rawText =
          this.collegeApi === 'openai'
            ? await this.callCollegeOpenAi(systemPrompt, userContent)
            : await this.callCollegeOllama(systemPrompt, userContent);
        this.logger.debug(
          `College LLM (${this.collegeModel}, ${label}) raw response: ${rawText}`,
        );
        return rawText;
      } catch (err: any) {
        lastErr = err;
        const status: number | undefined = err?.response?.status;
        const isTransient =
          status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          err?.code === 'ECONNABORTED' ||
          err?.code === 'ECONNREFUSED';

        if (!isTransient || attempt === MAX_ATTEMPTS) {
          break;
        }

        const backoff = Math.min(
          BASE_DELAY_MS * 2 ** (attempt - 1),
          MAX_DELAY_MS,
        );
        const delay = backoff + Math.floor(Math.random() * 400);
        this.logger.warn(
          `College LLM (${label}) transient error (attempt ${attempt}/${MAX_ATTEMPTS}). ` +
            `Retrying in ${delay}ms — ${String(err?.message).slice(0, 120)}`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw new Error(
      `College LLM ${label} failed: ${lastErr?.response?.data?.error ?? lastErr?.message}`,
    );
  }

  /** Native Ollama API — POST /api/generate. */
  private async callCollegeOllama(
    systemPrompt: string,
    userContent: string,
  ): Promise<string> {
    const prompt = userContent
      ? `${systemPrompt}\n\n${userContent}`
      : systemPrompt;
    const { data } = await this.collegeHttp!.post('/api/generate', {
      model: this.collegeModel,
      prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        num_predict: this.collegeNumPredict,
      },
    });
    return String(data?.response ?? '');
  }

  /** OpenAI-compatible API — POST /v1/chat/completions (gpt-oss-120b). */
  private async callCollegeOpenAi(
    systemPrompt: string,
    userContent: string,
  ): Promise<string> {
    const messages = userContent
      ? [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ]
      : [{ role: 'user', content: systemPrompt }];
    const { data } = await this.collegeHttp!.post('/v1/chat/completions', {
      model: this.collegeModel,
      messages,
      temperature: 0.1,
      max_tokens: this.collegeNumPredict,
      response_format: { type: 'json_object' },
    });
    return String(data?.choices?.[0]?.message?.content ?? '');
  }

  // ─── Gemini execution (fallback) ───────────────────────────────────────────

  private async runGemini(
    systemPrompt: string,
    userContent: string,
    label: string,
  ): Promise<string> {
    if (!this.gemini) {
      throw new InternalServerErrorException('Gemini is not configured');
    }

    const model = this.gemini.getGenerativeModel({
      model: this.geminiModel,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        // Disable "thinking" on 2.5 models — these are structured-JSON tasks.
        thinkingConfig: { thinkingBudget: 0 },
      } as any,
    });
    const prompt = userContent
      ? `${systemPrompt}\n\n${userContent}`
      : systemPrompt;

    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 1_000;
    const MAX_DELAY_MS = 30_000;

    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const rawText = (await result.response).text();
        this.logger.debug(`Gemini (${label}) raw response: ${rawText}`);
        return rawText;
      } catch (err: any) {
        lastErr = err;
        const msg: string = err?.message ?? '';
        const isTransient =
          /\b(503|500|429)\b|overloaded|high demand|UNAVAILABLE|Too Many Requests/i.test(
            msg,
          );

        if (!isTransient || attempt === MAX_ATTEMPTS) {
          break;
        }

        const suggested = this.parseRetryDelayMs(msg);
        const backoff = Math.min(
          BASE_DELAY_MS * 2 ** (attempt - 1),
          MAX_DELAY_MS,
        );
        const delay = (suggested ?? backoff) + Math.floor(Math.random() * 500);
        this.logger.warn(
          `Gemini (${label}) transient error (attempt ${attempt}/${MAX_ATTEMPTS}). ` +
            `Retrying in ${delay}ms — ${msg.slice(0, 120)}`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw new Error(`Gemini ${label} failed: ${lastErr?.message}`);
  }

  /** Extracts Google's suggested retry delay (e.g. "Please retry in 49.4s") in ms. */
  private parseRetryDelayMs(message: string): number | undefined {
    const match = message.match(/retry(?:Delay)?["\s:]*?(\d+(?:\.\d+)?)s/i);
    if (!match) return undefined;
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds)) return undefined;
    return Math.min(Math.ceil(seconds * 1000), 30_000);
  }

  // ─── Shared JSON helpers ───────────────────────────────────────────────────

  /**
   * Parse a model response as JSON, transparently stripping markdown fences and
   * any preamble/postscript the model may have added around the JSON payload.
   */
  parseJson<T>(rawText: string, label = 'llm'): T {
    // 1. Direct parse — fast path for well-formed responses.
    try {
      return JSON.parse(rawText) as T;
    } catch {
      // fall through
    }

    // 2. Strip markdown fences / surrounding prose, then retry.
    const sanitized = this.sanitizeJson(rawText);
    try {
      return JSON.parse(sanitized) as T;
    } catch {
      // fall through
    }

    // 3. Last resort: repair common LLM malformations (stray quotes, trailing
    //    commas, unescaped characters, etc.) and parse the repaired string.
    try {
      return JSON.parse(jsonrepair(sanitized)) as T;
    } catch {
      // fall through
    }

    throw new InternalServerErrorException(
      `Failed to parse LLM (${label}) response as JSON. ` +
        `Raw (first 500 chars): ${rawText.slice(0, 500)}`,
    );
  }

  /** Strip markdown fences and surrounding noise from a JSON-ish string. */
  sanitizeJson(raw: string): string {
    let cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '');
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    const start =
      firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
        ? firstBrace
        : firstBracket;
    if (start > 0) {
      cleaned = cleaned.slice(start);
    }
    const lastBrace = cleaned.lastIndexOf('}');
    const lastBracket = cleaned.lastIndexOf(']');
    const end = lastBrace > lastBracket ? lastBrace : lastBracket;
    if (end >= 0 && end < cleaned.length - 1) {
      cleaned = cleaned.slice(0, end + 1);
    }
    return cleaned.trim();
  }
}
