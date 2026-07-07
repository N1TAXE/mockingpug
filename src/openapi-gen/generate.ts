import { expandDataFields } from '../core/expandFields.js';
import type { CustomDictionaryEntry, EntitySchema, FieldSpec } from '../core/types.js';
import type { MockConfig } from '../cli/mockConfig.js';

/** Only the two `MockConfig` fields the spec actually needs — lets a caller with just a `QueryContext` (no full loaded `mock.config.js`, e.g. the live `GET {baseUrl}/__mockingpug/docs` route) build one without fabricating the rest of the config shape. */
export type OpenApiConfig = Pick<MockConfig, 'baseUrl' | 'pagination'>;

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
    case 'enumInline':
      return { type: 'string', enum: spec.values };
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
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [fieldName, spec] of expandDataFields(schema.data)) {
    properties[fieldName] = fieldSchema(spec, allSchemas, customDictionaries, new Set());
  }
  return { type: 'object', properties };
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
): JsonSchema[] {
  return expandDataFields(schema.data).map(([fieldName, spec]) => ({
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
  }
  params.push(stringParam('sort', 'Comma-separated "field:asc|desc" clauses, e.g. "price:asc,name:desc".'));
  params.push(stringParam('q', 'Case-insensitive substring search across every string field (or just the fields in `searchFields`).'));
  params.push(stringParam('searchFields', 'Comma-separated field names to restrict `q` to.'));
  params.push(...filterParams(schema, allSchemas, customDictionaries));
  return params;
}

function listResponseSchema(entityName: string, config: OpenApiConfig): JsonSchema {
  const items = { type: 'array', items: schemaRef(entityName) };
  if (config.pagination.strategy === false || !config.pagination.envelope) return items;
  return {
    type: 'object',
    properties: { data: items, meta: { $ref: `#/components/schemas/${metaSchemaName(config.pagination.strategy)}` } },
  };
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

function entityPaths(entityName: string, schema: EntitySchema, allSchemas: Record<string, EntitySchema>, config: OpenApiConfig, customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined): Record<string, JsonSchema> {
  const tag = entityName;
  const collectionPath = `/${entityName}`;
  const itemPath = `/${entityName}/{id}`;
  const entityRef = schemaRef(entityName);
  const listHeaders = listResponseHeaders(config);

  return {
    [collectionPath]: {
      get: {
        tags: [tag],
        summary: `List "${entityName}" records`,
        parameters: listParameters(schema, allSchemas, config, customDictionaries),
        responses: {
          '200': { description: 'OK', ...jsonContent(listResponseSchema(entityName, config)), ...(listHeaders ? { headers: listHeaders } : {}) },
        },
      },
      post: {
        tags: [tag],
        summary: `Create a "${entityName}" record`,
        description: 'Generates a fully-formed record (every schema field, including a resolved field-level cross-ref) and merges the request body over it, so a minimal or empty body still yields a complete record.',
        requestBody: { required: false, ...jsonContent(entityRef) },
        responses: { '201': { description: 'Created', ...jsonContent(entityRef) } },
      },
    },
    [itemPath]: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        tags: [tag],
        summary: `Get one "${entityName}" record by id`,
        responses: { '200': { description: 'OK', ...jsonContent(entityRef) }, '404': errorResponse('No record with this id.') },
      },
      put: {
        tags: [tag],
        summary: `Replace/merge a "${entityName}" record`,
        description: 'Merges the request body over the existing record (safe-merge — see the security notes in the docs site); not a full-document replace.',
        requestBody: { required: false, ...jsonContent(entityRef) },
        responses: { '200': { description: 'OK', ...jsonContent(entityRef) }, '404': errorResponse('No record with this id.') },
      },
      patch: {
        tags: [tag],
        summary: `Partially update a "${entityName}" record`,
        description: 'Same merge semantics as PUT; both verbs are handled identically.',
        requestBody: { required: false, ...jsonContent(entityRef) },
        responses: { '200': { description: 'OK', ...jsonContent(entityRef) }, '404': errorResponse('No record with this id.') },
      },
      delete: {
        tags: [tag],
        summary: `Delete a "${entityName}" record`,
        responses: { '204': { description: 'No Content' }, '404': errorResponse('No record with this id.') },
      },
    },
  };
}

export interface GenerateOpenApiSpecOptions {
  title?: string;
  version?: string;
}

/**
 * Generates an OpenAPI 3.1 document describing the REST surface
 * `mockingpug/react`'s handlers / `mockingpug/next`'s Route Handler expose
 * for every entity: `GET`/`POST` on the collection, `GET`/`PUT`/`PATCH`/
 * `DELETE` on one record. The devtools sub-API (`{baseUrl}/__mockingpug/*`)
 * is deliberately excluded — it's an internal channel, not part of the
 * contract being mocked.
 */
export function generateOpenApiSpec(
  entities: Record<string, EntitySchema>,
  config: OpenApiConfig,
  customDictionaries?: Record<string, readonly CustomDictionaryEntry[]>,
  options: GenerateOpenApiSpecOptions = {},
): JsonSchema {
  const sortedEntities = Object.values(entities).sort((a, b) => a.name.localeCompare(b.name));

  const paths: Record<string, JsonSchema> = {};
  for (const schema of sortedEntities) {
    Object.assign(paths, entityPaths(schema.name, schema, entities, config, customDictionaries));
  }

  const schemas: Record<string, JsonSchema> = { Error: ERROR_SCHEMA };
  for (const schema of sortedEntities) {
    schemas[pascalCase(schema.name)] = entitySchemaComponent(schema, entities, customDictionaries);
  }
  if (config.pagination.strategy !== false && config.pagination.envelope) {
    schemas[metaSchemaName(config.pagination.strategy)] = metaSchemaComponent(config.pagination.strategy);
  }

  return {
    openapi: '3.1.0',
    info: { title: options.title ?? 'mockingpug', version: options.version ?? '0.0.0' },
    servers: [{ url: config.baseUrl }],
    tags: sortedEntities.map((schema) => ({ name: schema.name })),
    paths,
    components: { schemas },
  };
}
