/**
 * Copies `text` to the clipboard. Prefers the async Clipboard API; falls
 * back to a hidden, selected `<textarea>` + `document.execCommand('copy')`
 * when it's unavailable or rejects (e.g. an insecure context, or a browser
 * that never got the permission prompt) — a devtools panel can run in
 * either situation depending on how the host app is served locally.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy fallback below.
    }
  }
  if (typeof document === 'undefined') return;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}
