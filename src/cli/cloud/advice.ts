import { CloudError } from './client.js';

/** Maps a cloud error code to an actionable CLI message. */
export function cloudAdvice(error: CloudError): string {
  switch (error.code) {
    case 'CLOUD-AUTH':
      return `not authorized: ${error.message} — run "mockingpug login" (or check MOCKINGPUG_TOKEN)`;
    case 'CLOUD-PROJECT':
      return `project not found: ${error.message}`;
    case 'CLOUD-VERSION':
      return `version unavailable: ${error.message}`;
    case 'CLOUD-LIMIT':
      // A repo cloned over ssh vs https (or with/without a trailing `.git`) used
      // to count as separate apps against the free limit — fixed in this version
      // (R28); older local copies keep their old app-id until their next pull.
      return `connected-apps limit reached: ${error.message} — upgrade, unlink an app, or (if a repo is double-counted from different clone URLs) update mockingpug and re-run`;
    case 'CLOUD-NETWORK':
      return `${error.message} — check your connection, or set MOCKINGPUG_URL for a self-hosted/local instance`;
    case 'CLOUD-BUSY':
      return `project is being edited: ${error.message} — close the cloud editor and retry`;
    case 'CLOUD-CONFLICT': {
      // The push would overwrite tables/endpoints edited but not published in the
      // cloud. Server lists them in `conflicts`; offer the two ways forward (R30).
      const list = error.conflicts?.length ? `\n  ${error.conflicts.join('\n  ')}` : '';
      return `push conflicts with unpublished cloud edits: ${error.message}${list}\n  → Publish (or discard) those in the cloud editor, then "mockingpug pull"\n  → or re-run with "--force" to overwrite them`;
    }
    case 'CLOUD-FORBIDDEN':
      // The push-permission text is set by the project owner and comes from the
      // server; print it as-is, then a hint (R30/R31).
      return `not allowed: ${error.message} — a CI token can only pull; for a read-only member use "mockingpug link --no-push" and "pull"`;
    default:
      return error.message;
  }
}
