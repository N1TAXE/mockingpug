# mockingpug + CRA example

A real Create React App (`react-scripts`, not ejected) app with
`mockingpug` fully wired up — Option B from
[`react/README.md`](../../src/react/README.md) (manual static import; CRA
has no `mockingpug/vite`-style auto-discovery plugin, and no access to a
custom webpack config without ejecting/craco).

Demonstrates the same functionality as [`examples/react-vite`](../react-vite):
paginated list, custom dictionary (`role`), bare relation (`user.posts`),
field-level relation (`blogpost.author`), GET by id, POST, DELETE — plus
two CRA-specific fixes documented in `react/README.md`'s "CRA / webpack
gotcha":

1. Schemas live under **`src/mock/`**, not `mock/` at the project root — CRA
   refuses to bundle imports that reach outside `src/`.
2. The bootstrap in [`src/index.tsx`](src/index.tsx) gates on
   `process.env.NODE_ENV`, not `import.meta.env.DEV` (Vite-only syntax that
   doesn't parse under CRA's webpack config).

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
npm install --legacy-peer-deps
npm start
```

`--legacy-peer-deps` is needed because `react-scripts@5.0.1` peer-depends on
TypeScript `^3.2.1 || ^4`, while this example pins TypeScript `^5.9` (needed
for `moduleResolution: "bundler"`, in turn needed to resolve `mockingpug`'s
subpath exports — see `tsconfig.json`). CRA doesn't fail at runtime over
this, it's a peer-dependency version mismatch warning only.

Open `http://localhost:3000` — the page fetches real endpoints, MSW's
service worker answers with generated mock data. Check devtools' Network
tab: the requests are genuine `fetch()` calls, only the response is mocked.

## What to look at

- [`tsconfig.json`](tsconfig.json) — `moduleResolution: "bundler"` (CRA's
  default `"node"` can't see package.json `exports` map subpaths like
  `mockingpug/react`).
- [`mock.config.js`](mock.config.js) — `dir: 'src/mock'`, used only by
  `npx mpug doctor` (a Node CLI process, not bundled).
- [`src/mock/api/user/schema.json`](src/mock/api/user/schema.json), [`src/mock/api/blogpost/schema.json`](src/mock/api/blogpost/schema.json),
  [`src/mock/data/role.json`](src/mock/data/role.json) — the schemas.
- [`src/mocks/schemas.ts`](src/mocks/schemas.ts) — one static `import` per
  entity file + `parseEntitySchema()` (Option B, no plugin).
- [`src/mocks/browser.ts`](src/mocks/browser.ts) — `generateAll()` +
  `createMockHandlers()` + `setupWorker()`, identical to the Vite example.
- [`src/index.tsx`](src/index.tsx) — dev-only bootstrap gate on
  `process.env.NODE_ENV`.
