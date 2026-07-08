import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError } from '../core';

/**
 * Indirect `import()`, constructed via `new Function` so a bundler's static
 * analysis can't see the call coming (the same trick cosmiconfig/vite/jiti
 * use for user-config loading). Needed as a *fallback* only: a literal
 * `import(computedSpecifier)` gets statically analyzed by webpack/Turbopack,
 * and inside a real Next.js Route Handler throws `Cannot find module as
 * expression is too dynamic` at request time, because `mock.config.js`
 * lives outside the bundle's module graph and its path is only known at
 * runtime. This indirection isn't used as the primary path because Vitest's
 * own `vm`-sandboxed module runner has no `importModuleDynamically` hook
 * registered for a function created this way: it only works for the
 * literal `import()` the test runner itself statically transformed.
 */
const dynamicImport = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<{ default: unknown }>;

/**
 * Loads `mock.config.js` via a literal `import()` first. This is what
 * works inside Vitest's module sandbox and in plain Node. If a bundler
 * (webpack/Turbopack) rejected that literal call as "too dynamic" instead of
 * actually attempting to load the file, retry through the indirect
 * `dynamicImport()` above, which is invisible to that static analysis. Any
 * error from a genuinely broken config file (syntax error, etc.) surfaces
 * from this retry, since it re-attempts the real load rather than reusing
 * the first error.
 */
async function importConfigModule(href: string): Promise<{ default: unknown }> {
  try {
    return (await import(href)) as { default: unknown };
  } catch {
    return await dynamicImport(href);
  }
}

export interface PaginationConfig {
  strategy: 'page' | 'offset' | 'cursor' | false;
  params: { page: string; limit: string; offset: string; cursor: string; groupBy: string; limitPerGroup: string };
  defaultLimit: number;
  maxLimit: number;
  envelope: boolean;
}

export interface LimitsConfig {
  /** Hard cap on a single entity's `amount`: a DoS guard, not just a perf knob. */
  maxAmount: number;
  /** Hard cap on `array[type].N`'s `N`, same rationale as `maxAmount`. */
  maxArrayDepth: number;
}

export interface RuntimeConfig {
  /** Fraction of requests that synthetically fail with a 500, in [0, 1]. 0 disables it. */
  errorRate: number;
  /** Artificial latency added to every mock response, in milliseconds. 0 disables it. */
  delay: number;
}

export interface DocsConfig {
  /** `mpug docs`/`<MockDevtools>`'s "API Docs" button, on by default. `false` skips generation entirely and hides the button — no OpenAPI spec of your mock's exact shape ships anywhere. */
  enabled: boolean;
}

export interface MockConfig {
  dir: string;
  seed: string | number;
  baseUrl: string;
  persist: {
    adapter: 'memory' | 'file';
    strategy: 'always' | 'fresh';
  };
  pagination: PaginationConfig;
  limits: LimitsConfig;
  runtime: RuntimeConfig;
  docs: DocsConfig;
  /**
   * Base URL of a real backend, e.g. `"https://api.example.com"` — `mockingpug/next`
   * only. Required for `<MockDevtools>`'s per-request bypass toggle to work
   * there (React/MSW's equivalent uses `passthrough()` instead, no `target`
   * needed). No default: unset means the toggle stays hidden for `mockingpug/next`.
   */
  target?: string;
}

export const DEFAULT_CONFIG: MockConfig = {
  dir: 'mock',
  seed: 'mockingpug',
  baseUrl: '/api',
  persist: { adapter: 'file', strategy: 'always' },
  pagination: {
    strategy: 'page',
    params: { page: 'page', limit: 'limit', offset: 'offset', cursor: 'cursor', groupBy: 'groupBy', limitPerGroup: 'limitPerGroup' },
    defaultLimit: 20,
    maxLimit: 100,
    envelope: true,
  },
  limits: { maxAmount: 100_000, maxArrayDepth: 3 },
  runtime: { errorRate: 0, delay: 0 },
  docs: { enabled: true },
};

const VALID_ADAPTERS = ['memory', 'file'];
const VALID_STRATEGIES = ['always', 'fresh'];
const VALID_PAGINATION_STRATEGIES = ['page', 'offset', 'cursor', false];

function validate(config: unknown, configPath: string): asserts config is Partial<MockConfig> {
  if (typeof config !== 'object' || config === null) {
    throw new ConfigError('MP-CONFIG-001', 'mock.config.js must export an object', {
      location: { file: configPath },
    });
  }
  const { dir, seed, baseUrl, persist, pagination, limits, runtime, docs, target } = config as Record<string, unknown>;

  if (dir !== undefined && typeof dir !== 'string') {
    throw new ConfigError('MP-CONFIG-002', '"dir" must be a string', {
      location: { file: configPath, path: 'dir' },
    });
  }
  if (seed !== undefined && typeof seed !== 'string' && typeof seed !== 'number') {
    throw new ConfigError('MP-CONFIG-003', '"seed" must be a string or number', {
      location: { file: configPath, path: 'seed' },
    });
  }
  if (baseUrl !== undefined && typeof baseUrl !== 'string') {
    throw new ConfigError('MP-CONFIG-008', '"baseUrl" must be a string', {
      location: { file: configPath, path: 'baseUrl' },
    });
  }
  if (persist !== undefined) {
    if (typeof persist !== 'object' || persist === null) {
      throw new ConfigError('MP-CONFIG-004', '"persist" must be an object', {
        location: { file: configPath, path: 'persist' },
      });
    }
    const { adapter, strategy } = persist as Record<string, unknown>;
    if (adapter !== undefined && !VALID_ADAPTERS.includes(adapter as string)) {
      throw new ConfigError('MP-CONFIG-005', `"persist.adapter" must be one of: ${VALID_ADAPTERS.join(', ')}`, {
        location: { file: configPath, path: 'persist.adapter' },
      });
    }
    if (strategy !== undefined && !VALID_STRATEGIES.includes(strategy as string)) {
      throw new ConfigError('MP-CONFIG-006', `"persist.strategy" must be one of: ${VALID_STRATEGIES.join(', ')}`, {
        location: { file: configPath, path: 'persist.strategy' },
      });
    }
  }
  if (pagination !== undefined) {
    if (typeof pagination !== 'object' || pagination === null) {
      throw new ConfigError('MP-CONFIG-009', '"pagination" must be an object', {
        location: { file: configPath, path: 'pagination' },
      });
    }
    const { strategy, defaultLimit, maxLimit, params } = pagination as Record<string, unknown>;
    if (strategy !== undefined && !VALID_PAGINATION_STRATEGIES.includes(strategy as never)) {
      throw new ConfigError(
        'MP-CONFIG-010',
        `"pagination.strategy" must be one of: page, offset, cursor, false`,
        { location: { file: configPath, path: 'pagination.strategy' } },
      );
    }
    if (defaultLimit !== undefined && (typeof defaultLimit !== 'number' || defaultLimit <= 0)) {
      throw new ConfigError('MP-CONFIG-011', '"pagination.defaultLimit" must be a positive number', {
        location: { file: configPath, path: 'pagination.defaultLimit' },
      });
    }
    if (maxLimit !== undefined && (typeof maxLimit !== 'number' || maxLimit <= 0)) {
      throw new ConfigError('MP-CONFIG-012', '"pagination.maxLimit" must be a positive number', {
        location: { file: configPath, path: 'pagination.maxLimit' },
      });
    }
    if (params !== undefined && (typeof params !== 'object' || params === null)) {
      throw new ConfigError('MP-CONFIG-013', '"pagination.params" must be an object', {
        location: { file: configPath, path: 'pagination.params' },
      });
    }
  }
  if (limits !== undefined) {
    if (typeof limits !== 'object' || limits === null) {
      throw new ConfigError('MP-CONFIG-014', '"limits" must be an object', {
        location: { file: configPath, path: 'limits' },
      });
    }
    const { maxAmount, maxArrayDepth } = limits as Record<string, unknown>;
    if (maxAmount !== undefined && (typeof maxAmount !== 'number' || maxAmount <= 0)) {
      throw new ConfigError('MP-CONFIG-015', '"limits.maxAmount" must be a positive number', {
        location: { file: configPath, path: 'limits.maxAmount' },
      });
    }
    if (maxArrayDepth !== undefined && (typeof maxArrayDepth !== 'number' || maxArrayDepth <= 0)) {
      throw new ConfigError('MP-CONFIG-016', '"limits.maxArrayDepth" must be a positive number', {
        location: { file: configPath, path: 'limits.maxArrayDepth' },
      });
    }
  }
  if (runtime !== undefined) {
    if (typeof runtime !== 'object' || runtime === null) {
      throw new ConfigError('MP-CONFIG-017', '"runtime" must be an object', {
        location: { file: configPath, path: 'runtime' },
      });
    }
    const { errorRate, delay } = runtime as Record<string, unknown>;
    if (errorRate !== undefined && (typeof errorRate !== 'number' || errorRate < 0 || errorRate > 1)) {
      throw new ConfigError('MP-CONFIG-018', '"runtime.errorRate" must be a number in [0, 1]', {
        location: { file: configPath, path: 'runtime.errorRate' },
      });
    }
    if (delay !== undefined && (typeof delay !== 'number' || delay < 0)) {
      throw new ConfigError('MP-CONFIG-019', '"runtime.delay" must be a non-negative number', {
        location: { file: configPath, path: 'runtime.delay' },
      });
    }
  }
  if (docs !== undefined) {
    if (typeof docs !== 'object' || docs === null) {
      throw new ConfigError('MP-CONFIG-020', '"docs" must be an object', {
        location: { file: configPath, path: 'docs' },
      });
    }
    const { enabled } = docs as Record<string, unknown>;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw new ConfigError('MP-CONFIG-021', '"docs.enabled" must be a boolean', {
        location: { file: configPath, path: 'docs.enabled' },
      });
    }
  }
  if (target !== undefined && typeof target !== 'string') {
    throw new ConfigError('MP-CONFIG-022', '"target" must be a string', {
      location: { file: configPath, path: 'target' },
    });
  }
}

/** Loads and validates `mock.config.js`, falling back to defaults if it doesn't exist yet. */
export async function loadConfig(projectDir: string): Promise<MockConfig> {
  const configPath = join(projectDir, 'mock.config.js');
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  let userConfig: unknown;
  try {
    const mod = await importConfigModule(pathToFileURL(configPath).href);
    userConfig = mod.default;
  } catch (error) {
    throw new ConfigError('MP-CONFIG-007', 'failed to load mock.config.js', {
      location: { file: configPath },
      cause: error,
    });
  }

  validate(userConfig, configPath);

  return {
    dir: userConfig.dir ?? DEFAULT_CONFIG.dir,
    seed: userConfig.seed ?? DEFAULT_CONFIG.seed,
    baseUrl: userConfig.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    persist: {
      adapter: userConfig.persist?.adapter ?? DEFAULT_CONFIG.persist.adapter,
      strategy: userConfig.persist?.strategy ?? DEFAULT_CONFIG.persist.strategy,
    },
    pagination: {
      strategy: userConfig.pagination?.strategy ?? DEFAULT_CONFIG.pagination.strategy,
      params: {
        page: userConfig.pagination?.params?.page ?? DEFAULT_CONFIG.pagination.params.page,
        limit: userConfig.pagination?.params?.limit ?? DEFAULT_CONFIG.pagination.params.limit,
        offset: userConfig.pagination?.params?.offset ?? DEFAULT_CONFIG.pagination.params.offset,
        cursor: userConfig.pagination?.params?.cursor ?? DEFAULT_CONFIG.pagination.params.cursor,
        groupBy: userConfig.pagination?.params?.groupBy ?? DEFAULT_CONFIG.pagination.params.groupBy,
        limitPerGroup: userConfig.pagination?.params?.limitPerGroup ?? DEFAULT_CONFIG.pagination.params.limitPerGroup,
      },
      defaultLimit: userConfig.pagination?.defaultLimit ?? DEFAULT_CONFIG.pagination.defaultLimit,
      maxLimit: userConfig.pagination?.maxLimit ?? DEFAULT_CONFIG.pagination.maxLimit,
      envelope: userConfig.pagination?.envelope ?? DEFAULT_CONFIG.pagination.envelope,
    },
    limits: {
      maxAmount: userConfig.limits?.maxAmount ?? DEFAULT_CONFIG.limits.maxAmount,
      maxArrayDepth: userConfig.limits?.maxArrayDepth ?? DEFAULT_CONFIG.limits.maxArrayDepth,
    },
    runtime: {
      errorRate: userConfig.runtime?.errorRate ?? DEFAULT_CONFIG.runtime.errorRate,
      delay: userConfig.runtime?.delay ?? DEFAULT_CONFIG.runtime.delay,
    },
    docs: {
      enabled: userConfig.docs?.enabled ?? DEFAULT_CONFIG.docs.enabled,
    },
    ...(userConfig.target !== undefined ? { target: userConfig.target } : {}),
  };
}
