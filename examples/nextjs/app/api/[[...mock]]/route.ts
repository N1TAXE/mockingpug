import { createNextRouteHandlers } from 'mockingpug/next';

// Re-fetches the mock context per request (process-memoized, rebuilt only when
// the file watcher sees a change under mock/**), so `mpug pull` and schema edits
// are picked up by a live `next dev` without a restart.
export const { GET, POST, PUT, PATCH, DELETE } = createNextRouteHandlers();
