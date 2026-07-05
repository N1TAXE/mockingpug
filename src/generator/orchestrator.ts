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
import type { StoreAdapter, StoredRecord } from '../store';
import {
  buildCustomResolver,
  generateFieldValue,
  generateFullRecord,
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
    const currentMeta = computeEntityMeta(schema.amount, schema.data);
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
    seedIncrementCounters(entity, schema.data, records, increments);

    if (plan.amountDelta < 0) {
      records = trimRecords(records, -plan.amountDelta);
    }

    for (const fieldName of plan.removedFields) {
      for (const record of records) delete record[fieldName];
    }

    for (const fieldName of [...plan.changedFields, ...plan.addedFields]) {
      const spec = schema.data[fieldName];
      if (!spec || !isStoredField(spec)) continue;
      for (const record of records) {
        record[fieldName] = await generateFieldValue(
          entity,
          record._index as number,
          fieldName,
          spec,
          options.seed,
          increments,
          resolveCustom,
          resolveTargetRecords,
        );
      }
    }

    if (plan.amountDelta > 0) {
      const startIndex = records.length;
      for (let i = 0; i < plan.amountDelta; i++) {
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

    generatedRecords.set(entity, records);
    await store.save(entity, { meta: currentMeta, records });
    entitySummaries.push({ entity, skipped: false, recordCount: records.length });
  }

  const orphanEntities = findOrphanEntities(await store.listEntities(), Object.keys(schemas));

  return { entities: entitySummaries, orphanEntities };
}
