import type { QueryContext } from './resolver.js';

export interface RequestLogEntry {
  method: string;
  /** Pathname + query string, e.g. `/api/user?page=2`. Never the full origin: the host is incidental, not useful to a devtools reader. */
  path: string;
  status: number;
  durationMs: number;
  /** `Date.now()` at the start of the request, used both to sort and to display a time. */
  timestamp: number;
}

export const DEFAULT_REQUEST_LOG_SIZE = 50;

/**
 * Fixed-size ring buffer of the most recent requests the mock actually
 * answered (entity CRUD, never the devtools sub-API's own calls), so
 * `<MockDevtools>` can show a request log without a Network-tab detour.
 * Oldest entries are dropped once `maxSize` is exceeded.
 */
export class RequestLog {
  private readonly entries: RequestLogEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_REQUEST_LOG_SIZE) {
    this.maxSize = maxSize;
  }

  record(entry: RequestLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) this.entries.shift();
  }

  /** Most-recent-first, a fresh array snapshot (safe for a caller to hold onto). */
  list(): RequestLogEntry[] {
    return [...this.entries].reverse();
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * Records one answered request into `ctx.requestLog`; a no-op if it isn't
 * set (a hand-built `ctx` that never opted into logging, or a schema-parse
 * path that doesn't go through a real transport). Call once, right before
 * returning the `Response`, so `status` reflects what actually went out
 * (including an error response), not just the happy path.
 */
export function recordRequest(ctx: QueryContext, request: Request, status: number, startedAt: number): void {
  if (!ctx.requestLog) return;
  const url = new URL(request.url);
  ctx.requestLog.record({
    method: request.method,
    path: url.pathname + url.search,
    status,
    durationMs: Date.now() - startedAt,
    timestamp: startedAt,
  });
}
