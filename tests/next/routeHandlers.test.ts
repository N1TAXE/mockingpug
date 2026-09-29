import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNextRouteHandlers } from '../../src/next/handler.js';
import { resetMockContextCache } from '../../src/next/context.js';

let dir: string;

async function writeUserSchema(amount: number): Promise<void> {
  const file = join(dir, 'mock/api/user/schema.json');
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify({ amount, data: { id: 'number.increment', name: 'username.FS' } }), 'utf-8');
}

function get(handlers: ReturnType<typeof createNextRouteHandlers>): Promise<Response> {
  return handlers.GET(new Request('http://localhost/api/user?limit=100'), { params: { mock: ['user'] } });
}

async function total(res: Response): Promise<number> {
  const body = (await res.json()) as { meta?: { total?: number } };
  return body.meta?.total ?? 0;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mpug-next-routes-'));
  resetMockContextCache();
});

afterEach(async () => {
  resetMockContextCache();
  await rm(dir, { recursive: true, force: true });
});

describe('createNextRouteHandlers', () => {
  it('serves generated data through a per-request context', async () => {
    await writeUserSchema(10);
    const handlers = createNextRouteHandlers(dir);
    expect(await total(await get(handlers))).toBe(10);
  });

  it('picks up a schema change after the context cache invalidates — no new handler object needed', async () => {
    await writeUserSchema(10);
    const handlers = createNextRouteHandlers(dir);
    expect(await total(await get(handlers))).toBe(10);

    // Simulate what `mpug pull` / an edit + the file watcher does mid-run.
    await writeUserSchema(20);
    resetMockContextCache();

    // Same handler object, but it re-fetches the (rebuilt) context per request.
    expect(await total(await get(handlers))).toBe(20);
  });
});
