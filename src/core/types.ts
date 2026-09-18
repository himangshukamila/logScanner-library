export const LOG_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogSource = 'browser' | 'server' | 'network';

/** Structured detail for a captured fetch/XHR request; absent on console entries. */
export interface NetworkInfo {
  readonly method: string;
  readonly url: string;
  /** Shortened display form: path for same-origin requests, origin and path otherwise. */
  readonly label: string;
  readonly initiator: 'fetch' | 'xhr';
  readonly durationMs: number;
  readonly status?: number;
  readonly statusText?: string;
  readonly contentType?: string;
  readonly requestBody?: string;
  readonly responseBody?: string;
  /** The request never produced a response: network failure, CORS rejection, or abort. */
  readonly failed?: boolean;
}

export interface LogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly source: LogSource;
  readonly args: readonly string[];
  readonly message: string;
  readonly network?: NetworkInfo;
}

export function normalizeMaxLogs(value = 500): number {
  return Number.isFinite(value) ? Math.min(5000, Math.max(1, Math.floor(value))) : 500;
}
