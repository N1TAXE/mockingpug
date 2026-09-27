import type { PaginationConfig } from '../cli/mockConfig.js';

/**
 * First-class endpoint model (шов 1 / R5): the API surface is described
 * separately from the data tables. A table can back many endpoints (or none —
 * an internal table used only in relations/includes). Browser-safe: cloud
 * reads this to draw the API map and build previews without importing a
 * transport (MSW / Next).
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Which CRUD operations a `resource` route exposes. */
export type ResourceOp = 'list' | 'get' | 'create' | 'update' | 'delete';

/**
 * A value binding in a `where` clause / effect:
 * - literal (`"paid"`, `5`, `true`, `null`)
 * - `":id"` path param · `"?status"` query param (skipped when absent)
 * - `["paid","refunded"]` one-of
 * - `{ "$literal": ":x" }` a literal that starts with `:`/`?`/`$`
 * (`$body.*`, `$ref.*`, `$now`, `$gen` are effect-only, added in stage 2/3.)
 */
export type WhereValue = string | number | boolean | null | Array<string | number | boolean | null> | { $literal: string | number | boolean | null };
export type Where = Record<string, WhereValue>;

/** Relation include: `"userId"` (FK → one object) or `{from,by}` (reverse → array). The reverse form may nest its own `include` (bounded by `limits.maxIncludeDepth`). */
export type Include = Record<string, string | { from: string; by: string; select?: string[]; include?: Include }>;

/**
 * An `action` effect: one write against a table. Values in `set`/`where` may be
 * bindings — `":param"`, `"?query"`, `"$body.<path>"`, `"$ref.<name>.<field>"`
 * (a prior effect's result), `"$now"`, or a literal. `name` exposes the
 * effect's resulting record as `$ref.<name>` to later effects and `respond`.
 */
export type Effect =
  | { op: 'insert'; table: string; name?: string; set?: Record<string, unknown> }
  | { op: 'update'; table: string; name?: string; where: Where; set: Record<string, unknown> }
  | { op: 'delete'; table: string; name?: string; where: Where }
  | { op: 'increment'; table: string; name?: string; where: Where; field: string; by?: number };

/** How an `action` builds its response: a fresh query, a prior effect's record, or a fixed status+body. */
export type Respond =
  | { from: string; where?: Where; select?: string[]; first?: boolean }
  | { ref: string }
  | { status: number; body: unknown };

interface RouteBase {
  id: string;
  path: string;
  bypass?: boolean;
  description?: string;
}

/** One slot of a `composite` response: a mini list query. `first: true` returns a single object (or null) instead of an array. */
export interface CompositeSlot {
  from: string;
  where?: Where;
  select?: string[];
  include?: Include;
  sort?: string;
  paginate?: Partial<Pick<PaginationConfig, 'defaultLimit' | 'maxLimit'>> | false;
  filterable?: string[];
  searchable?: string[];
  first?: boolean;
}

export type Route =
  // Internal only — never authored in `routes/`. Legacy `api/<entity>/schema.json`
  // and `defaultRoutes()` map to this: a table with real, store-writing CRUD
  // ("работающий CRUD как сейчас"). `mpug migrate` rewrites it into explicit
  // list/one/mutation endpoints (where mutation is a map, not a write).
  | (RouteBase & { kind: 'resource'; table: string; methods: ResourceOp[] })
  | (RouteBase & {
      kind: 'list';
      method: 'GET';
      from: string;
      where?: Where;
      select?: string[];
      include?: Include;
      sort?: string;
      /** Per-endpoint pagination: `false` disables it (bare array), or a partial merged over the config's `pagination` (only `defaultLimit`/`maxLimit`). */
      paginate?: Partial<Pick<PaginationConfig, 'defaultLimit' | 'maxLimit'>> | false;
      filterable?: string[];
      searchable?: string[];
    })
  | (RouteBase & { kind: 'one'; method: 'GET'; from: string; where: Where; select?: string[]; include?: Include })
  // Composes one response object from several independent table reads — each
  // `shape` value is a mini `list` query (`first: true` → a single object).
  | (RouteBase & { kind: 'composite'; method: 'GET'; path: string; shape: Record<string, CompositeSlot> })
  // A method map, not a real mutation: responds 200 without touching the store.
  // Body is `response` (JSON text) if set, else the first `from` record projected
  // by `select`, else `{}`. `body` is an example request payload (docs/OpenAPI).
  | (RouteBase & {
      kind: 'mutation';
      method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      path: string;
      from?: string;
      select?: string[];
      body?: string;
      response?: string;
    })
  | (RouteBase & { kind: 'action'; method: HttpMethod; path: string; effects: Effect[]; respond: Respond })
  | (RouteBase & { kind: 'static'; method: HttpMethod; status: number; body: unknown })
  | (RouteBase & { kind: 'handler'; method: HttpMethod; file: string });

/** A concrete (method, path-pattern) a route answers — a `resource` expands into several. */
interface RouteMatcher {
  method: HttpMethod;
  segments: string[];
  route: Route;
  /** Which CRUD op, for `resource` routes. */
  op?: ResourceOp;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
  /** Present when `route.kind === 'resource'`: the CRUD op the request hit. */
  op?: ResourceOp;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function stripBase(pathname: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
}

/** Every concrete (method, path) a route answers. A `resource` fans out to its CRUD set. */
function matchersFor(route: Route): RouteMatcher[] {
  if (route.kind !== 'resource') {
    return [{ method: route.method, segments: segmentsOf(route.path), route }];
  }
  const base = segmentsOf(route.path);
  const item = [...base, ':id'];
  const out: RouteMatcher[] = [];
  const add = (method: HttpMethod, segments: string[], op: ResourceOp) => out.push({ method, segments, route, op });
  if (route.methods.includes('list')) add('GET', base, 'list');
  if (route.methods.includes('get')) add('GET', item, 'get');
  if (route.methods.includes('create')) add('POST', base, 'create');
  if (route.methods.includes('update')) {
    add('PUT', item, 'update');
    add('PATCH', item, 'update');
  }
  if (route.methods.includes('delete')) add('DELETE', item, 'delete');
  return out;
}

/** Tries to match one matcher's segments against the request segments, capturing `:params`. */
function tryMatch(matcher: RouteMatcher, reqSegments: string[]): { params: Record<string, string>; paramCount: number } | undefined {
  if (matcher.segments.length !== reqSegments.length) return undefined;
  const params: Record<string, string> = {};
  let paramCount = 0;
  for (let i = 0; i < matcher.segments.length; i++) {
    const seg = matcher.segments[i]!;
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decodeURIComponent(reqSegments[i]!);
      paramCount++;
    } else if (seg !== reqSegments[i]) {
      return undefined;
    }
  }
  return { params, paramCount };
}

/**
 * Resolves a request (`method` + `pathname`) to a route and its path params.
 * A more specific match (fewer `:params`) wins, so `/orders/stats` beats
 * `/orders/:id`. Returns `undefined` when nothing matches.
 */
export function matchRoute(method: string, pathname: string, routes: readonly Route[], baseUrl = '/api'): RouteMatch | undefined {
  const reqSegments = segmentsOf(stripBase(pathname, baseUrl));
  const upper = method.toUpperCase() as HttpMethod;
  let best: { match: RouteMatch; paramCount: number } | undefined;
  for (const route of routes) {
    for (const matcher of matchersFor(route)) {
      if (matcher.method !== upper) continue;
      const result = tryMatch(matcher, reqSegments);
      if (!result) continue;
      if (!best || result.paramCount < best.paramCount) {
        best = { match: { route, params: result.params, op: matcher.op }, paramCount: result.paramCount };
      }
    }
  }
  return best?.match;
}

/** The data table a route reads/writes, for per-entity bypass + runtime simulation. `static`/`action`/`handler` touch no single table. */
export function routeEntity(route: Route): string | undefined {
  if (route.kind === 'resource') return route.table;
  if (route.kind === 'list' || route.kind === 'one') return route.from;
  if (route.kind === 'mutation') return route.from;
  return undefined;
}

/**
 * Every concrete `{method, path}` a set of routes answers (a `resource` fans
 * out to its CRUD paths), deduped. Paths keep `:id` placeholders so a
 * transport can register them as-is (MSW patterns / a router table). Ordering
 * is preserved; specificity is resolved by {@link matchRoute} at request time.
 */
export function expandRoutePaths(routes: readonly Route[]): Array<{ method: HttpMethod; path: string }> {
  const seen = new Set<string>();
  const out: Array<{ method: HttpMethod; path: string }> = [];
  for (const route of routes) {
    for (const matcher of matchersFor(route)) {
      const path = '/' + matcher.segments.join('/');
      const key = `${matcher.method} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ method: matcher.method, path });
    }
  }
  return out;
}

/** The default `resource` route for a table: full CRUD at `/<table>`. Legacy `api/<entity>` maps to this. */
export function defaultResourceRoute(table: string, path = `/${table}`): Route {
  return { id: table, kind: 'resource', path, table, methods: ['list', 'get', 'create', 'update', 'delete'] };
}

/** Default resource routes for a set of tables (used when a project declares no explicit routes). */
export function defaultRoutes(tables: Iterable<string>): Route[] {
  return [...tables].map((table) => defaultResourceRoute(table));
}
