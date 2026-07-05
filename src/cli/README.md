# mockingpug CLI

Command reference for `mockingpug`'s CLI. Every command operates on
`process.cwd()`, there's no `--dir <path>` flag; run it from your project
root, same as `npm` or `git`.

## Install

```bash
npm install -D mockingpug
npx mpug <command>
```

(Or install globally / add an npm script, `npx` works either way.) The
binary is also registered as `mockingpug`, so `npx mockingpug <command>`
still works if you prefer the full name.

## 1. `init`

```bash
npx mpug init
```

Scaffolds `mock.config.js`, `mock/api/`, and `mock/data/` in the current
directory. Idempotent and non-destructive:

- If `mock.config.js` already exists, it prints `already exists, nothing to
  do` and stops. It never overwrites your config.
- An example schema (`mock/api/example/schema.json`) is only added if
  `mock/api/` is completely empty, so running `init` in a project that
  already has real schemas (like this repo's `mock/api/user`,
  `mock/api/blogpost`) won't clutter it.

## 2. `doctor`

```bash
npx mpug doctor
npx mpug doctor --strict
npx mpug doctor --assert-prod-safe <build-output-dir>
```

Validates every schema under `mock/api/**` **without touching the store**:
unknown generator types (with a "did you mean" suggestion on typos),
missing/malformed `amount`/`data`, broken `data.*` cross-entity references,
and unresolvable dependency cycles. If `persist.adapter: 'file'`, it also
checks for orphaned entities: data left in `.mockingpug/db` whose schema no
longer exists. It also warns when an entity's `amount` or an `array[type].N`
exceeds `mock.config.js`'s `limits.maxAmount`/`limits.maxArrayDepth` (§below),
a DoS guard as much as a perf one, catching a schema that would generate
an unreasonably large amount of data before it ever runs.

- Exit code `0` if everything's valid (orphans and limit overruns are only
  **warnings**, not failures, by default).
- `--strict` promotes those warnings to a hard failure (exit code `1`),
  meant for CI, so a schema silently removed without pruning its old data
  (or a schema that quietly grew past a sane `amount`) doesn't slip through.
- `--assert-prod-safe <dir>` greps a production build output directory
  (e.g. your Next.js `.next` or Vite `dist`) for markers that mean the mock
  layer leaked into it: `mockServiceWorker.js`, or a bundled reference to
  `mockingpug/dist/react`/`mockingpug/dist/next`. Always a hard failure
  (regardless of `--strict`) when found, meant as a CI gate right after
  your production build step. Best effort: it's a static grep, not a
  guarantee against a minified bundle hiding the reference.

## 3. `generate`

```bash
npx mpug generate
```

Loads your schemas and reconciles them into the configured store
(`persist.adapter`: `'file'` → `.mockingpug/db/*.json`, `'memory'` → nothing
persists past this process). Honors `persist.strategy`:

- `'always'` (default): compares each entity's current schema against what
  was previously generated and only regenerates what actually changed
  (new/removed/changed fields, `amount` grown/shrunk). Unchanged entities
  are reported as `skipped`, not silently redone.
- `'fresh'`: wipes the store first, every run is a full regeneration.

Exit code `1` on a schema error (invalid JSON, unknown type, broken
reference, etc.). The message includes a stable error code (e.g.
`MP-SCHEMA-007`) and which file/field is at fault.

## 4. `reset`

```bash
npx mpug reset --yes
```

Wipes the store entirely. **Destructive and irreversible**, including any
manual mutations made while testing (`POST`/`PUT`/`DELETE` against a running
app). Refuses to run without `--yes`.

## 5. `prune`

```bash
npx mpug prune          # lists what would be deleted
npx mpug prune --yes    # actually deletes it
```

Deletes only orphaned entities (schema removed from `mock/api`, data still
sitting in the store); leaves everything else untouched. Also refuses
without `--yes`; without it, it lists which entities it found and exits `1`.

## 6. `types`

```bash
npx mpug types
```

Writes `.mockingpug/types/index.d.ts`: one `export interface` per entity,
mirroring its schema's `data` block (`crossRef` fields resolve to the target
entity's type or field type, custom dictionaries with all-primitive values
become a literal union, e.g. `role: "ADMIN" | "USER" | "MODER"`). Regenerate
it any time after changing `mock/api/**`; there's no watch mode, this is a
one-shot codegen step (add it to a `postinstall`/pre-dev script if you want
it automatic).

## `mock.config.js` reference

All fields are optional; this shows every default:

```js
module.exports = {
  dir: 'mock',                  // where mock/api and mock/data live, relative to cwd
  seed: 'mockingpug',            // deterministic generation seed
  baseUrl: '/api',               // used by mockingpug/react and mockingpug/next
  persist: {
    adapter: 'file',             // 'file' | 'memory'
    strategy: 'always',          // 'always' (reconcile) | 'fresh' (regenerate every run)
  },
  pagination: {
    strategy: 'page',            // 'page' | 'offset' | 'cursor' | false
    params: { page: 'page', limit: 'limit', offset: 'offset', cursor: 'cursor' },
    defaultLimit: 20,
    maxLimit: 100,
    envelope: true,               // true -> { data, meta } body; false -> raw array + X-* headers
  },
  limits: {
    maxAmount: 100_000,           // doctor warns (fails with --strict) above this per-entity `amount`
    maxArrayDepth: 3,             // doctor warns (fails with --strict) above this array[type].N
  },
  runtime: {
    errorRate: 0,                 // [0,1], fraction of requests synthetically failing with a 500
    delay: 0,                     // artificial latency (ms) added to every mock response
  },
};
```

CommonJS (`module.exports`) works out of the box regardless of your
project's own module type, since mockingpug loads this file via a plain
dynamic `import()` and Node's CJS/ESM interop handles the rest. An ESM
`export default {...}` also works if your project has `"type": "module"`.

## Logs and errors

Every message is prefixed `[mockingpug]`; warnings are prefixed
`[mockingpug] warning:`. Errors carry a stable code (`MP-SCHEMA-*`,
`MP-CONFIG-*`, `MP-DEP-*`, `MP-STORE-*`) and, where relevant, the exact
file/field at fault plus a fix suggestion; these are meant to be readable
without cross-referencing this doc. Anything that reaches the CLI *without*
one of these codes is treated as a genuine bug in mockingpug itself, not a
project misconfiguration. It's printed with its full stack trace
(`unexpected internal error:`) instead of a clean one-liner, on purpose.
