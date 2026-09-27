import { describe, expect, it, beforeAll } from 'vitest';
import { executeRoute } from '../../src/query/executeRoute.js';
import { matchRoute, defaultResourceRoute, type Route } from '../../src/core/routes.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/resolver.js';

const schemas: SchemaBundle = {
  users: { name: 'users', file: 'x', amount: 5, data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } } },
  orders: {
    name: 'orders',
    file: 'x',
    amount: 15,
    data: {
      id: { kind: 'number', mode: 'increment' },
      userId: { kind: 'crossRef', entity: 'users', field: 'id' },
      total: { kind: 'number', mode: 'random', min: 1, max: 100 },
    },
  },
};

const routes: Route[] = [
  defaultResourceRoute('users'),
  { id: 'user-orders', kind: 'list', method: 'GET', path: '/users/:id/orders', from: 'orders', where: { userId: ':id' }, select: ['id', 'total'] },
  { id: 'order-full', kind: 'one', method: 'GET', path: '/orders/:id/full', from: 'orders', where: { id: ':id' }, include: { user: 'userId' } },
  { id: 'order-slim', kind: 'one', method: 'GET', path: '/orders/:id/slim', from: 'orders', where: { id: ':id' }, select: ['id'], include: { user: 'userId' } },
  { id: 'ping', kind: 'static', method: 'GET', path: '/ping', status: 200, body: { ok: true } },
  { id: 'order-pay', kind: 'mutation', method: 'POST', path: '/orders/:id/pay', response: '{"status":"paid"}' },
  { id: 'order-create', kind: 'mutation', method: 'POST', path: '/orders', from: 'orders', select: ['id'] },
  { id: 'orders-small', kind: 'list', method: 'GET', path: '/orders/small', from: 'orders', paginate: { defaultLimit: 2 } },
  { id: 'dashboard', kind: 'composite', method: 'GET', path: '/dashboard', shape: { users: { from: 'users', select: ['id'] }, latestOrder: { from: 'orders', sort: 'id:desc', first: true, select: ['id'] } } },
  { id: 'do', kind: 'action', method: 'POST', path: '/do', effects: [], respond: { status: 200, body: { ok: true } } },
  { id: 'like', kind: 'action', method: 'POST', path: '/orders/:id/like', effects: [{ op: 'increment', table: 'orders', where: { id: ':id' }, field: 'total', by: 100, name: 'liked' }], respond: { ref: 'liked' } },
  { id: 'hand', kind: 'handler', method: 'POST', path: '/hand', file: 'x.ts' },
];

let ctx: QueryContext;

beforeAll(async () => {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'exec' });
  ctx = { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'exec' };
});

async function run(method: string, path: string, init?: RequestInit) {
  const match = matchRoute(method, path, routes)!;
  expect(match, `no route for ${method} ${path}`).toBeDefined();
  return executeRoute(match, new Request(`http://localhost${path}`, init), ctx);
}

describe('executeRoute (R5)', () => {
  it('resource: list returns the envelope, get returns one record', async () => {
    const list = await run('GET', '/api/users');
    const listBody = (await list.json()) as { data: unknown[]; meta: { total: number } };
    expect(listBody.meta.total).toBe(5);

    const get = await run('GET', '/api/users/1');
    expect((await get.json()).id).toBe(1);
  });

  it('resource: delete returns 204 and removes the record', async () => {
    const del = await run('DELETE', '/api/users/5');
    expect(del.status).toBe(204);
    const after = await run('GET', '/api/users/5');
    expect(after.status).toBe(404);
  });

  it('list route: where binds a path param, select projects fields', async () => {
    // every order of user 1
    const res = await run('GET', '/api/users/1/orders');
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    const allOrders = (await ctx.store.load('orders'))!.records.filter((o) => o.userId === 1);
    expect(body.data.length).toBe(allOrders.length);
    for (const row of body.data) {
      expect(Object.keys(row).sort()).toEqual(['id', 'total']); // select applied, userId/_seed stripped
    }
  });

  it('one route: 404 when nothing matches, else record + FK include', async () => {
    const miss = await run('GET', '/api/orders/9999/full');
    expect(miss.status).toBe(404);
    expect((await miss.json()).error.code).toBe('MP-REQ-003');

    const order = (await ctx.store.load('orders'))!.records[0]!;
    const res = await run('GET', `/api/orders/${order.id}/full`);
    const body = (await res.json()) as { id: number; userId: number; user: { id: number } };
    expect(body.id).toBe(order.id);
    expect(body.user.id).toBe(order.userId); // FK include resolved to the user object
  });

  it('include resolves even when select drops the FK field (include runs before projection)', async () => {
    const order = (await ctx.store.load('orders'))!.records[0]!;
    const res = await run('GET', `/api/orders/${order.id}/slim`);
    const body = (await res.json()) as Record<string, unknown> & { user?: { id: number } };
    expect(Object.keys(body).sort()).toEqual(['id', 'user']); // select ['id'] + the include key, userId hidden
    expect(body.user?.id).toBe(order.userId); // join still resolved despite userId not being selected
  });

  it('static route returns its body and status', async () => {
    const res = await run('GET', '/api/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('mutation is a map: 200 with a custom response, store untouched', async () => {
    const before = (await ctx.store.load('orders'))!.records.length;
    const res = await run('POST', '/api/orders/1/pay');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'paid' });
    expect((await ctx.store.load('orders'))!.records.length).toBe(before); // no write
  });

  it('mutation without a custom response echoes the first "from" record, projected by select', async () => {
    const res = await run('POST', '/api/orders');
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['id']); // select: ['id']
    const first = (await ctx.store.load('orders'))!.records[0]!;
    expect(body.id).toBe(first.id);
  });

  it('paginate override merges over the config (defaultLimit) instead of replacing it', async () => {
    const res = await run('GET', '/api/orders/small');
    const body = (await res.json()) as { data: unknown[]; meta: { limit: number; strategy: string } };
    expect(body.data.length).toBe(2); // route defaultLimit:2, not the config's 20
    expect(body.meta.strategy).toBe('page'); // strategy inherited from the config, not lost
  });

  it('response.envelope wraps list + one payloads with $payload/$meta/listKey', async () => {
    const enveloped: QueryContext = { ...ctx, response: { envelope: { data: '$payload', meta: '$meta', errors: [] }, listKey: 'items' } };
    // A `list` route (user-orders) is enveloped; legacy `resource` CRUD is not.
    const listMatch = matchRoute('GET', '/api/users/1/orders', routes)!;
    const listBody = (await executeRoute(listMatch, new Request('http://localhost/api/users/1/orders'), enveloped).then((r) => r.json())) as any;
    expect(Array.isArray(listBody.data.items)).toBe(true); // listKey nesting
    expect(listBody.meta).toBeDefined();
    expect(listBody.errors).toEqual([]); // literal passthrough

    const fullMatch = matchRoute('GET', '/api/orders/1/full', routes)!;
    const fullBody = (await executeRoute(fullMatch, new Request('http://localhost/api/orders/1/full'), enveloped).then((r) => r.json())) as any;
    expect(fullBody.data.id).toBe(1); // record under $payload (no listKey for a single record)
    expect(fullBody.errors).toEqual([]);
  });

  it('composite route builds one object from several table reads (first → object, else array)', async () => {
    const res = await run('GET', '/api/dashboard');
    const body = (await res.json()) as { users: Array<{ id: number }>; latestOrder: { id: number } };
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.length).toBeGreaterThan(0); // all users (shared store may have had some deleted by earlier tests)
    expect(Object.keys(body.users[0]!)).toEqual(['id']); // slot select
    expect(body.latestOrder).not.toBeNull();
    expect(body.latestOrder.id).toBe(15); // sort id:desc + first
  });

  it('action runs effects and responds; a static respond returns its body', async () => {
    const res = await run('POST', '/api/do');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('action increment effect writes to the store and responds with the $ref record', async () => {
    const before = ((await ctx.store.load('orders'))!.records.find((o) => o.id === 2))!.total as number;
    const res = await run('POST', '/api/orders/2/like');
    const body = (await res.json()) as { id: number; total: number };
    expect(body.id).toBe(2);
    expect(body.total).toBe(before + 100); // ref reflects the incremented record
    const after = ((await ctx.store.load('orders'))!.records.find((o) => o.id === 2))!.total as number;
    expect(after).toBe(before + 100); // persisted
  });

  it('handler routes are not implemented yet (501)', async () => {
    const res = await run('POST', '/api/hand');
    expect(res.status).toBe(501);
    expect((await res.json()).error.code).toBe('MP-REQ-006');
  });
});
