import type { PersistAnalysisResult } from './open-finance.service.js';

/** Response from POST /oauth/token. */
export interface OFTokenResponse {
  access_token?: string;
  accessToken?: string;
  token?: string;
  jwt?: string;
  expires_in?: number;
  expiresIn?: number;
  [k: string]: unknown;
}

/** A single connection entry returned by GET /v2/connections. */
export interface OFConnection {
  id?: string;
  _id?: string;
  connectionId?: string;
  status?: string;
  [k: string]: unknown;
}

/** Response from GET /v2/connections (array or wrapped). */
export interface OFConnectionsResponse {
  connections?: OFConnection[];
  data?: OFConnection[];
  [k: string]: unknown;
}

/** Response from POST /v2/connections. */
export interface OFCreateConnectionResponse {
  id?: string;
  _id?: string;
  connectionId?: string;
  [k: string]: unknown;
}

/**
 * Response from POST /v2/connect/open-banking-init. The `state` needed to
 * finalize is embedded as a query param inside `scaOAuth`.
 */
export interface OFInitConnectionResponse {
  scaOAuth?: string;
  connection?: { scaOAuth?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** Response from POST /v2/financial-report/{customerId}. */
export interface OFCreateReportResponse {
  jobId?: string;
  job_id?: string;
  id?: string;
  [k: string]: unknown;
}

/** Response from GET /v2/financial-report/{jobId}. */
export interface OFFinancialReportResponse {
  status?: string;
  financialReport?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Result returned by the public connect-and-analyze flow. */
export interface ConnectApiResult {
  stage: 'ANALYSIS_COMPLETE';
  analysis: PersistAnalysisResult;
}
