import { http, passthrough, type RequestHandler } from 'msw';
import {
  buildListResponse,
  createRecord,
  deleteRecord,
  errorResponse,
  getRecordById,
  jsonResponse,
  listRecords,
  readJsonBody,
  simulateRuntime,
  updateRecord,
  type QueryContext,
} from '../query/index.js';
import { isRuntimeBypassed } from './bypassState.js';

function joinUrl(baseUrl: string, ...segments: string[]): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  return [trimmedBase, ...segments].join('/');
}

/**
 * Generates one MSW `RequestHandler[]` per entity in `ctx.schemas`: GET
 * (list, with pagination), GET/:id, POST, PUT, PATCH, DELETE/:id, all
 * backed by the same `query` resolver (and the same Response-shaping
 * helpers) any transport uses, e.g. `mockingpug/next`'s Route Handlers.
 */
export function createMockHandlers(ctx: QueryContext, baseUrl: string): RequestHandler[] {
  const handlers: RequestHandler[] = [];

  for (const entity of Object.keys(ctx.schemas)) {
    const collectionUrl = joinUrl(baseUrl, entity);
    const itemUrl = joinUrl(baseUrl, entity, ':id');

    // Bypassed entities (schema-level `bypass: true`, or a runtime
    // `mockingpug.bypass('entity')` call) let the real backend answer
    // instead. Checked per-request since the runtime half is
    // mutable while the worker is already running.
    function isBypassed(): boolean {
      return ctx.schemas[entity]?.bypass === true || isRuntimeBypassed(entity);
    }

    handlers.push(
      http.get(collectionUrl, async ({ request }) => {
        if (isBypassed()) return passthrough();
        try {
          await simulateRuntime(ctx.runtime);
          const url = new URL(request.url);
          const { data, meta } = await listRecords(entity, url.searchParams, ctx);
          return buildListResponse(data, meta, ctx.pagination.strategy !== false && ctx.pagination.envelope);
        } catch (error) {
          return errorResponse(error);
        }
      }),
    );

    handlers.push(
      http.get(itemUrl, async ({ params }) => {
        if (isBypassed()) return passthrough();
        try {
          await simulateRuntime(ctx.runtime);
          return jsonResponse(await getRecordById(entity, String(params.id), ctx));
        } catch (error) {
          return errorResponse(error);
        }
      }),
    );

    handlers.push(
      http.post(collectionUrl, async ({ request }) => {
        if (isBypassed()) return passthrough();
        try {
          await simulateRuntime(ctx.runtime);
          const created = await createRecord(entity, await readJsonBody(request), ctx);
          return jsonResponse(created, { status: 201 });
        } catch (error) {
          return errorResponse(error);
        }
      }),
    );

    for (const method of ['put', 'patch'] as const) {
      handlers.push(
        http[method](itemUrl, async ({ request, params }) => {
          if (isBypassed()) return passthrough();
          try {
            await simulateRuntime(ctx.runtime);
            const updated = await updateRecord(entity, String(params.id), await readJsonBody(request), ctx);
            return jsonResponse(updated);
          } catch (error) {
            return errorResponse(error);
          }
        }),
      );
    }

    handlers.push(
      http.delete(itemUrl, async ({ params }) => {
        if (isBypassed()) return passthrough();
        try {
          await simulateRuntime(ctx.runtime);
          await deleteRecord(entity, String(params.id), ctx);
          return new Response(null, { status: 204 });
        } catch (error) {
          return errorResponse(error);
        }
      }),
    );
  }

  return handlers;
}
