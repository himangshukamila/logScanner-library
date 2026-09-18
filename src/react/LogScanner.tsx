'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ErrorBoundary } from 'react-error-boundary';
import clsx from 'clsx';
import { getBrowserStore, installBrowserCapture, registerBrowserCaptureVisibility } from '../browser/index.js';
import { LOG_LEVELS, type LogEntry } from '../core/types.js';
import { LogEntryRow, type CopyStatus } from './LogEntryRow.js';
import { useServerLogs } from './useServerLogs.js';
import { usePanelGeometry, type LauncherPosition } from './usePanelGeometry.js';
import { LogScannerLogo } from './logo.js';
import { ensureStylesInjected } from './injectStyles.js';
import { readSession, writeSession } from './session.js';

export type { LauncherPosition };

export interface LogScannerProps {
  /** Show the scanner and capture logs. False completely stops this browser session. */
  visible?: boolean;
  /** @deprecated Use visible. When both are provided, visible takes precedence. */
  enabled?: boolean;
  serverUrl?: string;
  maxLogs?: number;
  /** Which corner the launcher occupies; the panel docks into the same corner. */
  position?: LauncherPosition;
  /** Capture fetch and XMLHttpRequest calls. Defaults to true. */
  network?: boolean;
}

const LAUNCHER_POSITION: Record<LauncherPosition, string> = {
  'bottom-right': 'ls:right-3 ls:bottom-3 ls:sm:right-5 ls:sm:bottom-5',
  'bottom-left': 'ls:left-3 ls:bottom-3 ls:sm:left-5 ls:sm:bottom-5',
  'top-right': 'ls:right-3 ls:top-3 ls:sm:right-5 ls:sm:top-5',
  'top-left': 'ls:left-3 ls:top-3 ls:sm:left-5 ls:sm:top-5',
};

// A development overlay has to win against application stacking contexts.
const TOP_LAYER = 'ls:z-[2147483647]';
const FILTERS_KEY = 'logscan.filters-open.v1';

const CONTROL = 'ls:box-border ls:h-8 ls:min-w-0 ls:rounded-md ls:border ls:border-solid ls:border-neutral-700 ls:bg-neutral-900 ls:px-2 ls:font-sans ls:text-xs ls:leading-5 ls:text-neutral-300 ls:transition-colors ls:focus-visible:outline-2 ls:focus-visible:-outline-offset-2 ls:focus-visible:outline-neutral-400 ls:motion-reduce:transition-none';
const BUTTON = 'ls:box-border ls:inline-flex ls:h-8 ls:shrink-0 ls:cursor-pointer ls:items-center ls:justify-center ls:gap-2 ls:rounded-md ls:border ls:border-solid ls:border-neutral-700 ls:bg-transparent ls:px-2.5 ls:font-sans ls:text-xs ls:leading-5 ls:text-neutral-300 ls:transition-colors ls:hover:border-neutral-500 ls:hover:bg-neutral-800 ls:hover:text-white ls:focus-visible:outline-2 ls:focus-visible:outline-offset-2 ls:focus-visible:outline-neutral-300 ls:disabled:cursor-default ls:disabled:opacity-40 ls:motion-reduce:transition-none';

function PanelFailure({ retry }: { retry: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div role="alert" className="ls:fixed ls:right-4 ls:bottom-4 ls:z-[2147483647] ls:box-border ls:rounded-lg ls:border ls:border-solid ls:border-neutral-700 ls:bg-neutral-950 ls:p-4 ls:font-sans ls:text-sm ls:text-neutral-200 ls:shadow-lg">
      <p className="ls:mt-0 ls:mb-3">Log Scanner could not display this session.</p>
      <button type="button" onClick={retry} className={BUTTON}>Retry panel</button>
    </div>,
    document.body,
  );
}

function ActiveScanner({ serverUrl, maxLogs, position, network }: Required<Pick<LogScannerProps, 'position' | 'network'>> & Pick<LogScannerProps, 'serverUrl' | 'maxLogs'>) {
  const store = getBrowserStore();
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const connection = useServerLogs(serverUrl, store);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  // Geometry and pointer ownership disappear with the active scanner subtree.
  const { panelRef, geometry, style: panelStyle, dragProps, resizeProps, resizeStartProps, interaction } = usePanelGeometry(open, position);
  const positioned = geometry !== null;
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<LogEntry['level'] | 'all'>('all');
  const [source, setSource] = useState<LogEntry['source'] | 'all'>('all');
  // Collapsing the toolbar returns its height to the log list, which matters most on a small panel.
  const [filtersOpen, setFiltersOpen] = useState(() => readSession(FILTERS_KEY) !== false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>({ token: null, message: '' });
  const focusSearchNext = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const wasOpen = useRef(false);
  const panelId = useId();
  const filtersId = useId();
  const searchId = useId();
  const levelId = useId();
  const sourceId = useId();
  const moveHelpId = useId();
  const resizeHelpId = useId();
  const resizeStartHelpId = useId();

  useEffect(() => {
    // inject required styles automatically into document head
    ensureStylesInjected();
    setMounted(true);
  }, []);

  useEffect(() => installBrowserCapture({ maxLogs, network }), [maxLogs, network]);

  useEffect(() => {
    if (open && positioned) {
      // With the toolbar collapsed there is no search field, so the log list takes focus instead.
      (searchInput.current ?? list.current)?.focus();
      wasOpen.current = true;
    } else if (!open && wasOpen.current) {
      launcher.current?.focus();
      wasOpen.current = false;
    }
  }, [open, positioned]);

  useEffect(() => {
    if (!focusSearchNext.current) return;
    focusSearchNext.current = false;
    searchInput.current?.focus();
  }, [filtersOpen]);

  useEffect(() => {
    if (open && positioned && followLatest.current && list.current) {
      list.current.scrollTop = list.current.scrollHeight;
    }
  }, [entries, open, search, level, source, positioned, geometry?.width, geometry?.height]);

  if (!mounted) return null;

  const query = search.trim().toLowerCase();
  // A collapsed toolbar still filters, so the header has to say when something is hidden by it.
  const filtersActive = query !== '' || level !== 'all' || source !== 'all';
  const filteredEntries = open ? entries.filter((entry) =>
    (level === 'all' || entry.level === level) &&
    (source === 'all' || entry.source === source) &&
    (!query || entry.message.toLowerCase().includes(query)),
  ) : [];
  const errors = open ? entries.filter((entry) => entry.level === 'error').length : 0;

  function closePanel() {
    setOpen(false);
    setCopyStatus({ token: null, message: '' });
  }

  return createPortal(
    <div className={clsx('ls:pointer-events-none ls:fixed ls:inset-0 ls:box-border ls:font-sans ls:text-sm ls:leading-normal ls:tracking-normal ls:text-neutral-200 ls:scheme-dark', TOP_LAYER)}>
      {open && (
        <section
          ref={panelRef}
          style={panelStyle}
          id={panelId}
          aria-label="Log Scanner"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closePanel();
            }
          }}
          className="ls:pointer-events-auto ls:fixed ls:box-border ls:flex ls:min-h-0 ls:min-w-0 ls:flex-col ls:overflow-hidden ls:rounded-xl ls:border ls:border-solid ls:border-neutral-700 ls:bg-neutral-950 ls:shadow-2xl ls:shadow-black/20"
        >
          <header className="ls:relative ls:flex ls:shrink-0 ls:items-center ls:gap-2.5 ls:border-0 ls:border-b ls:border-solid ls:border-neutral-800 ls:bg-neutral-900 ls:py-2 ls:pr-3 ls:pl-9 ls:sm:pr-4">
            <button
              {...resizeStartProps}
              type="button"
              aria-label="Resize log panel from top left"
              aria-describedby={resizeStartHelpId}
              title="Drag to resize from top left"
              className="ls:absolute ls:top-2 ls:left-1 ls:flex ls:size-7 ls:touch-none ls:cursor-nwse-resize ls:items-center ls:justify-center ls:rounded ls:border-0 ls:bg-transparent ls:p-0 ls:text-neutral-400 ls:select-none ls:hover:text-neutral-100 ls:focus-visible:outline-2 ls:focus-visible:outline-neutral-300"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="ls:size-4"><path d="m5 14 9-9M5 9l4-4" /></svg>
            </button>
            <span id={resizeStartHelpId} className="ls:sr-only">Drag the top-left corner to resize. Left or up arrows enlarge the panel; right or down arrows shrink it. Hold Shift for one-pixel adjustments.</span>
            <h2 className="ls:sr-only">Log Scanner</h2>
            <button
              {...dragProps}
              type="button"
              aria-label="Move log panel"
              aria-describedby={moveHelpId}
              title="Drag to move · arrow keys to adjust"
              className={clsx('ls:flex ls:h-8 ls:min-w-0 ls:flex-1 ls:touch-none ls:items-center ls:gap-2.5 ls:rounded ls:border-0 ls:bg-transparent ls:p-0 ls:text-neutral-400 ls:select-none ls:focus-visible:outline-2 ls:focus-visible:outline-offset-2 ls:focus-visible:outline-neutral-300', interaction === 'drag' ? 'ls:cursor-grabbing' : 'ls:cursor-grab')}
            >
              <LogScannerLogo size={28} label="Log Scanner" className="ls:pointer-events-none ls:size-7 ls:shrink-0" />
              <span className="ls:rounded ls:bg-neutral-800 ls:px-1.5 ls:font-mono ls:text-xs ls:tabular-nums">{entries.length}</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="ls:ml-auto ls:size-4 ls:text-neutral-500"><circle cx="7" cy="6" r="1" /><circle cx="13" cy="6" r="1" /><circle cx="7" cy="10" r="1" /><circle cx="13" cy="10" r="1" /><circle cx="7" cy="14" r="1" /><circle cx="13" cy="14" r="1" /></svg>
            </button>
            <span id={moveHelpId} className="ls:sr-only">Drag to move the panel. Arrow keys move it ten pixels; hold Shift for one pixel.</span>
            <span className={clsx('ls:shrink-0 ls:text-xs', errors ? 'ls:text-red-300' : 'ls:text-neutral-400')}>{errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : 'No errors'}</span>
            <button
              type="button"
              aria-label={filtersOpen ? 'Hide filters' : 'Show filters'}
              aria-expanded={filtersOpen}
              aria-controls={filtersOpen ? filtersId : undefined}
              title={filtersOpen ? 'Hide filters' : 'Show filters'}
              onClick={() => {
                focusSearchNext.current = !filtersOpen;
                setFiltersOpen((value) => {
                  writeSession(FILTERS_KEY, !value);
                  return !value;
                });
              }}
              className={clsx(BUTTON, 'ls:w-8 ls:px-0', filtersOpen || filtersActive ? 'ls:border-neutral-500 ls:text-neutral-100' : 'ls:border-transparent')}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="ls:size-4"><path d="M3.5 5h13l-5 6v4.5l-3-1.5V11z" /></svg>
              {filtersActive && <span aria-hidden="true" className="ls:absolute ls:mt-4 ls:ml-4 ls:size-1.5 ls:rounded-full ls:bg-sky-400" />}
            </button>
            <button type="button" aria-label="Close log panel" title="Close panel (Esc)" onClick={closePanel} className={clsx(BUTTON, 'ls:w-8 ls:border-transparent ls:px-0')}>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="ls:size-4"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </header>

          {filtersOpen && (
          <div id={filtersId} className="ls:flex ls:shrink-0 ls:flex-wrap ls:items-center ls:gap-2 ls:border-0 ls:border-b ls:border-solid ls:border-neutral-800 ls:bg-neutral-900/50 ls:px-3 ls:py-2.5 ls:sm:px-4">
            <div className="ls:relative ls:min-w-40 ls:flex-1">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="ls:pointer-events-none ls:absolute ls:top-2 ls:left-2.5 ls:size-4 ls:text-neutral-400"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" /></svg>
              <label htmlFor={searchId} className="ls:sr-only">Search logs</label>
              <input
                ref={searchInput}
                id={searchId}
                type="search"
                autoComplete="off"
                value={search}
                placeholder="Filter messages…"
                onChange={(event) => { followLatest.current = true; setSearch(event.target.value); }}
                className={clsx(CONTROL, 'ls:w-full ls:pl-8 ls:placeholder:text-neutral-400')}
              />
            </div>
            <div className="ls:flex ls:min-w-0 ls:basis-64 ls:grow ls:items-center ls:gap-2">
              <div className="ls:min-w-0 ls:basis-24 ls:flex-1">
                <label htmlFor={levelId} className="ls:sr-only">Level</label>
                <select id={levelId} value={level} onChange={(event) => { followLatest.current = true; setLevel(event.target.value as typeof level); }} className={clsx(CONTROL, 'ls:w-full')}>
                  <option value="all">All levels</option>
                  {LOG_LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="ls:min-w-0 ls:basis-28 ls:flex-1">
                <label htmlFor={sourceId} className="ls:sr-only">Source</label>
                <select id={sourceId} value={source} onChange={(event) => { followLatest.current = true; setSource(event.target.value as typeof source); }} className={clsx(CONTROL, 'ls:w-full')}>
                  <option value="all">All sources</option>
                  <option value="browser">Browser</option>
                  <option value="network">Network</option>
                  <option value="server">Server</option>
                </select>
              </div>
              <button type="button" aria-label="Clear" title="Clear logs" disabled={entries.length === 0} onClick={() => { store.clear(); setCopyStatus({ token: null, message: 'Logs cleared.' }); followLatest.current = true; }} className={clsx(BUTTON, 'ls:w-8 ls:px-0')}>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="ls:size-3.5"><path d="M4 5h12M8 5V3h4v2M6 5l.7 11h6.6L14 5M9 8v5m2-5v5" /></svg>
              </button>
            </div>
          </div>
          )}

          <div
            ref={list}
            role="region"
            tabIndex={0}
            aria-label="Captured logs"
            onScroll={(event) => {
              const target = event.currentTarget;
              followLatest.current = target.scrollHeight - target.scrollTop - target.clientHeight <= 32;
            }}
            className="ls:min-h-0 ls:flex-1 ls:overflow-y-auto ls:overscroll-contain ls:focus-visible:outline-2 ls:focus-visible:-outline-offset-2 ls:focus-visible:outline-neutral-400"
          >
            {filteredEntries.length === 0 ? (
              <div className="ls:box-border ls:flex ls:h-full ls:min-h-32 ls:flex-col ls:items-center ls:justify-center ls:gap-2 ls:px-6 ls:py-8 ls:text-center">
                <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className="ls:mb-2 ls:size-8 ls:text-neutral-500"><rect x="3.5" y="5.5" width="25" height="21" rx="3" /><path d="m9 12 4 4-4 4m8 0h6" /></svg>
                <p className="ls:m-0 ls:text-sm ls:font-medium ls:text-neutral-200">{entries.length ? 'No matching logs' : 'Listening for logs'}</p>
                <p className="ls:m-0 ls:max-w-xs ls:text-xs ls:leading-5 ls:text-neutral-400">{entries.length ? 'Try another search, level, or source.' : 'Run your app. Its console output will appear here.'}</p>
              </div>
            ) : (
              <ol className="ls:m-0 ls:list-none ls:p-0">
                {filteredEntries.map((entry) => <LogEntryRow key={`${entry.source}:${entry.id}`} entry={entry} onCopyStatus={setCopyStatus} />)}
              </ol>
            )}
          </div>

          <footer className="ls:relative ls:shrink-0 ls:border-0 ls:border-t ls:border-solid ls:border-neutral-800 ls:bg-neutral-900 ls:py-2 ls:pr-10 ls:pl-3 ls:text-xs ls:leading-5 ls:sm:pl-4">
            <div className="ls:flex ls:items-center ls:justify-between ls:gap-3">
              <p role="status" aria-live="polite" className="ls:m-0 ls:flex ls:items-center ls:gap-2 ls:text-neutral-400">
                <span aria-hidden="true" className={clsx('ls:size-1.5 ls:shrink-0 ls:rounded-full', {
                  'ls:bg-emerald-400': connection.status === 'connected' || connection.status === 'browser-only',
                  'ls:bg-amber-400': connection.status === 'connecting' || connection.status === 'reconnecting',
                  'ls:bg-red-400': connection.status === 'error',
                })} />
                {connection.message}
              </p>
              <span aria-label={`${filteredEntries.length} matching of ${entries.length} captured logs`} className="ls:shrink-0 ls:font-mono ls:tabular-nums ls:text-neutral-400">{filteredEntries.length} / {entries.length}</span>
            </div>
            <p role="status" aria-live="polite" className={clsx('ls:m-0 ls:text-neutral-200', copyStatus.message && 'ls:pt-1')}>{copyStatus.message}</p>
            <button
              {...resizeProps}
              type="button"
              aria-label="Resize log panel"
              aria-describedby={resizeHelpId}
              title="Drag to resize · arrow keys to adjust"
              className="ls:absolute ls:right-1 ls:bottom-1 ls:flex ls:size-7 ls:touch-none ls:cursor-nwse-resize ls:items-center ls:justify-center ls:rounded ls:border-0 ls:bg-transparent ls:p-0 ls:text-neutral-400 ls:select-none ls:hover:text-neutral-100 ls:focus-visible:outline-2 ls:focus-visible:outline-neutral-300"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="ls:size-4"><path d="m6 15 9-9m-4 9 4-4" /></svg>
            </button>
            <span id={resizeHelpId} className="ls:sr-only">Drag to resize the panel. Arrow keys resize it ten pixels; hold Shift for one pixel.</span>
          </footer>
        </section>
      )}
      <button
        ref={launcher}
        type="button"
        aria-label={open ? 'Hide Log Scanner' : 'Open Log Scanner'}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={open ? 'Hide Log Scanner' : 'Open Log Scanner'}
        onClick={() => open ? closePanel() : setOpen(true)}
        className={clsx('ls:pointer-events-auto ls:fixed ls:box-border ls:flex ls:size-12 ls:cursor-pointer ls:items-center ls:justify-center ls:overflow-hidden ls:rounded-xl ls:border ls:border-solid ls:border-neutral-700 ls:bg-neutral-950 ls:p-0 ls:transition-colors ls:hover:border-neutral-400 ls:focus-visible:outline-2 ls:focus-visible:outline-offset-2 ls:focus-visible:outline-neutral-400 ls:motion-reduce:transition-none', LAUNCHER_POSITION[position])}
      >
        <LogScannerLogo size={48} label="Log Scanner" className="ls:pointer-events-none ls:block ls:size-full" />
      </button>
    </div>,
    document.body,
  );
}

export function LogScanner({ visible, enabled = false, serverUrl, maxLogs = 500, position = 'bottom-right', network = true }: LogScannerProps) {
  const active = visible ?? enabled;
  useEffect(() => {
    if (active) {
      // inject styles when scanner is active
      ensureStylesInjected();
    }
  }, [active]);
  useEffect(() => registerBrowserCaptureVisibility(active), [active]);
  if (!active) return null;
  return (
    <ErrorBoundary fallbackRender={({ resetErrorBoundary }) => <PanelFailure retry={resetErrorBoundary} />}>
      <ActiveScanner serverUrl={serverUrl} maxLogs={maxLogs} position={position} network={network} />
    </ErrorBoundary>
  );
}
