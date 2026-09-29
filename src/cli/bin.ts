#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { init } from './commands/init.js';
import { doctor } from './commands/doctor.js';
import { generate } from './commands/generate.js';
import { reset } from './commands/reset.js';
import { prune } from './commands/prune.js';
import { types } from './commands/types.js';
import { docs } from './commands/docs.js';
import { generators } from './commands/generators.js';
import { codegen } from './commands/codegen.js';
import { login } from './commands/login.js';
import { link } from './commands/link.js';
import { open } from './commands/open.js';
import { pull } from './commands/pull.js';
import { migrate } from './commands/migrate.js';
import type { CommandResult } from './commandResult.js';

const USAGE = `Usage: mockingpug <command> [flags]

Commands:
  init      Scaffold mock.config.js + mock/api + mock/data
  doctor    Validate schemas without touching the store
              --strict                    fail on warnings, not just report them
              --json                      print every schema issue as JSON (cloud/CLI parity)
              --assert-prod-safe <dir>    fail if <dir> (a production build output) contains mock markers
  login     Sign in to MockingPug Cloud (device auth)
  link      Link this folder to a cloud project: mockingpug link <projectId>
              --no-push                   link only; don't upload existing local mocks
              --push                      re-linking an already-linked folder: also upload local mocks
              --yes                       skip the relink / pre-push overwrite confirmation
              --force                     override unpublished cloud edits a push conflicts with
  open      Open the linked cloud project in the browser: mockingpug open [schema|api|data]
  pull      Pull (mirror 1:1) the published schema into mock/
              --watch                     keep syncing as the schema changes in cloud
              --version <n>               pull a pinned published version (CI)
              --project <id>              pull a specific project (CI, overrides the link file)
              --yes                       overwrite/remove local files to match cloud without asking
              --force                     mirror even if an unpublished push from this app is pending
  migrate   Convert legacy mock/api schemas to the tables/ + routes/ format
              --yes                       apply (default is a dry-run plan)
  generate  Generate/reconcile data into the configured store
  reset     Wipe the store entirely (--yes required)
  prune     Delete orphaned entities from the store (--yes required)
  codegen   Write mock/.generated/schemas.ts (parsed schemas+routes for Metro/RN)
              --watch                     regenerate on changes to mock/
  types     Write .mockingpug/types/index.d.ts (one TS interface per entity)
  docs      Write .mockingpug/docs/{index.html,openapi.json} (REST API reference)
  generators  Print every DSL generator the parser supports, with syntax + examples
`;

/** Reads the value following a `--flag <value>` pair out of the raw argv, or undefined if the flag wasn't passed. */
function flagValue(rest: string[], flag: string): string | undefined {
  const index = rest.indexOf(flag);
  return index === -1 ? undefined : rest[index + 1];
}

function printResult(result: CommandResult): void {
  for (const message of result.messages) {
    console.log(`[mockingpug] ${message}`);
  }
  for (const warning of result.warnings) {
    console.warn(`[mockingpug] warning: ${warning}`);
  }
}

export async function run(argv: string[], cwd: string): Promise<number> {
  const [command, ...rest] = argv;
  const flags = new Set(rest);

  try {
    switch (command) {
      case 'init':
        printResult(await init(cwd));
        return 0;
      case 'doctor': {
        const result = await doctor(cwd, {
          strict: flags.has('--strict'),
          json: flags.has('--json'),
          assertProdSafe: flagValue(rest, '--assert-prod-safe'),
        });
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'login': {
        const result = await login();
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'link': {
        const projectId = rest.find((arg) => !arg.startsWith('-'));
        const result = await link(cwd, projectId, {
          noPush: flags.has('--no-push'),
          push: flags.has('--push'),
          force: flags.has('--force'),
          yes: flags.has('--yes'),
        });
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'open': {
        const tab = rest.find((arg) => !arg.startsWith('-'));
        const result = await open(cwd, tab);
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'pull': {
        const versionRaw = flagValue(rest, '--version');
        const result = await pull(cwd, {
          watch: flags.has('--watch'),
          yes: flags.has('--yes'),
          force: flags.has('--force'),
          project: flagValue(rest, '--project'),
          version: versionRaw !== undefined ? Number(versionRaw) : undefined,
        });
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'migrate': {
        const result = await migrate(cwd, { yes: flags.has('--yes') });
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'generate': {
        const result = await generate(cwd);
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'reset': {
        const result = await reset(cwd, { yes: flags.has('--yes') });
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'prune': {
        const result = await prune(cwd, { yes: flags.has('--yes') });
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'types': {
        const result = await types(cwd);
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'docs': {
        const result = await docs(cwd);
        printResult(result);
        return result.ok ? 0 : 1;
      }
      case 'generators': {
        printResult(generators());
        return 0;
      }
      case 'codegen': {
        const result = await codegen(cwd, { watch: flags.has('--watch') });
        printResult(result);
        return result.ok ? 0 : 1;
      }
      default:
        console.log(USAGE);
        return 1;
    }
  } catch (error) {
    // Anything reaching here is NOT a recognized mockingpug domain error
    // (those are already caught and turned into CommandResult by the
    // commands themselves). Let it surface with a full stack trace, since
    // that means something is genuinely broken.
    console.error('[mockingpug] unexpected internal error:');
    console.error(error);
    return 1;
  }
}

/* v8 ignore start -- process wiring, exercised via run() in tests instead */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
/* v8 ignore stop */
