import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { doctor } from '../../../src/cli/commands/doctor.js';
import { generate } from '../../../src/cli/commands/generate.js';

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
    data: { id: 'number.increment', name: 'username.FS', email: 'email[gmail.com]', role: 'role', posts: 'data.blogpost' },
  }),
  'mock/api/blogpost/schema.json': JSON.stringify({
    amount: 10,
    data: { id: 'uuid', title: 'lorem.32', author: 'data.user.id' },
  }),
  'mock/data/role.json': JSON.stringify([{ value: 'ADMIN', max: 5 }, { value: 'USER', chance: 0.9 }]),
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-doctor-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('doctor', () => {
  it('passes on the real mock/ example (user, blogpost, role)', async () => {
    await writeFiles(validProject);
    const result = await doctor(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('2 entities validated OK');
    expect(result.warnings).toEqual([]);
  });

  it('fails with a clear message on an unknown generator type', async () => {
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { email: 'emial' } }) });
    const result = await doctor(dir);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('unknown generator type');
  });

  it('fails on an unresolvable cross-entity reference cycle', async () => {
    await writeFiles({
      'mock/api/a/schema.json': JSON.stringify({ amount: 1, data: { bRef: 'data.b.id' } }),
      'mock/api/b/schema.json': JSON.stringify({ amount: 1, data: { aRef: 'data.a.id' } }),
    });
    const result = await doctor(dir);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('circular reference');
  });

  async function removeBlogpostSchema(): Promise<void> {
    // Delete the "blogpost" schema AND the "posts" field on "user" that
    // referenced it, otherwise doctor's validateEntitiesExist() would fail
    // first with a dangling-reference error instead of reaching orphan
    // detection.
    await rm(join(dir, 'mock', 'api', 'blogpost'), { recursive: true, force: true });
    await writeFiles({
      'mock/api/user/schema.json': JSON.stringify({
        amount: 10,
        data: { id: 'number.increment', name: 'username.FS', email: 'email[gmail.com]', role: 'role' },
      }),
    });
  }

  it('warns (but does not fail by default) about orphan entities left in the store', async () => {
    await writeFiles(validProject);
    await generate(dir);
    await removeBlogpostSchema();

    const result = await doctor(dir);
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain('blogpost');
  });

  it('--strict promotes orphan warnings to a hard failure', async () => {
    await writeFiles(validProject);
    await generate(dir);
    await removeBlogpostSchema();

    const result = await doctor(dir, { strict: true });
    expect(result.ok).toBe(false);
  });

  it('reports 0 warnings when using the memory adapter (no store to inspect for orphans)', async () => {
    await writeFiles(validProject);
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { persist: { adapter: 'memory' } };", 'utf-8');
    const result = await doctor(dir);
    expect(result.warnings).toEqual([]);
  });

  it('warns when an entity\'s amount exceeds limits.maxAmount', async () => {
    await writeFiles(validProject);
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { limits: { maxAmount: 5 } };', 'utf-8');
    const result = await doctor(dir);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('maxAmount'))).toBe(true);
  });

  it('--strict promotes a maxAmount warning to a hard failure', async () => {
    await writeFiles(validProject);
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { limits: { maxAmount: 5 } };', 'utf-8');
    const result = await doctor(dir, { strict: true });
    expect(result.ok).toBe(false);
  });

  it('warns when an array field\'s count exceeds limits.maxArrayDepth', async () => {
    await writeFiles({
      'mock/api/user/schema.json': JSON.stringify({
        amount: 1,
        data: { tags: 'array[lorem.8].10' },
      }),
    });
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { limits: { maxArrayDepth: 3 } };', 'utf-8');
    const result = await doctor(dir);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('maxArrayDepth'))).toBe(true);
  });

  it('does not warn about limits when the schema stays within them', async () => {
    await writeFiles(validProject);
    const result = await doctor(dir);
    expect(result.warnings).toEqual([]);
  });

  describe('--assert-prod-safe', () => {
    it('passes when the build output has no mock markers', async () => {
      await writeFiles(validProject);
      const buildDir = join(dir, 'build-clean');
      await mkdir(buildDir, { recursive: true });
      await writeFile(join(buildDir, 'main.js'), 'console.log("real app code");', 'utf-8');

      const result = await doctor(dir, { assertProdSafe: buildDir });
      expect(result.ok).toBe(true);
      expect(result.messages.some((m) => m.includes('--assert-prod-safe'))).toBe(true);
    });

    it('fails when the MSW service worker script is present in the build output', async () => {
      await writeFiles(validProject);
      const buildDir = join(dir, 'build-leaky');
      await mkdir(buildDir, { recursive: true });
      await writeFile(join(buildDir, 'mockServiceWorker.js'), '/* msw */', 'utf-8');

      const result = await doctor(dir, { assertProdSafe: buildDir });
      expect(result.ok).toBe(false);
      expect(result.warnings.some((w) => w.includes('mockServiceWorker.js'))).toBe(true);
    });

    it('fails when a bundled chunk still references mockingpug/dist/react', async () => {
      await writeFiles(validProject);
      const buildDir = join(dir, 'build-leaky-2');
      await mkdir(buildDir, { recursive: true });
      await writeFile(join(buildDir, 'chunk.js'), '//# sourceMappingURL relates to mockingpug/dist/react/index.js', 'utf-8');

      const result = await doctor(dir, { assertProdSafe: buildDir });
      expect(result.ok).toBe(false);
      expect(result.warnings.some((w) => w.includes('mockingpug/dist/react'))).toBe(true);
    });

    it('does not crash when the build directory does not exist', async () => {
      await writeFiles(validProject);
      const result = await doctor(dir, { assertProdSafe: join(dir, 'does-not-exist') });
      expect(result.ok).toBe(true);
    });
  });
});
