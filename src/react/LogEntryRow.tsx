import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import clsx from 'clsx';
import type { LogEntry, NetworkInfo } from '../core/types.js';
import { highlight } from './highlight.js';

const LEVEL_STYLES: Record<LogEntry['level'], string> = {
  log: 'ls:text-neutral-300',
  info: 'ls:text-sky-300',
  warn: 'ls:text-amber-300',
  error: 'ls:text-red-300',
  debug: 'ls:text-neutral-400',
};

export interface CopyStatus { token: symbol | null; message: string }

function statusStyle(network: NetworkInfo): string {
  if (network.failed || network.status === undefined || network.status >= 500) return 'ls:text-red-300';
  if (network.status >= 400) return 'ls:text-amber-300';
  if (network.status >= 300) return 'ls:text-sky-300';
  return 'ls:text-emerald-300';
}

function sectionsFor(entry: LogEntry): Array<{ label: string; text: string }> {
  if (!entry.network) return entry.args.map((text, index) => ({ label: `Argument ${index + 1}`, text }));
  const { url, contentType, requestBody, responseBody } = entry.network;
  return [
    { label: 'URL', text: url },
    ...(contentType ? [{ label: 'Content type', text: contentType }] : []),
    ...(requestBody ? [{ label: 'Request body', text: requestBody }] : []),
    ...(responseBody ? [{ label: 'Response body', text: responseBody }] : []),
  ];
}

function NetworkSummary({ network }: { network: NetworkInfo }) {
  return (
    <p className="ls:my-1 ls:flex ls:flex-wrap ls:items-center ls:gap-x-2 ls:gap-y-1 ls:font-mono ls:text-xs ls:leading-5">
      <span className="ls:rounded ls:bg-neutral-800 ls:px-1.5 ls:font-medium ls:text-neutral-300">{network.method}</span>
      <span className="ls:min-w-0 ls:break-all ls:text-neutral-200">{network.label}</span>
      <span className={clsx('ls:font-medium', statusStyle(network))}>
        {network.failed || network.status === undefined ? 'failed' : network.status}
      </span>
      <span className="ls:tabular-nums ls:text-neutral-500">{Math.round(network.durationMs)} ms</span>
    </p>
  );
}

export const LogEntryRow = memo(function LogEntryRow({ entry, onCopyStatus }: { entry: LogEntry; onCopyStatus: Dispatch<SetStateAction<CopyStatus>> }) {
  const [copying, setCopying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const active = useRef(false);
  const operation = useRef(0);
  const pendingCopy = useRef<symbol | null>(null);
  // Entries are frozen at capture time, so highlighting each one is a one-off cost.
  const message = useMemo(() => highlight(entry.message), [entry.message]);
  const sections = useMemo(() => sectionsFor(entry), [entry]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current += 1;
      const token = pendingCopy.current;
      if (token) onCopyStatus((current) => current.token === token ? { token: null, message: '' } : current);
    };
  }, [onCopyStatus]);

  async function copyEntry() {
    const current = ++operation.current;
    const token = Symbol('copy');
    pendingCopy.current = token;
    setCopying(true);
    onCopyStatus({ token, message: 'Copying log…' });
    const report = (message: string) => {
      if (active.current && current === operation.current) {
        onCopyStatus((status) => status.token === token ? { token: null, message } : status);
      }
    };
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(
        `[${new Date(entry.timestamp).toISOString()}] [${entry.source}] [${entry.level}] ${entry.message}`,
      );
      report('Log copied to clipboard.');
    } catch {
      report('Copy failed. Select and copy the log text manually.');
    } finally {
      if (active.current && current === operation.current) {
        pendingCopy.current = null;
        setCopying(false);
      }
    }
  }

  return (
    <li className={clsx('ls:group ls:box-border ls:border-0 ls:border-b ls:border-solid ls:border-neutral-800/80 ls:px-3 ls:py-2.5 ls:transition-colors ls:last:border-b-0 ls:hover:bg-neutral-900 ls:motion-reduce:transition-none ls:sm:px-4', {
      'ls:bg-amber-950/10': entry.level === 'warn',
      'ls:bg-red-950/15': entry.level === 'error',
    })}>
      <article>
        <div className="ls:flex ls:items-center ls:gap-3 ls:text-xs ls:leading-5">
          <time dateTime={new Date(entry.timestamp).toISOString()} className="ls:shrink-0 ls:font-mono ls:tabular-nums ls:text-neutral-500">
            {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}
          </time>
          <span className={clsx('ls:w-10 ls:shrink-0 ls:font-mono ls:font-medium ls:uppercase', LEVEL_STYLES[entry.level])}>
            {entry.level}
          </span>
          <span className="ls:text-neutral-500">{entry.source}</span>
          <button
            type="button"
            aria-label={`Copy ${entry.level} entry`}
            title={copying ? 'Copying…' : 'Copy entry'}
            disabled={copying}
            onClick={() => void copyEntry()}
            className="ls:ml-auto ls:flex ls:size-6 ls:shrink-0 ls:cursor-pointer ls:items-center ls:justify-center ls:rounded ls:border-0 ls:bg-transparent ls:p-0 ls:text-neutral-400 ls:transition-colors ls:hover:bg-neutral-800 ls:hover:text-white ls:focus-visible:outline-2 ls:focus-visible:outline-offset-2 ls:focus-visible:outline-neutral-300 ls:disabled:cursor-wait ls:disabled:opacity-60 ls:motion-reduce:transition-none"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={clsx('ls:size-3.5', copying && 'ls:animate-pulse ls:motion-reduce:animate-none')}>
              <rect x="7" y="7" width="9" height="10" rx="1.5" /><path d="M12 7V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" />
            </svg>
          </button>
        </div>
        {entry.network
          ? <NetworkSummary network={entry.network} />
          : <p className="ls:my-1 ls:line-clamp-2 ls:break-all ls:whitespace-pre-wrap ls:font-mono ls:text-xs ls:leading-5 ls:text-neutral-200">{entry.message ? message : '(empty log)'}</p>}
        {sections.length > 0 && (
          <details onToggle={(event) => setExpanded(event.currentTarget.open)} className="ls:mt-1 ls:text-xs ls:text-neutral-400">
            <summary className="ls:cursor-pointer ls:rounded ls:py-1 ls:leading-4 ls:transition-colors ls:hover:text-neutral-200 ls:focus-visible:outline-2 ls:focus-visible:outline-neutral-300 ls:motion-reduce:transition-none">
              {entry.network ? 'Inspect request' : `Inspect ${sections.length} ${sections.length === 1 ? 'argument' : 'arguments'}`}
            </summary>
            {expanded && sections.map((section) => (
              <div key={section.label} className="ls:my-2 ls:overflow-hidden ls:rounded-md ls:border ls:border-solid ls:border-neutral-800">
                <div className="ls:border-0 ls:border-b ls:border-solid ls:border-neutral-800 ls:bg-neutral-900 ls:px-3 ls:py-1 ls:font-mono ls:text-xs ls:leading-5 ls:text-neutral-400">{section.label}</div>
                <pre className="ls:m-0 ls:box-border ls:max-w-full ls:overflow-x-auto ls:bg-neutral-950 ls:p-3 ls:font-mono ls:text-xs ls:leading-5 ls:text-neutral-200">
                  {highlight(section.text)}
                </pre>
              </div>
            ))}
          </details>
        )}
      </article>
    </li>
  );
});
