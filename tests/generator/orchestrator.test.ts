import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAll, type SchemaBundle } from '../../src/generator/orchestrator.js';
import { MemoryStoreAdapter, FileStoreAdapter } from '../../src/store/index.js';
import { DependencyError, type FieldSpec } from '../../src/core/index.js';

const increment: FieldSpec = { kind: 'number', mode: 'increment' };
const lorem: FieldSpec = { kind: 'lorem', length: 16 };

/** Mirrors mock/api/user/schema.json + mock/api/blogpost/schema.json + mock/data/role.json. */
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
        role: { kind: 'custom', name: 'role' },
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

const roleDictionary = [
  { value: 'ADMIN', max: 5 },
  { value: 'USER', chance: 0.9 },
  { value: 'MODER', chance: 0.2 },
];

describe('generateAll : fresh generation (real mock/ example)', () => {
  it('generates records for both entities and resolves field-level cross-refs', async () => {
    const store = new MemoryStoreAdapter();
    const summary = await generateAll(userBlogpostSchemas(20, 50), store, {
      seed: 'test-seed',
      customDictionaries: { role: roleDictionary },
    });

    expect(summary.entities.map((e) => e.entity)).toEqual(['user', 'blogpost']);
    expect(summary.entities[0]).toMatchObject({ skipped: false, recordCount: 20 });
    expect(summary.entities[1]).toMatchObject({ skipped: false, recordCount: 50 });

    const users = (await store.load('user'))!.records;
    const blogposts = (await store.load('blogpost'))!.records;

    const userIds = new Set(users.map((u) => u.id));
    for (const post of blogposts) {
      expect(userIds).toContain(post.author);
    }
  });

  it('does NOT materialize the bare relation field ("posts") on stored records', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(userBlogpostSchemas(5, 5), store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const users = (await store.load('user'))!.records;
    for (const user of users) {
      expect('posts' in user).toBe(false);
    }
  });

  it('respects a custom dictionary\'s "max" cap across the whole entity', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(userBlogpostSchemas(200, 10), store, {
      seed: 's',
      customDictionaries: { role: roleDictionary },
    });
    const users = (await store.load('user'))!.records;
    const adminCount = users.filter((u) => u.role === 'ADMIN').length;
    expect(adminCount).toBeLessThanOrEqual(5);
  });

  it('is deterministic: two fresh runs with the same seed produce identical records', async () => {
    const storeA = new MemoryStoreAdapter();
    const storeB = new MemoryStoreAdapter();
    const schemas = userBlogpostSchemas(10, 10);
    await generateAll(schemas, storeA, { seed: 'fixed', customDictionaries: { role: roleDictionary } });
    await generateAll(schemas, storeB, { seed: 'fixed', customDictionaries: { role: roleDictionary } });
    expect(await storeA.load('user')).toEqual(await storeB.load('user'));
  });

  it('propagates DependencyError for an unknown entity reference', async () => {
    const schemas: SchemaBundle = {
      blogpost: { name: 'blogpost', file: 'x', amount: 1, data: { author: { kind: 'crossRef', entity: 'usre', field: 'id' } } },
    };
    await expect(generateAll(schemas, new MemoryStoreAdapter(), { seed: 's' })).rejects.toThrow(DependencyError);
  });

  it('propagates DependencyError for a genuine field-ref cycle', async () => {
    const schemas: SchemaBundle = {
      a: { name: 'a', file: 'x', amount: 1, data: { bRef: { kind: 'crossRef', entity: 'b', field: 'id' } } },
      b: { name: 'b', file: 'y', amount: 1, data: { aRef: { kind: 'crossRef', entity: 'a', field: 'id' } } },
    };
    await expect(generateAll(schemas, new MemoryStoreAdapter(), { seed: 's' })).rejects.toThrow(DependencyError);
  });
});

describe('generateAll : reconciliation', () => {
  it('is a no-op when the schema is unchanged: records are byte-for-byte identical and reported as skipped', async () => {
    const store = new MemoryStoreAdapter();
    const schemas = userBlogpostSchemas(10, 10);
    await generateAll(schemas, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const before = await store.load('user');

    const summary = await generateAll(schemas, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const after = await store.load('user');

    expect(summary.entities.find((e) => e.entity === 'user')).toMatchObject({ skipped: true });
    expect(after).toEqual(before);
  });

  it('amount increase appends new records and keeps existing ones untouched, continuing increment ids', async () => {
    const store = new MemoryStoreAdapter();
    const grow = { role: roleDictionary };
    await generateAll(userBlogpostSchemas(10, 0), store, { seed: 's', customDictionaries: grow });
    const before = (await store.load('user'))!.records;

    await generateAll(userBlogpostSchemas(15, 0), store, { seed: 's', customDictionaries: grow });
    const after = (await store.load('user'))!.records;

    expect(after).toHaveLength(15);
    expect(after.slice(0, 10)).toEqual(before);
    const ids = after.map((r) => r.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('amount decrease trims from the tail, preferring generated records over manual ones', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(userBlogpostSchemas(10, 0), store, { seed: 's', customDictionaries: { role: roleDictionary } });

    // Simulate a manual mutation (e.g. a POST) appended after generation.
    const stored = (await store.load('user'))!;
    stored.records.push({ id: 999, name: 'Manual User', email: 'manual@x.com', role: 'USER', _seed: false, _index: 10 });
    await store.save('user', stored);

    await generateAll(userBlogpostSchemas(8, 0), store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const after = (await store.load('user'))!.records;

    // amountDelta is -2 (schema amount 10 -> 8); it removes 2 *generated*
    // records from the tail (ids 9 and 10), leaving 8 generated + 1 manual = 9.
    expect(after).toHaveLength(9);
    expect(after.some((r) => r.id === 999)).toBe(true);
    expect(after.some((r) => r.id === 9)).toBe(false);
    expect(after.some((r) => r.id === 10)).toBe(false);
    expect(after.some((r) => r.id === 8)).toBe(true);
  });

  it('falls back to trimming manual records too when there are not enough generated ones left', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(userBlogpostSchemas(2, 0), store, { seed: 's', customDictionaries: { role: roleDictionary } });

    // Replace the store with all-manual records (simulating a store that's
    // mostly manual mutations) so the tail-trim runs out of generated ones.
    const stored = (await store.load('user'))!;
    for (const record of stored.records) record._seed = false;
    await store.save('user', stored);

    await generateAll(userBlogpostSchemas(0, 0), store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const after = (await store.load('user'))!.records;
    expect(after).toHaveLength(0);
  });

  it('a newly added field is backfilled on existing records without touching other fields', async () => {
    const store = new MemoryStoreAdapter();
    const baseSchemas = userBlogpostSchemas(10, 0);
    await generateAll(baseSchemas, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const before = (await store.load('user'))!.records;

    const withBio: SchemaBundle = {
      ...baseSchemas,
      user: { ...baseSchemas.user!, data: { ...baseSchemas.user!.data, bio: lorem } },
    };
    await generateAll(withBio, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const after = (await store.load('user'))!.records;

    expect(after).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(after[i]!.bio).toBeTypeOf('string');
      expect(after[i]!.id).toBe(before[i]!.id);
      expect(after[i]!.email).toBe(before[i]!.email);
    }
  });

  it('a removed field is stripped from every existing record', async () => {
    const store = new MemoryStoreAdapter();
    const baseSchemas = userBlogpostSchemas(5, 0);
    await generateAll(baseSchemas, store, { seed: 's', customDictionaries: { role: roleDictionary } });

    const { role, ...rest } = baseSchemas.user!.data;
    void role;
    const withoutRole: SchemaBundle = { ...baseSchemas, user: { ...baseSchemas.user!, data: rest } };
    await generateAll(withoutRole, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const after = (await store.load('user'))!.records;

    for (const record of after) {
      expect('role' in record).toBe(false);
    }
  });

  it('a field whose type changed is regenerated for every record, other fields stay stable', async () => {
    const store = new MemoryStoreAdapter();
    const baseSchemas = userBlogpostSchemas(10, 0);
    await generateAll(baseSchemas, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const before = (await store.load('user'))!.records;

    const withCompanyEmail: SchemaBundle = {
      ...baseSchemas,
      user: {
        ...baseSchemas.user!,
        data: { ...baseSchemas.user!.data, email: { kind: 'email', domain: 'company.com' } },
      },
    };
    await generateAll(withCompanyEmail, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const after = (await store.load('user'))!.records;

    for (let i = 0; i < 10; i++) {
      expect(after[i]!.id).toBe(before[i]!.id);
      expect(after[i]!.name).toBe(before[i]!.name);
      expect(after[i]!.email).toMatch(/@company\.com$/);
    }
  });

  it('reports orphaned entities that exist in the store but no longer have a schema', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(userBlogpostSchemas(3, 3), store, { seed: 's', customDictionaries: { role: roleDictionary } });

    // "blogpost" is removed from the schema bundle entirely, including the
    // "posts" field on "user" that referenced it, since a dangling reference
    // to a deleted entity is a schema error (MP-DEP-001), not an orphan.
    const fullSchemas = userBlogpostSchemas(3, 3);
    const { posts, ...userFieldsWithoutPosts } = fullSchemas.user!.data;
    void posts;
    const onlyUser: SchemaBundle = {
      user: { ...fullSchemas.user!, data: userFieldsWithoutPosts },
    };
    const summary = await generateAll(onlyUser, store, { seed: 's', customDictionaries: { role: roleDictionary } });

    expect(summary.orphanEntities).toEqual(['blogpost']);
  });
});

describe('generateAll : end-to-end with the real FileStoreAdapter', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mockingpug-orchestrator-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists generated records to disk and reloads them unchanged on a no-op run', async () => {
    const store = new FileStoreAdapter(dir);
    const schemas = userBlogpostSchemas(5, 5);
    await generateAll(schemas, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const first = await store.load('user');

    const summary = await generateAll(schemas, store, { seed: 's', customDictionaries: { role: roleDictionary } });
    const second = await store.load('user');

    expect(summary.entities.find((e) => e.entity === 'user')?.skipped).toBe(true);
    expect(second).toEqual(first);
  });
});
