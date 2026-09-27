import { http, passthrough, type RequestHandler } from 'msw';
import { defaultRoutes, expandRoutePaths, matchRoute, routeEntity, type HttpMethod } from '../core/index.js';
import { serveRoute, type QueryContext } from '../query/index.js';
import { isRuntimeBypassed } from './bypassState.js';

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path;
}

const HTTP: Record<HttpMethod, (typeof http)['get']> = {
  GET: http.get,
  POST: http.post,
  PUT: http.put,
  PATCH: http.patch,
  DELETE: http.delete,
};

/**
 * Generates one MSW `RequestHandler` per concrete route path in
 * `ctx.routes` (defaulting to one full-CRUD resource per table). Every
 * handler shares a single resolver that re-runs {@link matchRoute} for
 * correct specificity, applies bypass, and delegates to the framework-
 * agnostic {@link serveRoute} engine `mockingpug/next` uses too. Only
 * registered route shapes are handled — an unknown path stays unhandled, so
 * MSW's `onUnhandledRequest` still fires exactly as before.
 */
export function createMockHandlers(ctx: QueryContext, baseUrl: string): RequestHandler[] {
  const routes = ctx.routes ?? defaultRoutes(Object.keys(ctx.schemas));

  // Bypass lets the real backend answer instead. Three independent triggers:
  // an explicit `route.bypass`, an entity-level bypass (schema `bypass: true`
  // or a runtime `mockingpug.bypass('entity')` call — mutable while the
  // worker runs, so checked per request), and a `<MockDevtools>`-armed
  // per-request toggle keyed to the exact `METHOD pathname`. MSW's
  // `passthrough()` needs no target: the browser's own `fetch()` already has
  // the real absolute URL.
  function shouldBypass(route: (typeof routes)[number], request: Request): boolean {
    if (route.bypass) return true;
    const entity = routeEntity(route);
    if (entity && (ctx.schemas[entity]?.bypass === true || isRuntimeBypassed(entity))) return true;
    const pathname = new URL(request.url).pathname;
    return ctx.requestBypass?.isBypassed(request.method, pathname) ?? false;
  }

  const resolver = async ({ request }: { request: Request }) => {
    const pathname = new URL(request.url).pathname;
    const match = matchRoute(request.method, pathname, routes, baseUrl);
    if (!match || shouldBypass(match.route, request)) return passthrough();
    return serveRoute(match, request, ctx);
  };

  return expandRoutePaths(routes).map(({ method, path }) => HTTP[method](joinUrl(baseUrl, path), resolver));
}
