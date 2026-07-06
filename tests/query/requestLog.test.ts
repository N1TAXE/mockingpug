import { describe, expect, it } from 'vitest';
import { DEFAULT_REQUEST_LOG_SIZE, RequestLog, recordRequest } from '../../src/query/requestLog.js';
import type { QueryContext } from '../../src/query/resolver.js';

describe('RequestLog', () => {
  it('lists recorded entries most-recent-first', () => {
    const log = new RequestLog();
    log.record({ method: 'GET', path: '/api/user', status: 200, durationMs: 5, timestamp: 1 });
    log.record({ method: 'POST', path: '/api/user', status: 201, durationMs: 8, timestamp: 2 });

    const list = log.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ method: 'POST', status: 201 });
    expect(list[1]).toMatchObject({ method: 'GET', status: 200 });
  });

  it('drops the oldest entry once maxSize is exceeded', () => {
    const log = new RequestLog(3);
    for (let i = 1; i <= 4; i++) {
      log.record({ method: 'GET', path: `/api/user/${i}`, status: 200, durationMs: 1, timestamp: i });
    }
    const paths = log.list().map((e) => e.path);
    expect(paths).toEqual(['/api/user/4', '/api/user/3', '/api/user/2']);
  });

  it('defaults to DEFAULT_REQUEST_LOG_SIZE (50) when no size is given', () => {
    const log = new RequestLog();
    for (let i = 0; i < DEFAULT_REQUEST_LOG_SIZE + 10; i++) {
      log.record({ method: 'GET', path: '/api/user', status: 200, durationMs: 1, timestamp: i });
    }
    expect(log.list()).toHaveLength(DEFAULT_REQUEST_LOG_SIZE);
  });

  it('clear() empties the log', () => {
    const log = new RequestLog();
    log.record({ method: 'GET', path: '/api/user', status: 200, durationMs: 1, timestamp: 1 });
    log.clear();
    expect(log.list()).toHaveLength(0);
  });

  it('list() returns a fresh snapshot, not a live view', () => {
    const log = new RequestLog();
    log.record({ method: 'GET', path: '/api/user', status: 200, durationMs: 1, timestamp: 1 });
    const first = log.list();
    log.record({ method: 'GET', path: '/api/user/2', status: 200, durationMs: 1, timestamp: 2 });
    expect(first).toHaveLength(1);
  });
});

describe('recordRequest', () => {
  function makeCtx(requestLog?: RequestLog): QueryContext {
    return {
      schemas: {},
      // Only `requestLog` matters for this helper; the rest is never touched.
      store: undefined as never,
      pagination: undefined as never,
      seed: 's',
      requestLog,
    };
  }

  it('is a no-op when ctx.requestLog is unset', () => {
    const ctx = makeCtx();
    expect(() => recordRequest(ctx, new Request('http://localhost/api/user'), 200, Date.now())).not.toThrow();
  });

  it('records method, path (pathname + search), status, and duration', () => {
    const requestLog = new RequestLog();
    const ctx = makeCtx(requestLog);
    const startedAt = Date.now() - 10;

    recordRequest(ctx, new Request('http://localhost/api/user?page=2'), 200, startedAt);

    const [entry] = requestLog.list();
    expect(entry).toMatchObject({ method: 'GET', path: '/api/user?page=2', status: 200, timestamp: startedAt });
    expect(entry!.durationMs).toBeGreaterThanOrEqual(0);
  });
});
