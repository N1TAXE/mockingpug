import { buildSchema, GraphQLScalarType, valueFromASTUntyped, type GraphQLSchema } from 'graphql';
import { expandDataFields } from '../core/expandFields.js';
import type { CustomDictionaryEntry, EntitySchema, FieldSpec } from '../core/types.js';
import type { SchemaBundle } from '../generator/index.js';

/** `blog-post` -> `BlogPost` (a GraphQL type name). */
function pascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** `blog-post` -> `blogPost` (a GraphQL query/mutation field name). */
function camelCase(name: string): string {
  const p = pascalCase(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

// ponytail: naive pluralization (+s). "news" -> "newss", "category" -> "categorys".
// A per-entity `graphql.listName` override is the upgrade path if it ever bites.
function pluralField(name: string): string {
  return camelCase(name) + 's';
}

/** GraphQL names are `/^[_A-Za-z][_0-9A-Za-z]*$/`; a hyphenated mock field (`first-name`) can't be a GraphQL field, so it's skipped. */
function isGqlName(name: string): boolean {
  return /^[_A-Za-z][_0-9A-Za-z]*$/.test(name);
}

function scalarForValue(v: unknown): 'Float' | 'Boolean' | 'String' {
  return typeof v === 'number' ? 'Float' : typeof v === 'boolean' ? 'Boolean' : 'String';
}

/**
 * Maps one {@link FieldSpec} to a GraphQL output type. Same exhaustive-switch
 * shape as `types-gen`/`openapi-gen`, but anything GraphQL can't express as a
 * named type — a nested `object`, a mixed `conditional`, an unknown relation —
 * collapses to the opaque `JSON` scalar (still queryable, just untyped).
 */
function gqlType(
  spec: FieldSpec,
  schemas: SchemaBundle,
  customDictionaries: Record<string, readonly CustomDictionaryEntry[]> | undefined,
  visiting: Set<string>,
): string {
  switch (spec.kind) {
    case 'uuid':
    case 'username':
    case 'email':
    case 'hash':
    case 'lorem':
    case 'date':
    case 'slugify':
      return 'String';
    case 'number':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    case 'enumInline': {
      const types = new Set(spec.values.map(scalarForValue));
      return types.size === 1 ? [...types][0]! : 'String';
    }
    case 'array':
      return `[${gqlType(spec.item, schemas, customDictionaries, visiting)}]`;
    case 'custom': {
      const entries = customDictionaries?.[spec.name];
      if (entries && entries.length > 0 && entries.every((e) => typeof e.value === 'number')) return 'Float';
      if (entries && entries.length > 0 && entries.every((e) => typeof e.value === 'boolean')) return 'Boolean';
      return 'String';
    }
    case 'crossRef': {
      const target = schemas[spec.entity];
      if (spec.field === undefined) {
        // Bare relation: read-time join to the full target entity, always a list.
        return target ? `[${pascalCase(spec.entity)}!]` : 'JSON';
      }
      const targetField = target?.data[spec.field];
      const cycleKey = `${spec.entity}.${spec.field}`;
      if (!targetField || visiting.has(cycleKey)) return 'JSON';
      visiting.add(cycleKey);
      const resolved = gqlType(targetField, schemas, customDictionaries, visiting);
      visiting.delete(cycleKey);
      return resolved;
    }
    case 'literal':
      return spec.value === null ? 'String' : scalarForValue(spec.value);
    case 'conditional': {
      const t = gqlType(spec.then, schemas, customDictionaries, visiting);
      const e = gqlType(spec.else, schemas, customDictionaries, visiting);
      return t === e ? t : 'JSON';
    }
    case 'object':
      // ponytail: nested objects are opaque JSON in GraphQL. Generating named
      // nested types is the upgrade path if sub-field selection is ever needed.
      return 'JSON';
  }
}

function hasIdField(schema: EntitySchema): boolean {
  return expandDataFields(schema.data).some(([name]) => name === 'id');
}

/**
 * Builds the GraphQL SDL for a whole {@link SchemaBundle}: one object type per
 * entity, a `Query` with `<entity>` (by id) + `<entity>s` (list, with
 * `where`/`sort`/`q`/pagination args), and a `Mutation` with
 * `create/update/delete<Entity>`. Create/update bodies are the untyped `JSON`
 * scalar — same "any JSON is a valid body" contract the REST transport has.
 */
export function generateGraphQLSDL(
  schemas: SchemaBundle,
  customDictionaries?: Record<string, readonly CustomDictionaryEntry[]>,
): string {
  const entities = Object.values(schemas).sort((a, b) => a.name.localeCompare(b.name));

  const types = entities.map((schema) => {
    const fields = expandDataFields(schema.data)
      .filter(([name]) => isGqlName(name))
      .map(([name, spec]) => `  ${name}: ${gqlType(spec, schemas, customDictionaries, new Set())}`);
    // A type must have at least one field.
    if (fields.length === 0) fields.push('  _placeholder: JSON');
    return `type ${pascalCase(schema.name)} {\n${fields.join('\n')}\n}`;
  });

  const listArgs = '(where: JSON, sort: String, q: String, page: Int, limit: Int, offset: Int, cursor: String)';
  const queries = entities.flatMap((schema) => {
    const T = pascalCase(schema.name);
    const list = `  ${pluralField(schema.name)}${listArgs}: [${T}!]!`;
    if (!hasIdField(schema)) return [list];
    return [`  ${camelCase(schema.name)}(id: String!): ${T}`, list];
  });

  const mutations = entities
    .filter(hasIdField)
    .flatMap((schema) => {
      const T = pascalCase(schema.name);
      return [
        `  create${T}(input: JSON): ${T}`,
        `  update${T}(id: String!, input: JSON): ${T}`,
        `  delete${T}(id: String!): Boolean`,
      ];
    });

  const parts = [
    'scalar JSON',
    ...types,
    `type Query {\n${queries.join('\n')}\n}`,
  ];
  if (mutations.length > 0) parts.push(`type Mutation {\n${mutations.join('\n')}\n}`);
  return parts.join('\n\n') + '\n';
}

/**
 * Parses {@link generateGraphQLSDL} into an executable schema. The `JSON`
 * scalar is left as pass-through (identity serialize/parse) so record objects,
 * nested values, and `JSON` mutation inputs flow through untouched.
 */
export function buildGraphQLSchema(
  schemas: SchemaBundle,
  customDictionaries?: Record<string, readonly CustomDictionaryEntry[]>,
): GraphQLSchema {
  const schema = buildSchema(generateGraphQLSDL(schemas, customDictionaries));
  const json = schema.getType('JSON');
  if (json instanceof GraphQLScalarType) {
    json.serialize = (v) => v;
    json.parseValue = (v) => v;
    // Inline JSON literals (`input: {a: 1}`) — prefer variables, but keep
    // literals working via graphql's own untyped-AST reader.
    json.parseLiteral = (ast, vars) => valueFromASTUntyped(ast, vars ?? undefined);
  }
  return schema;
}
