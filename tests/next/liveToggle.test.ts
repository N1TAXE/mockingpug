import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { createLiveToggleMiddleware, DEFAULT_LIVE_TOGGLE_COOKIE } from '../../src/next/liveToggle.js';

function requestWithCookie(url: string, cookie?: string): NextRequest {
  const headers = cookie ? { cookie } : undefined;
  return new NextRequest(new Request(url, { headers }));
}

describe('createLiveToggleMiddleware', () => {
  it('passes through (NextResponse.next()) when the cookie is absent', async () => {
    const middleware = createLiveToggleMiddleware({ target: 'https://real.example.com' });
    const res = middleware(requestWithCookie('http://localhost/api/user'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('passes through when the cookie has a value other than "real"', async () => {
    const middleware = createLiveToggleMiddleware({ target: 'https://real.example.com' });
    const res = middleware(requestWithCookie('http://localhost/api/user', `${DEFAULT_LIVE_TOGGLE_COOKIE}=off`));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('passes through when the path is outside baseUrl even if the cookie is "real"', async () => {
    const middleware = createLiveToggleMiddleware({ target: 'https://real.example.com' });
    const res = middleware(requestWithCookie('http://localhost/other/path', `${DEFAULT_LIVE_TOGGLE_COOKIE}=real`));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('rewrites to target, preserving the sub-path and query string, when the cookie is "real"', async () => {
    const middleware = createLiveToggleMiddleware({ target: 'https://real.example.com' });
    const res = middleware(
      requestWithCookie('http://localhost/api/user/1?verbose=1', `${DEFAULT_LIVE_TOGGLE_COOKIE}=real`),
    );
    const rewriteTarget = res.headers.get('x-middleware-rewrite');
    expect(rewriteTarget).toBe('https://real.example.com/user/1?verbose=1');
  });

  it('respects a custom baseUrl and cookieName', async () => {
    const middleware = createLiveToggleMiddleware({
      target: 'https://real.example.com',
      baseUrl: '/backend',
      cookieName: 'custom-cookie',
    });
    const res = middleware(requestWithCookie('http://localhost/backend/user', 'custom-cookie=real'));
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://real.example.com/user');
  });

  it('ignores the default cookie name when a custom cookieName is configured', async () => {
    const middleware = createLiveToggleMiddleware({
      target: 'https://real.example.com',
      cookieName: 'custom-cookie',
    });
    const res = middleware(
      requestWithCookie('http://localhost/api/user', `${DEFAULT_LIVE_TOGGLE_COOKIE}=real`),
    );
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
