# mockingpug

[![CI](https://github.com/N1TAXE/mockingpug/actions/workflows/ci.yml/badge.svg)](https://github.com/N1TAXE/mockingpug/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[Website & documentation](https://mockingpug.vercel.app/)**

Declarative, JSON-schema-driven mock data generation and REST-like API
mocking for React/Next.js. No separate mock server process, no hand-written
fixture arrays, no imperative factory functions to maintain.

You describe each entity once, as a small JSON file (`mock/api/user/schema.json`):

```json
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

and mockingpug generates 1000 deterministic, seed-stable records, resolves
`posts` as a live join against another entity's schema, and serves them over
the exact same `/api/user` endpoint your app would call in production, either
by intercepting `fetch()` in the browser ([MSW](https://mswjs.io)-based) or
from a real Next.js App Router Route Handler.

## Why not just hand-write fixtures / use Faker directly?

Hand-written fixture arrays and ad-hoc `faker.js` calls work fine for a
handful of records, but stop scaling once you need cross-entity relations
that stay consistent, deterministic reruns, incremental regeneration when a
schema changes, or a real REST surface (pagination, field filtering,
substring search, sorting, full CRUD) without hand-writing a handler per
entity.

## What's in this package

| Import | What it's for |
|---|---|
| `mockingpug` | Core: schema parsing, generators, seeded RNG, dependency graph. No framework dependency. |
| `mockingpug/cli` | Programmatic access to the CLI commands (`init`, `doctor`, `generate`, `reset`, `prune`, `types`, `docs`). |
| `mockingpug/react` | MSW handler generation, `<MockProvider>`/`<MockDevtools>`, `bypass()`/`unbypass()`. |
| `mockingpug/next` | App Router catch-all Route Handler builder + context loader. |
| `mockingpug/next/client` | `<MockDevtools>` for the Next.js transport. |
| `mockingpug/vite` | Vite plugin: auto-discovers `mock/api/**`/`mock/data/**` as a virtual module. |

Plus a CLI binary (`npx mpug <command>`, alias `npx mockingpug <command>`)
for scaffolding, validating, and generating data offline.

## Getting started

```bash
npm install -D mockingpug
npx mpug init
```

Works the same under pnpm, yarn, bun, and deno — see
[`src/cli/README.md`](src/cli/README.md#install) for the equivalent
install/run command on each, verified in CI.

See the full documentation at **[mockingpug.vercel.app](https://mockingpug.vercel.app/)**
(source under [`site/content/docs`](site/content/docs)) for the schema DSL,
framework guides (React, Next.js, Vite), the CLI reference, and the
security/performance notes. Runnable starters for every supported transport
live under [`examples/`](examples).

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor workflow.

## License

[MIT](LICENSE)
