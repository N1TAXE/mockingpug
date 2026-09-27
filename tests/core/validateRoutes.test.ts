import { describe, expect, it } from 'vitest';
import { validateRoutes, type Route, type TableFields } from '../../src/core/index.js';

const tables: Record<string, TableFields> = {
  order: { data: { id: { kind: 'number', mode: 'increment' }, userId: { kind: 'crossRef', entity: 'user', field: 'id' }, total: { kind: 'number', mode: 'random', min: 0, max: 9 } } },
  user: { data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } } },
  transaction: { data: { id: { kind: 'uuid' }, orderId: { kind: 'crossRef', entity: 'order', field: 'id' } } },
};

function codes(routes: Route[]): string[] {
  return validateRoutes(routes, tables).map((i) => i.code).sort();
}

describe('validateRoutes (R5 §9)', () => {
  it('accepts a well-formed set of endpoints', () => {
    const routes: Route[] = [
      { id: 'orders_list', kind: 'list', method: 'GET', path: '/orders', from: 'order', select: ['id', 'total'] },
      { id: 'order_get', kind: 'one', method: 'GET', path: '/orders/:id', from: 'order', where: { id: ':id' }, include: { user: 'userId', transactions: { from: 'transaction', by: 'orderId' } } },
      { id: 'order_pay', kind: 'mutation', method: 'POST', path: '/orders/:id/pay', response: '{"status":"paid"}' },
    ];
    expect(validateRoutes(routes, tables)).toEqual([]);
  });

  it('flags an unknown from table', () => {
    expect(codes([{ id: 'r', kind: 'list', method: 'GET', path: '/x', from: 'nope' }])).toEqual(['MP-ROUTE-011']);
  });

  it('flags where/select fields that do not exist and dangling param binds', () => {
    const routes: Route[] = [
      { id: 'r', kind: 'one', method: 'GET', path: '/orders/:id', from: 'order', where: { nope: ':id', total: ':missing' }, select: ['ghost'] },
    ];
    // nope not a field (012), total binds :missing not in path (012), ghost not selectable (013)
    expect(codes(routes)).toEqual(['MP-ROUTE-012', 'MP-ROUTE-012', 'MP-ROUTE-013']);
  });

  it('flags a bad include (non-relation FK and unknown reverse table/field)', () => {
    const routes: Route[] = [
      { id: 'r', kind: 'one', method: 'GET', path: '/orders/:id', from: 'order', where: { id: ':id' }, include: { u: 'total', t: { from: 'ghost', by: 'x' }, t2: { from: 'transaction', by: 'nope' } } },
    ];
    expect(codes(routes)).toEqual(['MP-ROUTE-014', 'MP-ROUTE-014', 'MP-ROUTE-014']);
  });

  it('flags an unused path parameter (list/one)', () => {
    expect(codes([{ id: 'r', kind: 'list', method: 'GET', path: '/orders/:id/items', from: 'order' }])).toEqual(['MP-ROUTE-016']);
  });

  it('flags a method+path conflict between two routes', () => {
    const routes: Route[] = [
      { id: 'a', kind: 'list', method: 'GET', path: '/orders', from: 'order' },
      { id: 'b', kind: 'list', method: 'GET', path: '/orders', from: 'order' },
    ];
    expect(codes(routes)).toEqual(['MP-ROUTE-010']);
  });

  it('flags a sort on a field that does not exist', () => {
    expect(codes([{ id: 'r', kind: 'list', method: 'GET', path: '/orders', from: 'order', sort: 'nope:desc' }])).toEqual(['MP-ROUTE-018']);
    expect(validateRoutes([{ id: 'ok', kind: 'list', method: 'GET', path: '/orders', from: 'order', sort: '-total,id:asc' }], tables)).toEqual([]);
  });

  it('flags a non-positive paginate limit', () => {
    expect(codes([{ id: 'r', kind: 'list', method: 'GET', path: '/orders', from: 'order', paginate: { defaultLimit: 0 } }])).toEqual(['MP-ROUTE-017']);
    expect(validateRoutes([{ id: 'ok', kind: 'list', method: 'GET', path: '/orders', from: 'order', paginate: { defaultLimit: 5, maxLimit: 50 } }], tables)).toEqual([]);
    expect(validateRoutes([{ id: 'off', kind: 'list', method: 'GET', path: '/orders', from: 'order', paginate: false }], tables)).toEqual([]);
  });

  it('validates composite slots (unknown from → MP-ROUTE-011)', () => {
    const good: Route[] = [{ id: 'c', kind: 'composite', method: 'GET', path: '/dash', shape: { u: { from: 'user' }, o: { from: 'order', first: true } } }];
    expect(validateRoutes(good, tables)).toEqual([]);
    const bad: Route[] = [{ id: 'c', kind: 'composite', method: 'GET', path: '/dash', shape: { x: { from: 'ghost' } } }];
    expect(codes(bad)).toEqual(['MP-ROUTE-011']);
  });

  it('validates action effects: unknown table, bad increment field, and a $ref used before it ran', () => {
    const badTable: Route[] = [{ id: 'a', kind: 'action', method: 'POST', path: '/a', effects: [{ op: 'insert', table: 'ghost' }], respond: { status: 200, body: {} } }];
    expect(codes(badTable)).toEqual(['MP-ROUTE-011']);

    const badRef: Route[] = [{ id: 'a', kind: 'action', method: 'POST', path: '/a', effects: [{ op: 'update', table: 'order', where: { id: '$ref.missing.id' }, set: { total: 1 } }], respond: { ref: 'nope' } }];
    expect(codes(badRef).sort()).toEqual(['MP-ROUTE-019', 'MP-ROUTE-019']); // ref-before-run + respond ref

    const ok: Route[] = [{ id: 'a', kind: 'action', method: 'POST', path: '/a', effects: [{ op: 'insert', table: 'order', name: 'o', set: { total: '$body.total' } }, { op: 'increment', table: 'order', where: { id: '$ref.o.id' }, field: 'total' }], respond: { ref: 'o' } }];
    expect(validateRoutes(ok, tables)).toEqual([]);
  });

  it('flags invalid JSON in mutation body/response', () => {
    expect(codes([{ id: 'r', kind: 'mutation', method: 'POST', path: '/pay', body: '{bad', response: 'also bad' }])).toEqual([
      'MP-ROUTE-015',
      'MP-ROUTE-015',
    ]);
  });
});
