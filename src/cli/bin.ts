#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { init } from './commands/init.js';
import { doctor } from './commands/doctor.js';
import { generate } from './commands/generate.js';
import { reset } from './commands/reset.js';
import { prune } from './commands/prune.js';
import { types } from './commands/types.js';
import type { CommandResult } from './commandResult.js';

const USAGE = `Usage: mockingpug <command> [flags]

Commands:
  init      Scaffold mock.config.js + mock/api + mock/data
  doctor    Validate schemas without touching the store
              --strict                    fail on warnings, not just report them
              --assert-prod-safe <dir>    fail if <dir> (a production build output) contains mock markers
  generate  Generate/reconcile data into the configured store
  reset     Wipe the store entirely (--yes required)
  prune     Delete orphaned entities from the store (--yes required)
  types     Write .mockingpug/types/index.d.ts (one TS interface per entity)
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
          assertProdSafe: flagValue(rest, '--assert-prod-safe'),
        });
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
