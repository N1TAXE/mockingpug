import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { topologicalOrder, validateEntitiesExist, type EntitySchema, type FieldSpec } from '../../core/index.js';
import { findOrphanEntities, FileStoreAdapter } from '../../store/index.js';
import { toSchemaMap } from '../../generator/index.js';
import { loadConfig, type LimitsConfig } from '../mockConfig.js';
import { loadProject } from '../schemaLoader.js';
import { asCommandFailure, fail, ok, type CommandResult } from '../commandResult.js';

export interface DoctorOptions {
  /** Promotes every warning (orphan entities, etc.) to a hard failure, meant for CI. */
  strict?: boolean;
  /**
   * Greps a production build output directory for markers that mean the mock
   * layer leaked into the prod bundle (Service Worker
   * script, Route Handler chunk, etc.). Always a hard failure when markers are
   * found, regardless of `strict`.
   */
  assertProdSafe?: string;
}

const PROD_SAFETY_MARKERS = ['mockServiceWorker.js', 'mockingpug/dist/react', 'mockingpug/dist/next'];

function walkArrayCounts(spec: FieldSpec, onArray: (count: number) => void): void {
  if (spec.kind === 'array') {
    onArray(spec.count);
    walkArrayCounts(spec.item, onArray);
  }
}

/** DoS-guard, not just perf: catches a schema with an unreasonably large `amount` or `array[type].N` before it ever runs. */
function checkLimits(entities: Record<string, EntitySchema>, limits: LimitsConfig): string[] {
  const warnings: string[] = [];
  for (const schema of Object.values(entities)) {
    if (schema.amount > limits.maxAmount) {
      warnings.push(
        `entity "${schema.name}" has amount=${schema.amount}, exceeding limits.maxAmount=${limits.maxAmount}. ` +
          `Raise limits.maxAmount in mock.config.js if this is intentional`,
      );
    }
    for (const [fieldName, spec] of Object.entries(schema.data)) {
      walkArrayCounts(spec, (count) => {
        if (count > limits.maxArrayDepth) {
          warnings.push(
            `entity "${schema.name}"'s field "${fieldName}" has array count=${count}, exceeding ` +
              `limits.maxArrayDepth=${limits.maxArrayDepth}. Raise limits.maxArrayDepth in mock.config.js if intentional`,
          );
        }
      });
    }
  }
  return warnings;
}

const TEXT_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.html', '.map'];

/**
 * Best-effort static grep over a production build output directory for
 * markers that mean the mock layer (Service Worker script, or a bundled
 * `mockingpug/dist/react|next` chunk) leaked into it. Not a
 * guarantee against a minified/mangled bundle hiding the reference, but
 * catches the common case of the raw file/import path surviving intact.
 */
async function findProdSafetyLeaks(buildDir: string): Promise<string[]> {
  const found = new Set<string>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (entry.name === 'mockServiceWorker.js') {
        found.add('mockServiceWorker.js');
        continue;
      }
      if (!TEXT_FILE_EXTENSIONS.includes(entry.name.slice(entry.name.lastIndexOf('.')))) {
        continue;
      }
      let content: string;
      try {
        content = await readFile(path, 'utf-8');
      } catch {
        continue;
      }
      for (const marker of PROD_SAFETY_MARKERS) {
        if (content.includes(marker)) {
          found.add(marker);
        }
      }
    }
  }

  await walk(buildDir);
  return [...found];
}

/**
 * Validates the project statically, without touching the store: schema
 * parsing, unknown-type typos, cross-entity reference cycles, and (best
 * effort) orphaned entities left over in a file-backed store.
 */
export async function doctor(projectDir: string, options: DoctorOptions = {}): Promise<CommandResult> {
  const config = await loadConfig(projectDir);

  let project;
  try {
    project = await loadProject(projectDir, config.dir);
  } catch (error) {
    return asCommandFailure(error);
  }

  const fieldsByEntity = toSchemaMap(project.entities);

  try {
    validateEntitiesExist(fieldsByEntity);
    topologicalOrder(fieldsByEntity);
  } catch (error) {
    return asCommandFailure(error);
  }

  const messages = [`${Object.keys(project.entities).length} entities validated OK`];
  const warnings: string[] = [...checkLimits(project.entities, config.limits)];

  if (options.assertProdSafe !== undefined) {
    const leaks = await findProdSafetyLeaks(options.assertProdSafe);
    if (leaks.length > 0) {
      return fail(messages, [
        ...warnings,
        ...leaks.map((leak) => `mock layer leaked into the production build: found "${leak}"`),
      ]);
    }
    messages.push(`--assert-prod-safe: no mock markers found in ${options.assertProdSafe}`);
  }

  if (config.persist.adapter === 'file') {
    const store = new FileStoreAdapter(join(projectDir, '.mockingpug', 'db'));
    const storedEntities = await store.listEntities();
    const orphans = findOrphanEntities(storedEntities, Object.keys(project.entities));
    for (const orphan of orphans) {
      warnings.push(`entity "${orphan}" exists in the store but has no schema anymore, run "mpug prune"`);
    }
  }

  if (options.strict && warnings.length > 0) {
    return fail(messages, warnings);
  }

  return ok(messages, warnings);
}
