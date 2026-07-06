// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_TOGGLE_COOKIE,
  getLiveToggleCookie,
  setLiveToggleCookie,
} from '../../src/next/liveToggleClient.js';

function clearAllCookies(): void {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

describe('setLiveToggleCookie / getLiveToggleCookie', () => {
  afterEach(() => {
    clearAllCookies();
  });

  it('defaults to false when the cookie was never set', () => {
    expect(getLiveToggleCookie()).toBe(false);
  });

  it('setLiveToggleCookie(true) makes getLiveToggleCookie() return true', () => {
    setLiveToggleCookie(true);
    expect(document.cookie).toContain(`${DEFAULT_LIVE_TOGGLE_COOKIE}=real`);
    expect(getLiveToggleCookie()).toBe(true);
  });

  it('setLiveToggleCookie(false) clears a previously set cookie', () => {
    setLiveToggleCookie(true);
    expect(getLiveToggleCookie()).toBe(true);
    setLiveToggleCookie(false);
    expect(getLiveToggleCookie()).toBe(false);
  });

  it('supports a custom cookie name, independent of the default one', () => {
    setLiveToggleCookie(true, { cookieName: 'custom-cookie' });
    expect(getLiveToggleCookie()).toBe(false);
    expect(getLiveToggleCookie({ cookieName: 'custom-cookie' })).toBe(true);
  });
});
