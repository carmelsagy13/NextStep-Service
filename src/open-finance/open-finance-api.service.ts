import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadGatewayException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { User } from '../database/entities/user.entity.js';
import { OpenFinanceService } from './open-finance.service.js';
import {
  ConnectApiResult,
  OFConnection,
  OFConnectionsResponse,
  OFTokenResponse,
} from './open-finance-api.types.js';
import type {
  OFBalanceHistory,
  OFDataAccount,
  OFDataTransaction,
  OFPaginated,
  OFSlimTransaction,
} from './open-finance-data.types.js';
import type { OFFinancialReport } from './financial-report.types.js';
import { buildFinancialReport } from './open-finance-data.aggregator.js';
import {
  DATA_FETCH_MAX_ATTEMPTS,
  DATA_FETCH_RETRY_DELAY_MS,
  DATA_MAX_PAGES,
  DATA_PAGE_SIZE,
  HTTP_TIMEOUT_MS,
  TOKEN_DEFAULT_TTL_SECONDS,
  TOKEN_EXPIRY_SKEW_MS,
  TX_HISTORY_MONTHS,
} from './open-finance-api.constants.js';
import {
  describeAxiosError,
  firstString,
  sleep,
  toIsoDate,
} from './open-finance-api.utils.js';
import {
  auditAccountBalances,
  auditRawCollection,
  auditRawObject,
} from '../diagnostics/open-finance-audit.js';

/**
 * Integrates with the Open Finance API to fetch a customer's financial data
 * and hand it to the existing LLM-based analyzer.
 *
 * Connections are provisioned out-of-band — `POST /v2/connections` and the
 * open-banking init/finalize endpoints are no longer available to us, so this
 * service only reads the connections that already exist.
 *
 * The aggregated `POST /financial-report/{customerId}` + `GET
 * /financial-report/{jobId}` job is likewise gone, so the report is rebuilt
 * locally from the raw data endpoints (`/v2/data/accounts`,
 * `/v2/data/transactions` and `/v2/data/accounts/{id}/balances/history`) — see
 * the aggregator for the mapping.
 */

/** Keeps only the transaction fields the aggregator reads. */
function slimTransaction(tx: OFDataTransaction): OFSlimTransaction {
  return {
    accountId: tx?.accountId,
    accountNumber: tx?.accountNumber,
    providerId: tx?.providerId,
    status: tx?.status,
    amount: {
      chargedAmount: tx?.amount?.chargedAmount,
      originalAmount: tx?.amount?.originalAmount,
    },
    date: tx?.date,
    category: tx?.category,
    changedCategory: tx?.changedCategory,
    balancePerEndDay: tx?.balancePerEndDay,
  };
}

@Injectable()
export class OpenFinanceApiService {
  private readonly logger = new Logger(OpenFinanceApiService.name);

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly username: string;
  private readonly http: AxiosInstance;

  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0;

  constructor(
    private readonly openFinanceService: OpenFinanceService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
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
   * Runs the full flow: authenticate → resolve the customer's connections → pull
   * the raw accounts/transactions → aggregate into a financial report → analyze
   * and persist the result.
   */
  async connectAndAnalyze(userId: string): Promise<ConnectApiResult> {
    const user = await this.userRepo.findOne({ where: { userId } });
    if (!user) {
      throw new InternalServerErrorException(
        `User record not found for userId=${userId}.`,
      );
    }
    // user.id (national ID) is the Open Finance external customer ID.
    const externalUserId = user.id;

    this.logger.log(`connectAndAnalyze START — customer=${externalUserId}`);

    const token = await this.authenticate();
    const connectionIds = await this.activeConnectionIds(token, externalUserId);

    const report = await this.fetchAggregatedReport(
      token,
      externalUserId,
      connectionIds,
    );

    const analysis = await this.openFinanceService.analyzeBankingJson(
      report,
      userId,
    );

    const result: ConnectApiResult = { stage: 'ANALYSIS_COMPLETE', analysis };
    this.logger.log(
      `connectAndAnalyze END — response to frontend: ${JSON.stringify(result)}`,
    );
    return result;
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

  /**
   * Active connection ids belonging to the customer, used to scope the data
   * queries. Connections are provisioned out-of-band (the consent journey) — we
   * only read them. Connections that don't expose an owner field are kept, so an
   * unexpected provider shape degrades to "any active connection".
   */
  private async activeConnectionIds(
    token: string,
    customerId: string,
  ): Promise<string[]> {
    try {
      const { data } = await this.http.get<
        OFConnectionsResponse | OFConnection[]
      >('/v2/connections', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const list = Array.isArray(data)
        ? data
        : (data?.connections ?? data?.data ?? []);
      const ids = list
        .filter((c) => c.status?.toUpperCase() === 'ACTIVE')
        .filter((c) => {
          const owner = firstString(c.customerId, c.psuId);
          return !owner || owner === customerId;
        })
        .map((c) => firstString(c.id, c._id, c.connectionId))
        .filter((id): id is string => Boolean(id));

      if (ids.length === 0) {
        this.logger.warn(
          `No active connection for customer ${customerId} — querying data unscoped`,
        );
      }
      return ids;
    } catch (err) {
      this.logger.error(
        `activeConnectionIds FAILED: ${describeAxiosError(err as AxiosError)}`,
      );
      return [];
    }
  }

  // -------------------- Financial data --------------------

  /**
   * Pulls the customer's raw data and rebuilds the aggregated financial report
   * locally. A freshly-activated connection may still be syncing, so an empty
   * account list is retried before it is treated as an error.
   */
  private async fetchAggregatedReport(
    token: string,
    customerId: string,
    connectionIds: string[],
  ): Promise<OFFinancialReport> {
    let accounts: OFDataAccount[] = [];
    for (let attempt = 1; attempt <= DATA_FETCH_MAX_ATTEMPTS; attempt++) {
      accounts = await this.fetchAccounts(token, connectionIds);
      if (accounts.length > 0) break;
      if (attempt < DATA_FETCH_MAX_ATTEMPTS) {
        this.logger.warn(
          `No accounts yet (attempt ${attempt}/${DATA_FETCH_MAX_ATTEMPTS}) — ` +
            `retrying in ${DATA_FETCH_RETRY_DELAY_MS / 1000}s`,
        );
        await sleep(DATA_FETCH_RETRY_DELAY_MS);
      }
    }

    if (accounts.length === 0) {
      throw new BadGatewayException(
        `Open Finance returned no accounts for customer ${customerId}`,
      );
    }

    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setUTCMonth(fromDate.getUTCMonth() - TX_HISTORY_MONTHS);
    fromDate.setUTCDate(1);

    // Testing escape hatch: skips the heaviest call at the cost of every
    // transaction-derived feature (cash-flow history, debt service, card spend).
    const skipTransactions = process.env.OF_SKIP_TRANSACTIONS === 'true';
    if (skipTransactions) {
      this.logger.warn(
        'OF_SKIP_TRANSACTIONS=true — transaction-derived features will be zero',
      );
    }

    const transactions = skipTransactions
      ? []
      : await this.fetchTransactions(
          token,
          connectionIds,
          toIsoDate(fromDate),
          toIsoDate(now),
        );

    const balanceHistories = await this.fetchBalanceHistories(
      token,
      accounts,
      toIsoDate(fromDate),
      toIsoDate(now),
    );

    this.logger.log(
      `Fetched ${accounts.length} accounts, ${transactions.length} transactions, ` +
        `${balanceHistories.length} balance series`,
    );

    auditRawCollection(
      this.logger,
      '/v2/data/accounts',
      accounts,
      'accountType',
    );
    auditAccountBalances(this.logger, accounts);
    auditRawObject(
      this.logger,
      '/v2/data/balances/history',
      balanceHistories[0] ?? null,
    );

    const report = buildFinancialReport({
      customerId,
      accounts,
      transactions,
      balanceHistories,
      now,
    });

    const cashFlow = (report.yearMonthBalance ?? [])
      .map(
        (m) =>
          `${m.yearMonth} in=${m.sumIncome} out=${m.sumExpense} bal=${m.balance ?? 'n/a'}`,
      )
      .join(' | ');
    this.logger.log(`Cash-flow by month: ${cashFlow || '(none)'}`);

    const sas = report.savingsAndSecurities ?? {};
    const flows = report.capitalFlows ?? {};
    this.logger.log(
      `Wealth: totalSavings=${sas.totalSavings ?? 0}, ` +
        `totalSecuritiesValue=${sas.totalSecuritiesValue ?? 0} | ` +
        `capitalFlows over ${flows.windowMonths ?? 0}mo: ` +
        `contributions=${flows.contributions ?? 0}, redemptions=${flows.redemptions ?? 0}`,
    );

    return report;
  }

  /** GET /v2/data/accounts, once per connection (or unscoped when unknown). */
  private async fetchAccounts(
    token: string,
    connectionIds: string[],
  ): Promise<OFDataAccount[]> {
    const scopes = connectionIds.length > 0 ? connectionIds : [undefined];
    const results: OFDataAccount[] = [];
    for (const connectionId of scopes) {
      results.push(
        ...(await this.fetchAllPages<OFDataAccount>(
          token,
          '/v2/data/accounts',
          connectionId ? { connectionId } : {},
          'accounts fetch',
        )),
      );
    }
    // The same account can be returned under several connections.
    const unique = new Map<string, OFDataAccount>();
    for (const account of results) {
      unique.set(String(account?.id ?? Math.random()), account);
    }
    return [...unique.values()];
  }

  /**
   * GET /v2/data/transactions for the requested window. `limit` must not be
   * combined with the date filters, so pagination relies on `nextPage` alone.
   * Each page is projected onto the slim shape immediately so the bulky
   * provider payload is never accumulated.
   */
  private async fetchTransactions(
    token: string,
    connectionIds: string[],
    dateFrom: string,
    dateTo: string,
  ): Promise<OFSlimTransaction[]> {
    const scopes = connectionIds.length > 0 ? connectionIds : [undefined];
    const results: OFSlimTransaction[] = [];
    for (const connectionId of scopes) {
      const page = await this.fetchAllPages<OFDataTransaction>(
        token,
        '/v2/data/transactions',
        {
          dateFrom,
          dateTo,
          sort: 1,
          includeDuplicates: 0,
          ...(connectionId ? { connectionId } : {}),
        },
        'transactions fetch',
        { usePageSize: false },
      );
      // Audited before slimming so provider-side schema drift stays visible.
      auditRawCollection(this.logger, '/v2/data/transactions', page);
      results.push(...page.map(slimTransaction));
    }
    return results;
  }

  /**
   * Daily end-of-day balances per checking account. Best-effort: the provider
   * returns 422 when an account has no balance to anchor the reconstruction on.
   */
  private async fetchBalanceHistories(
    token: string,
    accounts: OFDataAccount[],
    fromDate: string,
    toDate: string,
  ): Promise<OFBalanceHistory[]> {
    const checking = accounts.filter(
      (a) => String(a?.accountType ?? '').toUpperCase() === 'CHECKING' && a?.id,
    );

    const histories = await Promise.all(
      checking.map(async (account) => {
        try {
          const { data } = await this.http.get<OFBalanceHistory>(
            `/v2/data/accounts/${encodeURIComponent(String(account.id))}/balances/history`,
            {
              headers: { Authorization: `Bearer ${token}` },
              params: { fromDate, toDate },
            },
          );
          return data;
        } catch (err) {
          this.logger.warn(
            `balances/history unavailable for account ${account.id}: ` +
              describeAxiosError(err as AxiosError),
          );
          return null;
        }
      }),
    );
    return histories.filter((h): h is OFBalanceHistory => h != null);
  }

  /** Walks a cursor-paginated /v2/data endpoint until it runs out of pages. */
  private async fetchAllPages<T>(
    token: string,
    path: string,
    params: Record<string, unknown>,
    context: string,
    options: { usePageSize?: boolean } = {},
  ): Promise<T[]> {
    const items: T[] = [];
    let nextPage: string | undefined;

    for (let page = 0; page < DATA_MAX_PAGES; page++) {
      let data: OFPaginated<T>;
      try {
        const res = await this.http.get<OFPaginated<T>>(path, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            ...params,
            ...(options.usePageSize === false ? {} : { limit: DATA_PAGE_SIZE }),
            ...(nextPage ? { nextPage } : {}),
          },
        });
        data = res.data;
      } catch (err) {
        throw this.toHttpException(err, context);
      }

      if (Array.isArray(data?.items)) items.push(...data.items);
      if (!data?.nextPage) return items;
      nextPage = data.nextPage;
    }

    this.logger.warn(
      `${context} hit the ${DATA_MAX_PAGES}-page cap — results may be truncated`,
    );
    return items;
  }

  // -------------------- Error mapping --------------------

  /** Maps an Axios/known error to an appropriate Nest HTTP exception. */
  private toHttpException(err: unknown, context: string): Error {
    if (
      err instanceof BadGatewayException ||
      err instanceof UnauthorizedException ||
      err instanceof ForbiddenException
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
    if (status === 403) {
      return new ForbiddenException(
        `Open Finance returned 403 during ${context}`,
      );
    }
    return new BadGatewayException(
      `Open Finance ${context} failed: ${describeAxiosError(ax)}`,
    );
  }
}
