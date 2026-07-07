import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateOpenApiSpec } from '../../openapi-gen/generate.js';
import { renderDocsHtml } from '../../openapi-gen/renderHtml.js';
import { loadConfig } from '../mockConfig.js';
import { loadProject } from '../schemaLoader.js';
import { asCommandFailure, ok, type CommandResult } from '../commandResult.js';

/**
 * Writes `.mockingpug/docs/openapi.json` (a standard OpenAPI 3.1 document,
 * importable into a real Swagger UI/Postman/Redocly) and
 * `.mockingpug/docs/index.html` (a dependency-free static page rendering
 * the same spec, openable straight off disk) describing the REST surface
 * every entity's mock exposes: `GET`/`POST` on the collection,
 * `GET`/`PUT`/`PATCH`/`DELETE` on one record, every query
 * parameter (pagination, `sort`, `q`/`searchFields`, per-field filters),
 * and the response envelope shape from `mock.config.js`'s `pagination`
 * config. The devtools sub-API is not part of this output — it's an
 * internal channel, not part of the contract being mocked.
 */
export async function docs(projectDir: string): Promise<CommandResult> {
  const config = await loadConfig(projectDir);

  if (!config.docs.enabled) {
    return ok(['API docs generation is disabled ("docs.enabled: false" in mock.config.js), nothing written']);
  }

  let project;
  try {
    project = await loadProject(projectDir, config.dir);
  } catch (error) {
    return asCommandFailure(error);
  }

  if (Object.keys(project.entities).length === 0) {
    return ok([`no entities found under ${config.dir}/api, nothing to generate docs for`]);
  }

  const spec = generateOpenApiSpec(project.entities, config, project.customDictionaries);
  const html = renderDocsHtml(spec);

  const outDir = join(projectDir, '.mockingpug', 'docs');
  await mkdir(outDir, { recursive: true });
  const specFile = join(outDir, 'openapi.json');
  const htmlFile = join(outDir, 'index.html');
  await writeFile(specFile, JSON.stringify(spec, null, 2), 'utf-8');
  await writeFile(htmlFile, html, 'utf-8');

  return ok([
    `generated API docs for ${Object.keys(project.entities).length} entities -> ${htmlFile}`,
    `OpenAPI 3.1 spec -> ${specFile}`,
  ]);
}
