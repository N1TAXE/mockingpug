// mockingpug/devtools-core — framework-agnostic runtime control (R27).
//
// The React `<MockDevtools>` panel reaches into `ctx` and the query-layer
// runtime state (request log, one-shot overrides, per-request bypass, entity
// bypass, store snapshot) directly. This module exposes that same surface as a
// small, stable, DOM-free facade so any UI (a Vue/RN panel, a custom devtools,
// or a headless script/test) can drive the running mock the same way — and so
// the mock/real toggle (R25) has a single place to live outside React.
//
// Browser-safe: no DOM, no React, no `node:fs`.
import {
  RequestLog,
  OneShotOverrides,
  RequestBypass,
  exportSnapshot,
  importSnapshot,
  type QueryContext,
  type RequestLogEntry,
  type OneShotOverrideEntry,
  type StoreSnapshot,
} from '../query/index.js';
import { bypass, unbypass, isRuntimeBypassed } from '../react/bypassState.js';

export interface RuntimeController {
  /** Entity (table) names this mock knows about — handy for building a UI list. */
  entities(): string[];

  // ── Request log ────────────────────────────────────────────────────────
  /** Most-recent-first snapshot of answered requests. Empty if logging is off. */
  getRequestLog(): RequestLogEntry[];
  clearRequestLog(): void;

  // ── One-shot fail/delay (per entity, consumed on the next request) ───────
  failNext(entity: string): void;
  delayNext(entity: string, ms: number): void;
  /** Reads (without consuming) what's currently armed for an entity. */
  peekOverride(entity: string): OneShotOverrideEntry | undefined;

  // ── Per-request bypass: mock vs real, keyed by exact `METHOD pathname` ────
  setRequestBypass(method: string, pathname: string, bypassed: boolean): void;
  isRequestBypassed(method: string, pathname: string): boolean;
  /** Every currently-bypassed `"METHOD pathname"` key. */
  listRequestBypass(): string[];

  // ── Entity-level runtime bypass (whole entity → real backend) ────────────
  bypassEntity(entity: string): void;
  unbypassEntity(entity: string): void;
  isEntityBypassed(entity: string): boolean;

  // ── Store snapshot (export/import the generated data) ─────────────────────
  exportSnapshot(): Promise<StoreSnapshot>;
  importSnapshot(snapshot: StoreSnapshot): Promise<void>;
}

/**
 * Wraps a live {@link QueryContext} in a framework-agnostic controller. If the
 * context didn't opt into the optional runtime state (request log, one-shot
 * overrides, per-request bypass), it's attached here — the transport reads
 * `ctx.requestLog` / `ctx.oneShotOverrides` / `ctx.requestBypass` per request,
 * so wiring them after handler creation still takes effect. Call once and share
 * the returned controller across your UI.
 */
export function createRuntimeController(ctx: QueryContext): RuntimeController {
  ctx.requestLog ??= new RequestLog();
  ctx.oneShotOverrides ??= new OneShotOverrides();
  ctx.requestBypass ??= new RequestBypass();
  const log = ctx.requestLog;
  const overrides = ctx.oneShotOverrides;
  const requestBypass = ctx.requestBypass;

  return {
    entities: () => Object.keys(ctx.schemas),

    getRequestLog: () => log.list(),
    clearRequestLog: () => log.clear(),

    failNext: (entity) => overrides.set(entity, { failNext: true }),
    delayNext: (entity, ms) => overrides.set(entity, { delayNext: ms }),
    peekOverride: (entity) => overrides.peek(entity),

    setRequestBypass: (method, pathname, bypassed) => requestBypass.set(method, pathname, bypassed),
    isRequestBypassed: (method, pathname) => requestBypass.isBypassed(method, pathname),
    listRequestBypass: () => requestBypass.list(),

    bypassEntity: (entity) => bypass(entity),
    unbypassEntity: (entity) => unbypass(entity),
    isEntityBypassed: (entity) => isRuntimeBypassed(entity),

    exportSnapshot: () => exportSnapshot(ctx),
    importSnapshot: (snapshot) => importSnapshot(ctx, snapshot),
  };
}
