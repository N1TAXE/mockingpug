// mockingpug/vue — Vue (and any non-React browser SPA) entry point. Same
// `createMockHandlers` the React transport uses, started through MSW's browser
// Service Worker directly, without React's `<MockProvider>`/`<MockDevtools>`
// (those are React components and pull in React). Framework-neutral: works in
// Vue, Svelte, Solid, or vanilla — anywhere with a browser Service Worker.
import { setupWorker, type StartOptions } from 'msw/browser';
import { createMockHandlers } from '../react/handlers.js';
import type { QueryContext } from '../query/index.js';

export { createMockHandlers } from '../react/handlers.js';
export { bypass, unbypass, resetBypassState } from '../react/bypassState.js';
export { MemoryStoreAdapter } from '../store/memoryAdapter.js';
export { generateAll, type SchemaBundle } from '../generator/index.js';
export type { QueryContext } from '../query/index.js';

/**
 * Starts MSW's browser worker with mockingpug's handlers. Call once at app
 * startup (dev only), after `npx msw init public/` has placed the worker script.
 * Returns the worker so you can `worker.stop()` on teardown. A request no route
 * handles passes through to the real network.
 */
export async function setupMockWorker(ctx: QueryContext, baseUrl = '/api', options?: StartOptions): Promise<ReturnType<typeof setupWorker>> {
  const worker = setupWorker(...createMockHandlers(ctx, baseUrl));
  await worker.start({ onUnhandledRequest: 'bypass', ...options });
  return worker;
}
