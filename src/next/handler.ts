import {
  buildListResponse,
  createRecord,
  deleteRecord,
  errorResponse,
  getRecordById,
  jsonResponse,
  listRecords,
  readJsonBody,
  recordRequest,
  simulateRuntimeForEntity,
  updateRecord,
  type QueryContext,
} from '../query/index.js';
import { DEVTOOLS_SEGMENT, handleDevtoolsRequest } from './devtools.js';
import { forwardToTarget } from './forward.js';

/**
 * Matches both the App Router's pre-15 shape (`params` as a plain object)
 * and 15+'s (`params` as a `Promise`). `await`-ing a non-promise value just
 * resolves immediately, so one code path handles both.
 */
export interface NextRouteContext {
  params: Promise<{ mock?: string[] }> | { mock?: string[] };
}

export interface NextRouteHandlers {
  GET(request: Request, routeCtx: NextRouteContext): Promise<Response>;
  POST(request: Request, routeCtx: NextRouteContext): Promise<Response>;
  PUT(request: Request, routeCtx: NextRouteContext): Promise<Response>;
  PATCH(request: Request, routeCtx: NextRouteContext): Promise<Response>;
  DELETE(request: Request, routeCtx: NextRouteContext): Promise<Response>;
}

async function resolveSegments(routeCtx: NextRouteContext): Promise<string[]> {
  const resolved = await routeCtx.params;
  return resolved.mock ?? [];
}

function notFound(): Response {
  return jsonResponse({ error: { message: 'not found' } }, { status: 404 });
}

/**
 * If `<MockDevtools>` armed a per-request bypass for this exact
 * `METHOD pathname` (e.g. "GET /api/faqCategory" for a list route, or
 * "GET /api/faqCategory/1" for one record — independent toggles, list and
 * item routes bypass separately), forwards to `mock.config.js`'s `target`
 * and returns that response; otherwise `undefined`, meaning "answer with
 * the mock as usual". Falls back to the mock (with a console warning, not a
 * hard failure — a misconfigured `target` shouldn't take down every
 * bypassed request) if the bypass is armed but no `target` is configured.
 */
async function bypassedResponse(ctx: QueryContext, request: Request, segments: readonly string[]): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
  if (!ctx.requestBypass?.isBypassed(request.method, pathname)) return undefined;
  if (!ctx.target) {
    console.warn(
      `[mockingpug] request bypass armed for "${request.method} ${pathname}" but no "target" is configured in mock.config.js; serving mock instead`,
    );
    return undefined;
  }
  return forwardToTarget(request, ctx.target, segments);
}

/**
 * Builds `GET`/`POST`/`PUT`/`PATCH`/`DELETE` handlers for a single Next.js
 * App Router catch-all Route Handler
 * (`app/api/[[...mock]]/route.ts`), backed by the exact same
 * `query` resolver `mockingpug/react`'s MSW handlers use. No MSW dependency
 * here: Next.js Route Handlers already run inside the real server, so there
 * is nothing to intercept, only requests to answer directly.
 */
export function createNextHandlers(ctx: QueryContext): NextRouteHandlers {
  async function update(request: Request, routeCtx: NextRouteContext): Promise<Response> {
    const segments = await resolveSegments(routeCtx);
    if (segments[0] === DEVTOOLS_SEGMENT) {
      try {
        return await handleDevtoolsRequest(segments.slice(1), request.method, request, ctx);
      } catch (error) {
        return errorResponse(error);
      }
    }
    const [entity, id] = segments;
    if (!entity || id === undefined) return notFound();
    const startedAt = Date.now();
    let response: Response;
    try {
      const bypassed = await bypassedResponse(ctx, request, segments);
      if (bypassed) {
        response = bypassed;
      } else {
        await simulateRuntimeForEntity(ctx, entity, request);
        response = jsonResponse(await updateRecord(entity, id, await readJsonBody(request), ctx));
      }
    } catch (error) {
      response = errorResponse(error);
    }
    recordRequest(ctx, request, response.status, startedAt);
    return response;
  }

  return {
    async GET(request, routeCtx) {
      const segments = await resolveSegments(routeCtx);
      if (segments[0] === DEVTOOLS_SEGMENT) {
        try {
          return await handleDevtoolsRequest(segments.slice(1), 'GET', request, ctx);
        } catch (error) {
          return errorResponse(error);
        }
      }
      const [entity, id] = segments;
      if (!entity) return notFound();
      const startedAt = Date.now();
      let response: Response;
      try {
        const bypassed = await bypassedResponse(ctx, request, segments);
        if (bypassed) {
          response = bypassed;
        } else {
          await simulateRuntimeForEntity(ctx, entity, request);
          if (id !== undefined) {
            response = jsonResponse(await getRecordById(entity, id, ctx));
          } else {
            const url = new URL(request.url);
            const { data, meta } = await listRecords(entity, url.searchParams, ctx);
            response = buildListResponse(data, meta, ctx.pagination.strategy !== false && ctx.pagination.envelope);
          }
        }
      } catch (error) {
        response = errorResponse(error);
      }
      recordRequest(ctx, request, response.status, startedAt);
      return response;
    },

    async POST(request, routeCtx) {
      const segments = await resolveSegments(routeCtx);
      if (segments[0] === DEVTOOLS_SEGMENT) {
        try {
          return await handleDevtoolsRequest(segments.slice(1), 'POST', request, ctx);
        } catch (error) {
          return errorResponse(error);
        }
      }
      const [entity] = segments;
      if (!entity) return notFound();
      const startedAt = Date.now();
      let response: Response;
      try {
        const bypassed = await bypassedResponse(ctx, request, segments);
        if (bypassed) {
          response = bypassed;
        } else {
          await simulateRuntimeForEntity(ctx, entity, request);
          const created = await createRecord(entity, await readJsonBody(request), ctx);
          response = jsonResponse(created, { status: 201 });
        }
      } catch (error) {
        response = errorResponse(error);
      }
      recordRequest(ctx, request, response.status, startedAt);
      return response;
    },

    PUT: update,
    PATCH: update,

    async DELETE(request, routeCtx) {
      const segments = await resolveSegments(routeCtx);
      if (segments[0] === DEVTOOLS_SEGMENT) {
        try {
          return await handleDevtoolsRequest(segments.slice(1), 'DELETE', request, ctx);
        } catch (error) {
          return errorResponse(error);
        }
      }
      const [entity, id] = segments;
      if (!entity || id === undefined) return notFound();
      const startedAt = Date.now();
      let response: Response;
      try {
        const bypassed = await bypassedResponse(ctx, request, segments);
        if (bypassed) {
          response = bypassed;
        } else {
          await simulateRuntimeForEntity(ctx, entity, request);
          await deleteRecord(entity, id, ctx);
          response = new Response(null, { status: 204 });
        }
      } catch (error) {
        response = errorResponse(error);
      }
      recordRequest(ctx, request, response.status, startedAt);
      return response;
    },
  };
}
