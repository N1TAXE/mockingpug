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

describe('generateAll : fixtures', () => {
  function categorySchemas(amount: number, fixtures?: Array<Record<string, unknown>>): SchemaBundle {
    return {
      category: {
        name: 'category',
        file: 'mock/api/category/schema.json',
        amount,
        data: { id: increment, name: lorem, slug: lorem },
        ...(fixtures ? { fixtures } : {}),
      },
    };
  }

  const curated = [
    { name: 'VKontakte', slug: 'vk' },
    { name: 'Steam', slug: 'steam-keys' },
  ];

  it('applies fixtures positionally, leaving unlisted fields schema-generated', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(5, curated), store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({ name: 'VKontakte', slug: 'vk' });
    expect(records[1]).toMatchObject({ name: 'Steam', slug: 'steam-keys' });
    expect(records[0]!.id).toBe(1);
    // Records beyond the fixture list are fully schema-generated.
    for (let i = 2; i < 5; i++) {
      expect(records[i]!.name).toBeTypeOf('string');
      expect(curated.some((f) => f.slug === records[i]!.slug)).toBe(false);
    }
  });

  it('marks fixture-covered records as _seed: false', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(5, curated), store, { seed: 's' });
    const records = (await store.load('category'))!.records;
    expect(records[0]!._seed).toBe(false);
    expect(records[1]!._seed).toBe(false);
  });

  it('fixture values survive a later, unrelated field-type change (the curated-catalog regression)', async () => {
    const store = new MemoryStoreAdapter();
    const base = categorySchemas(5, curated);
    await generateAll(base, store, { seed: 's' });

    // Changing "id" from increment to uuid is unrelated to "name"/"slug",
    // but the old bug regenerated every field on every record regardless.
    const changed: SchemaBundle = {
      category: { ...base.category!, data: { ...base.category!.data, id: { kind: 'uuid' } } },
    };
    await generateAll(changed, store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records[0]).toMatchObject({ name: 'VKontakte', slug: 'vk' });
    expect(records[1]).toMatchObject({ name: 'Steam', slug: 'steam-keys' });
  });

  it('a fixture wins even when the schema field it overrides also changes type', async () => {
    const store = new MemoryStoreAdapter();
    const base = categorySchemas(5, curated);
    await generateAll(base, store, { seed: 's' });

    // "slug" itself changes generator type; the fixture's literal slug must
    // still win over whatever the new generator would have produced.
    const changed: SchemaBundle = {
      category: { ...base.category!, data: { ...base.category!.data, slug: { kind: 'uuid' } } },
    };
    await generateAll(changed, store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records[0]!.slug).toBe('vk');
    expect(records[1]!.slug).toBe('steam-keys');
    // Non-fixture records DO pick up the new generator type.
    expect(records[2]!.slug).not.toBe(records[2]!.name);
  });

  it('editing the fixtures array itself is picked up on the next generate', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(5, curated), store, { seed: 's' });

    const relabeled = categorySchemas(5, [{ name: 'VK', slug: 'vk' }, { name: 'Steam', slug: 'steam-keys' }]);
    await generateAll(relabeled, store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records[0]!.name).toBe('VK');
  });

  it('is a no-op when neither the schema nor the fixtures changed', async () => {
    const store = new MemoryStoreAdapter();
    const schemas = categorySchemas(5, curated);
    await generateAll(schemas, store, { seed: 's' });
    const before = await store.load('category');

    const summary = await generateAll(schemas, store, { seed: 's' });
    const after = await store.load('category');

    expect(summary.entities[0]).toMatchObject({ skipped: true });
    expect(after).toEqual(before);
  });

  it('amount growth beyond fixtures.length still generates the extra records normally', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(2, curated), store, { seed: 's' });
    await generateAll(categorySchemas(6, curated), store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records).toHaveLength(6);
    expect(records[0]).toMatchObject({ name: 'VKontakte', slug: 'vk' });
    expect(records[1]).toMatchObject({ name: 'Steam', slug: 'steam-keys' });
  });
});

describe('generateAll : literal', () => {
  function categorySchemas(amount: number, literal?: Array<Record<string, unknown>>): SchemaBundle {
    return {
      category: {
        name: 'category',
        file: 'mock/api/category/schema.json',
        amount,
        data: { id: increment, name: lorem, slug: lorem },
        ...(literal ? { literal } : {}),
      },
    };
  }

  const curated = [
    { id: 1, name: 'VKontakte', slug: 'vk' },
    { id: 2, name: 'Steam', slug: 'steam-keys' },
  ];

  it('places literal records verbatim at the head, leaving the rest schema-generated', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(5, curated), store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({ id: 1, name: 'VKontakte', slug: 'vk' });
    expect(records[1]).toMatchObject({ id: 2, name: 'Steam', slug: 'steam-keys' });
    for (let i = 2; i < 5; i++) {
      expect(records[i]!.name).toBeTypeOf('string');
      expect(curated.some((r) => r.slug === records[i]!.slug)).toBe(false);
    }
  });

  it('marks literal-covered records as _seed: false', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(5, curated), store, { seed: 's' });
    const records = (await store.load('category'))!.records;
    expect(records[0]!._seed).toBe(false);
    expect(records[1]!._seed).toBe(false);
  });

  it("generated records' increment ids don't collide with a literal-assigned id, on the very first pass", async () => {
    const store = new MemoryStoreAdapter();
    // Literal record 0 claims id 1, matching what the increment generator
    // would otherwise hand out first — the generated records must skip past
    // it immediately, not just on a subsequent pass.
    await generateAll(categorySchemas(3, [{ id: 1, name: 'Pinned', slug: 'pinned' }]), store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records).toHaveLength(3);
    const ids = records.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(1);
  });

  it('a literal record survives an unrelated field-type change', async () => {
    const store = new MemoryStoreAdapter();
    const base = categorySchemas(5, curated);
    await generateAll(base, store, { seed: 's' });

    const changed: SchemaBundle = {
      category: { ...base.category!, data: { ...base.category!.data, name: { kind: 'uuid' } } },
    };
    await generateAll(changed, store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records[0]).toMatchObject({ id: 1, name: 'VKontakte', slug: 'vk' });
    expect(records[1]).toMatchObject({ id: 2, name: 'Steam', slug: 'steam-keys' });
    // Non-literal records DO pick up the new generator type.
    expect(records[2]!.name).not.toBe(records[2]!.slug);
  });

  it('editing the literal array itself is picked up on the next generate', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(5, curated), store, { seed: 's' });

    const relabeled = categorySchemas(5, [{ id: 1, name: 'VK', slug: 'vk' }, { id: 2, name: 'Steam', slug: 'steam-keys' }]);
    await generateAll(relabeled, store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records[0]!.name).toBe('VK');
  });

  it('is a no-op when neither the schema nor literal changed', async () => {
    const store = new MemoryStoreAdapter();
    const schemas = categorySchemas(5, curated);
    await generateAll(schemas, store, { seed: 's' });
    const before = await store.load('category');

    const summary = await generateAll(schemas, store, { seed: 's' });
    const after = await store.load('category');

    expect(summary.entities[0]).toMatchObject({ skipped: true });
    expect(after).toEqual(before);
  });

  it('amount growth beyond literal.length still generates the extra records normally', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(2, curated), store, { seed: 's' });
    await generateAll(categorySchemas(6, curated), store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records).toHaveLength(6);
    expect(records[0]).toMatchObject({ id: 1, name: 'VKontakte', slug: 'vk' });
    expect(records[1]).toMatchObject({ id: 2, name: 'Steam', slug: 'steam-keys' });
  });

  it('literal.length shrinking regenerates the newly-uncovered positions instead of leaving stale content', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(categorySchemas(5, curated), store, { seed: 's' });

    // Drop the second curated entry: amount stays 5, literal shrinks to 1.
    await generateAll(categorySchemas(5, [curated[0]!]), store, { seed: 's' });
    const records = (await store.load('category'))!.records;

    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({ id: 1, name: 'VKontakte', slug: 'vk' });
    // Position 1 no longer matches the dropped literal entry.
    expect(records[1]!.slug).not.toBe('steam-keys');
  });

  it('crossRef resolution against a literal-covered target record works like any generated one', async () => {
    const store = new MemoryStoreAdapter();
    const schemas: SchemaBundle = {
      category: {
        name: 'category',
        file: 'mock/api/category/schema.json',
        amount: 3,
        data: { id: increment, name: lorem },
        literal: [{ id: 1, name: 'Pinned Category' }],
      },
      product: {
        name: 'product',
        file: 'mock/api/product/schema.json',
        amount: 3,
        data: { id: increment, categoryId: { kind: 'crossRef', entity: 'category', field: 'id' } },
      },
    };
    await generateAll(schemas, store, { seed: 's' });
    const categoryIds = (await store.load('category'))!.records.map((r) => r.id);
    const products = (await store.load('product'))!.records;

    for (const product of products) {
      expect(categoryIds).toContain(product.categoryId);
    }
  });

  it('rejects literal.length greater than amount at parse time', async () => {
    const { parseEntitySchema, SchemaError } = await import('../../src/core/index.js');
    try {
      parseEntitySchema('category', 'mock/api/category/schema.json', {
        amount: 1,
        data: { id: 'number.increment' },
        literal: [{ id: 1 }, { id: 2 }],
      });
      expect.unreachable();
    } catch (error) {
      expect((error as InstanceType<typeof SchemaError>).code).toBe('MP-SCHEMA-019');
    }
  });

  it('rejects a non-array-of-objects literal at parse time', async () => {
    const { parseEntitySchema, SchemaError } = await import('../../src/core/index.js');
    try {
      parseEntitySchema('category', 'mock/api/category/schema.json', {
        amount: 5,
        data: { id: 'number.increment' },
        literal: 'nope',
      });
      expect.unreachable();
    } catch (error) {
      expect((error as InstanceType<typeof SchemaError>).code).toBe('MP-SCHEMA-018');
    }
  });
});

/** article: title generated first, slug derived from it via slugify. */
function articleSchemas(amount: number): SchemaBundle {
  return {
    article: {
      name: 'article',
      file: 'mock/api/article/schema.json',
      amount,
      data: {
        id: { kind: 'uuid' },
        title: lorem,
        slug: { kind: 'slugify', field: 'title', separator: '-' },
      },
    },
  };
}

describe('generateAll : slugify', () => {
  it('derives the field from the already-generated sibling field', async () => {
    const store = new MemoryStoreAdapter();
    await generateAll(articleSchemas(20), store, { seed: 's' });
    const records = (await store.load('article'))!.records;

    for (const record of records) {
      expect(record.slug).toBe(String(record.title).toLowerCase().trim().replace(/\s+/g, '-'));
    }
  });

  it('regenerates the slug when only the slugify field is added later', async () => {
    const store = new MemoryStoreAdapter();
    const withoutSlug: SchemaBundle = {
      article: {
        name: 'article',
        file: 'mock/api/article/schema.json',
        amount: 5,
        data: { id: { kind: 'uuid' }, title: lorem },
      },
    };
    await generateAll(withoutSlug, store, { seed: 's' });
    const before = (await store.load('article'))!.records;

    await generateAll(articleSchemas(5), store, { seed: 's' });
    const after = (await store.load('article'))!.records;

    expect(after[0]!.title).toBe(before[0]!.title);
    expect(after[0]!.slug).toBe(String(after[0]!.title).toLowerCase().trim().replace(/\s+/g, '-'));
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
