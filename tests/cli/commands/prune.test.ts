import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prune } from '../../../src/cli/commands/prune.js';
import { generate } from '../../../src/cli/commands/generate.js';

let dir: string;

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

async function setupWithOrphan(): Promise<void> {
  await writeFiles({
    'mock/api/user/schema.json': JSON.stringify({ amount: 5, data: { id: 'uuid' } }),
    'mock/api/blogpost/schema.json': JSON.stringify({ amount: 5, data: { id: 'uuid' } }),
  });
  await generate(dir);
  await rm(join(dir, 'mock', 'api', 'blogpost'), { recursive: true, force: true });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-prune-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('prune', () => {
  it('fails with a clear message when the schema is invalid', async () => {
    await writeFiles({ 'mock/api/user/schema.json': '{ not valid json' });
    const result = await prune(dir);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('invalid JSON');
  });

  it('reports nothing to prune when there are no orphans', async () => {
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 5, data: { id: 'uuid' } }) });
    await generate(dir);
    const result = await prune(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('nothing to prune');
  });

  it('refuses to delete orphans without --yes', async () => {
    await setupWithOrphan();
    const result = await prune(dir);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('blogpost');
    await expect(readFile(join(dir, '.mockingpug', 'db', 'blogpost.json'), 'utf-8')).resolves.toBeTruthy();
  });

  it('deletes only orphan entities when confirmed, leaving live ones untouched', async () => {
    await setupWithOrphan();
    const result = await prune(dir, { yes: true });
    expect(result.ok).toBe(true);
    expect(result.messages).toEqual(['pruned "blogpost"']);

    await expect(readFile(join(dir, '.mockingpug', 'db', 'blogpost.json'), 'utf-8')).rejects.toThrow();
    await expect(readFile(join(dir, '.mockingpug', 'db', 'user.json'), 'utf-8')).resolves.toBeTruthy();
  });
});
