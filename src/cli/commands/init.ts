import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type CommandResult } from '../commandResult.js';
import { detectPackageManager, formatRunCommand } from '../packageManager.js';

const CONFIG_TEMPLATE = `// See mockingpug's docs for the full list of options.
module.exports = {
  dir: 'mock',
  seed: 'mockingpug',
  persist: {
    adapter: 'file',   // 'memory' | 'file'
    strategy: 'always', // 'always' (keep & reconcile existing data) | 'fresh' (regenerate every run)
  },
};
`;

const EXAMPLE_TABLE = `${JSON.stringify(
  {
    amount: 100,
    data: {
      id: 'number.increment',
      name: 'username.FS',
      email: 'email',
    },
  },
  null,
  2,
)}\n`;

// A `tables/` table has no implicit URL — endpoints are declared here. This
// gives a working read API out of the box (`GET /example`, `GET /example/:id`).
// Writes are `action` routes (documented separately); a `mutation` route is a
// 200-only method map, not a persisting write.
const EXAMPLE_ROUTES = `${JSON.stringify(
  [
    { id: 'example_list', kind: 'list', method: 'GET', path: '/example', from: 'example' },
    { id: 'example_get', kind: 'one', method: 'GET', path: '/example/:id', from: 'example', where: { id: ':id' } },
  ],
  null,
  2,
)}\n`;

/**
 * Scaffolds `mock.config.js` + the `mock/{tables,routes,data}` layout.
 * Idempotent and non-destructive: never overwrites an existing config, and
 * only drops in the example table + its routes when `mock/tables` is empty.
 */
export async function init(projectDir: string): Promise<CommandResult> {
  const configPath = join(projectDir, 'mock.config.js');
  const messages: string[] = [];

  if (existsSync(configPath)) {
    return ok(['mock.config.js already exists, nothing to do.']);
  }

  await writeFile(configPath, CONFIG_TEMPLATE, 'utf-8');
  messages.push('created mock.config.js');

  const mockDir = join(projectDir, 'mock');
  const tablesDir = join(mockDir, 'tables');
  const routesDir = join(mockDir, 'routes');
  const dataDir = join(mockDir, 'data');
  await mkdir(tablesDir, { recursive: true });
  await mkdir(routesDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  messages.push('ensured mock/tables, mock/routes and mock/data exist');

  const tableEntries = (await readdir(tablesDir)).filter((name) => name.endsWith('.json'));
  if (tableEntries.length === 0) {
    await writeFile(join(tablesDir, 'example.json'), EXAMPLE_TABLE, 'utf-8');
    await writeFile(join(routesDir, 'example.json'), EXAMPLE_ROUTES, 'utf-8');
    messages.push('added an example table (mock/tables/example.json) + its endpoints (mock/routes/example.json)');
  }

  const packageManager = detectPackageManager(projectDir);
  messages.push(`detected package manager: ${packageManager} (from lockfile; defaults to npm if none found)`);
  messages.push(`next: ${formatRunCommand(packageManager, 'doctor')} to validate, then ${formatRunCommand(packageManager, 'generate')} to generate mock data`);

  return ok(messages);
}
