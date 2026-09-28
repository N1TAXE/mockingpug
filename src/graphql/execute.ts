import { graphql, type ExecutionResult, type GraphQLSchema } from 'graphql';
import { RequestError } from '../core/index.js';
import {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord,
  type QueryContext,
} from '../query/index.js';
import type { SchemaBundle } from '../generator/index.js';
import { buildGraphQLSchema } from './schema.js';

/** A GraphQL-over-HTTP request body (the shape every GraphQL client POSTs). */
export interface GraphQLRequestBody {
  query?: string;
  variables?: Record<string, unknown> | null;
  operationName?: string | null;
}

function pascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}
function camelCase(name: string): string {
  const p = pascalCase(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}
function pluralField(name: string): string {
  return camelCase(name) + 's';
}

// The schema depends only on the entity shapes, not on the store, so it's
// cached per SchemaBundle (a stable object). rootValue is rebuilt per request
// (cheap) because it closes over the live store in `ctx`.
const schemaCache = new WeakMap<SchemaBundle, GraphQLSchema>();
function getSchema(ctx: QueryContext): GraphQLSchema {
  let schema = schemaCache.get(ctx.schemas);
  if (!schema) {
    schema = buildGraphQLSchema(ctx.schemas, ctx.customDictionaries);
    schemaCache.set(ctx.schemas, schema);
  }
  return schema;
}

type Args = Record<string, unknown>;

/** Maps GraphQL list args onto the URLSearchParams `listRecords` already understands. */
function listParams(args: Args, ctx: QueryContext): URLSearchParams {
  const p = new URLSearchParams();
  const names = ctx.pagination.params;
  const paged: Array<[keyof typeof names, unknown]> = [
    ['page', args.page],
    ['limit', args.limit],
    ['offset', args.offset],
    ['cursor', args.cursor],
  ];
  for (const [key, value] of paged) if (value != null) p.set(names[key], String(value));
  if (args.sort != null) p.set('sort', String(args.sort));
  if (args.q != null) p.set('q', String(args.q));
  if (args.where && typeof args.where === 'object') {
    for (const [k, v] of Object.entries(args.where as Record<string, unknown>)) {
      if (v != null) p.set(k, String(v));
    }
  }
  return p;
}

/** A not-found lookup resolves to `null`/`false` (GraphQL convention); other errors propagate. */
function isNotFound(error: unknown): boolean {
  return error instanceof RequestError && error.code === 'MP-REQ-002';
}

/**
 * Builds the `rootValue` — one resolver per generated Query/Mutation field —
 * all delegating to the same store-backed resolvers the REST transport uses,
 * so GraphQL and REST stay perfectly consistent (same store, same generation).
 */
function buildRootValue(ctx: QueryContext): Record<string, (args: Args) => unknown> {
  const root: Record<string, (args: Args) => unknown> = {};
  for (const name of Object.keys(ctx.schemas)) {
    const T = pascalCase(name);
    root[pluralField(name)] = async (args) => (await listRecords(name, listParams(args, ctx), ctx)).data;
    root[camelCase(name)] = async ({ id }) => {
      try {
        return await getRecordById(name, String(id), ctx);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    };
    root[`create${T}`] = ({ input }) => createRecord(name, input ?? {}, ctx);
    root[`update${T}`] = ({ id, input }) => updateRecord(name, String(id), input ?? {}, ctx);
    root[`delete${T}`] = async ({ id }) => {
      try {
        await deleteRecord(name, String(id), ctx);
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    };
  }
  return root;
}

/**
 * Executes one GraphQL request against the mock store. Auto-generates the
 * schema from `ctx.schemas` (cached) and resolves every field through the same
 * store-backed CRUD the REST endpoints use. Returns the standard
 * `{ data?, errors? }` GraphQL result.
 */
export async function executeGraphQL(body: GraphQLRequestBody, ctx: QueryContext): Promise<ExecutionResult> {
  if (!body || typeof body.query !== 'string' || body.query.trim() === '') {
    return { errors: [{ message: 'Missing "query" in request body' } as never] };
  }
  return graphql({
    schema: getSchema(ctx),
    source: body.query,
    rootValue: buildRootValue(ctx),
    variableValues: body.variables ?? undefined,
    operationName: body.operationName ?? undefined,
  });
}
