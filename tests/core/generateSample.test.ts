import { describe, expect, it } from 'vitest';
import { generateSample } from '../../src/core/generateSample.js';
import type { SchemaSource } from '../../src/core/schemaOps.js';

const shop: SchemaSource = {
  tables: {
    users: { amount: 10, data: { id: 'number.increment', name: 'username.FS', orders: 'data.orders' } },
    orders: { amount: 10, data: { id: 'uuid', userId: 'data.users.id', total: 'number.1-100' } },
    products: { amount: 10, data: { id: 'uuid', title: 'lorem.20', slug: 'slugify[title,-]' } },
  },
};

describe('generateSample (R4)', () => {
  it('returns `count` records of the target entity', () => {
    expect(generateSample(shop, 'users', { count: 3, seed: 's' })).toHaveLength(3);
  });

  it('is deterministic for the same seed and drifts for a different one', () => {
    const a = generateSample(shop, 'users', { count: 3, seed: 'x' });
    const b = generateSample(shop, 'users', { count: 3, seed: 'x' });
    const c = generateSample(shop, 'users', { count: 3, seed: 'y' });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('resolves field-level cross-refs to a real id of the target (not a stub)', () => {
    const orders = generateSample(shop, 'orders', { count: 5, seed: 's' });
    const userIds = new Set(generateSample(shop, 'users', { count: 4, seed: 's' }).map((u) => u.id));
    for (const o of orders) {
      expect(typeof o.userId).toBe('number');
      // userId must be one of an actually-generated user's ids
      expect(userIds.has(o.userId)).toBe(true);
    }
  });

  it('resolves slugify from a sibling field', () => {
    const products = generateSample(shop, 'products', { count: 4, seed: 's' });
    for (const p of products) {
      expect(typeof p.slug).toBe('string');
      expect(p.slug).toBe(String(p.slug).toLowerCase());
      expect(p.slug).not.toContain(' ');
    }
  });

  it('resolves a bare relation (reverse list) to an array', () => {
    const users = generateSample(shop, 'users', { count: 3, seed: 's' });
    for (const u of users) {
      expect(Array.isArray(u.orders)).toBe(true);
    }
  });

  it('produces custom dictionary values when dictionaries are provided', () => {
    const s: SchemaSource = { tables: { u: { amount: 5, data: { id: 'uuid', role: 'role' } } } };
    const rows = generateSample(s, 'u', {
      count: 5,
      seed: 's',
      knownCustomTypes: ['role'],
      dictionaries: { role: [{ value: 'ADMIN' }, { value: 'USER' }] },
    });
    for (const r of rows) {
      expect(['ADMIN', 'USER']).toContain(r.role);
    }
  });

  it('returns [] for an unknown entity and stays resilient to an invalid field', () => {
    expect(generateSample(shop, 'nope', { seed: 's' })).toEqual([]);
    const broken: SchemaSource = { tables: { u: { amount: 3, data: { id: 'uuid', bad: 'not-a-generator' } } } };
    const rows = generateSample(broken, 'u', { count: 2, seed: 's' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty('id');
    expect(rows[0]).not.toHaveProperty('bad'); // invalid field omitted, no throw
  });
});
