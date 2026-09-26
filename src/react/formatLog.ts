import type { LogEntry } from '../core/types.js';

/** Format complete JSON containers without changing number tokens, key order, or escaping. */
export function formatLogText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  try { JSON.parse(trimmed); }
  catch { return text; }

  const tokens = trimmed.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? [];
  let depth = 0;
  let output = '';
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === '{' || token === '[') {
      output += token;
      depth += 1;
      if (depth > 20) return text;
      if (tokens[index + 1] !== '}' && tokens[index + 1] !== ']') output += `\n${'  '.repeat(depth)}`;
    } else if (token === '}' || token === ']') {
      depth -= 1;
      if (tokens[index - 1] !== '{' && tokens[index - 1] !== '[') output += `\n${'  '.repeat(depth)}`;
      output += token;
    } else if (token === ',') output += `,\n${'  '.repeat(depth)}`;
    else if (token === ':') output += ': ';
    else output += token;
    // Formatting should not turn a bounded preview into an enormous indented string.
    if (output.length > 65_536) return text;
  }
  return output;
}

export function sectionsForEntry(entry: LogEntry): Array<{ label: string; text: string }> {
  if (!entry.network) {
    return entry.args.map((text, index) => ({
      label: entry.level === 'error' && entry.args.length === 1 ? 'Error' : `Argument ${index + 1}`,
      text: formatLogText(text),
    }));
  }
  const { url, contentType, requestBody, responseBody, failed } = entry.network;
  return [
    ...(responseBody !== undefined ? [{ label: failed ? 'Error' : 'Response body', text: formatLogText(responseBody) }] : []),
    ...(requestBody !== undefined ? [{ label: 'Request body', text: formatLogText(requestBody) }] : []),
    { label: 'URL', text: url },
    ...(contentType ? [{ label: 'Content type', text: contentType }] : []),
  ];
}

export function copyTextForEntry(entry: LogEntry): string {
  const body = !entry.network && entry.args.length > 0
    ? entry.args.map(formatLogText).join('\n')
    : formatLogText(entry.message);
  const message = `[${new Date(entry.timestamp).toISOString()}] [${entry.source}] [${entry.level}] ${body}`;
  if (!entry.network) return message;
  const network = entry.network;
  const status = network.failed || network.status === undefined
    ? 'failed'
    : `${network.status}${network.statusText ? ` ${network.statusText}` : ''}`;
  return [
    message,
    `Initiator: ${network.initiator}`,
    `Status: ${status}`,
    `Duration: ${network.durationMs} ms`,
    ...sectionsForEntry(entry).map(({ label, text }) => `${label}:\n${text}`),
  ].join('\n\n');
}
