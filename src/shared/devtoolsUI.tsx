// React adapter over the framework-agnostic devtools panel core
// (`devtoolsPanel.ts`). The whole UI lives in that one vanilla implementation,
// shared by `mockingpug/react`, `mockingpug/next` and `mockingpug/vue`; this
// file just mounts it into a React-managed host div and forwards fresh props.
import { useLayoutEffect, useRef } from 'react';
import { mountDevtoolsPanel, type DevtoolsPanelProps } from './devtoolsPanel.js';

export type { ToggleControl, BypassControl, RequestBypassControl, DevtoolsPanelProps } from './devtoolsPanel.js';

export function DevtoolsPanel(props: DevtoolsPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ReturnType<typeof mountDevtoolsPanel> | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Mount once; the panel owns its own open/view/window state internally.
  // `useLayoutEffect` (not `useEffect`) so mount + prop-forwarding run
  // synchronously within React's commit — the panel reflects a parent state
  // change (e.g. entity counts loaded, `docs.enabled` toggled) in the same tick,
  // matching how the old inline-React panel rendered.
  useLayoutEffect(() => {
    if (!hostRef.current) return;
    handleRef.current = mountDevtoolsPanel(hostRef.current, propsRef.current);
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  // Forward fresh props (entities counts, runtime, control callbacks) on every
  // render, so parent state changes reach the panel without remounting it.
  useLayoutEffect(() => {
    handleRef.current?.update(props);
  });

  return <div ref={hostRef} />;
}
