import {
  createRng,
  CustomDictionaryPicker,
  GenerationError,
  generateValue,
  IncrementCounters,
  resolveFieldRef,
  resolveMultiFieldRef,
  type CustomDictionaryEntry,
  type FieldSpec,
  type Rng,
} from '../core';
import { slugify } from '../core/slugify.js';
// Direct file import, not the `store/index.js` barrel: see orchestrator.ts for why.
import type { StoredRecord } from '../store';

export type CustomResolver = (name: string, rng: Rng) => unknown;

/**
 * Builds a fresh `CustomDictionaryPicker` per custom-type name for one
 * generation pass. `max`/`chance` counts are scoped to this call only, not
 * to the whole store (documented open question, IMPLEMENTATION_STATUS.md).
 */
export function buildCustomResolver(
  dictionaries: Record<string, readonly CustomDictionaryEntry[]>,
): CustomResolver {
  const pickers = new Map<string, CustomDictionaryPicker>();
  return (name, rng) => {
    let picker = pickers.get(name);
    if (!picker) {
      picker = new CustomDictionaryPicker(name, dictionaries[name] ?? []);
      pickers.set(name, picker);
    }
    return picker.pick(rng);
  };
}

/** A field the generator actually stores: every field except bare (fieldless, non-multi-pick) cross-refs, which are resolved lazily on read. */
export function isStoredField(spec: FieldSpec): boolean {
  return !(spec.kind === 'crossRef' && spec.field === undefined && spec.fields === undefined);
}

/**
 * Resolves already-generated/persisted records of another entity, needed to
 * pick a field-level cross-ref value (`data.user.id`). Bulk generation
 * (`generateAll`) can answer this synchronously from an in-memory map since
 * the target entity was already processed earlier in topological order;
 * single-record creation (a `POST` at request time) answers it by loading
 * from the store instead. Both cases fit this one signature.
 */
export type TargetRecordsResolver = (
  entity: string,
) => readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>;

export async function generateFieldValue(
  entity: string,
  index: number,
  fieldName: string,
  spec: FieldSpec,
  seed: string | number,
  increments: IncrementCounters,
  resolveCustom: CustomResolver,
  resolveTargetRecords: TargetRecordsResolver,
  /** Sibling fields already generated on this same record, needed by `slugify`. */
  partialRecord?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const rng = createRng(seed, entity, index, fieldName);
  if (spec.kind === 'crossRef' && spec.field !== undefined) {
    const target = await resolveTargetRecords(spec.entity);
    return resolveFieldRef(spec.entity, spec.field, target, rng);
  }
  if (spec.kind === 'array' && spec.item.kind === 'crossRef' && spec.item.field !== undefined) {
    // Each element is an independent pick, keyed by its position in the
    // array (not shared with the others), so a `count` > 1 doesn't
    // trivially repeat the same value across every slot. generateValue()
    // can't do this itself — it has no access to another entity's
    // already-generated records — so array-of-crossRef is special-cased
    // here rather than falling through to it.
    const target = await resolveTargetRecords(spec.item.entity);
    const values: unknown[] = [];
    for (let i = 0; i < spec.count; i++) {
      const itemRng = createRng(seed, entity, index, fieldName, i);
      values.push(resolveFieldRef(spec.item.entity, spec.item.field, target, itemRng));
    }
    return values;
  }
  if (spec.kind === 'conditional') {
    const matches = Object.entries(spec.when).every(([key, expected]) => partialRecord?.[key] === expected);
    const branch = matches ? spec.then : spec.else;
    // Recurse with the chosen branch's spec — entity/index/fieldName stay
    // the same, so this is still deterministic per record, and the branch
    // gets the exact same handling (crossRef, array-of-crossRef, slugify,
    // a nested conditional, or a plain generated/literal value) as if it
    // had been declared directly on this field.
    return generateFieldValue(entity, index, fieldName, branch, seed, increments, resolveCustom, resolveTargetRecords, partialRecord);
  }
  if (spec.kind === 'slugify') {
    const sourceValue = partialRecord?.[spec.field];
    if (typeof sourceValue !== 'string') {
      throw new GenerationError(
        'MP-GEN-007',
        `cannot resolve "${entity}.${fieldName}" ("slugify[${spec.field},${spec.separator}]"): ` +
          `field "${spec.field}" is missing or not a string on this record`,
        { hint: `make sure "${spec.field}" is declared earlier in "${entity}"'s schema data block` },
      );
    }
    return slugify(sourceValue, spec.separator);
  }
  return generateValue(spec, rng, {
    resolveCustom,
    increments,
    incrementKey: `${entity}.${fieldName}`,
  });
}

/**
 * Resolves one `data` entry to the set of output fields it contributes to a
 * record. Every kind but multi-pick cross-refs contributes exactly one
 * field, keyed by its own schema name (delegates to {@link generateFieldValue}).
 * A multi-pick (`data.product.[id,name,slug]`) makes one RNG-keyed pick at
 * *record* level (keyed by the schema field's own name, not per projected
 * field) and contributes several flat output fields at once, named by the
 * projected list — its own schema key never appears on the output record.
 */
export async function generateStoredFieldEntries(
  entity: string,
  index: number,
  fieldName: string,
  spec: FieldSpec,
  seed: string | number,
  increments: IncrementCounters,
  resolveCustom: CustomResolver,
  resolveTargetRecords: TargetRecordsResolver,
  partialRecord?: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  if (spec.kind === 'crossRef' && spec.fields !== undefined) {
    const rng = createRng(seed, entity, index, fieldName);
    const target = await resolveTargetRecords(spec.entity);
    return resolveMultiFieldRef(spec.entity, spec.fields, target, rng);
  }
  const value = await generateFieldValue(entity, index, fieldName, spec, seed, increments, resolveCustom, resolveTargetRecords, partialRecord);
  return { [fieldName]: value };
}

/** Generates every stored field for one brand-new record at stable index `index`. */
export async function generateFullRecord(
  entity: string,
  index: number,
  fields: Record<string, FieldSpec>,
  seed: string | number,
  increments: IncrementCounters,
  resolveCustom: CustomResolver,
  resolveTargetRecords: TargetRecordsResolver,
): Promise<StoredRecord> {
  const record: StoredRecord = { _seed: true, _index: index };
  for (const [fieldName, spec] of Object.entries(fields)) {
    if (!isStoredField(spec)) continue;
    const entries = await generateStoredFieldEntries(
      entity,
      index,
      fieldName,
      spec,
      seed,
      increments,
      resolveCustom,
      resolveTargetRecords,
      record,
    );
    Object.assign(record, entries);
  }
  return record;
}

/** True if `spec` is a `number.increment`, either directly or behind a conditional's `then`/`else` (possibly nested). */
function isIncrementField(spec: FieldSpec): boolean {
  if (spec.kind === 'number' && spec.mode === 'increment') return true;
  if (spec.kind === 'conditional') return isIncrementField(spec.then) || isIncrementField(spec.else);
  return false;
}

/** Fast-forwards `increments` from the highest `number.increment` value already present among `records`, so newly appended/created records continue counting instead of restarting. */
export function seedIncrementCounters(
  entity: string,
  fields: Record<string, FieldSpec>,
  records: readonly StoredRecord[],
  increments: IncrementCounters,
): void {
  for (const [fieldName, spec] of Object.entries(fields)) {
    if (isIncrementField(spec)) {
      // A conditional's non-increment branch (e.g. `else: null`) stores a
      // non-number for that record; the `typeof v === 'number'` guard
      // below already skips those when finding the existing max.
      const maxExisting = records.reduce((max, r) => {
        const v = r[fieldName];
        return typeof v === 'number' && v > max ? v : max;
      }, 0);
      increments.seed(`${entity}.${fieldName}`, maxExisting);
    }
  }
}
