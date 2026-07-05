import { describe, expect, it } from 'vitest';
import { createRecord, deleteRecord, getRecordById, listRecords, updateRecord, type QueryContext } from '../../src/query/resolver.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/index.js';
import { RequestError, type FieldSpec } from '../../src/core/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';

const increment: FieldSpec = { kind: 'number', mode: 'increment' };
const lorem: FieldSpec = { kind: 'lorem', length: 16 };

function userBlogpostSchemas(userAmount: number, blogpostAmount: number): SchemaBundle {
  return {
    user: {
      name: 'user',
      file: 'mock/api/user/schema.json',
      amount: userAmount,
      data: {
        id: increment,
        name: { kind: 'username', style: 'FS' },
        email: { kind: 'email', domain: 'gmail.com' },
        posts: { kind: 'crossRef', entity: 'blogpost' },
      },
    },
    blogpost: {
      name: 'blogpost',
      file: 'mock/api/blogpost/schema.json',
      amount: blogpostAmount,
      data: {
        id: { kind: 'uuid' },
        title: lorem,
        author: { kind: 'crossRef', entity: 'user', field: 'id' },
      },
    },
  };
}

async function makeContext(userAmount: number, blogpostAmount: number): Promise<QueryContext> {
  const schemas = userBlogpostSchemas(userAmount, blogpostAmount);
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'resolver-test' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'resolver-test' };
}

describe('listRecords', () => {
  it('returns sanitized records (no _seed/_index) with pagination meta', async () => {
    const ctx = await makeContext(25, 5);
    const result = await listRecords('user', new URLSearchParams(), ctx);
    expect(result.data).toHaveLength(20);
    expect(result.meta).toMatchObject({ total: 25, page: 1, limit: 20 });
    for (const record of result.data) {
      expect('_seed' in record).toBe(false);
      expect('_index' in record).toBe(false);
    }
  });

  it('resolves the bare relation field ("posts") as a live join, not stored data', async () => {
    const ctx = await makeContext(3, 20);
    const result = await listRecords('user', new URLSearchParams('limit=3'), ctx);
    const totalPosts = result.data.reduce((sum, u) => sum + (u.posts as unknown[]).length, 0);
    expect(totalPosts).toBe(20);
    for (const user of result.data) {
      for (const post of user.posts as Record<string, unknown>[]) {
        expect(post.author).toBe(user.id);
        expect('_seed' in post).toBe(false);
      }
    }
  });

  it('throws RequestError (404) for an unknown entity', async () => {
    const ctx = await makeContext(1, 1);
    await expect(listRecords('nope', new URLSearchParams(), ctx)).rejects.toMatchObject({
      code: 'MP-REQ-001',
      status: 404,
    });
  });

  it('returns an empty list for an entity with amount: 0', async () => {
    const ctx = await makeContext(0, 0);
    const result = await listRecords('user', new URLSearchParams(), ctx);
    expect(result.data).toEqual([]);
  });

  it('returns an empty list for an entity that was never generated into the store', async () => {
    const schemas = userBlogpostSchemas(5, 5);
    const ctx: QueryContext = { schemas, store: new MemoryStoreAdapter(), pagination: DEFAULT_CONFIG.pagination, seed: 's' };
    const result = await listRecords('user', new URLSearchParams(), ctx);
    expect(result.data).toEqual([]);
    expect(result.meta).toMatchObject({ total: 0 });
  });

  it('skips a bare relation whose target entity is absent from ctx.schemas', async () => {
    const ctx = await makeContext(2, 3);
    delete (ctx.schemas as Record<string, unknown>).blogpost;
    const result = await listRecords('user', new URLSearchParams(), ctx);
    expect(result.data[0]!.posts).toBeUndefined();
  });
});

describe('getRecordById', () => {
  it('finds a record by its id field', async () => {
    const ctx = await makeContext(5, 0);
    const record = await getRecordById('user', '1', ctx);
    expect(record.id).toBe(1);
  });

  it('throws RequestError (404) when the id does not exist', async () => {
    const ctx = await makeContext(5, 0);
    await expect(getRecordById('user', '999', ctx)).rejects.toMatchObject({ code: 'MP-REQ-002', status: 404 });
  });

  it('throws RequestError (404) for an entity that was never generated into the store', async () => {
    const schemas = userBlogpostSchemas(0, 0);
    const ctx: QueryContext = { schemas, store: new MemoryStoreAdapter(), pagination: DEFAULT_CONFIG.pagination, seed: 's' };
    await expect(getRecordById('user', '1', ctx)).rejects.toMatchObject({ code: 'MP-REQ-002' });
  });
});

describe('createRecord', () => {
  it('generates a fully-formed record and appends it, continuing the increment id', async () => {
    const ctx = await makeContext(3, 0);
    const created = await createRecord('user', {}, ctx);
    expect(created.id).toBe(4);
    expect(typeof created.name).toBe('string');
    expect(typeof created.email).toBe('string');

    const list = await listRecords('user', new URLSearchParams(), ctx);
    expect(list.meta).toMatchObject({ total: 4 });
  });

  it('lets the request body override generated fields', async () => {
    const ctx = await makeContext(1, 0);
    const created = await createRecord('user', { name: 'Custom Name' }, ctx);
    expect(created.name).toBe('Custom Name');
  });

  it('marks a created record as manual (_seed: false) internally', async () => {
    const ctx = await makeContext(1, 0);
    await createRecord('user', {}, ctx);
    const stored = await ctx.store.load('user');
    expect(stored!.records[1]!._seed).toBe(false);
  });

  it('strips attempts to set internal _seed/_index fields from the request body', async () => {
    const ctx = await makeContext(1, 0);
    await createRecord('user', { _seed: true, _index: 9999 }, ctx);
    const stored = await ctx.store.load('user');
    expect(stored!.records[1]!._seed).toBe(false);
    expect(stored!.records[1]!._index).toBe(1);
  });

  it('resolves a field-level cross-ref (author) against existing target records', async () => {
    const ctx = await makeContext(3, 0);
    const created = await createRecord('blogpost', {}, ctx);
    expect([1, 2, 3]).toContain(created.author);
  });

  it('ignores a non-object body', async () => {
    const ctx = await makeContext(1, 0);
    const created = await createRecord('user', 'not an object', ctx);
    expect(typeof created.name).toBe('string');
  });

  it('throws RequestError (404) for an unknown entity', async () => {
    const ctx = await makeContext(1, 0);
    await expect(createRecord('nope', {}, ctx)).rejects.toMatchObject({ code: 'MP-REQ-001' });
  });

  it('creates the first record for an entity that was never generated into the store', async () => {
    const schemas = userBlogpostSchemas(0, 0);
    const ctx: QueryContext = { schemas, store: new MemoryStoreAdapter(), pagination: DEFAULT_CONFIG.pagination, seed: 's' };
    const created = await createRecord('user', {}, ctx);
    expect(created.id).toBe(1);
  });
});

describe('updateRecord', () => {
  it('merges the body over the existing record', async () => {
    const ctx = await makeContext(3, 0);
    const updated = await updateRecord('user', '2', { name: 'Renamed' }, ctx);
    expect(updated.name).toBe('Renamed');
    expect(updated.id).toBe(2);
  });

  it('persists the update', async () => {
    const ctx = await makeContext(3, 0);
    await updateRecord('user', '2', { name: 'Renamed' }, ctx);
    const record = await getRecordById('user', '2', ctx);
    expect(record.name).toBe('Renamed');
  });

  it('throws RequestError (404) when the id does not exist', async () => {
    const ctx = await makeContext(3, 0);
    await expect(updateRecord('user', '999', { name: 'x' }, ctx)).rejects.toMatchObject({
      code: 'MP-REQ-002',
      status: 404,
    });
  });

  it('throws RequestError (404) for an entity that was never generated into the store', async () => {
    const schemas = userBlogpostSchemas(0, 0);
    const ctx: QueryContext = { schemas, store: new MemoryStoreAdapter(), pagination: DEFAULT_CONFIG.pagination, seed: 's' };
    await expect(updateRecord('user', '1', { name: 'x' }, ctx)).rejects.toMatchObject({ code: 'MP-REQ-002' });
  });

  it('cannot overwrite internal _seed/_index via the body', async () => {
    const ctx = await makeContext(3, 0);
    await updateRecord('user', '1', { _seed: false, _index: 999 }, ctx);
    const stored = await ctx.store.load('user');
    const record = stored!.records.find((r) => r.id === 1)!;
    expect(record._index).toBe(0);
  });
});

describe('deleteRecord', () => {
  it('removes the record', async () => {
    const ctx = await makeContext(3, 0);
    await deleteRecord('user', '2', ctx);
    await expect(getRecordById('user', '2', ctx)).rejects.toThrow(RequestError);
    const list = await listRecords('user', new URLSearchParams(), ctx);
    expect(list.meta).toMatchObject({ total: 2 });
  });

  it('throws RequestError (404) when the id does not exist', async () => {
    const ctx = await makeContext(3, 0);
    await expect(deleteRecord('user', '999', ctx)).rejects.toMatchObject({ code: 'MP-REQ-002', status: 404 });
  });

  it('throws RequestError (404) for an entity that was never generated into the store', async () => {
    const schemas = userBlogpostSchemas(0, 0);
    const ctx: QueryContext = { schemas, store: new MemoryStoreAdapter(), pagination: DEFAULT_CONFIG.pagination, seed: 's' };
    await expect(deleteRecord('user', '1', ctx)).rejects.toMatchObject({ code: 'MP-REQ-002' });
  });
});
