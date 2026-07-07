// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../../src/shared/clipboard.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom doesn't implement `document.execCommand` at all, so `vi.spyOn` (which requires the property to already exist) can't be used directly. */
function stubExecCommand() {
  const execCommand = vi.fn().mockReturnValue(true);
  (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;
  return execCommand;
}

describe('copyToClipboard', () => {
  it('uses navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyToClipboard('curl -X GET \'http://localhost/api/user/1\'');

    expect(writeText).toHaveBeenCalledWith("curl -X GET 'http://localhost/api/user/1'");
  });

  it('falls back to the execCommand path when navigator.clipboard is absent', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = stubExecCommand();

    await copyToClipboard('fallback text');

    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execCommand = stubExecCommand();

    await copyToClipboard('fallback after rejection');

    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('creates and removes a temporary textarea for the fallback path', async () => {
    vi.stubGlobal('navigator', {});
    stubExecCommand();
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    await copyToClipboard('some text');

    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(document.body.contains(appendSpy.mock.calls[0]![0] as Node)).toBe(false);
  });
});
