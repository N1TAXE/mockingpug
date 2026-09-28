// @vitest-environment jsdom
//
// jsdom supplies the origin MSW resolves relative `/api` handler paths against.
// The `mockingpug/vue` module is framework-neutral (no React/Vue imported here);
// we verify its re-exported handlers work without starting a Service Worker
// (jsdom has none) by running them directly, as the React handler test does.
import { describe, expect, it } from 'vitest';
import { createMockHandlers, MemoryStoreAdapter, generateAll, setupMockWorker, type SchemaBundle } from '../../src/vue/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';

describe('mockingpug/vue', () => {
  it('re-exports working handlers (setupMockWorker present, worker not started in jsdom)', async () => {
    expect(typeof setupMockWorker).toBe('function');

    const schemas: SchemaBundle = {
      user: { name: 'user', file: 'x', amount: 4, data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } } },
    };
    const store = new MemoryStoreAdapter();
    await generateAll(schemas, store, { seed: 'vue' });
    const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'vue' };

    const handlers = createMockHandlers(ctx, '/api');
    const req = new Request('http://localhost:3000/api/user');
    let response: Response | null = null;
    for (const h of handlers) {
      const result = await h.run({ request: req, requestId: 'vue-test' });
      if (result?.response) {
        response = result.response;
        break;
      }
    }
    expect(response?.status).toBe(200);
    expect(((await response!.json()) as { meta: { total: number } }).meta.total).toBe(4);
  });
});
