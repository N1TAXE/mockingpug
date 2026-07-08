# mockingpug + Next.js

Quick start for mocking a REST API in a Next.js App Router project: one
catch-all Route Handler, no separate server process, real filesystem access
so `mock/` is read the same way the CLI reads it.

## 1. Install

```bash
npm install mockingpug
```

No `msw` needed here: a Next.js Route Handler already runs inside a real
server, so there's nothing to intercept, only requests to answer directly.

## 2. Describe your data

Same `mock/` convention as the CLI (and `mockingpug/react`):

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

## 3. `mock.config.js` at your project root

```js
module.exports = {
  dir: 'mock',
  seed: 'my-app',
  baseUrl: '/api',
  persist: { adapter: 'file', strategy: 'always' },
};
```

If you omit this file entirely, sane defaults are used (`dir: 'mock'`,
`baseUrl: '/api'`, file-backed persistence); see `cli/README.md` for the
full option reference, including `limits` (per-entity `amount`/`array` caps,
enforced by `doctor`) and `runtime` (`delay`/`errorRate` synthetic latency
and failures, applied to every request this Route Handler answers, same as
`mockingpug/react`). Editing `mock.config.js` and restarting (or waiting for
the file watcher, see below) changes `runtime` values too, but see
`<MockDevtools>` below for a live toggle without a restart.

Per-entity `bypass` (either the schema-level flag or the runtime
`bypass()`/`unbypass()` calls documented in `react/README.md`) is **React/MSW-specific**
and has no effect here: a Next.js Route Handler *is* the real server
endpoint, there's no upstream request to "pass through" to. Use the
`rewrites()` recipe below instead to route a specific real backend path
around the mock entirely.

## 4. The catch-all Route Handler

```ts
// app/api/[[...mock]]/route.ts
import { createNextHandlers, getMockContext, type NextRouteContext } from 'mockingpug/next';

const handlersPromise = getMockContext(process.cwd()).then(({ ctx }) => createNextHandlers(ctx));

export const GET = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).GET(request, routeCtx);
export const POST = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).POST(request, routeCtx);
export const PUT = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).PUT(request, routeCtx);
export const PATCH = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).PATCH(request, routeCtx);
export const DELETE = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).DELETE(request, routeCtx);
```

`getMockContext()` loads `mock.config.js`, parses every schema (the same
`cli/schemaLoader.ts` the CLI uses), and reconciles/generates the store, so
the very first request already has data, without running `mockingpug
generate` as a separate step. It's memoized per `projectDir` for the life of
the process, so `next dev` doesn't re-scan `mock/` and re-run reconciliation
on every request.

`app/api/[[...mock]]/route.ts` (double brackets, an *optional* catch-all)
means `/api` itself, `/api/user`, and `/api/user/1` all route here;
`routeCtx.params.mock` is `undefined`/`['user']`/`['user', '1']`
respectively. `NextRouteContext`'s `params` type accepts both the pre-15
plain-object shape and 15+'s `Promise`-wrapped one; the same handler code
works either way.

## `<MockDevtools>`

A floating dev-only panel, same idea as `mockingpug/react`'s, adapted for a
server-side transport. It talks to a small devtools sub-API the catch-all
Route Handler already serves under `{baseUrl}/__mockingpug/*`, since there's
no client-side store to read directly here:

```tsx
// somewhere in your root layout, dev-only
import { MockDevtools } from 'mockingpug/next/client';

{process.env.NODE_ENV === 'development' && <MockDevtools />}
```

It's imported from `mockingpug/next/client`, not `mockingpug/next`, because
`<MockDevtools>` is a `'use client'` component, and `mockingpug/next`'s main
entry also carries server-only code (`createNextHandlers`, `getMockContext`,
both touching the filesystem), which can never share a bundle with a client
component under Next.js's App Router rules. You can render it directly from
a Server Component (like `page.tsx`) without wrapping it yourself.

`baseUrl` defaults to `/api`, matching the transport's own default; pass it
explicitly if `mock.config.js` sets a different one. It gives you:

- Live `delay`/`errorRate` editing, applied immediately to the next request
  the Route Handler answers (no restart, unlike editing `mock.config.js`).
- A "Mock Data" list of every entity and its record count, filterable by
  name and windowed (only rows near the current scroll position are
  rendered) so it stays responsive with dozens/hundreds of entities.
  Clicking one opens its stored records in a separate floating window,
  draggable by its header, with its own reset button (wipes and
  regenerates just that entity). Multiple entities' windows can be open at
  once.
- That window's JSON view is editable: the pencil icon turns it into a
  textarea, the checkmark saves. Saved edits go through
  `PUT {baseUrl}/__mockingpug/records/:entity/:id` — the same merge
  `updateRecord()` a real `PUT`/`PATCH` uses, bypassing
  `runtime.errorRate`/`delay` (this is a devtools action on the data, not
  a request your app is making). Only existing records can be edited this
  way (matched by `.id`); adding/removing array entries in the textarea has
  no effect. Each record also has its own "Copy as curl" button (only shown
  when it has a resolvable `.id`), copying a ready-to-run
  `curl -X GET '...'` for that exact record's URL — built client-side from
  `window.location.origin` + `baseUrl` + the id, no extra devtools route.
- A "Requests" view listing the last 50 requests the mock actually
  answered (method, path, status, duration, time), via
  `GET {baseUrl}/__mockingpug/requests`, polled once a second while open.
  `POST {baseUrl}/__mockingpug/requests/clear` empties it. The devtools
  sub-API's own calls are never logged. Each distinct request (deduped by
  `METHOD` + path, ignoring the query string) also gets a "Use real data"
  switch, via `GET`/`POST {baseUrl}/__mockingpug/requestBypass`: forwards
  that exact request — list `GET`, item `GET`, `POST`, `PUT`, `PATCH`, or
  `DELETE` — to `mock.config.js`'s `target` (a real backend base URL)
  instead of answering with the mock. Hidden until `target` is configured
  — see below.
- A "Fail next request"/"Delay next" one-shot override per entity, via
  `GET`/`POST {baseUrl}/__mockingpug/override/:entity`: arms a single
  fail-or-delay for that entity's very next request only, then disarms
  itself, so you can test one error/loading state on demand without
  touching `runtime.errorRate`/`delay` globally.
- "Export"/"Import" buttons in the "Mock Data" list, via
  `GET`/`POST {baseUrl}/__mockingpug/snapshot`: download the whole store
  as one JSON file (`{ entity: { meta, records } }`), or restore it from
  one — handy for sharing an exact repro of a bug instead of describing
  the test data in words. An entity name in the file that doesn't match a
  current schema is silently skipped.
- An "API Docs" row, via `GET {baseUrl}/__mockingpug/docs`: opens a
  generated OpenAPI-based HTML reference of the whole REST surface in a
  new tab, rendered live from the process's current schemas on every
  request (no separate regenerate step). Hidden, and the route itself
  404s, when `mock.config.js`'s `docs.enabled` is `false` (defaults
  `true`) — same flag `mpug docs` checks.

There's no "mock network" toggle or per-entity `bypass` checkbox built
into this panel: both are React/MSW-specific concepts that don't apply to
a Route Handler, which *is* the real server. Use the `rewrites()` recipe
below to route a specific path around the mock entirely at build time, or
Recipe B/C further down for a per-request or cookie-driven alternative.
Per-request bypass (above, in the "Requests" view) is the one exception —
it works here too, by forwarding to `target` rather than MSW's
`passthrough()`:

```js
// mock.config.js
module.exports = {
  target: 'https://api.example.com', // no trailing slash; enables the per-request bypass switch
};
```

If a request is bypassed but `target` is unset when a request actually
hits it, the mock answers instead (with a console warning), rather than
failing the request outright.

## Switching mock ↔ real API

`mockingpug` doesn't try to resolve where your real backend lives; that
stays your app's own configuration (env vars, etc). The standard recipe is
Next's own `rewrites()`, which natively supports an absolute destination:

```js
// next.config.js
module.exports = {
  async rewrites() {
    if (process.env.MOCK_MODE !== 'mock') {
      return [{ source: '/api/:path*', destination: `${process.env.REAL_API_URL}/:path*` }];
    }
    return []; // /api/** stays on the catch-all Route Handler above
  },
};
```

For defense-in-depth (in case `rewrites()` isn't wired up everywhere, or the
route somehow ships in a build where it shouldn't), guard the handlers
themselves:

```ts
export const GET = async (request: Request, routeCtx: NextRouteContext) => {
  if (process.env.MOCK_MODE !== 'mock') {
    return new Response('Not Found', { status: 404 });
  }
  return (await handlersPromise).GET(request, routeCtx);
};
```

`mockingpug` does not exclude this route from your production build for
you; that's your bundler/deploy config's job (e.g. not shipping the file,
or an environment check like above).

## Recipe B: one Route Handler, decided at request time

`rewrites()` above is a build-time decision. `createProxyHandler()` wraps
`createNextHandlers()` with an opt-in forwarding proxy that decides
mock-vs-real **per request** instead, so a single deployed Route Handler
can serve both:

```ts
// app/api/[[...mock]]/route.ts
import { createProxyHandler, getMockContext, type NextRouteContext } from 'mockingpug/next';

const handlersPromise = getMockContext(process.cwd()).then(({ ctx }) =>
  createProxyHandler({ ctx, target: process.env.REAL_API_URL! }),
);

export const GET = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).GET(request, routeCtx);
export const POST = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).POST(request, routeCtx);
export const PUT = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).PUT(request, routeCtx);
export const PATCH = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).PATCH(request, routeCtx);
export const DELETE = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).DELETE(request, routeCtx);
```

`shouldMock(request)` (defaults to `process.env.MOCK_MODE === 'mock'`)
decides per request; `false` forwards method/query/headers (minus
hop-by-hop ones)/body to `target` and returns the response as-is. This is
a **convenience, not a transparent API gateway replacement**: extra hop,
buffered (non-streaming) body, plain pass-through only — verify auth
headers/cookies/large payloads against your specific backend before
relying on it in production.

## Recipe C: cookie-based live toggle, no rebuild

A **runtime, per-request** override on top of either recipe above, useful
for QA poking a prod-like backend from an already-deployed build without
touching env vars or redeploying:

```ts
// middleware.ts
import { createLiveToggleMiddleware } from 'mockingpug/next';

export const middleware = createLiveToggleMiddleware({ target: process.env.REAL_API_URL! });
export const config = { matcher: '/api/:path*' };
```

Runs in `middleware.ts` (not the Route Handler): a rewrite has to happen
before routing decides anything. Reads a `mockingpug-live` cookie by
default; `"real"` on a request under `baseUrl` (defaults to `/api`)
rewrites it to `target`, anything else falls through to the mock
untouched. Flip it client-side:

```tsx
import { setLiveToggleCookie, getLiveToggleCookie } from 'mockingpug/next/client';

<button onClick={() => setLiveToggleCookie(!getLiveToggleCookie())}>
  Toggle real network
</button>
```

Plain first-party cookie, no server round-trip. Not wired into
`<MockDevtools>`'s panel: it needs its own `middleware.ts` to work, so
it's assembled with your own toggle UI, separate from the panel below.

## Recipe D: branch per call site instead of routing through `/api/*`

Recipes A-C all assume your app always calls a single mock base path
(`/api/*`) and something decides mock-vs-real for that path as a whole.
If you already have a real API client and would rather not have *any*
production request pass anywhere near a Route Handler that could serve a
mock, branch in your own data-fetching layer instead, with a build-time
flag deciding which function runs:

```ts
// shared/api.ts
const useMocks = process.env.USE_MOCKS !== 'false' && process.env.NODE_ENV !== 'production';

export async function getUsers() {
  if (useMocks) {
    // reads straight from the mock's own /api/user, or straight from
    // ctx/store if you're calling mockingpug in-process
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/user`);
    return (await res.json()).data;
  }
  return fetchJson('/users'); // your real backend client
}
```

There's no HTTP-level routing decision here at all (no `rewrites()`, no
proxy, no middleware): `useMocks` is a plain constant computed once at
process start from `process.env`, and every call site branches on it
directly. This is the simplest option when your app already has a real
API client per endpoint and you just want to swap in mock data during
development/CI — but it's a per-call-site decision, not a per-request
one, so **the cookie-based toggle from Recipe C, and the `liveToggle`
concept in general, has no effect here**: there's nothing listening for a
cookie, `useMocks` is fixed for the life of the process. Toggle it with
the env var and restart, the same way you'd toggle `MOCK_MODE` in Recipe A.

## Live schema reloading

`getMockContext()` watches your resolved mock dir and `mock.config.js`
(`node:fs`'s recursive `watch()`). Editing a schema while `next dev` is
running invalidates the cached context automatically, so the next request
picks it up without a manual restart. This is best effort: some
platforms/filesystems don't support recursive watching (older Linux
kernels, some network filesystems); if that's the case here, watching is
silently skipped and you're back to restarting the dev server to pick up
changes, nothing crashes either way.

## Known limitations

- **No serverless-specific handling.** Every mutating request
  (`POST`/`PUT`/`PATCH`/`DELETE`) with `persist.adapter: 'file'` writes
  synchronously to `.mockingpug/db`. On a platform without a persistent
  filesystem between invocations (most serverless hosts), those writes
  won't survive the next cold start. Use `persist.adapter: 'memory'` there
  if persistence across requests isn't required, or accept that `'file'`
  behaves like `'fresh'` in practice on such platforms.

## Logs and errors

Everything mockingpug logs is prefixed `[mockingpug]`. Run
`npx mpug doctor` to validate the exact same schemas the Route Handler
loads, without starting `next dev` first, useful in CI (`doctor --strict`
turns warnings like orphaned entities into a hard failure). At request time,
an unexpected internal failure always responds with a generic `500` body
(`{ "error": { "source": "mockingpug", "message": "internal error" } }`).
The full error, including stack trace, only goes to your server-side
console, never to the client.
