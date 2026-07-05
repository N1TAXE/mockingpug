import { describe, expect, it } from 'vitest';
import { asCommandFailure, fail, ok } from '../../src/cli/commandResult.js';
import { SchemaError } from '../../src/core/index.js';

describe('ok / fail', () => {
  it('ok() defaults to empty messages/warnings', () => {
    expect(ok()).toEqual({ ok: true, messages: [], warnings: [] });
  });

  it('fail() defaults to empty warnings', () => {
    expect(fail(['boom'])).toEqual({ ok: false, messages: ['boom'], warnings: [] });
  });
});

describe('asCommandFailure', () => {
  it('turns a MockingpugError into a fail() result carrying its message', () => {
    const error = new SchemaError('MP-SCHEMA-001', 'bad schema');
    expect(asCommandFailure(error)).toEqual({ ok: false, messages: ['bad schema'], warnings: [] });
  });

  it('rethrows anything that is not a MockingpugError', () => {
    const bug = new TypeError('not a domain error');
    expect(() => asCommandFailure(bug)).toThrow(bug);
  });
});
