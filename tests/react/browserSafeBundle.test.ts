import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R9: `mockingpug/react` (and the root `mockingpug` = core) ship into browser
 * bundles. A single value import of a Node builtin anywhere in their reachable
 * module graph forces an fs/path polyfill downstream — which is exactly the bug
 * this guards (generator → store barrel → FileStoreAdapter → node:fs). Walks
 * the static import graph from each entry and fails on any Node-builtin value
 * import. Type-only imports are erased at build, so they're ignored.
 */
const NODE_BUILTINS = /^(node:|fs$|fs\/|path$|os$|crypto$|child_process$|util$|url$|stream$|http$|https$|net$|zlib$|readline$|worker_threads$|process$)/;

function importsOf(file: string): { relative: string[]; bare: string[] } {
  const src = readFileSync(file, 'utf8');
  const relative: string[] = [];
  const bare: string[] = [];
  // Match import/export ... from '<spec>' and side-effect `import '<spec>'`.
  const re = /(?:^|\n)\s*(import|export)\b([^;\n]*?)\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const clause = m[2] ?? '';
    const spec = m[3] ?? m[4]!;
    // Skip pure type-only imports/exports: erased at build, don't load the module.
    if (/^\s*type\b/.test(clause)) continue;
    (spec.startsWith('.') ? relative : bare).push(spec);
  }
  return { relative, bare };
}

function resolveModule(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function nodeBuiltinLeaks(entry: string): string[] {
  const seen = new Set<string>();
  const leaks: string[] = [];
  const stack = [resolve(process.cwd(), entry)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const { relative, bare } = importsOf(file);
    for (const spec of bare) {
      if (NODE_BUILTINS.test(spec)) leaks.push(`${file.replace(process.cwd(), '')} imports "${spec}"`);
    }
    for (const spec of relative) {
      const resolved = resolveModule(file, spec);
      if (resolved) stack.push(resolved);
    }
  }
  return leaks;
}

describe('browser-safe module graph (R9)', () => {
  it('mockingpug/react does not reach any Node builtin', () => {
    const leaks = nodeBuiltinLeaks('src/react/index.ts');
    expect(leaks, leaks.join('\n')).toEqual([]);
  });

  it('root mockingpug (core) does not reach any Node builtin', () => {
    const leaks = nodeBuiltinLeaks('src/core/index.ts');
    expect(leaks, leaks.join('\n')).toEqual([]);
  });
});
