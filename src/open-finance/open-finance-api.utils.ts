import { AxiosError } from 'axios';

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

/** Formats a Date as `YYYY-MM-DD`, the format the /v2/data filters expect. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
