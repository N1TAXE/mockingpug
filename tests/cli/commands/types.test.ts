import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { types } from '../../../src/cli/commands/types.js';

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
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-types-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('types', () => {
  it('writes .mockingpug/types/index.d.ts with one interface per entity', async () => {
    await writeFiles(validProject);
    const result = await types(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('2 entities');

    const written = await readFile(join(dir, '.mockingpug', 'types', 'index.d.ts'), 'utf-8');
    expect(written).toContain('export interface User {');
    expect(written).toContain('export interface Blogpost {');
    expect(written).toContain('role: "ADMIN" | "USER";');
    expect(written).toContain('posts: Blogpost[];');
  });

  it('reports "nothing to generate" when there are no entities', async () => {
    await mkdir(join(dir, 'mock', 'api'), { recursive: true });
    const result = await types(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('nothing to generate');
  });

  it('fails with a SchemaError-derived message on an invalid schema', async () => {
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { email: 'emial' } }) });
    const result = await types(dir);
    expect(result.ok).toBe(false);
  });
});
