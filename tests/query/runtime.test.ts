import { describe, expect, it, vi } from 'vitest';
import { OneShotOverrides } from '../../src/query/oneShotOverride.js';
import { isRuntimeBypassRequested, simulateRuntime, simulateRuntimeForEntity } from '../../src/query/runtime.js';
import type { QueryContext } from '../../src/query/resolver.js';

describe('simulateRuntime', () => {
  it('resolves immediately and does not throw with default (zero) runtime config', async () => {
    await expect(simulateRuntime()).resolves.toBeUndefined();
  });

  it('resolves without throwing when both delay and errorRate are 0', async () => {
    await expect(simulateRuntime({ delay: 0, errorRate: 0 })).resolves.toBeUndefined();
  });

  it('always throws when errorRate is 1', async () => {
    await expect(simulateRuntime({ delay: 0, errorRate: 1 })).rejects.toThrow(/runtime.errorRate/);
  });

  it('never throws when errorRate is 0, regardless of Math.random', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await expect(simulateRuntime({ delay: 0, errorRate: 0 })).resolves.toBeUndefined();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('waits at least the configured delay before resolving', async () => {
    vi.useFakeTimers();
    try {
      let resolved = false;
      const promise = simulateRuntime({ delay: 100, errorRate: 0 }).then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(50);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(50);
      await promise;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('simulateRuntimeForEntity', () => {
  function makeCtx(overrides?: OneShotOverrides): QueryContext {
    return {
      schemas: {},
      store: undefined as never,
      pagination: undefined as never,
      seed: 's',
      runtime: { delay: 0, errorRate: 0 },
      oneShotOverrides: overrides,
    };
  }

  it('falls back to plain simulateRuntime() when nothing is armed', async () => {
    const ctx = makeCtx(new OneShotOverrides());
    ctx.runtime = { delay: 0, errorRate: 1 };
    await expect(simulateRuntimeForEntity(ctx, 'user')).rejects.toThrow(/runtime.errorRate/);
  });

  it('falls back to plain simulateRuntime() when ctx.oneShotOverrides is unset', async () => {
    const ctx = makeCtx(undefined);
    await expect(simulateRuntimeForEntity(ctx, 'user')).resolves.toBeUndefined();
  });

  it('a "fail next" override throws, even when runtime.errorRate is 0', async () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', { failNext: true });
    const ctx = makeCtx(overrides);
    await expect(simulateRuntimeForEntity(ctx, 'user')).rejects.toThrow(/one-shot "fail next"/);
  });

  it('is consumed: a second call after a "fail next" override falls back to global settings', async () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', { failNext: true });
    const ctx = makeCtx(overrides);
    await expect(simulateRuntimeForEntity(ctx, 'user')).rejects.toThrow();
    await expect(simulateRuntimeForEntity(ctx, 'user')).resolves.toBeUndefined();
  });

  it('a "delay next" override replaces (not adds to) runtime.delay', async () => {
    vi.useFakeTimers();
    try {
      const overrides = new OneShotOverrides();
      overrides.set('user', { delayNext: 100 });
      const ctx = makeCtx(overrides);
      ctx.runtime = { delay: 9999, errorRate: 0 };

      let resolved = false;
      const promise = simulateRuntimeForEntity(ctx, 'user').then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(100);
      await promise;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only affects the armed entity, not others", async () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', { failNext: true });
    const ctx = makeCtx(overrides);
    await expect(simulateRuntimeForEntity(ctx, 'blogpost')).resolves.toBeUndefined();
    // The "user" override is still armed, since only "blogpost" was checked above.
    await expect(simulateRuntimeForEntity(ctx, 'user')).rejects.toThrow();
  });

  it('an empty override object ({}) behaves the same as no override', async () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', {});
    const ctx = makeCtx(overrides);
    ctx.runtime = { delay: 0, errorRate: 1 };
    await expect(simulateRuntimeForEntity(ctx, 'user')).rejects.toThrow(/runtime.errorRate/);
  });

  it('?mpug-bypass=1 skips runtime.errorRate: 1 entirely', async () => {
    const ctx = makeCtx(new OneShotOverrides());
    ctx.runtime = { delay: 0, errorRate: 1 };
    const request = new Request('https://example.com/api/user?mpug-bypass=1');
    await expect(simulateRuntimeForEntity(ctx, 'user', request)).resolves.toBeUndefined();
  });

  it('X-Mockingpug-Bypass: 1 header skips runtime.errorRate: 1 entirely', async () => {
    const ctx = makeCtx(new OneShotOverrides());
    ctx.runtime = { delay: 0, errorRate: 1 };
    const request = new Request('https://example.com/api/user', { headers: { 'X-Mockingpug-Bypass': '1' } });
    await expect(simulateRuntimeForEntity(ctx, 'user', request)).resolves.toBeUndefined();
  });

  it('bypass also skips an armed one-shot "fail next" override, and does not consume it', async () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', { failNext: true });
    const ctx = makeCtx(overrides);
    const bypassed = new Request('https://example.com/api/user?mpug-bypass=1');
    await expect(simulateRuntimeForEntity(ctx, 'user', bypassed)).resolves.toBeUndefined();
    // The override is still armed for the next, non-bypassed request.
    await expect(simulateRuntimeForEntity(ctx, 'user')).rejects.toThrow(/one-shot "fail next"/);
  });

  it('a request without the bypass param/header is unaffected', async () => {
    const ctx = makeCtx(new OneShotOverrides());
    ctx.runtime = { delay: 0, errorRate: 1 };
    const request = new Request('https://example.com/api/user?mpug-bypass=0');
    await expect(simulateRuntimeForEntity(ctx, 'user', request)).rejects.toThrow(/runtime.errorRate/);
  });
});

describe('isRuntimeBypassRequested', () => {
  it('is true for ?mpug-bypass=1', () => {
    expect(isRuntimeBypassRequested(new Request('https://example.com/api/user?mpug-bypass=1'))).toBe(true);
  });

  it('is true for an X-Mockingpug-Bypass: 1 header', () => {
    expect(isRuntimeBypassRequested(new Request('https://example.com/api/user', { headers: { 'X-Mockingpug-Bypass': '1' } }))).toBe(
      true,
    );
  });

  it('is false with neither the param nor the header', () => {
    expect(isRuntimeBypassRequested(new Request('https://example.com/api/user'))).toBe(false);
  });

  it('is false for any value other than exactly "1"', () => {
    expect(isRuntimeBypassRequested(new Request('https://example.com/api/user?mpug-bypass=true'))).toBe(false);
    expect(
      isRuntimeBypassRequested(new Request('https://example.com/api/user', { headers: { 'X-Mockingpug-Bypass': 'true' } })),
    ).toBe(false);
  });
});
