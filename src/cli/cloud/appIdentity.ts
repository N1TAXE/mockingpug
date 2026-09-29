import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Headers every `pull` sends so the server can list connected apps and count
 * them per repo (the free-tier "3 apps" limit is keyed on `App-Id`). See
 * PACKAGE-REQUIREMENTS.md R6.
 */
export interface AppIdentity {
  [header: string]: string;
  /** Stable per-repo id: sha256 of the git `origin` URL, else of the abs project path. */
  'X-Mockingpug-App-Id': string;
  'X-Mockingpug-App-Name': string;
  'X-Mockingpug-Framework': string;
}

/**
 * Normalizes a git origin URL to a stable `host/owner/repo`, so the same repo
 * cloned over ssh/https (or with a trailing `.git`, a login/token, or a port)
 * hashes to ONE App-Id. Scheme, userinfo, port, trailing `.git`/`/` are dropped
 * and the host is lower-cased; the path is left as-is, since owner/repo case is
 * significant on GitLab and self-hosted forges (R28).
 */
export function normalizeOrigin(raw: string): string {
  let url = raw.trim();
  // scp-like syntax: git@host:owner/repo(.git) — has no `//` after a scheme.
  const scp = /^[^/@]+@([^:/]+):(.+)$/.exec(url);
  if (scp) {
    url = `${scp[1]}/${scp[2]}`;
  } else {
    url = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ''); // strip scheme://
    url = url.replace(/^[^@/]+@/, ''); // strip user[:token]@
  }
  const slash = url.indexOf('/');
  const host = (slash === -1 ? url : url.slice(0, slash)).replace(/:\d+$/, '').toLowerCase();
  const path = (slash === -1 ? '' : url.slice(slash + 1)).replace(/\/+$/, '').replace(/\.git$/, '');
  return path ? `${host}/${path}` : host;
}

async function gitOrigin(projectDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['config', '--get', 'remote.origin.url'], { cwd: projectDir });
    const url = stdout.trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort framework tag from package.json deps, for the connected-apps list. */
async function detectFramework(projectDir: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return 'next';
    if (deps.vite) return 'vite';
    if (deps['react-scripts']) return 'cra';
    if (deps.react) return 'react';
    if (deps.vue || deps.nuxt) return 'vue';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function appIdentity(projectDir: string): Promise<AppIdentity> {
  const origin = await gitOrigin(projectDir);
  const idSource = origin ? normalizeOrigin(origin) : projectDir;
  const appId = createHash('sha256').update(idSource).digest('hex');
  // Name: repo name from the origin URL if present, else the folder name.
  const name = origin ? basename(origin.replace(/\.git$/, '')) || basename(projectDir) : basename(projectDir);
  return {
    'X-Mockingpug-App-Id': appId,
    'X-Mockingpug-App-Name': name,
    'X-Mockingpug-Framework': await detectFramework(projectDir),
  };
}
