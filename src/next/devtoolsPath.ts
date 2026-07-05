/**
 * Reserved first path segment that routes a request to the devtools API
 * instead of a real entity, chosen to be unlikely to collide
 * with an actual schema name under `mock/api/**`. Lives in its own file, with
 * no Node-only imports, so `MockDevtools.tsx` (a client component, bundled
 * separately) can use it without pulling `node:fs`-touching code into the
 * browser bundle.
 */
export const DEVTOOLS_SEGMENT = '__mockingpug';
