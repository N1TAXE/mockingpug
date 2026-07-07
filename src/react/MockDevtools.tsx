import { useState } from 'react';
import { generateAll } from '../generator/index.js';
import {
  exportSnapshot,
  importSnapshot,
  updateRecord,
  type OneShotOverrideEntry,
  type RequestLogEntry,
  type StoreSnapshot,
} from '../query/index.js';
import { generateOpenApiSpec } from '../openapi-gen/generate.js';
import { renderDocsHtml } from '../openapi-gen/renderHtml.js';
import { buildCurlCommand } from '../shared/curl.js';
import { copyToClipboard } from '../shared/clipboard.js';
import { DevtoolsPanel } from '../shared/devtoolsUI.js';
import { useMockContext } from './MockProvider.js';

export interface MockDevtoolsProps {
  /** Must match the `baseUrl` passed to `createMockHandlers(ctx, baseUrl)`. Defaults to `/api`, same as the transport's own default. Only used to build the "Copy as curl" URL. */
  baseUrl?: string;
}

/**
 * Floating dev-only panel: mock/off toggle, live `delay`/`errorRate`
 * editing, and a "Mock Data" list of every entity (record count + per-entity
 * bypass). Clicking an entity opens its records in a separate, draggable
 * floating window. Meant to be rendered only behind the same dev-only import
 * gate as `startMocking()` itself (see `react/README.md`); never shipped to
 * production.
 *
 * Invariant: every action this panel takes (reset, record edit, snapshot
 * export/import, request-log read) calls into `ctx`/the query layer
 * directly, never through `fetch()`/MSW — so unlike the app's own mocked
 * requests, none of it is ever subject to `runtime.errorRate`/`delay`,
 * regardless of how they're configured. Covered by a regression test in
 * `tests/react/MockDevtools.test.tsx`.
 */
export function MockDevtools({ baseUrl = '/api' }: MockDevtoolsProps = {}) {
  const { mode, setMode, ctx, runtime, setRuntime, bypass, unbypass, isBypassed } = useMockContext();
  const [entities, setEntities] = useState<Record<string, number>>({});

  async function refreshCounts() {
    const next: Record<string, number> = {};
    for (const entity of Object.keys(ctx.schemas)) {
      const stored = await ctx.store.load(entity);
      next[entity] = stored?.records.length ?? 0;
    }
    setEntities(next);
  }

  async function fetchRecords(entity: string): Promise<unknown[]> {
    const stored = await ctx.store.load(entity);
    return stored?.records.slice(0, 10) ?? [];
  }

  async function resetEntity(entity: string): Promise<unknown[]> {
    await ctx.store.deleteEntity(entity);
    await generateAll(ctx.schemas, ctx.store, { seed: ctx.seed, customDictionaries: ctx.customDictionaries });
    const stored = await ctx.store.load(entity);
    setEntities((prev) => ({ ...prev, [entity]: stored?.records.length ?? 0 }));
    return stored?.records.slice(0, 10) ?? [];
  }

  async function updateRecordInPanel(entity: string, id: string, patch: Record<string, unknown>): Promise<unknown> {
    return updateRecord(entity, id, patch, ctx);
  }

  async function fetchRequestLog(): Promise<RequestLogEntry[]> {
    return ctx.requestLog?.list() ?? [];
  }

  async function clearRequestLog(): Promise<void> {
    ctx.requestLog?.clear();
  }

  async function armOneShotOverride(entity: string, patch: OneShotOverrideEntry): Promise<void> {
    ctx.oneShotOverrides?.set(entity, patch);
  }

  async function peekOneShotOverride(entity: string): Promise<OneShotOverrideEntry | undefined> {
    return ctx.oneShotOverrides?.peek(entity);
  }

  async function handleExportSnapshot(): Promise<StoreSnapshot> {
    return exportSnapshot(ctx);
  }

  async function handleImportSnapshot(snapshot: StoreSnapshot): Promise<void> {
    await importSnapshot(ctx, snapshot);
    await refreshCounts();
  }

  async function copyRecordCurl(entity: string, id: string): Promise<void> {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}${baseUrl}/${entity}/${id}`;
    await copyToClipboard(buildCurlCommand('GET', url));
  }

  /**
   * Generated entirely client-side (unlike `mockingpug/next`'s live route,
   * there's no server here to hit) — `ctx.schemas` is already the same
   * fully-parsed `EntitySchema` map the CLI's `mpug docs` reads, so this
   * needs no round-trip. Opened via a blob URL rather than downloaded, so
   * it behaves like any other "open docs" link; revoked after giving the
   * new tab plenty of time to finish loading it.
   */
  function openDocs() {
    const spec = generateOpenApiSpec(ctx.schemas, { baseUrl, pagination: ctx.pagination }, ctx.customDictionaries);
    const html = renderDocsHtml(spec);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <DevtoolsPanel
      title="mockingpug"
      entities={entities}
      runtime={runtime}
      onRuntimeChange={setRuntime}
      onFetchRecords={fetchRecords}
      onResetEntity={resetEntity}
      onUpdateRecord={updateRecordInPanel}
      onFetchRequestLog={fetchRequestLog}
      onClearRequestLog={clearRequestLog}
      onArmOneShotOverride={armOneShotOverride}
      onPeekOneShotOverride={peekOneShotOverride}
      onExportSnapshot={handleExportSnapshot}
      onImportSnapshot={handleImportSnapshot}
      onCopyRecordCurl={copyRecordCurl}
      onOpenDocs={(ctx.docs?.enabled ?? true) ? openDocs : undefined}
      onOpen={() => void refreshCounts()}
      mockNetwork={{ enabled: mode === 'mock', onToggle: (next) => setMode(next ? 'mock' : 'off') }}
      bypass={{
        isBypassed,
        onToggle: (entity) => (isBypassed(entity) ? unbypass(entity) : bypass(entity)),
      }}
    />
  );
}
