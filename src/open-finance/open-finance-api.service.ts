import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadGatewayException,
  RequestTimeoutException,
  InternalServerErrorException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { OpenFinanceService, PersistAnalysisResult } from './open-finance.service.js';

interface OFTokenResponse {
  access_token?: string;
  accessToken?: string;
  token?: string;
  jwt?: string;
  token_type?: string;
  expires_in?: number;
  expiresIn?: number;
  refresh_token?: string;
  [k: string]: unknown;
}

interface OFCreateReportResponse {
  jobId?: string;
  job_id?: string;
  id?: string;
  [k: string]: unknown;
}

interface OFFinancialReportResponse {
  status?: string;
  financialReport?: Record<string, unknown>;
  [k: string]: unknown;
}

@Injectable()
export class OpenFinanceApiService {
  private readonly logger = new Logger(OpenFinanceApiService.name);

  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly username: string;
  private readonly password: string;

  private readonly http: AxiosInstance;

  // Cached bearer token (in-memory only)
  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0;

  // Polling configuration
  private readonly pollIntervalMs = 2_000;
  private readonly pollTimeoutMs = 30_000;

  constructor(private readonly openFinanceService: OpenFinanceService) {
    const baseUrl = process.env.OF_BASE_URL;
    const clientId = process.env.OF_CLIENT_ID;
    const clientSecret = process.env.OF_CLIENT_SECRET;
    const username = process.env.OF_USERNAME;
    const password = process.env.OF_PASSWORD;

    if (!baseUrl || !clientId || !clientSecret || !username || !password) {
      throw new InternalServerErrorException(
        'Open Finance API is not configured. Required env vars: OF_BASE_URL, OF_CLIENT_ID, OF_CLIENT_SECRET, OF_USERNAME, OF_PASSWORD',
      );
    }

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.password = password;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Public entry point: runs the full Open Finance API integration flow and
   * hands the resulting financial report to the existing LLM-based normalizer
   * so it is persisted exactly like the file-upload path.
   */
  async connectAndAnalyze(externalUserId: string, userId: string): Promise<PersistAnalysisResult> {
    const token = await this.authenticate();

    // Step 2 — Trigger the financial-report job for this customer.
    const jobId = await this.createFinancialReportJob(token, externalUserId);

    // Step 3 — Poll the financial-report endpoint until completion or timeout.
    const report = await this.pollFinancialReport(token, jobId);

    if (!report.financialReport || typeof report.financialReport !== 'object') {
      throw new BadGatewayException('Open Finance returned a completed job without a financialReport payload');
    }

    // Normalization Bridge: feed the raw OF financialReport JSON into the same
    // LLM-driven analyzer used by the file-upload flow.
    return this.openFinanceService.analyzeBankingJson(report.financialReport, userId);
  }

  // -------------------- Step 1: Authentication --------------------

  private async authenticate(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedTokenExpiresAt - 5_000) {
      return this.cachedToken;
    }

    try {
      const { data } = await this.http.post<OFTokenResponse>('/oauth/token', {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        userId: this.username,
      });

      this.logger.log(`Open Finance /oauth/token response keys: ${Object.keys(data ?? {}).join(', ')}`);

      const token =
        (typeof data?.access_token === 'string' && data.access_token) ||
        (typeof data?.accessToken === 'string' && data.accessToken) ||
        (typeof data?.token === 'string' && data.token) ||
        (typeof data?.jwt === 'string' && data.jwt) ||
        null;

      if (!token) {
        this.logger.error(`Open Finance /oauth/token unexpected payload: ${JSON.stringify(data)?.slice(0, 500)}`);
        throw new UnauthorizedException('Open Finance auth response did not include an access token');
      }

      this.cachedToken = token;
      const ttlSeconds = Number(data?.expires_in ?? data?.expiresIn ?? 3_600);
      this.cachedTokenExpiresAt = Date.now() + ttlSeconds * 1_000;
      return this.cachedToken;
    } catch (err) {
      const ax = err as AxiosError;
      const status = ax.response?.status;
      this.logger.error(
        `Open Finance auth failed (status=${status}): ${this.describeAxiosError(ax)}`,
      );
      if (status === 401 || status === 403) {
        throw new UnauthorizedException('Open Finance authentication failed (invalid credentials)');
      }
      if (err instanceof UnauthorizedException) throw err;
      throw new BadGatewayException(`Open Finance authentication error: ${this.describeAxiosError(ax)}`);
    }
  }

  // -------------------- Step 2: Job creation --------------------

  private async createFinancialReportJob(token: string, customerId: string): Promise<string> {
    try {
      const { data } = await this.http.post<OFCreateReportResponse>(
        `/v2/financial-report/${encodeURIComponent(customerId)}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );

      this.logger.log(
        `Open Finance POST /v2/financial-report/${customerId} response keys: ${Object.keys(data ?? {}).join(', ')}`,
      );

      const jobId = data?.jobId ?? data?.job_id ?? data?.id;
      if (!jobId || typeof jobId !== 'string') {
        throw new BadGatewayException(
          `Open Finance /v2/financial-report/${customerId} did not return a jobId (payload=${JSON.stringify(data)?.slice(0, 300)})`,
        );
      }
      return jobId;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const ax = err as AxiosError;
      const status = ax.response?.status;
      this.logger.error(
        `Open Finance /v2/financial-report/${customerId} failed (status=${status}): ${this.describeAxiosError(ax)}`,
      );
      if (status === 401) {
        this.cachedToken = null;
        throw new UnauthorizedException('Open Finance rejected the access token while creating financial-report job');
      }
      throw new BadGatewayException(`Open Finance job creation failed: ${this.describeAxiosError(ax)}`);
    }
  }

  // -------------------- Step 4: Polling --------------------

  private async pollFinancialReport(token: string, jobId: string): Promise<OFFinancialReportResponse> {
    const deadline = Date.now() + this.pollTimeoutMs;
    let lastStatus: string | undefined;

    while (Date.now() < deadline) {
      let data: OFFinancialReportResponse;
      try {
        const res = await this.http.get<OFFinancialReportResponse>(
          `/v2/financial-report/${encodeURIComponent(jobId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        data = res.data;
      } catch (err) {
        const ax = err as AxiosError;
        const status = ax.response?.status;
        this.logger.error(
          `Open Finance /financial-report poll failed (status=${status}): ${this.describeAxiosError(ax)}`,
        );
        if (status === 401) {
          this.cachedToken = null;
          throw new UnauthorizedException('Open Finance rejected the access token while polling');
        }
        if (status === 404) {
          // Job not yet visible — keep polling within the deadline.
          await this.sleep(this.pollIntervalMs);
          continue;
        }
        throw new BadGatewayException(`Open Finance polling error: ${this.describeAxiosError(ax)}`);
      }

      lastStatus = typeof data?.status === 'string' ? data.status : undefined;
      if (lastStatus && this.isTerminalSuccess(lastStatus)) {
        return data;
      }
      if (lastStatus && this.isTerminalFailure(lastStatus)) {
        throw new BadGatewayException(`Open Finance job ended with status=${lastStatus}`);
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new RequestTimeoutException(
      `Open Finance job ${jobId} did not complete within ${this.pollTimeoutMs / 1000}s (last status=${lastStatus ?? 'unknown'})`,
    );
  }

  private isTerminalSuccess(status: string): boolean {
    const s = status.toLowerCase();
    return s === 'done' || s === 'completed' || s === 'success' || s === 'succeeded';
  }

  private isTerminalFailure(status: string): boolean {
    const s = status.toLowerCase();
    return s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private describeAxiosError(err: AxiosError): string {
    if (err.response) {
      const body = typeof err.response.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response.data);
      return `HTTP ${err.response.status} ${body?.slice(0, 500) ?? ''}`;
    }
    return err.message || 'unknown error';
  }
}
