import { describe, expect, it, vi } from 'vitest';
import { buildListResponse, errorResponse, jsonResponse, readJsonBody } from '../../src/query/httpResponse.js';
import { RequestError } from '../../src/core/index.js';
import type { PaginationMeta } from '../../src/query/pagination.js';

describe('jsonResponse', () => {
  it('serializes the body and sets a JSON content-type', async () => {
    const res = jsonResponse({ hello: 'world' });
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('preserves other init options (status, extra headers)', async () => {
    const res = jsonResponse({ ok: true }, { status: 201, headers: { 'x-custom': '1' } });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-custom')).toBe('1');
    expect(res.headers.get('content-type')).toBe('application/json');
  });
});

describe('errorResponse', () => {
  it('maps a RequestError to its status code and a clean body', async () => {
    const error = new RequestError('MP-REQ-002', 'not found', 404);
    const res = errorResponse(error);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'MP-REQ-002', message: 'not found' } });
  });

  it('maps an unexpected error to a generic 500 without leaking internals', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse(new TypeError('some internal bug'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { source: string; message: string } };
    expect(body.error).toEqual({ source: 'mockingpug', message: 'internal error' });
    expect(body.error.message).not.toContain('internal bug');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('readJsonBody', () => {
  it('parses a valid JSON body', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(await readJsonBody(request)).toEqual({ a: 1 });
  });

  it('returns {} for a malformed JSON body instead of throwing', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: '{ not json' });
    expect(await readJsonBody(request)).toEqual({});
  });
});

describe('buildListResponse', () => {
  it('envelope: true wraps data+meta in the body', async () => {
    const meta: PaginationMeta = { strategy: 'page', total: 10, page: 1, limit: 5, pageCount: 2 };
    const res = buildListResponse([{ id: 1 }], meta, true);
    expect(await res.json()).toEqual({ data: [{ id: 1 }], meta });
  });

  it('envelope: false returns a raw array with X-* headers', async () => {
    const meta: PaginationMeta = { strategy: 'offset', total: 10, offset: 5, limit: 5 };
    const res = buildListResponse([{ id: 1 }], meta, false);
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(res.headers.get('x-total-count')).toBe('10');
    expect(res.headers.get('x-offset')).toBe('5');
  });

  it('cursor strategy sets X-Next-Cursor only when there is a next page', async () => {
    const meta: PaginationMeta = { strategy: 'cursor', total: 10, limit: 5, nextCursor: null };
    const res = buildListResponse([], meta, false);
    expect(res.headers.get('x-next-cursor')).toBeNull();
  });

  it('falls back to raw-array behavior when meta is null, regardless of envelope', async () => {
    const res = buildListResponse([{ id: 1 }], null, true);
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(res.headers.get('x-total-count')).toBeNull();
  });
});
