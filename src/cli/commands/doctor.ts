import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  expandDataFields,
  stringifyFieldType,
  topologicalOrder,
  validateEntitiesExist,
  validateRoutes,
  validateSchemas,
  expandRoutePaths,
  type Route,
  type CustomDictionaryEntry,
  type EntitySchema,
  type FieldSpec,
  type SchemaSource,
} from '../../core/index.js';
import { MockingpugError } from '../../core/index.js';
import { findOrphanEntities, FileStoreAdapter } from '../../store/index.js';
import { isStoredField, toSchemaMap } from '../../generator/index.js';
import { loadConfig, type LimitsConfig } from '../mockConfig.js';
import { loadProject } from '../schemaLoader.js';
import { asCommandFailure, fail, ok, type CommandResult } from '../commandResult.js';

export interface DoctorOptions {
  /** Promotes every warning (orphan entities, etc.) to a hard failure, meant for CI. */
  strict?: boolean;
  /** Emit all schema issues as JSON on stdout (cloud/CLI parity, via `validateSchemas`). */
  json?: boolean;
  /**
   * Greps a production build output directory for markers that mean the mock
   * layer leaked into the prod bundle (Service Worker
   * script, Route Handler chunk, etc.). Always a hard failure when markers are
   * found, regardless of `strict`.
   */
  assertProdSafe?: string;
}

const PROD_SAFETY_MARKERS = ['mockServiceWorker.js', 'mockingpug/dist/react', 'mockingpug/dist/next', 'mockingpug/dist/native', 'mockingpug/dist/vue'];

function walkArrayCounts(spec: FieldSpec, onArray: (count: number) => void): void {
  if (spec.kind === 'array') {
    onArray(spec.count);
    walkArrayCounts(spec.item, onArray);
  }
}

/** DoS-guard, not just perf: catches a schema with an unreasonably large `amount` or `array[type].N` before it ever runs. */
function checkLimits(entities: Record<string, EntitySchema>, limits: LimitsConfig): string[] {
  const warnings: string[] = [];
  for (const schema of Object.values(entities)) {
    if (schema.amount > limits.maxAmount) {
      warnings.push(
        `entity "${schema.name}" has amount=${schema.amount}, exceeding limits.maxAmount=${limits.maxAmount}. ` +
          `Raise limits.maxAmount in mock.config.js if this is intentional`,
      );
    }
    for (const [fieldName, spec] of Object.entries(schema.data)) {
      walkArrayCounts(spec, (count) => {
        if (count > limits.maxArrayDepth) {
          warnings.push(
            `entity "${schema.name}"'s field "${fieldName}" has array count=${count}, exceeding ` +
              `limits.maxArrayDepth=${limits.maxArrayDepth}. Raise limits.maxArrayDepth in mock.config.js if intentional`,
          );
        }
      });
    }
  }
  return warnings;
}

/** Field kinds whose generated value is always a `string`, used to sanity-check `literal` records. */
const STRING_KINDS = new Set(['uuid', 'username', 'email', 'hash', 'lorem', 'date', 'enumInline', 'slugify']);

/**
 * Warns when an entity needs more records than a fully-`max`-capped custom
 * dictionary can supply — otherwise generation only fails at `mpug generate`,
 * not here. Only fires when *every* entry is capped (one uncapped entry means
 * the dictionary is effectively unbounded).
 */
function checkDictionaryCapacity(
  entities: Record<string, EntitySchema>,
  dictionaries: Record<string, readonly CustomDictionaryEntry[]>,
): string[] {
  const warnings: string[] = [];
  for (const schema of Object.values(entities)) {
    for (const [fieldName, spec] of expandDataFields(schema.data)) {
      if (spec.kind !== 'custom') continue;
      const entries = dictionaries[spec.name];
      if (!entries || entries.length === 0 || !entries.every((e) => typeof e.max === 'number')) continue;
      const capacity = entries.reduce((sum, e) => sum + (e.max ?? 0), 0);
      if (schema.amount > capacity) {
        warnings.push(
          `entity "${schema.name}" generates ${schema.amount} records but dictionary "${spec.name}" (field "${fieldName}") caps out at ${capacity} total (sum of "max") — generation will run out of values`,
        );
      }
    }
  }
  return warnings;
}

/** The JS type a literal record's field is expected to have, or `undefined` if not statically checkable (`custom`, field-level `crossRef`). */
function expectedJsType(spec: FieldSpec): 'string' | 'number' | 'boolean' | 'array' | undefined {
  if (spec.kind === 'number') return 'number';
  if (spec.kind === 'boolean') return 'boolean';
  if (spec.kind === 'array') return 'array';
  if (STRING_KINDS.has(spec.kind)) return 'string';
  // `null` isn't one of the four checkable types this doctor pass models,
  // so a null-valued literal (the common case, `then: null`) is skipped —
  // same "not statically checkable" treatment as `conditional` below.
  if (spec.kind === 'literal' && spec.value !== null) {
    const valueType = typeof spec.value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return valueType;
  }
  return undefined;
}

function matchesJsType(value: unknown, type: 'string' | 'number' | 'boolean' | 'array'): boolean {
  return type === 'array' ? Array.isArray(value) : typeof value === type;
}

/**
 * `literal` records bypass the generator entirely (§ schema-dsl.mdx#literal-records),
 * so they're never checked against the schema's field types the way generated
 * records structurally are. This is the doctor-time substitute: every
 * schema field a record is expected to carry (skipping bare/fieldless
 * `crossRef`, which is never stored) should be present, and where the
 * field's generator kind implies a fixed JS type, the literal value should
 * match it.
 */
function checkLiteralRecords(entities: Record<string, EntitySchema>): string[] {
  const warnings: string[] = [];
  for (const schema of Object.values(entities)) {
    if (!schema.literal || schema.literal.length === 0) continue;
    schema.literal.forEach((record, i) => {
      for (const [fieldName, spec] of expandDataFields(schema.data)) {
        if (!isStoredField(spec)) continue;
        if (!(fieldName in record)) {
          warnings.push(`entity "${schema.name}"'s literal[${i}] is missing required field "${fieldName}"`);
          continue;
        }
        const expected = expectedJsType(spec);
        if (expected !== undefined && !matchesJsType(record[fieldName], expected)) {
          const actual = Array.isArray(record[fieldName]) ? 'array' : typeof record[fieldName];
          warnings.push(
            `entity "${schema.name}"'s literal[${i}].${fieldName} should be a ${expected} (field type "${spec.kind}"), got ${actual}`,
          );
        }
      }
    });
  }
  return warnings;
}

/** Normalizes a URL path for conflict comparison: every param/dynamic segment (`:id`, `[id]`, `[...x]`) becomes `*`. */
function normalizePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') || (seg.startsWith('[') && seg.endsWith(']')) ? '*' : seg))
    .join('/');
}

/** Finds Next.js App Router route handlers under `app/api/**` (or `src/app/api`), returning each one's URL path — skipping the mockingpug catch-all itself. */
async function findNextApiRoutes(projectDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, segments: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), [...segments, entry.name]);
      } else if (/^route\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        // Skip a catch-all ([...x] / [[...x]]) — that's how the mock itself mounts.
        if (segments.some((s) => s.includes('...'))) continue;
        out.push('/api/' + segments.join('/'));
      }
    }
  }
  for (const base of [join(projectDir, 'app', 'api'), join(projectDir, 'src', 'app', 'api')]) {
    await walk(base, []);
  }
  return out;
}

/**
 * Warns when a mock endpoint's path is shadowed by a real App Router route
 * file (Next prefers an explicit `app/api/<path>/route.ts` over the mock
 * catch-all), so the mock is never reached — the `/auth/me` vs next-auth trap.
 */
async function checkHostRouteConflicts(projectDir: string, routes: Route[], baseUrl: string): Promise<string[]> {
  const hostRoutes = await findNextApiRoutes(projectDir);
  if (hostRoutes.length === 0) return [];
  const hostPatterns = new Set(hostRoutes.map(normalizePath));
  const warnings: string[] = [];
  const base = baseUrl.replace(/\/+$/, '');
  for (const { path } of expandRoutePaths(routes)) {
    const full = normalizePath(`${base}${path}`);
    if (hostPatterns.has(full)) {
      warnings.push(`mock route "${path}" is shadowed by a real App Router handler at "${base}${path}" — the mock won't be reached (rename the route or remove the app handler)`);
    }
  }
  return warnings;
}

const TEXT_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.html', '.map'];

/**
 * Best-effort static grep over a production build output directory for
 * markers that mean the mock layer (Service Worker script, or a bundled
 * `mockingpug/dist/react|next` chunk) leaked into it. Not a
 * guarantee against a minified/mangled bundle hiding the reference, but
 * catches the common case of the raw file/import path surviving intact.
 */
async function findProdSafetyLeaks(buildDir: string): Promise<string[]> {
  const found = new Set<string>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (entry.name === 'mockServiceWorker.js') {
        found.add('mockServiceWorker.js');
        continue;
      }
      if (!TEXT_FILE_EXTENSIONS.includes(entry.name.slice(entry.name.lastIndexOf('.')))) {
        continue;
      }
      let content: string;
      try {
        content = await readFile(path, 'utf-8');
      } catch {
        continue;
      }
      for (const marker of PROD_SAFETY_MARKERS) {
        if (content.includes(marker)) {
          found.add(marker);
        }
      }
    }
  }

  await walk(buildDir);
  return [...found];
}

/**
 * `doctor --json`: collect every schema issue via `validateSchemas` (the same
 * function cloud uses) and print them as JSON. Reconstructs the DSL-string
 * schema from the loaded project; conditional/literal object-form fields have
 * no string DSL and are skipped from re-validation (they parsed fine already;
 * full object-form validation is R13).
 */
async function doctorJson(projectDir: string, mockDir: string): Promise<CommandResult> {
  let project;
  try {
    project = await loadProject(projectDir, mockDir);
  } catch (error) {
    // A hard load/parse failure still reports as one JSON issue.
    const issue = error instanceof MockingpugError
      ? { code: error.code, entity: '', message: error.reason, hint: error.hint }
      : { code: 'MP-VALID-000', entity: '', message: (error as Error).message };
    console.log(JSON.stringify([issue], null, 2));
    return { ok: false, messages: [], warnings: [] };
  }

  const source: SchemaSource = { tables: {} };
  for (const [name, entity] of Object.entries(project.entities)) {
    const data: Record<string, string> = {};
    for (const [field, spec] of Object.entries(entity.data)) {
      try {
        data[field] = stringifyFieldType(spec);
      } catch {
        /* conditional/literal object-form field: no string DSL, skip (R13) */
      }
    }
    source.tables[name] = { amount: entity.amount, data, fixtures: entity.fixtures, literal: entity.literal };
  }

  const issues = validateSchemas(source, { knownCustomTypes: Object.keys(project.customDictionaries) });
  const routeIssues = validateRoutes(project.routes, project.entities).map((i) => ({ code: i.code, entity: '', route: i.route, message: i.message }));
  const all = [...issues, ...routeIssues];
  console.log(JSON.stringify(all, null, 2));
  return { ok: all.length === 0, messages: [], warnings: [] };
}

/**
 * Validates the project statically, without touching the store: schema
 * parsing, unknown-type typos, cross-entity reference cycles, and (best
 * effort) orphaned entities left over in a file-backed store.
 */
export async function doctor(projectDir: string, options: DoctorOptions = {}): Promise<CommandResult> {
  const config = await loadConfig(projectDir);

  // --json: emit every issue at once (same data cloud shows), instead of the
  // throw-on-first-error text path. Prints raw JSON to stdout.
  if (options.json) {
    return doctorJson(projectDir, config.dir);
  }

  let project;
  try {
    project = await loadProject(projectDir, config.dir);
  } catch (error) {
    return asCommandFailure(error);
  }

  const fieldsByEntity = toSchemaMap(project.entities);

  try {
    validateEntitiesExist(fieldsByEntity);
    topologicalOrder(fieldsByEntity);
  } catch (error) {
    return asCommandFailure(error);
  }

  // Endpoint definitions must line up with the tables they read (R5 §9).
  // Structural errors, so a hard failure regardless of --strict.
  const routeIssues = validateRoutes(project.routes, project.entities);
  if (routeIssues.length > 0) {
    return fail(
      [`${Object.keys(project.entities).length} entities validated OK`],
      routeIssues.map((issue) => `[${issue.code}] route ${issue.route}: ${issue.message}`),
    );
  }

  const messages = [`${Object.keys(project.entities).length} entities validated OK`, `${project.routes.length} routes validated OK`];
  const warnings: string[] = [
    ...checkLimits(project.entities, config.limits),
    ...checkLiteralRecords(project.entities),
    ...checkDictionaryCapacity(project.entities, project.customDictionaries),
    ...(await checkHostRouteConflicts(projectDir, project.routes, config.baseUrl)),
  ];

  if (options.assertProdSafe !== undefined) {
    const leaks = await findProdSafetyLeaks(options.assertProdSafe);
    if (leaks.length > 0) {
      return fail(messages, [
        ...warnings,
        ...leaks.map((leak) => `mock layer leaked into the production build: found "${leak}"`),
      ]);
    }
    messages.push(`--assert-prod-safe: no mock markers found in ${options.assertProdSafe}`);
  }

  if (config.persist.adapter === 'file') {
    const store = new FileStoreAdapter(join(projectDir, '.mockingpug', 'db'));
    const storedEntities = await store.listEntities();
    const orphans = findOrphanEntities(storedEntities, Object.keys(project.entities));
    for (const orphan of orphans) {
      warnings.push(`entity "${orphan}" exists in the store but has no schema anymore, run "mpug prune"`);
    }
  }

  if (options.strict && warnings.length > 0) {
    return fail(messages, warnings);
  }

  return ok(messages, warnings);
}
