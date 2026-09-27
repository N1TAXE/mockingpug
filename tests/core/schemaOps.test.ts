import { describe, expect, it } from 'vitest';
import { applyOp, uniqueName, type SchemaSource } from '../../src/core/schemaOps.js';

function saas(): SchemaSource {
  return {
    tables: {
      users: { amount: 100, data: { id: 'number.increment', name: 'username.FS', email: 'email', role: 'role' } },
      orders: { amount: 300, data: { id: 'number.increment', userId: 'data.users', total: 'number.1-100' } },
    },
    layout: { users: { x: 0, y: 0 }, orders: { x: 300, y: 0 } },
  };
}

describe('applyOp (R1)', () => {
  it('does not mutate the input', () => {
    const s = saas();
    const snapshot = JSON.stringify(s);
    applyOp(s, { type: 'field.remove', table: 'users', name: 'email' });
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('table.add inserts a table + layout, no-op if the name is taken', () => {
    const s = applyOp(saas(), { type: 'table.add', name: 'tags', x: 10, y: 20 });
    expect(s.tables.tags).toEqual({ amount: 10, data: { id: 'number.increment' } });
    expect(s.layout!.tags).toEqual({ x: 10, y: 20 });
    expect(applyOp(s, { type: 'table.add', name: 'tags', x: 0, y: 0 })).toBe(s);
  });

  it('table.rename rewrites relations, keeps table order and moves layout', () => {
    const s = applyOp(saas(), { type: 'table.rename', from: 'users', to: 'members' });
    expect(Object.keys(s.tables)).toEqual(['members', 'orders']);
    expect(s.tables.orders!.data.userId).toBe('data.members');
    expect(s.layout!.members).toEqual({ x: 0, y: 0 });
    expect(s.layout!.users).toBeUndefined();
  });

  it('table.rename rewrites field-level and multi-pick refs too', () => {
    const base: SchemaSource = {
      tables: {
        users: { amount: 1, data: { id: 'uuid' } },
        orders: { amount: 1, data: { u: 'data.users.id', pair: 'data.users.[id,name]' } },
      },
    };
    const s = applyOp(base, { type: 'table.rename', from: 'users', to: 'members' });
    expect(s.tables.orders!.data.u).toBe('data.members.id');
    expect(s.tables.orders!.data.pair).toBe('data.members.[id,name]');
  });

  it('table.rename is a no-op when the target name is taken or unchanged', () => {
    const s = saas();
    expect(applyOp(s, { type: 'table.rename', from: 'users', to: 'orders' })).toBe(s);
    expect(applyOp(s, { type: 'table.rename', from: 'users', to: 'users' })).toBe(s);
  });

  it('table.remove drops the table and its layout', () => {
    const s = applyOp(saas(), { type: 'table.remove', name: 'orders' });
    expect(Object.keys(s.tables)).toEqual(['users']);
    expect(s.layout!.orders).toBeUndefined();
  });

  it('table.move / table.setAmount', () => {
    let s = applyOp(saas(), { type: 'table.move', name: 'users', x: 99, y: 88 });
    expect(s.layout!.users).toEqual({ x: 99, y: 88 });
    s = applyOp(s, { type: 'table.setAmount', name: 'users', amount: 5 });
    expect(s.tables.users!.amount).toBe(5);
  });

  it('field.add appends, no-op if it already exists', () => {
    const s = applyOp(saas(), { type: 'field.add', table: 'users', name: 'avatar', dsl: 'image' });
    expect(Object.keys(s.tables.users!.data)).toEqual(['id', 'name', 'email', 'role', 'avatar']);
    expect(applyOp(s, { type: 'field.add', table: 'users', name: 'avatar', dsl: 'x' }).tables.users!.data.avatar).toBe('image');
  });

  it('field.rename keeps the field position', () => {
    const s = applyOp(saas(), { type: 'field.rename', table: 'users', from: 'name', to: 'fullName' });
    expect(Object.keys(s.tables.users!.data)).toEqual(['id', 'fullName', 'email', 'role']);
  });

  it('field.remove / field.setDsl', () => {
    let s = applyOp(saas(), { type: 'field.remove', table: 'users', name: 'role' });
    expect(s.tables.users!.data.role).toBeUndefined();
    s = applyOp(s, { type: 'field.setDsl', table: 'users', name: 'email', dsl: 'email[gmail.com]' });
    expect(s.tables.users!.data.email).toBe('email[gmail.com]');
  });

  it('operations on a missing table/field are no-ops', () => {
    const s = saas();
    expect(applyOp(s, { type: 'field.add', table: 'nope', name: 'x', dsl: 'uuid' })).toBe(s);
    expect(applyOp(s, { type: 'table.setAmount', name: 'nope', amount: 1 })).toBe(s);
  });
});

describe('uniqueName', () => {
  it('returns base when free, else base_2, base_3…', () => {
    expect(uniqueName('users', [])).toBe('users');
    expect(uniqueName('users', ['users'])).toBe('users_2');
    expect(uniqueName('users', ['users', 'users_2'])).toBe('users_3');
  });
});
