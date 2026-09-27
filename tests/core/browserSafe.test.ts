import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R9: the root `mockingpug` entry (= `src/core`) is imported into the cloud
 * editor's client bundle, so it must never pull Node built-ins or `fs`. This
 * guards the boundary so a stray `import 'node:...'` in core fails CI instead
 * of breaking a browser build downstream.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('core is browser-safe (R9)', () => {
  it('no src/core module imports node: builtins or fs', () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'src', 'core'))) {
      const src = readFileSync(file, 'utf8');
      // import/require of a node: builtin, or bare fs / node:fs etc.
      if (/from\s+['"]node:/.test(src) || /require\(\s*['"]node:/.test(src) || /from\s+['"]fs['"]/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, `core modules with node imports:\n${offenders.join('\n')}`).toEqual([]);
  });
});
