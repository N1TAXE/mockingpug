import { describe, expect, it } from 'vitest';
import { filterRecords } from '../../src/query/filter.js';

const records = [
  { id: 1, categoryId: '2', inStock: 'true' },
  { id: 2, categoryId: '3', inStock: 'true' },
  { id: 3, categoryId: '2', inStock: 'false' },
  { id: 4, categoryId: '5', inStock: 'true' },
];

describe('filterRecords', () => {
  it('returns every record unchanged when there are no filter params', () => {
    const result = filterRecords(records, new URLSearchParams(), new Set());
    expect(result).toEqual(records);
  });

  it('ignores params in reservedParams', () => {
    const result = filterRecords(records, new URLSearchParams('page=1&limit=20'), new Set(['page', 'limit']));
    expect(result).toEqual(records);
  });

  it('keeps only records with an exact field match', () => {
    const result = filterRecords(records, new URLSearchParams('categoryId=2'), new Set());
    expect(result.map((r) => r.id)).toEqual([1, 3]);
  });

  it('treats a comma-separated value as an OR/in match', () => {
    const result = filterRecords(records, new URLSearchParams('categoryId=2,5'), new Set());
    expect(result.map((r) => r.id)).toEqual([1, 3, 4]);
  });

  it('ANDs distinct filter fields together', () => {
    const result = filterRecords(records, new URLSearchParams('categoryId=2&inStock=true'), new Set());
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  it('unions repeated params for the same field', () => {
    const result = filterRecords(records, new URLSearchParams('categoryId=2&categoryId=5'), new Set());
    expect(result.map((r) => r.id)).toEqual([1, 3, 4]);
  });

  it('returns no records when the filter value matches nothing', () => {
    const result = filterRecords(records, new URLSearchParams('categoryId=999'), new Set());
    expect(result).toEqual([]);
  });

  it('trims whitespace around comma-separated values', () => {
    const result = filterRecords(records, new URLSearchParams('categoryId=2, 5'), new Set());
    expect(result.map((r) => r.id)).toEqual([1, 3, 4]);
  });
});
