# Contributing to mockingpug

Thanks for taking the time to contribute.

## Setup

```bash
git clone https://github.com/N1TAXE/mockingpug.git
cd mockingpug
npm install
```

## Workflow

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run coverage     # vitest run --coverage
npm run build        # tsup, builds every dist/* entry point
```

All four must pass before opening a PR. CI runs the same commands on every
pull request.

The docs site lives under `site/` as its own Next.js app:

```bash
cd site
npm install
npm run dev
```

Runnable example apps for each transport (React/Vite, CRA, Next.js) live
under `examples/`; each is its own npm project.

## Making changes

- Keep PRs focused: one fix or feature per PR is easier to review than a
  bundle of unrelated changes.
- Add or update tests under `tests/` for any behavior change. `npm run
  coverage` should not regress.
- If you change a public API (anything exported from `src/*/index.ts`),
  update the matching guide under `site/content/docs/` in the same PR.
- Match the existing code style; there's no separate linter config to run,
  `tsc --noEmit` and the test suite are the gate.

## Commit messages and PRs

- Describe *why* a change was made, not just what changed.
- Reference the issue a PR addresses, if any (`Fixes #123`).
- Squash merge is used for this repo, so intermediate "fix typo"/"address
  review" commits inside a PR are fine and get collapsed on merge.

## Reporting bugs / requesting features

Use the issue templates. For bugs, a minimal reproduction (a schema + the
command you ran + what you expected vs. got) is worth more than a long
description.

## Security

Do not open a public issue for a security vulnerability. See
[SECURITY.md](SECURITY.md) instead.
