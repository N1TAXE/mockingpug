import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authConfigPath,
  cloudBaseUrl,
  readAuthConfig,
  readLinkFile,
  resolveToken,
  writeAuthConfig,
  writeLinkFile,
} from '../../src/cli/cloud/config.js';
import { appIdentity } from '../../src/cli/cloud/appIdentity.js';
import { CloudError, deviceStart, getProject, pollToken, pullProject } from '../../src/cli/cloud/client.js';
import { cloudAdvice } from '../../src/cli/cloud/advice.js';

let dir: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mpug-cloud-'));
  process.env.MOCKINGPUG_CONFIG_HOME = join(dir, 'config');
  delete process.env.MOCKINGPUG_TOKEN;
  delete process.env.MOCKINGPUG_URL;
});

afterEach(async () => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init))));
}

describe('cloud config', () => {
  it('cloudBaseUrl honors MOCKINGPUG_URL and trims trailing slash', () => {
    process.env.MOCKINGPUG_URL = 'https://staging.example.com/';
    expect(cloudBaseUrl()).toBe('https://staging.example.com');
  });

  it('resolveToken: MOCKINGPUG_TOKEN wins over the config file', async () => {
    await writeAuthConfig({ token: 'mp_cli_fromconfig' });
    expect(await resolveToken()).toBe('mp_cli_fromconfig');
    process.env.MOCKINGPUG_TOKEN = 'mp_ci_fromenv';
    expect(await resolveToken()).toBe('mp_ci_fromenv');
  });

  it('resolveToken is undefined when neither is set', async () => {
    expect(await resolveToken()).toBeUndefined();
  });

  it('auth config round-trips at the relocated path', async () => {
    await writeAuthConfig({ token: 't', user: { email: 'a@b.c' } });
    expect(authConfigPath()).toContain('mockingpug');
    expect((await readAuthConfig())?.user?.email).toBe('a@b.c');
  });

  it('link file round-trips in the project', async () => {
    await writeLinkFile(dir, { projectId: 'proj_x' });
    expect((await readLinkFile(dir))?.projectId).toBe('proj_x');
  });
});

describe('appIdentity', () => {
  it('produces a stable sha256 App-Id and detects framework from package.json', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'my-app', dependencies: { next: '15' } }), 'utf-8');
    const a = await appIdentity(dir);
    const b = await appIdentity(dir);
    expect(a['X-Mockingpug-App-Id']).toMatch(/^[0-9a-f]{64}$/);
    expect(a['X-Mockingpug-App-Id']).toBe(b['X-Mockingpug-App-Id']); // stable
    expect(a['X-Mockingpug-Framework']).toBe('next');
  });

  it('falls back to unknown framework without package.json', async () => {
    const a = await appIdentity(dir);
    expect(a['X-Mockingpug-Framework']).toBe('unknown');
  });
});

describe('cloud client', () => {
  it('deviceStart returns the device payload', async () => {
    stubFetch(() => new Response(JSON.stringify({ deviceCode: 'd', userCode: 'ABCD', verificationUri: 'u', verificationUriComplete: 'uc', expiresIn: 300, interval: 1 }), { status: 200 }));
    const device = await deviceStart();
    expect(device.userCode).toBe('ABCD');
  });

  it('pollToken maps 200/428/410 to granted/pending/expired', async () => {
    stubFetch(() => new Response(JSON.stringify({ token: 'mp_cli_x', user: { email: 'a@b.c' } }), { status: 200 }));
    expect((await pollToken('d')).status).toBe('granted');
    stubFetch(() => new Response('{}', { status: 428 }));
    expect((await pollToken('d')).status).toBe('pending');
    stubFetch(() => new Response('{}', { status: 410 }));
    expect((await pollToken('d')).status).toBe('expired');
  });

  it('parses an error body into CloudError with code + message', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { code: 'CLOUD-PROJECT', message: 'no such project' } }), { status: 404 }));
    await expect(getProject('proj_x', 't')).rejects.toMatchObject({ code: 'CLOUD-PROJECT', message: 'no such project', status: 404 });
  });

  it('wraps a transport failure (DNS/offline) in a CloudError instead of throwing raw', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND app.mockingpug.com'))));
    await expect(deviceStart()).rejects.toMatchObject({ name: 'CloudError', code: 'CLOUD-NETWORK' });
  });

  it('pull sends the auth + app headers', async () => {
    let sentHeaders: Record<string, string> = {};
    stubFetch((_url, init) => {
      sentHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ project: { id: 'p', name: 'P' }, version: 3, publishedAt: 'now', tables: {} }), { status: 200 });
    });
    await pullProject('proj_x', 'tok', { 'X-Mockingpug-App-Id': 'abc' }, 3);
    expect(sentHeaders.Authorization).toBe('Bearer tok');
    expect(sentHeaders['X-Mockingpug-App-Id']).toBe('abc');
  });
});

describe('cloudAdvice', () => {
  it('maps known codes to actionable text', () => {
    expect(cloudAdvice(new CloudError('CLOUD-AUTH', 'nope', 401))).toContain('mockingpug login');
    expect(cloudAdvice(new CloudError('CLOUD-LIMIT', 'too many', 403))).toContain('unlink');
    expect(cloudAdvice(new CloudError('CLOUD-REQUEST', 'bad', 400))).toBe('bad');
  });
});
