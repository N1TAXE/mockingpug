import {
  createRng,
  CustomDictionaryPicker,
  GenerationError,
  generateValue,
  IncrementCounters,
  resolveFieldRef,
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

/** A field the generator actually stores: every field except bare (fieldless) cross-refs, which are resolved lazily on read. */
export function isStoredField(spec: FieldSpec): boolean {
  return !(spec.kind === 'crossRef' && spec.field === undefined);
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
    record[fieldName] = await generateFieldValue(
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
  }
  return record;
}

/** Fast-forwards `increments` from the highest `number.increment` value already present among `records`, so newly appended/created records continue counting instead of restarting. */
export function seedIncrementCounters(
  entity: string,
  fields: Record<string, FieldSpec>,
  records: readonly StoredRecord[],
  increments: IncrementCounters,
): void {
  for (const [fieldName, spec] of Object.entries(fields)) {
    if (spec.kind === 'number' && spec.mode === 'increment') {
      const maxExisting = records.reduce((max, r) => {
        const v = r[fieldName];
        return typeof v === 'number' && v > max ? v : max;
      }, 0);
      increments.seed(`${entity}.${fieldName}`, maxExisting);
    }
  }
}
