import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockContext, getMockContext, resetMockContextCache } from '../../src/next/context.js';
import { listRecords } from '../../src/query/index.js';

let dir: string;

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

const validProject = {
  'mock/api/user/schema.json': JSON.stringify({
    amount: 10,
    data: { id: 'number.increment', name: 'username.FS', role: 'role', posts: 'data.blogpost' },
  }),
  'mock/api/blogpost/schema.json': JSON.stringify({
    amount: 10,
    data: { id: 'uuid', author: 'data.user.id' },
  }),
  'mock/data/role.json': JSON.stringify([{ value: 'ADMIN', max: 5 }, { value: 'USER', chance: 0.9 }]),
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-next-context-'));
  resetMockContextCache();
});

afterEach(async () => {
  resetMockContextCache();
  await rm(dir, { recursive: true, force: true });
});

describe('createMockContext', () => {
  it('loads schemas and already has generated data on the very first call (no separate "generate" step needed)', async () => {
    await writeFiles(validProject);
    const { ctx, baseUrl } = await createMockContext(dir);

    expect(Object.keys(ctx.schemas).sort()).toEqual(['blogpost', 'user']);
    expect(baseUrl).toBe('/api');

    const result = await listRecords('user', new URLSearchParams(), ctx);
    expect(result.meta).toMatchObject({ total: 10 });
  });

  it('persists generated data to .mockingpug/db by default (file adapter)', async () => {
    await writeFiles(validProject);
    await createMockContext(dir);
    const raw = await readFile(join(dir, '.mockingpug', 'db', 'user.json'), 'utf-8');
    expect(JSON.parse(raw).records).toHaveLength(10);
  });

  it('supports the memory adapter (no filesystem persistence)', async () => {
    await writeFiles(validProject);
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { persist: { adapter: 'memory' } };", 'utf-8');
    const { ctx } = await createMockContext(dir);
    const result = await listRecords('user', new URLSearchParams(), ctx);
    expect(result.meta).toMatchObject({ total: 10 });
  });

  it("passes mock.config.js's runtime (errorRate/delay) through to the QueryContext", async () => {
    await writeFiles(validProject);
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { runtime: { delay: 25, errorRate: 0.1 } };', 'utf-8');

    const { ctx } = await createMockContext(dir);
    expect(ctx.runtime).toEqual({ delay: 25, errorRate: 0.1 });
  });

  it('"fresh" strategy wipes the store before regenerating on every call', async () => {
    await writeFiles(validProject);
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { persist: { strategy: 'fresh' } };", 'utf-8');

    const { ctx: first } = await createMockContext(dir);
    // Simulate a manual mutation that should NOT survive a "fresh" reload.
    const stored = await first.store.load('user');
    stored!.records.push({ id: 999, name: 'Manual', _seed: false, _index: 10 });
    await first.store.save('user', stored!);

    const { ctx: second } = await createMockContext(dir);
    const result = await listRecords('user', new URLSearchParams('limit=100'), second);
    expect(result.data.some((r) => r.id === 999)).toBe(false);
  });
});

describe('getMockContext', () => {
  it('memoizes per projectDir : repeated calls return the same context, not a fresh reload', async () => {
    await writeFiles(validProject);
    const first = await getMockContext(dir);
    const second = await getMockContext(dir);
    expect(second).toBe(first);
  });

  it('resetMockContextCache() forces the next call to rebuild', async () => {
    await writeFiles(validProject);
    const first = await getMockContext(dir);
    resetMockContextCache();
    const second = await getMockContext(dir);
    expect(second).not.toBe(first);
  });

  it(
    'a file watcher auto-invalidates the cache when a schema changes on disk, without a manual reset',
    async () => {
      await writeFiles(validProject);
      const first = await getMockContext(dir);
      expect((await listRecords('user', new URLSearchParams(), first.ctx)).meta).toMatchObject({ total: 10 });

      // Bump "amount": a real edit a developer would make while `next dev` is running.
      await writeFiles({
        'mock/api/user/schema.json': JSON.stringify({
          amount: 20,
          data: { id: 'number.increment', name: 'username.FS', role: 'role', posts: 'data.blogpost' },
        }),
      });

      const deadline = Date.now() + 4000;
      let total = 10;
      while (Date.now() < deadline && total !== 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const current = await getMockContext(dir);
        total = (await listRecords('user', new URLSearchParams('limit=100'), current.ctx)).meta?.total ?? 10;
      }

      expect(total).toBe(20);
    },
    8000,
  );

  it('resetMockContextCache() closes watchers without throwing', async () => {
    await writeFiles(validProject);
    await getMockContext(dir);
    expect(() => resetMockContextCache()).not.toThrow();
  });
});
