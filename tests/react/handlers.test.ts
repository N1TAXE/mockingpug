// @vitest-environment jsdom
//
// MSW resolves relative handler paths (e.g. "/api/user") against the global
// `location`. In a real browser this is always present, but Node has no
// such thing by default. Running this file's tests under jsdom instead of
// plain node matches mockingpug/react's actual target environment and lets
// relative paths resolve exactly like they will in the consuming app.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupServer } from 'msw/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockHandlers } from '../../src/react/handlers.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { FileStoreAdapter, MemoryStoreAdapter } from '../../src/store/index.js';
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
      data: {
        id: increment,
        name: { kind: 'username', style: 'FS' },
        posts: { kind: 'crossRef', entity: 'blogpost' },
      },
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
  await generateAll(schemas, store, { seed: 'handlers-test' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'handlers-test' };
}

/**
 * Resolves a request directly against a handler array, bypassing MSW's
 * server/interceptor machinery entirely: no real network call happens
 * either way. `fetch(...).rejects.toThrow()` assumes nothing is listening on
 * the target port, which doesn't hold in every environment (some sandboxes/CI
 * runners answer unrouted local connections with a response instead of
 * refusing the connection, so the fetch resolves rather than rejecting).
 * `RequestHandler.run()` is MSW's own public API for this (used internally
 * for handler composition) and returns exactly what the matching resolver
 * produced, `null` if no handler's predicate matched at all.
 */
async function resolveAgainstHandlers(handlers: ReturnType<typeof createMockHandlers>, request: Request): Promise<Response | null> {
  for (const handler of handlers) {
    const result = await handler.run({ request, requestId: 'test-request' });
    if (result) return result.response ?? null;
  }
  return null;
}

/** What `passthrough()` from `msw` actually returns; see `msw`'s own `passthrough.ts`. */
function isPassthroughResponse(response: Response | null): boolean {
  return response?.status === 302 && response.headers.get('x-msw-intention') === 'passthrough';
}

describe('createMockHandlers : end-to-end over msw/node + real fetch', () => {
  let server: ReturnType<typeof setupServer>;

  afterEach(() => {
    server?.close();
  });

  it('GET list : envelope: true returns { data, meta }', async () => {
    const ctx = await makeContext(25, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user?page=2&limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; meta: { total: number; page: number } };
    expect(body.data).toHaveLength(10);
    expect(body.meta).toMatchObject({ total: 25, page: 2 });
  });

  it('GET list : envelope: false returns a raw array + X-* headers', async () => {
    const ctx = await makeContext(25, 0);
    ctx.pagination = { ...ctx.pagination, envelope: false };
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user?limit=5');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-total-count')).toBe('25');
    expect(res.headers.get('x-limit')).toBe('5');
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(5);
  });

  it('GET /:id resolves bare relations and strips internal fields', async () => {
    const ctx = await makeContext(2, 6);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user/1');
    expect(res.status).toBe(200);
    const user = (await res.json()) as Record<string, unknown>;
    expect(user.id).toBe(1);
    expect('_seed' in user).toBe(false);
    for (const post of user.posts as Record<string, unknown>[]) {
      expect(post.author).toBe(1);
    }
  });

  it('GET list : envelope: false sets X-Offset for the offset strategy', async () => {
    const ctx = await makeContext(25, 0);
    ctx.pagination = { ...ctx.pagination, strategy: 'offset', envelope: false };
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user?offset=5&limit=5');
    expect(res.headers.get('x-offset')).toBe('5');
  });

  it('GET list : envelope: false sets X-Next-Cursor for the cursor strategy', async () => {
    const ctx = await makeContext(25, 0);
    ctx.pagination = { ...ctx.pagination, strategy: 'cursor', envelope: false };
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user?limit=10');
    expect(res.headers.get('x-next-cursor')).toBe('10');
  });

  it('GET /:id : 404 with a clean error body for an unknown id', async () => {
    const ctx = await makeContext(2, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user/999');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MP-REQ-002');
  });

  it('POST creates a record and returns 201', async () => {
    const ctx = await makeContext(2, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Created User' }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.id).toBe(3);
    expect(created.name).toBe('Created User');
  });

  it('PUT updates a record', async () => {
    const ctx = await makeContext(2, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user/1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).name).toBe('Updated');
  });

  it('PUT : 404 with a clean error body for an unknown id', async () => {
    const ctx = await makeContext(2, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user/999', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH updates a record the same way as PUT', async () => {
    const ctx = await makeContext(2, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Patched' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).name).toBe('Patched');
  });

  it('DELETE removes a record and returns 204', async () => {
    const ctx = await makeContext(2, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user/1', { method: 'DELETE' });
    expect(res.status).toBe(204);

    const check = await fetch('http://localhost:3000/api/user/1');
    expect(check.status).toBe(404);
  });

  it('DELETE : 404 with a clean error body for an unknown id', async () => {
    const ctx = await makeContext(2, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user/999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('POST : surfaces a store failure as a generic 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), 'mockingpug-handlers-post-'));
    try {
      const schemas = userBlogpostSchemas(3, 0);
      const store = new FileStoreAdapter(dir);
      await generateAll(schemas, store, { seed: 's' });
      await writeFile(join(dir, 'user.json'), '{ not valid json', 'utf-8');

      const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 's' };
      server = setupServer(...createMockHandlers(ctx, '/api'));
      server.listen({ onUnhandledRequest: 'error' });

      const res = await fetch('http://localhost:3000/api/user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(500);
    } finally {
      errorSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('an unrecognized entity route is left unhandled (no handler matches it)', async () => {
    const ctx = await makeContext(1, 0);
    const handlers = createMockHandlers(ctx, '/api');
    const request = new Request('http://localhost:3000/api/totally-unknown-entity');

    expect(await resolveAgainstHandlers(handlers, request)).toBeNull();
  });

  it('runtime.errorRate: 1 makes every request fail with a generic 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = await makeContext(3, 0);
      ctx.runtime = { errorRate: 1, delay: 0 };
      server = setupServer(...createMockHandlers(ctx, '/api'));
      server.listen({ onUnhandledRequest: 'error' });

      const res = await fetch('http://localhost:3000/api/user');
      expect(res.status).toBe(500);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('runtime.delay adds real latency to a response', async () => {
    const ctx = await makeContext(1, 0);
    ctx.runtime = { errorRate: 0, delay: 60 };
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const start = Date.now();
    const res = await fetch('http://localhost:3000/api/user');
    expect(res.status).toBe(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(55);
  });

  it('schema-level bypass:true leaves the entity unhandled (resolver returns passthrough())', async () => {
    const ctx = await makeContext(1, 0);
    ctx.schemas.user!.bypass = true;
    const handlers = createMockHandlers(ctx, '/api');
    const request = new Request('http://localhost:3000/api/user');

    expect(isPassthroughResponse(await resolveAgainstHandlers(handlers, request))).toBe(true);
  });

  it('runtime bypass()/unbypass() toggle passthrough for a specific entity', async () => {
    const { bypass, unbypass, resetBypassState } = await import('../../src/react/bypassState.js');
    const ctx = await makeContext(2, 0);
    const handlers = createMockHandlers(ctx, '/api');

    try {
      bypass('user');
      const bypassed = await resolveAgainstHandlers(handlers, new Request('http://localhost:3000/api/user'));
      expect(isPassthroughResponse(bypassed)).toBe(true);

      unbypass('user');
      const res = await resolveAgainstHandlers(handlers, new Request('http://localhost:3000/api/user'));
      expect(res?.status).toBe(200);
    } finally {
      resetBypassState();
    }
  });

  it('POST tolerates a malformed JSON body instead of crashing', async () => {
    const ctx = await makeContext(1, 0);
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    const res = await fetch('http://localhost:3000/api/user', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json',
    });
    expect(res.status).toBe(201);
  });

  it('returns a generic 500 without leaking internals on an unexpected (non-RequestError) failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), 'mockingpug-handlers-'));
    try {
      const schemas = userBlogpostSchemas(3, 0);
      const store = new FileStoreAdapter(dir);
      await generateAll(schemas, store, { seed: 's' });
      // Corrupt the store file so the next load() throws a StoreError (not a RequestError).
      await writeFile(join(dir, 'user.json'), '{ not valid json', 'utf-8');

      const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 's' };
      server = setupServer(...createMockHandlers(ctx, '/api'));
      server.listen({ onUnhandledRequest: 'error' });

      const res = await fetch('http://localhost:3000/api/user');
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { source: string } };
      expect(body.error.source).toBe('mockingpug');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records an answered request into ctx.requestLog, most-recent-first', async () => {
    const { RequestLog } = await import('../../src/query/index.js');
    const ctx = await makeContext(3, 0);
    ctx.requestLog = new RequestLog();
    server = setupServer(...createMockHandlers(ctx, '/api'));
    server.listen({ onUnhandledRequest: 'error' });

    await fetch('http://localhost:3000/api/user?page=1');
    await fetch('http://localhost:3000/api/user/999'); // 404

    const entries = ctx.requestLog.list();
    expect(entries).toHaveLength(2);
    // Most recent first: the 404 for /user/999 was the second call.
    expect(entries[0]).toMatchObject({ method: 'GET', path: '/api/user/999', status: 404 });
    expect(entries[1]).toMatchObject({ method: 'GET', path: '/api/user?page=1', status: 200 });
    expect(entries[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('does not log a bypassed (passthrough) request', async () => {
    const { RequestLog } = await import('../../src/query/index.js');
    const ctx = await makeContext(1, 0);
    ctx.requestLog = new RequestLog();
    ctx.schemas.user!.bypass = true;
    const handlers = createMockHandlers(ctx, '/api');

    await resolveAgainstHandlers(handlers, new Request('http://localhost:3000/api/user'));
    expect(ctx.requestLog.list()).toHaveLength(0);
  });
});
