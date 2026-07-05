import { MockingpugError } from '../core/index.js';

/**
 * Structured result every CLI command returns instead of writing to the
 * console directly. Keeps commands testable without capturing stdout, and
 * lets `bin.ts` be the single place that decides how to print/exit.
 */
export interface CommandResult {
  ok: boolean;
  messages: string[];
  warnings: string[];
}

export function ok(messages: string[] = [], warnings: string[] = []): CommandResult {
  return { ok: true, messages, warnings };
}

export function fail(messages: string[], warnings: string[] = []): CommandResult {
  return { ok: false, messages, warnings };
}

/**
 * Turns a caught error into a `fail()` result if it's a recognized
 * mockingpug domain error (bad schema/config/dependency graph). Anything
 * else is a genuine bug, not a user-facing failure, so it's rethrown to
 * surface with its full stack trace. Use as
 * `catch (error) { return asCommandFailure(error); }`.
 */
export function asCommandFailure(error: unknown): CommandResult {
  if (error instanceof MockingpugError) return fail([error.message]);
  throw error;
}
