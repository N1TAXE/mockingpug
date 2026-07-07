import { hashString } from '../core/index.js';
import type { FieldSpec } from '../core/index.js';

/** Stable meta snapshot stored next to generated records. */
export interface EntityMeta {
  amount: number;
  fieldsHash: Record<string, string>;
  /** Hash of the entity's `fixtures` array; changes if and only if fixtures are added, removed, or edited. */
  fixturesHash: string;
  /** Hash of the entity's `literal` array; changes if and only if literal records are added, removed, or edited. */
  literalHash: string;
  /** `literal.length` as of this snapshot; the generator needs this on its own (not just the hash) to know which positions to fall back to schema-generated content when `literal` shrinks. */
  literalCount: number;
}

/** Deterministic, order-independent serialization of a field spec. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hash of a single field's spec; changes if and only if the field's type/params change. */
export function computeFieldFingerprint(spec: FieldSpec): string {
  return hashString(stableStringify(spec)).toString(16);
}

/** Full meta for an entity, ready to compare against a previously stored snapshot. */
export function computeEntityMeta(
  amount: number,
  fields: Record<string, FieldSpec>,
  fixtures?: readonly Record<string, unknown>[],
  literal?: readonly Record<string, unknown>[],
): EntityMeta {
  const fieldsHash: Record<string, string> = {};
  for (const [name, spec] of Object.entries(fields)) {
    fieldsHash[name] = computeFieldFingerprint(spec);
  }
  const fixturesHash = hashString(stableStringify(fixtures ?? [])).toString(16);
  const literalHash = hashString(stableStringify(literal ?? [])).toString(16);
  return { amount, fieldsHash, fixturesHash, literalHash, literalCount: literal?.length ?? 0 };
}
