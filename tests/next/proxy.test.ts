import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxyHandler } from '../../src/next/proxy.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';
import type { NextRouteContext } from '../../src/next/handler.js';

function schemas(amount: number): SchemaBundle {
  return {
    user: {
      name: 'user',
      file: 'mock/api/user/schema.json',
      amount,
      data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } },
    },
  };
}

async function makeContext(amount: number): Promise<QueryContext> {
  const store = new MemoryStoreAdapter();
  const bundle = schemas(amount);
  await generateAll(bundle, store, { seed: 'proxy-test' });
  return { schemas: bundle, store, pagination: DEFAULT_CONFIG.pagination, seed: 'proxy-test' };
}

function plainParams(mock: string[]): NextRouteContext {
  return { params: { mock } };
}

describe('createProxyHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('serves mock data when shouldMock() returns true', async () => {
    const ctx = await makeContext(3);
    const handlers = createProxyHandler({ ctx, target: 'https://real.example.com', shouldMock: () => true });
    const res = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(3);
  });

  it('defaults shouldMock to process.env.MOCK_MODE === "mock"', async () => {
    vi.stubEnv('MOCK_MODE', 'mock');
    const ctx = await makeContext(1);
    const handlers = createProxyHandler({ ctx, target: 'https://real.example.com' });
    const res = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('forwards to target when shouldMock() returns false, stripping hop-by-hop request headers', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ real: true }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-custom': 'yes' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const ctx = await makeContext(1);
    const handlers = createProxyHandler({ ctx, target: 'https://real.example.com', shouldMock: () => false });
    const request = new Request('http://localhost/api/user?page=1', {
      headers: { host: 'localhost', 'x-forwarded': 'yes' },
    });
    const res = await handlers.GET(request, plainParams(['user']));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe('https://real.example.com/user?page=1');
    expect(init?.method).toBe('GET');
    expect((init?.headers as Headers).get('host')).toBeNull();
    expect((init?.headers as Headers).get('x-forwarded')).toBe('yes');

    expect(res.status).toBe(200);
    expect(res.headers.get('x-custom')).toBe('yes');
    expect(await res.json()).toEqual({ real: true });
  });

  it('forwards a request body for mutating methods', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const ctx = await makeContext(1);
    const handlers = createProxyHandler({ ctx, target: 'https://real.example.com', shouldMock: () => false });
    const request = new Request('http://localhost/api/user', {
      method: 'POST',
      body: JSON.stringify({ name: 'Real Backend User' }),
    });
    const res = await handlers.POST(request, plainParams(['user']));

    expect(res.status).toBe(204);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    const sentBody = new TextDecoder().decode(init?.body as ArrayBuffer);
    expect(JSON.parse(sentBody)).toEqual({ name: 'Real Backend User' });
  });

  it('strips content-encoding/content-length from the proxied response', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('ok', {
        status: 200,
        headers: { 'content-encoding': 'gzip', 'content-length': '9999' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const ctx = await makeContext(1);
    const handlers = createProxyHandler({ ctx, target: 'https://real.example.com', shouldMock: () => false });
    const res = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));

    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
  });

  it('returns a generic 500 if the upstream fetch throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    try {
      const ctx = await makeContext(1);
      const handlers = createProxyHandler({ ctx, target: 'https://real.example.com', shouldMock: () => false });
      const res = await handlers.GET(new Request('http://localhost/api/user'), plainParams(['user']));
      expect(res.status).toBe(500);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
