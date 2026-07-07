import { pascalCase, type JsonSchema } from './generate.js';

/**
 * A dependency-free, single-file HTML API reference, rendered once at
 * generation time from the already-computed OpenAPI object (the same one
 * `openapi.json` is `JSON.stringify()`'d from — single source of truth, no
 * risk of the two drifting). Deliberately not built on `swagger-ui-dist`/
 * Redoc: same reasoning that kept the devtools panel's own JSON viewer
 * dependency-free (see `src/shared/devtoolsUI.tsx`) — this is meant to be a
 * lightweight local artifact, not a full API-platform UI. `openapi.json`
 * remains the interoperable export for anyone who wants a real Swagger
 * UI/Postman/Redocly.
 *
 * Everything is baked into static markup at generation time (no `fetch`,
 * no embedded JSON blob parsed at runtime), so the output opens correctly
 * straight off disk (`file://`) with zero server needed.
 */

const METHOD_COLORS: Record<string, string> = {
  GET: '#0451a5',
  POST: '#098658',
  PUT: '#a06600',
  PATCH: '#a06600',
  DELETE: '#c0392b',
};

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function refName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}

/** Short, human-readable description of a schema fragment, for a table cell — not a full JSON Schema renderer. */
function describeType(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown';
  if (typeof schema.$ref === 'string') return refName(schema.$ref);
  if (Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ');
  }
  if (schema.type === 'array') {
    return `${describeType(schema.items as JsonSchema | undefined)}[]`;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.join(' | ');
  }
  if (schema.properties) {
    return `{ ${Object.keys(schema.properties as Record<string, unknown>).join(', ')} }`;
  }
  if (typeof schema.type === 'string') {
    const bounds: string[] = [];
    if (typeof schema.minimum === 'number' || typeof schema.maximum === 'number') {
      bounds.push(`${schema.minimum ?? '-∞'}..${schema.maximum ?? '∞'}`);
    }
    if (typeof schema.maxLength === 'number') bounds.push(`≤${schema.maxLength} chars`);
    const suffix = schema.format ? ` (${escapeHtml(String(schema.format))})` : bounds.length ? ` (${bounds.join(', ')})` : '';
    return `${schema.type}${suffix}`;
  }
  return 'object';
}

function schemaPropertiesTable(schema: JsonSchema | undefined, schemas: Record<string, JsonSchema>): string {
  const resolved = schema && typeof schema.$ref === 'string' ? schemas[refName(schema.$ref)] : schema;
  const properties = (resolved?.properties ?? {}) as Record<string, JsonSchema>;
  const rows = Object.entries(properties)
    .map(([name, propSchema]) => `<tr><td class="mono">${escapeHtml(name)}</td><td class="mono faded">${escapeHtml(describeType(propSchema))}</td></tr>`)
    .join('');
  if (!rows) return '<p class="faded">No fields.</p>';
  return `<table><thead><tr><th>Field</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function parametersTable(parameters: JsonSchema[] | undefined): string {
  if (!parameters || parameters.length === 0) return '';
  const rows = parameters
    .map((p) => {
      const name = String(p.name ?? '');
      const inLoc = String(p.in ?? '');
      const type = describeType(p.schema as JsonSchema | undefined);
      const description = p.description ? escapeHtml(String(p.description)) : '';
      return `<tr><td class="mono">${escapeHtml(name)}</td><td class="faded">${escapeHtml(inLoc)}</td><td class="mono faded">${escapeHtml(type)}</td><td>${description}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Param</th><th>In</th><th>Type</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function exampleCurl(method: string, serverUrl: string, path: string, hasBody: boolean): string {
  const url = `${serverUrl}${path}`.replace('{id}', '1');
  const parts = [`curl -X ${method.toUpperCase()}`, `'${url}'`];
  if (hasBody) parts.push(`-H 'Content-Type: application/json'`, `-d '{}'`);
  return escapeHtml(parts.join(' '));
}

function operationSection(entityName: string, path: string, method: string, op: JsonSchema, serverUrl: string, schemas: Record<string, JsonSchema>): string {
  const color = METHOD_COLORS[method.toUpperCase()] ?? '#23272F';
  const summary = op.summary ? escapeHtml(String(op.summary)) : '';
  const description = op.description ? `<p class="op-description">${escapeHtml(String(op.description))}</p>` : '';
  const parameters = parametersTable(op.parameters as JsonSchema[] | undefined);
  const requestBody = op.requestBody as JsonSchema | undefined;
  const requestBodySchema = requestBody
    ? ((requestBody.content as JsonSchema | undefined)?.['application/json'] as JsonSchema | undefined)?.schema as JsonSchema | undefined
    : undefined;
  const responses = (op.responses ?? {}) as Record<string, JsonSchema>;
  const responseRows = Object.entries(responses)
    .map(([status, resp]) => {
      const respSchema = ((resp.content as JsonSchema | undefined)?.['application/json'] as JsonSchema | undefined)?.schema as JsonSchema | undefined;
      const type = respSchema ? escapeHtml(describeType(respSchema)) : '';
      return `<tr><td class="mono">${status}</td><td>${escapeHtml(String(resp.description ?? ''))}</td><td class="mono faded">${type}</td></tr>`;
    })
    .join('');

  return `
    <div class="operation" id="op-${escapeHtml(entityName)}-${method}-${escapeHtml(path.replace(/[^a-zA-Z0-9]/g, '-'))}">
      <div class="operation-header">
        <span class="method-badge" style="color:${color};border-color:${color}">${method.toUpperCase()}</span>
        <span class="mono path">${escapeHtml(path)}</span>
        <span class="summary">${summary}</span>
      </div>
      ${description}
      ${parameters ? `<h4>Query/path parameters</h4>${parameters}` : ''}
      ${requestBodySchema ? `<h4>Request body</h4>${schemaPropertiesTable(requestBodySchema, schemas)}` : ''}
      <h4>Responses</h4>
      <table><thead><tr><th>Status</th><th>Description</th><th>Body</th></tr></thead><tbody>${responseRows}</tbody></table>
      <h4>Example</h4>
      <pre class="mono curl">${exampleCurl(method, serverUrl, path, Boolean(requestBodySchema))}</pre>
    </div>`;
}

export function renderDocsHtml(spec: JsonSchema): string {
  const info = (spec.info ?? {}) as JsonSchema;
  const title = escapeHtml(String(info.title ?? 'mockingpug'));
  const version = escapeHtml(String(info.version ?? '0.0.0'));
  const servers = (spec.servers ?? []) as JsonSchema[];
  const serverUrl = String(servers[0]?.url ?? '');
  const schemas = (spec.components as JsonSchema | undefined)?.schemas as Record<string, JsonSchema> | undefined ?? {};
  const tags = ((spec.tags ?? []) as JsonSchema[]).map((t) => String(t.name));
  const paths = (spec.paths ?? {}) as Record<string, JsonSchema>;

  const nav = tags.map((entity) => `<a href="#entity-${escapeHtml(entity)}">${escapeHtml(entity)}</a>`).join('');

  const sections = tags
    .map((entity) => {
      const entityPaths = Object.entries(paths).filter(([path]) => path === `/${entity}` || path.startsWith(`/${entity}/`));
      const operations = entityPaths
        .flatMap(([path, pathItem]) =>
          METHOD_ORDER.filter((m) => m in pathItem).map((method) => operationSection(entity, path, method, pathItem[method] as JsonSchema, serverUrl, schemas)),
        )
        .join('');
      const schemaName = pascalCase(entity);
      return `
        <section id="entity-${escapeHtml(entity)}" class="entity-section">
          <h2>${escapeHtml(entity)}</h2>
          <h4>Schema</h4>
          ${schemaPropertiesTable(schemas[schemaName] ? { $ref: `#/components/schemas/${schemaName}` } : undefined, schemas)}
          ${operations}
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} API docs</title>
<style>
  :root { --border: #E2E2E2; --text: #23272F; --faded: rgba(35,39,47,.55); --bg: #fff; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); display: flex; min-height: 100vh; }
  .mono { font-family: ui-monospace, "SFMono-Regular", "JetBrains Mono", Consolas, monospace; }
  .faded { color: var(--faded); }
  nav { flex: none; width: 240px; border-right: 1px solid var(--border); padding: 24px 16px; position: sticky; top: 0; align-self: flex-start; height: 100vh; overflow: auto; }
  nav h1 { font-size: 16px; margin: 0 0 4px; }
  nav .version { font-size: 12px; color: var(--faded); margin: 0 0 20px; }
  nav a { display: block; padding: 6px 8px; border-radius: 6px; color: var(--text); text-decoration: none; font-size: 14px; font-weight: 600; }
  nav a:hover { background: #F6F6F6; }
  main { flex: 1 1 auto; padding: 32px 40px; max-width: 900px; }
  .entity-section { border-bottom: 1px solid var(--border); padding-bottom: 32px; margin-bottom: 32px; }
  .entity-section h2 { font-size: 22px; text-transform: capitalize; }
  h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--faded); margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--faded); font-weight: 600; }
  .operation { border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .operation-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .method-badge { font-size: 12px; font-weight: 700; border: 1px solid; border-radius: 4px; padding: 2px 8px; }
  .path { font-size: 14px; }
  .summary { color: var(--faded); font-size: 13px; }
  .op-description { font-size: 13px; color: var(--faded); }
  pre.curl { background: #F6F6F6; border-radius: 6px; padding: 12px; overflow: auto; font-size: 12px; }
</style>
</head>
<body>
  <nav>
    <h1>${title}</h1>
    <p class="version">v${version}</p>
    ${nav}
  </nav>
  <main>
    ${sections}
  </main>
</body>
</html>`;
}
