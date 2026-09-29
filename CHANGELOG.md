# Changelog

All notable changes to this project are documented in this file.

## [2.0.0]

Endpoints are now described separately from data tables ("шов 1"), and the
package can sync a schema with MockingPug Cloud. **Breaking:** the `mock/`
layout and config change — run `npx mpug migrate` to convert an existing
project.

### Breaking

- **New `mock/` layout.** Data tables live in `mock/tables/<table>.json`
  (just `{ amount, data, fixtures?, literal? }`); endpoints live in
  `mock/routes/<group>.json`. The legacy `mock/api/<entity>/schema.json`
  (table + implicit REST) still works, but `mpug migrate` converts it to the
  new layout (GET → `list`/`one`, create/update/delete → `mutation`).
- **A `mock/tables/` table has no implicit URL.** A table referenced by no
  route is *internal* — generated and usable in relations/includes, but not
  served. Legacy `mock/api/` tables keep their auto-CRUD.
- **`bypass` moved from the table to the endpoint** (`migrate` carries it
  across).

### Added

- **Endpoint model (`Route`)** in the browser-safe core: `list`, `one`,
  `mutation` (a method map — responds `200`, doesn't write; real writes are
  `action`, coming next), `static`, and opaque `action`/`handler`. Path
  params (`:id`), `where` bindings (`:param` / `?query` / literal / array /
  `$literal`), `select` projection, one-level `include`, per-endpoint
  `sort`/`paginate`/`filterable`/`searchable`. `matchRoute`/`executeRoute`
  are the shared engine both transports and the cloud build on.
- **`mpug migrate`** — converts a legacy project to `tables/` + `routes/`.
- **Cloud sync: `mpug login` / `link` / `pull`.** `pull` mirrors the
  published schema 1:1 (writes + removes to match cloud; `handlers/`, custom
  generators and `mock.config.js` are out of scope); `link` uploads existing
  local mocks to the project draft (or pulls when there are none);
  `--no-push` / `--force` / `--watch` / `--version` / `--project` /
  `MOCKINGPUG_TOKEN`.
- **doctor validates endpoints** (`MP-ROUTE-*`): unknown tables/fields,
  path/method conflicts, bad includes, unused path params, invalid
  `mutation` JSON, non-positive paginate limits.
- **OpenAPI/docs are generated from endpoints**: responses reflect
  `select` + `include`, fields no endpoint returns become `writeOnly`,
  `mutation` request/response examples are documented.
- **Nested objects in `data`**: a field value can be an object of sub-fields
  (`"options": { "is_top": "boolean.0.15" }`), generated recursively; `select`
  addresses leaves with a dotted path (`options.is_top`). No more fake 1:1
  tables for value objects.
- **Sort accepts the `-field` shorthand** (descending) alongside `field:desc`;
  doctor validates a route's `sort` fields.
- **`enum[...]` preserves literal types**: `enum[3600,86400]` yields numbers,
  `enum[true,false]` booleans, `enum[ADMIN,USER]` strings.
- **Correlated ref with renamed outputs**:
  `{ "kind": "ref", "entity": "product", "fields": { "product_id": "id" } }`
  maps target fields to renamed outputs from one picked record (no name
  collisions).
- **Nested `include` trees** (reverse form, capped at depth 3), and `include`
  now resolves before `select` so a projected-away FK still joins.
- **Literal-derived fields**: fields present in every `literal` record but
  absent from `data` are inferred into the schema (typed by value).
- **doctor** gains checks: custom-dictionary `max` capacity vs `amount`, and
  mock routes shadowed by a real Next App Router handler.
- **Dotted paths** in `select` and query filters address nested-object leaves
  (`select: ["options.is_top"]`, `?options.is_top=true`).
- **`composite` routes**: compose one response object from several table reads
  (`shape: { slider: { from, sort }, banners: { from, where } }`; `first: true`
  → a single object).
- **`action` routes**: real writes — `insert`/`update`/`delete`/`increment`
  effects (applied atomically) with `:param`/`?query`/`$body.*`/`$ref.*`/`$now`
  bindings, then a `respond` (a query, a prior effect's `$ref`, or `status`+`body`).
- **Configurable response envelope** (`response.envelope` + `listKey`):
  `$payload`/`$meta` placeholders let the mock match a contract's exact body
  shape (e.g. `{ data: { items: [...] }, meta, errors: [] }`).
- **`mockingpug/vite`** virtual module now also exports `routes`.
- **`data.<entity>.<field>!unique`** — 1:1 relations (identity mapping).

### Changed

- `mpug init` scaffolds the new `mock/{tables,routes,data}` layout.
- Examples (Next.js, CRA, Vite) migrated to the endpoint format.

## [2.1.0]

More framework reach (React Native, Vue, GraphQL), a public OpenAPI export, a
framework-agnostic devtools core, a cloud "open" command, and hot-reload of
`mpug pull` under `next dev`.

### Added

- **React Native / Expo support** (`mockingpug/native`): `setupNativeMocks(ctx)`
  runs the same handlers through MSW's React Native server (no DOM). New
  `mpug codegen` writes `mock/.generated/schemas.ts` for bundlers without a
  plugin (Metro), and `doctor --assert-prod-safe` also flags a native leak.
- **Vue (and non-React browser) support** (`mockingpug/vue`): `setupMockWorker(ctx)`
  starts the same handlers through MSW's browser worker without React —
  framework-neutral (Vue/Svelte/Solid/vanilla).
- **GraphQL support** (`mockingpug/graphql`): a GraphQL API auto-generated from
  the same tables and resolved through the same store as REST. `createGraphQLHandler(ctx)`
  adds a `POST /graphql` MSW handler; `executeGraphQL(body, ctx)` runs one
  request (the Next.js Route Handler answers `POST /graphql` out of the box).
  `graphql` is an optional peer dependency.
- **Public OpenAPI generator**: `generateOpenApi(entities, routes?, config?)`
  (an OpenAPI 3.1 document) and `renderOpenApiHtml(spec)` are exported from the
  root `mockingpug` entry — dependency- and fs-free, so they run in the browser
  and Node.
- **`mockingpug/devtools-core`** — a framework-agnostic runtime controller
  (`createRuntimeController(ctx)`): request log, one-shot fail/delay, per-request
  bypass (mock/real), entity bypass, and store snapshot export/import, all
  DOM-free. Lets a Vue/RN/custom panel drive the running mock the same way the
  React `<MockDevtools>` does.
- **Vue devtools panel** (`mockingpug/vue/client`): the full `<MockDevtools>`
  panel for Vue — mock-data browser, request log, per-entity/per-request bypass,
  one-shot fail/delay, snapshot import/export. The panel UI is now a single
  framework-agnostic implementation shared by the React, Next and Vue entries
  (no per-framework duplication).
- **`mpug open [schema|api|data]`** — opens the linked cloud project (or a tab)
  in the browser; the URL is also printed for CI/SSH.
- **`createNextRouteHandlers()`** — the recommended one-liner for the catch-all
  Route Handler; re-fetches the context per request so a live `next dev` picks
  up `mpug pull` / schema edits (data regenerated) without a restart.

### Changed

- **Cloud sync safety.** The git origin is normalized (ssh/https, trailing
  `.git`, ports, tokens) so a repo counts as one connected app. Re-running
  `mpug link` on an already-linked folder no longer silently pushes — it
  suggests `pull` (or `link --push`); relinking to a different project needs
  `--yes`. A push over a non-empty cloud draft asks first (`--yes` to confirm),
  and `--force` overrides unpublished cloud edits a push conflicts with
  (`CLOUD-CONFLICT` now lists exactly what would be overwritten).

## [1.3.0]

### Added

- **`number.float.<min>-<max>.<precision>`**: floating-point numbers with a
  set number of decimal places, e.g. `number.float.4-5.1` → `4.8`.
- **`mpug generators`**: new CLI command listing every DSL generator the
  parser supports, with syntax and examples.
- **`?mpug-bypass=1` / `X-Mockingpug-Bypass: 1`**: lets one request skip
  `runtime.errorRate`/`delay` (and any armed one-shot override) without
  restarting the dev server.
- **`groupBy` / `limitPerGroup`**: per-group record limits for batch
  requests (`?group_id=1,2,3&groupBy=group_id&limitPerGroup=5`), instead
  of one shared `limit` budget across the whole batch.
- **Per-request bypass in `<MockDevtools>`**: "Use real data" toggle moved
  from per-record to the "Requests" view, keyed by exact method + path —
  covers list/item/mutation routes independently.
- **`conditional` field generation** (`{when, then, else}`): derive a
  field's value from another already-generated field on the same record.
- **`crossRef` inside `array[...]`**: field-level relation picks now work
  as array items, not just top-level fields.
- **Correlated multi-field pick** (`data.<entity>.[field1,field2,...]`):
  pull several fields from the same related record instead of resolving
  each independently.
- **Literal (pinned) records** (`fixtures`): pin specific fields on
  specific records to exact values, regardless of seed.
- **`mpug init`**: auto-detects the project's package manager (npm/pnpm/
  yarn/bun/deno) instead of always assuming npm.
- **`mpug docs`**: generates an API reference (`openapi.json` +
  `index.html`) for the mocked REST surface.

### Fixed

- **`<MockProvider>`**: fixed a StrictMode-only race where the dev-only
  mount → cleanup → mount double-invoke could call `worker.start()` and
  `worker.stop()` out of order, making MSW throw ("cannot configure an
  already enabled network") and silently disabling mocking for the rest
  of the session. Found while wiring `<MockDevtools>` into `examples/`.

## [1.2.1]

Docs- and test-only patch: no public API changes, no behavior changes to
already-correct code paths.

### Fixed

- **Documented and regression-tested**: the devtools sub-API
  (`{baseUrl}/__mockingpug/*`, everything `<MockDevtools>` itself calls) is
  never subject to `runtime.errorRate`/`delay`, for every verb, not just
  the record-edit route that already had a test for it. This was already
  true in code (the panel never routes through `simulateRuntime`), but
  wasn't guaranteed by a test or called out as an invariant, and a
  live-testing report described it as a "lockout" — the actual cause is a
  host page's own uncaught data-fetching error taking the whole route down
  around the panel, not the panel itself being blocked; both guides now
  say so explicitly (`site/content/docs/guides/devtools.mdx`,
  `site/content/docs/reference/mock-config.mdx`).
- **Docs**: corrected a false claim in the Schema DSL reference that
  `array[<inner type>].N` supports a `crossRef` inner type — it doesn't
  yet (`MP-GEN-001`/`MP-GEN-006` at generation time); documented the
  actual `category_id_1`/`category_id_2`/... workaround instead.
- **Docs**: corrected the `MP-GEN-001`/`MP-GEN-006` error-code reference,
  which described both as "internal invariant violations, not user-facing"
  — they're directly reachable today via `array[data.<entity>...].N`/
  `array[slugify[...]].N`.
- **Docs**: documented that two separate field-level relations to the same
  entity (`"data.product.id"` + `"data.product.name"`) resolve
  **independently** (different random picks, not guaranteed to be the same
  underlying record) — a real, easy-to-miss footgun in already-shipped
  behavior that had no warning anywhere.
- **CI**: added a 5-way matrix job verifying the CLI's documented
  invocation (`doctor`/`generate`/`types`) actually works when installed
  via npm, pnpm, yarn, bun, and deno, not just npm. `src/cli/README.md`,
  the CLI guide, and the top-level `README.md` now show the equivalent
  install/run command for each.

## [1.2.0]

### Added

- **`fixtures`** (`EntitySchema.fixtures`): pin specific fields of specific
  records to exact, caller-provided values, applied positionally
  (`fixtures[0]` is always record `0`, etc.) on every generation pass,
  regardless of seed. Only the fields you list are fixed — every other
  field on that record is still schema-generated. For entities where a few
  rows are load-bearing (e.g. referenced by slug elsewhere in the app)
  rather than incidental. (`a433634`)
- **`slugify` generator kind**: derives a URL-safe slug field from another
  already-generated field on the same record (`{ "kind": "slugify",
  "field": "...", "separator": "-" }`). (`a433634`)
- **`mockingpug/next` — `createProxyHandler()`**: wraps
  `createNextHandlers()` with an opt-in, per-request mock-vs-real decision
  (`shouldMock(request)`, defaults to `process.env.MOCK_MODE === 'mock'`),
  so a single deployed Route Handler can serve both — "Recipe B" for
  switching mock ↔ real without a build-time `rewrites()` split.
  (`545a1b3`)
- **`mockingpug/next` — `createLiveToggleMiddleware()`**: a `middleware.ts`
  helper that rewrites requests to a real backend based on a first-party
  cookie (`mockingpug-live` by default), decided per request with no
  rebuild — "Recipe C". Paired with `setLiveToggleCookie()`/
  `getLiveToggleCookie()`, exported from the new `mockingpug/next/client`
  entry for flipping the cookie from your own UI. `next` is now an
  optional peer dependency, only required by these two exports.
  (`545a1b3`)
- **`<MockDevtools>` — live record editor**: the JSON viewer in a
  `DataWindow` is now editable in place (pencil icon → `<textarea>` with
  IDE-like syntax highlighting → checkmark saves). Saves go through the
  same merge `PUT`/`PATCH` a real request would use, diffed by `.id`
  against the last-loaded records so only actually-changed rows are sent.
  (`3d25913`)
- **`<MockDevtools>` — request log**: a new "Requests" view lists the last
  50 requests the mock actually answered (method, path, status, duration,
  time), polling while open, with a "Clear request log" action. The
  devtools sub-API's own calls are never logged. (`3d25913`)
- **`<MockDevtools>` — one-shot fail/delay override**: "Fail next request"
  switch and "Delay next" input per entity, arming a single-request
  override that fully replaces (not layers on top of) the global
  `runtime.errorRate`/`delay` for that one request, then disarms itself —
  finer-grained than dialing up `errorRate` globally. (`cfcf8c6`)
- **`<MockDevtools>` — Export/Import snapshot**: "Export" downloads the
  entire store (every entity's records + meta) as one JSON file; "Import"
  restores it, per-entity, via the same reconciliation-safe `store.save()`
  path. Unrecognized entity names in an imported file are skipped rather
  than applied. (`726b5af`)
- **`<MockDevtools>` — entity list filter + virtualization**: a text
  filter narrows the "Mock Data" list by name, and the list itself is
  windowed (only rows near the current scroll position are rendered), so
  it stays responsive with dozens/hundreds of entities. (`ee3220b`)
- **`<MockDevtools>` — "Copy as curl"**: each record in the read-only
  viewer that has a resolvable `.id` gets a button that copies a
  ready-to-run `curl -X GET '<record URL>'` to the clipboard, for manual
  testing outside the browser. The `react` version of `<MockDevtools>`
  gained a `baseUrl` prop (default `/api`) to build that URL. (`3d532d7`)

### Removed

- **Breaking:** the "Highlight mock data" devtools feature (and its
  `maskMinLength`/`maskSubstringMinLength` props on both `<MockDevtools>`
  components) has been removed entirely. Live testing against a real
  storefront surfaced both false positives (a mock value colliding by
  substring with unrelated hardcoded text) and false negatives (values the
  consuming app reformats client-side never match their raw source), with
  no reliable fix short of consumer-side code changes — rather than ship a
  partially-working heuristic, the feature was cut. If you were passing
  either prop, remove it; there is no direct replacement. (`552bb6b`)

### Documentation

- Expanded the `devtools`/`nextjs` guides and both integration READMEs to
  cover every feature above, plus a dedicated write-up of
  `runtime.errorRate`/`delay` behavior and its `errorRate: 1` footgun
  (it can also block the devtools panel itself in the `next` transport;
  restarting the dev process is the only recovery today). (`fc91359`,
  `01fa310`, and inline with each feature commit above)
