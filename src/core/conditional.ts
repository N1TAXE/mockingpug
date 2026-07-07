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
    return parseConditional(raw as Record<string, unknown>, options, entityName);
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
