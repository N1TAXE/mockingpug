import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../../src/cli/commands/migrate.js';
import { loadProject } from '../../../src/cli/schemaLoader.js';

let dir: string;

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-migrate-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('migrate', () => {
  it('reports nothing to do when there is no legacy mock/api', async () => {
    const result = await migrate(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('nothing to migrate');
  });

  it('dry-run (default) writes nothing and leaves api/ intact', async () => {
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 5, data: { id: 'uuid' } }) });
    const result = await migrate(dir);
    expect(result.ok).toBe(true);
    expect(result.messages.join('\n')).toContain('[dry run]');
    expect(existsSync(join(dir, 'mock', 'tables', 'user.json'))).toBe(false);
    expect(existsSync(join(dir, 'mock', 'api', 'user', 'schema.json'))).toBe(true);
  });

  it('--yes writes tables/ + routes/, drops api/, and produces a loadable project', async () => {
    await writeFiles({
      'mock/api/user/schema.json': JSON.stringify({ amount: 5, data: { id: 'number.increment', name: 'username.FS' }, bypass: true }),
      'mock/api/post/schema.json': JSON.stringify({ amount: 3, data: { id: 'uuid' } }),
    });

    const result = await migrate(dir, { yes: true });
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'mock', 'api'))).toBe(false); // emptied and removed

    const userTable = JSON.parse(await readFile(join(dir, 'mock', 'tables', 'user.json'), 'utf-8'));
    expect(userTable).toEqual({ amount: 5, data: { id: 'number.increment', name: 'username.FS' } }); // bypass dropped

    const userRoutes = JSON.parse(await readFile(join(dir, 'mock', 'routes', 'user.json'), 'utf-8')) as Record<string, unknown>[];
    expect(userRoutes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /user',
      'POST /user',
      'GET /user/:id',
      'PUT /user/:id',
      'PATCH /user/:id',
      'DELETE /user/:id',
    ]);
    expect(userRoutes.every((r) => r.bypass === true)).toBe(true); // bypass moved to every endpoint

    // The migrated project loads: tables become internal, routes drive the API.
    const project = await loadProject(dir, 'mock');
    expect(Object.keys(project.entities).sort()).toEqual(['post', 'user']);
    expect(project.routes.some((r) => r.kind === 'resource')).toBe(false); // no legacy resource routes left
    expect(project.routes).toHaveLength(12); // 6 per entity
  });

  it('does not emit /:id routes for a table with no id field', async () => {
    await writeFiles({ 'mock/api/settings/schema.json': JSON.stringify({ amount: 1, data: { theme: 'boolean' } }) });
    await migrate(dir, { yes: true });
    const routes = JSON.parse(await readFile(join(dir, 'mock', 'routes', 'settings.json'), 'utf-8')) as Array<{ id: string; path: string }>;
    expect(routes.map((r) => r.id)).toEqual(['settings_list', 'settings_create']); // no _get/_update/_patch/_delete
    expect(routes.every((r) => !r.path.includes(':id'))).toBe(true);
  });

  it('skips an entity whose target files already exist, without clobbering', async () => {
    await writeFiles({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/tables/user.json': JSON.stringify({ amount: 999, data: { id: 'uuid' } }),
    });
    const result = await migrate(dir, { yes: true });
    expect(result.warnings.join('\n')).toContain('skipping "user"');
    // existing file untouched
    const kept = JSON.parse(await readFile(join(dir, 'mock', 'tables', 'user.json'), 'utf-8'));
    expect(kept.amount).toBe(999);
  });
});
