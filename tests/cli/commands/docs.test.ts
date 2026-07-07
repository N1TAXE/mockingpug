import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docs } from '../../../src/cli/commands/docs.js';

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
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-docs-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('docs', () => {
  it('writes .mockingpug/docs/{openapi.json,index.html} describing every entity', async () => {
    await writeFiles(validProject);
    const result = await docs(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('2 entities');

    const spec = JSON.parse(await readFile(join(dir, '.mockingpug', 'docs', 'openapi.json'), 'utf-8')) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths).toHaveProperty('/user');
    expect(spec.paths).toHaveProperty('/blogpost/{id}');
    expect(spec.components.schemas).toHaveProperty('User');
    expect(spec.components.schemas).toHaveProperty('Blogpost');

    const html = await readFile(join(dir, '.mockingpug', 'docs', 'index.html'), 'utf-8');
    expect(html).toContain('<section id="entity-user"');
    expect(html).toContain('<section id="entity-blogpost"');
  });

  it('reports "nothing to generate" when there are no entities, and writes nothing', async () => {
    await mkdir(join(dir, 'mock', 'api'), { recursive: true });
    const result = await docs(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('nothing to generate');
    await expect(readFile(join(dir, '.mockingpug', 'docs', 'openapi.json'), 'utf-8')).rejects.toThrow();
  });

  it('fails with a SchemaError-derived message on an invalid schema', async () => {
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { email: 'emial' } }) });
    const result = await docs(dir);
    expect(result.ok).toBe(false);
  });

  it('respects a custom baseUrl from mock.config.js', async () => {
    await writeFiles({
      ...validProject,
      'mock.config.js': "module.exports = { baseUrl: '/backend' };",
    });
    await docs(dir);
    const spec = JSON.parse(await readFile(join(dir, '.mockingpug', 'docs', 'openapi.json'), 'utf-8')) as {
      servers: Array<{ url: string }>;
    };
    expect(spec.servers[0]!.url).toBe('/backend');
  });

  it('writes nothing and reports disabled when "docs.enabled: false" in mock.config.js', async () => {
    await writeFiles({
      ...validProject,
      'mock.config.js': 'module.exports = { docs: { enabled: false } };',
    });
    const result = await docs(dir);
    expect(result.ok).toBe(true);
    expect(result.messages[0]).toContain('disabled');
    await expect(readFile(join(dir, '.mockingpug', 'docs', 'openapi.json'), 'utf-8')).rejects.toThrow();
  });
});
