import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import {
  defaultResourceRoute,
  parseEntitySchema,
  SchemaError,
  type CustomDictionaryEntry,
  type EntitySchema,
  type Route,
} from '../core/index.js';

export interface LoadedProject {
  entities: Record<string, EntitySchema>;
  customDictionaries: Record<string, readonly CustomDictionaryEntry[]>;
  /**
   * Effective endpoints: a full-CRUD `resource` route per legacy `api/<entity>`
   * table (real, store-writing REST — "как сейчас"), plus every explicit
   * endpoint from `routes/*.json`. A `tables/<name>.json` table with no route
   * is internal — generated and usable in relations/includes, but no URL.
   */
  routes: Route[];
}

// `resource` is intentionally absent: it's an internal legacy/default kind, not
// authored in `routes/`. Users declare explicit list/one/mutation endpoints.
const ROUTE_KINDS = new Set<Route['kind']>(['list', 'one', 'mutation', 'composite', 'action', 'static', 'handler']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates one route object's shape enough to route it safely — the kind
 * discriminant plus the identifying fields each kind can't work without.
 * Deep value validation (where/include/effect bindings) is the engine's job
 * at request time, not the loader's.
 */
function validateRoute(raw: unknown, file: string, seenIds: Set<string>): Route {
  if (!isRecord(raw)) {
    throw new SchemaError('MP-ROUTE-001', 'each route must be a JSON object', { location: { file } });
  }
  const { kind, id, path } = raw;
  if (typeof kind !== 'string' || !ROUTE_KINDS.has(kind as Route['kind'])) {
    throw new SchemaError('MP-ROUTE-002', `route "kind" must be one of ${[...ROUTE_KINDS].join(', ')}`, {
      location: { file },
    });
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new SchemaError('MP-ROUTE-003', 'route "id" must be a non-empty string', { location: { file } });
  }
  if (seenIds.has(id)) {
    throw new SchemaError('MP-ROUTE-004', `duplicate route id "${id}"`, { location: { file } });
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new SchemaError('MP-ROUTE-005', `route "${id}" needs a "path" starting with "/"`, { location: { file } });
  }
  const missing: Record<Route['kind'], string[]> = {
    resource: ['table', 'methods'], // unreachable (not authored); kept for type completeness
    list: ['method', 'from'],
    one: ['method', 'from', 'where'],
    composite: ['method', 'shape'],
    mutation: ['method'],
    action: ['method', 'effects', 'respond'],
    static: ['method', 'status', 'body'],
    handler: ['method', 'file'],
  };
  for (const key of missing[kind as Route['kind']]) {
    if (!(key in raw)) {
      throw new SchemaError('MP-ROUTE-006', `route "${id}" (${kind}) is missing "${key}"`, { location: { file } });
    }
  }
  return raw as unknown as Route;
}

/** Loads every route from `<mockDir>/routes/*.json` (each file is one route object or an array of them). Missing dir → `[]`. */
async function loadRoutes(routesDir: string): Promise<Route[]> {
  let entries;
  try {
    entries = await readdir(routesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const routes: Route[] = [];
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = join(routesDir, entry.name);
    const raw = await readFile(filePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new SchemaError('MP-SCHEMA-005', `invalid JSON in route file "${entry.name}"`, {
        location: { file: filePath },
        cause: error,
      });
    }
    for (const route of Array.isArray(parsed) ? parsed : [parsed]) {
      const validated = validateRoute(route, filePath, seenIds);
      seenIds.add(validated.id);
      routes.push(validated);
    }
  }
  return routes;
}

/** Recursively finds every `schema.json` under `apiDir`, skipping dynamic `[param]` segments (REST routing, out of scope for data generation). */
async function findEntitySchemaFiles(apiDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(apiDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(apiDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('[') && entry.name.endsWith(']')) continue;
      files.push(...(await findEntitySchemaFiles(fullPath)));
    } else if (entry.isFile() && entry.name === 'schema.json') {
      files.push(fullPath);
    }
  }
  return files;
}

function entityNameFor(schemaFile: string, apiDir: string): string {
  const rel = relative(apiDir, schemaFile);
  const parentDir = rel.split(/[/\\]/).slice(0, -1).pop();
  return parentDir ?? basename(schemaFile, '.json');
}

async function loadEntitySchema(
  schemaFile: string,
  entityName: string,
  knownCustomTypes: readonly string[],
): Promise<EntitySchema> {
  let raw: string;
  try {
    raw = await readFile(schemaFile, 'utf-8');
  } catch (error) {
    /* v8 ignore start -- readdir already found this file; only a permission
     * error or a delete-after-list race can land here, neither of which is
     * deterministically simulatable in a cross-platform test. */
    throw new SchemaError('MP-SCHEMA-004', `failed to read schema file for "${entityName}"`, {
      location: { file: schemaFile },
      cause: error,
    });
    /* v8 ignore stop */
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SchemaError('MP-SCHEMA-005', `invalid JSON in schema file for "${entityName}"`, {
      location: { file: schemaFile },
      cause: error,
    });
  }

  return parseEntitySchema(entityName, schemaFile, parsed, knownCustomTypes);
}

async function loadCustomDictionaries(dataDir: string): Promise<Record<string, readonly CustomDictionaryEntry[]>> {
  let entries;
  try {
    entries = await readdir(dataDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }

  const dictionaries: Record<string, readonly CustomDictionaryEntry[]> = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const name = basename(entry.name, '.json');
    const filePath = join(dataDir, entry.name);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (error) {
      /* v8 ignore start -- see the identical guard in loadEntitySchema() above. */
      throw new SchemaError('MP-SCHEMA-004', `failed to read custom dictionary "${name}"`, {
        location: { file: filePath },
        cause: error,
      });
      /* v8 ignore stop */
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new SchemaError('MP-SCHEMA-005', `invalid JSON in custom dictionary "${name}"`, {
        location: { file: filePath },
        cause: error,
      });
    }
    if (!Array.isArray(parsed)) {
      throw new SchemaError('MP-SCHEMA-010', `custom dictionary "${name}" must be a JSON array`, {
        location: { file: filePath },
      });
    }
    dictionaries[name] = parsed as CustomDictionaryEntry[];
  }
  return dictionaries;
}

/** New flat data format: every `<tablesDir>/<name>.json` is one table (`{ amount, data, fixtures?, literal? }`), the file name being the table name. Missing dir → `[]`. */
async function findTableSchemaFiles(tablesDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(tablesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(tablesDir, e.name));
}

/**
 * Turns `mock/` on disk into the in-memory structures `core`/`store`/`generator`
 * operate on — the single entry point every CLI command and the Next bridge use.
 * Reads tables from both the new flat `tables/<name>.json` and legacy
 * `api/<entity>/schema.json`, dictionaries from `data/*.json`, and endpoints
 * from `routes/*.json`. Effective routes: real-CRUD `resource` per legacy `api/`
 * table + every authored route (see {@link LoadedProject.routes}).
 */
export async function loadProject(projectDir: string, mockDir: string): Promise<LoadedProject> {
  const mockRoot = join(projectDir, mockDir);
  const apiDir = join(mockRoot, 'api');
  const tablesDir = join(mockRoot, 'tables');
  const dataDir = join(mockRoot, 'data');
  const routesDir = join(mockRoot, 'routes');

  const customDictionaries = await loadCustomDictionaries(dataDir);
  const knownCustomTypes = Object.keys(customDictionaries);
  const authoredRoutes = await loadRoutes(routesDir);

  const entities: Record<string, EntitySchema> = {};
  const addEntity = async (schemaFile: string, entityName: string): Promise<void> => {
    if (entityName in entities) {
      throw new SchemaError('MP-SCHEMA-011', `duplicate entity name "${entityName}": another schema already maps to it`, {
        location: { file: schemaFile },
      });
    }
    entities[entityName] = await loadEntitySchema(schemaFile, entityName, knownCustomTypes);
  };

  // Legacy `api/` tables get a full-CRUD resource route (real, store-writing).
  const legacyEntities: string[] = [];
  for (const schemaFile of await findEntitySchemaFiles(apiDir)) {
    const entityName = entityNameFor(schemaFile, apiDir);
    await addEntity(schemaFile, entityName);
    legacyEntities.push(entityName);
  }

  // New `tables/` tables have NO implicit URL — only whatever `routes/` declares.
  for (const schemaFile of await findTableSchemaFiles(tablesDir)) {
    await addEntity(schemaFile, basename(schemaFile, '.json'));
  }

  const routes = [...legacyEntities.map((name) => defaultResourceRoute(name)), ...authoredRoutes];
  return { entities, customDictionaries, routes };
}
