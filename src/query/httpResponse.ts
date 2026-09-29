import { RequestError } from '../core/index.js';
import type { PaginationMeta } from './pagination.js';

/**
 * Standard Web `Response` helpers shared by every transport adapter
 * (`react`'s MSW handlers, `next`'s Route Handlers, and any future one).
 * Built only on Fetch API primitives (`Response`/`Headers`), so they work
 * identically in a browser, in Node, and inside Next.js's runtime without
 * pulling in a transport-specific dependency.
 */

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** Only used by the live `GET {baseUrl}/__mockingpug/docs` route (`<MockDevtools>`'s "API Docs" button) — every other devtools/entity response is JSON. */
export function htmlResponse(html: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(html, { ...init, headers });
}

/**
 * Turns a caught error into an HTTP response. `RequestError` (expected:
 * bad id, bad body) becomes its own status code with a clean body;
 * anything else is an unexpected internal failure, logged in full
 * server-side, but the client only ever sees a generic 500.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof RequestError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error('[mockingpug] unexpected internal error while handling a mock request:', error);
  return jsonResponse({ error: { source: 'mockingpug', message: 'internal error' } }, { status: 500 });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * Reshapes pagination meta via a `response.meta` template: a `"$<field>"`
 * string becomes that field of the computed meta, everything else passes
 * through literally (so fields can be renamed and static ones added). Returns
 * `meta` unchanged when there's no template or the meta isn't an object.
 */
export function fillMeta(template: unknown, meta: unknown): unknown {
  if (template === undefined || meta === null || typeof meta !== 'object') return meta;
  return substituteMeta(template, meta as Record<string, unknown>);
}

function substituteMeta(node: unknown, meta: Record<string, unknown>): unknown {
  if (typeof node === 'string' && node.length > 1 && node[0] === '$') return meta[node.slice(1)];
  if (Array.isArray(node)) return node.map((n) => substituteMeta(n, meta));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substituteMeta(v, meta)]));
  }
  return node;
}

/** Applies `pagination.envelope`: `true` -> `{ data, meta }` body, `false` -> raw array + `X-*` headers. A `response.meta` template reshapes the body meta (headers stay raw). */
export function buildListResponse(data: unknown[], meta: PaginationMeta | null, envelope: boolean, metaTemplate?: unknown): Response {
  if (!envelope || meta === null) {
    const headers = new Headers();
    if (meta) {
      headers.set('X-Total-Count', String(meta.total));
      if (meta.strategy === 'group') {
        headers.set('X-Limit-Per-Group', String(meta.limitPerGroup));
        headers.set('X-Total-Groups', String(meta.totalGroups));
        headers.set('X-Group-By', meta.groupBy);
      } else {
        headers.set('X-Limit', String(meta.limit));
        if (meta.strategy === 'page') headers.set('X-Page', String(meta.page));
        if (meta.strategy === 'offset') headers.set('X-Offset', String(meta.offset));
        if (meta.strategy === 'cursor' && meta.nextCursor !== null) headers.set('X-Next-Cursor', meta.nextCursor);
      }
    }
    return jsonResponse(data, { headers });
  }
  return jsonResponse({ data, meta: fillMeta(metaTemplate, meta) });
}
