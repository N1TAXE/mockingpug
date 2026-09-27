import { describe, expect, it } from 'vitest';
import { parseEntitySchema, matchRoute, validateRoutes, type Route, type TableFields } from '../../src/core/index.js';
import { executeRoute } from '../../src/query/executeRoute.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/resolver.js';

describe('object field (#3 nested objects)', () => {
  it('parses a plain object value as a nested object of fields', () => {
    const schema = parseEntitySchema('product', 'x', {
      amount: 1,
      data: {
        id: 'uuid',
        options: { is_top: 'boolean.1', rank: 'number.1-5' },
      },
    });
    expect(schema.data.options).toEqual({
      kind: 'object',
      fields: { is_top: { kind: 'boolean', chance: 1 }, rank: { kind: 'number', mode: 'random', min: 1, max: 5 } },
    });
  });

  it('still parses a {when,then,else} object as a conditional, not an object', () => {
    const schema = parseEntitySchema('order', 'x', {
      amount: 1,
      data: { id: 'uuid', status: 'enum[paid,pending]', paidAt: { when: { status: 'paid' }, then: 'date.past', else: null } },
    });
    expect(schema.data.paidAt!.kind).toBe('conditional');
  });

  it('generates a real nested object (recursively), deterministic from seed', async () => {
    const schemas: SchemaBundle = {
      product: {
        name: 'product',
        file: 'x',
        amount: 3,
        data: {
          id: { kind: 'number', mode: 'increment' },
          options: { kind: 'object', fields: { is_top: { kind: 'boolean', chance: 1 }, meta: { kind: 'object', fields: { rank: { kind: 'number', mode: 'random', min: 5, max: 5 } } } } },
        },
      },
    };
    const store = new MemoryStoreAdapter();
    await generateAll(schemas, store, { seed: 'obj' });
    const rec = (await store.load('product'))!.records[0]! as { options: { is_top: boolean; meta: { rank: number } } };
    expect(rec.options).toEqual({ is_top: true, meta: { rank: 5 } });
  });

  it('a dotted select picks a nested leaf; doctor accepts the path, rejects a bad one', async () => {
    const schemas: SchemaBundle = {
      product: {
        name: 'product',
        file: 'x',
        amount: 2,
        data: {
          id: { kind: 'number', mode: 'increment' },
          name: { kind: 'username', style: 'FS' },
          options: { kind: 'object', fields: { is_top: { kind: 'boolean', chance: 1 }, is_new: { kind: 'boolean', chance: 0 } } },
        },
      },
    };
    const store = new MemoryStoreAdapter();
    await generateAll(schemas, store, { seed: 'obj' });
    const ctx: QueryContext = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'obj' };

    const routes: Route[] = [{ id: 'products', kind: 'list', method: 'GET', path: '/products', from: 'product', select: ['id', 'options.is_top'] }];
    const match = matchRoute('GET', '/api/products', routes)!;
    const body = (await executeRoute(match, new Request('http://localhost/api/products'), ctx).then((r) => r.json())) as { data: Array<Record<string, unknown>> };
    // only id + the nested options.is_top leaf, name and options.is_new dropped
    expect(body.data[0]).toEqual({ id: 1, options: { is_top: true } });

    const tables: Record<string, TableFields> = { product: { data: schemas.product!.data } };
    expect(validateRoutes(routes, tables)).toEqual([]); // dotted select resolves through the object
    const bad: Route[] = [{ id: 'r', kind: 'list', method: 'GET', path: '/products', from: 'product', select: ['options.nope'] }];
    expect(validateRoutes(bad, tables).map((i) => i.code)).toEqual(['MP-ROUTE-013']);
  });
});
