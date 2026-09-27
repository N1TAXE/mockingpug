import { describe, expect, it } from 'vitest';
import { defaultResourceRoute, defaultRoutes, matchRoute, type Route } from '../../src/core/routes.js';

describe('matchRoute — resource expansion (R5)', () => {
  const routes: Route[] = [defaultResourceRoute('users')]; // /users, full CRUD

  it('matches list / item / create / update / delete with the right op', () => {
    expect(matchRoute('GET', '/api/users', routes)).toMatchObject({ op: 'list', params: {} });
    expect(matchRoute('GET', '/api/users/5', routes)).toMatchObject({ op: 'get', params: { id: '5' } });
    expect(matchRoute('POST', '/api/users', routes)).toMatchObject({ op: 'create' });
    expect(matchRoute('PUT', '/api/users/5', routes)).toMatchObject({ op: 'update', params: { id: '5' } });
    expect(matchRoute('PATCH', '/api/users/5', routes)).toMatchObject({ op: 'update' });
    expect(matchRoute('DELETE', '/api/users/5', routes)).toMatchObject({ op: 'delete', params: { id: '5' } });
  });

  it('returns undefined for an unmatched path or method', () => {
    expect(matchRoute('GET', '/api/nope', routes)).toBeUndefined();
    expect(matchRoute('POST', '/api/users/5', routes)).toBeUndefined();
  });

  it('honors methods restriction (read-only resource)', () => {
    const readOnly: Route[] = [{ id: 'r', kind: 'resource', path: '/reports', table: 'report', methods: ['list', 'get'] }];
    expect(matchRoute('GET', '/api/reports', readOnly)).toMatchObject({ op: 'list' });
    expect(matchRoute('POST', '/api/reports', readOnly)).toBeUndefined();
  });
});

describe('matchRoute — specificity and custom routes', () => {
  const routes: Route[] = [
    defaultResourceRoute('orders'), // /orders, /orders/:id
    { id: 'order-stats', kind: 'list', method: 'GET', path: '/orders/stats', from: 'stat' },
    { id: 'order-tx', kind: 'list', method: 'GET', path: '/orders/:id/transactions', from: 'transaction', where: { orderId: ':id' } },
    { id: 'order-full', kind: 'one', method: 'GET', path: '/orders/:id/full', from: 'order', where: { id: ':id' } },
  ];

  it('a static segment beats a param at the same position', () => {
    // /orders/stats must hit the custom list, not the resource item /orders/:id
    expect(matchRoute('GET', '/api/orders/stats', routes)).toMatchObject({ route: { id: 'order-stats' } });
    // a real id still hits the resource item
    expect(matchRoute('GET', '/api/orders/42', routes)).toMatchObject({ op: 'get', params: { id: '42' } });
  });

  it('matches nested custom routes and captures params', () => {
    expect(matchRoute('GET', '/api/orders/7/transactions', routes)).toMatchObject({ route: { id: 'order-tx' }, params: { id: '7' } });
    expect(matchRoute('GET', '/api/orders/7/full', routes)).toMatchObject({ route: { id: 'order-full' }, params: { id: '7' } });
  });

  it('respects a custom baseUrl', () => {
    expect(matchRoute('GET', '/v1/orders/42', routes, '/v1')).toMatchObject({ op: 'get', params: { id: '42' } });
  });
});

describe('defaultRoutes', () => {
  it('produces one full-CRUD resource per table', () => {
    const routes = defaultRoutes(['users', 'orders']);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ kind: 'resource', table: 'users', path: '/users' });
  });
});
