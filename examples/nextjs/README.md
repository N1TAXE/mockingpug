# mockingpug + Next.js example

A real Next.js App Router app (Turbopack) with `mockingpug/next` fully wired
up — a catch-all Route Handler (`app/api/[[...mock]]/route.ts`), not a
browser-only interception like the React/MSW examples: `/api/**` is a real
server endpoint here, verifiable with `curl` as well as the browser.

Demonstrates the same functionality as the React examples: paginated list,
custom dictionary (`role`), bare relation (`user.posts`), field-level
relation (`blogpost.author`), GET by id, POST, DELETE — plus
`<MockDevtools>` (`mockingpug/next/client`), wired up dev-only in
[`app/layout.tsx`](app/layout.tsx). Open the floating panel to edit
`runtime.delay`/`errorRate` live, browse/edit generated records, and watch
the "Requests" log.

## Run it

From the **repo root** first (this example depends on a local, unpublished
build of `mockingpug`, not the npm registry):

```bash
npm install
npm run build
npm pack        # regenerates mockingpug-1.3.0.tgz, gitignored on purpose
```

Then, in this directory:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, or hit the API directly:

```bash
curl "http://localhost:3000/api/user?page=1&limit=3"
curl http://localhost:3000/api/user/1
curl -X POST http://localhost:3000/api/user -H "Content-Type: application/json" -d '{"name":"Ada"}'
```

## What to look at

- [`app/api/[[...mock]]/route.ts`](<app/api/[[...mock]]/route.ts>) — the
  entire integration: `getMockContext()` loads schemas + generates data on
  first request, `createNextHandlers()` builds `GET`/`POST`/`PUT`/`PATCH`/`DELETE`.
- [`mock/api/user/schema.json`](mock/api/user/schema.json), [`mock/api/blogpost/schema.json`](mock/api/blogpost/schema.json),
  [`mock/data/role.json`](mock/data/role.json) — the schemas. Editing them
  while `next dev` is running auto-invalidates the cached context (no
  restart needed — see `next/README.md`'s "Live schema reloading").
- [`next.config.ts`](next.config.ts) — pins `turbopack.root` since this
  example is nested inside the mockingpug monorepo (two `package-lock.json`
  files would otherwise make Turbopack guess the workspace root).
- [`app/page.tsx`](app/page.tsx) — client-side demo UI hitting the same
  `/api/user` endpoint the Route Handler serves.
- [`app/layout.tsx`](app/layout.tsx) — `<MockDevtools>`, gated behind
  `process.env.NODE_ENV === "development"`.

## Switching mock ↔ real API

Not wired up in this example (it's a pure demo), but the recipe is Next's
own `rewrites()` — see `src/next/README.md`'s "Switching mock ↔ real API"
section in the main repo for the full pattern.
