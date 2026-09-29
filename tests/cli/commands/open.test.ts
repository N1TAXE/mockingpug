import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { open } from '../../../src/cli/commands/open.js';
import { writeLinkFile } from '../../../src/cli/cloud/config.js';

let dir: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mpug-open-'));
  delete process.env.MOCKINGPUG_URL;
});

afterEach(async () => {
  process.env = { ...savedEnv };
  await rm(dir, { recursive: true, force: true });
});

describe('mpug open', () => {
  it('fails when the folder is not linked', async () => {
    const result = await open(dir, undefined, { open: () => {} });
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toMatch(/not linked/);
  });

  it('opens the project page when no tab is given', async () => {
    process.env.MOCKINGPUG_URL = 'https://app.example.com';
    await writeLinkFile(dir, { projectId: 'proj_123' });
    let opened: string | undefined;
    const result = await open(dir, undefined, { open: (url) => { opened = url; } });
    expect(result.ok).toBe(true);
    expect(opened).toBe('https://app.example.com/p/proj_123');
  });

  it('deep-links to each tab', async () => {
    process.env.MOCKINGPUG_URL = 'https://app.example.com';
    await writeLinkFile(dir, { projectId: 'proj_123' });
    for (const tab of ['schema', 'api', 'data']) {
      let opened: string | undefined;
      const result = await open(dir, tab, { open: (url) => { opened = url; } });
      expect(result.ok).toBe(true);
      expect(opened).toBe(`https://app.example.com/p/proj_123/${tab}`);
    }
  });

  it('rejects an unknown tab', async () => {
    await writeLinkFile(dir, { projectId: 'proj_123' });
    let called = false;
    const result = await open(dir, 'settings', { open: () => { called = true; } });
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toMatch(/unknown tab/);
    expect(called).toBe(false);
  });
});
