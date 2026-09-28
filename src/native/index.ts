// mockingpug/native — React Native / Expo entry point (R20). No DOM: it reuses
// the exact same `createMockHandlers` the browser transport uses, but runs them
// through MSW's React Native server (`msw/native`) instead of a Service Worker.
// `<MockDevtools>` (DOM markup, `window.open`) is deliberately NOT re-exported
// here, so nothing web-only ends up in a Metro bundle.
//
// Runtime setup on the app side (per MSW's RN guide): install the polyfills
// `react-native-url-polyfill` and `fast-text-encoding`, import them once at the
// top of your entry file, then call `setupNativeMocks(ctx)`.
import { setupServer } from 'msw/native';
import { createMockHandlers } from '../react/handlers.js';
import type { QueryContext } from '../query/index.js';

export { createMockHandlers } from '../react/handlers.js';
export { bypass, unbypass, resetBypassState } from '../react/bypassState.js';
export { MemoryStoreAdapter } from '../store/memoryAdapter.js';
export { generateAll, type SchemaBundle } from '../generator/index.js';
export type { QueryContext } from '../query/index.js';

/**
 * Starts MSW's React Native request interception with mockingpug's handlers.
 * Call once at app startup (dev builds only). Returns the MSW server so you can
 * `server.close()` on teardown or arm one-shot overrides in tests.
 */
export function setupNativeMocks(ctx: QueryContext, baseUrl = '/api'): ReturnType<typeof setupServer> {
  const server = setupServer(...createMockHandlers(ctx, baseUrl));
  // `bypass`: a request no route handles reaches the real network, matching the
  // browser transport's passthrough behavior.
  server.listen({ onUnhandledRequest: 'bypass' });
  return server;
}
