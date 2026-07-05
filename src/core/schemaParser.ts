import { SchemaError } from './errors.js';
import { parseFieldType } from './parser.js';
import type { EntitySchema, FieldSpec } from './types.js';

/**
 * Filesystem-free parsing of one entity schema's already-loaded JSON content
 * (`{ amount, data }`) into an {@link EntitySchema}. This is the shared core
 * of two callers: `cli/schemaLoader.ts`'s Node-based directory scan, and,
 * since there is no filesystem to scan from inside a browser bundle, the
 * "statically `import` your `mock/api/*.json` and parse it yourself" recipe
 * documented in `react/README.md` for `mockingpug/react`, until a build-time
 * plugin does this automatically.
 */
export function parseEntitySchema(
  entityName: string,
  file: string,
  raw: unknown,
  knownCustomTypes: readonly string[] = [],
): EntitySchema {
  if (typeof raw !== 'object' || raw === null) {
    throw new SchemaError('MP-SCHEMA-006', `schema file for "${entityName}" must contain a JSON object`, {
      location: { file },
    });
  }

  const { amount, data, bypass } = raw as { amount?: unknown; data?: unknown; bypass?: unknown };

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new SchemaError('MP-SCHEMA-007', `"amount" must be a non-negative number in schema file for "${entityName}"`, {
      location: { file, path: 'amount' },
    });
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new SchemaError('MP-SCHEMA-008', `"data" must be an object in schema file for "${entityName}"`, {
      location: { file, path: 'data' },
    });
  }
  if (bypass !== undefined && typeof bypass !== 'boolean') {
    throw new SchemaError('MP-SCHEMA-012', `"bypass" must be a boolean in schema file for "${entityName}"`, {
      location: { file, path: 'bypass' },
    });
  }

  const fields: Record<string, FieldSpec> = {};
  for (const [fieldName, rawType] of Object.entries(data as Record<string, unknown>)) {
    if (typeof rawType !== 'string') {
      throw new SchemaError(
        'MP-SCHEMA-009',
        `field "${fieldName}" in "${entityName}" must be a string DSL value, got ${typeof rawType}`,
        { location: { file, path: `data.${fieldName}` } },
      );
    }
    fields[fieldName] = parseFieldType(rawType, { knownCustomTypes, file, fieldPath: `data.${fieldName}` });
  }

  return { name: entityName, file, amount, data: fields, ...(bypass !== undefined ? { bypass } : {}) };
}
