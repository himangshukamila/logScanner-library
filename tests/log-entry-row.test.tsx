// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../src/core/types.js';
import { LogEntryRow, type CopyStatus } from '../src/react/LogEntryRow.js';
import { copyTextForEntry, formatLogText } from '../src/react/formatLog.js';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function networkEntry(responseBody = '{"user":{"id":900719925474099312345,"name":"Sam"},"ok":true}'): LogEntry {
  return {
    id: 'network-response', timestamp: 1_700_000_000_000, source: 'network', level: 'info',
    args: [], message: 'POST /api/users → 200 · 12 ms',
    network: {
      method: 'POST', url: 'http://localhost/api/users', label: '/api/users', initiator: 'fetch',
      durationMs: 12.4, status: 200, statusText: 'OK', contentType: 'application/json',
      requestBody: '{"name":"Sam"}', responseBody,
    },
  };
}

function Row({ entry, show = true }: { entry: LogEntry; show?: boolean }) {
  const [status, setStatus] = useState<CopyStatus>({ token: null, message: '' });
  return <><ul>{show && <LogEntryRow entry={entry} onCopyStatus={setStatus} />}</ul><output>{status.message}</output></>;
}

function clipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

describe('log text formatting', () => {
  it('indents complete JSON while preserving exact numbers, duplicate keys, order, and string escapes', () => {
    const value = String.raw`{"id":900719925474099312345,"amount":1.2300e+04,"same":1,"same":2,"text":"a  b\n\u0063","items":[{},[]]}`;
    expect(formatLogText(value)).toBe(String.raw`{
  "id": 900719925474099312345,
  "amount": 1.2300e+04,
  "same": 1,
  "same": 2,
  "text": "a  b\n\u0063",
  "items": [
    {},
    []
  ]
}`);
  });

  it('preserves incomplete JSON, serialization markers, plain responses, and error stacks exactly', () => {
    for (const value of [
      '{"items":[1,2,… [truncated]',
      '{"self": [Circular]}',
      '<html>Server unavailable</html>',
      'Error: Request failed\n    at submit (app.ts:12:3)\n    at click (app.ts:40:2)',
      '  already plain  ',
    ]) expect(formatLogText(value)).toBe(value);
    const deep = `${'['.repeat(21)}0${']'.repeat(21)}`;
    expect(formatLogText(deep)).toBe(deep);
  });

  it('copies network metadata and captured bodies rather than only the summary', () => {
    const text = copyTextForEntry(networkEntry());
    expect(text).toContain('[network] [info] POST /api/users');
    expect(text).toContain('URL:\nhttp://localhost/api/users');
    expect(text).toContain('Status: 200 OK');
    expect(text).toContain('Initiator: fetch');
    expect(text).toContain('Duration: 12.4 ms');
    expect(text).toContain('Content type:\napplication/json');
    expect(text).toContain('Request body:\n{\n  "name": "Sam"\n}');
    expect(text).toContain('Response body:\n{\n  "user": {\n    "id": 900719925474099312345,');
  });

  it('copies labelled console JSON as separately formatted arguments and keeps empty-argument fallback', () => {
    const entry: LogEntry = {
      id: 'labelled-json', timestamp: 1_700_000_000_000, source: 'browser', level: 'info',
      args: ['response', '{"id":900719925474099312345,"ok":true}'],
      message: 'response {"id":900719925474099312345,"ok":true}',
    };
    expect(copyTextForEntry(entry)).toBe('[2023-11-14T22:13:20.000Z] [browser] [info] response\n{\n  "id": 900719925474099312345,\n  "ok": true\n}');
    expect(copyTextForEntry({ ...entry, args: [], message: 'Fallback message' })).toBe('[2023-11-14T22:13:20.000Z] [browser] [info] Fallback message');
  });
});

describe('LogEntryRow copying and readable details', () => {
  it('offers a visible Copy response action before opening details', async () => {
    const writeText = clipboard();
    render(<Row entry={networkEntry()} />);
    expect(screen.queryByLabelText('Response body')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    await screen.findByText('Response copied to clipboard.');
    expect(writeText).toHaveBeenLastCalledWith(formatLogText(networkEntry().network!.responseBody!));
    fireEvent.click(screen.getByRole('button', { name: 'Copy info entry' }));
    await screen.findByText('Log copied to clipboard.');
    expect(writeText).toHaveBeenLastCalledWith(copyTextForEntry(networkEntry()));
  });

  it('shows formatted response details and copies individual bodies without metadata', async () => {
    const writeText = clipboard();
    const { container } = render(<Row entry={networkEntry()} />);
    fireEvent.click(container.querySelector('summary')!);
    const response = await screen.findByLabelText('Response body');
    expect(response.textContent).toBe(formatLogText(networkEntry().network!.responseBody!));
    fireEvent.click(screen.getByRole('button', { name: 'Copy request body' }));
    await screen.findByText('Request body copied to clipboard.');
    expect(writeText).toHaveBeenLastCalledWith('{\n  "name": "Sam"\n}');
    fireEvent.click(screen.getByRole('button', { name: 'Copy response body' }));
    await screen.findByText('Response body copied to clipboard.');
    expect(writeText).toHaveBeenLastCalledWith(response.textContent);
  });

  it('retains empty response bodies as copyable payloads', async () => {
    const writeText = clipboard();
    render(<Row entry={networkEntry('')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    await screen.findByText('Response copied to clipboard.');
    expect(writeText).toHaveBeenCalledWith('');
  });

  it('displays full multiline errors and safely renders HTML-like strings as text', async () => {
    const writeText = clipboard();
    const message = 'Error: <script>alert(1)</script>\n    at submit (app.ts:12:3)\n    at click (app.ts:40:2)';
    const entry: LogEntry = { id: 'error', timestamp: 1_700_000_000_000, source: 'browser', level: 'error', args: [message], message };
    const { container } = render(<Row entry={entry} />);
    expect(container.querySelector('p')?.textContent).toBe(message);
    expect(container.querySelector('p')?.className).not.toContain('line-clamp');
    expect(container.querySelector('script')).toBeNull();
    fireEvent.click(container.querySelector('summary')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy error' }));
    await screen.findByText('Error copied to clipboard.');
    expect(writeText).toHaveBeenCalledWith(message);
  });

  it('does not allow overlapping section copies and ignores completion after unmount', async () => {
    let complete: () => void = () => {};
    const writeText = clipboard(vi.fn(() => new Promise<void>((resolve) => { complete = resolve; })));
    const entry = networkEntry();
    const view = render(<Row entry={entry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(screen.getByRole('button', { name: 'Copy info entry' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy response' })).toBeDisabled();
    view.rerender(<Row entry={entry} show={false} />);
    await act(async () => { complete(); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
