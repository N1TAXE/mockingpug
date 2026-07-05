import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import {
  parseEntitySchema,
  SchemaError,
  type CustomDictionaryEntry,
  type EntitySchema,
} from '../core/index.js';

export interface LoadedProject {
  entities: Record<string, EntitySchema>;
  customDictionaries: Record<string, readonly CustomDictionaryEntry[]>;
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

/**
 * Scans `<projectDir>/<mockDir>/api/**\/schema.json` and `<mockDir>/data/*.json`,
 * parsing every schema through {@link parseFieldType}. This is the single entry
 * point CLI commands (`generate`/`doctor`) use to turn `mock/` into the
 * in-memory structures `core`/`store`/`generator` operate on.
 */
export async function loadProject(projectDir: string, mockDir: string): Promise<LoadedProject> {
  const mockRoot = join(projectDir, mockDir);
  const apiDir = join(mockRoot, 'api');
  const dataDir = join(mockRoot, 'data');

  const customDictionaries = await loadCustomDictionaries(dataDir);
  const knownCustomTypes = Object.keys(customDictionaries);

  const schemaFiles = await findEntitySchemaFiles(apiDir);
  const entities: Record<string, EntitySchema> = {};
  for (const schemaFile of schemaFiles) {
    const entityName = entityNameFor(schemaFile, apiDir);
    if (entityName in entities) {
      throw new SchemaError(
        'MP-SCHEMA-011',
        `duplicate entity name "${entityName}": another schema already maps to it`,
        { location: { file: schemaFile } },
      );
    }
    entities[entityName] = await loadEntitySchema(schemaFile, entityName, knownCustomTypes);
  }

  return { entities, customDictionaries };
}
