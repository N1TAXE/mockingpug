import { useState } from 'react';
import { generateAll } from '../generator/index.js';
import { collectValues } from '../shared/mask.js';
import { DevtoolsPanel } from '../shared/devtoolsUI.js';
import { useMockContext } from './MockProvider.js';

/**
 * Floating dev-only panel: mock/off toggle, live `delay`/`errorRate`
 * editing, a "Mock Data" list of every entity (record count + per-entity
 * bypass), and the mock-data masking toggle. Clicking an entity opens its
 * records in a separate, draggable floating window. Meant to be rendered
 * only behind the same dev-only import gate as `startMocking()` itself (see
 * `react/README.md`); never shipped to production.
 */
export function MockDevtools() {
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

  async function collectAllValues(): Promise<Set<string>> {
    const values = new Set<string>();
    for (const entity of Object.keys(ctx.schemas)) {
      const stored = await ctx.store.load(entity);
      for (const record of stored?.records ?? []) collectValues(record, values);
    }
    return values;
  }

  return (
    <DevtoolsPanel
      title="mockingpug"
      entities={entities}
      runtime={runtime}
      onRuntimeChange={setRuntime}
      onFetchRecords={fetchRecords}
      onResetEntity={resetEntity}
      onCollectAllValues={collectAllValues}
      onOpen={() => void refreshCounts()}
      mockNetwork={{ enabled: mode === 'mock', onToggle: (next) => setMode(next ? 'mock' : 'off') }}
      bypass={{
        isBypassed,
        onToggle: (entity) => (isBypassed(entity) ? unbypass(entity) : bypass(entity)),
      }}
    />
  );
}
