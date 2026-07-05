import { join } from 'node:path';
import type { Plugin } from 'vite';
import { loadConfig } from '../cli/mockConfig.js';
import { loadProject } from '../cli/schemaLoader.js';

export const VIRTUAL_MODULE_ID = 'virtual:mockingpug/schemas';
export const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

export interface MockingpugVitePluginOptions {
  /** Overrides `mock.config.js`'s `dir`; rarely needed. */
  dir?: string;
}

/**
 * Closes the "schemas into the browser" gap documented in
 * `react/README.md`: a Vite dev server/build already runs in Node, so,
 * unlike the shipped browser bundle itself, a *build-time*
 * plugin can freely read `mock/` off disk with the exact same
 * `cli/schemaLoader.ts` the CLI and `mockingpug/next` use, and hand the
 * already-parsed result to the app as a virtual module:
 *
 * ```ts
 * import { schemas, customDictionaries } from 'virtual:mockingpug/schemas';
 * ```
 *
 * No more one static `import` per entity file. Also wires up dev-server
 * file watching: editing `mock/api/**` or `mock.config.js` triggers a full
 * reload instead of requiring a manual restart.
 */
export function mockingpug(options: MockingpugVitePluginOptions = {}): Plugin {
  let root = process.cwd();

  async function resolveWatchDir(): Promise<string> {
    const config = await loadConfig(root);
    return join(root, options.dir ?? config.dir);
  }

  async function generateModuleCode(): Promise<string> {
    const config = await loadConfig(root);
    const project = await loadProject(root, options.dir ?? config.dir);
    return [
      `export const schemas = ${JSON.stringify(project.entities)};`,
      `export const customDictionaries = ${JSON.stringify(project.customDictionaries)};`,
      `export const mockConfig = ${JSON.stringify(config)};`,
      '',
    ].join('\n');
  }

  return {
    name: 'mockingpug',

    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
      return undefined;
    },

    async load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) return generateModuleCode();
      return undefined;
    },

    async configureServer(server) {
      const watchDir = await resolveWatchDir();
      const configFile = join(root, 'mock.config.js');
      server.watcher.add(watchDir);
      server.watcher.add(configFile);

      server.watcher.on('all', (_event, changedPath) => {
        if (!changedPath.startsWith(watchDir) && changedPath !== configFile) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}
