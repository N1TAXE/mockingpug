import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';
import { createRuntimeController } from '../../src/devtools-core/index.js';
import { resetBypassState } from '../../src/react/bypassState.js';

afterEach(() => resetBypassState());

const schemas: SchemaBundle = {
  user: { name: 'user', file: 'x', amount: 2, data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } } },
};

async function makeCtx(): Promise<QueryContext> {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'dt' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'dt' };
}

describe('createRuntimeController', () => {
  it('attaches runtime state to a bare ctx (so the transport records into it)', async () => {
    const ctx = await makeCtx();
    expect(ctx.requestLog).toBeUndefined();
    const rc = createRuntimeController(ctx);
    expect(ctx.requestLog).toBeDefined();
    expect(ctx.oneShotOverrides).toBeDefined();
    expect(ctx.requestBypass).toBeDefined();
    expect(rc.entities()).toEqual(['user']);
    expect(rc.getRequestLog()).toEqual([]);
  });

  it('arms one-shot fail/delay overrides', async () => {
    const rc = createRuntimeController(await makeCtx());
    rc.failNext('user');
    expect(rc.peekOverride('user')).toEqual({ failNext: true });
    rc.delayNext('user', 250);
    expect(rc.peekOverride('user')).toEqual({ failNext: true, delayNext: 250 });
  });

  it('toggles per-request bypass by METHOD + pathname', async () => {
    const rc = createRuntimeController(await makeCtx());
    rc.setRequestBypass('GET', '/api/user', true);
    expect(rc.isRequestBypassed('GET', '/api/user')).toBe(true);
    expect(rc.isRequestBypassed('GET', '/api/user/1')).toBe(false);
    expect(rc.listRequestBypass()).toEqual(['GET /api/user']);
    rc.setRequestBypass('GET', '/api/user', false);
    expect(rc.isRequestBypassed('GET', '/api/user')).toBe(false);
  });

  it('toggles entity-level runtime bypass', async () => {
    const rc = createRuntimeController(await makeCtx());
    expect(rc.isEntityBypassed('user')).toBe(false);
    rc.bypassEntity('user');
    expect(rc.isEntityBypassed('user')).toBe(true);
    rc.unbypassEntity('user');
    expect(rc.isEntityBypassed('user')).toBe(false);
  });

  it('exports and re-imports the store snapshot', async () => {
    const rc = createRuntimeController(await makeCtx());
    const snap = await rc.exportSnapshot();
    expect(Object.keys(snap)).toEqual(['user']);
    expect(snap.user!.records).toHaveLength(2);
    await rc.importSnapshot(snap); // round-trips without throwing
  });

  it('reuses an existing request log instead of replacing it', async () => {
    const ctx = await makeCtx();
    const first = createRuntimeController(ctx);
    const log = ctx.requestLog;
    const second = createRuntimeController(ctx);
    expect(ctx.requestLog).toBe(log); // ??= keeps the wired instance
    expect(second.getRequestLog()).toEqual(first.getRequestLog());
  });
});
