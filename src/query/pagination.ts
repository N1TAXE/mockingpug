import type { PaginationConfig } from '../cli/mockConfig.js';

export interface PageMeta {
  strategy: 'page';
  total: number;
  page: number;
  limit: number;
  pageCount: number;
}

export interface OffsetMeta {
  strategy: 'offset';
  total: number;
  offset: number;
  limit: number;
}

export interface CursorMeta {
  strategy: 'cursor';
  total: number;
  limit: number;
  nextCursor: string | null;
}

export interface GroupMeta {
  strategy: 'group';
  /** The field records were grouped by, e.g. `"group_id"` from `?groupBy=group_id`. */
  groupBy: string;
  /** The resolved per-group cap actually applied (after clamping to `maxLimit`). */
  limitPerGroup: number;
  /** How many distinct group values appeared in the (filtered/searched/sorted) result set. */
  totalGroups: number;
  /** Total records across all groups, before the per-group cap was applied. */
  total: number;
}

export type PaginationMeta = PageMeta | OffsetMeta | CursorMeta | GroupMeta;

function stringifyGroupValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Groups `records` by `record[groupByField]` and keeps at most
 * `limitPerGroup` records per distinct value, preserving the relative
 * order records already had within each group (and each group's own
 * first-appearance order in the output). Unlike the page/offset/cursor
 * strategies, this doesn't slice a flat list — a batch request like
 * `?group_id=1,2,3&limitPerGroup=5` wants up to 5 records for *each* of
 * groups 1, 2, and 3, not 5 records total across all three.
 */
function groupLimit<T extends Record<string, unknown>>(
  records: readonly T[],
  groupByField: string,
  rawLimitPerGroup: string,
  config: PaginationConfig,
): PaginatedResult<T> {
  let limitPerGroup = Number(rawLimitPerGroup);
  if (!Number.isFinite(limitPerGroup) || limitPerGroup <= 0) limitPerGroup = config.defaultLimit;
  limitPerGroup = Math.min(limitPerGroup, config.maxLimit);

  const counts = new Map<string, number>();
  const data: T[] = [];
  for (const record of records) {
    const key = stringifyGroupValue(record[groupByField]);
    const count = counts.get(key) ?? 0;
    if (count >= limitPerGroup) continue;
    data.push(record);
    counts.set(key, count + 1);
  }

  return {
    data,
    meta: { strategy: 'group', groupBy: groupByField, limitPerGroup, totalGroups: counts.size, total: records.length },
  };
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta | null;
}

function resolveLimit(searchParams: URLSearchParams, config: PaginationConfig): number {
  const raw = searchParams.get(config.params.limit);
  let limit = raw !== null ? Number(raw) : config.defaultLimit;
  if (!Number.isFinite(limit) || limit <= 0) limit = config.defaultLimit;
  return Math.min(limit, config.maxLimit);
}

/**
 * Slices `records` according to `config.pagination`'s strategy
 * and the request's query params. Pure and synchronous: no I/O, easy to
 * unit test independently of any HTTP transport.
 */
export function paginate<T extends Record<string, unknown>>(
  records: readonly T[],
  searchParams: URLSearchParams,
  config: PaginationConfig,
): PaginatedResult<T> {
  if (config.strategy === false) {
    return { data: [...records], meta: null };
  }

  const groupBy = searchParams.get(config.params.groupBy);
  const rawLimitPerGroup = searchParams.get(config.params.limitPerGroup);
  if (groupBy && rawLimitPerGroup !== null) {
    return groupLimit(records, groupBy, rawLimitPerGroup, config);
  }

  const limit = resolveLimit(searchParams, config);

  if (config.strategy === 'page') {
    const raw = searchParams.get(config.params.page);
    let page = raw !== null ? Number(raw) : 1;
    if (!Number.isFinite(page) || page < 1) page = 1;
    const start = (page - 1) * limit;
    return {
      data: records.slice(start, start + limit),
      meta: { strategy: 'page', total: records.length, page, limit, pageCount: Math.ceil(records.length / limit) },
    };
  }

  if (config.strategy === 'offset') {
    const raw = searchParams.get(config.params.offset);
    let offset = raw !== null ? Number(raw) : 0;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    return {
      data: records.slice(offset, offset + limit),
      meta: { strategy: 'offset', total: records.length, offset, limit },
    };
  }

  // cursor: the cursor is simply the stringified index of the next record to read.
  const raw = searchParams.get(config.params.cursor);
  const parsedCursor = raw !== null ? Number(raw) : 0;
  const start = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const data = records.slice(start, start + limit);
  const nextIndex = start + data.length;
  return {
    data,
    meta: { strategy: 'cursor', total: records.length, limit, nextCursor: nextIndex < records.length ? String(nextIndex) : null },
  };
}
