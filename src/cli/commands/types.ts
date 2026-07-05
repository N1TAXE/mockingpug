import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateTypeDefinitions } from '../../types-gen/generate.js';
import { loadConfig } from '../mockConfig.js';
import { loadProject } from '../schemaLoader.js';
import { asCommandFailure, ok, type CommandResult } from '../commandResult.js';

/**
 * Writes `.mockingpug/types/index.d.ts`, one `export
 * interface` per entity, mirroring `mock/api/**`'s `data` block, so a
 * consumer gets `fetch<User[]>('/api/user')`-style autocomplete without
 * hand-duplicating the shape already described in the schema.
 */
export async function types(projectDir: string): Promise<CommandResult> {
  const config = await loadConfig(projectDir);

  let project;
  try {
    project = await loadProject(projectDir, config.dir);
  } catch (error) {
    return asCommandFailure(error);
  }

  if (Object.keys(project.entities).length === 0) {
    return ok([`no entities found under ${config.dir}/api, nothing to generate types for`]);
  }

  const outDir = join(projectDir, '.mockingpug', 'types');
  const outFile = join(outDir, 'index.d.ts');
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, generateTypeDefinitions(project.entities, project.customDictionaries), 'utf-8');

  return ok([`generated types for ${Object.keys(project.entities).length} entities -> ${outFile}`]);
}
