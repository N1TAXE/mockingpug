import {
  IncrementCounters,
  RequestError,
  resolveInverseRelation,
  type CustomDictionaryEntry,
  type EntitySchema,
} from '../core/index.js';
// Direct file imports, not the `store/index.js` barrel: it also re-exports
// `FileStoreAdapter` (node:fs), which must never leak into a browser bundle
// for `mockingpug/react` just because it transitively imports `query`.
import { computeEntityMeta } from '../store/fingerprint.js';
import { safeMerge } from '../store/safeMerge.js';
import type { StoreAdapter, StoredRecord } from '../store/adapter.js';
import {
  buildCustomResolver,
  generateFullRecord,
  seedIncrementCounters,
  type SchemaBundle,
} from '../generator/index.js';
import type { PaginationConfig, RuntimeConfig } from '../cli/mockConfig.js';
import { filterRecords } from './filter.js';
import { paginate, type PaginatedResult } from './pagination.js';
import { searchRecords } from './search.js';
import { sortRecords } from './sort.js';

const SORT_PARAM = 'sort';
const SEARCH_PARAM = 'q';
const SEARCH_FIELDS_PARAM = 'searchFields';

export interface QueryContext {
  schemas: SchemaBundle;
  store: StoreAdapter;
  pagination: PaginationConfig;
  seed: string | number;
  customDictionaries?: Record<string, readonly CustomDictionaryEntry[]>;
  /** Synthetic latency/error injection, defaults to disabled (`{errorRate: 0, delay: 0}`) when omitted. */
  runtime?: RuntimeConfig;
}

/** What a consumer actually sees: internal bookkeeping fields stripped. */
export type PublicRecord = Record<string, unknown>;

/** Fields a client's request body must never be able to set directly. */
const INTERNAL_KEYS = ['_seed', '_index'] as const;

function stripInternalKeys(body: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...body };
  for (const key of INTERNAL_KEYS) delete clean[key];
  return clean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getEntitySchema(entity: string, ctx: QueryContext): EntitySchema {
  const schema = ctx.schemas[entity];
  if (!schema) {
    throw new RequestError('MP-REQ-001', `unknown entity "${entity}"`, 404);
  }
  return schema;
}

function sanitize(record: StoredRecord): PublicRecord {
  const { _seed, _index, ...rest } = record;
  return rest;
}

/**
 * Adds bare (fieldless) relation fields (`user.posts`) as a lazily computed
 * read-time join, never persisted, always fresh.
 */
async function attachBareRelations(entity: string, record: StoredRecord, ctx: QueryContext): Promise<PublicRecord> {
  const schema = ctx.schemas[entity];
  const result = sanitize(record);
  if (!schema) return result;

  for (const [fieldName, spec] of Object.entries(schema.data)) {
    if (spec.kind !== 'crossRef' || spec.field !== undefined) continue;
    const targetSchema = ctx.schemas[spec.entity];
    if (!targetSchema) continue;
    const targetStored = await ctx.store.load(spec.entity);
    const targetRecords = (targetStored?.records ?? []) as StoredRecord[];
    const matches = resolveInverseRelation(entity, record.id, spec.entity, targetSchema.data, targetRecords);
    result[fieldName] = matches.map((match) => sanitize(match as StoredRecord));
  }

  return result;
}

export async function listRecords(
  entity: string,
  searchParams: URLSearchParams,
  ctx: QueryContext,
): Promise<PaginatedResult<PublicRecord>> {
  getEntitySchema(entity, ctx);
  const stored = await ctx.store.load(entity);
  const records = (stored?.records ?? []) as StoredRecord[];

  const reservedParams = new Set([
    ...Object.values(ctx.pagination.params),
    SORT_PARAM,
    SEARCH_PARAM,
    SEARCH_FIELDS_PARAM,
  ]);
  const filtered = filterRecords(records, searchParams, reservedParams);
  const searched = searchRecords(filtered, searchParams, SEARCH_PARAM, SEARCH_FIELDS_PARAM);
  const sorted = sortRecords(searched, searchParams, SORT_PARAM);

  const { data, meta } = paginate(sorted, searchParams, ctx.pagination);
  const resolved = await Promise.all(data.map((record) => attachBareRelations(entity, record, ctx)));
  return { data: resolved, meta };
}

/** Looks up a record by its `id` field. Entities without an `id` field can't use single-record routes. */
export async function getRecordById(entity: string, id: string, ctx: QueryContext): Promise<PublicRecord> {
  getEntitySchema(entity, ctx);
  const stored = await ctx.store.load(entity);
  const record = (stored?.records as StoredRecord[] | undefined)?.find((r) => String(r.id) === id);
  if (!record) {
    throw new RequestError('MP-REQ-002', `"${entity}" with id "${id}" not found`, 404);
  }
  return attachBareRelations(entity, record, ctx);
}

/**
 * Creates a new record: generates a fully-formed one (every schema field,
 * including a resolved field-level cross-ref) at the next stable index, then
 * lets the request body override any fields on top via safe-merge, so a
 * minimal `POST` body still yields a complete, valid-shaped record.
 */
export async function createRecord(entity: string, body: unknown, ctx: QueryContext): Promise<PublicRecord> {
  const schema = getEntitySchema(entity, ctx);
  const stored = await ctx.store.load(entity);
  const records = (stored?.records ?? []) as StoredRecord[];
  const meta = stored?.meta ?? computeEntityMeta(schema.amount, schema.data);

  const increments = new IncrementCounters();
  seedIncrementCounters(entity, schema.data, records, increments);
  const resolveCustom = buildCustomResolver(ctx.customDictionaries ?? {});
  const resolveTargetRecords = async (target: string) => (await ctx.store.load(target))?.records ?? [];

  const generated = await generateFullRecord(
    entity,
    records.length,
    schema.data,
    ctx.seed,
    increments,
    resolveCustom,
    resolveTargetRecords,
  );

  const patch = isPlainRecord(body) ? stripInternalKeys(body) : {};
  const created: StoredRecord = { ...safeMerge(generated, patch), _seed: false, _index: generated._index };

  await ctx.store.save(entity, { meta, records: [...records, created] });
  return attachBareRelations(entity, created, ctx);
}

/** Full or partial update. Merges the body over the existing record via safe-merge, preserving `_seed`/`_index`. */
export async function updateRecord(entity: string, id: string, body: unknown, ctx: QueryContext): Promise<PublicRecord> {
  getEntitySchema(entity, ctx);
  const stored = await ctx.store.load(entity);
  const records = (stored?.records ?? []) as StoredRecord[];
  const index = records.findIndex((r) => String(r.id) === id);
  if (index === -1) {
    throw new RequestError('MP-REQ-002', `"${entity}" with id "${id}" not found`, 404);
  }

  const patch = isPlainRecord(body) ? stripInternalKeys(body) : {};
  const updated = safeMerge(records[index]!, patch) as StoredRecord;
  const nextRecords = [...records];
  nextRecords[index] = updated;

  await ctx.store.save(entity, { meta: stored!.meta, records: nextRecords });
  return attachBareRelations(entity, updated, ctx);
}

export async function deleteRecord(entity: string, id: string, ctx: QueryContext): Promise<void> {
  getEntitySchema(entity, ctx);
  const stored = await ctx.store.load(entity);
  const records = (stored?.records ?? []) as StoredRecord[];
  const index = records.findIndex((r) => String(r.id) === id);
  if (index === -1) {
    throw new RequestError('MP-REQ-002', `"${entity}" with id "${id}" not found`, 404);
  }

  const nextRecords = [...records];
  nextRecords.splice(index, 1);
  await ctx.store.save(entity, { meta: stored!.meta, records: nextRecords });
}
