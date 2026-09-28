// @vitest-environment jsdom
//
// jsdom gives MSW an origin to resolve the relative `/graphql` handler path.
import { afterEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';
import { createGraphQLHandler } from '../../src/graphql/index.js';

let server: ReturnType<typeof setupServer> | undefined;
afterEach(() => server?.close());

describe('createGraphQLHandler', () => {
  it('answers a POST /graphql request from the mock store', async () => {
    const schemas: SchemaBundle = {
      user: { name: 'user', file: 'x', amount: 3, data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } } },
    };
    const store = new MemoryStoreAdapter();
    await generateAll(schemas, store, { seed: 'gql-handler' });
    const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'gql-handler' };

    server = setupServer(createGraphQLHandler(ctx));
    server.listen({ onUnhandledRequest: 'bypass' });

    const res = await fetch('http://localhost:3000/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ users { id name } }' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { users: unknown[] } };
    expect(body.data.users).toHaveLength(3);
  });
});
