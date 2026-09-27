import type { Effect, Include, Respond, Route, RouteMatch, Where, WhereValue } from '../core/routes.js';
import { routeEntity, IncrementCounters, type FieldSpec } from '../core/index.js';
import { buildCustomResolver, generateFullRecord, seedIncrementCounters } from '../generator/index.js';
import { computeEntityMeta } from '../store/fingerprint.js';
import type { StoredEntity, StoredRecord } from '../store/adapter.js';
import { filterRecords } from './filter.js';
import { buildListResponse, errorResponse, jsonResponse, readJsonBody } from './httpResponse.js';
import { paginate } from './pagination.js';
import { getRecordById, listRecords, createRecord, updateRecord, deleteRecord, type QueryContext } from './resolver.js';
import { RequestError } from '../core/index.js';
import { recordRequest } from './requestLog.js';
import { simulateRuntimeForEntity } from './runtime.js';
import { searchRecords } from './search.js';
import { sortRecords } from './sort.js';

const SORT_PARAM = 'sort';
const SEARCH_PARAM = 'q';
const SEARCH_FIELDS_PARAM = 'searchFields';
const INTERNAL_KEYS = new Set(['_seed', '_index']);

type Rec = Record<string, unknown>;

/** Fills an envelope template: `"$payload"` → result (a list nests under `listKey`), `"$meta"` → meta, everything else passed through literally. */
function fillEnvelope(node: unknown, payload: unknown, meta: unknown, listKey: string | undefined): unknown {
  if (node === '$payload') return listKey !== undefined && Array.isArray(payload) ? { [listKey]: payload } : payload;
  if (node === '$meta') return meta;
  if (Array.isArray(node)) return node.map((n) => fillEnvelope(n, payload, meta, listKey));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillEnvelope(v, payload, meta, listKey)]));
  }
  return node;
}

/**
 * Wraps a response payload in the configured envelope template if one is set
 * (`ctx.response.envelope`), else returns `undefined` so the caller uses its
 * default shape. `meta` is `null` for single-record/mutation responses.
 */
function enveloped(payload: unknown, meta: unknown, ctx: QueryContext): Response | undefined {
  const cfg = ctx.response;
  if (!cfg?.envelope) return undefined;
  return jsonResponse(fillEnvelope(cfg.envelope, payload, meta, cfg.listKey));
}

async function loadRecords(entity: string, ctx: QueryContext): Promise<Rec[]> {
  const stored = await ctx.store.load(entity);
  return (stored?.records ?? []) as Rec[];
}

/** Reads a possibly-dotted path (`options.is_top`) out of a record; returns `[found, value]`. */
function readPath(record: Rec, path: string): [boolean, unknown] {
  let cur: unknown = record;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as Rec))) return [false, undefined];
    cur = (cur as Rec)[part];
  }
  return [true, cur];
}

/** Sets a value at a possibly-dotted path, creating intermediate objects. */
function setPath(target: Rec, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key] as Rec;
  }
  cur[parts.at(-1)!] = value;
}

/**
 * Strips internal bookkeeping fields; applies `select` if given. A `select`
 * entry may be a dotted path into a nested object (`options.is_top`), which
 * picks just that leaf. Keys in `keep` (the `include` join keys) always
 * survive — the join was requested explicitly, not via `select`.
 */
function project(record: Rec, select: string[] | undefined, keep?: ReadonlySet<string>): Rec {
  const clean: Rec = {};
  if (!select) {
    for (const [k, v] of Object.entries(record)) if (!INTERNAL_KEYS.has(k)) clean[k] = v;
    return clean;
  }
  for (const [k, v] of Object.entries(record)) {
    if (!INTERNAL_KEYS.has(k) && (select.includes(k) || keep?.has(k))) clean[k] = v;
  }
  for (const path of select) {
    if (!path.includes('.')) continue;
    const [found, value] = readPath(record, path);
    if (found) setPath(clean, path, value);
  }
  return clean;
}

/** Resolves one `where` value against path params + query string into a predicate, or `null` to skip (absent optional query param). */
function bindingPredicate(value: WhereValue, params: Record<string, string>, query: URLSearchParams): ((rv: unknown) => boolean) | null {
  if (Array.isArray(value)) return (rv) => value.some((v) => v === rv);
  if (value !== null && typeof value === 'object' && '$literal' in value) {
    const lit = value.$literal;
    return (rv) => rv === lit;
  }
  if (typeof value === 'string' && value.startsWith(':')) {
    const p = params[value.slice(1)];
    return (rv) => String(rv) === p;
  }
  if (typeof value === 'string' && value.startsWith('?')) {
    const q = query.get(value.slice(1));
    if (q === null) return null; // optional query param absent → condition not applied
    return (rv) => String(rv) === q;
  }
  return (rv) => rv === value; // literal
}

function applyWhere(records: Rec[], where: Where | undefined, params: Record<string, string>, query: URLSearchParams): Rec[] {
  if (!where) return records;
  const preds = Object.entries(where)
    .map(([field, value]) => [field, bindingPredicate(value, params, query)] as const)
    .filter((e): e is [string, (rv: unknown) => boolean] => e[1] !== null);
  return records.filter((r) => preds.every(([field, pred]) => pred(r[field])));
}

// ponytail: fixed depth cap (default from the plan's `limits.maxIncludeDepth`);
// promote to a config knob on QueryContext if a project needs deeper trees.
const MAX_INCLUDE_DEPTH = 3;

/**
 * Resolves `include` for a BATCH of records at once: each target table is
 * loaded and indexed a single time (a `Map` by id for FK, a group `Map` for
 * reverse), so resolution is O(records + targets) instead of O(records ×
 * targets) with a store load per record. FK form (`"user": "userId"` → object)
 * or reverse form (`{from, by}` → array, which may nest its own `include`,
 * capped at {@link MAX_INCLUDE_DEPTH} against cycles).
 */
async function applyIncludeAll(records: Rec[], include: Include, fromEntity: string, ctx: QueryContext, depth = 1): Promise<Rec[]> {
  const out = records.map((r) => ({ ...r }));
  if (records.length === 0) return out;

  for (const [key, spec] of Object.entries(include)) {
    if (typeof spec === 'string') {
      const fieldSpec = ctx.schemas[fromEntity]?.data[spec] as FieldSpec | undefined;
      if (!fieldSpec || fieldSpec.kind !== 'crossRef') {
        for (const o of out) o[key] = null;
        continue;
      }
      const idField = fieldSpec.field ?? 'id';
      const byId = new Map((await loadRecords(fieldSpec.entity, ctx)).map((t) => [t[idField], t]));
      out.forEach((o, i) => {
        const match = byId.get(records[i]![spec]);
        o[key] = match ? project(match, undefined) : null;
      });
    } else {
      // reverse: group target records by their `by` field once, then look up per source record.
      const groups = new Map<unknown, Rec[]>();
      for (const t of await loadRecords(spec.from, ctx)) {
        const g = groups.get(t[spec.by]);
        if (g) g.push(t);
        else groups.set(t[spec.by], [t]);
      }
      const perRecord = out.map((_, i) => groups.get(records[i]!.id) ?? []);

      if (spec.include && depth < MAX_INCLUDE_DEPTH) {
        // Resolve the nested include on the flattened matched rows in one batch, then slice back.
        const lengths = perRecord.map((rows) => rows.length);
        const resolved = await applyIncludeAll(perRecord.flat(), spec.include, spec.from, ctx, depth + 1);
        let idx = 0;
        for (let i = 0; i < perRecord.length; i++) {
          perRecord[i] = resolved.slice(idx, idx + lengths[i]!);
          idx += lengths[i]!;
        }
      }
      const nestedKeys = spec.include ? new Set(Object.keys(spec.include)) : undefined;
      out.forEach((o, i) => (o[key] = perRecord[i]!.map((t) => project(t, spec.select, nestedKeys))));
    }
  }
  return out;
}

/** Executes a `resource` route by delegating to the existing entity CRUD resolver — responses are byte-identical to the pre-R5 transports. */
async function executeResource(match: RouteMatch, request: Request, ctx: QueryContext): Promise<Response> {
  const route = match.route as Extract<Route, { kind: 'resource' }>;
  const { table } = route;
  const id = match.params.id;
  switch (match.op) {
    case 'list': {
      const { data, meta } = await listRecords(table, new URL(request.url).searchParams, ctx);
      return buildListResponse(data, meta, ctx.pagination.strategy !== false && ctx.pagination.envelope);
    }
    case 'get':
      return jsonResponse(await getRecordById(table, id!, ctx));
    case 'create':
      return jsonResponse(await createRecord(table, await readJsonBody(request), ctx), { status: 201 });
    case 'update':
      return jsonResponse(await updateRecord(table, id!, await readJsonBody(request), ctx));
    case 'delete':
      await deleteRecord(table, id!, ctx);
      return new Response(null, { status: 204 });
    default:
      throw new RequestError('MP-REQ-001', `unsupported operation on "${table}"`, 400);
  }
}

/** The shared read pipeline for a table-backed query: where → filters → search → sort. Returns full (unprojected) records. */
type ListQuery = { from: string; where?: Where; sort?: string; filterable?: string[]; searchable?: string[] };
async function filterSortRows(spec: ListQuery, params: Record<string, string>, query: URLSearchParams, ctx: QueryContext): Promise<Rec[]> {
  let records = applyWhere(await loadRecords(spec.from, ctx), spec.where, params, query);

  const reserved = new Set<string>([SORT_PARAM, SEARCH_PARAM, SEARCH_FIELDS_PARAM, ...Object.values(ctx.pagination.params)]);
  for (const key of Object.keys(spec.where ?? {})) reserved.add(key);
  if (spec.filterable) {
    for (const key of query.keys()) if (!spec.filterable.includes(key)) reserved.add(key);
  }
  records = filterRecords(records, query, reserved);

  const searchParams = new URLSearchParams(query);
  if (spec.searchable && !searchParams.has(SEARCH_FIELDS_PARAM)) searchParams.set(SEARCH_FIELDS_PARAM, spec.searchable.join(','));
  records = searchRecords(records, searchParams, SEARCH_PARAM, SEARCH_FIELDS_PARAM);

  const sortParams = new URLSearchParams(query);
  if (spec.sort && !sortParams.has(SORT_PARAM)) sortParams.set(SORT_PARAM, spec.sort);
  return sortRecords(records, sortParams, SORT_PARAM);
}

/** Projects + resolves includes for a set of records (include runs before projection). */
async function projectRows(rows: Rec[], from: string, select: string[] | undefined, include: Include | undefined, ctx: QueryContext): Promise<Rec[]> {
  const includeKeys = include ? new Set(Object.keys(include)) : undefined;
  const joined = include ? await applyIncludeAll(rows, include, from, ctx) : rows;
  return joined.map((r) => project(r, select, includeKeys));
}

async function executeList(match: RouteMatch, request: Request, ctx: QueryContext): Promise<Response> {
  const route = match.route as Extract<Route, { kind: 'list' }>;
  const query = new URL(request.url).searchParams;
  const records = await filterSortRows(route, match.params, query, ctx);

  // `false` disables pagination; a partial object merges over the config's pagination (defaultLimit/maxLimit).
  const pconfig = route.paginate === false ? { ...ctx.pagination, strategy: false as const } : { ...ctx.pagination, ...route.paginate };
  const { data, meta } = paginate(records, query, pconfig);
  const out = await projectRows(data, route.from, route.select, route.include, ctx);
  return enveloped(out, meta, ctx) ?? buildListResponse(out, meta, pconfig.strategy !== false && pconfig.envelope);
}

/** Composes one object from several table reads (`shape`). Each slot is a mini list query; `first: true` → a single object (or null). */
async function executeComposite(match: RouteMatch, request: Request, ctx: QueryContext): Promise<Response> {
  const route = match.route as Extract<Route, { kind: 'composite' }>;
  const query = new URL(request.url).searchParams;
  const body: Rec = {};
  for (const [key, slot] of Object.entries(route.shape)) {
    let rows = await filterSortRows(slot, match.params, query, ctx);
    if (slot.paginate) {
      rows = paginate(rows, query, { ...ctx.pagination, ...slot.paginate }).data;
    }
    const projected = await projectRows(slot.first ? rows.slice(0, 1) : rows, slot.from, slot.select, slot.include, ctx);
    body[key] = slot.first ? (projected[0] ?? null) : projected;
  }
  return enveloped(body, null, ctx) ?? jsonResponse(body);
}

/**
 * `mutation` is a method MAP, not a real write: always 200, store untouched.
 * Body is the custom `response` (JSON text) if set, else the first record of
 * table `from` projected by `select`, else `{}`. Real data changes are
 * `action` (stage 2). A malformed `response`/`body` JSON is a project error,
 * surfaced as 500 rather than silently swallowed.
 */
async function executeMutation(match: RouteMatch, ctx: QueryContext): Promise<Response> {
  const route = match.route as Extract<Route, { kind: 'mutation' }>;
  if (route.response !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(route.response);
    } catch {
      throw new RequestError('MP-REQ-001', `route "${route.id}" has an invalid "response" JSON`, 500);
    }
    return enveloped(parsed, null, ctx) ?? jsonResponse(parsed);
  }
  if (route.from) {
    const first = (await loadRecords(route.from, ctx))[0];
    const body = first ? project(first, route.select) : {};
    return enveloped(body, null, ctx) ?? jsonResponse(body);
  }
  return enveloped({}, null, ctx) ?? jsonResponse({});
}

async function executeOne(match: RouteMatch, ctx: QueryContext): Promise<Response> {
  const route = match.route as Extract<Route, { kind: 'one' }>;
  const query = new URLSearchParams();
  const records = applyWhere(await loadRecords(route.from, ctx), route.where, match.params, query);
  const found = records[0];
  if (!found) {
    throw new RequestError('MP-REQ-003', `no "${route.from}" record matched ${route.path}`, 404);
  }
  // Include before projection (see executeList): the join must read FK fields
  // even when `select` would drop them.
  const joined = route.include ? (await applyIncludeAll([found], route.include, route.from, ctx))[0]! : found;
  const includeKeys = route.include ? new Set(Object.keys(route.include)) : undefined;
  const record = project(joined, route.select, includeKeys);
  return enveloped(record, null, ctx) ?? jsonResponse(record);
}

/**
 * Runs a matched route to a `Response`, framework-agnostic and browser-safe:
 * the shared query engine both transports (MSW / Next) and the cloud preview
 * build on. Pure execution — runtime simulation, request logging and bypass
 * are the transport's job to wrap around this. Domain errors become the
 * standard `{ error: { code, message } }` response.
 */
// --- action (write effects + respond) ---------------------------------------

interface BindCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Rec;
  refs: Map<string, Rec>;
}

/** Resolves an effect value: bindings (`:param` / `?query` / `$body.*` / `$ref.name.field` / `$now`) or a literal. */
function resolveValue(raw: unknown, b: BindCtx): unknown {
  if (typeof raw !== 'string') return raw;
  if (raw === '$now') return new Date().toISOString();
  if (raw.startsWith('$body.')) return readPath(b.body, raw.slice(6))[1];
  if (raw.startsWith('$ref.')) {
    const [name, ...rest] = raw.slice(5).split('.');
    const rec = b.refs.get(name!);
    return rec ? readPath(rec, rest.join('.'))[1] : undefined;
  }
  if (raw.startsWith(':')) return b.params[raw.slice(1)];
  if (raw.startsWith('?')) return b.query.get(raw.slice(1)) ?? undefined;
  return raw;
}

function resolveSet(set: Record<string, unknown> | undefined, b: BindCtx): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(set ?? {})) out[k] = resolveValue(v, b);
  return out;
}

/** Matches a record against a `where` whose values are resolved through the binding context (loose string compare, like the query engine). */
function matchesEffectWhere(record: Rec, where: Where, b: BindCtx): boolean {
  return Object.entries(where).every(([field, raw]) => {
    const expected = resolveValue(raw, b);
    return record[field] === expected || String(record[field]) === String(expected);
  });
}

/**
 * Runs an `action`: applies its `effects` to in-memory copies of the affected
 * tables (`insert`/`update`/`delete`/`increment`) and saves them all only if
 * every effect succeeds — so a failure part-way leaves the store untouched
 * (atomic, no partial write). Then builds the response from `respond`.
 */
async function executeAction(match: RouteMatch, request: Request, ctx: QueryContext): Promise<Response> {
  const route = match.route as Extract<Route, { kind: 'action' }>;
  const parsedBody = await readJsonBody(request);
  const b: BindCtx = { params: match.params, query: new URL(request.url).searchParams, body: isRec(parsedBody) ? parsedBody : {}, refs: new Map() };

  const cache = new Map<string, StoredEntity>();
  const loadTable = async (table: string): Promise<StoredEntity> => {
    let entity = cache.get(table);
    if (!entity) {
      const stored = await ctx.store.load(table);
      const schema = ctx.schemas[table];
      const meta = stored?.meta ?? (schema ? computeEntityMeta(schema.amount, schema.data, schema.fixtures, schema.literal, ctx.customDictionaries) : ({} as StoredEntity['meta']));
      entity = { meta, records: [...((stored?.records ?? []) as StoredRecord[])] };
      cache.set(table, entity);
    }
    return entity;
  };

  for (const effect of route.effects) {
    const table = await loadTable(effect.table);
    if (effect.op === 'insert') {
      const created = await insertRecord(effect.table, table, resolveSet(effect.set, b), ctx);
      if (effect.name) b.refs.set(effect.name, sanitizeRec(created));
    } else if (effect.op === 'update') {
      const set = resolveSet(effect.set, b);
      let firstUpdated: StoredRecord | undefined;
      for (const rec of table.records) {
        if (matchesEffectWhere(rec, effect.where, b)) {
          Object.assign(rec, set);
          firstUpdated ??= rec;
        }
      }
      if (effect.name && firstUpdated) b.refs.set(effect.name, sanitizeRec(firstUpdated));
    } else if (effect.op === 'delete') {
      const before = table.records.length;
      table.records = table.records.filter((rec) => !matchesEffectWhere(rec, effect.where, b));
      if (effect.name) b.refs.set(effect.name, { deleted: before - table.records.length });
    } else {
      // increment
      let firstInc: StoredRecord | undefined;
      for (const rec of table.records) {
        if (matchesEffectWhere(rec, effect.where, b)) {
          rec[effect.field] = (Number(rec[effect.field]) || 0) + (effect.by ?? 1);
          firstInc ??= rec;
        }
      }
      if (effect.name && firstInc) b.refs.set(effect.name, sanitizeRec(firstInc));
    }
  }

  // Commit atomically: only after every effect succeeded.
  for (const [table, entity] of cache) await ctx.store.save(table, entity);

  return buildActionResponse(route.respond, b, ctx);
}

/** Generates a full record for an `insert` effect, overlays the effect's resolved `set`, appends it to the working table. */
async function insertRecord(table: string, working: StoredEntity, set: Rec, ctx: QueryContext): Promise<StoredRecord> {
  const schema = ctx.schemas[table];
  if (!schema) throw new RequestError('MP-REQ-001', `insert effect targets unknown table "${table}"`, 400);
  const increments = new IncrementCounters();
  seedIncrementCounters(table, schema.data, working.records, increments);
  const resolveCustom = buildCustomResolver(ctx.customDictionaries ?? {});
  const resolveTargets = async (t: string) => (await ctx.store.load(t))?.records ?? [];
  const generated = await generateFullRecord(table, working.records.length, schema.data, ctx.seed, increments, resolveCustom, resolveTargets);
  const created: StoredRecord = { ...generated, ...set, _seed: false, _index: generated._index };
  working.records.push(created);
  return created;
}

function sanitizeRec(record: StoredRecord): Rec {
  const { _seed, _index, ...rest } = record;
  void _seed;
  void _index;
  return rest;
}

async function buildActionResponse(respond: Respond, b: BindCtx, ctx: QueryContext): Promise<Response> {
  if ('status' in respond) return jsonResponse(respond.body, { status: respond.status });
  if ('ref' in respond) {
    const rec = b.refs.get(respond.ref);
    return enveloped(rec ?? null, null, ctx) ?? jsonResponse(rec ?? null);
  }
  // { from, where, select, first }
  const rows = (await loadRecords(respond.from, ctx)).filter((r) => (respond.where ? matchesEffectWhere(r, respond.where, b) : true));
  const projected = rows.map((r) => project(r, respond.select));
  const payload = respond.first ? (projected[0] ?? null) : projected;
  return enveloped(payload, null, ctx) ?? jsonResponse(payload);
}

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Full request pipeline a transport wraps around a matched route: runtime
 * simulation (latency/error injection, keyed to the route's data table) →
 * {@link executeRoute} → request logging. Bypass (passthrough / forward to a
 * real backend) stays the transport's decision, made before this is called.
 * Any throw from the simulation step is turned into a clean error response.
 */
export async function serveRoute(match: RouteMatch, request: Request, ctx: QueryContext): Promise<Response> {
  const entity = routeEntity(match.route);
  const startedAt = Date.now();
  let response: Response;
  try {
    if (entity) await simulateRuntimeForEntity(ctx, entity, request);
    response = await executeRoute(match, request, ctx);
  } catch (error) {
    response = errorResponse(error);
  }
  recordRequest(ctx, request, response.status, startedAt);
  return response;
}

export async function executeRoute(match: RouteMatch, request: Request, ctx: QueryContext): Promise<Response> {
  try {
    switch (match.route.kind) {
      case 'resource':
        return await executeResource(match, request, ctx);
      case 'list':
        return await executeList(match, request, ctx);
      case 'one':
        return await executeOne(match, ctx);
      case 'composite':
        return await executeComposite(match, request, ctx);
      case 'mutation':
        return await executeMutation(match, ctx);
      case 'static':
        return jsonResponse(match.route.body, { status: match.route.status });
      case 'action':
        return await executeAction(match, request, ctx);
      case 'handler':
        throw new RequestError('MP-REQ-006', `route kind "${match.route.kind}" is not supported in this version yet`, 501);
    }
  } catch (error) {
    return errorResponse(error);
  }
}
