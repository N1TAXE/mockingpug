import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../cli/mockConfig.js';
import { loadProject } from '../cli/schemaLoader.js';
import { generateAll } from '../generator/index.js';
import { FileStoreAdapter, MemoryStoreAdapter, type StoreAdapter } from '../store/index.js';
import type { QueryContext } from '../query/index.js';

export interface MockContext {
  ctx: QueryContext;
  baseUrl: string;
  /** Absolute path to the resolved mock schema directory (`<projectDir>/<config.dir>`), mainly useful for watching/debugging. */
  dir: string;
}

/**
 * Builds a ready-to-serve `QueryContext` straight from `mock/` on disk.
 * This is the Node-side "bridge" `mockingpug/react` still lacks for the
 * browser (there's no filesystem there): load config, parse schemas via the
 * same `cli/schemaLoader.ts` the CLI uses, then reconcile/generate the store
 * so the very first request already has data, without a separate
 * `mpug generate` step.
 */
export async function createMockContext(projectDir: string): Promise<MockContext> {
  const config = await loadConfig(projectDir);
  const project = await loadProject(projectDir, config.dir);

  const store: StoreAdapter =
    config.persist.adapter === 'file'
      ? new FileStoreAdapter(join(projectDir, '.mockingpug', 'db'))
      : new MemoryStoreAdapter();

  if (config.persist.strategy === 'fresh') {
    await store.reset();
  }

  await generateAll(project.entities, store, {
    seed: config.seed,
    customDictionaries: project.customDictionaries,
  });

  const ctx: QueryContext = {
    schemas: project.entities,
    store,
    pagination: config.pagination,
    seed: config.seed,
    customDictionaries: project.customDictionaries,
    runtime: config.runtime,
  };

  return { ctx, baseUrl: config.baseUrl, dir: join(projectDir, config.dir) };
}

const contextCache = new Map<string, Promise<MockContext>>();
const activeWatchers = new Map<string, FSWatcher[]>();

/**
 * Watches the resolved mock dir + `mock.config.js` and drops the cached
 * context on any change, so the next `getMockContext()` call rebuilds from
 * scratch. This is what lets a live `next dev` process pick up schema
 * edits without a manual restart. Best-effort: some platforms/filesystems
 * don't support recursive watching (older Linux kernels, some network
 * filesystems); in that case it degrades to "restart to pick up changes"
 * rather than crashing the dev server.
 */
function watchForChanges(projectDir: string, result: MockContext): void {
  if (activeWatchers.has(projectDir)) return;

  const targets = [result.dir, join(projectDir, 'mock.config.js')];
  const watchers: FSWatcher[] = [];

  for (const target of targets) {
    try {
      const watcher = watch(target, { recursive: true }, () => {
        contextCache.delete(projectDir);
      });
      watcher.on('error', () => {
        /* ignore: worst case, changes require a manual dev-server restart */
      });
      watchers.push(watcher);
    } catch {
      // Path doesn't exist yet, or watching isn't supported here. Ignored.
    }
  }

  if (watchers.length > 0) activeWatchers.set(projectDir, watchers);
}

/**
 * Process-wide memoized `createMockContext()`, the recommended way to call
 * this from a Route Handler, so a persistent `next dev` process doesn't
 * re-scan `mock/` and re-run reconciliation on every request. Also
 * wires up the file watcher above so schema edits invalidate the cache
 * without a restart, on platforms that support it.
 */
export function getMockContext(projectDir: string): Promise<MockContext> {
  let cached = contextCache.get(projectDir);
  if (!cached) {
    cached = createMockContext(projectDir);
    contextCache.set(projectDir, cached);
    cached.then((result) => watchForChanges(projectDir, result)).catch(() => {});
  }
  return cached;
}

/** Clears the process-wide cache and stops all file watchers. Mainly for tests; a real app should just restart its dev server instead. */
export function resetMockContextCache(): void {
  contextCache.clear();
  for (const watchers of activeWatchers.values()) {
    for (const watcher of watchers) watcher.close();
  }
  activeWatchers.clear();
}
