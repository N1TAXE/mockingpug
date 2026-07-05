import { findOrphanEntities } from '../../store/index.js';
import { loadConfig } from '../mockConfig.js';
import { loadProject } from '../schemaLoader.js';
import { storeAdapterFor } from './generate.js';
import { asCommandFailure, fail, ok, type CommandResult } from '../commandResult.js';

export interface PruneOptions {
  /** Must be explicitly true to actually delete orphan entities. */
  yes?: boolean;
}

/** Deletes only entities that exist in the store but no longer have a matching schema. */
export async function prune(projectDir: string, options: PruneOptions = {}): Promise<CommandResult> {
  const config = await loadConfig(projectDir);

  let project;
  try {
    project = await loadProject(projectDir, config.dir);
  } catch (error) {
    return asCommandFailure(error);
  }

  const store = storeAdapterFor(projectDir, config.persist.adapter);
  const storedEntities = await store.listEntities();
  const orphans = findOrphanEntities(storedEntities, Object.keys(project.entities));

  if (orphans.length === 0) {
    return ok(['no orphan entities found, nothing to prune']);
  }

  if (!options.yes) {
    return fail([
      `found ${orphans.length} orphan entit${orphans.length === 1 ? 'y' : 'ies'} (${orphans.join(', ')}). ` +
        're-run with --yes to delete them permanently',
    ]);
  }

  for (const orphan of orphans) {
    await store.deleteEntity(orphan);
  }

  return ok(orphans.map((name) => `pruned "${name}"`));
}
