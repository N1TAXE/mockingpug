import { describe, expect, it } from 'vitest';
import { searchRecords } from '../../src/query/search.js';

const records = [
  { id: 1, name: 'Wireless Mouse', description: 'Ergonomic and quiet' },
  { id: 2, name: 'Mechanical Keyboard', description: 'Loud but satisfying' },
  { id: 3, name: 'USB-C Hub', description: 'Silent, compact adapter' },
  { id: 4, name: 'Monitor Stand', description: 'Wooden, minimal' },
];

describe('searchRecords', () => {
  it('returns every record unchanged when there is no search term', () => {
    const result = searchRecords(records, new URLSearchParams(), 'q', 'searchFields');
    expect(result).toEqual(records);
  });

  it('matches a substring case-insensitively across all string fields by default', () => {
    const result = searchRecords(records, new URLSearchParams('q=mouse'), 'q', 'searchFields');
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  it('matches against any string field, not just name', () => {
    const result = searchRecords(records, new URLSearchParams('q=silent'), 'q', 'searchFields');
    expect(result.map((r) => r.id)).toEqual([3]);
  });

  it('is case-insensitive', () => {
    const result = searchRecords(records, new URLSearchParams('q=WIRELESS'), 'q', 'searchFields');
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  it('restricts matching to the fields listed in searchFields', () => {
    const result = searchRecords(
      records,
      new URLSearchParams('q=loud&searchFields=name'),
      'q',
      'searchFields',
    );
    // "Loud" only appears in the description, not the name, so this should miss.
    expect(result).toEqual([]);
  });

  it('matches within a restricted field when the term is actually there', () => {
    const result = searchRecords(
      records,
      new URLSearchParams('q=keyboard&searchFields=name'),
      'q',
      'searchFields',
    );
    expect(result.map((r) => r.id)).toEqual([2]);
  });

  it('returns no records when nothing matches', () => {
    const result = searchRecords(records, new URLSearchParams('q=nonexistent'), 'q', 'searchFields');
    expect(result).toEqual([]);
  });

  it('ignores non-string fields (like id) when scanning all fields', () => {
    const result = searchRecords(records, new URLSearchParams('q=1'), 'q', 'searchFields');
    expect(result).toEqual([]);
  });
});
