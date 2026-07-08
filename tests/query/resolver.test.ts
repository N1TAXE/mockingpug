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

  it('filters by an exact field match on a plain query param', async () => {
    const ctx = await makeContext(25, 0);
    const result = await listRecords('user', new URLSearchParams('id=2'), ctx);
    expect(result.data.map((r) => r.id)).toEqual([2]);
    expect(result.meta).toMatchObject({ total: 1 });
  });

  it('filters with a comma-separated value as an OR/in match', async () => {
    const ctx = await makeContext(25, 0);
    const result = await listRecords('user', new URLSearchParams('id=2,4,6'), ctx);
    expect(result.data.map((r) => r.id).sort()).toEqual([2, 4, 6]);
    expect(result.meta).toMatchObject({ total: 3 });
  });

  it('unions repeated values for the same filter param', async () => {
    const ctx = await makeContext(25, 0);
    const result = await listRecords('user', new URLSearchParams('id=2,4&id=4,6'), ctx);
    expect(result.data.map((r) => r.id).sort()).toEqual([2, 4, 6]);
  });

  it('ANDs two distinct filter params together', async () => {
    const schemas: SchemaBundle = {
      product: {
        name: 'product',
        file: 'mock/api/product/schema.json',
        amount: 20,
        data: {
          id: increment,
          categoryId: { kind: 'custom', name: 'categoryId' },
          inStock: { kind: 'custom', name: 'inStock' },
        },
      },
    };
    const store = new MemoryStoreAdapter();
    await generateAll(schemas, store, {
      seed: 'and-filter-test',
      customDictionaries: {
        categoryId: [{ value: '1' }, { value: '2' }, { value: '3' }],
        inStock: [{ value: 'true' }, { value: 'false' }],
      },
    });
    const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'and-filter-test' };

    const all = await listRecords('product', new URLSearchParams('limit=1000'), ctx);
    const expectedCount = all.data.filter((r) => r.categoryId === '2' && r.inStock === 'true').length;

    const result = await listRecords('product', new URLSearchParams('categoryId=2&inStock=true'), ctx);
    expect(result.data).toHaveLength(expectedCount);
    for (const record of result.data) {
      expect(record.categoryId).toBe('2');
      expect(record.inStock).toBe('true');
    }
  });

  it('returns no records when a filter value matches nothing', async () => {
    const ctx = await makeContext(5, 0);
    const result = await listRecords('user', new URLSearchParams('id=999'), ctx);
    expect(result.data).toEqual([]);
    expect(result.meta).toMatchObject({ total: 0 });
  });

  it('searches (?q=) case-insensitively across every string field by default', async () => {
    const schemas: SchemaBundle = {
      product: {
        name: 'product',
        file: 'mock/api/product/schema.json',
        amount: 30,
        data: {
          id: increment,
          title: { kind: 'custom', name: 'title' },
        },
      },
    };
    const store = new MemoryStoreAdapter();
    await generateAll(schemas, store, {
      seed: 'search-test',
      customDictionaries: {
        title: [{ value: 'Wireless Mouse' }, { value: 'Mechanical Keyboard' }, { value: 'USB-C Hub' }],
      },
    });
    const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'search-test' };

    const all = await listRecords('product', new URLSearchParams('limit=1000'), ctx);
    const expectedCount = all.data.filter((r) => (r.title as string).toLowerCase().includes('keyboard')).length;
    expect(expectedCount).toBeGreaterThan(0);

    const result = await listRecords('product', new URLSearchParams('q=KEYBOARD'), ctx);
    expect(result.data).toHaveLength(expectedCount);
    for (const record of result.data) {
      expect((record.title as string).toLowerCase()).toContain('keyboard');
    }
  });

  it('restricts search to searchFields when given', async () => {
    const ctx = await makeContext(10, 0);
    // No user field's value contains this literal string, so an unrestricted
    // search matches nothing, confirming searchFields further narrows rather
    // than broadens the match set.
    const result = await listRecords('user', new URLSearchParams('q=@gmail.com&searchFields=name'), ctx);
    expect(result.data).toEqual([]);
  });

  it('sorts ascending by default and descending with an explicit direction', async () => {
    const ctx = await makeContext(5, 0);
    const asc = await listRecords('user', new URLSearchParams('sort=id'), ctx);
    expect(asc.data.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);

    const desc = await listRecords('user', new URLSearchParams('sort=id:desc'), ctx);
    expect(desc.data.map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it('combines filter, sort, and pagination in one request', async () => {
    const ctx = await makeContext(25, 0);
    const result = await listRecords('user', new URLSearchParams('id=2,4,6,8&sort=id:desc&limit=2'), ctx);
    expect(result.data.map((r) => r.id)).toEqual([8, 6]);
    expect(result.meta).toMatchObject({ total: 4, limit: 2 });
  });

  it('does not treat pagination or sort param names as filters', async () => {
    const ctx = await makeContext(25, 0);
    const result = await listRecords('user', new URLSearchParams('page=1&limit=5&sort=id'), ctx);
    expect(result.data).toHaveLength(5);
    expect(result.meta).toMatchObject({ total: 25 });
  });

  it('groupBy + limitPerGroup caps per-author blogposts instead of the whole batch', async () => {
    const ctx = await makeContext(3, 30);
    const authorIds = [...new Set((await listRecords('blogpost', new URLSearchParams('limit=100'), ctx)).data.map((r) => r.author))];
    expect(authorIds.length).toBeGreaterThan(1);

    const result = await listRecords(
      'blogpost',
      new URLSearchParams(`author=${authorIds.join(',')}&groupBy=author&limitPerGroup=2`),
      ctx,
    );
    expect(result.meta).toMatchObject({ strategy: 'group', groupBy: 'author', limitPerGroup: 2 });
    for (const authorId of authorIds) {
      expect(result.data.filter((r) => r.author === authorId).length).toBeLessThanOrEqual(2);
    }
    // The whole-batch flat limit would have capped total results at defaultLimit (20);
    // per-group capping instead allows up to 2 * authorIds.length.
    expect(result.data.length).toBeGreaterThan(2);
  });

  it('groupBy/limitPerGroup param names are excluded from filterRecords, same as other pagination params', async () => {
    const ctx = await makeContext(1, 5);
    const result = await listRecords('blogpost', new URLSearchParams('groupBy=author&limitPerGroup=1'), ctx);
    expect(result.data.length).toBeGreaterThan(0);
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
