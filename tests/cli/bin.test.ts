import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../../src/cli/bin.js';

let dir: string;

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-bin-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('run: CLI dispatch and exit codes', () => {
  it('prints usage and exits 1 for an unknown/missing command', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run([], dir);
    expect(code).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: mockingpug'));
    logSpy.mockRestore();
  });

  it('runs the full init -> doctor -> generate -> reset happy path with correct exit codes', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await run(['init'], dir)).toBe(0);
    expect(await run(['doctor'], dir)).toBe(0);
    expect(await run(['generate'], dir)).toBe(0);
    expect(await run(['reset'], dir)).toBe(1); // refuses without --yes
    expect(await run(['reset', '--yes'], dir)).toBe(0);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('doctor exits 1 on a broken schema', async () => {
    const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { email: 'emial' } }) });
    expect(await run(['doctor'], dir)).toBe(1);
    errorSpy.mockRestore();
  });

  it('prune exits 1 without --yes when orphans exist, 0 when confirmed', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await writeFiles({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'mock/api/blogpost/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
    });
    await run(['generate'], dir);
    await rm(join(dir, 'mock', 'api', 'blogpost'), { recursive: true, force: true });

    expect(await run(['prune'], dir)).toBe(1);
    expect(await run(['prune', '--yes'], dir)).toBe(0);
    logSpy.mockRestore();
  });

  it('types writes .mockingpug/types/index.d.ts and exits 0', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }) });
    expect(await run(['types'], dir)).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('.mockingpug'));
    logSpy.mockRestore();
  });

  it('docs writes .mockingpug/docs/{index.html,openapi.json} and exits 0', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }) });
    expect(await run(['docs'], dir)).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('.mockingpug'));
    logSpy.mockRestore();
  });

  it('doctor --assert-prod-safe exits 1 when the build dir contains mock markers', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFiles({
      'mock/api/user/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
      'build/mockServiceWorker.js': '/* msw */',
    });
    expect(await run(['doctor', '--assert-prod-safe', join(dir, 'build')], dir)).toBe(1);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('catches unexpected (non-MockingpugError) failures and exits 1 without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A directory that cannot exist as a valid project path (null byte) forces
    // an unexpected low-level error rather than a clean MockingpugError.
    const code = await run(['doctor'], join(dir, '\0invalid'));
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unexpected internal error'));
    errorSpy.mockRestore();
  });
});
