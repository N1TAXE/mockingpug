import { join } from 'node:path';
import { generateAll } from '../../generator/index.js';
import { FileStoreAdapter, MemoryStoreAdapter, type StoreAdapter } from '../../store/index.js';
import { loadConfig } from '../mockConfig.js';
import { loadProject } from '../schemaLoader.js';
import { asCommandFailure, ok, type CommandResult } from '../commandResult.js';

export function storeAdapterFor(projectDir: string, adapter: 'memory' | 'file'): StoreAdapter {
  return adapter === 'file'
    ? new FileStoreAdapter(join(projectDir, '.mockingpug', 'db'))
    : new MemoryStoreAdapter();
}

/**
 * Loads the project and runs `generateAll()` against the configured store.
 * This is the CLI entry point for the reconciliation engine. Honors
 * `persist.strategy`: `'fresh'` wipes the store before generating, `'always'`
 * lets `generateAll()` reconcile against whatever's already there.
 */
export async function generate(projectDir: string): Promise<CommandResult> {
  const config = await loadConfig(projectDir);

  let project;
  try {
    project = await loadProject(projectDir, config.dir);
  } catch (error) {
    return asCommandFailure(error);
  }

  if (Object.keys(project.entities).length === 0) {
    return ok([`no entities found under ${config.dir}/api, nothing to generate`]);
  }

  const store = storeAdapterFor(projectDir, config.persist.adapter);
  if (config.persist.strategy === 'fresh') {
    await store.reset();
  }

  let summary;
  try {
    summary = await generateAll(project.entities, store, {
      seed: config.seed,
      customDictionaries: project.customDictionaries,
    });
  } catch (error) {
    return asCommandFailure(error);
  }

  const messages = summary.entities.map((e) =>
    e.skipped
      ? `${e.entity}: unchanged, skipped (${e.recordCount} records)`
      : `${e.entity}: generated (${e.recordCount} records)`,
  );
  const warnings = summary.orphanEntities.map(
    (name) => `entity "${name}" exists in the store but has no schema anymore, run "mpug prune"`,
  );

  return ok(messages, warnings);
}
