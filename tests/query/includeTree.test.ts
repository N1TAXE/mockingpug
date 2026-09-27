import { beforeAll, describe, expect, it } from 'vitest';
import { executeRoute } from '../../src/query/executeRoute.js';
import { matchRoute, type Route } from '../../src/core/routes.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/resolver.js';

// section 1 → categories 1,2 → each with groups. Exercises the batched,
// depth-2 include resolution (one load + index per table, sliced back per parent).
const schemas: SchemaBundle = {
  section: { name: 'section', file: 'x', amount: 2, data: { id: { kind: 'number', mode: 'increment' } } },
  category: { name: 'category', file: 'x', amount: 6, data: { id: { kind: 'number', mode: 'increment' }, section_id: { kind: 'crossRef', entity: 'section', field: 'id' } } },
  group: { name: 'group', file: 'x', amount: 20, data: { id: { kind: 'number', mode: 'increment' }, category_id: { kind: 'crossRef', entity: 'category', field: 'id' } } },
};

let ctx: QueryContext;
beforeAll(async () => {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'tree' });
  ctx = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'tree' };
});

describe('nested include tree (batched resolution)', () => {
  const routes: Route[] = [
    {
      id: 'section-tree',
      kind: 'one',
      method: 'GET',
      path: '/sections/:id',
      from: 'section',
      where: { id: ':id' },
      include: { categories: { from: 'category', by: 'section_id', select: ['id'], include: { groups: { from: 'group', by: 'category_id', select: ['id', 'category_id'] } } } },
    },
  ];

  it('resolves two levels deep, each category getting only its own groups', async () => {
    const match = matchRoute('GET', '/api/sections/1', routes)!;
    const body = (await executeRoute(match, new Request('http://localhost/api/sections/1'), ctx).then((r) => r.json())) as {
      id: number;
      categories: Array<{ id: number; groups: Array<{ id: number; category_id: number }> }>;
    };

    expect(body.id).toBe(1);
    expect(body.categories.length).toBeGreaterThan(0);
    // The whole store, to cross-check the mock's own joins.
    const allCats = (await ctx.store.load('category'))!.records.filter((c) => c.section_id === 1);
    const allGroups = (await ctx.store.load('group'))!.records;
    expect(body.categories.map((c) => c.id).sort()).toEqual(allCats.map((c) => c.id).sort());
    for (const cat of body.categories) {
      const expected = allGroups.filter((g) => g.category_id === cat.id).map((g) => g.id).sort();
      expect(cat.groups.map((g) => g.id).sort()).toEqual(expected); // sliced back to the right parent
      expect(cat.groups.every((g) => g.category_id === cat.id)).toBe(true);
    }
  });
});
