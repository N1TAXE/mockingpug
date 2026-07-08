import { describe, expect, it } from 'vitest';
import { paginate } from '../../src/query/pagination.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';

const records = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
const baseConfig = DEFAULT_CONFIG.pagination;

describe('paginate - strategy: false', () => {
  it('returns every record with no meta, ignoring query params', () => {
    const result = paginate(records, new URLSearchParams('page=2&limit=5'), { ...baseConfig, strategy: false });
    expect(result.data).toHaveLength(25);
    expect(result.meta).toBeNull();
  });
});

describe('paginate - strategy: page', () => {
  it('returns the first page by default', () => {
    const result = paginate(records, new URLSearchParams(), baseConfig);
    expect(result.data).toEqual(records.slice(0, 20));
    expect(result.meta).toEqual({ strategy: 'page', total: 25, page: 1, limit: 20, pageCount: 2 });
  });

  it('honors an explicit page and limit', () => {
    const result = paginate(records, new URLSearchParams('page=2&limit=10'), baseConfig);
    expect(result.data).toEqual(records.slice(10, 20));
    expect(result.meta).toMatchObject({ page: 2, limit: 10, total: 25, pageCount: 3 });
  });

  it('clamps limit to maxLimit', () => {
    const result = paginate(records, new URLSearchParams('limit=1000'), baseConfig);
    expect(result.data).toHaveLength(baseConfig.maxLimit < 25 ? baseConfig.maxLimit : 25);
  });

  it('falls back to page 1 for invalid/negative page values', () => {
    const result = paginate(records, new URLSearchParams('page=-5'), baseConfig);
    expect(result.meta).toMatchObject({ page: 1 });
  });

  it('falls back to defaultLimit for a non-numeric limit', () => {
    const result = paginate(records, new URLSearchParams('limit=abc'), baseConfig);
    expect(result.meta).toMatchObject({ limit: baseConfig.defaultLimit });
  });

  it('returns an empty page past the end', () => {
    const result = paginate(records, new URLSearchParams('page=10&limit=10'), baseConfig);
    expect(result.data).toEqual([]);
  });

  it('respects custom param names', () => {
    const config = { ...baseConfig, params: { ...baseConfig.params, page: 'p', limit: 'perPage' } };
    const result = paginate(records, new URLSearchParams('p=2&perPage=5'), config);
    expect(result.data).toEqual(records.slice(5, 10));
  });
});

describe('paginate - strategy: offset', () => {
  const config = { ...baseConfig, strategy: 'offset' as const };

  it('defaults offset to 0', () => {
    const result = paginate(records, new URLSearchParams('limit=5'), config);
    expect(result.data).toEqual(records.slice(0, 5));
    expect(result.meta).toEqual({ strategy: 'offset', total: 25, offset: 0, limit: 5 });
  });

  it('honors an explicit offset', () => {
    const result = paginate(records, new URLSearchParams('offset=10&limit=5'), config);
    expect(result.data).toEqual(records.slice(10, 15));
  });

  it('falls back to 0 for a negative offset', () => {
    const result = paginate(records, new URLSearchParams('offset=-3'), config);
    expect(result.meta).toMatchObject({ offset: 0 });
  });
});

describe('paginate - strategy: cursor', () => {
  const config = { ...baseConfig, strategy: 'cursor' as const };

  it('starts from the beginning with no cursor', () => {
    const result = paginate(records, new URLSearchParams('limit=10'), config);
    expect(result.data).toEqual(records.slice(0, 10));
    expect(result.meta).toMatchObject({ nextCursor: '10' });
  });

  it('continues from the given cursor', () => {
    const result = paginate(records, new URLSearchParams('cursor=10&limit=10'), config);
    expect(result.data).toEqual(records.slice(10, 20));
    expect(result.meta).toMatchObject({ nextCursor: '20' });
  });

  it('returns nextCursor: null once exhausted', () => {
    const result = paginate(records, new URLSearchParams('cursor=20&limit=10'), config);
    expect(result.data).toEqual(records.slice(20, 25));
    expect(result.meta).toMatchObject({ nextCursor: null });
  });

  it('falls back to 0 for an invalid cursor', () => {
    const result = paginate(records, new URLSearchParams('cursor=nope'), config);
    expect(result.data).toEqual(records.slice(0, 20));
  });
});

describe('paginate - group mode (groupBy + limitPerGroup)', () => {
  const grouped = [
    { id: 1, group_id: 'a' },
    { id: 2, group_id: 'a' },
    { id: 3, group_id: 'a' },
    { id: 4, group_id: 'b' },
    { id: 5, group_id: 'b' },
    { id: 6, group_id: 'c' },
  ];

  it('caps records per distinct group value, not the whole batch', () => {
    const result = paginate(grouped, new URLSearchParams('groupBy=group_id&limitPerGroup=2'), baseConfig);
    expect(result.data).toEqual([
      { id: 1, group_id: 'a' },
      { id: 2, group_id: 'a' },
      { id: 4, group_id: 'b' },
      { id: 5, group_id: 'b' },
      { id: 6, group_id: 'c' },
    ]);
    expect(result.meta).toEqual({ strategy: 'group', groupBy: 'group_id', limitPerGroup: 2, totalGroups: 3, total: 6 });
  });

  it('a group with fewer records than the cap keeps all of them', () => {
    const result = paginate(grouped, new URLSearchParams('groupBy=group_id&limitPerGroup=10'), baseConfig);
    expect(result.data).toHaveLength(6);
  });

  it('is not activated by groupBy alone, without limitPerGroup', () => {
    const result = paginate(grouped, new URLSearchParams('groupBy=group_id'), baseConfig);
    expect(result.meta).toMatchObject({ strategy: 'page' });
  });

  it('is not activated by limitPerGroup alone, without groupBy', () => {
    const result = paginate(grouped, new URLSearchParams('limitPerGroup=2'), baseConfig);
    expect(result.meta).toMatchObject({ strategy: 'page' });
  });

  it('falls back to defaultLimit for a non-numeric limitPerGroup, and clamps to maxLimit', () => {
    const nonNumeric = paginate(grouped, new URLSearchParams('groupBy=group_id&limitPerGroup=abc'), baseConfig);
    expect(nonNumeric.meta).toMatchObject({ limitPerGroup: baseConfig.defaultLimit });

    const clamped = paginate(grouped, new URLSearchParams('groupBy=group_id&limitPerGroup=999999'), baseConfig);
    expect(clamped.meta).toMatchObject({ limitPerGroup: baseConfig.maxLimit });
  });

  it('respects custom param names', () => {
    const config = { ...baseConfig, params: { ...baseConfig.params, groupBy: 'by', limitPerGroup: 'perGroup' } };
    const result = paginate(grouped, new URLSearchParams('by=group_id&perGroup=1'), config);
    expect(result.data.map((r) => r.id)).toEqual([1, 4, 6]);
  });

  it('is disabled entirely under strategy: false, same as normal pagination', () => {
    const result = paginate(grouped, new URLSearchParams('groupBy=group_id&limitPerGroup=1'), { ...baseConfig, strategy: false });
    expect(result.data).toHaveLength(6);
    expect(result.meta).toBeNull();
  });

  it('groups by a missing/undefined field as a single "" group', () => {
    const noField = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = paginate(noField, new URLSearchParams('groupBy=group_id&limitPerGroup=2'), baseConfig);
    expect(result.data).toHaveLength(2);
    expect(result.meta).toMatchObject({ totalGroups: 1 });
  });
});
