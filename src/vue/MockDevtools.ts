// mockingpug/vue/client — the Vue devtools panel. A thin Vue wrapper around the
// framework-agnostic `mountDevtoolsPanel` core (the same UI React's
// `<MockDevtools>` uses): same floating panel, mock-data browser, request log,
// per-request/entity bypass, one-shot fail/delay and snapshot import/export.
// Dev-only — never ship it to production (doctor's `mockingpug/dist/vue`
// prod-safety marker covers this entry too).
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { generateAll } from '../generator/index.js';
import { exportSnapshot, importSnapshot, updateRecord, type QueryContext } from '../query/index.js';
import { generateOpenApiSpec } from '../openapi-gen/generate.js';
import { renderDocsHtml } from '../openapi-gen/renderHtml.js';
import { buildCurlCommand } from '../shared/curl.js';
import { copyToClipboard } from '../shared/clipboard.js';
import { bypass, isRuntimeBypassed, unbypass } from '../react/bypassState.js';
import { createRuntimeController } from '../devtools-core/index.js';
import { mountDevtoolsPanel, type DevtoolsPanelProps } from '../shared/devtoolsPanel.js';

export const MockDevtools = defineComponent({
  name: 'MockDevtools',
  props: {
    /** The same `QueryContext` passed to `setupMockWorker(ctx)`. */
    ctx: { type: Object as () => QueryContext, required: true },
    /** Must match the `baseUrl` given to `setupMockWorker`; only used to build the "Copy as curl" URL. Defaults to `/api`. */
    baseUrl: { type: String, default: '/api' },
  },
  setup(props) {
    const host = ref<HTMLDivElement | null>(null);
    let handle: ReturnType<typeof mountDevtoolsPanel> | undefined;
    const counts = ref<Record<string, number>>({});

    const ctx = () => props.ctx as QueryContext;

    async function refreshCounts(): Promise<void> {
      const next: Record<string, number> = {};
      for (const entity of Object.keys(ctx().schemas)) {
        const stored = await ctx().store.load(entity);
        next[entity] = stored?.records.length ?? 0;
      }
      counts.value = next;
      handle?.update(buildProps());
    }

    function buildProps(): DevtoolsPanelProps {
      const c = ctx();
      return {
        title: 'mockingpug',
        entities: counts.value,
        runtime: c.runtime ?? { delay: 0, errorRate: 0 },
        onRuntimeChange: (patch) => {
          c.runtime = { delay: 0, errorRate: 0, ...c.runtime, ...patch };
          handle?.update(buildProps());
        },
        onFetchRecords: async (entity) => (await c.store.load(entity))?.records.slice(0, 10) ?? [],
        onResetEntity: async (entity) => {
          await c.store.deleteEntity(entity);
          await generateAll(c.schemas, c.store, { seed: c.seed, customDictionaries: c.customDictionaries });
          const stored = await c.store.load(entity);
          counts.value = { ...counts.value, [entity]: stored?.records.length ?? 0 };
          handle?.update(buildProps());
          return stored?.records.slice(0, 10) ?? [];
        },
        onUpdateRecord: (entity, id, patch) => updateRecord(entity, id, patch, c),
        onFetchRequestLog: async () => c.requestLog?.list() ?? [],
        onClearRequestLog: () => c.requestLog?.clear(),
        onArmOneShotOverride: (entity, patch) => c.oneShotOverrides?.set(entity, patch),
        onPeekOneShotOverride: async (entity) => c.oneShotOverrides?.peek(entity),
        onExportSnapshot: () => exportSnapshot(c),
        onImportSnapshot: async (snapshot) => {
          await importSnapshot(c, snapshot);
          await refreshCounts();
        },
        onCopyRecordCurl: async (entity, id) => {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          await copyToClipboard(buildCurlCommand('GET', `${origin}${props.baseUrl}/${entity}/${id}`));
        },
        onOpenDocs: (c.docs?.enabled ?? true)
          ? () => {
              const spec = generateOpenApiSpec(c.schemas, c.routes, { baseUrl: props.baseUrl, pagination: c.pagination }, c.customDictionaries);
              const url = URL.createObjectURL(new Blob([renderDocsHtml(spec)], { type: 'text/html' }));
              window.open(url, '_blank', 'noopener,noreferrer');
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            }
          : undefined,
        onOpen: () => void refreshCounts(),
        // No "Mock network" master toggle: Vue's setupMockWorker owns the worker
        // lifecycle, not this panel. Per-entity / per-request bypass below give
        // the real-backend escape hatch (MSW passthrough needs no target).
        bypass: {
          isBypassed: (entity) => isRuntimeBypassed(entity),
          onToggle: (entity) => {
            if (isRuntimeBypassed(entity)) unbypass(entity);
            else bypass(entity);
            handle?.update(buildProps());
          },
        },
        requestBypass: {
          isAvailable: true,
          onSet: (method, pathname, isBypassed) => c.requestBypass?.set(method, pathname, isBypassed),
          onList: async () => c.requestBypass?.list() ?? [],
        },
      };
    }

    onMounted(() => {
      // Ensure the ctx has request log / one-shot / request-bypass state wired,
      // even if it wasn't opted into at setupMockWorker time (R27 attaches it;
      // the transport reads it per request, so late attachment still records).
      createRuntimeController(ctx());
      if (host.value) handle = mountDevtoolsPanel(host.value, buildProps());
    });
    onBeforeUnmount(() => handle?.dispose());

    return () => h('div', { ref: host });
  },
});
