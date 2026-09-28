// @vitest-environment jsdom
//
// jsdom is only here to give MSW an origin to resolve the relative `/api`
// handler paths against (a real RN app fetches an absolute base URL). The
// `mockingpug/native` module itself pulls in no DOM — that's the whole point.
import { afterEach, describe, expect, it } from 'vitest';
import { setupNativeMocks, MemoryStoreAdapter, generateAll, type SchemaBundle } from '../../src/native/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';

let server: ReturnType<typeof setupNativeMocks> | undefined;
afterEach(() => server?.close());

describe('mockingpug/native', () => {
  it('setupNativeMocks serves generated data over fetch (msw/native)', async () => {
    const schemas: SchemaBundle = {
      user: { name: 'user', file: 'x', amount: 3, data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } } },
    };
    const store = new MemoryStoreAdapter();
    await generateAll(schemas, store, { seed: 'native' });
    const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'native' };

    server = setupNativeMocks(ctx, '/api');
    const res = await fetch('http://localhost:3000/api/user');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; meta: { total: number } };
    expect(body.meta.total).toBe(3);
  });
});
