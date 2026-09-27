import { execFile } from 'node:child_process';
import { CloudError, deviceStart, pollToken } from '../cloud/client.js';
import { writeAuthConfig } from '../cloud/config.js';
import { fail, ok, type CommandResult } from '../commandResult.js';

/** Opens `url` in the default browser, best-effort (the user can also copy it manually). */
function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = execFile(command, args);
    child.on('error', () => {});
  } catch {
    /* headless / no opener: the printed URL is the fallback */
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Device-auth: start a device flow, open the verification page (and print the
 * code so the user can confirm it), then poll until the token is granted.
 * Stores the token in user config (never the repo).
 */
export async function login(options: { open?: boolean } = {}): Promise<CommandResult> {
  let device;
  try {
    device = await deviceStart();
  } catch (error) {
    if (error instanceof CloudError) return fail([`login failed: ${error.message}`]);
    throw error;
  }

  console.log(`[mockingpug] To sign in, open:\n  ${device.verificationUriComplete}`);
  console.log(`[mockingpug] and confirm this code: ${device.userCode}`);
  if (options.open !== false) openBrowser(device.verificationUriComplete);

  const deadline = Date.now() + device.expiresIn * 1000;
  const intervalMs = Math.max(1, device.interval) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let poll;
    try {
      poll = await pollToken(device.deviceCode);
    } catch (error) {
      if (error instanceof CloudError) return fail([`login failed: ${error.message}`]);
      throw error;
    }
    if (poll.status === 'expired') return fail(['login code expired — run "mockingpug login" again']);
    if (poll.status === 'granted') {
      await writeAuthConfig({ token: poll.value.token, user: poll.value.user });
      const who = poll.value.user?.email ?? poll.value.user?.name ?? 'your account';
      return ok([`signed in as ${who}`]);
    }
    // pending: keep polling
  }
  return fail(['login timed out — run "mockingpug login" again']);
}
