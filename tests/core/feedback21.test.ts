import { describe, expect, it } from 'vitest';
import { parseEntitySchema, validateRoutes, type Route, type TableFields } from '../../src/core/index.js';
import { generateSample } from '../../src/core/generateSample.js';
import { filterRecords } from '../../src/query/filter.js';

describe('#11c enum preserves literal type', () => {
  it('numbers stay numbers, booleans booleans, words strings', () => {
    const s = parseEntitySchema('x', 'f', { amount: 1, data: { ttl: 'enum[3600,86400]', on: 'enum[true,false]', role: 'enum[ADMIN,USER]' } });
    expect(s.data.ttl).toEqual({ kind: 'enumInline', values: [3600, 86400] });
    expect(s.data.on).toEqual({ kind: 'enumInline', values: [true, false] });
    expect(s.data.role).toEqual({ kind: 'enumInline', values: ['ADMIN', 'USER'] });
  });
});

describe('#7 literal-derived fields', () => {
  it('adds fields present in every literal record but absent from data, typed by value', () => {
    const s = parseEntitySchema('pay', 'f', {
      amount: 2,
      data: { id: 'number.increment' },
      literal: [
        { id: 1, name: 'Card', fee: 2.5, active: true },
        { id: 2, name: 'Cash', fee: 0, active: false },
      ],
    });
    expect(s.data.name).toEqual({ kind: 'lorem' });
    expect(s.data.fee).toEqual({ kind: 'number', mode: 'random' });
    expect(s.data.active).toEqual({ kind: 'boolean' });
  });
});

describe('#6 correlated ref with renamed outputs', () => {
  it('maps target fields to renamed outputs from ONE picked record; doctor accepts where on them', () => {
    const sample = generateSample(
      {
        tables: {
          product: { amount: 3, data: { id: 'number.increment', name: 'username.FS', slug: 'slugify[name,-]' } },
          review: { amount: 3, data: { id: 'uuid', product: { kind: 'ref', entity: 'product', fields: { product_id: 'id', product_slug: 'slug' } } } },
        },
      },
      'review',
      { count: 3, seed: 'r' },
    );
    for (const row of sample) {
      expect(typeof row.product_id).toBe('number');
      expect(typeof row.product_slug).toBe('string');
      expect('product' in row).toBe(false); // the ref key itself is not stored
    }

    const s = parseEntitySchema('review', 'f', { amount: 1, data: { id: 'uuid', product: { kind: 'ref', entity: 'product', fields: { product_id: 'id', product_slug: 'slug' } } } });
    const tables: Record<string, TableFields> = { review: { data: s.data } };
    const routes: Route[] = [{ id: 'r', kind: 'one', method: 'GET', path: '/reviews/:slug', from: 'review', where: { product_slug: ':slug' }, select: ['id', 'product_slug'] }];
    expect(validateRoutes(routes, tables)).toEqual([]); // no false MP-ROUTE-012/013 on the renamed field
  });
});

describe('#4 include tree + #3 dotted filter', () => {
  it('validates a nested reverse include', () => {
    const tables: Record<string, TableFields> = {
      section: { data: { id: { kind: 'number', mode: 'increment' } } },
      category: { data: { id: { kind: 'number', mode: 'increment' }, section_id: { kind: 'crossRef', entity: 'section', field: 'id' } } },
      group: { data: { id: { kind: 'number', mode: 'increment' }, category_id: { kind: 'crossRef', entity: 'category', field: 'id' } } },
    };
    const good: Route[] = [{ id: 'tree', kind: 'one', method: 'GET', path: '/sections/:id', from: 'section', where: { id: ':id' }, include: { categories: { from: 'category', by: 'section_id', include: { groups: { from: 'group', by: 'category_id' } } } } }];
    expect(validateRoutes(good, tables)).toEqual([]);
    const bad: Route[] = [{ id: 'tree', kind: 'one', method: 'GET', path: '/sections/:id', from: 'section', where: { id: ':id' }, include: { categories: { from: 'category', by: 'section_id', include: { groups: { from: 'group', by: 'nope' } } } } }];
    expect(validateRoutes(bad, tables).map((i) => i.code)).toEqual(['MP-ROUTE-014']);
  });

  it('filters by a dotted path into a nested object', () => {
    const rows = [
      { id: 1, options: { is_top: true } },
      { id: 2, options: { is_top: false } },
    ];
    const out = filterRecords(rows, new URLSearchParams('options.is_top=true'), new Set());
    expect(out.map((r) => r.id)).toEqual([1]);
  });
});
