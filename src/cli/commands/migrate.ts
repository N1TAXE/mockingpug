import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadConfig } from '../mockConfig.js';
import { crudRoutes, hasIdField, tableFrom } from '../legacy.js';
import { asCommandFailure, ok, type CommandResult } from '../commandResult.js';

/** Recursively finds every legacy `schema.json` under `apiDir`, skipping dynamic `[param]` segments — same rule as the loader. */
async function findLegacySchemas(apiDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(apiDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(apiDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('[') && entry.name.endsWith(']')) continue;
      files.push(...(await findLegacySchemas(full)));
    } else if (entry.isFile() && entry.name === 'schema.json') {
      files.push(full);
    }
  }
  return files;
}

export interface MigrateOptions {
  /** Actually write `tables/`+`routes/` and remove the migrated `api/` folders. Without it, only prints the plan. */
  yes?: boolean;
}

export async function migrate(projectDir: string, options: MigrateOptions = {}): Promise<CommandResult> {
  try {
    const config = await loadConfig(projectDir);
    const mockRoot = join(projectDir, config.dir);
    const apiDir = join(mockRoot, 'api');
    const tablesDir = join(mockRoot, 'tables');
    const routesDir = join(mockRoot, 'routes');

    const schemaFiles = await findLegacySchemas(apiDir);
    if (schemaFiles.length === 0) {
      return ok([`no legacy ${config.dir}/api schemas found, nothing to migrate`]);
    }

    const messages: string[] = [];
    const warnings: string[] = [];
    const plan: { entity: string; raw: Record<string, unknown>; from: string }[] = [];

    for (const schemaFile of schemaFiles) {
      const entity = dirname(schemaFile).split(/[/\\]/).pop()!;
      const raw = JSON.parse(await readFile(schemaFile, 'utf-8')) as Record<string, unknown>;
      if (existsSync(join(tablesDir, `${entity}.json`)) || existsSync(join(routesDir, `${entity}.json`))) {
        warnings.push(`skipping "${entity}": tables/${entity}.json or routes/${entity}.json already exists`);
        continue;
      }
      plan.push({ entity, raw, from: dirname(schemaFile) });
    }

    if (plan.length === 0) {
      return { ok: true, messages: ['nothing to migrate (all entities already migrated or skipped)'], warnings };
    }

    if (!options.yes) {
      messages.push(`[dry run] would migrate ${plan.length} table(s); re-run with --yes to apply:`);
      for (const { entity } of plan) {
        messages.push(`  ${config.dir}/api/${entity}/  →  ${config.dir}/tables/${entity}.json + ${config.dir}/routes/${entity}.json`);
      }
      return { ok: true, messages, warnings };
    }

    await mkdir(tablesDir, { recursive: true });
    await mkdir(routesDir, { recursive: true });
    for (const { entity, raw, from } of plan) {
      const bypass = raw.bypass === true;
      await writeFile(join(tablesDir, `${entity}.json`), JSON.stringify(tableFrom(raw), null, 2) + '\n', 'utf-8');
      await writeFile(join(routesDir, `${entity}.json`), JSON.stringify(crudRoutes(entity, bypass, hasIdField(raw)), null, 2) + '\n', 'utf-8');
      await rm(from, { recursive: true, force: true });
      messages.push(`migrated "${entity}"${bypass ? ' (bypass → endpoints)' : ''}`);
    }

    // Drop the api/ dir once it's emptied out, so the project is cleanly on the new format.
    if ((await readdir(apiDir)).length === 0) {
      await rm(apiDir, { recursive: true, force: true });
      messages.push(`removed empty ${config.dir}/api`);
    }
    messages.push(`done: ${plan.length} table(s) migrated to tables/ + routes/. Run "mockingpug doctor" to verify.`);
    return { ok: true, messages, warnings };
  } catch (error) {
    return asCommandFailure(error);
  }
}
