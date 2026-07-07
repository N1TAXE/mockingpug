import {
  IncrementCounters,
  topologicalOrder,
  validateEntitiesExist,
  type CustomDictionaryEntry,
  type EntitySchema,
  type FieldSpec,
} from '../core';
// Deliberately importing from specific store files, not the `store/index.js`
// barrel: that barrel also re-exports `FileStoreAdapter` (a `node:fs`
// consumer), and a browser bundle for `mockingpug/react` must never end up
// pulling in Node built-ins transitively just because it imports `generator`
//.
import { computeEntityMeta } from '../store';
import { findOrphanEntities, isNoopPlan, planReconciliation } from '../store';
import { safeMerge } from '../store/safeMerge.js';
import type { StoreAdapter, StoredRecord } from '../store';
import {
  buildCustomResolver,
  generateFullRecord,
  generateStoredFieldEntries,
  isStoredField,
  seedIncrementCounters,
} from './recordGenerator.js';

/** Everything the orchestrator needs to know about one entity's schema. */
export type SchemaBundle = Record<string, EntitySchema>;

/** Projects a `SchemaBundle` down to the `SchemaMap` shape `core`'s graph functions expect. */
export function toSchemaMap(schemas: SchemaBundle): Record<string, Record<string, FieldSpec>> {
  const fieldsByEntity: Record<string, Record<string, FieldSpec>> = {};
  for (const [entity, schema] of Object.entries(schemas)) {
    fieldsByEntity[entity] = schema.data;
  }
  return fieldsByEntity;
}

export interface GenerateAllOptions {
  seed: string | number;
  /** `mock/data/*.json` dictionaries, keyed by custom type name (e.g. "role"). */
  customDictionaries?: Record<string, readonly CustomDictionaryEntry[]>;
}

export interface EntitySummary {
  entity: string;
  skipped: boolean;
  recordCount: number;
}

export interface GenerateAllSummary {
  entities: EntitySummary[];
  /** Entities found in the store but no longer present in `schemas`. */
  orphanEntities: string[];
}

/**
 * Drops `removeCount` records, preferring schema-generated ones (`_seed !==
 * false`) from the tail first, only falling back to removing manual
 * mutations if there aren't enough generated records left.
 */
function trimRecords(records: StoredRecord[], removeCount: number): StoredRecord[] {
  if (removeCount <= 0) return records;
  const kept = [...records];
  let remaining = removeCount;

  for (let i = kept.length - 1; i >= 0 && remaining > 0; i--) {
    if (kept[i]!._seed !== false) {
      kept.splice(i, 1);
      remaining--;
    }
  }
  while (remaining > 0 && kept.length > 0) {
    kept.pop();
    remaining--;
  }
  return kept;
}

const FIXTURE_INTERNAL_KEYS = ['_seed', '_index'] as const;

/**
 * Overlays `fixtures` positionally onto `records` (index 0 onto record 0,
 * and so on) after every other reconciliation step, so a fixture's declared
 * fields always win regardless of what generation or backfill just did to
 * that slot. Fields a fixture doesn't mention are left as whatever the
 * generator produced. Runs unconditionally (it's idempotent and cheap); the
 * caller only needs `fixturesChanged` to decide whether to skip this
 * entity's reconciliation pass entirely.
 */
function applyFixtures(records: StoredRecord[], fixtures: readonly Record<string, unknown>[] | undefined): void {
  if (!fixtures || fixtures.length === 0) return;
  for (let i = 0; i < fixtures.length && i < records.length; i++) {
    const patch = { ...fixtures[i] };
    for (const key of FIXTURE_INTERNAL_KEYS) delete patch[key];
    records[i] = { ...safeMerge(records[i]!, patch), _seed: false, _index: records[i]!._index };
  }
}

const LITERAL_INTERNAL_KEYS = ['_seed', '_index'] as const;

/**
 * Places `literal` records verbatim at the head of `records` (index 0..N-1),
 * overwriting whatever is there (unlike `applyFixtures`, this is a full
 * replacement, not a patch) and extending the array if it's currently
 * shorter than `literal.length`. Called twice per entity per pass: once
 * before increment-counter seeding, so a literal's manually-set values
 * (e.g. a `number.increment` id) are respected by records generated in the
 * very same pass rather than one pass later; and again at the very end,
 * to restore literal content in case a field-backfill loop touched those
 * same slots in between.
 */
function applyLiteral(records: StoredRecord[], literal: readonly Record<string, unknown>[] | undefined): void {
  if (!literal || literal.length === 0) return;
  for (let i = 0; i < literal.length; i++) {
    const entry = { ...literal[i] };
    for (const key of LITERAL_INTERNAL_KEYS) delete entry[key];
    records[i] = { ...entry, _seed: false, _index: i };
  }
}

/**
 * Runs schema-parsing -> dependency graph -> reconciliation -> generation
 * for an entire project in one pass, persisting the result through `store`.
 * This is the glue between `core` (pure parsing/generation/graph) and
 * `store` (persistence/reconciliation decisions).
 */
export async function generateAll(
  schemas: SchemaBundle,
  store: StoreAdapter,
  options: GenerateAllOptions,
): Promise<GenerateAllSummary> {
  const fieldsByEntity = toSchemaMap(schemas);

  validateEntitiesExist(fieldsByEntity);
  const order = topologicalOrder(fieldsByEntity);

  const generatedRecords = new Map<string, StoredRecord[]>();
  const resolveTargetRecords = (entity: string): StoredRecord[] => generatedRecords.get(entity) ?? [];
  const entitySummaries: EntitySummary[] = [];
  const customDictionaries = options.customDictionaries ?? {};

  for (const entity of order) {
    const schema = schemas[entity]!;
    const previous = await store.load(entity);
    const currentMeta = computeEntityMeta(schema.amount, schema.data, schema.fixtures, schema.literal);
    const plan = planReconciliation(previous?.meta, currentMeta);

    if (!plan.isNewEntity && isNoopPlan(plan)) {
      const records = previous!.records;
      generatedRecords.set(entity, records);
      entitySummaries.push({ entity, skipped: true, recordCount: records.length });
      continue;
    }

    const increments = new IncrementCounters();
    const resolveCustom = buildCustomResolver(customDictionaries);

    let records: StoredRecord[] = plan.isNewEntity ? [] : [...previous!.records];

    // Literal records occupy the head of the set. Place them before seeding
    // increment counters so their manually-set values (e.g. a
    // `number.increment` id) are already accounted for when generating the
    // rest of this same pass, not one pass later. `applyLiteral` only
    // extends the array when it's currently shorter than `literal.length`
    // (typically just a brand-new entity, or literal growing past the
    // previous total) — `literalGrowth` captures exactly that extension, so
    // it can be netted out of the generate/trim count below without
    // otherwise touching `plan.amountDelta`'s semantics (a pure `amount`
    // diff, still correct as-is even in the presence of extra manual
    // records beyond `amount`, per the existing amount-decrease/manual-record
    // reconciliation test).
    const lengthBeforeLiteral = records.length;
    applyLiteral(records, schema.literal);
    const literalGrowth = records.length - lengthBeforeLiteral;

    // `literal` shrinking (fewer entries than last pass) leaves stale
    // literal content sitting at the now-uncovered positions — `applyLiteral`
    // above only ever touches 0..literal.length-1, never rolls a position
    // back to schema-generated. Regenerate those positions from scratch here
    // so they rejoin normal generation instead of keeping frozen literal
    // values forever.
    const previousLiteralCount = previous?.meta.literalCount ?? 0;
    const currentLiteralCount = schema.literal?.length ?? 0;
    if (currentLiteralCount < previousLiteralCount) {
      for (let i = currentLiteralCount; i < previousLiteralCount && i < records.length; i++) {
        records[i] = await generateFullRecord(
          entity,
          i,
          schema.data,
          options.seed,
          increments,
          resolveCustom,
          resolveTargetRecords,
        );
      }
    }

    seedIncrementCounters(entity, schema.data, records, increments);

    const generateDelta = plan.amountDelta - literalGrowth;

    if (generateDelta < 0) {
      records = trimRecords(records, -generateDelta);
    }

    for (const fieldName of plan.removedFields) {
      for (const record of records) delete record[fieldName];
    }

    for (const fieldName of [...plan.changedFields, ...plan.addedFields]) {
      const spec = schema.data[fieldName];
      if (!spec || !isStoredField(spec)) continue;
      for (const record of records) {
        const entries = await generateStoredFieldEntries(
          entity,
          record._index as number,
          fieldName,
          spec,
          options.seed,
          increments,
          resolveCustom,
          resolveTargetRecords,
          record,
        );
        Object.assign(record, entries);
      }
    }

    if (generateDelta > 0) {
      const startIndex = records.length;
      for (let i = 0; i < generateDelta; i++) {
        records.push(
          await generateFullRecord(
            entity,
            startIndex + i,
            schema.data,
            options.seed,
            increments,
            resolveCustom,
            resolveTargetRecords,
          ),
        );
      }
    }

    // Reapplied: the changed/added-field backfill loop above iterates over
    // every record unconditionally, including literal-covered slots, and
    // would otherwise clobber their curated values with generated ones.
    applyLiteral(records, schema.literal);
    applyFixtures(records, schema.fixtures);

    generatedRecords.set(entity, records);
    await store.save(entity, { meta: currentMeta, records });
    entitySummaries.push({ entity, skipped: false, recordCount: records.length });
  }

  const orphanEntities = findOrphanEntities(await store.listEntities(), Object.keys(schemas));

  return { entities: entitySummaries, orphanEntities };
}
