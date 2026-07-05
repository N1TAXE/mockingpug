import type { RuntimeConfig } from '../cli/mockConfig.js';

export const DEFAULT_RUNTIME: RuntimeConfig = { errorRate: 0, delay: 0 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
