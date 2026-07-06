import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LIVE_TOGGLE_COOKIE, LIVE_TOGGLE_COOKIE_VALUE } from './liveToggleConstants.js';

export { DEFAULT_LIVE_TOGGLE_COOKIE };

export interface CreateLiveToggleMiddlewareOptions {
  /** Base path the mock Route Handler is mounted at, e.g. `"/api"`. Requests outside this path pass through untouched. Defaults to `"/api"`. */
  baseUrl?: string;
  /** Base URL of the real backend to rewrite matching requests to, e.g. `"https://api.example.com"`. No trailing slash. */
  target: string;
  /** Cookie name read to decide mock vs. real. Defaults to `"mockingpug-live"`. */
  cookieName?: string;
}

/**
 * Builds a `middleware.ts` function implementing the cookie-based live
 * toggle recipe from `next/README.md`: per-request (not per-build) rewrite
 * of the mock's base path to a real backend, driven by a cookie your app
 * sets from wherever its "use real network" control lives (see
 * `setLiveToggleCookie()` from `mockingpug/next/client`).
 *
 * ```ts
 * // middleware.ts
 * import { createLiveToggleMiddleware } from 'mockingpug/next';
 *
 * export const middleware = createLiveToggleMiddleware({ target: process.env.REAL_API_URL! });
 * export const config = { matcher: '/api/:path*' };
 * ```
 *
 * `config.matcher` is still your responsibility (Next.js middleware always
 * needs one to avoid running on every request, including static assets).
 * This deliberately runs in `middleware.ts`, not the Route Handler itself:
 * a rewrite has to happen before the Route Handler's own routing decides
 * anything, and middleware is the one place in the Next.js request
 * lifecycle where that's possible.
 */
export function createLiveToggleMiddleware(
  options: CreateLiveToggleMiddlewareOptions,
): (request: NextRequest) => NextResponse {
  const { baseUrl = '/api', target, cookieName = DEFAULT_LIVE_TOGGLE_COOKIE } = options;

  return (request: NextRequest): NextResponse => {
    const { pathname, search } = request.nextUrl;
    const isLive = request.cookies.get(cookieName)?.value === LIVE_TOGGLE_COOKIE_VALUE;
    if (!isLive || !pathname.startsWith(baseUrl)) {
      return NextResponse.next();
    }
    return NextResponse.rewrite(new URL(`${target}${pathname.slice(baseUrl.length)}${search}`));
  };
}
