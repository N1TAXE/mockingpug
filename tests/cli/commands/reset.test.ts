import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reset } from '../../../src/cli/commands/reset.js';
import { generate } from '../../../src/cli/commands/generate.js';

let dir: string;

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-reset-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('reset', () => {
  it('refuses to run without --yes', async () => {
    const result = await reset(dir);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('--yes');
  });

  it('wipes .mockingpug/db when confirmed with yes:true', async () => {
    await writeFiles({ 'mock/api/user/schema.json': JSON.stringify({ amount: 5, data: { id: 'uuid' } }) });
    await generate(dir);
    await expect(readFile(join(dir, '.mockingpug', 'db', 'user.json'), 'utf-8')).resolves.toBeTruthy();

    const result = await reset(dir, { yes: true });
    expect(result.ok).toBe(true);
    await expect(readFile(join(dir, '.mockingpug', 'db', 'user.json'), 'utf-8')).rejects.toThrow();
  });

  it('succeeds harmlessly with the memory adapter (nothing to persist across CLI runs)', async () => {
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { persist: { adapter: 'memory' } };", 'utf-8');
    const result = await reset(dir, { yes: true });
    expect(result.ok).toBe(true);
  });
});
