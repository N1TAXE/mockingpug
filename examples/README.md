# Examples

Real, runnable starter apps with `mockingpug` already wired up — one per
supported transport. These aren't toy snippets: each is a genuine
`npm install && npm run dev/start` app exercising the full feature set
(generation, custom dictionaries, field-level + bare cross-entity
relations, CRUD, pagination), and they double as live smoke tests catching
bundler-specific bugs that unit tests can't (see `IMPLEMENTATION_STATUS.md`
for two examples already found this way: a Turbopack dynamic-import bug,
and a CRA `src/`-only-imports restriction).

| Example | Transport | Schema loading |
|---|---|---|
| [`react-vite`](react-vite) | `mockingpug/react` | Option A — `mockingpug/vite` plugin (auto-discovery) |
| [`react-cra`](react-cra) | `mockingpug/react` | Option B — manual static import |
| [`nextjs`](nextjs) | `mockingpug/next` | catch-all Route Handler (`getMockContext()`) |
| `vue` | — | planned after the Vue transport itself is built |
