import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Fixtures use CommonJS `module.exports` since
// the temp dir has no package.json of its own, so Node treats bare `.js`
// files as CommonJS by default, matching what a typical consuming project
// without `"type": "module"` would write.

describe('loadConfig', () => {
  it('returns defaults when mock.config.js does not exist', async () => {
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it('loads and merges a partial user config over the defaults', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { seed: 42 };', 'utf-8');
    const config = await loadConfig(dir);
    expect(config.seed).toBe(42);
    expect(config.dir).toBe(DEFAULT_CONFIG.dir);
    expect(config.persist).toEqual(DEFAULT_CONFIG.persist);
  });

  it('falls back to the default seed when the user config omits it', async () => {
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { dir: 'custom' };", 'utf-8');
    const config = await loadConfig(dir);
    expect(config.seed).toBe(DEFAULT_CONFIG.seed);
    expect(config.dir).toBe('custom');
  });

  it('loads a fully specified config', async () => {
    await writeFile(
      join(dir, 'mock.config.js'),
      "module.exports = { dir: 'fixtures', seed: 'my-seed', baseUrl: '/v1', persist: { adapter: 'memory', strategy: 'fresh' } };",
      'utf-8',
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({
      dir: 'fixtures',
      seed: 'my-seed',
      baseUrl: '/v1',
      persist: { adapter: 'memory', strategy: 'fresh' },
      pagination: DEFAULT_CONFIG.pagination,
      limits: DEFAULT_CONFIG.limits,
      runtime: DEFAULT_CONFIG.runtime,
      docs: DEFAULT_CONFIG.docs,
    });
  });

  it('falls back to the default baseUrl when omitted', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = {};', 'utf-8');
    const config = await loadConfig(dir);
    expect(config.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
  });

  it('merges a partial "pagination" override over the defaults', async () => {
    await writeFile(
      join(dir, 'mock.config.js'),
      "module.exports = { pagination: { strategy: 'offset', defaultLimit: 50 } };",
      'utf-8',
    );
    const config = await loadConfig(dir);
    expect(config.pagination).toEqual({
      strategy: 'offset',
      params: DEFAULT_CONFIG.pagination.params,
      defaultLimit: 50,
      maxLimit: DEFAULT_CONFIG.pagination.maxLimit,
      envelope: DEFAULT_CONFIG.pagination.envelope,
    });
  });

  it('merges a partial "pagination.params" override over the defaults', async () => {
    await writeFile(
      join(dir, 'mock.config.js'),
      "module.exports = { pagination: { params: { limit: 'perPage' } } };",
      'utf-8',
    );
    const config = await loadConfig(dir);
    expect(config.pagination.params).toEqual({ ...DEFAULT_CONFIG.pagination.params, limit: 'perPage' });
  });

  it('supports pagination.strategy: false (pagination disabled)', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { pagination: { strategy: false } };', 'utf-8');
    const config = await loadConfig(dir);
    expect(config.pagination.strategy).toBe(false);
  });

  it('throws ConfigError on a non-string "baseUrl"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { baseUrl: 42 };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-008' });
  });

  it('throws ConfigError when "pagination" is not an object', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { pagination: "page" };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-009' });
  });

  it('throws ConfigError on an invalid "pagination.strategy"', async () => {
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { pagination: { strategy: 'weekly' } };", 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-010' });
  });

  it('throws ConfigError on a non-positive "pagination.defaultLimit"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { pagination: { defaultLimit: 0 } };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-011' });
  });

  it('throws ConfigError on a non-positive "pagination.maxLimit"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { pagination: { maxLimit: -5 } };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-012' });
  });

  it('throws ConfigError when "pagination.params" is not an object', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { pagination: { params: "x" } };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-013' });
  });

  it('throws ConfigError when the config does not export an object', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = 42;', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-001' });
  });

  it('throws ConfigError on a non-string "dir"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { dir: 42 };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-002' });
  });

  it('throws ConfigError on an invalid "seed" type', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { seed: {} };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-003' });
  });

  it('throws ConfigError when "persist" is not an object', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { persist: "file" };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-004' });
  });

  it('throws ConfigError on an invalid "persist.adapter"', async () => {
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { persist: { adapter: 'redis' } };", 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-005' });
  });

  it('throws ConfigError on an invalid "persist.strategy"', async () => {
    await writeFile(join(dir, 'mock.config.js'), "module.exports = { persist: { strategy: 'weekly' } };", 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-006' });
  });

  it('throws ConfigError when the config file throws at import time', async () => {
    await writeFile(join(dir, 'mock.config.js'), "throw new Error('boom');", 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-007' });
  });

  it('merges a partial "limits" override over the defaults', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { limits: { maxAmount: 500 } };', 'utf-8');
    const config = await loadConfig(dir);
    expect(config.limits).toEqual({ maxAmount: 500, maxArrayDepth: DEFAULT_CONFIG.limits.maxArrayDepth });
  });

  it('merges a partial "runtime" override over the defaults', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { runtime: { delay: 300 } };', 'utf-8');
    const config = await loadConfig(dir);
    expect(config.runtime).toEqual({ errorRate: DEFAULT_CONFIG.runtime.errorRate, delay: 300 });
  });

  it('throws ConfigError when "limits" is not an object', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { limits: 42 };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-014' });
  });

  it('throws ConfigError on a non-positive "limits.maxAmount"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { limits: { maxAmount: 0 } };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-015' });
  });

  it('throws ConfigError on a non-positive "limits.maxArrayDepth"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { limits: { maxArrayDepth: -1 } };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-016' });
  });

  it('throws ConfigError when "runtime" is not an object', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { runtime: "fast" };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-017' });
  });

  it('throws ConfigError on an out-of-range "runtime.errorRate"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { runtime: { errorRate: 1.5 } };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-018' });
  });

  it('throws ConfigError on a negative "runtime.delay"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { runtime: { delay: -50 } };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-019' });
  });

  it('defaults "docs.enabled" to true when omitted', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = {};', 'utf-8');
    const config = await loadConfig(dir);
    expect(config.docs).toEqual({ enabled: true });
  });

  it('merges a "docs.enabled: false" override over the defaults', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { docs: { enabled: false } };', 'utf-8');
    const config = await loadConfig(dir);
    expect(config.docs).toEqual({ enabled: false });
  });

  it('throws ConfigError when "docs" is not an object', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { docs: "yes" };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-020' });
  });

  it('throws ConfigError on a non-boolean "docs.enabled"', async () => {
    await writeFile(join(dir, 'mock.config.js'), 'module.exports = { docs: { enabled: "yes" } };', 'utf-8');
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'MP-CONFIG-021' });
  });
});
