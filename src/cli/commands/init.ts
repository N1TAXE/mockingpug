import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type CommandResult } from '../commandResult.js';

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

const EXAMPLE_SCHEMA = `${JSON.stringify(
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

/**
 * Scaffolds `mock.config.js` + `mock/api` + `mock/data`. Idempotent and
 * non-destructive: never overwrites an existing config, and only drops in
 * an example schema if `mock/api` is completely empty.
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
  const apiDir = join(mockDir, 'api');
  const dataDir = join(mockDir, 'data');
  await mkdir(apiDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  messages.push('ensured mock/api and mock/data exist');

  const apiEntries = await readdir(apiDir);
  if (apiEntries.length === 0) {
    const exampleDir = join(apiDir, 'example');
    await mkdir(exampleDir, { recursive: true });
    await writeFile(join(exampleDir, 'schema.json'), EXAMPLE_SCHEMA, 'utf-8');
    messages.push('added an example schema at mock/api/example/schema.json');
  }

  return ok(messages);
}
