import { GENERATOR_CATALOG } from '../../core/index.js';
import { ok, type CommandResult } from '../commandResult.js';

/**
 * Prints every DSL form `parseFieldType()` recognizes, grouped by category,
 * straight from `GENERATOR_CATALOG` — the same source `parser.ts` and the
 * site docs (`schema-dsl.mdx`) are meant to stay in sync with, verified by
 * a test that pipes every entry's example through the real parser. Doesn't
 * touch a project's `mock.config.js` or filesystem, so it works from any
 * directory, unlike every other CLI command.
 */
export function generators(): CommandResult {
  const messages: string[] = [];
  let lastCategory: string | undefined;
  for (const entry of GENERATOR_CATALOG) {
    if (entry.category !== lastCategory) {
      messages.push(`${entry.category}:`);
      lastCategory = entry.category;
    }
    const example = entry.example ? ` (e.g. "${entry.example}")` : '';
    messages.push(`  ${entry.syntax} — ${entry.description}${example}`);
  }
  return ok(messages);
}
