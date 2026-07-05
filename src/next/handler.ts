import {
  buildListResponse,
  createRecord,
  deleteRecord,
  errorResponse,
  getRecordById,
  jsonResponse,
  listRecords,
  readJsonBody,
  simulateRuntime,
  updateRecord,
  type QueryContext,
} from '../query/index.js';
import { DEVTOOLS_SEGMENT, handleDevtoolsRequest } from './devtools.js';

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
 * Builds `GET`/`POST`/`PUT`/`PATCH`/`DELETE` handlers for a single Next.js
 * App Router catch-all Route Handler
 * (`app/api/[[...mock]]/route.ts`), backed by the exact same
 * `query` resolver `mockingpug/react`'s MSW handlers use. No MSW dependency
 * here: Next.js Route Handlers already run inside the real server, so there
 * is nothing to intercept, only requests to answer directly.
 */
export function createNextHandlers(ctx: QueryContext): NextRouteHandlers {
  async function update(request: Request, routeCtx: NextRouteContext): Promise<Response> {
    const [entity, id] = await resolveSegments(routeCtx);
    if (!entity || id === undefined) return notFound();
    try {
      await simulateRuntime(ctx.runtime);
      return jsonResponse(await updateRecord(entity, id, await readJsonBody(request), ctx));
    } catch (error) {
      return errorResponse(error);
    }
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
      try {
        await simulateRuntime(ctx.runtime);
        if (id !== undefined) {
          return jsonResponse(await getRecordById(entity, id, ctx));
        }
        const url = new URL(request.url);
        const { data, meta } = await listRecords(entity, url.searchParams, ctx);
        return buildListResponse(data, meta, ctx.pagination.strategy !== false && ctx.pagination.envelope);
      } catch (error) {
        return errorResponse(error);
      }
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
      try {
        await simulateRuntime(ctx.runtime);
        const created = await createRecord(entity, await readJsonBody(request), ctx);
        return jsonResponse(created, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    },

    PUT: update,
    PATCH: update,

    async DELETE(_request, routeCtx) {
      const [entity, id] = await resolveSegments(routeCtx);
      if (!entity || id === undefined) return notFound();
      try {
        await simulateRuntime(ctx.runtime);
        await deleteRecord(entity, id, ctx);
        return new Response(null, { status: 204 });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
