# mockingpug + React

Quick start for mocking a REST API in a React SPA (Vite, CRA, or any bundler)
via [MSW](https://mswjs.io). No separate server process, no changes to your
HTTP client code.

## 1. Install

```bash
npm install mockingpug msw
npx msw init public/ --save
```

`msw` is a peer dependency, not bundled with `mockingpug`. Install it
alongside so your project controls its version (and so there's only ever
one copy of it, avoiding duplicate-type errors if you ever `npm link`/`file:`
install `mockingpug` locally instead of from the registry).

The `npx msw init` command is MSW's own setup step: it drops
`mockServiceWorker.js` into your `public/` directory (or wherever your
bundler serves static assets from). This file is what actually intercepts
network requests in the browser; `mockingpug` doesn't replace it, it
generates the *handlers* that run inside it.

## 2. Describe your data

Same `mock/` convention used by the CLI and `mockingpug/next`: one JSON
schema per entity, custom dictionaries alongside:

```json
// mock/api/user/schema.json
{
  "amount": 1000,
  "data": {
    "id": "number.increment",
    "name": "username.FS",
    "email": "email[gmail.com]",
    "role": "role",
    "posts": "data.blogpost"
  }
}
```

```json
// mock/data/role.json
[
  { "value": "ADMIN", "max": 5 },
  { "value": "USER", "chance": 0.9 }
]
```

Run `npx mpug doctor` any time to validate these. It catches typos in
generator types, broken `data.*` references, and cross-entity cycles before
you've wired anything into your app (same validator the CLI and
`mockingpug/next` both use).

## 3. Load the schemas into your app

Unlike `mockingpug/next` (which runs in Node and can read `mock/` off disk
directly), there is no filesystem inside a browser bundle. Schemas have to
get there at *build time* instead.

### Option A: Vite plugin (recommended if you're on Vite)

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { mockingpug } from 'mockingpug/vite';

export default defineConfig({
  plugins: [mockingpug()],
});
```

```ts
// src/mocks/schemas.ts
import { schemas, customDictionaries } from 'virtual:mockingpug/schemas';
export { schemas, customDictionaries };
```

The plugin scans `mock/api/**`/`mock/data/**` at build/dev time (the same
`cli/schemaLoader.ts` the CLI uses; it's Node-side, plenty of filesystem
access there) and exposes the already-parsed result as a virtual module,
with no per-entity import list to maintain. It also watches `mock/` and
`mock.config.js` while `vite dev` is running: editing a schema triggers a
full reload instead of a stale cache.

### Option B: manual static import (any bundler, no plugin needed)

```ts
// src/mocks/schemas.ts
import { parseEntitySchema } from 'mockingpug';
import userRaw from '../../mock/api/user/schema.json';
import blogpostRaw from '../../mock/api/blogpost/schema.json';
import roleDictionary from '../../mock/data/role.json';

export const schemas = {
  user: parseEntitySchema('user', 'mock/api/user/schema.json', userRaw, ['role']),
  blogpost: parseEntitySchema('blogpost', 'mock/api/blogpost/schema.json', blogpostRaw),
};

export const customDictionaries = { role: roleDictionary };
```

Use this if you're not on Vite (CRA, plain webpack, etc.): one import per
entity file, parsed with the same function the plugin uses internally.

#### CRA / webpack gotcha: keep `mock/` inside `src/`

Create React App (and any un-ejected `react-scripts` project) refuses to
bundle imports that reach outside `src/`. You'll get `Module not found:
... falls outside of the project src/ directory. Relative imports outside
of src/ are not supported.` if `mock/` sits at the project root like it
does for the CLI/Next.js convention.

Fix: put the schema files under `src/mock/` instead (e.g. `src/mock/api/user/schema.json`),
adjust the imports in `schemas.ts` to `../mock/api/...`, and point
`mock.config.js` at the same folder so `npx mpug doctor` and this
runtime import stay in sync:

```js
// mock.config.js
module.exports = {
  dir: 'src/mock', // not 'mock', see the CRA note above
  seed: 'my-app',
};
```

Plain webpack configs without CRA's restriction can keep `mock/` at the
root as usual; this only applies to `react-scripts`.

## 4. Generate data and start the worker

```ts
// src/mocks/browser.ts
import { setupWorker } from 'msw/browser';
import { MemoryStoreAdapter, generateAll, createMockHandlers } from 'mockingpug/react';
import { schemas, customDictionaries } from './schemas'; // from option A or B above

export async function startMocking() {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'my-app', customDictionaries });

  const ctx = {
    schemas,
    store,
    seed: 'my-app',
    customDictionaries,
    pagination: {
      strategy: 'page' as const,
      params: { page: 'page', limit: 'limit', offset: 'offset', cursor: 'cursor', groupBy: 'groupBy', limitPerGroup: 'limitPerGroup' },
      defaultLimit: 20,
      maxLimit: 100,
      envelope: true,
    },
  };

  const worker = setupWorker(...createMockHandlers(ctx, '/api'));
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

```tsx
// src/main.tsx (Vite)
async function bootstrap() {
  if (import.meta.env.DEV) {
    const { startMocking } = await import('./mocks/browser');
    await startMocking();
  }
  const { createRoot } = await import('react-dom/client');
  createRoot(document.getElementById('root')!).render(<App />);
}
bootstrap();
```

```jsx
// src/index.js (CRA / webpack: no import.meta, use process.env instead)
import ReactDOM from 'react-dom/client';
import App from './App';

function render() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
}

if (process.env.NODE_ENV !== 'production') {
  import('./mocks/browser').then(({ startMocking }) => startMocking().then(render));
} else {
  render();
}
```

The dev-only guard (`import.meta.env.DEV` on Vite, `process.env.NODE_ENV` on
webpack/CRA) plus the dynamic `import()` is what keeps `mockingpug/react`,
MSW, and your mock data generators out of a production bundle.
`mockingpug` doesn't do this for you automatically, your bundler's dead-code
elimination does, as long as the call site is gated like this. `import.meta`
is Vite-specific syntax and will fail to parse under CRA's webpack config,
so don't copy the Vite snippet verbatim into a CRA project.

Add `runtime: { delay: 300, errorRate: 0.1 }` to `ctx` above to exercise
your app's loading/error states against synthetic latency/failures. Both
default to `0` (disabled) if omitted. `<MockDevtools>` (§5) lets you edit
these live without a restart.

`MemoryStoreAdapter` is the right choice for a SPA: it's a plain in-process
`Map`, gone on reload, with no filesystem dependency. If you want mutations
(`POST`/`PUT`/`DELETE` made while testing) to survive a page reload, you'd
need to plug in your own `IndexedDB`-backed adapter (implementing the same
`StoreAdapter` interface), which isn't shipped today.

## 5. `<MockProvider>` + `<MockDevtools>` (optional)

If you'd rather not hand-write the `setupWorker()`/`worker.start()`
boilerplate above, `<MockProvider>` wraps it in a component and exposes a
small context (`useMockContext()`) that a floating `<MockDevtools>` panel
reads/writes: mock/off toggle, live `runtime.delay`/`runtime.errorRate`
editing, a per-entity record viewer (editable — the pencil icon turns the
JSON view into a textarea, saved edits go through the same merge
`PUT`/`PATCH` already uses; each record also has its own "Copy as curl"
button, copying a ready-to-run `curl -X GET '...'` for that exact record's
URL) with a reset button, per-entity bypass
checkboxes, a "Fail next request"/"Delay next" one-shot override per entity
(arms a single fail-or-delay for that entity's very next request, then
disarms itself, so you can test one error/loading state on demand without
touching `runtime.errorRate`/`delay` globally), "Export"/"Import" buttons
in the "Mock Data" list (download the whole store as one JSON file, or
restore it from one — handy for sharing an exact repro of a bug), a text
filter and windowed rendering on that same list (so dozens/hundreds of
entities stay responsive to filter and scroll), a "Requests" view
listing the last 50 requests the mock actually answered
(method, path, status, duration, time) so you don't have to switch to the
Network tab to
see whether a `fetch()` reached the mock — each distinct request (deduped
by `METHOD` + path, ignoring the query string) also gets its own "Use real
data" switch there, unlike the per-entity bypass checkboxes below this
bypasses just that exact request (list `GET`, item `GET`, `POST`, `PUT`,
`PATCH`, or `DELETE`) via MSW's `passthrough()`, useful when the real
backend only diverges from the mock's shape for one specific endpoint —
and an "API Docs" row that opens
a generated OpenAPI-based HTML reference of the whole REST surface in a
new tab — built entirely client-side from `ctx.schemas`, no server needed.
Hidden when `mock.config.js`'s `docs.enabled` is `false` (defaults `true`):

```tsx
// src/mocks/browser.tsx
import { setupWorker } from 'msw/browser';
import { MemoryStoreAdapter, generateAll, createMockHandlers, MockProvider, MockDevtools } from 'mockingpug/react';
import { schemas, customDictionaries } from './schemas';

export async function createMockingpug() {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'my-app', customDictionaries });
  const ctx = { schemas, store, seed: 'my-app', customDictionaries, pagination: { /* ...same as step 4 */ } };
  const worker = setupWorker(...createMockHandlers(ctx, '/api'));
  // Started here, not left to <MockProvider> alone: <App> below is a child
  // of <MockProvider>, and child effects commit *before* the parent's on
  // mount — if nothing awaited worker.start() first, an <App> that fetches
  // on mount would race ahead of the worker actually intercepting anything
  // and hit the real (likely nonexistent, in dev) network instead.
  // <MockProvider> starting an already-started worker again once it mounts
  // is a harmless no-op (MSW logs a "redundant call" warning, doesn't throw).
  await worker.start({ onUnhandledRequest: 'bypass' });
  return { ctx, worker };
}
```

```tsx
// App.tsx (or wherever you mount the dev-only provider)
const { ctx, worker } = await createMockingpug();

<MockProvider worker={worker} ctx={ctx}>
  <App />
  <MockDevtools />
</MockProvider>
```

`<MockDevtools>` also takes an optional `baseUrl` prop (defaults to `/api`,
matching `createMockHandlers(ctx, baseUrl)`'s own default) — it's only
used to build the URL for the "Copy as curl" button, pass it explicitly if
you called `createMockHandlers` with a different one.

`<MockProvider>` owns the worker's start/stop lifecycle from here on (mode
persisted to `localStorage` across reloads, StrictMode-safe) and mutates
`ctx.runtime` in place when devtools users edit delay/errorRate: no
restart needed, the change takes effect on the very next request. Both
components are gated behind the same dev-only dynamic `import()` as
`startMocking()` itself. Never import them at the top level of a file that
ships to production.

## Switching mock ↔ real API

Nothing to configure for the all-or-nothing case: MSW intercepts `fetch`/`XHR`
*below* your HTTP client, so as long as `startMocking()` is never called,
requests go straight to whatever real backend your app already points at,
the same behavior it would have without `mockingpug` in the picture at all.

For a **per-entity** bypass (mock everything except one endpoint whose real
backend is already ready), two equivalent options:

```json
// mock/api/user/schema.json: schema-level, static
{ "amount": 1000, "bypass": true, "data": { "...": "..." } }
```

```ts
// runtime, e.g. from a devtools toggle or a debug console
import { bypass, unbypass } from 'mockingpug/react';
bypass('user');   // this entity's requests now hit the real network (MSW passthrough())
unbypass('user'); // back to mocked
```

Either one is enough: a bypassed entity's MSW handlers call `passthrough()`
instead of answering with generated data. `<MockDevtools>` exposes the
runtime half as a checkbox per entity.

## Logs and errors

Everything mockingpug logs is prefixed `[mockingpug]`. A schema problem
(bad generator type, missing custom dictionary, cross-entity cycle) throws
during `generateAll()` with a stable error code (e.g. `MP-SCHEMA-001`) and a
location pointing at the offending file/field. Run `npx mpug doctor`
to see the same errors without having to boot your app first. Unexpected
failures at request time never leak internals to the response body; they
show up as a generic `500` with the full detail only in your browser's
devtools console (`console.error('[mockingpug] unexpected internal error...')`).
