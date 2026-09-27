import { cloudBaseUrl } from './config.js';
import type { Route } from '../../core/index.js';

/** A cloud-side failure, carrying the server's `error.code` so the CLI can map it to advice. */
export class CloudError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.status = status;
  }
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface TokenGranted {
  token: string;
  user: { name?: string; email?: string };
}

export interface ProjectInfo {
  id: string;
  name: string;
  latestVersion: number | null;
  /** Cloud editor (canvas) URL, for link/push messages. */
  url?: string;
  /** True when the draft has no tables and no published versions — used by `link` to phrase its message. */
  empty?: boolean;
}

/** The local `mock/` snapshot uploaded by `push`, in the same shape `pull` returns. */
export interface PushPayload {
  tables: Record<string, unknown>;
  routes: unknown[];
  dictionaries: Record<string, unknown>;
  seed?: string | number;
}

export interface PushResponse {
  project: { id: string; name: string; url?: string };
  draft?: { summary?: string; changes?: unknown; issues?: number };
  seed?: { cloud?: string | number; local?: string | number; applied?: boolean };
}

export interface PullResponse {
  project: { id: string; name: string; seed?: string | number };
  version: number;
  publishedAt: string;
  tables: Record<string, { amount: number; data: Record<string, unknown>; fixtures?: unknown; literal?: unknown; bypass?: boolean }>;
  dictionaries?: Record<string, unknown>;
  /** v2 endpoint definitions. Absent = older cloud that only stores tables (pull then leaves `routes/` untouched); `[]` = a project with zero routes (mirrored, so local `routes/` is emptied). */
  routes?: Route[];
  /** This app pushed after the last published version — pull holds off (nothing written) until Publish, unless `--force`. Always `false` for a pinned `?version=N`. */
  pendingPush?: boolean;
}

/** Poll outcome for the device-auth token endpoint. */
export type TokenPoll = { status: 'granted'; value: TokenGranted } | { status: 'pending' } | { status: 'expired' };

async function parseError(res: Response): Promise<CloudError> {
  let code = 'CLOUD-REQUEST';
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    /* non-JSON error body: keep the status line */
  }
  return new CloudError(code, message, res.status);
}

export interface RequestInit_ {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

async function request(path: string, init: RequestInit_ = {}): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const url = `${cloudBaseUrl()}${path}`;
  try {
    return await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    // A transport-level failure (DNS/offline/refused) isn't an internal bug —
    // surface it as a clean CloudError so commands print advice, not a stack.
    throw new CloudError('CLOUD-NETWORK', `could not reach the cloud at ${cloudBaseUrl()} (${(error as Error).message})`, 0);
  }
}

/** POST /api/cli/device — begins device-auth. */
export async function deviceStart(): Promise<DeviceStart> {
  const res = await request('/api/cli/device', { method: 'POST' });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as DeviceStart;
}

/** POST /api/cli/token — 200 granted · 428 pending · 410 expired. */
export async function pollToken(deviceCode: string): Promise<TokenPoll> {
  const res = await request('/api/cli/token', { method: 'POST', body: { deviceCode } });
  if (res.status === 200) return { status: 'granted', value: (await res.json()) as TokenGranted };
  if (res.status === 428) return { status: 'pending' };
  if (res.status === 410) return { status: 'expired' };
  throw await parseError(res);
}

/** GET /api/cli/projects/:id — used by `link`. */
export async function getProject(id: string, token: string): Promise<ProjectInfo> {
  const res = await request(`/api/cli/projects/${encodeURIComponent(id)}`, { token });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ProjectInfo;
}

/** GET /api/cli/projects/:id/pull[?version=N] — the published schema for `pull`. */
export async function pullProject(
  id: string,
  token: string,
  headers: Record<string, string>,
  version?: number,
): Promise<PullResponse> {
  const query = version !== undefined ? `?version=${version}` : '';
  const res = await request(`/api/cli/projects/${encodeURIComponent(id)}/pull${query}`, { token, headers });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as PullResponse;
}

/** POST /api/cli/projects/:id/push — uploads the local snapshot; cloud merges it into the project's draft (no publish). */
export async function pushProject(
  id: string,
  token: string,
  headers: Record<string, string>,
  payload: PushPayload,
): Promise<PushResponse> {
  const res = await request(`/api/cli/projects/${encodeURIComponent(id)}/push`, { method: 'POST', token, headers, body: payload });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as PushResponse;
}
