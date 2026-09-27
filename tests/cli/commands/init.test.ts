import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { init } from '../../../src/cli/commands/init.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-init-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('init', () => {
  it('creates mock.config.js and the mock/tables + routes + data directories', async () => {
    const result = await init(dir);
    expect(result.ok).toBe(true);

    const config = await readFile(join(dir, 'mock.config.js'), 'utf-8');
    expect(config).toContain('module.exports');

    expect(await readdir(join(dir, 'mock', 'tables'))).toContain('example.json');
    expect(await readdir(join(dir, 'mock', 'routes'))).toContain('example.json');
    expect(await readdir(join(dir, 'mock', 'data'))).toEqual([]);
  });

  it('writes an example table + routes that loadProject can actually parse into endpoints', async () => {
    await init(dir);
    const { loadProject } = await import('../../../src/cli/schemaLoader.js');
    const project = await loadProject(dir, 'mock');
    expect(project.entities.example!.amount).toBe(100);
    expect(project.routes.map((r) => r.id).sort()).toEqual(['example_get', 'example_list']);
  });

  it('is idempotent: does not overwrite an existing mock.config.js', async () => {
    await writeFile(join(dir, 'mock.config.js'), '// custom, hand-written config\n', 'utf-8');
    const result = await init(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('already exists');
    const config = await readFile(join(dir, 'mock.config.js'), 'utf-8');
    expect(config).toContain('hand-written');
  });

  it('does not add an example table if mock/tables already has entries', async () => {
    await mkdir(join(dir, 'mock', 'tables'), { recursive: true });
    await writeFile(join(dir, 'mock', 'tables', 'user.json'), JSON.stringify({ amount: 1, data: { id: 'uuid' } }), 'utf-8');

    await init(dir);

    expect(await readdir(join(dir, 'mock', 'tables'))).toEqual(['user.json']);
  });

  it('reports npm as the detected package manager when no lockfile is present', async () => {
    const result = await init(dir);
    expect(result.messages.some((m) => m.includes('detected package manager: npm'))).toBe(true);
    expect(result.messages.some((m) => m.includes('npx mpug doctor'))).toBe(true);
    expect(result.messages.some((m) => m.includes('npx mpug generate'))).toBe(true);
  });

  it('detects pnpm from pnpm-lock.yaml and prints pnpm-flavored next steps', async () => {
    await writeFile(join(dir, 'pnpm-lock.yaml'), '', 'utf-8');
    const result = await init(dir);
    expect(result.messages.some((m) => m.includes('detected package manager: pnpm'))).toBe(true);
    expect(result.messages.some((m) => m.includes('pnpm exec mpug doctor'))).toBe(true);
  });

  it('detects deno from deno.json and prints deno-flavored next steps', async () => {
    await writeFile(join(dir, 'deno.json'), '{}', 'utf-8');
    const result = await init(dir);
    expect(result.messages.some((m) => m.includes('detected package manager: deno'))).toBe(true);
    expect(result.messages.some((m) => m.includes('deno run -A npm:mockingpug doctor'))).toBe(true);
  });
});
