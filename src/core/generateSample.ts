import { parseFieldValue } from './conditional.js';
import { CustomDictionaryPicker } from './customDictionary.js';
import {
  resolveFieldRef,
  resolveUniqueFieldRef,
  resolveInverseRelation,
  resolveMultiFieldRef,
  topologicalOrder,
  type SchemaMap,
} from './dependencyGraph.js';
import { generateValue, IncrementCounters } from './generate.js';
import { createRng, type Rng } from './rng.js';
import type { SchemaSource } from './schemaOps.js';
import { slugify } from './slugify.js';
import type { CustomDictionaryEntry, FieldSpec } from './types.js';

export interface GenerateSampleOptions {
  /** How many records of the target entity to return (default 4). Related entities are generated to the same depth so refs resolve. */
  count?: number;
  seed?: string | number;
  /** Custom dictionary names, so a bare `role` DSL parses as a `custom` generator. */
  knownCustomTypes?: readonly string[];
  /** Values for those dictionaries, so custom fields produce real values (else `null`). */
  dictionaries?: Record<string, readonly CustomDictionaryEntry[]>;
}

/**
 * Browser-safe preview: N records of `entity` with cross-refs and `slugify`
 * resolved, deterministic from `seed` — the same values the user's app gets
 * after `pull`. For the canvas Data mode and the inspector.
 *
 * ponytail: the per-field kind branching here mirrors the async, store-backed
 * twin `generateFieldValue`/`generateStoredFieldEntries` in
 * `src/generator/recordGenerator.ts`. This version is synchronous and reads
 * already-generated records from an in-memory map instead of the store. Keep
 * the two in sync; the real dedup is a shared kind-dispatch helper, deferred.
 */
export function generateSample(
  schema: SchemaSource,
  entity: string,
  options: GenerateSampleOptions = {},
): Record<string, unknown>[] {
  const count = options.count ?? 4;
  const seed = options.seed ?? 'preview';
  const knownCustomTypes = options.knownCustomTypes ?? [];

  if (!schema.tables[entity]) return [];

  // Parse every table's DSL into FieldSpec; skip fields that don't parse
  // (a draft may be mid-edit) so preview stays resilient.
  const parsed: SchemaMap = {};
  for (const [name, table] of Object.entries(schema.tables)) {
    parsed[name] = {};
    for (const [field, dsl] of Object.entries(table.data)) {
      try {
        parsed[name][field] = parseFieldValue(dsl, { knownCustomTypes });
      } catch {
        /* invalid field: omit from preview */
      }
    }
  }

  let order: string[];
  try {
    order = topologicalOrder(parsed);
  } catch {
    // A cycle can't be topo-ordered; fall back to schema order for a best-effort preview.
    order = Object.keys(parsed);
  }

  const increments = new IncrementCounters();
  const pickers = new Map<string, CustomDictionaryPicker>();
  const resolveCustom = (name: string, rng: Rng): unknown => {
    let picker = pickers.get(name);
    if (!picker) {
      picker = new CustomDictionaryPicker(name, options.dictionaries?.[name] ?? []);
      pickers.set(name, picker);
    }
    return picker.pick(rng);
  };

  const generated = new Map<string, Record<string, unknown>[]>();
  for (const name of order) {
    const fields = parsed[name] ?? {};
    const literal = schema.tables[name]?.literal ?? [];
    const records: Record<string, unknown>[] = [];
    for (let index = 0; index < count; index++) {
      // Literal rows sit at the head, verbatim — no generator, no wasted counters (R14).
      if (index < literal.length) {
        records.push({ ...literal[index] });
        continue;
      }
      const record: Record<string, unknown> = {};
      for (const [fieldName, spec] of Object.entries(fields)) {
        if (isBareRelation(spec)) continue; // resolved lazily below
        if (spec.kind === 'crossRef' && spec.rename !== undefined) {
          const rng = createRng(seed, name, index, fieldName);
          const picked = resolveMultiFieldRef(spec.entity, Object.values(spec.rename), generated.get(spec.entity) ?? [], rng);
          for (const [outName, src] of Object.entries(spec.rename)) record[outName] = picked[src];
          continue;
        }
        if (spec.kind === 'crossRef' && spec.fields !== undefined) {
          const rng = createRng(seed, name, index, fieldName);
          Object.assign(record, resolveMultiFieldRef(spec.entity, spec.fields, generated.get(spec.entity) ?? [], rng));
          continue;
        }
        record[fieldName] = resolveField(name, index, fieldName, spec, seed, increments, resolveCustom, generated, record);
      }
      records.push(record);
    }
    generated.set(name, records);
  }

  // Resolve bare relations (read-time reverse lists) on the target's records only.
  const targetFields = parsed[entity] ?? {};
  const result = (generated.get(entity) ?? []).map((record) => ({ ...record }));
  for (const [fieldName, spec] of Object.entries(targetFields)) {
    if (!isBareRelation(spec)) continue;
    const rel = spec as CrossRef;
    for (const record of result) {
      try {
        record[fieldName] = resolveInverseRelation(entity, record.id, rel.entity, parsed[rel.entity] ?? {}, generated.get(rel.entity) ?? []);
      } catch {
        record[fieldName] = [];
      }
    }
  }
  return result;
}

type CrossRef = Extract<FieldSpec, { kind: 'crossRef' }>;

/** Plain boolean (not a type guard): a guard's negative branch would wrongly exclude field-level cross-refs too. */
function isBareRelation(spec: FieldSpec): boolean {
  return spec.kind === 'crossRef' && spec.field === undefined && spec.fields === undefined && spec.rename === undefined;
}

function resolveField(
  entity: string,
  index: number,
  fieldName: string,
  spec: FieldSpec,
  seed: string | number,
  increments: IncrementCounters,
  resolveCustom: (name: string, rng: Rng) => unknown,
  generated: Map<string, Record<string, unknown>[]>,
  partial: Readonly<Record<string, unknown>>,
): unknown {
  const rng = createRng(seed, entity, index, fieldName);

  if (spec.kind === 'crossRef' && spec.field !== undefined) {
    const target = generated.get(spec.entity) ?? [];
    return spec.unique
      ? resolveUniqueFieldRef(spec.entity, spec.field, target, index)
      : resolveFieldRef(spec.entity, spec.field, target, rng);
  }
  if (spec.kind === 'array' && spec.item.kind === 'crossRef' && spec.item.field !== undefined) {
    const { entity: itemEntity, field: itemField } = spec.item;
    const target = generated.get(itemEntity) ?? [];
    return Array.from({ length: spec.count }, (_, i) =>
      resolveFieldRef(itemEntity, itemField, target, createRng(seed, entity, index, fieldName, i)),
    );
  }
  if (spec.kind === 'conditional') {
    const matches = Object.entries(spec.when).every(([key, expected]) => partial[key] === expected);
    return resolveField(entity, index, fieldName, matches ? spec.then : spec.else, seed, increments, resolveCustom, generated, partial);
  }
  if (spec.kind === 'slugify') {
    const source = partial[spec.field];
    return typeof source === 'string' ? slugify(source, spec.separator) : null;
  }
  return generateValue(spec, rng, { resolveCustom, increments, incrementKey: `${entity}.${fieldName}` });
}
