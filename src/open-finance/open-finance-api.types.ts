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
  customerId?: string;
  psuId?: string;
  [k: string]: unknown;
}

/** Response from GET /v2/connections (array or wrapped). */
export interface OFConnectionsResponse {
  connections?: OFConnection[];
  data?: OFConnection[];
  [k: string]: unknown;
}

/** Result returned by the public connect-and-analyze flow. */
export interface ConnectApiResult {
  stage: 'ANALYSIS_COMPLETE';
  analysis: PersistAnalysisResult;
}
