import { AxiosError } from 'axios';
import {
  TERMINAL_FAILURE_STATUSES,
  TERMINAL_SUCCESS_STATUSES,
} from './open-finance-api.constants.js';

/** Resolves after the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Builds a concise, log-safe description of an Axios error. */
export function describeAxiosError(err: AxiosError): string {
  if (err.response) {
    const body =
      typeof err.response.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response.data);
    return `HTTP ${err.response.status} ${body?.slice(0, 500) ?? ''}`;
  }
  return err.message || 'unknown error';
}

/** Returns the first defined, non-empty string from the given values. */
export function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** Extracts the `state` query parameter from an OAuth URL. */
export function extractStateFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('state') ?? undefined;
  } catch {
    const match = url.match(/[?&]state=([^&]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  }
}

/** True when a job status indicates successful completion. */
export function isTerminalSuccess(status: string): boolean {
  return TERMINAL_SUCCESS_STATUSES.includes(status.toLowerCase());
}

/** True when a job status indicates terminal failure. */
export function isTerminalFailure(status: string): boolean {
  return TERMINAL_FAILURE_STATUSES.includes(status.toLowerCase());
}
