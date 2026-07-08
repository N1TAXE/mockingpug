import { generateAll } from '../generator/index.js';
import { generateOpenApiSpec } from '../openapi-gen/generate.js';
import { renderDocsHtml } from '../openapi-gen/renderHtml.js';
import {
  exportSnapshot,
  htmlResponse,
  importSnapshot,
  jsonResponse,
  readJsonBody,
  updateRecord,
  type OneShotOverrideEntry,
  type QueryContext,
  type StoreSnapshot,
} from '../query/index.js';
import { DEVTOOLS_SEGMENT } from './devtoolsPath.js';

export { DEVTOOLS_SEGMENT };

async function entityCounts(ctx: QueryContext): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entity of Object.keys(ctx.schemas)) {
    const stored = await ctx.store.load(entity);
    counts[entity] = stored?.records.length ?? 0;
  }
  return counts;
}

function runtimeSnapshot(ctx: QueryContext): { delay: number; errorRate: number } {
  return { delay: ctx.runtime?.delay ?? 0, errorRate: ctx.runtime?.errorRate ?? 0 };
}

/** `docs.enabled` defaults to `true` when `ctx.docs` is unset, matching `mock.config.js`'s own default. */
function docsEnabled(ctx: QueryContext): boolean {
  return ctx.docs?.enabled ?? true;
}

/**
 * `request.url`'s path minus the trailing `/__mockingpug/docs` this route is
 * always reached at — self-describing from the actual request rather than
 * needing `baseUrl` threaded through `handleDevtoolsRequest()`'s signature
 * (which `createNextHandlers()` doesn't otherwise need to know: Next's own
 * file-based routing decides where the catch-all route is mounted, not a
 * config value).
 */
function baseUrlFromRequest(request: Request): string {
  const { pathname } = new URL(request.url);
  return pathname.slice(0, -`/${DEVTOOLS_SEGMENT}/docs`.length) || '/';
}

/**
 * Server-side counterpart to `mockingpug/react`'s `useMockContext()` for the
 * Next.js transport, where there's no client-side store to read directly.
 * This is what `<MockDevtools>` from `mockingpug/next` talks to over
 * `fetch()`. Unlike the React/MSW devtools, there's no "mock network"
 * toggle here: a Route Handler *is* the real server, so there's nothing to
 * intercept at that level (see `next/README.md`). Per-request bypass is the
 * one exception — it works here too, but by forwarding to `mock.config.js`'s
 * `target` (see `bypassedResponse()` in `handler.ts`) rather than MSW's
 * `passthrough()`, and only when `target` is actually configured.
 *
 * `ctx.runtime` is mutated in place (not replaced) so the change is visible
 * to every subsequent request handled by this same process, the same object
 * reference `createNextHandlers` reads `runtime`/`errorRate` from.
 *
 * Invariant, covered by a regression test (`tests/next/devtools.test.ts`):
 * this function never calls `simulateRuntime`/`simulateRuntimeForEntity`,
 * so no devtools sub-route is ever subject to `runtime.errorRate`/`delay`,
 * regardless of how it's configured — the panel itself can't be locked out
 * by a synthetic error/delay it's the one meant to control. Don't add a
 * runtime-simulation call to this function or anything it calls.
 */
export async function handleDevtoolsRequest(
  segments: string[],
  method: string,
  request: Request,
  ctx: QueryContext,
): Promise<Response> {
  const [action, entity, id] = segments;

  if (!action && method === 'GET') {
    return jsonResponse({
      entities: await entityCounts(ctx),
      runtime: runtimeSnapshot(ctx),
      docsEnabled: docsEnabled(ctx),
      requestBypassAvailable: Boolean(ctx.target),
    });
  }

  if (action === 'runtime' && method === 'POST') {
    const body = (await readJsonBody(request)) as { delay?: number; errorRate?: number };
    if (ctx.runtime) {
      if (typeof body.delay === 'number') ctx.runtime.delay = Math.max(0, body.delay);
      if (typeof body.errorRate === 'number') ctx.runtime.errorRate = Math.min(1, Math.max(0, body.errorRate));
    }
    return jsonResponse(runtimeSnapshot(ctx));
  }

  if (action === 'records' && entity && !id && method === 'GET') {
    const stored = await ctx.store.load(entity);
    return jsonResponse({ records: stored?.records.slice(0, 10) ?? [] });
  }

  // Applies an edit made in a DataWindow's JSON viewer. Deliberately its own
  // devtools route, not a call to the entity's real PUT/PATCH endpoint: this
  // bypasses runtime.errorRate/delay, since it's a devtools-internal action,
  // not a request the app under test is making.
  if (action === 'records' && entity && id && method === 'PUT') {
    const body = await readJsonBody(request);
    const updated = await updateRecord(entity, id, body, ctx);
    return jsonResponse({ record: updated });
  }

  if (action === 'reset' && entity && method === 'POST') {
    await ctx.store.deleteEntity(entity);
    await generateAll(ctx.schemas, ctx.store, { seed: ctx.seed, customDictionaries: ctx.customDictionaries });
    const stored = await ctx.store.load(entity);
    return jsonResponse({ records: stored?.records.slice(0, 10) ?? [] });
  }

  if (action === 'requests' && !entity && method === 'GET') {
    return jsonResponse({ requests: ctx.requestLog?.list() ?? [] });
  }

  if (action === 'requests' && entity === 'clear' && method === 'POST') {
    ctx.requestLog?.clear();
    return jsonResponse({ requests: [] });
  }

  // Arms a one-shot fail/delay override for `entity`'s very next request
  // (see `src/query/oneShotOverride.ts`); reading it back doesn't consume it,
  // only an actual request through `simulateRuntimeForEntity()` does.
  if (action === 'override' && entity && method === 'GET') {
    return jsonResponse({ override: ctx.oneShotOverrides?.peek(entity) ?? {} });
  }

  if (action === 'override' && entity && method === 'POST') {
    const body = (await readJsonBody(request)) as OneShotOverrideEntry;
    ctx.oneShotOverrides?.set(entity, body);
    return jsonResponse({ override: ctx.oneShotOverrides?.peek(entity) ?? {} });
  }

  // Per-request bypass: which exact "METHOD pathname" combinations currently
  // forward to `target` instead of being answered by the mock (a list route
  // and an item route bypass independently — see `requestBypass.ts`). GET
  // reflects current state (e.g. when the "Requests" view opens); POST
  // arms/disarms one "METHOD pathname" key.
  if (action === 'requestBypass' && !entity && method === 'GET') {
    return jsonResponse({ keys: ctx.requestBypass?.list() ?? [] });
  }

  if (action === 'requestBypass' && !entity && method === 'POST') {
    const body = (await readJsonBody(request)) as { method?: string; pathname?: string; bypassed?: boolean };
    if (body.method && body.pathname) {
      ctx.requestBypass?.set(body.method, body.pathname, body.bypassed === true);
    }
    return jsonResponse({
      bypassed: body.method && body.pathname ? (ctx.requestBypass?.isBypassed(body.method, body.pathname) ?? false) : false,
    });
  }

  // Export/import the entire store as one JSON snapshot, for sharing an
  // exact reproduction of a bug's data instead of describing it in words
  // (see `<MockDevtools>`'s "Export"/"Import" buttons).
  if (action === 'snapshot' && !entity && method === 'GET') {
    return jsonResponse({ snapshot: await exportSnapshot(ctx) });
  }

  if (action === 'snapshot' && !entity && method === 'POST') {
    const body = (await readJsonBody(request)) as StoreSnapshot;
    await importSnapshot(ctx, body);
    return jsonResponse({ entities: await entityCounts(ctx) });
  }

  // Live-rendered API reference for `<MockDevtools>`'s "API Docs" button —
  // the same generator/renderer `mpug docs` uses, just run against the
  // already-loaded `ctx` instead of writing files, so it's always current
  // with whatever schema the running process has. Absent entirely (falls
  // through to the 404 below) when `docs.enabled: false`, same as the CLI
  // command skipping its own output.
  if (action === 'docs' && !entity && method === 'GET' && docsEnabled(ctx)) {
    const spec = generateOpenApiSpec(
      ctx.schemas,
      { baseUrl: baseUrlFromRequest(request), pagination: ctx.pagination },
      ctx.customDictionaries,
    );
    return htmlResponse(renderDocsHtml(spec));
  }

  return jsonResponse({ error: { message: 'not found' } }, { status: 404 });
}
