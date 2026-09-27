import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProject } from '../../src/cli/schemaLoader.js';
import { SchemaError } from '../../src/core/index.js';

let dir: string;

async function writeMockProject(files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-schemaLoader-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadProject: the real mock/ example (user, blogpost, role)', () => {
  it('loads both entities and the custom dictionary, fully parsed', async () => {
    await writeMockProject({
      'mock/api/user/schema.json': JSON.stringify({
        amount: 1000,
        data: {
          id: 'number.increment',
          name: 'username.FS',
          email: 'email[gmail.com]',
          password: 'hash',
          role: 'role',
          posts: 'data.blogpost',
        },
      }),
      'mock/api/blogpost/schema.json': JSON.stringify({
        amount: 1000,
        data: { id: 'uuid', title: 'lorem.32', author: 'data.user.id', text: 'lorem.240' },
      }),
      'mock/data/role.json': JSON.stringify([
        { value: 'ADMIN', max: 5 },
        { value: 'USER', chance: 0.9 },
        { value: 'MODER', chance: 0.2 },
      ]),
    });

    const project = await loadProject(dir, 'mock');

    expect(Object.keys(project.entities).sort()).toEqual(['blogpost', 'user']);
    expect(project.entities.user!.amount).toBe(1000);
    expect(project.entities.user!.data.role).toEqual({ kind: 'custom', name: 'role' });
    expect(project.entities.user!.data.posts).toEqual({ kind: 'crossRef', entity: 'blogpost' });
    expect(project.entities.blogpost!.data.author).toEqual({ kind: 'crossRef', entity: 'user', field: 'id' });
    expect(project.customDictionaries.role).toHaveLength(3);
  });
});

describe('loadProject: structure and edge cases', () => {
  it('returns empty entities/dictionaries when mock/ does not exist at all', async () => {
    const project = await loadProject(dir, 'mock');
    expect(project.entities).toEqual({});
    expect(project.customDictionaries).toEqual({});
  });

  it('ignores dynamic [param] route segments', async () => {
    await writeMockProject({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/api/user/[id]/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
    });
    const project = await loadProject(dir, 'mock');
    expect(Object.keys(project.entities)).toEqual(['user']);
  });

  it('throws SchemaError on invalid JSON', async () => {
    await writeMockProject({ 'mock/api/user/schema.json': '{ not valid' });
    await expect(loadProject(dir, 'mock')).rejects.toThrow(SchemaError);
  });

  it('throws SchemaError when the schema root is not a JSON object (e.g. a bare number)', async () => {
    await writeMockProject({ 'mock/api/user/schema.json': '42' });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-SCHEMA-006' });
  });

  it('rethrows a non-ENOENT failure scanning mock/api (e.g. "api" is a file, not a directory)', async () => {
    await mkdir(join(dir, 'mock'), { recursive: true });
    await writeFile(join(dir, 'mock', 'api'), 'not a directory', 'utf-8');
    await expect(loadProject(dir, 'mock')).rejects.toThrow();
  });

  it('rethrows a non-ENOENT failure scanning mock/data (e.g. "data" is a file, not a directory)', async () => {
    await mkdir(join(dir, 'mock'), { recursive: true });
    await writeFile(join(dir, 'mock', 'data'), 'not a directory', 'utf-8');
    await expect(loadProject(dir, 'mock')).rejects.toThrow();
  });

  it('throws SchemaError when "amount" is missing or not a number', async () => {
    await writeMockProject({ 'mock/api/user/schema.json': JSON.stringify({ data: { id: 'uuid' } }) });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-SCHEMA-007' });
  });

  it('throws SchemaError when "data" is missing or not an object', async () => {
    await writeMockProject({ 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: 'nope' }) });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-SCHEMA-008' });
  });

  it('throws SchemaError when a field value is not a string', async () => {
    await writeMockProject({ 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 42 } }) });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-SCHEMA-009' });
  });

  it('propagates a helpful typo suggestion for an unknown generator type', async () => {
    await writeMockProject({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { email: 'emial[gmail.com]' } }),
    });
    try {
      await loadProject(dir, 'mock');
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).hint).toContain('email');
      expect((error as SchemaError).location?.file).toContain('user');
    }
  });

  it('throws SchemaError (MP-SCHEMA-005) on invalid JSON in a custom dictionary file', async () => {
    await writeMockProject({ 'mock/data/role.json': '{ not valid json' });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-SCHEMA-005' });
  });

  it('throws SchemaError when a custom dictionary is not a JSON array', async () => {
    await writeMockProject({ 'mock/data/role.json': JSON.stringify({ not: 'an array' }) });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-SCHEMA-010' });
  });

  it('throws SchemaError on two schema files resolving to the same entity name', async () => {
    await writeMockProject({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/api/nested/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
    });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-SCHEMA-011' });
  });

  it('resolves bare-word custom types against mock/data/*.json', async () => {
    await writeMockProject({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { role: 'role' } }),
      'mock/data/role.json': JSON.stringify([{ value: 'USER' }]),
    });
    const project = await loadProject(dir, 'mock');
    expect(project.entities.user!.data.role).toEqual({ kind: 'custom', name: 'role' });
  });
});

describe('loadProject: routes/*.json (R5)', () => {
  it('legacy api/ tables get a full-CRUD resource route; tables/ tables do not', async () => {
    await writeMockProject({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/tables/audit.json': JSON.stringify({ amount: 2, data: { id: 'uuid' } }),
    });
    const project = await loadProject(dir, 'mock');
    // both tables generated
    expect(Object.keys(project.entities).sort()).toEqual(['audit', 'user']);
    // only the legacy one is exposed, as a resource route
    expect(project.routes).toEqual([{ id: 'user', kind: 'resource', path: '/user', table: 'user', methods: ['list', 'get', 'create', 'update', 'delete'] }]);
  });

  it('a tables/ table with no route is internal (no URL); an authored route exposes it', async () => {
    await writeMockProject({
      'mock/tables/order.json': JSON.stringify({ amount: 3, data: { id: 'uuid' } }),
      'mock/routes/orders.json': JSON.stringify({ id: 'orders_list', kind: 'list', path: '/orders', method: 'GET', from: 'order' }),
    });
    const project = await loadProject(dir, 'mock');
    expect(project.entities.order!.amount).toBe(3);
    expect(project.routes.map((r) => r.id)).toEqual(['orders_list']);
  });

  it('a name defined in both api/ and tables/ is a duplicate error', async () => {
    await writeMockProject({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/tables/user.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
    });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-SCHEMA-011' });
  });

  it('loads routes from a single file (array) and a file with one object', async () => {
    await writeMockProject({
      'mock/tables/user.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/tables/blogpost.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/routes/users.json': JSON.stringify([
        { id: 'users_list', kind: 'list', path: '/users', method: 'GET', from: 'user' },
        { id: 'user-posts', kind: 'list', path: '/users/:id/posts', method: 'GET', from: 'blogpost', where: { author: ':id' } },
        { id: 'user-create', kind: 'mutation', path: '/users', method: 'POST', from: 'user', body: '{"name":"x"}' },
      ]),
      'mock/routes/ping.json': JSON.stringify({ id: 'ping', kind: 'static', path: '/ping', method: 'GET', status: 200, body: { ok: true } }),
    });
    const project = await loadProject(dir, 'mock');
    expect(project.routes.map((r) => r.id).sort()).toEqual(['ping', 'user-create', 'user-posts', 'users_list']);
  });

  it('rejects an authored resource kind (internal/legacy only)', async () => {
    await writeMockProject({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/routes/r.json': JSON.stringify({ id: 'r', kind: 'resource', path: '/users', table: 'user', methods: ['list'] }),
    });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-ROUTE-002' });
  });

  it('rejects an unknown kind, a missing kind-specific field, and a duplicate id', async () => {
    const base = { 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }) };

    await writeMockProject({ ...base, 'mock/routes/r.json': JSON.stringify({ id: 'r', kind: 'nope', path: '/r' }) });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-ROUTE-002' });

    dir = await mkdtemp(join(tmpdir(), 'mockingpug-schemaLoader-'));
    await writeMockProject({ ...base, 'mock/routes/r.json': JSON.stringify({ id: 'r', kind: 'list', path: '/r' }) });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-ROUTE-006' });

    dir = await mkdtemp(join(tmpdir(), 'mockingpug-schemaLoader-'));
    await writeMockProject({
      ...base,
      'mock/routes/r.json': JSON.stringify([
        { id: 'dup', kind: 'static', path: '/a', method: 'GET', status: 200, body: 1 },
        { id: 'dup', kind: 'static', path: '/b', method: 'GET', status: 200, body: 2 },
      ]),
    });
    await expect(loadProject(dir, 'mock')).rejects.toMatchObject({ code: 'MP-ROUTE-004' });
  });
});
