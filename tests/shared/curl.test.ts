import { describe, expect, it } from 'vitest';
import { buildCurlCommand } from '../../src/shared/curl.js';

describe('buildCurlCommand', () => {
  it('builds a bare GET with no body', () => {
    expect(buildCurlCommand('GET', 'http://localhost:3000/api/user/1')).toBe(
      "curl -X GET 'http://localhost:3000/api/user/1'",
    );
  });

  it('adds a JSON Content-Type header and -d payload when a body is given', () => {
    expect(buildCurlCommand('POST', 'http://localhost:3000/api/user', { name: 'Alice' })).toBe(
      `curl -X POST 'http://localhost:3000/api/user' -H 'Content-Type: application/json' -d '{"name":"Alice"}'`,
    );
  });

  it('escapes single quotes inside the URL', () => {
    expect(buildCurlCommand('GET', "http://localhost:3000/api/user?q=O'Brien")).toBe(
      "curl -X GET 'http://localhost:3000/api/user?q=O'\\''Brien'",
    );
  });

  it('escapes single quotes inside the JSON body', () => {
    const command = buildCurlCommand('POST', 'http://localhost:3000/api/user', { name: "O'Brien" });
    expect(command).toContain(`-d '{"name":"O'\\''Brien"}'`);
  });

  it('omits the body/header entirely when body is undefined, even for a non-GET method', () => {
    expect(buildCurlCommand('DELETE', 'http://localhost:3000/api/user/1')).toBe(
      "curl -X DELETE 'http://localhost:3000/api/user/1'",
    );
  });
});
