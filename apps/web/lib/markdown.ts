/**
 * A small markdown reader for the playbooks: the subset their files use
 * (headings, paragraphs, nested lists, quotes, fenced blocks, tables, rules,
 * bold, italics, inline code and links), turned into a tree of plain data.
 * The component that draws it (`components/playbooks/markdown-view.tsx`)
 * makes React elements from that tree, so text is always text: raw HTML in a
 * file is never interpreted (an HTML comment line, like the `<!-- muro -->`
 * marker, is dropped; anything else shows as the characters it is), and a
 * link only becomes a link when it points at `https:`, `http:` or a path of
 * this app.
 *
 * No library: the repo has no markdown dependency, and the playbooks are ours,
 * reviewed in a pull request, so the subset is known.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' };

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const COMMENT = /^\s*<!--.*-->\s*$/;

const isBlank = (line: string) => line.trim() === '';
const indentOf = (line: string) => line.length - line.trimStart().length;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || COMMENT.test(line);
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function isTableStart(lines: string[], i: number): boolean {
  const line = lines[i] ?? '';
  return line.trim().startsWith('|') && TABLE_DIVIDER.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('-');
}

/** One list from `lines[i]`; returns the list and the index after it. */
function parseList(lines: string[], start: number): [Block, number] {
  const first = ITEM.exec(lines[start]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: Block[][] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!);
    if (!m || m[1]!.length !== baseIndent || /\d/.test(m[2]!) !== ordered) break;
    const contentIndent = baseIndent + m[2]!.length + Math.max(1, m[3]!.length);
    const body: string[] = [m[4]!];
    i += 1;
    while (i < lines.length) {
      const line = lines[i]!;
      if (isBlank(line)) {
        // A blank line ends the item unless what follows is still inside it.
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j]!)) j += 1;
        if (j < lines.length && indentOf(lines[j]!) >= contentIndent) {
          body.push(...lines.slice(i, j).map(() => ''));
          i = j;
          continue;
        }
        break;
      }
      const indent = indentOf(line);
      if (indent >= contentIndent || (indent > baseIndent && ITEM.test(line))) {
        body.push(line.slice(Math.min(indent, contentIndent)));
        i += 1;
        continue;
      }
      // A lazy continuation of the item's first paragraph.
      if (!startsBlock(line) && !isTableStart(lines, i)) {
        body.push(line.trim());
        i += 1;
        continue;
      }
      break;
    }
    items.push(parseLines(body));
    // Blank lines between two items of the same list keep the list going.
    let j = i;
    while (j < lines.length && isBlank(lines[j]!)) j += 1;
    const next = j < lines.length ? ITEM.exec(lines[j]!) : null;
    if (next && next[1]!.length === baseIndent && /\d/.test(next[2]!) === ordered) i = j;
    else break;
  }
  return [{ kind: 'list', ordered, start: ordered ? Number.parseInt(first[2]!, 10) || 1 : 1, items }, i];
}

function parseLines(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line) || COMMENT.test(line)) {
      i += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      i += 1; // the closing fence (or the end of the text)
      out.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ kind: 'heading', level: Math.min(4, heading[1]!.length) as 1 | 2 | 3 | 4, text: heading[2]! });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ kind: 'rule' });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !isBlank(lines[i]!) && (QUOTE.test(lines[i]!) || !startsBlock(lines[i]!))) {
        inner.push(lines[i]!.replace(QUOTE, ''));
        i += 1;
      }
      out.push({ kind: 'quote', blocks: parseLines(inner) });
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(splitRow(lines[i++]!));
      out.push({ kind: 'table', header, rows });
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      out.push(list);
      i = next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]!) && (para.length === 0 || (!startsBlock(lines[i]!) && !isTableStart(lines, i)))) {
      para.push(lines[i]!.trim());
      i += 1;
    }
    out.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return out;
}

/** The blocks of a markdown text. */
export function parseMarkdown(markdown: string): Block[] {
  return parseLines(markdown.replace(/\r\n?/g, '\n').split('\n'));
}

/** A link target this app will follow: the web, or a path of its own. Anything else stays text. */
export function safeHref(href: string): string | null {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (href.startsWith('#')) return href;
  return null;
}

function closing(text: string, from: number, marker: string): number {
  let j = text.indexOf(marker, from);
  while (j > 0 && text[j - 1] === '\\') j = text.indexOf(marker, j + 1);
  return j;
}

/** The inline marks of one paragraph, heading or cell. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length && /[\\`*_[\]()#|>-]/.test(text[i + 1]!)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('**', i)) {
      const end = closing(text, i + 2, '**');
      if (end > i + 2) {
        flush();
        out.push({ kind: 'strong', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((c === '*' || c === '_') && text[i + 1] && !/\s/.test(text[i + 1]!)) {
      // `_` only between non-word characters, so snake_case stays text.
      const opens = c === '*' || i === 0 || !/\w/.test(text[i - 1]!);
      const end = opens ? closing(text, i + 1, c) : -1;
      if (end > i + 1 && !/\s/.test(text[end - 1]!) && (c === '*' || !/\w/.test(text[end + 1] ?? ''))) {
        flush();
        out.push({ kind: 'em', children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (m) {
        flush();
        const href = safeHref(m[2]!);
        const children = parseInline(m[1]!);
        if (href) out.push({ kind: 'link', href, children });
        else out.push(...children);
        i += m[0].length;
        continue;
      }
    }
    buf += c;
    i += 1;
  }
  flush();
  return out;
}

/** The plain text of an inline run, for anchors and accessible names. */
export function inlineText(text: string): string {
  const walk = (nodes: Inline[]): string =>
    nodes.map((n) => (n.kind === 'text' || n.kind === 'code' ? n.text : walk(n.children))).join('');
  return walk(parseInline(text));
}
