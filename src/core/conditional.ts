import { SchemaError } from './errors.js';
import { parseFieldType, type ParseFieldTypeOptions } from './parser.js';
import type { FieldSpec } from './types.js';

/**
 * A `then`/`else` branch value is either a JSON literal (`null`, a boolean,
 * or a number — a string is always DSL, never a literal, same rule as every
 * other schema field value), a DSL string, or another `{when,then,else}`
 * object for a nested branch.
 */
function parseBranchValue(raw: unknown, options: ParseFieldTypeOptions, entityName: string): FieldSpec {
  if (raw === null || typeof raw === 'boolean' || typeof raw === 'number') {
    return { kind: 'literal', value: raw };
  }
  if (typeof raw === 'string') {
    return parseFieldType(raw, options);
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return parseObjectOrConditional(raw as Record<string, unknown>, options, entityName);
  }
  throw new SchemaError(
    'MP-SCHEMA-024',
    `"then"/"else" in "${entityName}" must be a DSL string, a JSON literal (null/boolean/number), or a nested {when,then,else} object, got ${JSON.stringify(raw)}`,
    { location: options.file ? { file: options.file, path: options.fieldPath } : undefined },
  );
}

/** Neither a bare relation nor a multi-pick produces one concrete value for a single conditional branch — only a field-level pick (or any non-crossRef kind) does. */
function assertStorableBranch(spec: FieldSpec, entityName: string, options: ParseFieldTypeOptions): void {
  if (spec.kind === 'crossRef' && spec.field === undefined) {
    const reason = spec.fields !== undefined ? 'a multi-pick' : 'a bare relation (no field)';
    throw new SchemaError(
      'MP-SCHEMA-025',
      `"then"/"else" in "${entityName}" resolved to ${reason}, which can't be a single conditional branch's value`,
      {
        location: options.file ? { file: options.file, path: options.fieldPath } : undefined,
        hint: `use a field-level pick instead, e.g. "data.${spec.entity}.id"`,
      },
    );
  }
}

/**
 * Parses ONE raw `data` field value into a {@link FieldSpec}: a DSL string
 * (→ `parseFieldType`) or a `{when,then,else}` object (→ `parseConditional`).
 * The single entry point cloud/CLI use to parse a full-format schema field
 * without re-implementing the string-vs-object branch.
 */
export function parseFieldValue(raw: unknown, options: ParseFieldTypeOptions = {}, entityName = ''): FieldSpec {
  if (typeof raw === 'string') return parseFieldType(raw, options);
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return parseObjectOrConditional(raw as Record<string, unknown>, options, entityName);
  }
  throw new SchemaError(
    'MP-SCHEMA-009',
    `field value in "${entityName}" must be a DSL string, a {when,then,else} object, or a nested object of fields, got ${Array.isArray(raw) ? 'array' : typeof raw}`,
    { location: options.file ? { file: options.file, path: options.fieldPath } : undefined },
  );
}

/**
 * Routes an object-form `data` value: a `{when,...}` object is a conditional,
 * anything else is a nested object whose keys are themselves fields (parsed
 * recursively). Distinguished by the `when` key, per the schema DSL.
 */
function parseObjectOrConditional(raw: Record<string, unknown>, options: ParseFieldTypeOptions, entityName: string): FieldSpec {
  if (raw.kind === 'ref') return parseRef(raw, options, entityName);
  if ('when' in raw) return parseConditional(raw, options, entityName);
  const fields: Record<string, FieldSpec> = {};
  for (const [key, value] of Object.entries(raw)) {
    const fieldPath = options.fieldPath ? `${options.fieldPath}.${key}` : key;
    fields[key] = parseFieldValue(value, { ...options, fieldPath }, entityName);
  }
  return { kind: 'object', fields };
}

/**
 * Parses `{ "kind": "ref", "entity": "product", "fields": { "product_id": "id" } }`
 * — a correlated cross-ref that maps target fields to renamed output fields
 * (all from the SAME picked target record), avoiding the name collisions a bare
 * multi-pick (`data.product.[id,slug]`) causes when the source names clash with
 * the record's own fields.
 */
function parseRef(raw: Record<string, unknown>, options: ParseFieldTypeOptions, entityName: string): FieldSpec {
  const { entity, fields } = raw as { entity?: unknown; fields?: unknown };
  const loc = options.file ? { file: options.file, path: options.fieldPath } : undefined;
  if (typeof entity !== 'string' || entity.length === 0) {
    throw new SchemaError('MP-SCHEMA-029', `"ref" in "${entityName}" needs a non-empty "entity"`, { location: loc });
  }
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields) || Object.keys(fields).length === 0) {
    throw new SchemaError('MP-SCHEMA-029', `"ref" in "${entityName}" needs a non-empty "fields" map of outputName -> targetField`, { location: loc });
  }
  const rename: Record<string, string> = {};
  for (const [outName, src] of Object.entries(fields)) {
    if (typeof src !== 'string') {
      throw new SchemaError('MP-SCHEMA-029', `"ref.fields.${outName}" in "${entityName}" must be a target field name (string)`, { location: loc });
    }
    rename[outName] = src;
  }
  return { kind: 'crossRef', entity, rename };
}

/**
 * Parses `{ "when": {...}, "then": ..., "else": ... }` — the raw JSON object
 * a conditional field's `data` value is — into a `conditional` {@link FieldSpec}.
 * Recurses for a nested conditional in either branch (`then`/`else` can
 * themselves be `{when,then,else}` objects, for more than two outcomes).
 */
export function parseConditional(
  raw: Record<string, unknown>,
  options: ParseFieldTypeOptions,
  entityName: string,
): FieldSpec {
  const { when, then, else: elseValue } = raw as { when?: unknown; then?: unknown; else?: unknown };

  if (typeof when !== 'object' || when === null || Array.isArray(when) || Object.keys(when).length === 0) {
    throw new SchemaError(
      'MP-SCHEMA-023',
      `"when" in "${entityName}" must be a non-empty object of field-name -> expected-value pairs`,
      {
        location: options.file ? { file: options.file, path: options.fieldPath } : undefined,
        hint: 'e.g. { "when": { "status": "scheduled" }, "then": null, "else": "date.past" }',
      },
    );
  }
  if (!('then' in raw) || !('else' in raw)) {
    throw new SchemaError('MP-SCHEMA-023', `a conditional field in "${entityName}" is missing "then" and/or "else"`, {
      location: options.file ? { file: options.file, path: options.fieldPath } : undefined,
    });
  }
  for (const [key, value] of Object.entries(when)) {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new SchemaError(
        'MP-SCHEMA-023',
        `"when.${key}" in "${entityName}" must be a JSON literal (string/number/boolean/null), got ${JSON.stringify(value)}`,
        { location: options.file ? { file: options.file, path: options.fieldPath } : undefined },
      );
    }
  }

  const thenSpec = parseBranchValue(then, options, entityName);
  const elseSpec = parseBranchValue(elseValue, options, entityName);
  assertStorableBranch(thenSpec, entityName, options);
  assertStorableBranch(elseSpec, entityName, options);

  return { kind: 'conditional', when: when as Record<string, string | number | boolean | null>, then: thenSpec, else: elseSpec };
}
