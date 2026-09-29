import { spawn } from 'node:child_process';
import { cloudBaseUrl, readLinkFile } from '../cloud/config.js';
import { asCommandFailure, fail, ok, type CommandResult } from '../commandResult.js';

/**
 * Cloud project tabs `mpug open` can deep-link to. The path segment equals the
 * tab name; the bare project page is the default. Keep in sync with the URL
 * scheme in `mockingpug-app` (see R24 handoff).
 */
const TABS = ['schema', 'api', 'data'] as const;
type Tab = (typeof TABS)[number];

/** Opens a URL in the user's default browser, cross-platform, without a dependency. */
function launchBrowser(url: string): void {
  const platform = process.platform;
  const [cmd, args] =
    platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  // Detached + unref so the CLI can exit without waiting on the browser.
  const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
  child.on('error', () => {
    /* best-effort: the URL is always printed, so the user can open it manually */
  });
  child.unref();
}

export interface OpenOptions {
  /** Injectable opener for tests; defaults to the real browser launcher. */
  open?: (url: string) => void;
}

/**
 * Opens the linked cloud project (or one of its tabs) in the browser.
 * Reads the project id from `.mockingpug/project.json`; the URL always goes to
 * stdout too, so it works even where no browser can be launched (CI, SSH).
 */
export async function open(projectDir: string, tab: string | undefined, options: OpenOptions = {}): Promise<CommandResult> {
  try {
    if (tab !== undefined && !TABS.includes(tab as Tab)) {
      return fail([`unknown tab "${tab}" — use one of: ${TABS.join(', ')} (or omit for the project page)`]);
    }

    const link = await readLinkFile(projectDir);
    if (!link) {
      return fail(['this folder is not linked to a cloud project — run "mockingpug link <projectId>" first']);
    }

    const base = `${cloudBaseUrl()}/p/${link.projectId}`;
    const url = tab ? `${base}/${tab}` : base;

    (options.open ?? launchBrowser)(url);
    return ok([`opening ${url}`]);
  } catch (error) {
    return asCommandFailure(error);
  }
}
