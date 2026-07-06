/**
 * Shared by both `liveToggle.ts` (server-side middleware, imports
 * `next/server`) and `liveToggleClient.ts` (browser-side cookie setter) so
 * neither needs to import the other and drag its dependencies (Node-touching
 * or otherwise) across the server/client bundle split `next/README.md`
 * documents for this transport.
 */
export const DEFAULT_LIVE_TOGGLE_COOKIE = 'mockingpug-live';

/** The one cookie value that means "proxy to the real backend". Anything else (including absent) means "serve the mock". */
export const LIVE_TOGGLE_COOKIE_VALUE = 'real';
