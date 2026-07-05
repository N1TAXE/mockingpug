import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockingpug, RESOLVED_VIRTUAL_MODULE_ID, VIRTUAL_MODULE_ID } from '../../src/vite/plugin.js';

let dir: string;

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

const validProject = {
  'mock/api/user/schema.json': JSON.stringify({
    amount: 5,
    data: { id: 'number.increment', name: 'username.FS', role: 'role' },
  }),
  'mock/data/role.json': JSON.stringify([{ value: 'ADMIN' }]),
};

/** A plugin hook can be a function or a `{ handler }` object (Vite's "object hooks"); this calls it either way. */
function callHook(hook: unknown, ...args: unknown[]): unknown {
  if (typeof hook === 'function') return hook(...args);
  if (hook && typeof hook === 'object' && 'handler' in hook) {
    return (hook as { handler: (...a: unknown[]) => unknown }).handler(...args);
  }
  throw new Error('hook is neither a function nor an object hook');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-vite-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('mockingpug() vite plugin', () => {
  it('exposes the expected virtual module id', () => {
    const plugin = mockingpug();
    expect(plugin.name).toBe('mockingpug');
    expect(RESOLVED_VIRTUAL_MODULE_ID).toBe(`\0${VIRTUAL_MODULE_ID}`);
  });

  it('resolveId only claims the virtual module id, ignoring everything else', () => {
    const plugin = mockingpug();
    expect(callHook(plugin.resolveId, VIRTUAL_MODULE_ID)).toBe(RESOLVED_VIRTUAL_MODULE_ID);
    expect(callHook(plugin.resolveId, './something-else.ts')).toBeUndefined();
  });

  it('load() generates a module exporting parsed schemas + custom dictionaries + config', async () => {
    await writeFiles(validProject);
    const plugin = mockingpug();
    callHook(plugin.configResolved, { root: dir });

    const code = (await callHook(plugin.load, RESOLVED_VIRTUAL_MODULE_ID)) as string;
    expect(code).toContain('export const schemas');
    expect(code).toContain('export const customDictionaries');
    expect(code).toContain('export const mockConfig');

    // Sanity-check it's actually valid, evaluable JS with the parsed shape we expect.
    const mod: Record<string, unknown> = {};
    new Function('exports', code.replace(/export const/g, 'exports.'))(mod);
    expect((mod.schemas as Record<string, unknown>).user).toBeDefined();
  });

  it('load() returns undefined for any other module id', async () => {
    const plugin = mockingpug();
    expect(await callHook(plugin.load, './unrelated.ts')).toBeUndefined();
  });

  it('respects the `dir` option override instead of mock.config.js\'s default', async () => {
    await writeFiles({
      'fixtures/api/widget/schema.json': JSON.stringify({ amount: 1, data: { id: 'uuid' } }),
    });
    const plugin = mockingpug({ dir: 'fixtures' });
    callHook(plugin.configResolved, { root: dir });

    const code = (await callHook(plugin.load, RESOLVED_VIRTUAL_MODULE_ID)) as string;
    expect(code).toContain('widget');
  });

  describe('configureServer: dev file watching', () => {
    function fakeServer() {
      const watcherHandlers: Array<(event: string, path: string) => void> = [];
      return {
        watcher: {
          add: vi.fn(),
          on: vi.fn((_event: string, handler: (event: string, path: string) => void) => {
            watcherHandlers.push(handler);
          }),
        },
        moduleGraph: {
          getModuleById: vi.fn((): { id: string } | undefined => ({ id: RESOLVED_VIRTUAL_MODULE_ID })),
          invalidateModule: vi.fn(),
        },
        ws: { send: vi.fn() },
        emit(event: string, path: string) {
          for (const handler of watcherHandlers) handler(event, path);
        },
      };
    }

    it('watches the mock dir and mock.config.js', async () => {
      await writeFiles(validProject);
      const plugin = mockingpug();
      callHook(plugin.configResolved, { root: dir });
      const server = fakeServer();

      await callHook(plugin.configureServer, server);

      expect(server.watcher.add).toHaveBeenCalledWith(join(dir, 'mock'));
      expect(server.watcher.add).toHaveBeenCalledWith(join(dir, 'mock.config.js'));
    });

    it('invalidates the virtual module and triggers a full reload when a watched file changes', async () => {
      await writeFiles(validProject);
      const plugin = mockingpug();
      callHook(plugin.configResolved, { root: dir });
      const server = fakeServer();
      await callHook(plugin.configureServer, server);

      server.emit('change', join(dir, 'mock', 'api', 'user', 'schema.json'));

      expect(server.moduleGraph.invalidateModule).toHaveBeenCalled();
      expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });

    it('ignores changes outside the watched mock dir/config file', async () => {
      await writeFiles(validProject);
      const plugin = mockingpug();
      callHook(plugin.configResolved, { root: dir });
      const server = fakeServer();
      await callHook(plugin.configureServer, server);

      server.emit('change', join(dir, 'src', 'App.tsx'));

      expect(server.moduleGraph.invalidateModule).not.toHaveBeenCalled();
      expect(server.ws.send).not.toHaveBeenCalled();
    });

    it('does not crash when the virtual module was never loaded yet (getModuleById returns undefined)', async () => {
      await writeFiles(validProject);
      const plugin = mockingpug();
      callHook(plugin.configResolved, { root: dir });
      const server = fakeServer();
      server.moduleGraph.getModuleById = vi.fn(() => undefined);
      await callHook(plugin.configureServer, server);

      expect(() => server.emit('change', join(dir, 'mock', 'api', 'user', 'schema.json'))).not.toThrow();
      expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });
  });
});
