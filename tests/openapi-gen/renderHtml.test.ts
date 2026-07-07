import { describe, expect, it } from 'vitest';
import { generateOpenApiSpec } from '../../src/openapi-gen/generate.js';
import { renderDocsHtml } from '../../src/openapi-gen/renderHtml.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { EntitySchema } from '../../src/core/types.js';

const entities: Record<string, EntitySchema> = {
  user: {
    name: 'user',
    file: 'x',
    amount: 1,
    data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } },
  },
};

describe('renderDocsHtml', () => {
  it('renders one nav link and one section per entity', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG, undefined, { title: 'my-app' });
    const html = renderDocsHtml(spec);
    expect(html).toContain('<a href="#entity-user">user</a>');
    expect(html).toContain('<section id="entity-user"');
    expect(html).toContain('<title>my-app API docs</title>');
  });

  it('renders every HTTP method for the entity as its own operation block', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const html = renderDocsHtml(spec);
    expect(html).toContain('>GET</span>');
    expect(html).toContain('>POST</span>');
    expect(html).toContain('>PUT</span>');
    expect(html).toContain('>PATCH</span>');
    expect(html).toContain('>DELETE</span>');
    expect(html).toContain('/user</span>');
    expect(html).toContain('/user/{id}</span>');
  });

  it('renders a curl example for each operation, with a body for a write and none for GET', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const html = renderDocsHtml(spec);
    // Rendered inside a <pre>, so single quotes come out HTML-escaped (&#39;).
    expect(html).toContain('curl -X GET &#39;/api/user&#39;');
    expect(html).toContain("curl -X POST &#39;/api/user&#39; -H &#39;Content-Type: application/json&#39; -d &#39;{}&#39;");
    // {id} path params are substituted with a placeholder so the example is directly runnable.
    expect(html).toContain('curl -X GET &#39;/api/user/1&#39;');
  });

  it('never mentions the devtools sub-API', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const html = renderDocsHtml(spec);
    expect(html).not.toContain('__mockingpug');
  });

  it('escapes an entity/field name so it cannot break out of the HTML it is embedded in', () => {
    const malicious: Record<string, EntitySchema> = {
      user: {
        name: 'user',
        file: 'x',
        amount: 1,
        data: { '<script>alert(1)</script>': { kind: 'lorem' } },
      },
    };
    const spec = generateOpenApiSpec(malicious, DEFAULT_CONFIG);
    const html = renderDocsHtml(spec);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the field table for the entity schema', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const html = renderDocsHtml(spec);
    expect(html).toContain('<td class="mono">id</td>');
    expect(html).toContain('<td class="mono">name</td>');
  });

  it('is valid enough to at least look like a full HTML document', () => {
    const spec = generateOpenApiSpec(entities, DEFAULT_CONFIG);
    const html = renderDocsHtml(spec);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });
});
