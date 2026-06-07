import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadGatewayException,
  RequestTimeoutException,
  InternalServerErrorException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  OpenFinanceService,
  PersistAnalysisResult,
} from './open-finance.service.js';

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

interface OFConnection {
  id?: string;
  _id?: string;
  connectionId?: string;
  status?: string;
  url?: string;
  connectionUrl?: string;
  [k: string]: unknown;
}

interface OFConnectionsResponse {
  connections?: OFConnection[];
  data?: OFConnection[];
  [k: string]: unknown;
}

interface OFCreateConnectionResponse {
  id?: string;
  _id?: string;
  connectionId?: string;
  url?: string;
  connectUrl?: string;
  connectionUrl?: string;
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

export interface ConnectApiResult {
  stage: 'CONNECTION_REQUIRED' | 'ANALYSIS_COMPLETE';
  connectionUrl?: string;
  connectionId?: string;
  analysis?: PersistAnalysisResult;
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
  private readonly pollIntervalMs = 3_000;
  private readonly pollTimeoutMs = 120_000;

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
   *
   * If the customer has no active bank connections yet, a new connection is
   * created and the response contains the `connectionUrl` the user must visit
   * to complete the bank consent flow.  Once connections are active, calling
   * this method again will generate and return the financial analysis.
   */
  async connectAndAnalyze(
    externalUserId: string,
    userId: string,
  ): Promise<ConnectApiResult> {
    this.logger.log(
      `[connectAndAnalyze] START — externalUserId=${externalUserId}, userId=${userId}`,
    );

    let token: string;
    try {
      token = await this.authenticate();
      this.logger.log(`[connectAndAnalyze] Authentication successful`);
    } catch (err) {
      this.logger.error(
        `[connectAndAnalyze] Authentication FAILED: ${(err as Error).message}`,
      );
      throw err;
    }

    // Step 1 — Ensure the customer has at least one active bank connection.
    // If no active connection exists, create one and activate it programmatically
    // using the open-banking-init/finalize API (no consent UI needed for sandbox).
    this.logger.log(
      `[connectAndAnalyze] Checking connections for customer ${externalUserId}`,
    );
    const connectionState = await this.getConnectionState(token);

    if (connectionState.status !== 'ACTIVE') {
      this.logger.log(
        `[connectAndAnalyze] No active connection (status=${connectionState.status}) — creating and activating programmatically`,
      );
      await this.createAndActivateConnection(token, externalUserId);
    } else {
      this.logger.log(
        `[connectAndAnalyze] Active connection found (${connectionState.connectionId}) — proceeding to financial report`,
      );
    }

    // Step 2 & 3 — Trigger financial-report job and poll for results.
    let financialReport: Record<string, unknown>;

    this.logger.log(
      `[connectAndAnalyze] Creating financial-report job for customer ${externalUserId}`,
    );
    try {
      const jobId = await this.createFinancialReportJob(token, externalUserId);
      this.logger.log(`[connectAndAnalyze] Job created — jobId=${jobId}`);

      this.logger.log(`[connectAndAnalyze] Polling job ${jobId}`);
      const report = await this.pollFinancialReport(token, jobId);
      this.logger.log(
        `[connectAndAnalyze] Poll completed — status=${report.status}, hasFinancialReport=${!!report.financialReport}`,
      );

      if (
        !report.financialReport ||
        typeof report.financialReport !== 'object'
      ) {
        this.logger.error(
          `[connectAndAnalyze] Report missing financialReport — full payload keys: ${Object.keys(report).join(', ')}`,
        );
        throw new BadGatewayException(
          'Open Finance returned a completed job without a financialReport payload',
        );
      }
      financialReport = report.financialReport;
    } catch (err) {
      this.logger.error(
        `[connectAndAnalyze] Financial report retrieval FAILED: ${(err as Error).message}`,
      );
      throw err;
    }

    // Normalization Bridge: feed the financialReport JSON into the same
    // LLM-driven analyzer used by the file-upload flow.
    this.logger.log(
      `[connectAndAnalyze] Running LLM analysis on financial report`,
    );
    let analysis: PersistAnalysisResult;
    try {
      analysis = await this.openFinanceService.analyzeBankingJson(
        financialReport,
        userId,
      );
      this.logger.log(`[connectAndAnalyze] Analysis complete`);
    } catch (err) {
      this.logger.error(
        `[connectAndAnalyze] analyzeBankingJson FAILED: ${(err as Error).message}`,
      );
      throw err;
    }

    this.logger.log(`[connectAndAnalyze] END — returning ANALYSIS_COMPLETE`);
    return { stage: 'ANALYSIS_COMPLETE', analysis };
  }

  // -------------------- Step 1: Authentication --------------------

  private async authenticate(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedTokenExpiresAt - 5_000) {
      this.logger.debug(
        `[authenticate] Using cached token (expires in ${Math.round((this.cachedTokenExpiresAt - now) / 1000)}s)`,
      );
      return this.cachedToken;
    }

    this.logger.log(`[authenticate] Requesting new token from /oauth/token`);
    try {
      const { data } = await this.http.post<OFTokenResponse>('/oauth/token', {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        userId: this.username,
      });

      this.logger.log(
        `[authenticate] /oauth/token response keys: ${Object.keys(data ?? {}).join(', ')}`,
      );

      const token =
        (typeof data?.access_token === 'string' && data.access_token) ||
        (typeof data?.accessToken === 'string' && data.accessToken) ||
        (typeof data?.token === 'string' && data.token) ||
        (typeof data?.jwt === 'string' && data.jwt) ||
        null;

      if (!token) {
        this.logger.error(
          `[authenticate] No token field found in response. Full payload: ${JSON.stringify(data)?.slice(0, 500)}`,
        );
        throw new UnauthorizedException(
          'Open Finance auth response did not include an access token',
        );
      }

      this.cachedToken = token;
      const ttlSeconds = Number(data?.expires_in ?? data?.expiresIn ?? 3_600);
      this.cachedTokenExpiresAt = Date.now() + ttlSeconds * 1_000;
      this.logger.log(`[authenticate] Token obtained (TTL=${ttlSeconds}s)`);
      return this.cachedToken;
    } catch (err) {
      const ax = err as AxiosError;
      const status = ax.response?.status;
      this.logger.error(
        `[authenticate] FAILED (status=${status}): ${this.describeAxiosError(ax)}`,
      );
      if (status === 401 || status === 403) {
        throw new UnauthorizedException(
          'Open Finance authentication failed (invalid credentials)',
        );
      }
      if (err instanceof UnauthorizedException) throw err;
      throw new BadGatewayException(
        `Open Finance authentication error: ${this.describeAxiosError(ax)}`,
      );
    }
  }

  // -------------------- Step 1b: Connection check / creation --------------------

  private async getConnectionState(token: string): Promise<{
    status: 'ACTIVE' | 'PENDING' | 'NONE';
    connectionId?: string;
    connectUrl?: string;
  }> {
    try {
      // Fetch ALL connections (no status filter) so we can find active OR pending
      const { data } = await this.http.get<
        OFConnectionsResponse | OFConnection[]
      >('/v2/connections', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const list = Array.isArray(data)
        ? data
        : ((data as OFConnectionsResponse)?.connections ??
          (data as OFConnectionsResponse)?.data ??
          []);

      this.logger.log(
        `[getConnectionState] Found ${list.length} total connection(s)`,
      );
      if (list.length > 0) {
        this.logger.debug(
          `[getConnectionState] Connections: ${JSON.stringify(list.map((c) => ({ id: c.id ?? c._id ?? c.connectionId, status: c.status })))}`,
        );
      }

      // Prefer an ACTIVE connection
      const active = list.find((c) => c.status?.toUpperCase() === 'ACTIVE');
      if (active) {
        return {
          status: 'ACTIVE',
          connectionId: active.id ?? active._id ?? active.connectionId,
        };
      }

      // If no active, look for a pending one we can reuse
      const pending = list.find((c) => {
        const s = c.status?.toUpperCase();
        return (
          s !== 'ACTIVE' && s !== 'ERROR' && s !== 'REJECTED' && s !== 'EXPIRED'
        );
      });
      if (pending) {
        const url =
          (pending as any).connectUrl ?? pending.url ?? pending.connectionUrl;
        return {
          status: 'PENDING',
          connectionId: pending.id ?? pending._id ?? pending.connectionId,
          connectUrl: url,
        };
      }

      return { status: 'NONE' };
    } catch (err) {
      const ax = err as AxiosError;
      this.logger.error(
        `[getConnectionState] FAILED (status=${ax.response?.status}): ${this.describeAxiosError(ax)}`,
      );
      return { status: 'NONE' };
    }
  }

  private async createConnection(
    token: string,
    customerId: string,
  ): Promise<OFCreateConnectionResponse> {
    const requestBody = {
      customerId,
      includeFakeProviders: process.env.OF_INCLUDE_FAKE_PROVIDERS === 'true',
      refreshData: true,
    };
    this.logger.log(
      `[createConnection] POST /v2/connections — body=${JSON.stringify(requestBody)}`,
    );
    try {
      const { data } = await this.http.post<OFCreateConnectionResponse>(
        '/v2/connections',
        requestBody,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      this.logger.log(
        `[createConnection] Response keys: ${Object.keys(data ?? {}).join(', ')}`,
      );
      this.logger.debug(
        `[createConnection] Full response: ${JSON.stringify(data)?.slice(0, 500)}`,
      );

      const url = data?.connectUrl ?? data?.url ?? data?.connectionUrl;
      if (!url) {
        this.logger.error(
          `[createConnection] No URL in response. Full payload: ${JSON.stringify(data)?.slice(0, 500)}`,
        );
        throw new BadGatewayException(
          `Open Finance /v2/connections did not return a connection URL (payload=${JSON.stringify(data)?.slice(0, 300)})`,
        );
      }
      this.logger.log(`[createConnection] Connection URL obtained: ${url}`);
      return data;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const ax = err as AxiosError;
      const status = ax.response?.status;
      this.logger.error(
        `[createConnection] FAILED (status=${status}): ${this.describeAxiosError(ax)}`,
      );
      if (status === 401) {
        this.cachedToken = null;
        throw new UnauthorizedException(
          'Open Finance rejected the access token while creating connection',
        );
      }
      throw new BadGatewayException(
        `Open Finance connection creation failed: ${this.describeAxiosError(ax)}`,
      );
    }
  }

  /**
   * Programmatically creates a connection AND activates it via the
   * open-banking-init / open-banking-finalize endpoints.
   * This avoids the consent UI entirely — works with sandbox providers.
   */
  private async createAndActivateConnection(
    token: string,
    psuId: string,
  ): Promise<void> {
    // 1. Create the connection resource
    const connection = await this.createConnection(token, psuId);
    const connectionId =
      connection.id ?? connection._id ?? connection.connectionId;
    if (!connectionId) {
      throw new BadGatewayException(
        'Open Finance /v2/connections did not return a connectionId',
      );
    }

    const providerId =
      process.env.OF_SANDBOX_PROVIDER_ID || 'open-finance-sandbox';

    // 2. Initiate the open banking connection programmatically
    this.logger.log(
      `[createAndActivateConnection] POST /v2/connect/open-banking-init — connectionId=${connectionId}, providerId=${providerId}, psuId=${psuId}`,
    );
    let state: string;
    try {
      const { data } = await this.http.post<Record<string, unknown>>(
        '/v2/connect/open-banking-init',
        {
          providerId,
          connectionId,
          psuId,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      this.logger.log(
        `[createAndActivateConnection] open-banking-init response keys: ${Object.keys(data ?? {}).join(', ')}`,
      );
      this.logger.debug(
        `[createAndActivateConnection] open-banking-init full response: ${JSON.stringify(data)?.slice(0, 1500)}`,
      );

      // The response wraps the connection in data.connection — extract scaOAuth URL
      const conn = (data?.connection ?? data) as Record<string, unknown>;
      const scaOAuthUrl = (data?.scaOAuth ??
        conn?.scaOAuth ??
        conn?.scaOAuthUrl ??
        data?.scaOAuthUrl) as string | undefined;

      if (scaOAuthUrl) {
        // Extract the 'state' query parameter from the scaOAuthUrl
        try {
          const url = new URL(scaOAuthUrl);
          state = url.searchParams.get('state') ?? '';
        } catch {
          // If URL parsing fails, try regex extraction
          const match = scaOAuthUrl.match(/[?&]state=([^&]+)/);
          state = match?.[1] ? decodeURIComponent(match[1]) : '';
        }
        this.logger.log(
          `[createAndActivateConnection] Extracted state from scaOAuthUrl: ${state ? state.slice(0, 50) + '...' : 'EMPTY'}`,
        );
      } else {
        // Fallback: check for top-level state field
        state = ((data?.state ?? data?.State ?? data?.stateId) as string) ?? '';
      }

      if (!state) {
        this.logger.error(
          `[createAndActivateConnection] No state found. Response keys: ${JSON.stringify(Object.keys(data ?? {}))}. Connection keys: ${JSON.stringify(Object.keys(conn ?? {}))}`,
        );
        throw new BadGatewayException(
          `open-banking-init did not return a state or scaOAuthUrl with a state param`,
        );
      }
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const ax = err as AxiosError;
      this.logger.error(
        `[createAndActivateConnection] open-banking-init FAILED (status=${ax.response?.status}): ${this.describeAxiosError(ax)}`,
      );
      throw new BadGatewayException(
        `Open Finance open-banking-init failed: ${this.describeAxiosError(ax)}`,
      );
    }

    // 3. Finalize the connection
    this.logger.log(
      `[createAndActivateConnection] GET /v2/connect/open-banking-finalize — state=${state}`,
    );
    try {
      const { data } = await this.http.get<Record<string, unknown>>(
        '/v2/connect/open-banking-finalize',
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { state },
        },
      );
      this.logger.log(
        `[createAndActivateConnection] open-banking-finalize response keys: ${Object.keys(data ?? {}).join(', ')}`,
      );
      this.logger.debug(
        `[createAndActivateConnection] open-banking-finalize full response: ${JSON.stringify(data)?.slice(0, 500)}`,
      );
    } catch (err) {
      const ax = err as AxiosError;
      this.logger.error(
        `[createAndActivateConnection] open-banking-finalize FAILED (status=${ax.response?.status}): ${this.describeAxiosError(ax)}`,
      );
      throw new BadGatewayException(
        `Open Finance open-banking-finalize failed: ${this.describeAxiosError(ax)}`,
      );
    }

    this.logger.log(
      `[createAndActivateConnection] Connection ${connectionId} activated successfully`,
    );

    // Give the system time to sync bank data before requesting a report
    this.logger.log(`[createAndActivateConnection] Waiting 10s for data sync…`);
    await this.sleep(10_000);
  }

  // -------------------- Step 2: Job creation --------------------

  private async createFinancialReportJob(
    token: string,
    customerId: string,
  ): Promise<string> {
    try {
      const { data } = await this.http.post<OFCreateReportResponse>(
        `/v2/financial-report/${encodeURIComponent(customerId)}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );

      this.logger.log(
        `[createFinancialReportJob] Response keys: ${Object.keys(data ?? {}).join(', ')}`,
      );
      this.logger.debug(
        `[createFinancialReportJob] Full response: ${JSON.stringify(data)?.slice(0, 500)}`,
      );

      const jobId = data?.jobId ?? data?.job_id ?? data?.id;
      if (!jobId || typeof jobId !== 'string') {
        this.logger.error(
          `[createFinancialReportJob] No jobId in response. Full payload: ${JSON.stringify(data)?.slice(0, 500)}`,
        );
        throw new BadGatewayException(
          `Open Finance /v2/financial-report/${customerId} did not return a jobId (payload=${JSON.stringify(data)?.slice(0, 300)})`,
        );
      }
      this.logger.log(`[createFinancialReportJob] jobId=${jobId}`);
      return jobId;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const ax = err as AxiosError;
      const status = ax.response?.status;
      this.logger.error(
        `[createFinancialReportJob] FAILED for customer=${customerId} (status=${status}): ${this.describeAxiosError(ax)}`,
      );
      if (status === 401) {
        this.cachedToken = null;
        throw new UnauthorizedException(
          'Open Finance rejected the access token while creating financial-report job',
        );
      }
      throw new BadGatewayException(
        `Open Finance job creation failed: ${this.describeAxiosError(ax)}`,
      );
    }
  }

  // -------------------- Step 4: Polling --------------------

  private async pollFinancialReport(
    token: string,
    jobId: string,
  ): Promise<OFFinancialReportResponse> {
    const deadline = Date.now() + this.pollTimeoutMs;
    let lastStatus: string | undefined;
    let pollCount = 0;

    this.logger.log(
      `[pollFinancialReport] Starting poll for jobId=${jobId} (timeout=${this.pollTimeoutMs / 1000}s, interval=${this.pollIntervalMs}ms)`,
    );

    while (Date.now() < deadline) {
      pollCount++;
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
          `[pollFinancialReport] Poll #${pollCount} FAILED (status=${status}): ${this.describeAxiosError(ax)}`,
        );
        if (status === 401) {
          this.cachedToken = null;
          throw new UnauthorizedException(
            'Open Finance rejected the access token while polling',
          );
        }
        if (status === 404) {
          // Job not yet visible — keep polling within the deadline.
          await this.sleep(this.pollIntervalMs);
          continue;
        }
        throw new BadGatewayException(
          `Open Finance polling error: ${this.describeAxiosError(ax)}`,
        );
      }

      lastStatus = typeof data?.status === 'string' ? data.status : undefined;
      this.logger.debug(
        `[pollFinancialReport] Poll #${pollCount} — status=${lastStatus ?? 'undefined'}, keys=${Object.keys(data ?? {}).join(', ')}`,
      );

      if (lastStatus && this.isTerminalSuccess(lastStatus)) {
        this.logger.log(
          `[pollFinancialReport] Job ${jobId} completed successfully after ${pollCount} poll(s) — status=${lastStatus}`,
        );
        return data;
      }
      if (lastStatus && this.isTerminalFailure(lastStatus)) {
        this.logger.error(
          `[pollFinancialReport] Job ${jobId} FAILED — status=${lastStatus}, payload=${JSON.stringify(data)?.slice(0, 500)}`,
        );
        throw new BadGatewayException(
          `Open Finance job ended with status=${lastStatus}`,
        );
      }

      await this.sleep(this.pollIntervalMs);
    }

    this.logger.error(
      `[pollFinancialReport] TIMEOUT — jobId=${jobId}, polls=${pollCount}, lastStatus=${lastStatus ?? 'unknown'}`,
    );
    throw new RequestTimeoutException(
      `Open Finance job ${jobId} did not complete within ${this.pollTimeoutMs / 1000}s (last status=${lastStatus ?? 'unknown'})`,
    );
  }

  private isTerminalSuccess(status: string): boolean {
    const s = status.toLowerCase();
    return (
      s === 'done' || s === 'completed' || s === 'success' || s === 'succeeded'
    );
  }

  private isTerminalFailure(status: string): boolean {
    const s = status.toLowerCase();
    return (
      s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private describeAxiosError(err: AxiosError): string {
    if (err.response) {
      const body =
        typeof err.response.data === 'string'
          ? err.response.data
          : JSON.stringify(err.response.data);
      return `HTTP ${err.response.status} ${body?.slice(0, 500) ?? ''}`;
    }
    return err.message || 'unknown error';
  }
}
