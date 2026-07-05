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
});
