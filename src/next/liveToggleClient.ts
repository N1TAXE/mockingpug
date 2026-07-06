import { DEFAULT_LIVE_TOGGLE_COOKIE, LIVE_TOGGLE_COOKIE_VALUE } from './liveToggleConstants.js';

export { DEFAULT_LIVE_TOGGLE_COOKIE };

export interface SetLiveToggleCookieOptions {
  /** Must match `createLiveToggleMiddleware()`'s `cookieName`. Defaults to `"mockingpug-live"`. */
  cookieName?: string;
}

/**
 * Sets or clears the cookie `createLiveToggleMiddleware()` (from
 * `mockingpug/next`) reads, from client-side code (a button in your own UI,
 * see `next/README.md`). Setting `enabled: true` makes matching requests hit
 * the real backend on their very next request, no restart or rebuild;
 * `false` clears it, falling back to the mock again.
 *
 * A plain first-party, same-origin cookie: no server round-trip needed to
 * flip it, `document.cookie` is enough, and `middleware.ts` reads it on the
 * next navigation/request.
 */
export function setLiveToggleCookie(enabled: boolean, options: SetLiveToggleCookieOptions = {}): void {
  const cookieName = options.cookieName ?? DEFAULT_LIVE_TOGGLE_COOKIE;
  document.cookie = enabled
    ? `${cookieName}=${LIVE_TOGGLE_COOKIE_VALUE}; path=/; SameSite=Lax`
    : `${cookieName}=; path=/; SameSite=Lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** Reads the current toggle state from `document.cookie`, e.g. to initialize a checkbox's default value. */
export function getLiveToggleCookie(options: SetLiveToggleCookieOptions = {}): boolean {
  const cookieName = options.cookieName ?? DEFAULT_LIVE_TOGGLE_COOKIE;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${cookieName}=`));
  return match?.slice(cookieName.length + 1) === LIVE_TOGGLE_COOKIE_VALUE;
}
