import type { ReactNode } from 'react';

// Previews are JSON-shaped but not valid JSON, so the tokens are matched rather than parsed.
const TOKEN = /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?\b)|(\b(?:true|false|null|undefined|NaN|Infinity)\b)|(\[(?:Circular|Function|Getter|Setter|Max depth|Unserializable|Invalid Date)\]|… \[truncated\])/g;

const TOKEN_CLASS = [
  'ls:text-neutral-400',           // property name
  'ls:text-emerald-300',           // string
  'ls:text-violet-300',            // number
  'ls:text-sky-300',               // keyword
  'ls:text-neutral-500 ls:italic', // serializer marker
];

// Long previews are rendered plain: colouring them costs more than it communicates.
const MAX_HIGHLIGHT_CHARS = 4000;

/** Colour the value shapes inside a serialized preview, leaving punctuation at the base colour. */
export function highlight(text: string): ReactNode {
  if (text.length > MAX_HIGHLIGHT_CHARS) return text;
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    const group = match.slice(1).findIndex((value) => value !== undefined);
    if (group < 0) continue;
    const token = match[group + 1]!;
    const start = match.index + match[0].indexOf(token);
    if (start > index) nodes.push(text.slice(index, start));
    nodes.push(<span key={key++} className={TOKEN_CLASS[group]}>{token}</span>);
    index = start + token.length;
  }
  if (nodes.length === 0) return text;
  if (index < text.length) nodes.push(text.slice(index));
  return nodes;
}
