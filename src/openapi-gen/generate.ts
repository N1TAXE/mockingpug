import { expandDataFields } from '../core/expandFields.js';
import { defaultRoutes, routeEntity, type Route } from '../core/routes.js';
import type { CustomDictionaryEntry, EntitySchema, FieldSpec } from '../core/types.js';
import type { MockConfig } from '../cli/mockConfig.js';

/** Only the `MockConfig` fields the spec actually needs — lets a caller with just a `QueryContext` (no full loaded `mock.config.js`, e.g. the live `GET {baseUrl}/__mockingpug/docs` route) build one without fabricating the rest of the config shape. `response` is the project-wide envelope/meta template (routes may still override it per-endpoint via `responseShape`). */
export type OpenApiConfig = Pick<MockConfig, 'baseUrl' | 'pagination' | 'response'>;

/** A JSON Schema fragment (OpenAPI 3.1 schemas are JSON Schema 2020-12), kept as a plain object rather than a typed union: the shapes involved are small and ad hoc, a full JSON Schema type wouldn't earn its keep here. */
export type JsonSchema = Record<string, unknown>;

/** `blogpost` -> `Blogpost`, `blog-post`/`blog_post` -> `BlogPost`: matches `types-gen`'s naming so a `$ref`'d schema name lines up with the generated TS interface name for the same entity. */
export function pascalCase(entityName: string): string {
  return entityName
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function schemaRef(entityName: string): JsonSchema {
  return { $ref: `#/components/schemas/${pascalCase(entityName)}` };
}

/** All-primitive custom dictionaries become an `enum`; anything else falls back to a bare `string`, same fallback `types-gen`'s `customDictionaryType()` uses. */
function customDictionarySchema(entries: readonly CustomDictionaryEntry[] | undefined): JsonSchema {
  if (!entries || entries.length === 0) return { type: 'string' };
  const literals = [...new Set(entries.map((entry) => entry.value))];
  if (literals.every((v) => typeof v === 'string')) return { type: 'string', enum: literals };
  if (literals.every((v) => typeof v === 'number')) return { type: 'number', enum: literals };
  if (literals.every((v) => typeof v === 'string' || typeof v === 'number')) return { enum: literals };
  return { type: 'string' };
}

/**
 * Maps one {@link FieldSpec} to a JSON Schema fragment. Structurally a copy
 * of `types-gen/generate.ts`'s `fieldType()` (same switch, same
 * `crossRef`/`custom` resolution, same cycle guard), just emitting a schema
 * fragment instead of a TS type string.
 */
export function fieldSchema(
  spec: FieldSpec,
  schemas: Record<string, EntitySchema>,
  customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined,
  visiting: Set<string>,
): JsonSchema {
  switch (spec.kind) {
    case 'uuid':
      return { type: 'string', format: 'uuid' };
    case 'number':
      return {
        type: 'number',
        ...(spec.min !== undefined ? { minimum: spec.min } : {}),
        ...(spec.max !== undefined ? { maximum: spec.max } : {}),
      };
    case 'username':
      return { type: 'string' };
    case 'email':
      return { type: 'string', format: 'email' };
    case 'hash':
      return { type: 'string' };
    case 'lorem':
      // `loremText()` pads-then-truncates to exactly `length` chars, not just up to it.
      return { type: 'string', ...(spec.length !== undefined ? { minLength: spec.length, maxLength: spec.length } : {}) };
    case 'date':
      return { type: 'string', format: 'date-time' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enumInline': {
      // Type follows the literal values (numbers/booleans keep their type).
      const t = spec.values.every((v) => typeof v === 'number') ? 'number' : spec.values.every((v) => typeof v === 'boolean') ? 'boolean' : spec.values.every((v) => typeof v === 'string') ? 'string' : undefined;
      return { ...(t ? { type: t } : {}), enum: spec.values };
    }
    case 'array':
      return {
        type: 'array',
        items: fieldSchema(spec.item, schemas, customDictionaries, visiting),
        minItems: spec.count,
        maxItems: spec.count,
      };
    case 'slugify':
      return { type: 'string' };
    case 'custom':
      return customDictionarySchema(customDictionaries?.[spec.name]);
    case 'crossRef': {
      const targetSchema = schemas[spec.entity];
      if (spec.field === undefined) {
        // Bare relation: resolved at read time as the full target entity's
        // public shape, always an array.
        return targetSchema ? { type: 'array', items: schemaRef(spec.entity) } : { type: 'array', items: {} };
      }
      // Field-level relation: the stored value IS the target's field value.
      const targetField = targetSchema?.data[spec.field];
      const cycleKey = `${spec.entity}.${spec.field}`;
      if (!targetField || visiting.has(cycleKey)) return {};
      visiting.add(cycleKey);
      const resolved = fieldSchema(targetField, schemas, customDictionaries, visiting);
      visiting.delete(cycleKey);
      return resolved;
    }
    case 'literal':
      return spec.value === null ? { type: 'null' } : { type: typeof spec.value, const: spec.value };
    case 'conditional':
      return { oneOf: [fieldSchema(spec.then, schemas, customDictionaries, visiting), fieldSchema(spec.else, schemas, customDictionaries, visiting)] };
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(Object.entries(spec.fields).map(([key, sub]) => [key, fieldSchema(sub, schemas, customDictionaries, visiting)])),
      };
  }
}

/**
 * The object schema for one entity's public record shape (`components.schemas.<PascalEntity>`).
 * Deliberately no `required` array: this is documentation of a shape the
 * mock always fully populates on read, not a request-body validation
 * contract, and the very same schema is also referenced (unmodified) as
 * the loose `POST`/`PUT`/`PATCH` request body, where every field really is
 * optional (unset fields fall back to the generator or the existing record).
 */
function entitySchemaComponent(
  schema: EntitySchema,
  allSchemas: Record<string, EntitySchema>,
  customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined,
  writeOnly?: ReadonlySet<string>,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [fieldName, spec] of expandDataFields(schema.data)) {
    const field = fieldSchema(spec, allSchemas, customDictionaries, new Set());
    // A field no endpoint ever returns (projected out of every `select`) is
    // documented as write-only: it exists in the record and can be sent, but
    // never appears in a response body.
    properties[fieldName] = writeOnly?.has(fieldName) ? { ...field, writeOnly: true } : field;
  }
  return { type: 'object', properties };
}

/**
 * Fields no endpoint returns for each table, per R5 §4: a field is write-only
 * when the table is read by at least one route and none of those reads includes
 * it in their `select` (a `select`-less read returns everything, so the table
 * then has no write-only fields). Tables with no reading route (internal, or
 * legacy resource which returns everything) get an empty set.
 */
function computeWriteOnly(routes: readonly Route[], entities: Record<string, EntitySchema>): Map<string, Set<string>> {
  const returned = new Map<string, Set<string> | 'all'>();
  const note = (table: string, fields: 'all' | readonly string[]): void => {
    const cur = returned.get(table);
    if (cur === 'all') return;
    if (fields === 'all') return void returned.set(table, 'all');
    const set = cur ?? new Set<string>();
    for (const f of fields) set.add(f);
    returned.set(table, set);
  };
  for (const route of routes) {
    if (route.kind === 'resource') note(route.table, 'all');
    else if (route.kind === 'list' || route.kind === 'one') note(route.from, route.select ?? 'all');
    else if (route.kind === 'mutation' && route.from) note(route.from, route.response !== undefined ? [] : (route.select ?? 'all'));
  }

  const writeOnly = new Map<string, Set<string>>();
  for (const [table, seen] of returned) {
    if (seen === 'all') continue;
    const schema = entities[table];
    if (!schema) continue;
    const set = new Set<string>();
    for (const [fieldName] of expandDataFields(schema.data)) if (!seen.has(fieldName)) set.add(fieldName);
    if (set.size > 0) writeOnly.set(table, set);
  }
  return writeOnly;
}

const ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Present for an expected `RequestError` (bad id, bad body); absent for an unexpected internal failure.' },
        message: { type: 'string' },
        source: { type: 'string', description: '"mockingpug", present only on the generic 500 an unexpected internal failure returns.' },
      },
    },
  },
};

function metaSchemaName(strategy: OpenApiConfig['pagination']['strategy']): string {
  if (strategy === 'page') return 'PageMeta';
  if (strategy === 'offset') return 'OffsetMeta';
  return 'CursorMeta';
}

function metaSchemaComponent(strategy: 'page' | 'offset' | 'cursor'): JsonSchema {
  const base = { total: { type: 'integer' }, limit: { type: 'integer' } };
  if (strategy === 'page') {
    return { type: 'object', properties: { ...base, page: { type: 'integer' }, pageCount: { type: 'integer' } } };
  }
  if (strategy === 'offset') {
    return { type: 'object', properties: { ...base, offset: { type: 'integer' } } };
  }
  return { type: 'object', properties: { ...base, nextCursor: { type: ['string', 'null'] } } };
}

/** JSON Schema for each `response.meta` placeholder (`$page`, `$limit`, …). Unknown placeholders fall back to "any". */
const META_FIELD_SCHEMA: Record<string, JsonSchema> = {
  total: { type: 'integer' },
  page: { type: 'integer' },
  limit: { type: 'integer' },
  pageCount: { type: 'integer' },
  offset: { type: 'integer' },
  nextCursor: { type: ['string', 'null'] },
  groupBy: { type: 'string' },
  limitPerGroup: { type: 'integer' },
  totalGroups: { type: 'integer' },
  strategy: { type: 'string' },
};

/**
 * Turns a `response`-style template into a JSON Schema: a `"$name"` string is
 * resolved by `resolve` (to a placeholder schema), everything else is a literal
 * documented with `const`, and nested objects recurse.
 */
function templateSchema(node: unknown, resolve: (name: string) => JsonSchema): JsonSchema {
  if (typeof node === 'string' && node.length > 1 && node[0] === '$') return resolve(node.slice(1));
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    return { type: 'object', properties: Object.fromEntries(Object.entries(node).map(([k, v]) => [k, templateSchema(v, resolve)])) };
  }
  return { const: node };
}

/** The `meta` object schema for a `response.meta` template (renamed/added fields → typed placeholders / consts). */
function metaTemplateSchema(template: unknown): JsonSchema {
  return templateSchema(template, (field) => META_FIELD_SCHEMA[field] ?? {});
}

/** Per-endpoint `responseShape` merged field-by-field over the project-wide `response.*`. */
function effectiveResponse(route: Route, config: OpenApiConfig): MockConfig['response'] {
  const override = (route as { responseShape?: { envelope?: unknown; listKey?: string; meta?: unknown } }).responseShape;
  const base = config.response;
  if (!override) return base;
  return {
    envelope: override.envelope !== undefined ? override.envelope : base?.envelope,
    listKey: override.listKey !== undefined ? override.listKey : base?.listKey,
    meta: override.meta !== undefined ? override.meta : base?.meta,
  };
}

function intParam(name: string, description: string, defaultValue?: number): JsonSchema {
  return {
    name,
    in: 'query',
    required: false,
    description,
    schema: { type: 'integer', ...(defaultValue !== undefined ? { default: defaultValue } : {}) },
  };
}

function stringParam(name: string, description: string): JsonSchema {
  return { name, in: 'query', required: false, description, schema: { type: 'string' } };
}

/** One optional query parameter per schema field, an exact-match (or comma-separated OR) filter — see `query/filter.ts`. Every schema field is a candidate, regardless of its own type: filtering compares the *stringified* field value. */
function filterParams(
  schema: EntitySchema,
  allSchemas: Record<string, EntitySchema>,
  customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined,
  filterable?: readonly string[],
): JsonSchema[] {
  return expandDataFields(schema.data)
    .filter(([fieldName]) => !filterable || filterable.includes(fieldName))
    .map(([fieldName, spec]) => ({
      name: fieldName,
      in: 'query',
      required: false,
      description: `Exact-match filter on "${fieldName}" (comma-separated value = OR).`,
      schema: fieldSchema(spec, allSchemas, customDictionaries, new Set()),
    }));
}

function listParameters(
  schema: EntitySchema,
  allSchemas: Record<string, EntitySchema>,
  config: OpenApiConfig,
  customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined,
  filterable?: readonly string[],
): JsonSchema[] {
  const params: JsonSchema[] = [];
  const { pagination } = config;
  if (pagination.strategy !== false) {
    const p = pagination.params;
    if (pagination.strategy === 'page') params.push(intParam(p.page, 'Page number (1-based).', 1));
    if (pagination.strategy === 'offset') params.push(intParam(p.offset, 'Number of records to skip.', 0));
    if (pagination.strategy === 'cursor') {
      params.push(stringParam(p.cursor, "Opaque cursor from a previous response's meta.nextCursor."));
    }
    params.push(intParam(p.limit, `Max records per page (default ${pagination.defaultLimit}, capped at ${pagination.maxLimit}).`, pagination.defaultLimit));
    params.push(
      stringParam(
        p.groupBy,
        `Field name to group by. Combined with "${p.limitPerGroup}", applies the limit per distinct value of this field instead of once to the whole batch — e.g. "?${p.groupBy}=category_id&${p.limitPerGroup}=5" returns up to 5 records for *each* category, not 5 total. Response meta switches to {strategy:"group",...} instead of the usual pagination meta when both params are set.`,
      ),
    );
    params.push(
      intParam(
        p.limitPerGroup,
        `Max records per distinct "${p.groupBy}" value; only applies when "${p.groupBy}" is also set (default ${pagination.defaultLimit}, capped at ${pagination.maxLimit}).`,
        undefined,
      ),
    );
  }
  params.push(stringParam('sort', 'Comma-separated "field:asc|desc" clauses, e.g. "price:asc,name:desc".'));
  params.push(stringParam('q', 'Case-insensitive substring search across every string field (or just the fields in `searchFields`).'));
  params.push(stringParam('searchFields', 'Comma-separated field names to restrict `q` to.'));
  params.push(...filterParams(schema, allSchemas, customDictionaries, filterable));
  return params;
}

/**
 * The list response body schema. Reflects the effective `response` config: a
 * `response.meta` template reshapes the meta object; a `response.envelope`
 * template (with `$payload`/`$meta`/`listKey`) reshapes the whole wrapper.
 * Falls back to the default `{ data, meta: $ref … }` (or a bare array).
 */
function listEnvelope(itemsSchema: JsonSchema, config: OpenApiConfig, response: MockConfig['response']): JsonSchema {
  const items: JsonSchema = { type: 'array', items: itemsSchema };
  if (config.pagination.strategy === false) return items;

  const metaSchema: JsonSchema =
    response?.meta !== undefined
      ? metaTemplateSchema(response.meta)
      : { $ref: `#/components/schemas/${metaSchemaName(config.pagination.strategy)}` };

  if (response?.envelope !== undefined) {
    const payloadSchema: JsonSchema = response.listKey !== undefined ? { type: 'object', properties: { [response.listKey]: items } } : items;
    return templateSchema(response.envelope, (name) => (name === 'payload' ? payloadSchema : name === 'meta' ? metaSchema : {}));
  }

  if (!config.pagination.envelope) return items; // bare array + X-* headers
  return { type: 'object', properties: { data: items, meta: metaSchema } };
}

function listResponseHeaders(config: OpenApiConfig): JsonSchema | undefined {
  if (config.pagination.strategy === false || config.pagination.envelope) return undefined;
  const headers: Record<string, JsonSchema> = {
    'X-Total-Count': { schema: { type: 'integer' } },
    'X-Limit': { schema: { type: 'integer' } },
  };
  if (config.pagination.strategy === 'page') headers['X-Page'] = { schema: { type: 'integer' } };
  if (config.pagination.strategy === 'offset') headers['X-Offset'] = { schema: { type: 'integer' } };
  if (config.pagination.strategy === 'cursor') headers['X-Next-Cursor'] = { schema: { type: 'string' } };
  return headers;
}

function errorResponse(description: string): JsonSchema {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
}

function jsonContent(schema: JsonSchema): JsonSchema {
  return { content: { 'application/json': { schema } } };
}

/** `/orders/:id/full` → `/orders/{id}/full` (route param syntax → OpenAPI param syntax). */
function openapiPath(path: string): string {
  return path.replace(/:([A-Za-z_]\w*)/g, '{$1}');
}

function pathParamObjects(path: string): JsonSchema[] {
  return [...path.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
}

type IncludeSpec = string | { from: string; by: string; select?: string[] };

/**
 * The response body schema for a projected read (`list`/`one`): the table's
 * fields restricted to `select` (all when absent), plus one property per
 * `include` — a `$ref` to the FK target for the string form, an array of
 * `$ref`s for the reverse `{from, by}` form.
 */
function projectedSchema(
  fromTable: string,
  select: string[] | undefined,
  include: Record<string, IncludeSpec> | undefined,
  entities: Record<string, EntitySchema>,
  customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined,
): JsonSchema {
  const schema = entities[fromTable];
  if (!schema) return schemaRef(fromTable);
  const properties: Record<string, JsonSchema> = {};
  for (const [fieldName, spec] of expandDataFields(schema.data)) {
    if (select && !select.includes(fieldName)) continue;
    properties[fieldName] = fieldSchema(spec, entities, customDictionaries, new Set());
  }
  for (const [key, spec] of Object.entries(include ?? {})) {
    if (typeof spec === 'string') {
      const fk = schema.data[spec];
      properties[key] = fk && fk.kind === 'crossRef' ? schemaRef(fk.entity) : {};
    } else {
      properties[key] = { type: 'array', items: schemaRef(spec.from) };
    }
  }
  return { type: 'object', properties };
}

/** Legacy `resource`: the classic per-table CRUD surface, at the route's own base path and limited to its `methods`. */
function resourcePaths(route: Extract<Route, { kind: 'resource' }>, entities: Record<string, EntitySchema>, config: OpenApiConfig, customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined): Record<string, JsonSchema> {
  const schema = entities[route.table];
  if (!schema) return {};
  const tag = route.table;
  const base = openapiPath(route.path);
  const item = `${base}/{id}`;
  const ref = schemaRef(route.table);
  const listHeaders = listResponseHeaders(config);
  const collection: JsonSchema = {};
  const single: JsonSchema = { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] };

  if (route.methods.includes('list')) {
    collection.get = { tags: [tag], summary: `List "${route.table}" records`, parameters: listParameters(schema, entities, config, customDictionaries), responses: { '200': { description: 'OK', ...jsonContent(listEnvelope(ref, config, effectiveResponse(route, config))), ...(listHeaders ? { headers: listHeaders } : {}) } } };
  }
  if (route.methods.includes('create')) {
    collection.post = { tags: [tag], summary: `Create a "${route.table}" record`, description: 'Generates a fully-formed record and merges the request body over it, so a minimal or empty body still yields a complete record.', requestBody: { required: false, ...jsonContent(ref) }, responses: { '201': { description: 'Created', ...jsonContent(ref) } } };
  }
  if (route.methods.includes('get')) {
    single.get = { tags: [tag], summary: `Get one "${route.table}" record by id`, responses: { '200': { description: 'OK', ...jsonContent(ref) }, '404': errorResponse('No record with this id.') } };
  }
  if (route.methods.includes('update')) {
    single.put = { tags: [tag], summary: `Replace/merge a "${route.table}" record`, description: 'Safe-merge over the existing record; not a full-document replace.', requestBody: { required: false, ...jsonContent(ref) }, responses: { '200': { description: 'OK', ...jsonContent(ref) }, '404': errorResponse('No record with this id.') } };
    single.patch = { tags: [tag], summary: `Partially update a "${route.table}" record`, description: 'Same merge semantics as PUT.', requestBody: { required: false, ...jsonContent(ref) }, responses: { '200': { description: 'OK', ...jsonContent(ref) }, '404': errorResponse('No record with this id.') } };
  }
  if (route.methods.includes('delete')) {
    single.delete = { tags: [tag], summary: `Delete a "${route.table}" record`, responses: { '204': { description: 'No Content' }, '404': errorResponse('No record with this id.') } };
  }

  const out: Record<string, JsonSchema> = {};
  if (Object.keys(collection).length > 0) out[base] = collection;
  if (Object.keys(single).length > 1) out[item] = single;
  return out;
}

/** Merges an operation for one authored route into the path map, keyed by its OpenAPI path + HTTP method. */
function addRouteOperation(paths: Record<string, JsonSchema>, route: Route, entities: Record<string, EntitySchema>, config: OpenApiConfig, customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined): void {
  if (route.kind === 'resource' || route.kind === 'handler') return; // resource handled separately; handler is code, opaque here
  const path = openapiPath(route.path);
  const method = route.method.toLowerCase();
  const tag = routeEntity(route);
  const params = pathParamObjects(route.path);
  const base: JsonSchema = { ...(tag ? { tags: [tag] } : {}), ...(route.description ? { description: route.description } : {}), ...(params.length ? { parameters: params } : {}) };
  let op: JsonSchema;

  if (route.kind === 'list') {
    const items = projectedSchema(route.from, route.select, route.include, entities, customDictionaries);
    const listHeaders = listResponseHeaders(config);
    op = { ...base, summary: `List from "${route.from}"`, parameters: [...params, ...listParameters(entities[route.from] ?? { data: {} } as EntitySchema, entities, config, customDictionaries, route.filterable)], responses: { '200': { description: 'OK', ...jsonContent(listEnvelope(items, config, effectiveResponse(route, config))), ...(listHeaders ? { headers: listHeaders } : {}) } } };
  } else if (route.kind === 'one') {
    const schema = projectedSchema(route.from, route.select, route.include, entities, customDictionaries);
    op = { ...base, summary: `Get one from "${route.from}"`, responses: { '200': { description: 'OK', ...jsonContent(schema) }, '404': errorResponse('No record matched.') } };
  } else if (route.kind === 'mutation') {
    const responseSchema = route.response !== undefined ? exampleContent(route.response) : route.from ? jsonContent(projectedSchema(route.from, route.select, undefined, entities, customDictionaries)) : jsonContent({ type: 'object' });
    op = { ...base, summary: `${route.method} ${route.path}`, description: `${route.description ?? ''} A mock method map: responds 200 without changing stored data.`.trim(), ...(route.body !== undefined ? { requestBody: { required: false, ...exampleContent(route.body) } } : {}), responses: { '200': { description: 'OK', ...responseSchema } } };
  } else if (route.kind === 'composite') {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, slot] of Object.entries(route.shape)) {
      const one = projectedSchema(slot.from, slot.select, slot.include, entities, customDictionaries);
      properties[key] = slot.first ? one : { type: 'array', items: one };
    }
    op = { ...base, summary: `Composite from ${Object.values(route.shape).map((s) => s.from).join(', ')}`, responses: { '200': { description: 'OK', ...jsonContent({ type: 'object', properties }) } } };
  } else if (route.kind === 'action') {
    const respond = route.respond;
    const status = 'status' in respond ? String(respond.status) : '200';
    const content =
      'status' in respond
        ? { content: { 'application/json': { example: respond.body } } }
        : 'from' in respond
          ? jsonContent(respond.first ? projectedSchema(respond.from, respond.select, undefined, entities, customDictionaries) : { type: 'array', items: projectedSchema(respond.from, respond.select, undefined, entities, customDictionaries) })
          : jsonContent({ type: 'object' });
    op = { ...base, summary: `Action ${route.method} ${route.path}`, description: `${route.description ?? ''} Writes via ${route.effects.length} effect(s).`.trim(), responses: { [status]: { description: 'OK', ...content } } };
  } else {
    // static
    op = { ...base, summary: `Static ${route.method} ${route.path}`, responses: { [String(route.status)]: { description: 'OK', content: { 'application/json': { example: route.body } } } } };
  }

  paths[path] = { ...(paths[path] ?? {}), [method]: op };
}

/** `content` with a parsed JSON `example` (mutation `body`/`response` are JSON text). Falls back to a raw string example if it doesn't parse. */
function exampleContent(jsonText: string): JsonSchema {
  let example: unknown;
  try {
    example = JSON.parse(jsonText);
  } catch {
    example = jsonText;
  }
  return { content: { 'application/json': { example } } };
}

export interface GenerateOpenApiSpecOptions {
  title?: string;
  version?: string;
}

/**
 * Generates an OpenAPI 3.1 document from the effective endpoint set (R5): a
 * legacy `resource` fans out to its per-table CRUD; `list`/`one` document their
 * projected response (`select` + `include`); `mutation` documents its example
 * request/response body (a method map — 200, no store write). Component schemas
 * are one per table, with fields no endpoint returns marked `writeOnly`. The
 * devtools sub-API (`{baseUrl}/__mockingpug/*`) is excluded — internal channel.
 */
export function generateOpenApiSpec(
  entities: Record<string, EntitySchema>,
  routes: readonly Route[] | undefined,
  config: OpenApiConfig,
  customDictionaries?: Record<string, readonly CustomDictionaryEntry[]>,
  options: GenerateOpenApiSpecOptions = {},
): JsonSchema {
  const effectiveRoutes = routes ?? defaultRoutes(Object.keys(entities));
  const writeOnly = computeWriteOnly(effectiveRoutes, entities);

  const paths: Record<string, JsonSchema> = {};
  for (const route of effectiveRoutes) {
    if (route.kind === 'resource') Object.assign(paths, resourcePaths(route, entities, config, customDictionaries));
    else addRouteOperation(paths, route, entities, config, customDictionaries);
  }

  // Tags: every table a route reads, in stable order — drives the docs nav.
  const tags = [...new Set(effectiveRoutes.map(routeEntity).filter((t): t is string => t !== undefined))].sort();

  const schemas: Record<string, JsonSchema> = { Error: ERROR_SCHEMA };
  for (const schema of Object.values(entities).sort((a, b) => a.name.localeCompare(b.name))) {
    schemas[pascalCase(schema.name)] = entitySchemaComponent(schema, entities, customDictionaries, writeOnly.get(schema.name));
  }
  // Register the default meta component only if it's actually referenced. A
  // `response.meta` / `responseShape.meta` template inlines the meta at each use
  // site, so with a project-wide template (or every route overriding) nothing
  // `$ref`s it — scan the built paths rather than guessing from config.
  if (config.pagination.strategy !== false) {
    const metaRef = `#/components/schemas/${metaSchemaName(config.pagination.strategy)}`;
    if (JSON.stringify(paths).includes(metaRef)) {
      schemas[metaSchemaName(config.pagination.strategy)] = metaSchemaComponent(config.pagination.strategy);
    }
  }

  return {
    openapi: '3.1.0',
    info: { title: options.title ?? 'mockingpug', version: options.version ?? '0.0.0' },
    servers: [{ url: config.baseUrl }],
    tags: tags.map((name) => ({ name })),
    paths,
    components: { schemas },
  };
}

/** A sensible default when the caller has no full `mock.config.js` — page pagination, `/api` base. */
const DEFAULT_OPENAPI_CONFIG: OpenApiConfig = {
  baseUrl: '/api',
  pagination: {
    strategy: 'page',
    params: { page: 'page', limit: 'limit', offset: 'offset', cursor: 'cursor', groupBy: 'groupBy', limitPerGroup: 'limitPerGroup' },
    defaultLimit: 20,
    maxLimit: 100,
    envelope: true,
  },
};

/**
 * Public, dependency- and fs-free OpenAPI 3.1 generator (R19): the same
 * `generateOpenApiSpec` the CLI/devtools use, with `config` optional so cloud
 * (and any consumer) can build a spec from just entities + routes — the same
 * inputs it already sends for data/API previews. Runs in the browser and Node.
 */
export function generateOpenApi(
  entities: Record<string, EntitySchema>,
  routes?: readonly Route[],
  config?: OpenApiConfig,
  customDictionaries?: Record<string, readonly CustomDictionaryEntry[]>,
  options?: GenerateOpenApiSpecOptions,
): JsonSchema {
  return generateOpenApiSpec(entities, routes, config ?? DEFAULT_OPENAPI_CONFIG, customDictionaries, options);
}
