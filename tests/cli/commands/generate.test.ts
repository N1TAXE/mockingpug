import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    amount: 20,
    data: { id: 'number.increment', name: 'username.FS', email: 'email[gmail.com]', role: 'role', posts: 'data.blogpost' },
  }),
  'mock/api/blogpost/schema.json': JSON.stringify({
    amount: 20,
    data: { id: 'uuid', title: 'lorem.32', author: 'data.user.id' },
  }),
  'mock/data/role.json': JSON.stringify([{ value: 'ADMIN', max: 5 }, { value: 'USER', chance: 0.9 }]),
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-generate-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('generate', () => {
  it('generates and persists records to .mockingpug/db by default (file adapter)', async () => {
    await writeFiles(validProject);
    const result = await generate(dir);

    expect(result.ok).toBe(true);
    expect(result.messages.some((m) => m.includes('user') && m.includes('generated'))).toBe(true);

    const raw = await readFile(join(dir, '.mockingpug', 'db', 'user.json'), 'utf-8');
    const stored = JSON.parse(raw);
    expect(stored.records).toHaveLength(20);
  });

  it('is a no-op (skipped) on a second run with an unchanged schema', async () => {
    await writeFiles(validProject);
    await generate(dir);
    const result = await generate(dir);
    expect(result.messages.some((m) => m.includes('unchanged, skipped'))).toBe(true);
  });

  it('reconciles: bumping "amount" appends records without touching the store from scratch', async () => {
    await writeFiles(validProject);
    await generate(dir);

    await writeFiles({
      'mock/api/user/schema.json': JSON.stringify({
        amount: 30,
        data: { id: 'number.increment', name: 'username.FS', email: 'email[gmail.com]', role: 'role', posts: 'data.blogpost' },
      }),
    });
    const result = await generate(dir);
    expect(result.ok).toBe(true);

    const raw = await readFile(join(dir, '.mockingpug', 'db', 'user.json'), 'utf-8');
    expect(JSON.parse(raw).records).toHaveLength(30);
  });

  it("'fresh' strategy wipes the store before generating", async () => {
    await writeFiles(validProject);
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { persist: { strategy: 'fresh' } };", 'utf-8');
    await generate(dir);

    const before = await readFile(join(dir, '.mockingpug', 'db', 'user.json'), 'utf-8');
    const result = await generate(dir);
    const after = await readFile(join(dir, '.mockingpug', 'db', 'user.json'), 'utf-8');

    // Same seed => same output, but it's a fresh full regenerate each time, never "skipped".
    expect(result.messages.some((m) => m.includes('unchanged, skipped'))).toBe(false);
    expect(JSON.parse(after)).toEqual(JSON.parse(before));
  });

  it('reports 0 entities and does not error on an empty mock/api', async () => {
    const result = await generate(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('nothing to generate');
  });

  it('fails with a clear message when the schema is invalid', async () => {
    await writeFiles({ 'mock/api/user/schema.json': '{ not valid json' });
    const result = await generate(dir);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('invalid JSON');
  });

  it('fails with a clear message on a dependency-graph error caught inside generateAll (not loadProject)', async () => {
    // Individually each schema parses fine (loadProject succeeds); the
    // circular field-ref is only detected once generateAll() builds the
    // cross-entity graph.
    await writeFiles({
      'mock/api/a/schema.json': JSON.stringify({ amount: 1, data: { bRef: 'data.b.id' } }),
      'mock/api/b/schema.json': JSON.stringify({ amount: 1, data: { aRef: 'data.a.id' } }),
    });
    const result = await generate(dir);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('circular reference');
  });

  it('surfaces orphan entities as warnings after a schema is removed', async () => {
    await writeFiles(validProject);
    await generate(dir);

    await rm(join(dir, 'mock', 'api', 'blogpost'), { recursive: true, force: true });
    await writeFiles({
      'mock/api/user/schema.json': JSON.stringify({
        amount: 20,
        data: { id: 'number.increment', name: 'username.FS', email: 'email[gmail.com]', role: 'role' },
      }),
    });

    const result = await generate(dir);
    expect(result.warnings.some((w) => w.includes('blogpost'))).toBe(true);
  });
});
