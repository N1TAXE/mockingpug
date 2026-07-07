import type { FieldSpec } from './types.js';

/**
 * Expands a `data` block into the list of *actual output field names* a
 * generated record will carry. Every field maps to itself except a
 * multi-pick cross-ref (`"contactInfo": "data.product.[id,name,slug]"`),
 * whose own schema key never appears on the output record — instead it
 * expands into one synthetic field-level `crossRef` entry per projected
 * name (`id`/`name`/`slug` above), so callers that need to know a field's
 * *type* (`types-gen`, `openapi-gen`, `doctor`'s literal-record check) can
 * reuse their existing single-field `crossRef` handling unchanged.
 */
export function expandDataFields(data: Record<string, FieldSpec>): Array<[string, FieldSpec]> {
  const expanded: Array<[string, FieldSpec]> = [];
  for (const [fieldName, spec] of Object.entries(data)) {
    if (spec.kind === 'crossRef' && spec.fields !== undefined) {
      for (const projected of spec.fields) {
        expanded.push([projected, { kind: 'crossRef', entity: spec.entity, field: projected }]);
      }
    } else {
      expanded.push([fieldName, spec]);
    }
  }
  return expanded;
}
