import type { RuntimeConfig } from '../cli/mockConfig.js';
import { hasArmedOverride } from './oneShotOverride.js';
import type { QueryContext } from './resolver.js';

export const DEFAULT_RUNTIME: RuntimeConfig = { errorRate: 0, delay: 0 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BYPASS_QUERY_PARAM = 'mpug-bypass';
const BYPASS_HEADER = 'x-mockingpug-bypass';

/**
 * True when a request opts out of `runtime.errorRate`/`delay` (and any
 * armed one-shot override) for itself, via `?mpug-bypass=1` or an
 * `X-Mockingpug-Bypass: 1` header — checked by `simulateRuntimeForEntity()`
 * before anything else. For unblocking the *host page itself* when
 * `errorRate: 1` (or an armed "fail next") is making its own `fetch()`
 * calls fail, without editing `mock.config.js` or restarting the dev
 * server. Doesn't touch or consume `<MockDevtools>`'s one-shot override
 * state — it's a one-off escape hatch on the calling request, not a
 * change to what's armed for the next one.
 */
export function isRuntimeBypassRequested(request: Request): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get(BYPASS_QUERY_PARAM) === '1') return true;
  return request.headers.get(BYPASS_HEADER) === '1';
}

/**
 * Applies `mock.config.js`'s `runtime.delay`/`runtime.errorRate`
 * to a single request. Called once per handler invocation, before any real
 * resolver work. A thrown error here is a deliberately *unexpected* failure
 * (not a `RequestError`), so it falls through `errorResponse()`'s generic
 * catch-all and comes back to the client as a plain 500, exercising the
 * same error-handling path a real backend failure would.
 */
export async function simulateRuntime(runtime: RuntimeConfig = DEFAULT_RUNTIME): Promise<void> {
  if (runtime.delay > 0) {
    await sleep(runtime.delay);
  }
  if (runtime.errorRate > 0 && Math.random() < runtime.errorRate) {
    throw new Error(`synthetic error injected by mock.config.js's runtime.errorRate=${runtime.errorRate}`);
  }
}

/**
 * Same as `simulateRuntime()`, but checks `ctx.oneShotOverrides` for `entity`
 * first: if `<MockDevtools>` armed a "fail next"/"delay next" override for
 * this specific entity, it fully replaces the global `runtime.errorRate`/
 * `delay` for this one request (not layered on top of them, so arming a
 * one-shot override gives a deterministic result regardless of what the
 * global settings happen to be), and is consumed so it never fires twice.
 * Falls back to plain `simulateRuntime(ctx.runtime)` when nothing's armed.
 *
 * When `request` is passed and `isRuntimeBypassRequested(request)` is true,
 * returns immediately — before touching `ctx.oneShotOverrides` at all, so a
 * bypassed request neither pays a synthetic delay/error nor consumes an
 * armed one-shot override meant for the next (non-bypassed) request.
 */
export async function simulateRuntimeForEntity(ctx: QueryContext, entity: string, request?: Request): Promise<void> {
  if (request && isRuntimeBypassRequested(request)) return;
  const override = ctx.oneShotOverrides?.consume(entity);
  if (!hasArmedOverride(override)) {
    return simulateRuntime(ctx.runtime);
  }
  if (override!.delayNext !== undefined) {
    await sleep(override!.delayNext);
  }
  if (override!.failNext) {
    throw new Error(`synthetic error injected by <MockDevtools>'s one-shot "fail next" override for entity "${entity}"`);
  }
}
