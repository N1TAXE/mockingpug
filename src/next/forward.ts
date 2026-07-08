import { errorResponse } from '../query/index.js';

/**
 * Forwards a `Request` to a real backend and buffers the response back into
 * a plain `Response`. Shared by `createProxyHandler()` (the opt-in
 * mock↔real recipe) and `createNextHandlers()`'s per-request bypass (a
 * `<MockDevtools>`-armed `METHOD pathname` forwarding to `mock.config.js`'s
 * `target`) — split into its own module so `handler.ts` can use it without
 * importing `proxy.ts` (which itself imports `createNextHandlers` from
 * `handler.ts`; keeping this here avoids that cycle).
 */

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

// The Fetch spec forbids passing a body (even an empty one) alongside these
// statuses: the `Response` constructor throws "Invalid response status code"
// otherwise, since 204/205/304 are defined as always having a null body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export async function forwardToTarget(request: Request, target: string, segments: readonly string[]): Promise<Response> {
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
