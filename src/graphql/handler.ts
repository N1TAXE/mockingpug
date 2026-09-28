import { http, HttpResponse, type RequestHandler } from 'msw';
import { executeGraphQL, type GraphQLRequestBody } from './execute.js';
import type { QueryContext } from '../query/index.js';

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path;
}

export interface GraphQLHandlerOptions {
  /** GraphQL endpoint path relative to `baseUrl` (default `/graphql`). */
  path?: string;
  /** Prefix the path is mounted under (default `''`, i.e. `/graphql` at the root). */
  baseUrl?: string;
}

/**
 * A single MSW `POST` handler that answers GraphQL requests against the mock
 * store. Add it to the same worker as the REST handlers:
 *
 * ```ts
 * const worker = await setupMockWorker(ctx);   // REST at /api/*
 * worker.use(createGraphQLHandler(ctx));       // GraphQL at /graphql
 * ```
 *
 * Unlike REST there's no per-route bypass or runtime latency/error injection —
 * GraphQL always answers from the mock. (Bypass an underlying entity at the
 * schema level if you need the real backend for it.)
 */
export function createGraphQLHandler(ctx: QueryContext, options?: GraphQLHandlerOptions): RequestHandler {
  const url = joinUrl(options?.baseUrl ?? '', options?.path ?? '/graphql');
  return http.post(url, async ({ request }) => {
    let body: GraphQLRequestBody;
    try {
      body = (await request.json()) as GraphQLRequestBody;
    } catch {
      body = {};
    }
    const result = await executeGraphQL(body, ctx);
    return HttpResponse.json(result);
  });
}
