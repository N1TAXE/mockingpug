import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'deno';

/**
 * Lockfile -> manager, checked in this order. Order matters only if a
 * project somehow has more than one lockfile (e.g. mid-migration between
 * managers); the first match wins.
 */
const LOCKFILE_MANAGERS: ReadonlyArray<{ file: string; manager: PackageManager }> = [
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'deno.lock', manager: 'deno' },
  { file: 'deno.json', manager: 'deno' },
  { file: 'deno.jsonc', manager: 'deno' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
];

/**
 * Detects which package manager a project uses from its lockfile, falling
 * back to `npm` (the most common default, and what every other manager's
 * install docs assume as a baseline) when no lockfile is present yet, e.g.
 * a brand-new project running `mpug init` before its first install.
 */
export function detectPackageManager(projectDir: string): PackageManager {
  for (const { file, manager } of LOCKFILE_MANAGERS) {
    if (existsSync(join(projectDir, file))) return manager;
  }
  return 'npm';
}

/** Formats `mpug <command>` in the run syntax each package manager expects, matching `src/cli/README.md`'s table. */
export function formatRunCommand(manager: PackageManager, command: string): string {
  switch (manager) {
    case 'npm':
      return `npx mpug ${command}`;
    case 'pnpm':
      return `pnpm exec mpug ${command}`;
    case 'yarn':
      return `yarn exec mpug ${command}`;
    case 'bun':
      return `bunx mpug ${command}`;
    case 'deno':
      return `deno run -A npm:mockingpug ${command}`;
  }
}
