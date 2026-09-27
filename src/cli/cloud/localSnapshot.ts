import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { SchemaError } from '../../core/index.js';
import { loadConfig } from '../mockConfig.js';
import { crudRoutes, hasIdField, tableFrom } from '../legacy.js';
import type { PushPayload } from './client.js';

export interface LocalSnapshot {
  /** At least one table/route/dictionary/legacy schema exists locally (drives `link`'s push-vs-pull choice). */
  hasLocal: boolean;
  payload: PushPayload;
}

function parse(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new SchemaError('MP-SCHEMA-005', `invalid JSON in "${basename(file)}"`, { location: { file }, cause: error });
  }
}

/** Every `*.json` directly under `dir` (non-recursive). Missing dir → `[]`. */
async function jsonFilesIn(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

/** Recursively finds legacy `schema.json` files under `apiDir`, skipping `[param]` dirs — same rule as the loader/migrate. */
async function legacySchemas(apiDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(apiDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(apiDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('[') && entry.name.endsWith(']')) continue;
      out.push(...(await legacySchemas(full)));
    } else if (entry.isFile() && entry.name === 'schema.json') {
      out.push(full);
    }
  }
  return out;
}

/**
 * Reads the local `mock/` into the exact shape `push` uploads (and `pull`
 * returns): raw JSON straight off disk, NOT parsed into `EntitySchema`, so the
 * format is preserved byte-for-byte. Legacy `api/<e>/schema.json` is decomposed
 * the same way `mpug migrate` does (shared `tableFrom`/`crudRoutes`), so cloud
 * only ever receives the new format. Invalid JSON throws (with the file path)
 * before any request goes out.
 */
export async function collectLocalSnapshot(projectDir: string): Promise<LocalSnapshot> {
  const config = await loadConfig(projectDir);
  const root = join(projectDir, config.dir);

  const tables: Record<string, unknown> = {};
  const routes: unknown[] = [];
  const dictionaries: Record<string, unknown> = {};

  for (const file of await jsonFilesIn(join(root, 'tables'))) {
    tables[basename(file, '.json')] = parse(await readFile(file, 'utf-8'), file);
  }
  for (const file of await legacySchemas(join(root, 'api'))) {
    const raw = parse(await readFile(file, 'utf-8'), file) as Record<string, unknown>;
    const entity = dirname(file).split(/[/\\]/).pop()!;
    tables[entity] = tableFrom(raw);
    routes.push(...crudRoutes(entity, raw.bypass === true, hasIdField(raw)));
  }
  for (const file of await jsonFilesIn(join(root, 'routes'))) {
    const parsed = parse(await readFile(file, 'utf-8'), file);
    routes.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  for (const file of await jsonFilesIn(join(root, 'data'))) {
    dictionaries[basename(file, '.json')] = parse(await readFile(file, 'utf-8'), file);
  }

  const hasLocal = Object.keys(tables).length > 0 || routes.length > 0 || Object.keys(dictionaries).length > 0;
  return { hasLocal, payload: { tables, routes, dictionaries, seed: config.seed } };
}
