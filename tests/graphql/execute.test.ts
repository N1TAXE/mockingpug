import { describe, expect, it } from 'vitest';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';
import { executeGraphQL, generateGraphQLSDL } from '../../src/graphql/index.js';

const schemas: SchemaBundle = {
  user: {
    name: 'user',
    file: 'x',
    amount: 2,
    data: {
      id: { kind: 'number', mode: 'increment' },
      name: { kind: 'username', style: 'FS' },
      posts: { kind: 'crossRef', entity: 'post' }, // bare relation (read-time join)
    },
  },
  post: {
    name: 'post',
    file: 'x',
    amount: 3,
    data: {
      id: { kind: 'number', mode: 'increment' },
      title: { kind: 'lorem', length: 3 },
      userId: { kind: 'crossRef', entity: 'user', field: 'id' },
    },
  },
};

async function makeCtx(): Promise<QueryContext> {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'gql' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'gql' };
}

describe('generateGraphQLSDL', () => {
  it('emits a type, list+byId query and CRUD mutations per entity', () => {
    const sdl = generateGraphQLSDL(schemas);
    expect(sdl).toContain('type User {');
    expect(sdl).toContain('posts: [Post!]'); // bare relation typed as a list
    expect(sdl).toContain('userId: Float'); // field-ref resolves to target field type
    expect(sdl).toContain('users(');
    expect(sdl).toContain('user(id: String!): User');
    expect(sdl).toContain('createUser(input: JSON): User');
    expect(sdl).toContain('deletePost(id: String!): Boolean');
  });
});

describe('executeGraphQL', () => {
  it('resolves a list query with a nested relation', async () => {
    const ctx = await makeCtx();
    const r = await executeGraphQL({ query: '{ users { id name posts { id } } }' }, ctx);
    expect(r.errors).toBeUndefined();
    const users = (r.data as { users: Array<{ id: number; posts: unknown[] }> }).users;
    expect(users).toHaveLength(2);
    expect(Array.isArray(users[0]!.posts)).toBe(true);
  });

  it('resolves a single record by id, and null when missing', async () => {
    const ctx = await makeCtx();
    const list = await executeGraphQL({ query: '{ users { id } }' }, ctx);
    const firstId = (list.data as { users: Array<{ id: number }> }).users[0]!.id;

    const hit = await executeGraphQL(
      { query: 'query($id:String!){ user(id:$id){ id name } }', variables: { id: String(firstId) } },
      ctx,
    );
    expect((hit.data as { user: { id: number } }).user.id).toBe(firstId);

    const miss = await executeGraphQL({ query: '{ user(id:"999999"){ id } }' }, ctx);
    expect((miss.data as { user: unknown }).user).toBeNull();
  });

  it('creates, updates and deletes through mutations, sharing the store with queries', async () => {
    const ctx = await makeCtx();

    const created = await executeGraphQL(
      { query: 'mutation($i:JSON){ createUser(input:$i){ id name } }', variables: { i: { name: 'Zoe' } } },
      ctx,
    );
    const newId = (created.data as { createUser: { id: number; name: string } }).createUser.id;
    expect((created.data as { createUser: { name: string } }).createUser.name).toBe('Zoe');

    const updated = await executeGraphQL(
      { query: 'mutation($id:String!,$i:JSON){ updateUser(id:$id,input:$i){ name } }', variables: { id: String(newId), i: { name: 'Zed' } } },
      ctx,
    );
    expect((updated.data as { updateUser: { name: string } }).updateUser.name).toBe('Zed');

    // The mutation wrote to the same store the query reads from.
    const after = await executeGraphQL({ query: '{ users { id } }' }, ctx);
    expect((after.data as { users: unknown[] }).users).toHaveLength(3);

    const del = await executeGraphQL(
      { query: 'mutation($id:String!){ deleteUser(id:$id) }', variables: { id: String(newId) } },
      ctx,
    );
    expect((del.data as { deleteUser: boolean }).deleteUser).toBe(true);

    const delMiss = await executeGraphQL(
      { query: 'mutation($id:String!){ deleteUser(id:$id) }', variables: { id: '999999' } },
      ctx,
    );
    expect((delMiss.data as { deleteUser: boolean }).deleteUser).toBe(false);
  });

  it('reports a GraphQL error for an unknown field instead of throwing', async () => {
    const ctx = await makeCtx();
    const r = await executeGraphQL({ query: '{ nope }' }, ctx);
    expect(r.errors?.[0]?.message).toMatch(/nope/);
  });
});
