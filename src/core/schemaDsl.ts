import type { FieldSpec } from './types.js';

/**
 * Entity/field names the DSL accepts: a letter or `_`, then word chars. This
 * is the same shape the `data.<entity>` reference regex in the parser requires,
 * so a name that passes here is safe to use in a cross-ref (a folder like
 * `mock/api/my-entity` with a `-` would parse as a path but never resolve as
 * `data.my-entity`). Exported so cloud/CLI validate names identically to core.
 */
export const ENTITY_NAME_RE = /^[A-Za-z_]\w*$/;

/** True when `name` is a valid entity or field identifier (see {@link ENTITY_NAME_RE}). */
export function isValidEntityName(name: string): boolean {
  return ENTITY_NAME_RE.test(name);
}

/**
 * The target entity of a cross-ref DSL string (`data.<entity>...`), or
 * `undefined` for any non-relation DSL. Cheap regex, no full parse: used for
 * canvas relation lines and for the cascade in `table.rename`.
 */
export function relationTarget(dsl: string): string | undefined {
  return /^data\.([A-Za-z_]\w*)/.exec(dsl)?.[1];
}

/**
 * Serializes a {@link FieldSpec} back to its DSL string form: the inverse of
 * `parseFieldType` for every string-representable generator. Round-trips:
 * `parseFieldType(stringifyFieldType(parseFieldType(x)))` deep-equals
 * `parseFieldType(x)` for all string DSL forms.
 *
 * `literal` and `conditional` are object-only schema forms with no string DSL
 * — calling this on them throws, since silently returning something parseable
 * would break the round-trip guarantee callers rely on.
 */
export function stringifyFieldType(spec: FieldSpec): string {
  switch (spec.kind) {
    case 'uuid':
      return 'uuid';
    case 'number':
      if (spec.mode === 'increment') return 'number.increment';
      if (spec.precision !== undefined) {
        return `number.float.${spec.min ?? 0}-${spec.max ?? 1_000_000}.${spec.precision}`;
      }
      if (spec.min !== undefined || spec.max !== undefined) {
        return `number.${spec.min ?? 0}-${spec.max ?? 1_000_000}`;
      }
      return 'number';
    case 'username':
      return `username.${spec.style}`;
    case 'email':
      return spec.domain ? `email[${spec.domain}]` : 'email';
    case 'hash':
      return spec.algorithm === 'generic' ? 'hash' : `hash.${spec.algorithm}`;
    case 'lorem':
      return spec.length !== undefined ? `lorem.${spec.length}` : 'lorem';
    case 'date':
      return spec.range ? `date.${spec.range}` : 'date';
    case 'boolean':
      return spec.chance !== undefined ? `boolean.${spec.chance}` : 'boolean';
    case 'enumInline':
      return `enum[${spec.values.join(',')}]`;
    case 'array':
      return `array[${stringifyFieldType(spec.item)}].${spec.count}`;
    case 'custom':
      return spec.name;
    case 'crossRef':
      if (spec.rename) throw new Error('a "ref" field with renamed outputs has no string DSL representation');
      if (spec.fields) return `data.${spec.entity}.[${spec.fields.join(',')}]`;
      if (spec.field) return `data.${spec.entity}.${spec.field}${spec.unique ? '!unique' : ''}`;
      return `data.${spec.entity}`;
    case 'slugify':
      return `slugify[${spec.field},${spec.separator}]`;
    case 'literal':
    case 'conditional':
    case 'object':
      throw new Error(`"${spec.kind}" is an object-form field with no string DSL representation`);
  }
}
