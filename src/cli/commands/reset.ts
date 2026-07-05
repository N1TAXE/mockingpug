import { loadConfig } from '../mockConfig.js';
import { storeAdapterFor } from './generate.js';
import { fail, ok, type CommandResult } from '../commandResult.js';

export interface ResetOptions {
  /** Must be explicitly true to actually wipe the store: a destructive, irreversible action. */
  yes?: boolean;
}

/** Wipes the persisted store entirely. Refuses without explicit confirmation. */
export async function reset(projectDir: string, options: ResetOptions = {}): Promise<CommandResult> {
  if (!options.yes) {
    return fail([
      'refusing to reset the store without confirmation. re-run with --yes if you\'re sure ' +
        '(this permanently deletes all generated AND manually-mutated data)',
    ]);
  }

  const config = await loadConfig(projectDir);
  const store = storeAdapterFor(projectDir, config.persist.adapter);
  await store.reset();

  return ok([
    config.persist.adapter === 'file'
      ? 'store reset, .mockingpug/db removed'
      : 'store reset (memory adapter has no state to persist between CLI runs anyway)',
  ]);
}
