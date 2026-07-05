# mockingpug + Vite example

A real Vite + React + TypeScript app with `mockingpug` fully wired up —
Option A from [`react/README.md`](../../src/react/README.md) (the
`mockingpug/vite` auto-discovery plugin, no per-entity import list).

Demonstrates: paginated list (`GET /api/user`), a custom dictionary
(`role`), a bare/inverse relation (`user.posts` → `blogpost`, resolved at
read time), a field-level relation (`blogpost.author` → `user.id`), `GET
/api/user/:id`, `POST /api/user`, `DELETE /api/user/:id` — all through real
`fetch()` calls intercepted by MSW.

## Run it

From the **repo root** first (this example depends on a local, unpublished
build of `mockingpug`, not the npm registry):

```bash
npm install
npm run build
npm pack        # regenerates mockingpug-0.1.0.tgz, gitignored on purpose
```

Then, in this directory:

```bash
npm install
npm run dev
```

Open the printed `localhost` URL — the page fetches real endpoints, MSW's
service worker answers with generated mock data. Check devtools' Network
tab: the requests are genuine `fetch()` calls, only the response is mocked.

## What to look at

- [`vite.config.ts`](vite.config.ts) — `mockingpug()` plugin registration.
- [`mock/api/user/schema.json`](mock/api/user/schema.json), [`mock/api/blogpost/schema.json`](mock/api/blogpost/schema.json),
  [`mock/data/role.json`](mock/data/role.json) — the schemas (edit these and
  the dev server hot-reloads, no restart needed).
- [`src/mocks/schemas.ts`](src/mocks/schemas.ts) — the whole "load schemas
  into the browser" bridge is 3 lines thanks to the Vite plugin's virtual
  module.
- [`src/mocks/browser.ts`](src/mocks/browser.ts) — `generateAll()` +
  `createMockHandlers()` + `setupWorker()`.
- [`src/main.tsx`](src/main.tsx) — dev-only bootstrap gate
  (`import.meta.env.DEV`) so none of this ships in a production build.
