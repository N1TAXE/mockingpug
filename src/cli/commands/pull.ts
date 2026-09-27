import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { routeEntity, type Route } from '../../core/index.js';
import { appIdentity } from '../cloud/appIdentity.js';
import { cloudAdvice } from '../cloud/advice.js';
import { CloudError, getProject, pullProject, type PullResponse } from '../cloud/client.js';
import { readLinkFile, resolveToken } from '../cloud/config.js';
import { loadConfig } from '../mockConfig.js';
import { fail, ok, type CommandResult } from '../commandResult.js';

export interface PullOptions {
  /** Overrides the linked project id (CI: `--project`). */
  project?: string;
  /** Pin a published version (`--version N`). */
  version?: number;
  /** Keep syncing while the schema is edited in cloud (`--watch`). */
  watch?: boolean;
  /** Overwrite files that differ locally without asking (`--yes`). */
  yes?: boolean;
  /** Mirror the published version even when this app has an unpublished push waiting (`--force`), discarding what's in the draft. */
  force?: boolean;
}

interface PlannedChange {
  path: string;
  /** Present for writes; absent for a removal. */
  content?: string;
  status: 'new' | 'same' | 'changed' | 'removed';
}

const stringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

async function statusOf(path: string, content: string): Promise<'new' | 'same' | 'changed'> {
  try {
    return (await readFile(path, 'utf-8')) === content ? 'same' : 'changed';
  } catch {
    return 'new';
  }
}

/** Every `*.json` under a directory, recursively (absolute paths). Missing dir → `[]`. */
async function listJsonFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listJsonFiles(full)));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/** Groups routes into `routes/<entity>.json` files (by the table they read; tagless routes go to `routes/_routes.json`). */
function routeFiles(routes: readonly Route[]): Map<string, Route[]> {
  const groups = new Map<string, Route[]>();
  for (const route of routes) {
    const key = routeEntity(route) ?? '_routes';
    groups.set(key, [...(groups.get(key) ?? []), route]);
  }
  return groups;
}

/**
 * Turns a pull response into a 1:1 mirror plan for `mock/tables`, `mock/data`
 * and `mock/routes` (the cloud-owned artifact dirs): every table/dictionary/
 * route group cloud sends is a write, and any local `*.json` in those dirs NOT
 * in that set — plus the whole legacy `mock/api/**` (superseded by `tables/`) —
 * is a removal. `handlers/`, custom generators and `mock.config.js` are never
 * in scope. When cloud omits `routes` entirely (older cloud), `routes/` is left
 * untouched rather than emptied.
 */
/**
 * Rejects a cloud-supplied artifact name that isn't a safe filename segment,
 * so a malicious/compromised response can't write outside `mock/` via a name
 * like `"../../evil"` (path traversal). Mirrors the store adapter's own guard.
 */
function safeName(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new CloudError('CLOUD-REQUEST', `cloud returned an unsafe artifact name "${name}" (only letters, digits, "_" and "-" allowed)`, 400);
  }
  return name;
}

async function planChanges(pull: PullResponse, projectDir: string, mockDir: string): Promise<PlannedChange[]> {
  const root = join(projectDir, mockDir);
  const desired = new Map<string, string>();

  for (const [name, table] of Object.entries(pull.tables)) {
    // v2 tables hold data only; `bypass` now lives on endpoints, so it's dropped here.
    const body: Record<string, unknown> = { amount: table.amount, data: table.data };
    if (table.fixtures !== undefined) body.fixtures = table.fixtures;
    if (table.literal !== undefined) body.literal = table.literal;
    desired.set(join(root, 'tables', `${safeName(name)}.json`), stringify(body));
  }
  for (const [name, value] of Object.entries(pull.dictionaries ?? {})) {
    desired.set(join(root, 'data', `${safeName(name)}.json`), stringify(value));
  }
  if (pull.routes !== undefined) {
    for (const [entity, routes] of routeFiles(pull.routes)) {
      desired.set(join(root, 'routes', `${safeName(entity)}.json`), stringify(routes));
    }
  }

  const changes: PlannedChange[] = [];
  for (const [path, content] of desired) {
    changes.push({ path, content, status: await statusOf(path, content) });
  }

  // Removals: scoped local files not present in the desired set.
  const scopeDirs = [join(root, 'tables'), join(root, 'data'), join(root, 'api')];
  if (pull.routes !== undefined) scopeDirs.push(join(root, 'routes'));
  for (const dir of scopeDirs) {
    for (const path of await listJsonFiles(dir)) {
      if (!desired.has(path)) changes.push({ path, status: 'removed' });
    }
  }
  return changes;
}

async function applyChange(change: PlannedChange): Promise<void> {
  if (change.status === 'removed') {
    await rm(change.path, { force: true });
    return;
  }
  await mkdir(dirname(change.path), { recursive: true });
  await writeFile(change.path, change.content!, 'utf-8');
}

function rel(projectDir: string, path: string): string {
  return path.startsWith(projectDir) ? path.slice(projectDir.length + 1) : path;
}

/** One pull cycle: fetch, plan, gate local edits, write. Returns the result and the version pulled. */
async function pullOnce(
  projectDir: string,
  projectId: string,
  token: string,
  options: PullOptions,
): Promise<{ result: CommandResult; version?: number }> {
  const config = await loadConfig(projectDir);
  const headers = await appIdentity(projectDir);

  let pull: PullResponse;
  try {
    pull = await pullProject(projectId, token, headers, options.version);
  } catch (error) {
    if (error instanceof CloudError) return { result: fail([cloudAdvice(error)]) };
    throw error;
  }

  // A push from this app is waiting to be published: don't clobber the draft's
  // source with the older published version. `--watch` keeps polling until it's
  // published; `--force` mirrors the published version anyway.
  if (pull.pendingPush && !options.force) {
    return {
      result: fail(
        [`v${pull.version}: a push from this app is waiting to be published in the cloud editor`],
        ['nothing written — Publish it there (then pull mirrors it), or re-run with --force to mirror the published version and discard the draft'],
      ),
      version: pull.version,
    };
  }

  let changes: PlannedChange[];
  try {
    changes = await planChanges(pull, projectDir, config.dir);
  } catch (error) {
    if (error instanceof CloudError) return { result: fail([cloudAdvice(error)]), version: pull.version };
    throw error;
  }
  const changed = changes.filter((c) => c.status === 'changed');
  const removed = changes.filter((c) => c.status === 'removed');

  // 1:1 mirror is destructive to local edits and local-only artifacts. Gate
  // both overwrites and removals behind --yes (auto under --watch).
  if ((changed.length > 0 || removed.length > 0) && !options.yes && !options.watch) {
    return {
      result: fail(
        [`v${pull.version}: ${changes.filter((c) => c.status === 'new').length} new, ${changed.length} changed, ${removed.length} to remove`],
        [
          ...changed.map((c) => `would overwrite local changes in ${rel(projectDir, c.path)}`),
          ...removed.map((c) => `would remove ${rel(projectDir, c.path)} (not in cloud)`),
          're-run with --yes to mirror cloud exactly, or reconcile these files first',
        ],
      ),
      version: pull.version,
    };
  }

  const applied = changes.filter((c) => c.status !== 'same');
  for (const change of applied) await applyChange(change);

  const messages = [
    `pulled v${pull.version} of "${pull.project.name}" (published ${pull.publishedAt})`,
    `${applied.filter((c) => c.status !== 'removed').length} file(s) written, ${removed.length} removed, ${changes.length - applied.length} unchanged`,
  ];
  const warnings: string[] = [];
  if (pull.project.seed !== undefined && String(pull.project.seed) !== String(config.seed)) {
    warnings.push(`cloud seed is "${pull.project.seed}" but mock.config.js has "${config.seed}" — update it for identical data`);
  }
  if (pull.routes === undefined && removed.some((c) => c.path.split(/[\\/]/).includes('api'))) {
    warnings.push('legacy mock/api schemas were removed but this cloud version sent no routes — the API will be table-defaults only until cloud publishes routes');
  }
  return { result: ok(messages, warnings), version: pull.version };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Pulls the latest published schema into `mock/`. `--watch` then polls the
 * project's latest version and re-pulls whenever it changes, keeping a running
 * dev server in sync with edits made in cloud.
 */
export async function pull(projectDir: string, options: PullOptions = {}): Promise<CommandResult> {
  const token = await resolveToken();
  if (!token) return fail(['not signed in — run "mockingpug login" (or set MOCKINGPUG_TOKEN)']);

  const projectId = options.project ?? (await readLinkFile(projectDir))?.projectId;
  if (!projectId) return fail(['no linked project — run "mockingpug link <projectId>" (or pass --project)']);

  const first = await pullOnce(projectDir, projectId, token, options);
  if (!options.watch) return first.result;

  // Watch mode: report the first pull, then poll for new versions until interrupted.
  for (const m of first.result.messages) console.log(`[mockingpug] ${m}`);
  console.log('[mockingpug] watching for new versions (Ctrl-C to stop)…');
  let lastVersion = first.version;
  /* v8 ignore start -- long-lived poll loop, not unit-tested */
  for (;;) {
    await sleep(5000);
    try {
      const info = await getProject(projectId, token);
      if (info.latestVersion !== null && info.latestVersion !== lastVersion) {
        const next = await pullOnce(projectDir, projectId, token, { ...options, yes: true });
        for (const m of next.result.messages) console.log(`[mockingpug] ${m}`);
        lastVersion = next.version;
      }
    } catch (error) {
      if (error instanceof CloudError) console.warn(`[mockingpug] watch: ${cloudAdvice(error)}`);
      else throw error;
    }
  }
  /* v8 ignore stop */
}
