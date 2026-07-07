import { describe, expect, it } from 'vitest';
import { createNextHandlers, type NextRouteContext } from '../../src/next/handler.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/index.js';
import type { FieldSpec } from '../../src/core/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';

const increment: FieldSpec = { kind: 'number', mode: 'increment' };

function userSchemas(amount: number): SchemaBundle {
  return {
    user: {
      name: 'user',
      file: 'mock/api/user/schema.json',
      amount,
      data: { id: increment, name: { kind: 'username', style: 'FS' } },
    },
  };
}

async function makeContext(amount: number): Promise<QueryContext> {
  const schemas = userSchemas(amount);
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'devtools-test' });
  return {
    schemas,
    store,
    pagination: DEFAULT_CONFIG.pagination,
    seed: 'devtools-test',
    runtime: { errorRate: 0, delay: 0 },
  };
}

function plainParams(mock: string[]): NextRouteContext {
  return { params: { mock } };
}

describe('devtools sub-API (`{baseUrl}/__mockingpug/*`)', () => {
  it('GET __mockingpug lists entity counts and the current runtime config', async () => {
    const ctx = await makeContext(5);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.GET(new Request('http://localhost/api/__mockingpug'), plainParams(['__mockingpug']));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entities: Record<string, number>; runtime: { delay: number; errorRate: number } };
    expect(body.entities).toEqual({ user: 5 });
    expect(body.runtime).toEqual({ delay: 0, errorRate: 0 });
  });

  it('GET __mockingpug/records/:entity returns up to 10 records', async () => {
    const ctx = await makeContext(25);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.GET(
      new Request('http://localhost/api/__mockingpug/records/user'),
      plainParams(['__mockingpug', 'records', 'user']),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: unknown[] };
    expect(body.records).toHaveLength(10);
  });

  it('POST __mockingpug/runtime mutates ctx.runtime in place, visible to later requests', async () => {
    const ctx = await makeContext(1);
    const handlers = createNextHandlers(ctx);

    const res = await handlers.POST(
      new Request('http://localhost/api/__mockingpug/runtime', {
        method: 'POST',
        body: JSON.stringify({ delay: 5, errorRate: 1 }),
      }),
      plainParams(['__mockingpug', 'runtime']),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delay: 5, errorRate: 1 });
    expect(ctx.runtime).toEqual({ delay: 5, errorRate: 1 });

    const failing = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(failing.status).toBe(500);
  });

  it('PUT __mockingpug/records/:entity/:id updates a record, bypassing runtime.errorRate/delay', async () => {
    const ctx = await makeContext(3);
    ctx.runtime = { errorRate: 1, delay: 0 };
    const handlers = createNextHandlers(ctx);
    const stored = await ctx.store.load('user');
    const id = String(stored!.records[0]!.id);

    const res = await handlers.PUT(
      new Request(`http://localhost/api/__mockingpug/records/user/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'Edited By Devtools' }),
      }),
      plainParams(['__mockingpug', 'records', 'user', id]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record: { name: string } };
    expect(body.record.name).toBe('Edited By Devtools');

    const after = await ctx.store.load('user');
    expect(after!.records.find((r) => String(r.id) === id)?.name).toBe('Edited By Devtools');
  });

  it('PUT __mockingpug/records/:entity/:id returns a clean 404 for an unknown id', async () => {
    const ctx = await makeContext(1);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.PUT(
      new Request('http://localhost/api/__mockingpug/records/user/999', {
        method: 'PUT',
        body: JSON.stringify({ name: 'X' }),
      }),
      plainParams(['__mockingpug', 'records', 'user', '999']),
    );
    expect(res.status).toBe(404);
  });

  it('PUT to a real entity path (no devtools segment) is unaffected by the devtools route', async () => {
    const ctx = await makeContext(2);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.PUT(
      new Request('http://localhost/api/user/1', { method: 'PUT', body: JSON.stringify({ name: 'Real Update' }) }),
      plainParams(['user', '1']),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { name: string }).toMatchObject({ name: 'Real Update' });
  });

  it('POST __mockingpug/reset/:entity wipes and regenerates one entity', async () => {
    const ctx = await makeContext(3);
    const handlers = createNextHandlers(ctx);

    await handlers.PUT(
      new Request('http://localhost/api/user/1', { method: 'PUT', body: JSON.stringify({ name: 'Mutated' }) }),
      plainParams(['user', '1']),
    );

    const res = await handlers.POST(
      new Request('http://localhost/api/__mockingpug/reset/user', { method: 'POST' }),
      plainParams(['__mockingpug', 'reset', 'user']),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: Array<{ name: string }> };
    expect(body.records).toHaveLength(3);
    expect(body.records.find((r) => r.name === 'Mutated')).toBeUndefined();
  });

  it('an unknown devtools sub-route returns 404', async () => {
    const ctx = await makeContext(1);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.GET(
      new Request('http://localhost/api/__mockingpug/nope'),
      plainParams(['__mockingpug', 'nope']),
    );
    expect(res.status).toBe(404);
  });

  it('GET __mockingpug/requests lists the recorded request log, most-recent-first', async () => {
    const { RequestLog } = await import('../../src/query/index.js');
    const ctx = await makeContext(1);
    ctx.requestLog = new RequestLog();
    const handlers = createNextHandlers(ctx);

    await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    await handlers.GET(new Request('http://localhost/api/user/999'), plainParams(['user', '999']));

    const res = await handlers.GET(
      new Request('http://localhost/api/__mockingpug/requests'),
      plainParams(['__mockingpug', 'requests']),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests: Array<{ method: string; path: string; status: number }> };
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]).toMatchObject({ method: 'GET', path: '/api/user/999', status: 404 });
  });

  it('GET __mockingpug/requests returns an empty array when ctx.requestLog is unset', async () => {
    const ctx = await makeContext(1);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.GET(
      new Request('http://localhost/api/__mockingpug/requests'),
      plainParams(['__mockingpug', 'requests']),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { requests: unknown[] }).toEqual({ requests: [] });
  });

  it('POST __mockingpug/requests/clear empties the request log', async () => {
    const { RequestLog } = await import('../../src/query/index.js');
    const ctx = await makeContext(1);
    ctx.requestLog = new RequestLog();
    const handlers = createNextHandlers(ctx);

    await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(ctx.requestLog.list()).toHaveLength(1);

    const res = await handlers.POST(
      new Request('http://localhost/api/__mockingpug/requests/clear', { method: 'POST' }),
      plainParams(['__mockingpug', 'requests', 'clear']),
    );
    expect(res.status).toBe(200);
    expect(ctx.requestLog.list()).toHaveLength(0);
  });

  it('GET __mockingpug/override/:entity returns {} when nothing is armed', async () => {
    const ctx = await makeContext(1);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.GET(
      new Request('http://localhost/api/__mockingpug/override/user'),
      plainParams(['__mockingpug', 'override', 'user']),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { override: unknown }).toEqual({ override: {} });
  });

  it('POST __mockingpug/override/:entity arms the override, visible to a later GET peek and to real requests', async () => {
    const { OneShotOverrides } = await import('../../src/query/index.js');
    const ctx = await makeContext(1);
    ctx.oneShotOverrides = new OneShotOverrides();
    const handlers = createNextHandlers(ctx);

    const postRes = await handlers.POST(
      new Request('http://localhost/api/__mockingpug/override/user', {
        method: 'POST',
        body: JSON.stringify({ failNext: true }),
      }),
      plainParams(['__mockingpug', 'override', 'user']),
    );
    expect(postRes.status).toBe(200);
    expect((await postRes.json()) as { override: unknown }).toEqual({ override: { failNext: true } });

    const peekRes = await handlers.GET(
      new Request('http://localhost/api/__mockingpug/override/user'),
      plainParams(['__mockingpug', 'override', 'user']),
    );
    expect((await peekRes.json()) as { override: unknown }).toEqual({ override: { failNext: true } });

    const userRes = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(userRes.status).toBe(500);
  });

  it('devtools override calls are never written to ctx.requestLog', async () => {
    const { RequestLog } = await import('../../src/query/index.js');
    const ctx = await makeContext(1);
    ctx.requestLog = new RequestLog();
    const handlers = createNextHandlers(ctx);

    await handlers.GET(
      new Request('http://localhost/api/__mockingpug/override/user'),
      plainParams(['__mockingpug', 'override', 'user']),
    );
    await handlers.POST(
      new Request('http://localhost/api/__mockingpug/override/user', {
        method: 'POST',
        body: JSON.stringify({ delayNext: 0 }),
      }),
      plainParams(['__mockingpug', 'override', 'user']),
    );

    expect(ctx.requestLog.list()).toHaveLength(0);
  });

  it('GET __mockingpug/snapshot returns every entity as { meta, records }', async () => {
    const ctx = await makeContext(2);
    const handlers = createNextHandlers(ctx);

    const res = await handlers.GET(
      new Request('http://localhost/api/__mockingpug/snapshot'),
      plainParams(['__mockingpug', 'snapshot']),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshot: Record<string, { records: unknown[] }> };
    expect(body.snapshot.user!.records).toHaveLength(2);
  });

  it('POST __mockingpug/snapshot restores entities and returns updated entity counts', async () => {
    const ctx = await makeContext(2);
    const handlers = createNextHandlers(ctx);

    const exportRes = await handlers.GET(
      new Request('http://localhost/api/__mockingpug/snapshot'),
      plainParams(['__mockingpug', 'snapshot']),
    );
    const { snapshot } = (await exportRes.json()) as { snapshot: Record<string, { meta: unknown; records: unknown[] }> };
    snapshot.user!.records = [{ id: 1, name: 'Imported' }, { id: 2, name: 'Imported Too' }, { id: 3, name: 'Extra' }];

    const importRes = await handlers.POST(
      new Request('http://localhost/api/__mockingpug/snapshot', { method: 'POST', body: JSON.stringify(snapshot) }),
      plainParams(['__mockingpug', 'snapshot']),
    );
    expect(importRes.status).toBe(200);
    expect((await importRes.json()) as { entities: Record<string, number> }).toEqual({ entities: { user: 3 } });

    const stored = await ctx.store.load('user');
    expect(stored!.records).toHaveLength(3);
    expect(stored!.records[2]).toMatchObject({ name: 'Extra' });
  });

  it('POST __mockingpug/snapshot silently skips entity names not in ctx.schemas', async () => {
    const ctx = await makeContext(1);
    const handlers = createNextHandlers(ctx);

    const res = await handlers.POST(
      new Request('http://localhost/api/__mockingpug/snapshot', {
        method: 'POST',
        body: JSON.stringify({ nonexistent: { meta: {}, records: [{ id: 1 }] } }),
      }),
      plainParams(['__mockingpug', 'snapshot']),
    );
    expect(res.status).toBe(200);
    expect(await ctx.store.listEntities()).not.toContain('nonexistent');
  });

  it('devtools snapshot calls are never written to ctx.requestLog', async () => {
    const { RequestLog } = await import('../../src/query/index.js');
    const ctx = await makeContext(1);
    ctx.requestLog = new RequestLog();
    const handlers = createNextHandlers(ctx);

    await handlers.GET(
      new Request('http://localhost/api/__mockingpug/snapshot'),
      plainParams(['__mockingpug', 'snapshot']),
    );
    await handlers.POST(
      new Request('http://localhost/api/__mockingpug/snapshot', { method: 'POST', body: '{}' }),
      plainParams(['__mockingpug', 'snapshot']),
    );

    expect(ctx.requestLog.list()).toHaveLength(0);
  });
});
