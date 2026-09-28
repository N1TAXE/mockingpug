import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codegen } from '../../../src/cli/commands/codegen.js';

let dir: string;
async function write(rel: string, content: string): Promise<void> {
  const full = join(dir, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-codegen-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('codegen', () => {
  it('writes mock/.generated/schemas.ts with parsed schemas, routes, dictionaries and config', async () => {
    await write('mock/tables/user.json', JSON.stringify({ amount: 3, data: { id: 'number.increment', role: 'role' } }));
    await write('mock/routes/user.json', JSON.stringify([{ id: 'users_list', kind: 'list', method: 'GET', path: '/users', from: 'user' }]));
    await write('mock/data/role.json', JSON.stringify([{ value: 'ADMIN' }]));

    const result = await codegen(dir);
    expect(result.ok).toBe(true);

    const out = await readFile(join(dir, 'mock', '.generated', 'schemas.ts'), 'utf-8');
    expect(out).toContain('export const schemas: Record<string, EntitySchema>');
    expect(out).toContain('export const routes: Route[]');
    expect(out).toContain('export const customDictionaries');
    expect(out).toContain('export const mockConfig');
    // parsed, not raw DSL: `role` resolved to a custom-type spec, list route present
    expect(out).toContain('"kind": "custom"');
    expect(out).toContain('"id": "users_list"');
    expect(out).toContain('"role"'); // dictionary carried
  });

  it('fails cleanly on a broken schema', async () => {
    await write('mock/tables/user.json', JSON.stringify({ amount: 1, data: { id: 'not-a-generator' } }));
    const result = await codegen(dir);
    expect(result.ok).toBe(false);
  });
});
