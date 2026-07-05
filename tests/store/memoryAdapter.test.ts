import { describe, expect, it } from 'vitest';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import type { StoredEntity } from '../../src/store/adapter.js';

const sample: StoredEntity = {
  meta: { amount: 2, fieldsHash: { id: 'abc' } },
  records: [{ id: 1, _seed: true }, { id: 2, _seed: true }],
};

describe('MemoryStoreAdapter', () => {
  it('returns undefined for an entity that was never saved', async () => {
    const store = new MemoryStoreAdapter();
    expect(await store.load('user')).toBeUndefined();
  });

  it('round-trips saved data', async () => {
    const store = new MemoryStoreAdapter();
    await store.save('user', sample);
    expect(await store.load('user')).toEqual(sample);
  });

  it('returns independent copies, not references to internal state', async () => {
    const store = new MemoryStoreAdapter();
    await store.save('user', sample);
    const loaded = await store.load('user');
    loaded!.records.push({ id: 999 });
    expect((await store.load('user'))!.records).toHaveLength(2);
  });

  it('listEntities reflects saved entities', async () => {
    const store = new MemoryStoreAdapter();
    await store.save('user', sample);
    await store.save('blogpost', sample);
    expect((await store.listEntities()).sort()).toEqual(['blogpost', 'user']);
  });

  it('deleteEntity removes only the named entity', async () => {
    const store = new MemoryStoreAdapter();
    await store.save('user', sample);
    await store.save('blogpost', sample);
    await store.deleteEntity('user');
    expect(await store.load('user')).toBeUndefined();
    expect(await store.load('blogpost')).toEqual(sample);
  });

  it('deleteEntity is a no-op for an entity that was never saved', async () => {
    const store = new MemoryStoreAdapter();
    await expect(store.deleteEntity('never-existed')).resolves.toBeUndefined();
  });

  it('reset clears everything', async () => {
    const store = new MemoryStoreAdapter();
    await store.save('user', sample);
    await store.reset();
    expect(await store.load('user')).toBeUndefined();
    expect(await store.listEntities()).toEqual([]);
  });
});
