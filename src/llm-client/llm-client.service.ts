import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Agent } from 'node:https';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { jsonrepair } from 'jsonrepair';

type LlmProvider = 'college' | 'gemini';
type CollegeApi = 'ollama' | 'openai';

interface ProviderRunner {
  name: LlmProvider;
  available: boolean;
  run: () => Promise<string>;
}

/** TEMPORARY DIAGNOSTICS: snapshot of what the college gateway advertises. */
interface CollegeModelsProbe {
  state: 'unchecked' | 'present' | 'absent' | 'failed';
  openAiModelIds: string[] | null;
  ollamaModelIds: string[] | null;
  openAiError: string | null;
  ollamaError: string | null;
  checkedAt: string | null;
}

/** TEMPORARY DIAGNOSTICS: normalized view of an HTTP/transport failure. */
interface CollegeErrorInfo {
  status: number | null;
  statusText: string | null;
  code: string | null;
  message: string;
  body: string;
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
export class LlmClientService implements OnModuleInit {
  private readonly logger = new Logger(LlmClientService.name);

  // Primary provider selection + fallback toggle.
  private readonly provider: LlmProvider;
  private readonly fallbackEnabled: boolean;
  /** LLM_GEMINI_ONLY=true skips the college LLM entirely (no VPN needed). */
  private readonly geminiOnly: boolean;

  // ─── College LLM service config ─────────────────────────────────────────
  private readonly collegeHttp: AxiosInstance | null;
  private readonly collegeModel: string;
  private readonly collegeApi: CollegeApi;
  private readonly collegeNumPredict: number;
  private readonly collegeBaseUrl: string;
  private readonly collegeTimeoutMs: number;
  private readonly collegeHasAuth: boolean;
  private readonly collegeHostHeader: string;
  private readonly collegeInsecureTls: boolean;

  // ─── TEMPORARY DIAGNOSTICS (college model availability probe) ───────────
  private collegeModelsProbe: CollegeModelsProbe = {
    state: 'unchecked',
    openAiModelIds: null,
    ollamaModelIds: null,
    openAiError: null,
    ollamaError: null,
    checkedAt: null,
  };
  private collegeModelsProbeInFlight: Promise<CollegeModelsProbe> | null = null;

  // ─── Gemini config ───────────────────────────────────────────────────────
  private readonly gemini: GoogleGenerativeAI | null;
  private readonly geminiModel: string;
  private readonly geminiMaxOutputTokens: number;
  private readonly geminiThinkingConfig: Record<string, unknown>;

  constructor(private readonly config: ConfigService) {
    // Master switch: when true the college LLM is never contacted at all.
    this.geminiOnly =
      (
        this.config.get<string>('LLM_GEMINI_ONLY', 'false') || 'false'
      ).toLowerCase() === 'true';

    // 'college' (default) makes the College LLM primary; 'gemini' flips it.
    const provider = (
      this.config.get<string>('LLM_PROVIDER', 'college') || 'college'
    ).toLowerCase();
    this.provider =
      this.geminiOnly || provider === 'gemini' ? 'gemini' : 'college';
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
      // Accepts base URLs with or without the trailing /v1 — request paths
      // already carry it.
      this.collegeBaseUrl = baseUrl
        .replace(/\/+$/, '')
        .replace(/\/v1$/i, '');
      this.collegeTimeoutMs = Number(
        this.config.get<string>('COLLEGE_LLM_TIMEOUT_MS', '120000'),
      );
      this.collegeHasAuth = !!username;
      // The Run:ai gateway routes by Host header, and its certificate is issued
      // for that hostname rather than the IP — so SNI must use it too.
      this.collegeHostHeader =
        this.config.get<string>('COLLEGE_LLM_HOST_HEADER', '') || '';
      this.collegeInsecureTls =
        (
          this.config.get<string>('COLLEGE_LLM_INSECURE_TLS', 'false') || 'false'
        ).toLowerCase() === 'true';

      this.collegeHttp = axios.create({
        baseURL: this.collegeBaseUrl,
        timeout: this.collegeTimeoutMs,
        headers: {
          'Content-Type': 'application/json',
          ...(username
            ? { Authorization: `Basic ${credentials}` }
            : {}),
          ...(this.collegeHostHeader
            ? { Host: this.collegeHostHeader }
            : {}),
        },
        ...(this.collegeBaseUrl.toLowerCase().startsWith('https://')
          ? {
              httpsAgent: new Agent({
                servername: this.collegeHostHeader || undefined,
                rejectUnauthorized: !this.collegeInsecureTls,
              }),
            }
          : {}),
      });
    } else {
      this.collegeBaseUrl = '';
      this.collegeTimeoutMs = 0;
      this.collegeHasAuth = false;
      this.collegeHostHeader = '';
      this.collegeInsecureTls = false;
      this.collegeHttp = null;
    }

    // ─── Gemini setup (fallback) ──────────────────────────────────────────
    const geminiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.gemini = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
    this.geminiModel = this.config.get<string>(
      'GEMINI_MODEL',
      'gemini-2.5-flash',
    );
    this.geminiMaxOutputTokens = Number(
      this.config.get<string>('GEMINI_MAX_OUTPUT_TOKENS', '8192'),
    );

    // Gemini 1.x/2.x switch thinking off with thinkingBudget:0. Gemini 3.x
    // rejects that field (400 INVALID_ARGUMENT) and takes thinkingLevel.
    const thinking = (
      this.config.get<string>('GEMINI_THINKING', '') || ''
    ).toLowerCase();
    const usesThinkingBudget = /gemini-[12]\./.test(this.geminiModel);
    this.geminiThinkingConfig =
      usesThinkingBudget && (thinking === '' || thinking === 'off')
        ? { thinkingBudget: 0 }
        : {
            thinkingLevel: ['low', 'medium', 'high'].includes(thinking)
              ? thinking
              : 'low',
          };

    if (!this.collegeHttp && !this.gemini) {
      throw new InternalServerErrorException(
        'No LLM provider configured. Set COLLEGE_LLM_BASE_URL (and credentials) ' +
          'and/or GEMINI_API_KEY.',
      );
    }

    if (this.geminiOnly && !this.gemini) {
      throw new InternalServerErrorException(
        'LLM_GEMINI_ONLY=true but GEMINI_API_KEY is not set, so no provider is usable.',
      );
    }
  }

  // ─── TEMPORARY DIAGNOSTICS ────────────────────────────────────────────────
  // Everything in this block exists only to diagnose the "model not found"
  // response from the college gateway. Remove once the issue is understood.

  /** The endpoint the current COLLEGE_LLM_API mode will POST to. */
  private get collegeEndpoint(): string {
    return this.collegeApi === 'openai'
      ? '/v1/chat/completions'
      : '/api/generate';
  }

  onModuleInit(): void {
    this.logger.log(
      `[Gemini] model=${this.geminiModel} | ` +
        `maxOutputTokens=${this.geminiMaxOutputTokens} | ` +
        `thinkingConfig=${JSON.stringify(this.geminiThinkingConfig)} | ` +
        `key=${this.gemini ? 'set' : 'missing'}`,
    );
    if (this.geminiOnly) {
      this.logger.warn(
        '[College LLM] BYPASSED — LLM_GEMINI_ONLY=true, every request goes to Gemini (no VPN required)',
      );
      return;
    }
    if (!this.collegeHttp) {
      this.logger.log('[College LLM] not configured (no COLLEGE_LLM_BASE_URL)');
      return;
    }
    this.logger.log(
      `[College LLM] config: baseUrl=${this.collegeBaseUrl} | ` +
        `api=${this.collegeApi} | model=${this.collegeModel} | ` +
        `endpoint=POST ${this.collegeEndpoint} | ` +
        `hostHeader=${this.collegeHostHeader || '(none)'} | ` +
        `tls=${this.collegeInsecureTls ? 'VERIFICATION DISABLED' : 'verified'} | ` +
        `timeout=${this.collegeTimeoutMs}ms | ` +
        `num_predict/max_tokens=${this.collegeNumPredict} | ` +
        `auth=${this.collegeHasAuth ? 'Basic <redacted>' : 'none'} | ` +
        `primary=${this.provider} | fallback=${this.fallbackEnabled}`,
    );
    if (this.collegeInsecureTls) {
      this.logger.warn(
        '[College LLM] COLLEGE_LLM_INSECURE_TLS=true — server certificate is NOT verified. Use only on the trusted college network.',
      );
    }
    // Fire-and-forget: never block bootstrap on the VPN-only college host.
    void this.probeCollegeModels().catch(() => undefined);
  }

  /**
   * GET /v1/models (and /api/tags) purely to record which model IDs the
   * gateway advertises. Logs IDs only — no credentials, no prompts.
   */
  private async probeCollegeModels(): Promise<CollegeModelsProbe> {
    if (!this.collegeHttp) return this.collegeModelsProbe;
    if (this.collegeModelsProbeInFlight) {
      return this.collegeModelsProbeInFlight;
    }

    this.collegeModelsProbeInFlight = (async () => {
      const probe: CollegeModelsProbe = {
        state: 'failed',
        openAiModelIds: null,
        ollamaModelIds: null,
        openAiError: null,
        ollamaError: null,
        checkedAt: new Date().toISOString(),
      };

      // OpenAI-compatible listing.
      const t0 = Date.now();
      try {
        const { data } = await this.collegeHttp!.get('/v1/models', {
          timeout: 15_000,
        });
        probe.openAiModelIds = Array.isArray(data?.data)
          ? data.data.map((m: any) => String(m?.id ?? m?.name ?? '?'))
          : [];
        this.logger.log(
          `[College LLM] GET ${this.collegeBaseUrl}/v1/models -> 200 in ` +
            `${Date.now() - t0}ms | available models: ` +
            `${probe.openAiModelIds!.join(', ') || '<none>'}`,
        );
      } catch (err) {
        const info = this.describeCollegeError(err);
        probe.openAiError = `HTTP ${info.status ?? '-'} ${info.code ?? ''} ${info.message}`.trim();
        this.logger.warn(
          `[College LLM] GET ${this.collegeBaseUrl}/v1/models FAILED in ` +
            `${Date.now() - t0}ms | status=${info.status ?? 'n/a'} ` +
            `code=${info.code ?? 'n/a'} | message=${info.message} | body=${info.body}`,
        );
      }

      // Native Ollama listing — shows whether the model exists behind the
      // gateway even when it is not exposed through the OpenAI surface. Skipped
      // on the vLLM gateway, which has no /api/tags and would just time out.
      const t1 = Date.now();
      if (this.collegeApi === 'ollama') {
        try {
          const { data } = await this.collegeHttp!.get('/api/tags', {
            timeout: 15_000,
          });
          probe.ollamaModelIds = Array.isArray(data?.models)
            ? data.models.map((m: any) => String(m?.name ?? m?.model ?? '?'))
            : [];
          this.logger.log(
            `[College LLM] GET ${this.collegeBaseUrl}/api/tags -> 200 in ` +
              `${Date.now() - t1}ms | available models: ` +
              `${probe.ollamaModelIds!.join(', ') || '<none>'}`,
          );
        } catch (err) {
          const info = this.describeCollegeError(err);
          probe.ollamaError =
            `HTTP ${info.status ?? '-'} ${info.code ?? ''} ${info.message}`.trim();
          this.logger.warn(
            `[College LLM] GET ${this.collegeBaseUrl}/api/tags FAILED in ` +
              `${Date.now() - t1}ms | status=${info.status ?? 'n/a'} ` +
              `code=${info.code ?? 'n/a'} | message=${info.message} | body=${info.body}`,
          );
        }
      }

      const listed = [
        ...(probe.openAiModelIds ?? []),
        ...(probe.ollamaModelIds ?? []),
      ];
      if (probe.openAiModelIds || probe.ollamaModelIds) {
        const present = listed.some(
          (id) => id.toLowerCase() === this.collegeModel.toLowerCase(),
        );
        probe.state = present ? 'present' : 'absent';
        if (present) {
          this.logger.log(
            `[College LLM] configured model ${this.collegeModel} IS present in the gateway listing`,
          );
        } else {
          this.logger.warn(
            `[College LLM] WARNING: configured model ${this.collegeModel} is not present in /v1/models` +
              (probe.ollamaModelIds ? ' nor in /api/tags' : ''),
          );
        }
      }

      this.collegeModelsProbe = probe;
      return probe;
    })();

    try {
      return await this.collegeModelsProbeInFlight;
    } finally {
      this.collegeModelsProbeInFlight = null;
    }
  }

  /** One-line summary of the model probe, safe to embed in error messages. */
  private describeModelsProbe(): string {
    const p = this.collegeModelsProbe;
    if (p.state === 'unchecked') return '/v1/models not checked yet';
    if (p.state === 'failed') {
      return `/v1/models check failed (${p.openAiError ?? 'unknown'})`;
    }
    return (
      `/v1/models checked at ${p.checkedAt}: ${this.collegeModel} ` +
      `${p.state === 'present' ? 'PRESENT' : 'ABSENT'} | ` +
      `openai=[${(p.openAiModelIds ?? []).join(', ') || '-'}] | ` +
      `ollama=[${(p.ollamaModelIds ?? []).join(', ') || '-'}]`
    );
  }

  /**
   * Normalizes an axios/transport error without collapsing it to
   * "[object Object]". Handles both the native Ollama shape
   * (`{ error: "..." }`) and the OpenAI shape (`{ error: { message } }`).
   */
  private describeCollegeError(err: any): CollegeErrorInfo {
    const response = err?.response;
    const data = response?.data;

    let message: string | null = null;
    if (typeof data === 'string' && data.trim()) {
      message = data.trim();
    } else if (typeof data?.error === 'string') {
      message = data.error;
    } else if (data?.error && typeof data.error === 'object') {
      message =
        typeof data.error.message === 'string'
          ? data.error.message
          : this.safeStringify(data.error);
    } else if (typeof data?.message === 'string') {
      message = data.message;
    }

    return {
      status: typeof response?.status === 'number' ? response.status : null,
      statusText: response?.statusText ?? null,
      code: err?.code ?? null,
      message: (message ?? err?.message ?? 'unknown error').slice(0, 500),
      body: this.safeStringify(data),
    };
  }

  private safeStringify(value: unknown): string {
    if (value === undefined || value === null) return '<empty>';
    if (typeof value === 'string') return value.slice(0, 1000);
    try {
      return JSON.stringify(value).slice(0, 1000);
    } catch {
      return '<unserializable>';
    }
  }

  // ─── end TEMPORARY DIAGNOSTICS ────────────────────────────────────────────

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
      available: !this.geminiOnly && !!this.collegeHttp,
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
        this.logLlmOutput(label, primary.name, result, Date.now() - t0, false);
        return result;
      } catch (primaryErr: any) {
        if (!this.fallbackEnabled || !secondary.available) {
          throw new InternalServerErrorException(
            `LLM ${label} failed via ${primary.name}: ${primaryErr?.message}`,
          );
        }
        this.logger.warn(
          `LLM "${label}" failed via ${primary.name} — falling back to ` +
            `${secondary.name}: ${String(primaryErr?.message).slice(0, 600)}`,
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
      this.logLlmOutput(label, secondary.name, result, Date.now() - t0, true);
      return result;
    } catch (secondaryErr: any) {
      throw new InternalServerErrorException(
        `LLM ${label} failed on all providers — ${secondary.name}: ${secondaryErr?.message}`,
      );
    }
  }

  // ─── Observability helpers ─────────────────────────────────────────────────

  /** Logs the raw model output plus provider/timing metadata. */
  private logLlmOutput(
    label: string,
    provider: LlmProvider,
    raw: string,
    ms: number,
    fallback: boolean,
  ): void {
    this.logger.log(
      `\n┌─ LLM RESPONSE [${label}] ───────────────────────────────────────\n` +
        `│ via : ${provider}${fallback ? ' (fallback)' : ''}  |  ` +
        `${ms} ms  |  ${raw.length} chars\n` +
        `├─ RAW OUTPUT ────────────────────────────────────────────────────\n` +
        `${raw}\n` +
        `└─────────────────────────────────────────────────────────────────`,
    );
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
    let lastInfo: CollegeErrorInfo | null = null;
    let lastElapsed = 0;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attemptsMade = attempt;
      const started = Date.now();
      this.logger.log(
        `[College LLM] REQUEST (${label}) attempt ${attempt}/${MAX_ATTEMPTS} | ` +
          `method=POST | url=${this.collegeBaseUrl}${this.collegeEndpoint} | ` +
          `api=${this.collegeApi} | model=${this.collegeModel} | ` +
          `timeout=${this.collegeTimeoutMs}ms | ` +
          `response_format=${this.collegeApi === 'openai' ? 'json_object' : "format:'json'"} | ` +
          `max_tokens=${this.collegeNumPredict} | temperature=0.1 | ` +
          `auth=${this.collegeHasAuth ? 'Basic <redacted>' : 'none'} | ` +
          `prompt_chars=${systemPrompt.length + userContent.length} (content not logged)`,
      );

      try {
        const rawText =
          this.collegeApi === 'openai'
            ? await this.callCollegeOpenAi(systemPrompt, userContent)
            : await this.callCollegeOllama(systemPrompt, userContent);
        const elapsed = Date.now() - started;
        if (!rawText.trim()) {
          throw new Error('College LLM returned an empty response');
        }
        this.logger.log(
          `[College LLM] SUCCESS (${label}) attempt ${attempt} | HTTP 200 | ` +
            `model=${this.collegeModel} | elapsed=${elapsed}ms | ${rawText.length} chars`,
        );
        return rawText;
      } catch (err: any) {
        lastErr = err;
        lastElapsed = Date.now() - started;
        const info = this.describeCollegeError(err);
        lastInfo = info;
        const status = info.status ?? undefined;

        this.logger.error(
          `[College LLM] FAILURE (${label}) attempt ${attempt}/${MAX_ATTEMPTS} | ` +
            `method=POST | url=${this.collegeBaseUrl}${this.collegeEndpoint} | ` +
            `api=${this.collegeApi} | model=${this.collegeModel} | ` +
            `http_status=${info.status ?? 'n/a'} ${info.statusText ?? ''} | ` +
            `axios_code=${info.code ?? 'n/a'} | elapsed=${lastElapsed}ms | ` +
            `error_message=${info.message} | response_body=${info.body} | ` +
            `models_probe: ${this.describeModelsProbe()}`,
        );

        // On a 404 / "model not found" re-check what the gateway advertises so
        // the log carries the evidence next to the failure.
        if (
          status === 404 ||
          /not found|no such model|unknown model/i.test(info.message)
        ) {
          await this.probeCollegeModels().catch(() => undefined);
          this.logger.warn(
            `[College LLM] post-failure model check (${label}): ${this.describeModelsProbe()}`,
          );
        }

        const isTransient =
          status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          err?.code === 'ECONNABORTED' ||
          err?.code === 'ECONNREFUSED';

        if (!isTransient || attempt === MAX_ATTEMPTS) {
          this.logger.warn(
            `[College LLM] giving up (${label}) after attempt ${attempt} — ` +
              `transient=${isTransient} (no retry for HTTP ${info.status ?? 'n/a'})`,
          );
          break;
        }

        const backoff = Math.min(
          BASE_DELAY_MS * 2 ** (attempt - 1),
          MAX_DELAY_MS,
        );
        const delay = backoff + Math.floor(Math.random() * 400);
        this.logger.warn(
          `College LLM (${label}) transient error (attempt ${attempt}/${MAX_ATTEMPTS}). ` +
            `Retrying in ${delay}ms — ${info.message.slice(0, 120)}`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    const info = lastInfo ?? this.describeCollegeError(lastErr);
    throw new Error(
      `College LLM ${label} failed (HTTP ${info.status ?? 'n/a'}, ` +
        `model=${this.collegeModel}, api=${this.collegeApi}, ` +
        `endpoint=POST ${this.collegeBaseUrl}${this.collegeEndpoint}, ` +
        `attempts=${attemptsMade}, elapsed=${lastElapsed}ms): ${info.message}`,
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
        maxOutputTokens: this.geminiMaxOutputTokens,
        thinkingConfig: this.geminiThinkingConfig,
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
        if (!rawText.trim()) {
          throw new Error(
            'Gemini returned an empty response (possible MAX_TOKENS or safety block)',
          );
        }
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
