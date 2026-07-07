import { parseConditional } from './conditional.js';
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

  const { amount, data, bypass, fixtures, literal } = raw as {
    amount?: unknown;
    data?: unknown;
    bypass?: unknown;
    fixtures?: unknown;
    literal?: unknown;
  };

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
  if (fixtures !== undefined) {
    if (!Array.isArray(fixtures) || fixtures.some((f) => typeof f !== 'object' || f === null || Array.isArray(f))) {
      throw new SchemaError('MP-SCHEMA-013', `"fixtures" must be an array of objects in schema file for "${entityName}"`, {
        location: { file, path: 'fixtures' },
      });
    }
    if (fixtures.length > amount) {
      throw new SchemaError(
        'MP-SCHEMA-014',
        `"fixtures" has ${fixtures.length} entries but "amount" is ${amount} in schema file for "${entityName}": amount must be at least as large as fixtures.length`,
        { location: { file, path: 'fixtures' } },
      );
    }
  }
  if (literal !== undefined) {
    if (!Array.isArray(literal) || literal.some((r) => typeof r !== 'object' || r === null || Array.isArray(r))) {
      throw new SchemaError('MP-SCHEMA-018', `"literal" must be an array of objects in schema file for "${entityName}"`, {
        location: { file, path: 'literal' },
      });
    }
    if (literal.length > amount) {
      throw new SchemaError(
        'MP-SCHEMA-019',
        `"literal" has ${literal.length} entries but "amount" is ${amount} in schema file for "${entityName}": amount must be at least as large as literal.length`,
        { location: { file, path: 'literal' } },
      );
    }
  }

  const fields: Record<string, FieldSpec> = {};
  const fieldOrder = Object.keys(data as Record<string, unknown>);
  for (const [fieldName, rawType] of Object.entries(data as Record<string, unknown>)) {
    const fieldPath = `data.${fieldName}`;
    if (typeof rawType === 'object' && rawType !== null && !Array.isArray(rawType)) {
      fields[fieldName] = parseConditional(rawType as Record<string, unknown>, { knownCustomTypes, file, fieldPath }, entityName);
      continue;
    }
    if (typeof rawType !== 'string') {
      throw new SchemaError(
        'MP-SCHEMA-009',
        `field "${fieldName}" in "${entityName}" must be a string DSL value or a {when,then,else} object, got ${typeof rawType}`,
        { location: { file, path: fieldPath } },
      );
    }
    fields[fieldName] = parseFieldType(rawType, { knownCustomTypes, file, fieldPath });
  }

  // A multi-pick field (`data.product.[id,name]`) never keeps its own
  // schema key on the output record — it expands into one output field per
  // projected name instead. Those projected names must not collide with
  // any other declared/projected field on the same entity, or generation
  // would silently overwrite one with the other depending on object key
  // iteration order.
  const outputFieldOwners = new Map<string, string>();
  for (const [fieldName, spec] of Object.entries(fields)) {
    const outputNames = spec.kind === 'crossRef' && spec.fields !== undefined ? spec.fields : [fieldName];
    for (const outputName of outputNames) {
      const owner = outputFieldOwners.get(outputName);
      if (owner !== undefined && owner !== fieldName) {
        throw new SchemaError(
          'MP-SCHEMA-021',
          `"${entityName}" has a field-name collision: "${fieldName}" produces output field "${outputName}", ` +
            `which is also declared/produced by "${owner}"`,
          { location: { file, path: `data.${fieldName}` } },
        );
      }
      outputFieldOwners.set(outputName, fieldName);
    }
  }

  // `array[data.<entity>.<field>].N` (a field-level pick per element) is
  // supported, but a bare or multi-pick crossRef as an array item isn't:
  // neither produces one concrete stored value per element the way a
  // field-level pick does (bare resolves lazily to a whole list at read
  // time; multi-pick produces several flat sibling fields, not one array
  // slot's worth of value).
  for (const [fieldName, spec] of Object.entries(fields)) {
    if (spec.kind !== 'array' || spec.item.kind !== 'crossRef') continue;
    if (spec.item.field !== undefined) continue;
    const reason = spec.item.fields !== undefined ? 'a multi-pick' : 'a bare relation (no field)';
    throw new SchemaError(
      'MP-SCHEMA-022',
      `field "${fieldName}" in "${entityName}" is "array[data.${spec.item.entity}...].${spec.count}", but an array item can't be ${reason}`,
      {
        location: { file, path: `data.${fieldName}` },
        hint: `use a field-level pick instead, e.g. "array[data.${spec.item.entity}.id].${spec.count}"`,
      },
    );
  }

  // Every field a conditional's `when` compares against must already be
  // generated by the time the conditional itself runs — same "declared
  // earlier in data" requirement as slugify's source field, checked
  // recursively since `then`/`else` can nest another conditional.
  function checkConditionalOrder(fieldName: string, spec: FieldSpec): void {
    if (spec.kind !== 'conditional') return;
    for (const whenField of Object.keys(spec.when)) {
      const sourceIndex = fieldOrder.indexOf(whenField);
      if (sourceIndex === -1) {
        throw new SchemaError(
          'MP-SCHEMA-026',
          `field "${fieldName}" in "${entityName}" has a "when" clause on "${whenField}", but "${entityName}" has no field named "${whenField}"`,
          { location: { file, path: `data.${fieldName}` } },
        );
      }
      if (sourceIndex >= fieldOrder.indexOf(fieldName)) {
        throw new SchemaError(
          'MP-SCHEMA-027',
          `field "${fieldName}" in "${entityName}" has a "when" clause on "${whenField}", but "${whenField}" must be declared earlier in "data" so it's generated first`,
          { location: { file, path: `data.${fieldName}` } },
        );
      }
    }
    checkConditionalOrder(fieldName, spec.then);
    checkConditionalOrder(fieldName, spec.else);
  }
  for (const [fieldName, spec] of Object.entries(fields)) {
    checkConditionalOrder(fieldName, spec);
  }

  for (const [fieldName, spec] of Object.entries(fields)) {
    if (spec.kind !== 'slugify') continue;
    const sourceIndex = fieldOrder.indexOf(spec.field);
    if (sourceIndex === -1) {
      throw new SchemaError(
        'MP-SCHEMA-016',
        `field "${fieldName}" in "${entityName}" is "slugify[${spec.field},${spec.separator}]", but "${entityName}" has no field named "${spec.field}"`,
        { location: { file, path: `data.${fieldName}` } },
      );
    }
    if (sourceIndex >= fieldOrder.indexOf(fieldName)) {
      throw new SchemaError(
        'MP-SCHEMA-017',
        `field "${fieldName}" in "${entityName}" is "slugify[${spec.field},${spec.separator}]", but "${spec.field}" must be declared earlier in "data" so it's generated first`,
        { location: { file, path: `data.${fieldName}` } },
      );
    }
  }

  return {
    name: entityName,
    file,
    amount,
    data: fields,
    ...(fixtures !== undefined ? { fixtures: fixtures as Array<Record<string, unknown>> } : {}),
    ...(literal !== undefined ? { literal: literal as Array<Record<string, unknown>> } : {}),
    ...(bypass !== undefined ? { bypass } : {}),
  };
}
