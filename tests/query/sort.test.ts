import { describe, expect, it } from 'vitest';
import { sortRecords } from '../../src/query/sort.js';

const records = [
  { id: 1, price: 30, name: 'b' },
  { id: 2, price: 10, name: 'a' },
  { id: 3, price: 30, name: 'a' },
  { id: 4, price: 20, name: 'c' },
];

describe('sortRecords', () => {
  it('returns records in their original order when there is no sort param', () => {
    const result = sortRecords(records, new URLSearchParams(), 'sort');
    expect(result).toEqual(records);
  });

  it('sorts ascending by default', () => {
    const result = sortRecords(records, new URLSearchParams('sort=price'), 'sort');
    expect(result.map((r) => r.price)).toEqual([10, 20, 30, 30]);
  });

  it('sorts descending when the direction is explicit', () => {
    const result = sortRecords(records, new URLSearchParams('sort=price:desc'), 'sort');
    expect(result.map((r) => r.price)).toEqual([30, 30, 20, 10]);
  });

  it('breaks ties using a second sort field', () => {
    const result = sortRecords(records, new URLSearchParams('sort=price:asc,name:asc'), 'sort');
    expect(result.map((r) => r.id)).toEqual([2, 4, 3, 1]);
  });

  it('sorts strings lexicographically', () => {
    const result = sortRecords(records, new URLSearchParams('sort=name'), 'sort');
    expect(result.map((r) => r.name)).toEqual(['a', 'a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const copy = [...records];
    sortRecords(records, new URLSearchParams('sort=price:desc'), 'sort');
    expect(records).toEqual(copy);
  });
});
