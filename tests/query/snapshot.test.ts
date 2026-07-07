import { describe, expect, it } from 'vitest';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import { exportSnapshot, importSnapshot } from '../../src/query/snapshot.js';
import type { QueryContext } from '../../src/query/resolver.js';

const schemas: SchemaBundle = {
  user: {
    name: 'user',
    file: 'mock/api/user/schema.json',
    amount: 2,
    data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } },
  },
  blogpost: {
    name: 'blogpost',
    file: 'mock/api/blogpost/schema.json',
    amount: 3,
    data: { id: { kind: 'uuid' } },
  },
};

async function makeCtx(): Promise<QueryContext> {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'snapshot-test' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'snapshot-test' };
}

describe('exportSnapshot', () => {
  it('includes every entity in ctx.schemas with its stored meta + records', async () => {
    const ctx = await makeCtx();
    const snapshot = await exportSnapshot(ctx);

    expect(Object.keys(snapshot).sort()).toEqual(['blogpost', 'user']);
    expect(snapshot.user!.records).toHaveLength(2);
    expect(snapshot.blogpost!.records).toHaveLength(3);
    expect(snapshot.user!.meta).toBeTruthy();
  });

  it('omits an entity that has nothing stored yet', async () => {
    const store = new MemoryStoreAdapter();
    const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'empty' };

    const snapshot = await exportSnapshot(ctx);
    expect(snapshot).toEqual({});
  });
});

describe('importSnapshot', () => {
  it('round-trips: export then import into a fresh store reproduces the same records', async () => {
    const ctx = await makeCtx();
    const snapshot = await exportSnapshot(ctx);

    const freshStore = new MemoryStoreAdapter();
    const freshCtx: QueryContext = { ...ctx, store: freshStore };
    await importSnapshot(freshCtx, snapshot);

    const stored = await freshStore.load('user');
    expect(stored?.records).toEqual(snapshot.user!.records);
  });

  it('overwrites existing records for an entity present in the snapshot', async () => {
    const ctx = await makeCtx();
    const before = await ctx.store.load('user');

    await importSnapshot(ctx, {
      user: { meta: before!.meta, records: [{ id: 999, name: 'Imported User' }] },
    });

    const after = await ctx.store.load('user');
    expect(after!.records).toEqual([{ id: 999, name: 'Imported User' }]);
  });

  it('silently skips an entity name not present in ctx.schemas', async () => {
    const ctx = await makeCtx();
    await importSnapshot(ctx, {
      nonexistent: { meta: { fields: {} } as never, records: [{ id: 1 }] },
    });

    expect(await ctx.store.listEntities()).not.toContain('nonexistent');
  });
});
