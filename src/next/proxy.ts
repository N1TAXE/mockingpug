import { errorResponse, type QueryContext } from '../query/index.js';
import { createNextHandlers, type NextRouteContext, type NextRouteHandlers } from './handler.js';

export interface CreateProxyHandlerOptions {
  /** Everything `createNextHandlers()` needs to serve mock responses. */
  ctx: QueryContext;
  /** Base URL of the real backend to forward to when not mocking, e.g. `"https://api.example.com"`. No trailing slash. */
  target: string;
  /**
   * Decides whether to serve mock data (`true`) or forward the request to
   * `target` (`false`). Defaults to `process.env.MOCK_MODE === 'mock'`,
   * matching the `rewrites()`/env-guard recipe in `next/README.md`, so a
   * single deployed Route Handler can serve mock data in one environment
   * and proxy to the real backend in another by flipping one env var.
   */
  shouldMock?: (request: Request) => boolean;
}

const HOP_BY_HOP_REQUEST_HEADERS = [
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const;

// Response is re-serialized from a buffered arrayBuffer(), so the original
// content-encoding/content-length would no longer describe the bytes sent.
const HOP_BY_HOP_RESPONSE_HEADERS = [...HOP_BY_HOP_REQUEST_HEADERS, 'content-encoding', 'content-length'] as const;

function withoutHeaders(headers: Headers, drop: readonly string[]): Headers {
  const filtered = new Headers(headers);
  for (const key of drop) filtered.delete(key);
  return filtered;
}

async function resolveSegments(routeCtx: NextRouteContext): Promise<string[]> {
  const resolved = await routeCtx.params;
  return resolved.mock ?? [];
}

// The Fetch spec forbids passing a body (even an empty one) alongside these
// statuses: the `Response` constructor throws "Invalid response status code"
// otherwise, since 204/205/304 are defined as always having a null body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

async function forwardToTarget(request: Request, target: string, segments: string[]): Promise<Response> {
  const { search } = new URL(request.url);
  const targetUrl = `${target}/${segments.join('/')}${search}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: withoutHeaders(request.headers, HOP_BY_HOP_REQUEST_HEADERS),
      body: hasBody ? await request.arrayBuffer() : undefined,
    });
    const responseBody = NULL_BODY_STATUSES.has(upstream.status) ? null : await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: withoutHeaders(upstream.headers, HOP_BY_HOP_RESPONSE_HEADERS),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Wraps `createNextHandlers()` (the default recipe, `next/README.md`) with
 * an opt-in convenience proxy: for any request where `shouldMock()` returns
 * `false`, the method/query/body is forwarded to `target` and the response
 * returned as-is, instead of being answered by the mock. Not enabled unless
 * you call this instead of `createNextHandlers()` directly.
 *
 * This is a convenience, not a transparent replacement for a real API
 * gateway: it adds an extra hop through the Next.js server, buffers the
 * whole request/response body (no streaming), and does not attempt anything
 * beyond a plain method/header/body pass-through — verify cookies,
 * authorization headers, and large payloads behave as expected against your
 * specific backend before relying on this in production.
 */
export function createProxyHandler(options: CreateProxyHandlerOptions): NextRouteHandlers {
  const { ctx, target, shouldMock = () => process.env.MOCK_MODE === 'mock' } = options;
  const mockHandlers = createNextHandlers(ctx);

  function wrap(method: keyof NextRouteHandlers): NextRouteHandlers[typeof method] {
    return async (request: Request, routeCtx: NextRouteContext) => {
      if (shouldMock(request)) return mockHandlers[method](request, routeCtx);
      const segments = await resolveSegments(routeCtx);
      return forwardToTarget(request, target, segments);
    };
  }

  return {
    GET: wrap('GET'),
    POST: wrap('POST'),
    PUT: wrap('PUT'),
    PATCH: wrap('PATCH'),
    DELETE: wrap('DELETE'),
  };
}
