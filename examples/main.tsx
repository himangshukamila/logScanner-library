import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import clsx from 'clsx';
import { name as packageName } from '../package.json';
import { mountLogScanner } from '../src/index.js';
import { LogScannerLogo } from '../src/react/logo.js';
import '../src/styles.css';
import './styles.css';

const params = new URLSearchParams(location.search);
const initiallyVisible = import.meta.env.DEV && !params.has('disabled');
const launcherPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;
const requestedPosition = launcherPositions.find((value) => value === params.get('position')) ?? 'bottom-right';
const scanner = mountLogScanner({ visible: initiallyVisible, serverUrl: '/__log-scanner/events', position: requestedPosition });
if (initiallyVisible) console.info('Log Scanner is ready. Browser capture started before React mounted.');

const buttonClass = 'demo:shrink-0 demo:cursor-pointer demo:rounded-lg demo:border demo:border-solid demo:border-stone-300 demo:bg-white demo:px-3 demo:py-2 demo:text-xs demo:font-medium demo:leading-5 demo:text-stone-800 demo:transition-colors demo:hover:bg-stone-100 demo:focus-visible:outline-2 demo:focus-visible:outline-offset-4 demo:focus-visible:outline-stone-800 demo:disabled:cursor-wait demo:disabled:opacity-60';
const sectionClass = 'demo:overflow-hidden demo:rounded-lg demo:border demo:border-solid demo:border-stone-200 demo:bg-white';

const browserActions = [
  {
    method: 'console.log',
    description: 'A message with browser metadata.',
    label: 'Log a message',
    run: () => console.log('Hello from the browser', { page: location.pathname, language: navigator.language }),
  },
  {
    method: 'console.warn',
    description: 'A warning with additional context.',
    label: 'Log a warning',
    run: () => console.warn('A development warning', { remaining: 3 }),
  },
  {
    method: 'console.error',
    description: 'An Error instance and its stack trace.',
    label: 'Log an error',
    run: () => console.error(new Error('An example console error')),
  },
  {
    method: 'console.info',
    description: 'A circular object and a BigInt value.',
    label: 'Log an object',
    run: () => {
      const value: { label: string; self?: unknown } = { label: 'Circular object' };
      value.self = value;
      console.info('Object inspection', value, 42n);
    },
  },
  {
    method: 'console.debug',
    description: 'A burst of 100 messages in sequence.',
    label: 'Send 100 logs',
    run: () => {
      for (let index = 1; index <= 100; index += 1) console.debug(`Burst message ${index}`);
    },
  },
  {
    method: 'fetch',
    description: 'A request that answers 404, captured as a network entry.',
    label: 'Fetch a missing route',
    run: () => { void fetch('/api/missing').catch(() => {}); },
  },
];

function App() {
  const [visible, setVisible] = useState(initiallyVisible);
  const [crashed, setCrashed] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('Ready for a request.');
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  if (crashed) throw new Error('Demo application render failed. The independent console is still available.');

  async function checkServer() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setStatus('Checking the local Node.js server…');
    const data = { message: 'Check the development server' };
    console.log('send data to server', data);
    try {
      const response = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
      const result: { uptime: number; requestId: string } = await response.json();
      if (controller.signal.aborted) return;
      console.log('this is server responce', result);
      setStatus(`Server connected · uptime ${Math.round(result.uptime)}s · request ${result.requestId.slice(0, 8)}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.log('Server check failed', error);
      setStatus(error instanceof Error ? error.message : 'Could not reach the server.');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function toggleScanner() {
    const next = !visible;
    scanner.update({ visible: next });
    setVisible(next);
  }

  return (
    <>
      <header className="demo:border-0 demo:border-b demo:border-solid demo:border-stone-200 demo:bg-white">
        <div className="demo:mx-auto demo:flex demo:max-w-6xl demo:flex-wrap demo:items-center demo:justify-between demo:gap-4 demo:px-5 demo:py-5 demo:sm:px-8">
          <nav aria-label="Main navigation" className="demo:flex demo:items-center demo:gap-4">
            <a href="/" className="demo:flex demo:items-center demo:gap-2.5 demo:text-stone-900 demo:no-underline demo:focus-visible:outline-2 demo:focus-visible:outline-offset-4 demo:focus-visible:outline-stone-800">
              <LogScannerLogo size={28} className="demo:size-7 demo:shrink-0 demo:rounded-md demo:bg-[#061F3E]" />
              <span className="demo:text-sm demo:font-semibold demo:tracking-tight">Log Scanner</span>
            </a>
            <span aria-hidden="true" className="demo:text-stone-300">/</span>
            <a href="#playground" aria-current="page" className="demo:text-xs demo:font-medium demo:text-stone-600 demo:no-underline demo:hover:text-stone-900 demo:focus-visible:outline-2 demo:focus-visible:outline-offset-4 demo:focus-visible:outline-stone-800">Playground</a>
          </nav>
          <span role="status" className="demo:flex demo:items-center demo:gap-2 demo:text-xs demo:text-stone-600">
            <span aria-hidden="true" className={clsx('demo:size-1.5 demo:rounded-full', visible ? 'demo:bg-emerald-600' : 'demo:bg-stone-400')} />
            {visible ? 'Capture enabled' : 'Capture disabled'}
          </span>
        </div>
      </header>

      <main id="playground" className="demo:box-border demo:mx-auto demo:min-h-screen demo:max-w-6xl demo:px-5 demo:pb-32 demo:pt-10 demo:sm:px-8 demo:sm:pt-12">
        <div className="demo:mb-8 demo:sm:mb-10">
          <h1 className="demo:m-0 demo:text-3xl demo:font-semibold demo:leading-tight demo:tracking-tight">Console playground</h1>
          <p className="demo:mb-0 demo:mt-3 demo:max-w-2xl demo:text-sm demo:leading-6 demo:text-stone-600">Generate a browser log or make a server request. Inspect the output in the scanner at the bottom right.</p>
          <button type="button" className={clsx(buttonClass, 'demo:mt-4')} onClick={() => setCrashed(true)}>Crash demo app</button>
        </div>

        <div className="demo:grid demo:items-start demo:gap-6 demo:lg:grid-cols-5">
          <section aria-labelledby="browser-title" className={clsx(sectionClass, 'demo:lg:col-span-3')}>
            <div className="demo:border-0 demo:border-b demo:border-solid demo:border-stone-200 demo:px-5 demo:py-5 demo:sm:px-6">
              <div className="demo:flex demo:items-center demo:justify-between demo:gap-3">
                <h2 id="browser-title" className="demo:m-0 demo:text-sm demo:font-semibold">Browser logs</h2>
                <span className="demo:rounded demo:bg-stone-100 demo:px-2 demo:py-1 demo:font-mono demo:text-xs demo:leading-4 demo:text-stone-600">console.*</span>
              </div>
              <p className="demo:mb-0 demo:mt-2 demo:text-xs demo:leading-5 demo:text-stone-500">Run a console call from this tab.</p>
            </div>
            <ul className="demo:m-0 demo:list-none demo:p-0">
              {browserActions.map((action, index) => (
                <li key={action.method} className={clsx('demo:flex demo:flex-wrap demo:items-center demo:justify-between demo:gap-x-4 demo:gap-y-3 demo:px-5 demo:py-5 demo:sm:px-6', index > 0 && 'demo:border-0 demo:border-t demo:border-solid demo:border-stone-100')}>
                  <div className="demo:min-w-32 demo:flex-1">
                    <code className="demo:font-mono demo:text-xs demo:font-medium demo:leading-5 demo:text-stone-800">{action.method}()</code>
                    <p className="demo:mb-0 demo:mt-1 demo:text-xs demo:leading-5 demo:text-stone-500">{action.description}</p>
                  </div>
                  <button type="button" className={buttonClass} onClick={action.run}>{action.label}</button>
                </li>
              ))}
            </ul>
            <div className="demo:border-0 demo:border-t demo:border-solid demo:border-stone-200 demo:bg-stone-50 demo:px-5 demo:py-3 demo:sm:px-6">
              <p className="demo:m-0 demo:text-xs demo:leading-5 demo:text-stone-500">Console output stays available in your browser’s developer tools.</p>
            </div>
          </section>

          <div className="demo:grid demo:gap-6 demo:lg:col-span-2">
            <section aria-labelledby="server-title" className={clsx(sectionClass, 'demo:p-5 demo:sm:p-6')}>
              <div className="demo:flex demo:items-center demo:justify-between demo:gap-3">
                <h2 id="server-title" className="demo:m-0 demo:text-sm demo:font-semibold">Server request</h2>
                <span className="demo:text-xs demo:text-stone-500">Node.js / Express</span>
              </div>
              <p className="demo:mb-5 demo:mt-3 demo:text-xs demo:leading-6 demo:text-stone-600">Call the local server to see its response and console output alongside your browser logs.</p>
              <div className="demo:mb-5 demo:flex demo:items-center demo:gap-3 demo:rounded-md demo:border demo:border-solid demo:border-stone-200 demo:bg-stone-50 demo:px-3 demo:py-3 demo:font-mono demo:text-xs">
                <span className="demo:font-medium demo:text-stone-500">POST</span>
                <code className="demo:font-mono demo:text-stone-800">/api/check</code>
              </div>
              <button type="button" className="demo:cursor-pointer demo:rounded-lg demo:border demo:border-solid demo:border-stone-900 demo:bg-stone-900 demo:px-3 demo:py-2 demo:text-xs demo:font-medium demo:leading-5 demo:text-white demo:transition-colors demo:hover:bg-stone-700 demo:focus-visible:outline-2 demo:focus-visible:outline-offset-4 demo:focus-visible:outline-stone-800 demo:disabled:cursor-wait demo:disabled:opacity-60" onClick={checkServer} disabled={pending}>{pending ? 'Checking server…' : 'Run server check'}</button>
              <p role="status" className="demo:mb-0 demo:mt-4 demo:break-words demo:text-xs demo:leading-5 demo:text-stone-500">{status}</p>
            </section>

            <section aria-labelledby="capture-title" className={clsx(sectionClass, 'demo:p-5 demo:sm:p-6')}>
              <div className="demo:flex demo:items-center demo:justify-between demo:gap-3">
                <h2 id="capture-title" className="demo:m-0 demo:text-sm demo:font-semibold">Capture</h2>
                <span className={clsx('demo:text-xs demo:font-medium', visible ? 'demo:text-emerald-700' : 'demo:text-stone-500')}>{visible ? 'On' : 'Off'}</span>
              </div>
              <p className="demo:mb-4 demo:mt-3 demo:text-xs demo:leading-6 demo:text-stone-600">Keep the latest 500 entries in memory. Disabling capture removes the panel and disconnects the log stream.</p>
              <button type="button" aria-pressed={visible} onClick={toggleScanner} className={buttonClass} disabled={!import.meta.env.DEV}>{visible ? 'Disable scanner' : 'Enable scanner'}</button>
            </section>
          </div>
        </div>

        <section aria-labelledby="integration-title" className="demo:mt-8 demo:grid demo:gap-4 demo:border-0 demo:border-t demo:border-solid demo:border-stone-200 demo:pt-6 demo:lg:grid-cols-5 demo:lg:gap-6">
          <div className="demo:lg:col-span-2">
            <h2 id="integration-title" className="demo:m-0 demo:text-sm demo:font-medium">Add it to your app</h2>
            <p className="demo:mb-0 demo:mt-2 demo:max-w-xs demo:text-xs demo:leading-6 demo:text-stone-500">Start the console before rendering your app. Its separate React root stays available if the app crashes.</p>
          </div>
          <pre className="demo:m-0 demo:overflow-x-auto demo:rounded-lg demo:border demo:border-solid demo:border-stone-200 demo:bg-white demo:p-4 demo:font-mono demo:text-xs demo:leading-6 demo:text-stone-700 demo:lg:col-span-3"><code>{`import { mountLogScanner } from '${packageName}';

const scanner = mountLogScanner({ visible: import.meta.env.DEV });
import.meta.hot?.dispose(() => scanner.dispose());`}</code></pre>
        </section>
      </main>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The example root element is missing.');
const appRoot = createRoot(root);
appRoot.render(
  <StrictMode>
    {params.has('uncaught') ? <App /> : (
      <ErrorBoundary
        onError={(error, info) => console.error('Application render failed', error, info.componentStack)}
        fallback={<p role="alert" className="demo:p-6">The playground crashed. Open the console to inspect and copy the error. Reload to try again.</p>}
      >
        <App />
      </ErrorBoundary>
    )}
  </StrictMode>,
);
import.meta.hot?.dispose(() => { scanner.dispose(); appRoot.unmount(); });
