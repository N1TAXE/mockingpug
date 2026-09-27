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
      return `connected-apps limit reached: ${error.message} — upgrade or unlink an app`;
    case 'CLOUD-NETWORK':
      return `${error.message} — check your connection, or set MOCKINGPUG_URL for a self-hosted/local instance`;
    case 'CLOUD-BUSY':
      return `project is being edited: ${error.message} — close the cloud editor and retry`;
    case 'CLOUD-FORBIDDEN':
      return `not allowed: ${error.message} — push needs a personal token with "edit schema" (a CI token can only pull)`;
    default:
      return error.message;
  }
}
