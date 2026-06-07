import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadGatewayException,
  RequestTimeoutException,
  InternalServerErrorException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { OpenFinanceService } from './open-finance.service.js';
import {
  ConnectApiResult,
  OFConnection,
  OFConnectionsResponse,
  OFCreateConnectionResponse,
  OFCreateReportResponse,
  OFFinancialReportResponse,
  OFInitConnectionResponse,
  OFTokenResponse,
} from './open-finance-api.types.js';
import {
  DEFAULT_SANDBOX_PROVIDER_ID,
  HTTP_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  TOKEN_DEFAULT_TTL_SECONDS,
  TOKEN_EXPIRY_SKEW_MS,
} from './open-finance-api.constants.js';
import {
  describeAxiosError,
  extractStateFromUrl,
  firstString,
  isTerminalFailure,
  isTerminalSuccess,
  sleep,
} from './open-finance-api.utils.js';

/**
 * Integrates with the Open Finance API to fetch a customer's financial data
 * and hand it to the existing LLM-based analyzer. The connection is created and
 * activated programmatically (no consent UI) via the open-banking init/finalize
 * endpoints, which works for sandbox providers.
 */
@Injectable()
export class OpenFinanceApiService {
  private readonly logger = new Logger(OpenFinanceApiService.name);

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly username: string;
  private readonly http: AxiosInstance;

  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0;

  constructor(private readonly openFinanceService: OpenFinanceService) {
    const baseUrl = process.env.OF_BASE_URL;
    const clientId = process.env.OF_CLIENT_ID;
    const clientSecret = process.env.OF_CLIENT_SECRET;
    const username = process.env.OF_USERNAME;

    if (!baseUrl || !clientId || !clientSecret || !username) {
      throw new InternalServerErrorException(
        'Open Finance API is not configured. Required env vars: OF_BASE_URL, OF_CLIENT_ID, OF_CLIENT_SECRET, OF_USERNAME',
      );
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout: HTTP_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Runs the full flow: authenticate → ensure an active connection → create and
   * poll a financial-report job → analyze and persist the result.
   */
  async connectAndAnalyze(
    externalUserId: string,
    userId: string,
  ): Promise<ConnectApiResult> {
    this.logger.log(`connectAndAnalyze START — customer=${externalUserId}`);

    const token = await this.authenticate();
    await this.ensureActiveConnection(token, externalUserId);

    const jobId = await this.createFinancialReportJob(token, externalUserId);
    const report = await this.pollFinancialReport(token, jobId);

    if (!report.financialReport || typeof report.financialReport !== 'object') {
      throw new BadGatewayException(
        'Open Finance returned a completed job without a financialReport payload',
      );
    }

    const analysis = await this.openFinanceService.analyzeBankingJson(
      report.financialReport,
      userId,
    );

    this.logger.log('connectAndAnalyze END — analysis complete');
    return { stage: 'ANALYSIS_COMPLETE', analysis };
  }

  // -------------------- Authentication --------------------

  private async authenticate(): Promise<string> {
    const now = Date.now();
    if (
      this.cachedToken &&
      now < this.cachedTokenExpiresAt - TOKEN_EXPIRY_SKEW_MS
    ) {
      return this.cachedToken;
    }

    try {
      const { data } = await this.http.post<OFTokenResponse>('/oauth/token', {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        userId: this.username,
      });

      const token = firstString(
        data?.access_token,
        data?.accessToken,
        data?.token,
        data?.jwt,
      );
      if (!token) {
        throw new UnauthorizedException(
          'Open Finance auth response did not include an access token',
        );
      }

      const ttlSeconds = Number(
        data?.expires_in ?? data?.expiresIn ?? TOKEN_DEFAULT_TTL_SECONDS,
      );
      this.cachedToken = token;
      this.cachedTokenExpiresAt = Date.now() + ttlSeconds * 1_000;
      this.logger.log(`Authenticated (token TTL=${ttlSeconds}s)`);
      return token;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const ax = err as AxiosError;
      const status = ax.response?.status;
      this.logger.error(
        `authenticate FAILED (status=${status}): ${describeAxiosError(ax)}`,
      );
      if (status === 401 || status === 403) {
        throw new UnauthorizedException(
          'Open Finance authentication failed (invalid credentials)',
        );
      }
      throw new BadGatewayException(
        `Open Finance authentication error: ${describeAxiosError(ax)}`,
      );
    }
  }

  // -------------------- Connection --------------------

  /** Ensures the customer has an active connection, creating one if needed. */
  private async ensureActiveConnection(
    token: string,
    psuId: string,
  ): Promise<void> {
    if (await this.hasActiveConnection(token)) {
      this.logger.log('Active connection found — proceeding to report');
      return;
    }
    this.logger.log('No active connection — creating and activating');
    await this.createAndActivateConnection(token, psuId);
  }

  private async hasActiveConnection(token: string): Promise<boolean> {
    try {
      const { data } = await this.http.get<
        OFConnectionsResponse | OFConnection[]
      >('/v2/connections', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const list = Array.isArray(data)
        ? data
        : (data?.connections ?? data?.data ?? []);
      return list.some((c) => c.status?.toUpperCase() === 'ACTIVE');
    } catch (err) {
      this.logger.error(
        `hasActiveConnection FAILED: ${describeAxiosError(err as AxiosError)}`,
      );
      return false;
    }
  }

  /**
   * Creates a connection and activates it programmatically via the
   * open-banking init/finalize endpoints. Data availability is handled by the
   * report-polling loop, so no fixed wait is needed here.
   */
  private async createAndActivateConnection(
    token: string,
    psuId: string,
  ): Promise<void> {
    const connectionId = await this.createConnection(token, psuId);
    const state = await this.initOpenBanking(token, connectionId, psuId);
    await this.finalizeOpenBanking(token, state);
    this.logger.log(`Connection ${connectionId} activated`);
  }

  private async createConnection(
    token: string,
    customerId: string,
  ): Promise<string> {
    try {
      const { data } = await this.http.post<OFCreateConnectionResponse>(
        '/v2/connections',
        {
          customerId,
          includeFakeProviders:
            process.env.OF_INCLUDE_FAKE_PROVIDERS === 'true',
          refreshData: true,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      const connectionId = firstString(data?.id, data?._id, data?.connectionId);
      if (!connectionId) {
        throw new BadGatewayException(
          'Open Finance /v2/connections did not return a connectionId',
        );
      }
      return connectionId;
    } catch (err) {
      throw this.toHttpException(err, 'connection creation');
    }
  }

  /** POST /v2/connect/open-banking-init → returns the `state` for finalize. */
  private async initOpenBanking(
    token: string,
    connectionId: string,
    psuId: string,
  ): Promise<string> {
    const providerId =
      process.env.OF_SANDBOX_PROVIDER_ID || DEFAULT_SANDBOX_PROVIDER_ID;
    try {
      const { data } = await this.http.post<OFInitConnectionResponse>(
        '/v2/connect/open-banking-init',
        { providerId, connectionId, psuId },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      const scaOAuthUrl = firstString(
        data?.scaOAuth,
        data?.connection?.scaOAuth,
      );
      const state = scaOAuthUrl ? extractStateFromUrl(scaOAuthUrl) : undefined;
      if (!state) {
        throw new BadGatewayException(
          'open-banking-init did not return a scaOAuth URL containing a state param',
        );
      }
      return state;
    } catch (err) {
      throw this.toHttpException(err, 'open-banking-init');
    }
  }

  /** GET /v2/connect/open-banking-finalize — activates the connection. */
  private async finalizeOpenBanking(
    token: string,
    state: string,
  ): Promise<void> {
    try {
      await this.http.get('/v2/connect/open-banking-finalize', {
        headers: { Authorization: `Bearer ${token}` },
        params: { state },
      });
    } catch (err) {
      throw this.toHttpException(err, 'open-banking-finalize');
    }
  }

  // -------------------- Financial report --------------------

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

      const jobId = firstString(data?.jobId, data?.job_id, data?.id);
      if (!jobId) {
        throw new BadGatewayException(
          `Open Finance /v2/financial-report/${customerId} did not return a jobId`,
        );
      }
      this.logger.log(`Financial-report job created — jobId=${jobId}`);
      return jobId;
    } catch (err) {
      throw this.toHttpException(err, 'job creation');
    }
  }

  private async pollFinancialReport(
    token: string,
    jobId: string,
  ): Promise<OFFinancialReportResponse> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastStatus: string | undefined;

    this.logger.log(
      `Polling job ${jobId} (timeout=${POLL_TIMEOUT_MS / 1000}s)`,
    );

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
        if (ax.response?.status === 404) {
          // Job not yet visible — keep polling within the deadline.
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        throw this.toHttpException(err, 'polling');
      }

      lastStatus = typeof data?.status === 'string' ? data.status : undefined;
      if (lastStatus && isTerminalSuccess(lastStatus)) {
        // A success status can arrive before the report payload is populated
        // (bank data still syncing) — keep polling until the data is present.
        if (data.financialReport && typeof data.financialReport === 'object') {
          this.logger.log(`Job ${jobId} completed (status=${lastStatus})`);
          return data;
        }
        this.logger.debug(`Job ${jobId} ${lastStatus} but report not ready yet`);
      } else if (lastStatus && isTerminalFailure(lastStatus)) {
        throw new BadGatewayException(
          `Open Finance job ended with status=${lastStatus}`,
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }

    throw new RequestTimeoutException(
      `Open Finance job ${jobId} did not complete within ${POLL_TIMEOUT_MS / 1000}s (last status=${lastStatus ?? 'unknown'})`,
    );
  }

  // -------------------- Error mapping --------------------

  /** Maps an Axios/known error to an appropriate Nest HTTP exception. */
  private toHttpException(err: unknown, context: string): Error {
    if (
      err instanceof BadGatewayException ||
      err instanceof UnauthorizedException
    ) {
      return err;
    }
    const ax = err as AxiosError;
    const status = ax.response?.status;
    this.logger.error(
      `${context} FAILED (status=${status}): ${describeAxiosError(ax)}`,
    );
    if (status === 401) {
      this.cachedToken = null;
      return new UnauthorizedException(
        `Open Finance rejected the access token during ${context}`,
      );
    }
    return new BadGatewayException(
      `Open Finance ${context} failed: ${describeAxiosError(ax)}`,
    );
  }
}
