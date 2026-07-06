import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RuntimeConfig } from '../cli/mockConfig.js';
import { DEFAULT_RUNTIME, OneShotOverrides, RequestLog, type QueryContext } from '../query/index.js';
import { bypass as bypassEntity, isRuntimeBypassed, unbypass as unbypassEntity } from './bypassState.js';

export type MockMode = 'mock' | 'off';

/** Minimal shape `<MockProvider>` needs from MSW's `setupWorker()` result, kept duck-typed so this module doesn't need a hard `msw/browser` import. */
export interface MockWorker {
  start(options?: unknown): Promise<unknown>;
  stop(): void;
}

export interface MockProviderProps {
  children: ReactNode;
  /** The result of `setupWorker(...createMockHandlers(ctx, baseUrl))`. `<MockProvider>` owns starting/stopping it. */
  worker: MockWorker;
  /** Same `QueryContext` passed to `createMockHandlers()`. Its `.runtime` is mutated live as devtools users edit delay/errorRate. */
  ctx: QueryContext;
  /** Initial mock/off mode, overridden by a previously saved choice in `storageKey` if one exists. */
  initialMode?: MockMode;
  /** `localStorage` key used to persist the mock/off toggle across reloads. Pass `null` to disable persistence. */
  storageKey?: string | null;
}

export interface MockContextValue {
  mode: MockMode;
  setMode: (mode: MockMode) => void;
  ctx: QueryContext;
  runtime: RuntimeConfig;
  setRuntime: (patch: Partial<RuntimeConfig>) => void;
  bypass: (entity: string) => void;
  unbypass: (entity: string) => void;
  isBypassed: (entity: string) => boolean;
}

const MockContext = createContext<MockContextValue | null>(null);

const DEFAULT_STORAGE_KEY = 'mockingpug:mode';

function readStoredMode(storageKey: string | null): MockMode | null {
  if (!storageKey || typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(storageKey);
  return value === 'mock' || value === 'off' ? value : null;
}

/**
 * Owns the MSW worker's lifecycle (start on `mode: 'mock'`, stop on
 * `mode: 'off'`) and exposes a small context
 * (`useMockContext()`) that `<MockDevtools>` (or any custom UI) reads/writes:
 * the mock/off toggle, live `runtime.delay`/`runtime.errorRate` edits (which
 * take effect on the very next request; `ctx` is mutated in place, the same
 * object reference `createMockHandlers()` closed over), and per-entity
 * bypass.
 */
export function MockProvider({
  children,
  worker,
  ctx,
  initialMode = 'mock',
  storageKey = DEFAULT_STORAGE_KEY,
}: MockProviderProps) {
  const [mode, setModeState] = useState<MockMode>(() => readStoredMode(storageKey) ?? initialMode);
  const [runtime, setRuntimeState] = useState<RuntimeConfig>(ctx.runtime ?? DEFAULT_RUNTIME);

  // Ensures `ctx.requestLog` exists before any request could plausibly reach
  // `createMockHandlers()` (which only happens after `worker.start()`, itself
  // only called from this same component's effect below). A `ref` guard
  // (rather than `useEffect`) makes this synchronous and idempotent even
  // under StrictMode's double-render: only the first pass's assignment
  // survives, since `requestLogRef.current` is already set by then.
  const requestLogRef = useRef<RequestLog | null>(null);
  if (!requestLogRef.current) {
    requestLogRef.current = ctx.requestLog ?? new RequestLog();
    ctx.requestLog = requestLogRef.current;
  }

  // Same synchronous ref-guard as above, for the one-shot per-entity fail/delay overrides.
  const oneShotOverridesRef = useRef<OneShotOverrides | null>(null);
  if (!oneShotOverridesRef.current) {
    oneShotOverridesRef.current = ctx.oneShotOverrides ?? new OneShotOverrides();
    ctx.oneShotOverrides = oneShotOverridesRef.current;
  }

  useEffect(() => {
    if (mode === 'mock') {
      worker.start({ onUnhandledRequest: 'bypass' }).catch((error: unknown) => {
        console.error('[mockingpug] failed to start the MSW worker:', error);
      });
    } else {
      worker.stop();
    }
    return () => worker.stop();
  }, [mode, worker]);

  useEffect(() => {
    ctx.runtime = runtime;
  }, [runtime, ctx]);

  const setMode = useCallback(
    (next: MockMode) => {
      setModeState(next);
      if (storageKey && typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, next);
      }
    },
    [storageKey],
  );

  const setRuntime = useCallback((patch: Partial<RuntimeConfig>) => {
    setRuntimeState((current) => ({ ...current, ...patch }));
  }, []);

  const value = useMemo<MockContextValue>(
    () => ({
      mode,
      setMode,
      ctx,
      runtime,
      setRuntime,
      bypass: bypassEntity,
      unbypass: unbypassEntity,
      isBypassed: isRuntimeBypassed,
    }),
    [mode, setMode, ctx, runtime, setRuntime],
  );

  return <MockContext.Provider value={value}>{children}</MockContext.Provider>;
}

/** Reads the current mock state; throws (fail-fast) if used outside `<MockProvider>`. */
export function useMockContext(): MockContextValue {
  const value = useContext(MockContext);
  if (!value) {
    throw new Error('[mockingpug] useMockContext() must be used inside <MockProvider>');
  }
  return value;
}
