import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPackageManager, formatRunCommand } from '../../src/cli/packageManager.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-pm-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('detectPackageManager', () => {
  it('defaults to npm when no lockfile is present', () => {
    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('detects npm from package-lock.json', async () => {
    await writeFile(join(dir, 'package-lock.json'), '{}', 'utf-8');
    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('detects pnpm from pnpm-lock.yaml', async () => {
    await writeFile(join(dir, 'pnpm-lock.yaml'), '', 'utf-8');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', async () => {
    await writeFile(join(dir, 'yarn.lock'), '', 'utf-8');
    expect(detectPackageManager(dir)).toBe('yarn');
  });

  it('detects bun from bun.lockb', async () => {
    await writeFile(join(dir, 'bun.lockb'), '', 'utf-8');
    expect(detectPackageManager(dir)).toBe('bun');
  });

  it('detects bun from bun.lock (the newer text lockfile format)', async () => {
    await writeFile(join(dir, 'bun.lock'), '{}', 'utf-8');
    expect(detectPackageManager(dir)).toBe('bun');
  });

  it('detects deno from deno.json', async () => {
    await writeFile(join(dir, 'deno.json'), '{}', 'utf-8');
    expect(detectPackageManager(dir)).toBe('deno');
  });

  it('detects deno from deno.lock', async () => {
    await writeFile(join(dir, 'deno.lock'), '{}', 'utf-8');
    expect(detectPackageManager(dir)).toBe('deno');
  });

  it('prefers bun over npm when both lockfiles somehow exist', async () => {
    await writeFile(join(dir, 'package-lock.json'), '{}', 'utf-8');
    await writeFile(join(dir, 'bun.lockb'), '', 'utf-8');
    expect(detectPackageManager(dir)).toBe('bun');
  });
});

describe('formatRunCommand', () => {
  it('formats the npm run syntax', () => {
    expect(formatRunCommand('npm', 'doctor')).toBe('npx mpug doctor');
  });

  it('formats the pnpm run syntax', () => {
    expect(formatRunCommand('pnpm', 'generate')).toBe('pnpm exec mpug generate');
  });

  it('formats the yarn run syntax', () => {
    expect(formatRunCommand('yarn', 'types')).toBe('yarn exec mpug types');
  });

  it('formats the bun run syntax', () => {
    expect(formatRunCommand('bun', 'docs')).toBe('bunx mpug docs');
  });

  it('formats the deno run syntax', () => {
    expect(formatRunCommand('deno', 'doctor')).toBe('deno run -A npm:mockingpug doctor');
  });
});
