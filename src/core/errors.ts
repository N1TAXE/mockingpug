/**
 * All errors thrown by mockingpug extend {@link MockingpugError} so consumers
 * (and the library itself) can reliably tell "this broke inside mockingpug"
 * apart from application bugs.
 */

export interface ErrorLocation {
  /** Path to the offending file, relative to the project root. */
  file: string;
  /** Dotted path to the offending field/key inside that file, e.g. "data.email". */
  path?: string;
}

export interface MockingpugErrorOptions {
  location?: ErrorLocation;
  /** A short, actionable suggestion, e.g. "did you mean \"email\"?". */
  hint?: string;
  cause?: unknown;
}

export abstract class MockingpugError extends Error {
  abstract readonly code: string;

  readonly location?: ErrorLocation;
  readonly hint?: string;

  constructor(message: string, options: MockingpugErrorOptions = {}) {
    super(MockingpugError.format(message, options));
    this.name = new.target.name;
    this.location = options.location;
    this.hint = options.hint;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  private static format(message: string, options: MockingpugErrorOptions): string {
    const lines = [message];
    if (options.location) {
      const where = options.location.path
        ? `${options.location.file} → ${options.location.path}`
        : options.location.file;
      lines.push(`  at ${where}`);
    }
    if (options.hint) {
      lines.push(`  ${options.hint}`);
    }
    return lines.join('\n');
  }
}

function defineCode(code: string) {
  return code;
}

/** Invalid or malformed schema DSL (unknown generator type, broken JSON, etc). */
export class SchemaError extends MockingpugError {
  readonly code: string;
  constructor(code: string, message: string, options?: MockingpugErrorOptions) {
    super(message, options);
    this.code = defineCode(code);
  }
}

/** Problems in the cross-entity reference graph (`data.*`): unresolvable cycles, unknown entities. */
export class DependencyError extends MockingpugError {
  readonly code: string;
  constructor(code: string, message: string, options?: MockingpugErrorOptions) {
    super(message, options);
    this.code = defineCode(code);
  }
}

/** Failures while actually producing values: a custom generator threw, limits exceeded. */
export class GenerationError extends MockingpugError {
  readonly code: string;
  constructor(code: string, message: string, options?: MockingpugErrorOptions) {
    super(message, options);
    this.code = defineCode(code);
  }
}

/** Persistent-store failures: corrupted cache file, disk write errors. */
export class StoreError extends MockingpugError {
  readonly code: string;
  constructor(code: string, message: string, options?: MockingpugErrorOptions) {
    super(message, options);
    this.code = defineCode(code);
  }
}

/** Invalid `mock.config.js`. */
export class ConfigError extends MockingpugError {
  readonly code: string;
  constructor(code: string, message: string, options?: MockingpugErrorOptions) {
    super(message, options);
    this.code = defineCode(code);
  }
}

/**
 * Expected, request-level failure (bad `body`/`query`, unknown id), not a
 * library bug. Callers should render this as a normal 4xx, not treat it as
 * an internal error.
 */
export class RequestError extends MockingpugError {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400, options?: MockingpugErrorOptions) {
    super(message, options);
    this.code = defineCode(code);
    this.status = status;
  }
}
