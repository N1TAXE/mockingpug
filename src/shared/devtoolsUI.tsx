import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { OneShotOverrideEntry, RequestLogEntry, StoreSnapshot } from '../query/index.js';
import { BackIcon, CheckIcon, ChevronIcon, CrossIcon, DirIcon, EditIcon, LogoIcon, RefreshIcon } from './devtoolsIcons.js';

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

// Windowed virtualization of the "Mock Data" entity list: both the row
// height and the scroll container's height are fixed/known ahead of time,
// so the visible index range is a plain arithmetic computation and doesn't
// need a virtual-scroll dependency.
const ENTITY_ROW_HEIGHT = 49; // Row's `minHeight: 48` + its `1px` bottom border.
const ENTITY_LIST_HEIGHT = 221;
const ENTITY_LIST_OVERSCAN = 3;

const filterInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: '6px 8px',
  fontFamily: FONT_UI,
  fontSize: 13,
  fontWeight: 600,
  color: TEXT,
  outline: 'none',
};

const smallButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  flex: 'none',
  padding: '4px 10px',
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: 12,
  color: TEXT,
  background: '#F6F6F6',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  cursor: 'pointer',
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
  /** Extra buttons rendered before reset/back/close, for header actions this component doesn't know about generically (e.g. `DataWindow`'s edit/save/cancel). */
  extraActions?: ReactNode;
  drag?: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
  };
}

function PanelHeader({ title, icon, onClose, onBack, onReset, closeLabel, backLabel, resetLabel, extraActions, drag }: PanelHeaderProps) {
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
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flex: 'none' }}>
        {extraActions}
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
  /**
   * Applies an edit made in a `DataWindow`'s JSON viewer to one record,
   * merged the same way a real `PUT`/`PATCH` would (via `safeMerge`), but
   * bypassing `runtime.errorRate`/`delay`: this is a devtools-internal
   * action, not a request the app under test is making.
   */
  onUpdateRecord: (entity: string, id: string, patch: Record<string, unknown>) => Promise<unknown>;
  /** Reads the current request log (most-recent-first), for the "Requests" view. */
  onFetchRequestLog: () => Promise<RequestLogEntry[]>;
  /** Clears the request log. Optional: omit to hide the clear button. */
  onClearRequestLog?: () => Promise<void> | void;
  /**
   * Arms a one-shot fail/delay override for `entity`'s very next request,
   * fully replacing `runtime.errorRate`/`delay` for that one request (not
   * layered on top of them) and consumed the moment it fires. A scalpel
   * next to the global settings above, which can be too blunt for testing
   * one specific interaction (see the `errorRate: 1` warning elsewhere in
   * the docs).
   */
  onArmOneShotOverride: (entity: string, patch: OneShotOverrideEntry) => Promise<void> | void;
  /** Reads the currently-armed override for `entity` without consuming it, so a re-opened `DataWindow` can reflect what's actually armed. */
  onPeekOneShotOverride: (entity: string) => Promise<OneShotOverrideEntry | undefined>;
  /** Reads the full current store as `{ entity: { meta, records } }`, for the "Export" button in the "Mock Data" list. */
  onExportSnapshot: () => Promise<StoreSnapshot>;
  /**
   * Restores entities from a previously exported snapshot, for the
   * "Import" button. Implementations apply it via `store.save()` and are
   * responsible for refreshing their own `entities` counts afterward (this
   * component treats `entities` as fully controlled, same as `onResetEntity`).
   */
  onImportSnapshot: (snapshot: StoreSnapshot) => Promise<void> | void;
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

const JSON_SYNTAX_COLORS = {
  key: '#0451a5',
  string: '#a31515',
  number: '#098658',
  keyword: '#0000ff', // true / false / null
};

interface JsonToken {
  text: string;
  color?: string;
}

// Matches a quoted string (optionally followed by its `:` , making it a key),
// or a bare `true`/`false`/`null`/number token. Everything between matches
// (braces, brackets, commas, whitespace) is plain, uncolored text.
const JSON_TOKEN_REGEX = /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Splits `text` (expected to be `JSON.stringify(..., null, 2)` output) into colored/plain tokens for a lightweight, dependency-free syntax highlight. */
function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(JSON_TOKEN_REGEX)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ text: text.slice(lastIndex, index) });
    const value = match[0]!;
    if (value.startsWith('"')) {
      const split = /^(.*")(\s*:)?$/.exec(value)!;
      const stringPart = split[1]!;
      const colonPart = split[2];
      tokens.push({ text: stringPart, color: colonPart ? JSON_SYNTAX_COLORS.key : JSON_SYNTAX_COLORS.string });
      if (colonPart) tokens.push({ text: colonPart });
    } else if (value === 'true' || value === 'false' || value === 'null') {
      tokens.push({ text: value, color: JSON_SYNTAX_COLORS.keyword });
    } else {
      tokens.push({ text: value, color: JSON_SYNTAX_COLORS.number });
    }
    lastIndex = index + value.length;
  }
  if (lastIndex < text.length) tokens.push({ text: text.slice(lastIndex) });
  return tokens;
}

/** Renders `JSON.stringify(...)` output with IDE-like syntax colors, memoized per exact text so re-renders while idle (e.g. the drag-position `MouseMove` handler) don't re-tokenize on every frame. */
function HighlightedJson({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeJson(text), [text]);
  return (
    <>
      {tokens.map((token, i) => (token.color ? <span key={i} style={{ color: token.color }}>{token.text}</span> : token.text))}
    </>
  );
}

/** Extracts `.id` from a parsed JSON value as a string, or `undefined` if it's not a plain object with one. */
function recordId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const id = (value as Record<string, unknown>).id;
  return id === undefined ? undefined : String(id);
}

function DataWindow({
  win,
  zIndex,
  onFocus,
  onClose,
  onFetchRecords,
  onResetEntity,
  onUpdateRecord,
  onArmOneShotOverride,
  onPeekOneShotOverride,
}: {
  win: WindowState;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onFetchRecords: (entity: string) => Promise<unknown[]>;
  onResetEntity: (entity: string) => Promise<unknown[]>;
  onUpdateRecord: (entity: string, id: string, patch: Record<string, unknown>) => Promise<unknown>;
  onArmOneShotOverride: (entity: string, patch: OneShotOverrideEntry) => Promise<void> | void;
  onPeekOneShotOverride: (entity: string) => Promise<OneShotOverrideEntry | undefined>;
}) {
  const [pos, setPos] = useState({ x: win.x, y: win.y });
  const [records, setRecords] = useState<unknown[] | null>(null);
  const [editText, setEditText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failArmed, setFailArmed] = useState(false);
  const [delayDraft, setDelayDraft] = useState('');
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const loadedRef = useRef(false);
  const highlightRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!loadedRef.current) {
    loadedRef.current = true;
    void onFetchRecords(win.entity).then(setRecords);
  }

  // Reflects whatever's already armed (e.g. from a previous session with
  // this same window, or armed some other way) instead of always assuming
  // "nothing armed" on mount.
  useEffect(() => {
    let cancelled = false;
    void onPeekOneShotOverride(win.entity).then((entry) => {
      if (!cancelled) setFailArmed(Boolean(entry?.failNext));
    });
    return () => {
      cancelled = true;
    };
  }, [win.entity, onPeekOneShotOverride]);

  async function toggleFailNext() {
    const next = !failArmed;
    setFailArmed(next);
    await onArmOneShotOverride(win.entity, { failNext: next });
  }

  async function armDelay() {
    const ms = Number(delayDraft);
    if (!Number.isFinite(ms) || ms <= 0) return;
    await onArmOneShotOverride(win.entity, { delayNext: ms });
    setDelayDraft('');
  }

  // Focuses the textarea the moment it mounts, so the pencil-icon click both
  // enters edit mode and puts the caret somewhere useful in one action.
  const editing = editText !== null;
  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

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

  function startEdit() {
    setEditText(JSON.stringify(records, null, 2));
    setError(null);
  }

  function cancelEdit() {
    setEditText(null);
    setError(null);
  }

  /**
   * Diffs the edited JSON against the last-loaded `records` by `.id`, and
   * `PATCH`es only the records that actually changed. Records with no
   * matching `id` in the original set (added or renamed by hand in the
   * textarea) are silently skipped: this editor edits existing records in
   * place, it doesn't support creating/deleting through the JSON view.
   */
  async function saveEdit() {
    if (editText === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch {
      setError('Invalid JSON.');
      return;
    }
    if (!Array.isArray(parsed)) {
      setError('Must be a JSON array of records.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const originalById = new Map((records ?? []).map((r) => [recordId(r), r]));
      for (const record of parsed) {
        const id = recordId(record);
        if (id === undefined) continue;
        const original = originalById.get(id);
        if (original === undefined) continue;
        if (JSON.stringify(original) === JSON.stringify(record)) continue;
        await onUpdateRecord(win.entity, id, record as Record<string, unknown>);
      }
      setRecords(await onFetchRecords(win.entity));
      setEditText(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
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
        // A fixed height (not "shrink/grow to fit content") is deliberate:
        // a `<textarea>` doesn't naturally size itself to its value the way
        // a `<pre>` sizes to its text, so switching between the read-only
        // viewer and the editor with a content-driven height collapsed the
        // whole window down to just its header. Fixed height sidesteps that
        // class of bug entirely and keeps the window the same size in both
        // modes; there's no resize handle on this window anyway.
        height: 420,
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
        extraActions={
          editing ? (
            <>
              <IconButton onClick={cancelEdit} title={`Cancel editing ${win.entity}`}>
                <CrossIcon />
              </IconButton>
              <IconButton onClick={() => void saveEdit()} title={`Save ${win.entity} changes`}>
                <CheckIcon />
              </IconButton>
            </>
          ) : (
            <IconButton onClick={startEdit} title={`Edit ${win.entity} records`}>
              <EditIcon />
            </IconButton>
          )
        }
        onReset={editing || records === null ? undefined : () => void handleReset()}
        resetLabel={`Reset ${win.entity}`}
        onClose={onClose}
        closeLabel={`Close ${win.entity} window`}
        drag={{ onPointerDown, onPointerMove, onPointerUp }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          padding: '8px 16px',
          borderBottom: `1px solid ${BORDER}`,
          flex: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch small label={`Fail next ${win.entity} request`} checked={failArmed} onChange={() => void toggleFailNext()} />
          <span style={rowLabelStyle}>Fail next request</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={rowLabelStyle}>Delay next</span>
          <input
            type="number"
            min={0}
            aria-label={`Delay next ${win.entity} request (ms)`}
            value={delayDraft}
            onChange={(e) => setDelayDraft(e.target.value)}
            className="mp-number-input"
            style={numberInputStyle}
          />
          <span style={fadedStyle}>ms</span>
          <button type="button" onClick={() => void armDelay()} style={smallButtonStyle}>
            Arm
          </button>
        </span>
      </div>
      <div style={{ position: 'relative', width: '100%', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        {editing ? (
          <>
            {/* Purely visual: sits behind the textarea, mirrors its exact box model/font metrics so the
                colored text lines up with the transparent-but-caret-visible textarea on top of it. */}
            <pre
              ref={highlightRef}
              aria-hidden="true"
              style={{
                margin: 0,
                position: 'absolute',
                inset: 0,
                padding: 16,
                boxSizing: 'border-box',
                fontFamily: FONT_CODE,
                fontSize: 14,
                lineHeight: '20px',
                fontWeight: 700,
                color: TEXT,
                background: '#fff',
                overflow: 'auto',
                whiteSpace: 'pre',
                pointerEvents: 'none',
              }}
            >
              <HighlightedJson text={editText} />
            </pre>
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onScroll={(e) => {
                if (highlightRef.current) {
                  highlightRef.current.scrollTop = e.currentTarget.scrollTop;
                  highlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
              disabled={saving}
              spellCheck={false}
              wrap="off"
              aria-label={`Edit ${win.entity} records as JSON`}
              style={{
                margin: 0,
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                padding: 16,
                boxSizing: 'border-box',
                fontFamily: FONT_CODE,
                fontSize: 14,
                lineHeight: '20px',
                fontWeight: 700,
                color: 'transparent',
                caretColor: TEXT,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                whiteSpace: 'pre',
                overflow: 'auto',
              }}
            />
          </>
        ) : (
          <pre
            style={{
              margin: 0,
              position: 'absolute',
              inset: 0,
              padding: 16,
              boxSizing: 'border-box',
              fontFamily: FONT_CODE,
              fontSize: 14,
              lineHeight: '20px',
              fontWeight: 700,
              color: TEXT,
              background: '#fff',
              overflow: 'auto',
            }}
          >
            {records === null ? 'loading…' : <HighlightedJson text={JSON.stringify(records, null, 2)} />}
          </pre>
        )}
      </div>
      {error && (
        <div
          style={{
            padding: '8px 16px',
            fontFamily: FONT_UI,
            fontSize: 12,
            fontWeight: 600,
            color: '#c0392b',
            borderTop: `1px solid ${BORDER}`,
            flex: 'none',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

const METHOD_COLORS: Record<string, string> = {
  GET: '#0451a5',
  POST: '#098658',
  PUT: '#a06600',
  PATCH: '#a06600',
  DELETE: '#c0392b',
};

/** One row in the "Requests" view: method, path, status (colored by 2xx/4xx/5xx), duration, and wall-clock time. */
function RequestRow({ entry }: { entry: RequestLogEntry }) {
  const statusColor = entry.status >= 500 ? '#c0392b' : entry.status >= 400 ? '#a06600' : '#1d9e4b';
  return (
    <Row hoverable={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span
            style={{
              ...rowLabelStyle,
              color: METHOD_COLORS[entry.method] ?? TEXT,
              flex: 'none',
            }}
          >
            {entry.method}
          </span>
          <span
            style={{
              ...rowLabelStyle,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: '1 1 auto',
              minWidth: 0,
            }}
            title={entry.path}
          >
            {entry.path}
          </span>
          <span style={{ ...rowLabelStyle, color: statusColor, flex: 'none' }}>{entry.status}</span>
        </div>
        <span style={{ ...fadedStyle, fontSize: 11 }}>
          {entry.durationMs}ms · {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </Row>
  );
}

export function DevtoolsPanel({
  title,
  entities,
  runtime,
  onRuntimeChange,
  onFetchRecords,
  onResetEntity,
  onUpdateRecord,
  onFetchRequestLog,
  onClearRequestLog,
  onArmOneShotOverride,
  onPeekOneShotOverride,
  onExportSnapshot,
  onImportSnapshot,
  onOpen,
  mockNetwork,
  bypass,
}: DevtoolsPanelProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'list' | 'requests'>('main');
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [requests, setRequests] = useState<RequestLogEntry[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [entityFilter, setEntityFilter] = useState('');
  const [entityScrollTop, setEntityScrollTop] = useState(0);
  const entityListRef = useRef<HTMLDivElement>(null);

  function openPanel() {
    setOpen(true);
    onOpen?.();
  }

  // Polls the request log at 1s while the "Requests" view is open, since
  // (unlike the entity list, which only changes on user action) new requests
  // can arrive continuously from whatever the app under test is doing.
  useEffect(() => {
    if (view !== 'requests') return;
    let cancelled = false;
    async function poll() {
      const list = await onFetchRequestLog();
      if (!cancelled) setRequests(list);
    }
    void poll();
    const interval = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view, onFetchRequestLog]);

  async function clearRequests() {
    await onClearRequestLog?.();
    setRequests(await onFetchRequestLog());
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

  /** Resets scroll to the top so a shorter, filtered list can't leave the virtualized window pointed past its own end. */
  function handleFilterChange(value: string) {
    setEntityFilter(value);
    setEntityScrollTop(0);
    if (entityListRef.current) entityListRef.current.scrollTop = 0;
  }

  /** Downloads the current store as a JSON file, so it can be shared to reproduce a bug exactly instead of describing the data in words. */
  async function handleExport() {
    const snapshot = await onExportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mockingpug-snapshot.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so re-selecting the same file still fires onChange
    if (!file) return;
    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text()) as StoreSnapshot;
      await onImportSnapshot(parsed);
    } catch {
      setImportError('Invalid snapshot file.');
    }
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

              <button type="button" onClick={() => setView('requests')} style={unstyledButton}>
                <Row hoverable>
                  <span style={rowLabelStyle}>Requests</span>
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
          ) : view === 'list' ? (
            <>
              <PanelHeader
                title="Mock Data"
                icon="dir"
                onBack={() => setView('main')}
                backLabel="Back to settings"
                onReset={() => void resetAllEntities()}
                resetLabel="Reset all entities"
              />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderBottom: `1px solid ${BORDER}`,
                  flex: 'none',
                }}
              >
                <button type="button" onClick={() => void handleExport()} style={smallButtonStyle}>
                  Export
                </button>
                <button type="button" onClick={() => importInputRef.current?.click()} style={smallButtonStyle}>
                  Import
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json"
                  aria-label="Import snapshot file"
                  onChange={(e) => void handleImportFile(e)}
                  style={{ display: 'none' }}
                />
              </div>
              {importError && (
                <div
                  style={{
                    padding: '4px 16px 8px',
                    fontFamily: FONT_UI,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#c0392b',
                    flex: 'none',
                  }}
                >
                  {importError}
                </div>
              )}
              <div style={{ padding: '8px 16px', borderBottom: `1px solid ${BORDER}`, flex: 'none' }}>
                <input
                  type="text"
                  placeholder="Filter entities…"
                  aria-label="Filter entities"
                  value={entityFilter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  style={filterInputStyle}
                />
              </div>
              <div style={{ position: 'relative', width: '100%' }}>
                {(() => {
                  const filteredEntities = Object.entries(entities).filter(([entity]) =>
                    entity.toLowerCase().includes(entityFilter.trim().toLowerCase()),
                  );
                  const visibleRowCount = Math.ceil(ENTITY_LIST_HEIGHT / ENTITY_ROW_HEIGHT) + ENTITY_LIST_OVERSCAN * 2;
                  const startIndex = Math.max(0, Math.floor(entityScrollTop / ENTITY_ROW_HEIGHT) - ENTITY_LIST_OVERSCAN);
                  const visibleEntities = filteredEntities.slice(startIndex, startIndex + visibleRowCount);

                  return (
                    <div
                      ref={entityListRef}
                      data-testid="entity-list-scroll"
                      style={{ maxHeight: ENTITY_LIST_HEIGHT, overflowY: 'auto' }}
                      onScroll={(e) => setEntityScrollTop(e.currentTarget.scrollTop)}
                    >
                      {filteredEntities.length === 0 ? (
                        <Row hoverable={false}>
                          <span style={fadedStyle}>No matching entities.</span>
                        </Row>
                      ) : (
                        <div style={{ position: 'relative', height: filteredEntities.length * ENTITY_ROW_HEIGHT }}>
                          <div style={{ position: 'absolute', top: startIndex * ENTITY_ROW_HEIGHT, left: 0, right: 0 }}>
                            {visibleEntities.map(([entity, count]) => (
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
                        </div>
                      )}
                    </div>
                  );
                })()}
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
          ) : (
            <>
              <PanelHeader
                title="Requests"
                icon="dir"
                onBack={() => setView('main')}
                backLabel="Back to settings"
                onReset={onClearRequestLog ? () => void clearRequests() : undefined}
                resetLabel="Clear request log"
              />
              <div style={{ maxHeight: 269, overflowY: 'auto' }}>
                {requests.length === 0 ? (
                  <Row hoverable={false}>
                    <span style={fadedStyle}>No requests yet.</span>
                  </Row>
                ) : (
                  requests.map((entry, i) => <RequestRow key={`${entry.timestamp}-${i}`} entry={entry} />)
                )}
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
          onUpdateRecord={onUpdateRecord}
          onArmOneShotOverride={onArmOneShotOverride}
          onPeekOneShotOverride={onPeekOneShotOverride}
        />
      ))}
    </>
  );
}
