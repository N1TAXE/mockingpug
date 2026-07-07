import { describe, expect, it } from 'vitest';
import { generateOpenApiSpec } from '../../src/openapi-gen/generate.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { EntitySchema } from '../../src/core/types.js';
import type { MockConfig } from '../../src/cli/mockConfig.js';

type Paths = Record<string, Record<string, unknown>>;
type Schemas = Record<string, Record<string, unknown>>;

function paths(spec: ReturnType<typeof generateOpenApiSpec>): Paths {
  return spec.paths as Paths;
}

function schemas(spec: ReturnType<typeof generateOpenApiSpec>): Schemas {
  return (spec.components as { schemas: Schemas }).schemas;
}

describe('generateOpenApiSpec : field type mapping', () => {
  it('maps every scalar generator kind to its JSON Schema type', () => {
    const entities: Record<string, EntitySchema> = {
      user: {
        name: 'user',
        file: 'x',
        amount: 1,
        data: {
          id: { kind: 'uuid' },
          age: { kind: 'number', mode: 'random', min: 0, max: 100 },
          login: { kind: 'username', style: 'FS' },
          email: { kind: 'email' },
          password: { kind: 'hash', algorithm: 'generic' },
          bio: { kind: 'lorem', length: 10 },
          createdAt: { kind: 'date' },
          isActive: { kind: 'boolean' },
          slug: { kind: 'slugify', field: 'login', separator: '-' },
        },
      },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const user = schemas(spec).User as { properties: Record<string, Record<string, unknown>> };
    expect(user.properties.id).toEqual({ type: 'string', format: 'uuid' });
    expect(user.properties.age).toEqual({ type: 'number', minimum: 0, maximum: 100 });
    expect(user.properties.login).toEqual({ type: 'string' });
    expect(user.properties.email).toEqual({ type: 'string', format: 'email' });
    expect(user.properties.password).toEqual({ type: 'string' });
    expect(user.properties.bio).toEqual({ type: 'string', minLength: 10, maxLength: 10 });
    expect(user.properties.createdAt).toEqual({ type: 'string', format: 'date-time' });
    expect(user.properties.isActive).toEqual({ type: 'boolean' });
    expect(user.properties.slug).toEqual({ type: 'string' });
  });

  it('renders an inline enum as a string schema with an enum list', () => {
    const entities: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { role: { kind: 'enumInline', values: ['ADMIN', 'USER'] } } },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const user = schemas(spec).User as { properties: Record<string, unknown> };
    expect(user.properties.role).toEqual({ type: 'string', enum: ['ADMIN', 'USER'] });
  });

  it('renders an array field with items recursing into the item type', () => {
    const entities: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { tags: { kind: 'array', item: { kind: 'lorem' }, count: 3 } } },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const user = schemas(spec).User as { properties: Record<string, unknown> };
    expect(user.properties.tags).toEqual({ type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 });
  });

  it('renders an array of a field-level cross-reference with items recursing into the target field\'s schema', () => {
    const entities: Record<string, EntitySchema> = {
      order: {
        name: 'order',
        file: 'x',
        amount: 1,
        data: { relatedProductIds: { kind: 'array', item: { kind: 'crossRef', entity: 'product', field: 'id' }, count: 3 } },
      },
      product: { name: 'product', file: 'x', amount: 1, data: { id: { kind: 'number', mode: 'increment' } } },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const order = schemas(spec).Order as { properties: Record<string, unknown> };
    expect(order.properties.relatedProductIds).toEqual({
      type: 'array',
      items: { type: 'number' },
      minItems: 3,
      maxItems: 3,
    });
  });

  it('renders an all-primitive custom dictionary as a typed enum', () => {
    const entities: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { role: { kind: 'custom', name: 'role' } } },
    };
    const customDictionaries = { role: [{ value: 'ADMIN', max: 5 }, { value: 'USER', chance: 0.9 }] };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG, customDictionaries);
    const user = schemas(spec).User as { properties: Record<string, unknown> };
    expect(user.properties.role).toEqual({ type: 'string', enum: ['ADMIN', 'USER'] });
  });

  it('falls back to a bare string schema for a custom dictionary with non-primitive values', () => {
    const entities: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { config: { kind: 'custom', name: 'config' } } },
    };
    const customDictionaries = { config: [{ value: { nested: true } }] };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG, customDictionaries);
    const user = schemas(spec).User as { properties: Record<string, unknown> };
    expect(user.properties.config).toEqual({ type: 'string' });
  });

  it('renders a bare cross-entity relation as an array of $ref to the target entity', () => {
    const entities: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { posts: { kind: 'crossRef', entity: 'blogpost' } } },
      blogpost: { name: 'blogpost', file: 'x', amount: 1, data: { id: { kind: 'uuid' } } },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const user = schemas(spec).User as { properties: Record<string, unknown> };
    expect(user.properties.posts).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Blogpost' } });
  });

  it('renders a field-level cross-entity relation as the target field\'s own schema', () => {
    const entities: Record<string, EntitySchema> = {
      blogpost: { name: 'blogpost', file: 'x', amount: 1, data: { author: { kind: 'crossRef', entity: 'user', field: 'id' } } },
      user: { name: 'user', file: 'x', amount: 1, data: { id: { kind: 'number', mode: 'increment' } } },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const blogpost = schemas(spec).Blogpost as { properties: Record<string, unknown> };
    expect(blogpost.properties.author).toEqual({ type: 'number' });
  });

  it('falls back gracefully when a cross-reference points at an unknown entity', () => {
    const entities: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { posts: { kind: 'crossRef', entity: 'ghost' } } },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const user = schemas(spec).User as { properties: Record<string, unknown> };
    expect(user.properties.posts).toEqual({ type: 'array', items: {} });
  });

  it('expands a multi-pick cross-reference into one property per projected field, not the schema key, including a filter param each', () => {
    const entities: Record<string, EntitySchema> = {
      order: {
        name: 'order',
        file: 'x',
        amount: 1,
        data: { product: { kind: 'crossRef', entity: 'product', fields: ['id', 'name'] } },
      },
      product: {
        name: 'product',
        file: 'x',
        amount: 1,
        data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'lorem' } },
      },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const order = schemas(spec).Order as { properties: Record<string, unknown> };
    expect(order.properties.id).toEqual({ type: 'number' });
    expect(order.properties.name).toEqual({ type: 'string' });
    expect(order.properties.product).toBeUndefined();

    const listParams = (paths(spec)['/order'] as { get: { parameters: Array<{ name: string }> } }).get.parameters;
    expect(listParams.some((p) => p.name === 'id')).toBe(true);
    expect(listParams.some((p) => p.name === 'name')).toBe(true);
    expect(listParams.some((p) => p.name === 'product')).toBe(false);
  });

  it('does not hang on a field-level cross-reference cycle', () => {
    const entities: Record<string, EntitySchema> = {
      a: { name: 'a', file: 'x', amount: 1, data: { bRef: { kind: 'crossRef', entity: 'b', field: 'aRef' } } },
      b: { name: 'b', file: 'x', amount: 1, data: { aRef: { kind: 'crossRef', entity: 'a', field: 'bRef' } } },
    };
    expect(() => generateOpenApiSpec(entities, DEFAULT_CONFIG)).not.toThrow();
  });

  it('PascalCases hyphenated/underscored entity names for the schema component name', () => {
    const entities: Record<string, EntitySchema> = {
      'blog-post': { name: 'blog-post', file: 'x', amount: 1, data: { id: { kind: 'uuid' } } },
    };
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    expect(schemas(spec)).toHaveProperty('BlogPost');
  });
});

describe('generateOpenApiSpec : REST surface', () => {
  const entities: Record<string, EntitySchema> = {
    user: { name: 'user', file: 'x', amount: 1, data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } } },
  };

  it('exposes GET/POST on the collection and GET/PUT/PATCH/DELETE on one record', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const p = paths(spec);
    expect(Object.keys(p['/user']!)).toEqual(['get', 'post']);
    expect(Object.keys(p['/user/{id}']!).sort()).toEqual(['delete', 'get', 'parameters', 'patch', 'put']);
  });

  it('never emits a devtools sub-API path', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    expect(Object.keys(paths(spec)).some((p) => p.includes('__mockingpug'))).toBe(false);
  });

  it('includes one optional query parameter per schema field for filtering, plus sort/q/searchFields', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const listGet = paths(spec)['/user']!.get as { parameters: Array<{ name: string }> };
    const names = listGet.parameters.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'name', 'sort', 'q', 'searchFields']));
  });

  it('list response is { data, meta } when pagination.envelope is true (the default)', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const listGet = paths(spec)['/user']!.get as { responses: { 200: { content: { 'application/json': { schema: unknown } } } } };
    const body = listGet.responses['200'].content['application/json'].schema as Record<string, unknown>;
    expect(body).toMatchObject({ type: 'object', properties: { data: { type: 'array' }, meta: { $ref: '#/components/schemas/PageMeta' } } });
    expect(schemas(spec)).toHaveProperty('PageMeta');
  });

  it('list response is a raw array + documented headers when pagination.envelope is false', () => {
    const config: MockConfig = { ...DEFAULT_CONFIG, pagination: { ...DEFAULT_CONFIG.pagination, envelope: false } };
    const spec = generateOpenApiSpec(entities, config);
    const listGet = paths(spec)['/user']!.get as {
      responses: { 200: { content: { 'application/json': { schema: unknown } }; headers: Record<string, unknown> } };
    };
    const body = listGet.responses['200'].content['application/json'].schema as Record<string, unknown>;
    expect(body).toEqual({ type: 'array', items: { $ref: '#/components/schemas/User' } });
    expect(Object.keys(listGet.responses['200'].headers)).toEqual(expect.arrayContaining(['X-Total-Count', 'X-Limit', 'X-Page']));
    expect(schemas(spec)).not.toHaveProperty('PageMeta');
  });

  it('list response has no pagination params/meta at all when pagination.strategy is false', () => {
    const config: MockConfig = { ...DEFAULT_CONFIG, pagination: { ...DEFAULT_CONFIG.pagination, strategy: false } };
    const spec = generateOpenApiSpec(entities, config);
    const listGet = paths(spec)['/user']!.get as { parameters: Array<{ name: string }>; responses: { 200: { headers?: unknown } } };
    expect(listGet.parameters.some((p) => p.name === 'page' || p.name === 'limit')).toBe(false);
    expect(listGet.responses['200'].headers).toBeUndefined();
  });

  it('uses offset/limit params and OffsetMeta for the offset strategy', () => {
    const config: MockConfig = { ...DEFAULT_CONFIG, pagination: { ...DEFAULT_CONFIG.pagination, strategy: 'offset' } };
    const spec = generateOpenApiSpec(entities, config);
    const listGet = paths(spec)['/user']!.get as { parameters: Array<{ name: string }> };
    expect(listGet.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(['offset', 'limit']));
    expect(schemas(spec)).toHaveProperty('OffsetMeta');
  });

  it('uses a cursor param and CursorMeta for the cursor strategy', () => {
    const config: MockConfig = { ...DEFAULT_CONFIG, pagination: { ...DEFAULT_CONFIG.pagination, strategy: 'cursor' } };
    const spec = generateOpenApiSpec(entities, config);
    const listGet = paths(spec)['/user']!.get as { parameters: Array<{ name: string }> };
    expect(listGet.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(['cursor', 'limit']));
    expect(schemas(spec)).toHaveProperty('CursorMeta');
  });

  it('respects custom pagination param names', () => {
    const config: MockConfig = {
      ...DEFAULT_CONFIG,
      pagination: { ...DEFAULT_CONFIG.pagination, params: { ...DEFAULT_CONFIG.pagination.params, page: 'p', limit: 'perPage' } },
    };
    const spec = generateOpenApiSpec(entities, config);
    const listGet = paths(spec)['/user']!.get as { parameters: Array<{ name: string }> };
    expect(listGet.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(['p', 'perPage']));
  });

  it('uses the configured baseUrl as the server URL', () => {
    const config: MockConfig = { ...DEFAULT_CONFIG, baseUrl: '/backend' };
    const spec = generateOpenApiSpec(entities, config);
    expect((spec.servers as Array<{ url: string }>)[0]!.url).toBe('/backend');
  });

  it('DELETE has no request body and responds 204', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const del = paths(spec)['/user/{id}']!.delete as { requestBody?: unknown; responses: Record<string, { description: string }> };
    expect(del.requestBody).toBeUndefined();
    expect(del.responses['204']!.description).toBe('No Content');
  });

  it('every entity gets its own tag, sorted alphabetically', () => {
    const multi: Record<string, EntitySchema> = {
      zebra: { name: 'zebra', file: 'x', amount: 1, data: { id: { kind: 'uuid' } } },
      alpha: { name: 'alpha', file: 'x', amount: 1, data: { id: { kind: 'uuid' } } },
    };
    const spec = generateOpenApiSpec(multi, DEFAULT_CONFIG);
    expect((spec.tags as Array<{ name: string }>).map((t) => t.name)).toEqual(['alpha', 'zebra']);
  });
});
