import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Default cloud host; overridable for self-host / staging via `MOCKINGPUG_URL`. */
const DEFAULT_URL = 'https://app.mockingpug.com';

/** Where the device-auth token lives: user config, never the repo. `MOCKINGPUG_CONFIG_HOME` relocates it (tests, XDG-style setups). */
export function authConfigPath(): string {
  const base = process.env.MOCKINGPUG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'mockingpug', 'auth.json');
}

/** The repo-committed link between this folder and a cloud project. */
export function linkFilePath(projectDir: string): string {
  return join(projectDir, '.mockingpug', 'project.json');
}

export interface AuthConfig {
  token: string;
  user?: { name?: string; email?: string };
}

export interface LinkFile {
  projectId: string;
}

/** Base cloud URL, without a trailing slash. `MOCKINGPUG_URL` wins for self-host/staging/tests. */
export function cloudBaseUrl(): string {
  return (process.env.MOCKINGPUG_URL || DEFAULT_URL).replace(/\/+$/, '');
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

export async function readAuthConfig(): Promise<AuthConfig | undefined> {
  return readJson<AuthConfig>(authConfigPath());
}

export async function writeAuthConfig(config: AuthConfig): Promise<void> {
  const path = authConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

/**
 * The bearer token for cloud calls: `MOCKINGPUG_TOKEN` (CI, `mp_ci_…`) wins
 * over the device-auth token in user config (`mp_cli_…`). `undefined` when
 * neither is set — callers tell the user to run `mockingpug login`.
 */
export async function resolveToken(): Promise<string | undefined> {
  const ci = process.env.MOCKINGPUG_TOKEN?.trim();
  if (ci) return ci;
  return (await readAuthConfig())?.token;
}

export async function readLinkFile(projectDir: string): Promise<LinkFile | undefined> {
  return readJson<LinkFile>(linkFilePath(projectDir));
}

export async function writeLinkFile(projectDir: string, link: LinkFile): Promise<void> {
  const path = linkFilePath(projectDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(link, null, 2)}\n`, 'utf-8');
}
