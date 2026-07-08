import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNextHandlers, type NextRouteContext } from '../../src/next/handler.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/index.js';
import type { FieldSpec } from '../../src/core/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';

const increment: FieldSpec = { kind: 'number', mode: 'increment' };

function userBlogpostSchemas(userAmount: number, blogpostAmount: number): SchemaBundle {
  return {
    user: {
      name: 'user',
      file: 'mock/api/user/schema.json',
      amount: userAmount,
      data: { id: increment, name: { kind: 'username', style: 'FS' }, posts: { kind: 'crossRef', entity: 'blogpost' } },
    },
    blogpost: {
      name: 'blogpost',
      file: 'mock/api/blogpost/schema.json',
      amount: blogpostAmount,
      data: { id: { kind: 'uuid' }, author: { kind: 'crossRef', entity: 'user', field: 'id' } },
    },
  };
}

async function makeContext(userAmount: number, blogpostAmount: number): Promise<QueryContext> {
  const schemas = userBlogpostSchemas(userAmount, blogpostAmount);
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'next-handler-test' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'next-handler-test' };
}

function plainParams(mock: string[]): NextRouteContext {
  return { params: { mock } };
}

function promiseParams(mock: string[]): NextRouteContext {
  return { params: Promise.resolve({ mock }) };
}

describe('createNextHandlers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET list works with both the pre-15 (plain) and 15+ (Promise) params shapes', async () => {
    const ctx = await makeContext(25, 0);
    const handlers = createNextHandlers(ctx);

    for (const params of [plainParams(['user']), promiseParams(['user'])]) {
      const res = await handlers.GET(new Request('http://localhost/api/user?page=2&limit=10'), params);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { total: number; page: number } };
      expect(body.data).toHaveLength(10);
      expect(body.meta).toMatchObject({ total: 25, page: 2 });
    }
  });

  it('GET /:id resolves bare relations and strips internal fields', async () => {
    const ctx = await makeContext(2, 6);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.GET(new Request('http://localhost/api/user/1'), plainParams(['user', '1']));
    expect(res.status).toBe(200);
    const user = (await res.json()) as Record<string, unknown>;
    expect(user.id).toBe(1);
    expect('_seed' in user).toBe(false);
    expect((user.posts as unknown[]).length).toBeGreaterThan(0);
  });

  it('GET with no entity segment returns 404', async () => {
    const ctx = await makeContext(1, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.GET(new Request('http://localhost/api'), plainParams([]));
    expect(res.status).toBe(404);
  });

  it('GET /:id : 404 for an unknown id', async () => {
    const ctx = await makeContext(2, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.GET(new Request('http://localhost/api/user/999'), plainParams(['user', '999']));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MP-REQ-002');
  });

  it('POST creates a record and returns 201', async () => {
    const ctx = await makeContext(2, 0);
    const handlers = createNextHandlers(ctx);
    const request = new Request('http://localhost/api/user', {
      method: 'POST',
      body: JSON.stringify({ name: 'Created User' }),
    });
    const res = await handlers.POST(request, plainParams(['user']));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.id).toBe(3);
    expect(created.name).toBe('Created User');
  });

  it('POST to an entity name that has no schema returns a clean error response', async () => {
    const ctx = await makeContext(1, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.POST(new Request('http://localhost/api/nope', { method: 'POST' }), plainParams(['nope']));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MP-REQ-001');
  });

  it('POST with no entity segment returns 404', async () => {
    const ctx = await makeContext(1, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.POST(new Request('http://localhost/api', { method: 'POST' }), plainParams([]));
    expect(res.status).toBe(404);
  });

  it('PUT and PATCH both update a record', async () => {
    const ctx = await makeContext(2, 0);
    const handlers = createNextHandlers(ctx);
    for (const [method, name] of [['PUT', 'Via PUT'], ['PATCH', 'Via PATCH']] as const) {
      const request = new Request('http://localhost/api/user/1', { method, body: JSON.stringify({ name }) });
      const res = await handlers[method](request, plainParams(['user', '1']));
      expect(res.status).toBe(200);
      expect((await res.json() as Record<string, unknown>).name).toBe(name);
    }
  });

  it('PUT to an entity name that has no schema returns a clean error response', async () => {
    const ctx = await makeContext(1, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.PUT(new Request('http://localhost/api/nope/1', { method: 'PUT' }), plainParams(['nope', '1']));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MP-REQ-001');
  });

  it('PUT with no id segment returns 404', async () => {
    const ctx = await makeContext(1, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.PUT(new Request('http://localhost/api/user', { method: 'PUT' }), plainParams(['user']));
    expect(res.status).toBe(404);
  });

  it('DELETE removes a record and returns 204', async () => {
    const ctx = await makeContext(2, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.DELETE(new Request('http://localhost/api/user/1', { method: 'DELETE' }), plainParams(['user', '1']));
    expect(res.status).toBe(204);
    const check = await handlers.GET(new Request('http://localhost/api/user/1'), plainParams(['user', '1']));
    expect(check.status).toBe(404);
  });

  it('DELETE on an entity name that has no schema returns a clean error response', async () => {
    const ctx = await makeContext(1, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.DELETE(new Request('http://localhost/api/nope/1', { method: 'DELETE' }), plainParams(['nope', '1']));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MP-REQ-001');
  });

  it('DELETE with no id segment returns 404', async () => {
    const ctx = await makeContext(1, 0);
    const handlers = createNextHandlers(ctx);
    const res = await handlers.DELETE(new Request('http://localhost/api/user', { method: 'DELETE' }), plainParams(['user']));
    expect(res.status).toBe(404);
  });

  it('runtime.errorRate: 1 makes GET fail with a generic 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = await makeContext(1, 0);
      ctx.runtime = { errorRate: 1, delay: 0 };
      const handlers = createNextHandlers(ctx);
      const res = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
      expect(res.status).toBe(500);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('runtime.delay adds real latency to a response', async () => {
    const ctx = await makeContext(1, 0);
    ctx.runtime = { errorRate: 0, delay: 60 };
    const handlers = createNextHandlers(ctx);
    const start = Date.now();
    const res = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(res.status).toBe(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(55);
  });

  it('records answered requests into ctx.requestLog, most-recent-first', async () => {
    const { RequestLog } = await import('../../src/query/index.js');
    const ctx = await makeContext(2, 0);
    ctx.requestLog = new RequestLog();
    const handlers = createNextHandlers(ctx);

    await handlers.GET(new Request('http://localhost/api/user?page=1'), plainParams(['user']));
    await handlers.GET(new Request('http://localhost/api/user/999'), plainParams(['user', '999']));

    const entries = ctx.requestLog.list();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ method: 'GET', path: '/api/user/999', status: 404 });
    expect(entries[1]).toMatchObject({ method: 'GET', path: '/api/user?page=1', status: 200 });
  });

  it('records POST/PUT/DELETE requests too, but never the devtools sub-API itself', async () => {
    const { RequestLog } = await import('../../src/query/index.js');
    const ctx = await makeContext(1, 0);
    ctx.requestLog = new RequestLog();
    const handlers = createNextHandlers(ctx);

    await handlers.POST(new Request('http://localhost/api/user', { method: 'POST', body: '{}' }), plainParams(['user']));
    await handlers.PUT(
      new Request('http://localhost/api/user/1', { method: 'PUT', body: '{}' }),
      plainParams(['user', '1']),
    );
    await handlers.DELETE(new Request('http://localhost/api/user/1', { method: 'DELETE' }), plainParams(['user', '1']));
    await handlers.GET(new Request('http://localhost/api/__mockingpug'), plainParams(['__mockingpug']));

    const methods = ctx.requestLog.list().map((e) => e.method);
    expect(methods).toEqual(['DELETE', 'PUT', 'POST']);
  });

  it('a "fail next" one-shot override forces a 500 on the very next request, then falls back to normal', async () => {
    const { OneShotOverrides } = await import('../../src/query/index.js');
    const ctx = await makeContext(3, 0);
    ctx.oneShotOverrides = new OneShotOverrides();
    ctx.oneShotOverrides.set('user', { failNext: true });
    const handlers = createNextHandlers(ctx);

    const first = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(first.status).toBe(500);

    const second = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(second.status).toBe(200);
  });

  it('a "delay next" one-shot override delays only the next request and is then consumed', async () => {
    const { OneShotOverrides } = await import('../../src/query/index.js');
    const ctx = await makeContext(3, 0);
    ctx.oneShotOverrides = new OneShotOverrides();
    ctx.oneShotOverrides.set('user', { delayNext: 30 });
    const handlers = createNextHandlers(ctx);

    const start = Date.now();
    const res = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(res.status).toBe(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);

    expect(ctx.oneShotOverrides.peek('user')).toBeUndefined();
  });

  it('a one-shot override on one entity does not affect requests to another entity', async () => {
    const { OneShotOverrides } = await import('../../src/query/index.js');
    const ctx = await makeContext(3, 3);
    ctx.oneShotOverrides = new OneShotOverrides();
    ctx.oneShotOverrides.set('user', { failNext: true });
    const handlers = createNextHandlers(ctx);

    const blogpostRes = await handlers.GET(new Request('http://localhost/api/blogpost'), plainParams(['blogpost']));
    expect(blogpostRes.status).toBe(200);

    const userRes = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(userRes.status).toBe(500);
  });

  it('a bypassed item route forwards GET/PUT/PATCH/DELETE to "target" instead of answering with the mock', async () => {
    const { RequestBypass } = await import('../../src/query/index.js');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ real: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const ctx = await makeContext(3, 0);
    ctx.requestBypass = new RequestBypass();
    ctx.requestBypass.set('GET', '/api/user/1', true);
    ctx.requestBypass.set('PUT', '/api/user/1', true);
    ctx.requestBypass.set('DELETE', '/api/user/1', true);
    ctx.target = 'https://real.example.com';
    const handlers = createNextHandlers(ctx);

    const get = await handlers.GET(new Request('http://localhost/api/user/1'), plainParams(['user', '1']));
    expect(await get.json()).toEqual({ real: true });
    expect(fetchMock).toHaveBeenLastCalledWith('https://real.example.com/user/1', expect.objectContaining({ method: 'GET' }));

    const put = await handlers.PUT(new Request('http://localhost/api/user/1', { method: 'PUT' }), plainParams(['user', '1']));
    expect(await put.json()).toEqual({ real: true });

    const del = await handlers.DELETE(new Request('http://localhost/api/user/1', { method: 'DELETE' }), plainParams(['user', '1']));
    expect(await del.json()).toEqual({ real: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a bypassed collection GET (list route) forwards to "target" too, independent of any item route', async () => {
    const { RequestBypass } = await import('../../src/query/index.js');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ real: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const ctx = await makeContext(3, 0);
    ctx.requestBypass = new RequestBypass();
    ctx.requestBypass.set('GET', '/api/user', true);
    ctx.target = 'https://real.example.com';
    const handlers = createNextHandlers(ctx);

    const list = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(await list.json()).toEqual({ real: true });
    expect(fetchMock).toHaveBeenLastCalledWith('https://real.example.com/user', expect.objectContaining({ method: 'GET' }));

    const item = await handlers.GET(new Request('http://localhost/api/user/1'), plainParams(['user', '1']));
    expect(item.status).toBe(200);
    const itemBody = (await item.json()) as { id: unknown };
    expect(itemBody.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not bypass a request that was not armed, even to the same entity', async () => {
    const { RequestBypass } = await import('../../src/query/index.js');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const ctx = await makeContext(3, 0);
    ctx.requestBypass = new RequestBypass();
    ctx.requestBypass.set('GET', '/api/user/1', true);
    ctx.target = 'https://real.example.com';
    const handlers = createNextHandlers(ctx);

    const res = await handlers.GET(new Request('http://localhost/api/user/2'), plainParams(['user', '2']));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not bypass the collection GET/POST route when only an item route is bypassed', async () => {
    const { RequestBypass } = await import('../../src/query/index.js');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const ctx = await makeContext(3, 0);
    ctx.requestBypass = new RequestBypass();
    ctx.requestBypass.set('GET', '/api/user/1', true);
    ctx.target = 'https://real.example.com';
    const handlers = createNextHandlers(ctx);

    const res = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to serving the mock (with a console warning) when a request is bypassed but no "target" is configured', async () => {
    const { RequestBypass } = await import('../../src/query/index.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const ctx = await makeContext(2, 0);
    ctx.requestBypass = new RequestBypass();
    ctx.requestBypass.set('GET', '/api/user/1', true);
    // ctx.target intentionally left unset.
    const handlers = createNextHandlers(ctx);

    const res = await handlers.GET(new Request('http://localhost/api/user/1'), plainParams(['user', '1']));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: unknown };
    expect(body.id).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/api/user/1'));

    warnSpy.mockRestore();
  });
});
