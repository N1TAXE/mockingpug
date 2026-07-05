import { describe, expect, it, vi } from 'vitest';
import { simulateRuntime } from '../../src/query/runtime.js';

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
