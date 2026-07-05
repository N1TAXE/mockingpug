import { describe, expect, it } from 'vitest';
import {
  SchemaError,
  RequestError,
  MockingpugError,
  DependencyError,
  GenerationError,
  StoreError,
  ConfigError,
} from '../../src/core/errors.js';

describe('MockingpugError formatting', () => {
  it('includes the code, location and hint in the message', () => {
    const error = new SchemaError(
      'MP-SCHEMA-001',
      'unknown generator type "emial[gmail.com]"',
      {
        location: { file: 'mock/api/user/schema.json', path: 'data.email' },
        hint: 'did you mean "email[gmail.com]"?',
      },
    );
    expect(error.message).toContain('unknown generator type "emial[gmail.com]"');
    expect(error.message).toContain('at mock/api/user/schema.json → data.email');
    expect(error.message).toContain('did you mean "email[gmail.com]"?');
    expect(error.code).toBe('MP-SCHEMA-001');
  });

  it('is an instance of both its subclass and the shared MockingpugError base', () => {
    const error = new SchemaError('MP-SCHEMA-001', 'boom');
    expect(error).toBeInstanceOf(SchemaError);
    expect(error).toBeInstanceOf(MockingpugError);
    expect(error).toBeInstanceOf(Error);
  });

  it('RequestError carries an HTTP status distinct from internal errors', () => {
    const error = new RequestError('MP-REQ-001', 'unknown id', 404);
    expect(error.status).toBe(404);
    expect(error).toBeInstanceOf(MockingpugError);
  });

  it('omits location/hint lines when not provided', () => {
    const error = new SchemaError('MP-SCHEMA-002', 'plain message');
    expect(error.message).toBe('plain message');
  });

  it('every subclass carries its own code and extends MockingpugError', () => {
    const cases: MockingpugError[] = [
      new DependencyError('MP-DEP-001', 'cycle'),
      new GenerationError('MP-GEN-001', 'boom'),
      new StoreError('MP-STORE-001', 'corrupt'),
      new ConfigError('MP-CONFIG-001', 'bad config'),
    ];
    for (const error of cases) {
      expect(error).toBeInstanceOf(MockingpugError);
      expect(error.code).toMatch(/^MP-/);
    }
  });

  it('preserves the original error via cause', () => {
    const original = new Error('disk full');
    const error = new StoreError('MP-STORE-002', 'write failed', { cause: original });
    expect(error.cause).toBe(original);
  });
});
