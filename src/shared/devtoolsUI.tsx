import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BackIcon, ChevronIcon, CrossIcon, DirIcon, LogoIcon, RefreshIcon } from './devtoolsIcons.js';

const FONT_UI = "'Nunito', system-ui, sans-serif";
const FONT_CODE = "'JetBrains Mono', ui-monospace, monospace";
const BORDER = '#E2E2E2';
const TEXT = '#23272F';
const SWITCH_ON = '#1d9e4b';
const SWITCH_OFF = '#D9D4C5';
const WINDOW_SHADOW = '0px 8px 16px rgba(0, 0, 0, 0.15)';

// A fixed line-height equal to (or barely above) the font size clips descenders
// (g, p, y...) on most typefaces. 'normal' leaves the font's own metrics room to breathe.
const LINE_HEIGHT = 'normal';

const rowLabelStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: 14,
  lineHeight: LINE_HEIGHT,
  color: TEXT,
  whiteSpace: 'nowrap',
};

const fadedStyle: CSSProperties = { ...rowLabelStyle, opacity: 0.5 };

const numberInputStyle: CSSProperties = {
  width: 80,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  textAlign: 'right',
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: 14,
  color: TEXT,
  padding: 0,
};

/**
 * Injected once per mounted panel: button hover states can't be expressed as
 * inline `style` (no `:hover` pseudo-class there), and hiding the number-input
 * spinner needs actual CSS text, not React's inline `style` object: vendor-
 * prefixed properties like `MozAppearance`/`WebkitAppearance` set via direct
 * DOM property assignment (which is how React applies inline styles) silently
 * no-op in engines that don't expose that exact IDL property (e.g. current
 * Firefox has no `style.MozAppearance`), whereas the same declarations parsed
 * from real CSS text always apply.
 */
function DevtoolsStyleTag() {
  return (
    <style>{`
      .mp-icon-btn { transition: background .3s ease; }
      .mp-icon-btn .mp-fade-icon { opacity: .5; transition: opacity .3s ease; display: flex; }
      .mp-icon-btn:hover .mp-fade-icon { opacity: 1; }
      .mp-hover-item { transition: background .3s ease; }
      .mp-hover-item:hover { background: #F6F6F6; }
      .mp-number-input { appearance: none; -moz-appearance: textfield; }
      .mp-number-input::-webkit-inner-spin-button,
      .mp-number-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    `}</style>
  );
}

/** Resets exactly the properties that matter (never `all: unset`, whose cascade with later same-attribute declarations isn't reliable everywhere), so a `<button>` wrapping a `<Row>` fills its full width/height with no user-agent padding or border eating into the click target. */
const unstyledButton: CSSProperties = {
  boxSizing: 'border-box',
  display: 'block',
  width: '100%',
  margin: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

function Switch({
  checked,
  onChange,
  small,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  small?: boolean;
  label: string;
}) {
  const width = small ? 28 : 38;
  const height = small ? 15 : 20;
  const knob = small ? 11 : 16;
  const travel = width - knob - 4;
  return (
    <span
      role="switch"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onChange();
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flex: 'none',
        width,
        height,
        borderRadius: 99,
        position: 'relative',
        cursor: 'pointer',
        background: checked ? SWITCH_ON : SWITCH_OFF,
        transition: 'background .15s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: knob,
          height: knob,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(35,39,47,.3)',
          transition: 'transform .15s ease',
          transform: checked ? `translateX(${travel}px)` : 'translateX(0)',
        }}
      />
    </span>
  );
}

/**
 * `onClick`, when given, makes the *entire* row (including its padding) a
 * mouse click target, not just its text/icon content. It's a plain click
 * handler, not an ARIA `role="button"`, on purpose: a row can contain its
 * own genuinely-focusable controls (a switch, a button), and nesting a
 * widget inside a `role="button"` is invalid ARIA. Those inner controls
 * stay independently reachable by keyboard. `onClick` is the mouse-only
 * "click anywhere in this row" convenience on top.
 */
function Row({
  children,
  onClick,
  testId,
  hoverable = Boolean(onClick),
}: {
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
  /** Adds the `#F6F6F6` hover background. Defaults to true whenever `onClick` is set; pass explicitly when the click handler lives on a wrapping element instead (e.g. a `<button>` around this `Row`). */
  hoverable?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      data-testid={testId}
      className={hoverable ? 'mp-hover-item' : undefined}
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        gap: 16,
        width: '100%',
        minHeight: 48,
        background: '#fff',
        borderBottom: `1px solid ${BORDER}`,
        flex: 'none',
        cursor: onClick ? 'pointer' : undefined,
      }}
    >
      {children}
    </div>
  );
}

function IconButton({
  onClick,
  title,
  children,
  short,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  short?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="mp-icon-btn"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 48,
        height: short ? 46 : 48,
        padding: 18,
        border: 'none',
        borderLeft: `1px solid ${BORDER}`,
        background: 'transparent',
        cursor: 'pointer',
        flex: 'none',
      }}
    >
      <span className="mp-fade-icon">{children}</span>
    </button>
  );
}

interface PanelHeaderProps {
  title: string;
  icon: 'logo' | 'dir';
  onClose?: () => void;
  onBack?: () => void;
  onReset?: () => void;
  /** Accessible names for the buttons above, required whenever the matching handler is passed, since two headers (e.g. a list header and a floating data window) can be on screen at once and need distinguishable names. */
  closeLabel?: string;
  backLabel?: string;
  resetLabel?: string;
  drag?: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
  };
}

function PanelHeader({ title, icon, onClose, onBack, onReset, closeLabel, backLabel, resetLabel, drag }: PanelHeaderProps) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 0 0 16px',
        gap: 16,
        width: '100%',
        height: 48,
        background: '#fff',
        borderBottom: `1px solid ${BORDER}`,
        flex: 'none',
      }}
    >
      {/* Drag handlers live only on this title cluster, not the whole header: otherwise a pointerdown that starts on the reset/close buttons gets captured for dragging and their click never fires. */}
      <div
        onPointerDown={drag?.onPointerDown}
        onPointerMove={drag?.onPointerMove}
        onPointerUp={drag?.onPointerUp}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: icon === 'logo' ? 12 : 8,
          minWidth: 0,
          flex: '1 1 auto',
          height: '100%',
          cursor: drag ? 'grab' : undefined,
          touchAction: drag ? 'none' : undefined,
          userSelect: drag ? 'none' : undefined,
        }}
      >
        {icon === 'logo' ? <LogoIcon /> : <DirIcon />}
        <span
          style={{
            fontFamily: FONT_UI,
            fontWeight: icon === 'logo' ? 700 : 600,
            fontSize: icon === 'logo' ? 16 : 14,
            lineHeight: '16px',
            color: TEXT,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flex: 'none' }}>
        {onReset && (
          <IconButton onClick={onReset} title={resetLabel ?? 'Reset'}>
            <RefreshIcon />
          </IconButton>
        )}
        {onBack && (
          <IconButton onClick={onBack} title={backLabel ?? 'Back'} short>
            <BackIcon />
          </IconButton>
        )}
        {onClose && (
          <IconButton onClick={onClose} title={closeLabel ?? 'Close'}>
            <CrossIcon />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/** The persistent round activation button: shows the logo when the panel is closed, a cross when it's open (click to hide). Always rendered at the same fixed spot. */
function FloatingToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? 'Hide mockingpug devtools' : 'Open mockingpug devtools'}
      className="mp-icon-btn"
      style={{
        boxSizing: 'border-box',
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 1000001,
        width: 40,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        border: `1px solid ${BORDER}`,
        boxShadow: WINDOW_SHADOW,
        borderRadius: 9999,
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {open ? (
        <span className="mp-fade-icon">
          <CrossIcon />
        </span>
      ) : (
        <span style={{ filter: 'drop-shadow(0px 16px 32px rgba(0,0,0,0.15))', display: 'flex' }}>
          <LogoIcon />
        </span>
      )}
    </button>
  );
}

export interface ToggleControl {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}

export interface BypassControl {
  isBypassed: (entity: string) => boolean;
  onToggle: (entity: string) => void;
}

export interface DevtoolsPanelProps {
  title: string;
  entities: Record<string, number>;
  runtime: { delay: number; errorRate: number };
  onRuntimeChange: (patch: { delay?: number; errorRate?: number }) => void;
  onFetchRecords: (entity: string) => Promise<unknown[]>;
  onResetEntity: (entity: string) => Promise<unknown[]>;
  /** Called every time the panel transitions from closed to open, so the caller can refresh `entities`/`runtime`. */
  onOpen?: () => void;
  /** React/MSW-only: worker on/off. Omit entirely for transports (like Next.js) with nothing to intercept. */
  mockNetwork?: ToggleControl;
  /** React/MSW-only: per-entity request bypass. Omit for transports where a mock IS the real server. */
  bypass?: BypassControl;
}

interface WindowState {
  id: string;
  entity: string;
  x: number;
  y: number;
}

function randomWindowPosition(width: number, height: number): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const maxX = Math.max(24, vw - width - 24);
  const maxY = Math.max(24, vh - height - 24);
  return { x: 24 + Math.random() * Math.max(1, maxX - 24), y: 24 + Math.random() * Math.max(1, maxY - 24) };
}

function DataWindow({
  win,
  zIndex,
  onFocus,
  onClose,
  onFetchRecords,
  onResetEntity,
}: {
  win: WindowState;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onFetchRecords: (entity: string) => Promise<unknown[]>;
  onResetEntity: (entity: string) => Promise<unknown[]>;
}) {
  const [pos, setPos] = useState({ x: win.x, y: win.y });
  const [records, setRecords] = useState<unknown[] | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const loadedRef = useRef(false);

  if (!loadedRef.current) {
    loadedRef.current = true;
    void onFetchRecords(win.entity).then(setRecords);
  }

  function onPointerDown(e: React.PointerEvent) {
    onFocus();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    setPos({ x: dragRef.current.originX + (e.clientX - dragRef.current.startX), y: dragRef.current.originY + (e.clientY - dragRef.current.startY) });
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  async function handleReset() {
    const fresh = await onResetEntity(win.entity);
    setRecords(fresh);
  }

  return (
    <div
      onMouseDown={onFocus}
      style={{
        boxSizing: 'border-box',
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        width: 620,
        maxWidth: '92vw',
        maxHeight: '80vh',
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        background: '#fff',
        overflow: 'hidden',
        boxShadow: WINDOW_SHADOW,
        fontFamily: FONT_UI,
      }}
    >
      <PanelHeader
        title={win.entity}
        icon="dir"
        onReset={() => void handleReset()}
        resetLabel={`Reset ${win.entity}`}
        onClose={onClose}
        closeLabel={`Close ${win.entity} window`}
        drag={{ onPointerDown, onPointerMove, onPointerUp }}
      />
      <pre
        style={{
          margin: 0,
          width: '100%',
          flex: '1 1 auto',
          overflow: 'auto',
          padding: 16,
          boxSizing: 'border-box',
          fontFamily: FONT_CODE,
          fontSize: 14,
          lineHeight: '20px',
          fontWeight: 700,
          color: TEXT,
          background: '#fff',
        }}
      >
        {records === null ? 'loading…' : JSON.stringify(records, null, 2)}
      </pre>
    </div>
  );
}

export function DevtoolsPanel({
  title,
  entities,
  runtime,
  onRuntimeChange,
  onFetchRecords,
  onResetEntity,
  onOpen,
  mockNetwork,
  bypass,
}: DevtoolsPanelProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'list'>('main');
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [order, setOrder] = useState<string[]>([]);

  function openPanel() {
    setOpen(true);
    onOpen?.();
  }

  function focusWindow(id: string) {
    setOrder((prev) => [...prev.filter((existing) => existing !== id), id]);
  }

  function openEntity(entity: string) {
    const existing = windows.find((w) => w.entity === entity);
    if (existing) {
      focusWindow(existing.id);
      return;
    }
    const { x, y } = randomWindowPosition(620, 320);
    const id = `${entity}-${windows.length}-${Math.random().toString(36).slice(2, 8)}`;
    setWindows((prev) => [...prev, { id, entity, x, y }]);
    setOrder((prev) => [...prev, id]);
  }

  function closeWindow(id: string) {
    setWindows((prev) => prev.filter((w) => w.id !== id));
    setOrder((prev) => prev.filter((existing) => existing !== id));
  }

  async function resetAllEntities() {
    for (const entity of Object.keys(entities)) await onResetEntity(entity);
  }

  const entityCount = Object.keys(entities).length;

  return (
    <>
      <DevtoolsStyleTag />
      <FloatingToggle open={open} onClick={() => (open ? setOpen(false) : openPanel())} />
      {open && (
        <div
          style={{
            boxSizing: 'border-box',
            position: 'fixed',
            bottom: 52,
            right: 12,
            zIndex: 999999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            width: 320,
            border: `1px solid ${BORDER}`,
            borderRadius: '12px 12px 0px 12px',
            background: '#fff',
            overflow: 'hidden',
            fontFamily: FONT_UI,
            boxShadow: WINDOW_SHADOW,
          }}
        >
          {view === 'main' ? (
            <>
              <PanelHeader title={title} icon="logo" onClose={() => setOpen(false)} closeLabel="Close devtools" />

              <button type="button" onClick={() => setView('list')} style={unstyledButton}>
                <Row hoverable>
                  <span style={rowLabelStyle}>
                    Mock Data <span style={fadedStyle}>({entityCount})</span>
                  </span>
                  <span style={{ display: 'flex' }}>
                    <ChevronIcon />
                  </span>
                </Row>
              </button>

              {mockNetwork && (
                <Row>
                  <span style={rowLabelStyle}>Mock network</span>
                  <Switch
                    label="Mock network"
                    checked={mockNetwork.enabled}
                    onChange={() => mockNetwork.onToggle(!mockNetwork.enabled)}
                  />
                </Row>
              )}

              <Row>
                <span style={rowLabelStyle}>Delay</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    min={0}
                    aria-label="Delay (ms)"
                    value={runtime.delay}
                    onChange={(e) => onRuntimeChange({ delay: Math.max(0, Number(e.target.value) || 0) })}
                    className="mp-number-input"
                    style={numberInputStyle}
                  />
                  <span style={fadedStyle}>ms</span>
                </span>
              </Row>

              <Row>
                <span style={rowLabelStyle}>Error rate</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  aria-label="Error rate (0-1)"
                  value={runtime.errorRate}
                  onChange={(e) => onRuntimeChange({ errorRate: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })}
                  className="mp-number-input"
                  style={numberInputStyle}
                />
              </Row>
            </>
          ) : (
            <>
              <PanelHeader
                title="Mock Data"
                icon="dir"
                onBack={() => setView('main')}
                backLabel="Back to settings"
                onReset={() => void resetAllEntities()}
                resetLabel="Reset all entities"
              />
              <div style={{ position: 'relative', width: '100%' }}>
                <div style={{ maxHeight: 221, overflowY: 'auto' }}>
                  {Object.entries(entities).map(([entity, count]) => (
                    <Row key={entity} onClick={() => openEntity(entity)} testId={`entity-row-${entity}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <DirIcon />
                        <span style={rowLabelStyle}>
                          {entity} <span style={fadedStyle}>({count})</span>
                        </span>
                      </div>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {bypass && (
                          <Switch
                            small
                            label={`Bypass ${entity}`}
                            checked={bypass.isBypassed(entity)}
                            onChange={() => bypass.onToggle(entity)}
                          />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEntity(entity);
                          }}
                          aria-label={`Open ${entity} records`}
                          style={{
                            boxSizing: 'border-box',
                            display: 'flex',
                            padding: 0,
                            margin: 0,
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          <ChevronIcon />
                        </button>
                      </span>
                    </Row>
                  ))}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 24,
                    background: 'linear-gradient(180deg,#fff,rgba(255,255,255,0))',
                    pointerEvents: 'none',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 24,
                    background: 'linear-gradient(0deg,#fff,rgba(255,255,255,0))',
                    pointerEvents: 'none',
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {windows.map((win) => (
        <DataWindow
          key={win.id}
          win={win}
          zIndex={1000000 + order.indexOf(win.id)}
          onFocus={() => focusWindow(win.id)}
          onClose={() => closeWindow(win.id)}
          onFetchRecords={onFetchRecords}
          onResetEntity={onResetEntity}
        />
      ))}
    </>
  );
}
