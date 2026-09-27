import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { link } from '../../src/cli/commands/link.js';
import { pull } from '../../src/cli/commands/pull.js';
import { login } from '../../src/cli/commands/login.js';

let dir: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mpug-cmd-'));
  process.env.MOCKINGPUG_CONFIG_HOME = join(dir, 'config');
  process.env.MOCKINGPUG_URL = 'https://cloud.test';
  process.env.MOCKINGPUG_TOKEN = 'mp_ci_test'; // avoids device-auth for link/pull
});

afterEach(async () => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init))));
}

const PULL_BODY = {
  project: { id: 'proj_x', name: 'My App', seed: 'ci-seed' },
  version: 4,
  publishedAt: '2026-01-01',
  tables: {
    users: { amount: 10, data: { id: 'number.increment', email: 'email' } },
  },
  dictionaries: { role: [{ value: 'ADMIN' }] },
};

/** Routes a fake fetch by URL to the right cloud endpoint; `onPush` captures the push body. */
function stubCloud(opts: { project?: object; pull?: object; onPush?: (body: unknown) => Response } = {}) {
  const project = opts.project ?? { id: 'proj_x', name: 'My App', latestVersion: 4, url: 'https://cloud/app/proj_x' };
  stubFetch((url, init) => {
    if (url.includes('/push')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return opts.onPush ? opts.onPush(body) : new Response(JSON.stringify({ project: { id: 'proj_x', name: 'My App', url: 'https://cloud/app/proj_x' }, draft: { summary: '1 table' } }), { status: 200 });
    }
    if (url.includes('/pull')) return new Response(JSON.stringify(opts.pull ?? PULL_BODY), { status: 200 });
    return new Response(JSON.stringify(project), { status: 200 });
  });
}

describe('link', () => {
  it('no local mocks → writes project.json and mirrors the published version down', async () => {
    stubCloud();
    const result = await link(dir, 'proj_x');
    expect(result.ok).toBe(true);
    expect(JSON.parse(await readFile(join(dir, '.mockingpug', 'project.json'), 'utf-8')).projectId).toBe('proj_x');
    // pull ran: cloud tables mirrored to tables/
    expect(JSON.parse(await readFile(join(dir, 'mock', 'tables', 'users.json'), 'utf-8')).amount).toBe(10);
  });

  it('nothing published yet → links without pulling', async () => {
    stubCloud({ project: { id: 'proj_x', name: 'My App', latestVersion: null } });
    const result = await link(dir, 'proj_x');
    expect(result.ok).toBe(true);
    expect(result.messages.some((m) => m.includes('nothing published'))).toBe(true);
  });

  it('local mocks present → pushes them to the draft (legacy api/ decomposed, seed included), no pull', async () => {
    // a legacy schema + a v2 dictionary
    await mkdir(join(dir, 'mock', 'api', 'users'), { recursive: true });
    await writeFile(join(dir, 'mock', 'api', 'users', 'schema.json'), JSON.stringify({ amount: 3, data: { id: 'uuid' }, bypass: true }), 'utf-8');
    await mkdir(join(dir, 'mock', 'data'), { recursive: true });
    await writeFile(join(dir, 'mock', 'data', 'role.json'), JSON.stringify([{ value: 'ADMIN' }]), 'utf-8');
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { seed: 'local-seed' };", 'utf-8');

    let pushed: any;
    stubCloud({ onPush: (body) => { pushed = body; return new Response(JSON.stringify({ project: { id: 'proj_x', name: 'My App', url: 'https://cloud/app/proj_x' }, draft: { summary: 'ok' } }), { status: 200 }); } });

    const result = await link(dir, 'proj_x');
    expect(result.ok).toBe(true);
    // legacy api/users → tables.users (data only) + 6 routes with bypass on each endpoint
    expect(pushed.tables.users).toEqual({ amount: 3, data: { id: 'uuid' } });
    expect(pushed.routes.map((r: { id: string }) => r.id)).toEqual(['users_list', 'users_create', 'users_get', 'users_update', 'users_patch', 'users_delete']);
    expect(pushed.routes.every((r: { bypass?: boolean }) => r.bypass === true)).toBe(true);
    expect(pushed.dictionaries.role).toEqual([{ value: 'ADMIN' }]);
    expect(pushed.seed).toBe('local-seed');
    // no pull happened → tables/ not written
    await expect(readFile(join(dir, 'mock', 'tables', 'users.json'), 'utf-8')).rejects.toThrow();
    expect(result.messages.some((m) => m.includes('Publish'))).toBe(true);
  });

  it('--no-push links only, even with local mocks', async () => {
    await mkdir(join(dir, 'mock', 'tables'), { recursive: true });
    await writeFile(join(dir, 'mock', 'tables', 'x.json'), JSON.stringify({ amount: 1, data: { id: 'uuid' } }), 'utf-8');
    stubCloud();
    const result = await link(dir, 'proj_x', { noPush: true });
    expect(result.ok).toBe(true);
    expect(result.messages.some((m) => m.includes('pull --yes'))).toBe(true);
  });

  it('push 409 (busy) → readable advice', async () => {
    await mkdir(join(dir, 'mock', 'tables'), { recursive: true });
    await writeFile(join(dir, 'mock', 'tables', 'x.json'), JSON.stringify({ amount: 1, data: { id: 'uuid' } }), 'utf-8');
    stubCloud({ onPush: () => new Response(JSON.stringify({ error: { code: 'CLOUD-BUSY', message: 'Ann is editing' } }), { status: 409 }) });
    const result = await link(dir, 'proj_x');
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('close the cloud editor');
  });

  it('push 403 (CI token) → readable advice', async () => {
    await mkdir(join(dir, 'mock', 'tables'), { recursive: true });
    await writeFile(join(dir, 'mock', 'tables', 'x.json'), JSON.stringify({ amount: 1, data: { id: 'uuid' } }), 'utf-8');
    stubCloud({ onPush: () => new Response(JSON.stringify({ error: { code: 'CLOUD-FORBIDDEN', message: 'read-only token' } }), { status: 403 }) });
    const result = await link(dir, 'proj_x');
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('edit schema');
  });

  it('fails clearly without a token', async () => {
    delete process.env.MOCKINGPUG_TOKEN;
    const result = await link(dir, 'proj_x');
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('login');
  });

  it('maps a cloud 404 to a readable failure', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { code: 'CLOUD-PROJECT', message: 'not found' } }), { status: 404 }));
    const result = await link(dir, 'proj_x');
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('not found');
  });
});

describe('pull (1:1 mirror, tables/ + routes/ + data/)', () => {
  it('writes tables to mock/tables/<name>.json and dictionaries to mock/data', async () => {
    await mkdir(join(dir, '.mockingpug'), { recursive: true });
    await writeFile(join(dir, '.mockingpug', 'project.json'), JSON.stringify({ projectId: 'proj_x' }), 'utf-8');
    stubFetch(() => new Response(JSON.stringify(PULL_BODY), { status: 200 }));

    const result = await pull(dir);
    expect(result.ok).toBe(true);
    const table = JSON.parse(await readFile(join(dir, 'mock', 'tables', 'users.json'), 'utf-8'));
    expect(table).toEqual({ amount: 10, data: { id: 'number.increment', email: 'email' } });
    const dict = JSON.parse(await readFile(join(dir, 'mock', 'data', 'role.json'), 'utf-8'));
    expect(dict).toEqual([{ value: 'ADMIN' }]);
  });

  it('writes cloud routes grouped by table into mock/routes/<entity>.json', async () => {
    const body = {
      ...PULL_BODY,
      routes: [
        { id: 'users_list', kind: 'list', method: 'GET', path: '/users', from: 'users' },
        { id: 'ping', kind: 'static', method: 'GET', path: '/ping', status: 200, body: { ok: true } },
      ],
    };
    stubFetch(() => new Response(JSON.stringify(body), { status: 200 }));
    const result = await pull(dir, { project: 'proj_x' });
    expect(result.ok).toBe(true);
    const usersRoutes = JSON.parse(await readFile(join(dir, 'mock', 'routes', 'users.json'), 'utf-8'));
    expect(usersRoutes.map((r: { id: string }) => r.id)).toEqual(['users_list']);
    const shared = JSON.parse(await readFile(join(dir, 'mock', 'routes', '_routes.json'), 'utf-8'));
    expect(shared.map((r: { id: string }) => r.id)).toEqual(['ping']); // tagless static route
  });

  it('mirrors 1:1: removes local artifacts not in cloud (with --yes), leaves handlers/ alone', async () => {
    // a local table + a handler file that cloud does not know about
    await mkdir(join(dir, 'mock', 'tables'), { recursive: true });
    await writeFile(join(dir, 'mock', 'tables', 'ghost.json'), JSON.stringify({ amount: 1, data: { id: 'uuid' } }), 'utf-8');
    await mkdir(join(dir, 'mock', 'handlers'), { recursive: true });
    await writeFile(join(dir, 'mock', 'handlers', 'pay.ts'), 'export default () => {};', 'utf-8');
    stubFetch(() => new Response(JSON.stringify(PULL_BODY), { status: 200 }));

    // blocked without --yes (would remove ghost.json)
    const blocked = await pull(dir, { project: 'proj_x' });
    expect(blocked.ok).toBe(false);
    expect(blocked.warnings.some((w) => w.includes('would remove') && w.includes('ghost.json'))).toBe(true);

    const forced = await pull(dir, { project: 'proj_x', yes: true });
    expect(forced.ok).toBe(true);
    await expect(readFile(join(dir, 'mock', 'tables', 'ghost.json'), 'utf-8')).rejects.toThrow(); // removed
    expect(await readFile(join(dir, 'mock', 'handlers', 'pay.ts'), 'utf-8')).toContain('export default'); // untouched
  });

  it('removes legacy mock/api schemas when mirroring the new format', async () => {
    await mkdir(join(dir, 'mock', 'api', 'users'), { recursive: true });
    await writeFile(join(dir, 'mock', 'api', 'users', 'schema.json'), JSON.stringify({ amount: 1, data: { id: 'uuid' } }), 'utf-8');
    stubFetch(() => new Response(JSON.stringify(PULL_BODY), { status: 200 }));

    const result = await pull(dir, { project: 'proj_x', yes: true });
    expect(result.ok).toBe(true);
    await expect(readFile(join(dir, 'mock', 'api', 'users', 'schema.json'), 'utf-8')).rejects.toThrow();
    expect(JSON.parse(await readFile(join(dir, 'mock', 'tables', 'users.json'), 'utf-8')).amount).toBe(10);
  });

  it('accepts --project instead of a link file', async () => {
    stubFetch(() => new Response(JSON.stringify(PULL_BODY), { status: 200 }));
    const result = await pull(dir, { project: 'proj_x' });
    expect(result.ok).toBe(true);
  });

  it('rejects a path-traversal table name from the cloud response (no file written outside mock/)', async () => {
    const evil = { ...PULL_BODY, tables: { '../../evil': { amount: 1, data: { id: 'uuid' } } } };
    stubFetch(() => new Response(JSON.stringify(evil), { status: 200 }));
    const result = await pull(dir, { project: 'proj_x', yes: true });
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('unsafe artifact name');
    await expect(readFile(join(dir, 'evil.json'), 'utf-8')).rejects.toThrow(); // nothing escaped mock/
  });

  it('does not overwrite a locally-changed table without --yes, but does with it', async () => {
    stubFetch(() => new Response(JSON.stringify(PULL_BODY), { status: 200 }));
    await mkdir(join(dir, 'mock', 'tables'), { recursive: true });
    const target = join(dir, 'mock', 'tables', 'users.json');
    await writeFile(target, JSON.stringify({ amount: 999, data: { id: 'uuid' } }), 'utf-8');

    const blocked = await pull(dir, { project: 'proj_x' });
    expect(blocked.ok).toBe(false);
    expect(blocked.warnings.some((w) => w.includes('overwrite local changes'))).toBe(true);
    expect(JSON.parse(await readFile(target, 'utf-8')).amount).toBe(999);

    const forced = await pull(dir, { project: 'proj_x', yes: true });
    expect(forced.ok).toBe(true);
    expect(JSON.parse(await readFile(target, 'utf-8')).amount).toBe(10);
  });

  it('pendingPush holds off pull (nothing written) until --force', async () => {
    stubFetch(() => new Response(JSON.stringify({ ...PULL_BODY, pendingPush: true }), { status: 200 }));

    const held = await pull(dir, { project: 'proj_x' });
    expect(held.ok).toBe(false);
    expect(held.messages[0]).toContain('waiting to be published');
    await expect(readFile(join(dir, 'mock', 'tables', 'users.json'), 'utf-8')).rejects.toThrow(); // nothing written

    const forced = await pull(dir, { project: 'proj_x', force: true });
    expect(forced.ok).toBe(true);
    expect(JSON.parse(await readFile(join(dir, 'mock', 'tables', 'users.json'), 'utf-8')).amount).toBe(10);
  });

  it('warns when the cloud seed differs from mock.config.js', async () => {
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { seed: 'local-seed' };", 'utf-8');
    stubFetch(() => new Response(JSON.stringify(PULL_BODY), { status: 200 }));
    const result = await pull(dir, { project: 'proj_x' });
    expect(result.warnings.some((w) => w.includes('seed'))).toBe(true);
  });

  it('fails without a linked project and no --project', async () => {
    stubFetch(() => new Response('{}', { status: 200 }));
    const result = await pull(dir);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('link');
  });
});

describe('login', () => {
  it('polls device-auth and stores the granted token in config', async () => {
    let tokenCalls = 0;
    stubFetch((url) => {
      if (url.endsWith('/api/cli/device')) {
        return new Response(JSON.stringify({ deviceCode: 'd', userCode: 'WXYZ', verificationUri: 'u', verificationUriComplete: 'uc', expiresIn: 300, interval: 0 }), { status: 200 });
      }
      // first token poll pending, then granted
      tokenCalls++;
      return tokenCalls === 1
        ? new Response('{}', { status: 428 })
        : new Response(JSON.stringify({ token: 'mp_cli_new', user: { email: 'me@x.dev' } }), { status: 200 });
    });
    const result = await login({ open: false });
    expect(result.ok).toBe(true);
    const auth = JSON.parse(await readFile(join(dir, 'config', 'mockingpug', 'auth.json'), 'utf-8'));
    expect(auth.token).toBe('mp_cli_new');
  });
});
