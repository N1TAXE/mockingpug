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

export type PaginationMeta = PageMeta | OffsetMeta | CursorMeta;

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
export function paginate<T>(
  records: readonly T[],
  searchParams: URLSearchParams,
  config: PaginationConfig,
): PaginatedResult<T> {
  if (config.strategy === false) {
    return { data: [...records], meta: null };
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
