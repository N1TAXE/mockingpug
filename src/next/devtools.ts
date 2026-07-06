import { generateAll } from '../generator/index.js';
import { jsonResponse, readJsonBody, updateRecord, type OneShotOverrideEntry, type QueryContext } from '../query/index.js';
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

/**
 * Server-side counterpart to `mockingpug/react`'s `useMockContext()` for the
 * Next.js transport, where there's no client-side store to read directly.
 * This is what `<MockDevtools>` from `mockingpug/next` talks to over
 * `fetch()`. Unlike the React/MSW devtools, there's no "mock network"
 * toggle or per-entity bypass here: a Route Handler *is* the real server,
 * so there's nothing to intercept (see `next/README.md`).
 *
 * `ctx.runtime` is mutated in place (not replaced) so the change is visible
 * to every subsequent request handled by this same process, the same object
 * reference `createNextHandlers` reads `runtime`/`errorRate` from.
 */
export async function handleDevtoolsRequest(
  segments: string[],
  method: string,
  request: Request,
  ctx: QueryContext,
): Promise<Response> {
  const [action, entity, id] = segments;

  if (!action && method === 'GET') {
    return jsonResponse({ entities: await entityCounts(ctx), runtime: runtimeSnapshot(ctx) });
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

  return jsonResponse({ error: { message: 'not found' } }, { status: 404 });
}
