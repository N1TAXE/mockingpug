import { defaultRoutes, matchRoute, routeEntity, RequestError, type Route } from '../core/index.js';
import { errorResponse, recordRequest, serveRoute, type QueryContext } from '../query/index.js';
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

function notFound(pathname: string): Response {
  return errorResponse(new RequestError('MP-REQ-001', `no route for "${pathname}"`, 404));
}

/**
 * If this request should hit the real backend instead of the mock — a
 * `<MockDevtools>`-armed per-request bypass (exact `METHOD pathname`), an
 * explicit `route.bypass`, or an entity-level `bypass: true` — forwards to
 * `mock.config.js`'s `target` and returns that response. Returns `undefined`
 * to mean "answer with the mock". Falls back to the mock (with a warning, not
 * a hard failure) when a bypass is armed but no `target` is configured.
 */
async function maybeForward(
  ctx: QueryContext,
  request: Request,
  segments: readonly string[],
  route: Route,
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
  const entity = routeEntity(route);
  const bypassed =
    route.bypass === true ||
    (entity !== undefined && ctx.schemas[entity]?.bypass === true) ||
    (ctx.requestBypass?.isBypassed(request.method, pathname) ?? false);
  if (!bypassed) return undefined;
  if (!ctx.target) {
    console.warn(
      `[mockingpug] bypass armed for "${request.method} ${pathname}" but no "target" is configured in mock.config.js; serving mock instead`,
    );
    return undefined;
  }
  return forwardToTarget(request, ctx.target, segments);
}

/**
 * Builds `GET`/`POST`/`PUT`/`PATCH`/`DELETE` handlers for a single Next.js
 * App Router catch-all Route Handler (`app/api/[[...mock]]/route.ts`), backed
 * by the shared `matchRoute` + `serveRoute` engine `mockingpug/react`'s MSW
 * handlers use. No MSW dependency: Next Route Handlers run inside the real
 * server, so there's nothing to intercept, only requests to answer directly.
 */
export function createNextHandlers(ctx: QueryContext): NextRouteHandlers {
  const routes = ctx.routes ?? defaultRoutes(Object.keys(ctx.schemas));

  async function dispatch(request: Request, routeCtx: NextRouteContext): Promise<Response> {
    const segments = await resolveSegments(routeCtx);

    // The devtools sub-API (`/__mockingpug/*`) is not a data route: handle it
    // first and never log it into the request ring buffer.
    if (segments[0] === DEVTOOLS_SEGMENT) {
      try {
        return await handleDevtoolsRequest(segments.slice(1), request.method, request, ctx);
      } catch (error) {
        return errorResponse(error);
      }
    }

    // Segments are relative to the catch-all mount, so match against them with
    // no base to strip — mount-point agnostic (works under `/api`, `/v1`, …).
    const pathname = '/' + segments.join('/');
    const match = matchRoute(request.method, pathname, routes, '');
    if (!match) return notFound(new URL(request.url).pathname);

    const startedAt = Date.now();
    const forwarded = await maybeForward(ctx, request, segments, match.route);
    if (forwarded) {
      recordRequest(ctx, request, forwarded.status, startedAt);
      return forwarded;
    }
    return serveRoute(match, request, ctx);
  }

  return { GET: dispatch, POST: dispatch, PUT: dispatch, PATCH: dispatch, DELETE: dispatch };
}
