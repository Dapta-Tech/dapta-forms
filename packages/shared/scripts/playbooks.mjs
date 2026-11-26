#!/usr/bin/env node
/**
 * Builds `src/playbooks.generated.ts` from `content/playbooks/<locale>/*.md`.
 *
 * The playbooks are written as markdown files, one per playbook and language:
 * `content/playbooks/es/<slug>.md` and `content/playbooks/en/<slug>.md`. Each
 * holds a front matter block with the catalog fields, then the body, split in
 * two by a line that holds only `<!-- muro -->`. Above the marker is the
 * preview (anyone may read it), below it the rest (signed-in people only).
 *
 * Spanish (`es`) is the base: it is what the API serves when a language it
 * is asked for has no version of a playbook. Here every language must have
 * exactly the same slugs (parity): a playbook missing in one language, or
 * present only in a translation, fails the build, so one never ships half
 * translated. Between the languages of one playbook, `category`, `publishedAt` and
 * `promisedBy` must be equal (they are the playbook, not its words), the
 * inline media markers must name the same assets in the same order (only the
 * alt is translated), and a thumbnail in one language needs one in the other.
 *
 * The package is compiled with plain `tsc` and imported by both apps, so it
 * cannot read files at runtime: this script turns the markdown into a typed
 * module that is committed next to the code. Run it after editing a playbook:
 *
 *   pnpm --filter @quill/shared playbooks
 *
 * `--check` writes nothing and fails when the committed module is out of date;
 * `src/playbooks.spec.ts` runs it, so CI catches a markdown edit that was
 * never regenerated.
 *
 * Front matter is a small, strict subset of YAML: one `key: value` per line,
 * a value plain, "double quoted" (JSON escapes), 'single quoted', or a list
 * `[a, b]` whose items hold no comma (quoted or not). An unknown key, a missing field or a malformed value fails the
 * build with the file and the line, so a typo never ships as a silent default.
 *
 * The body may place inline media with a line of its own:
 * `<!-- anim: <slug>/<name> | <alt> -->` (a loop) or
 * `<!-- img: <slug>/<name> | <alt> -->` (a still). The grammar is the one of
 * `src/playbook-media.ts`; here a line that means to be a marker and is not a
 * valid one, or names another playbook, fails the build, and so does an HTML
 * comment that is never closed (the reader would hide the rest of the text)
 * or that wraps the `<!-- muro -->` line.
 * A root-relative thumbnail must sit in its language's folder,
 * `/playbooks/<locale>/<slug>...`, so a translation never shows the Spanish
 * card by accident. Whether the files exist is checked in the web app, which
 * serves them (`apps/web/lib/playbook-media.spec.ts`, under
 * `public/playbooks/<locale>/` and `public/playbooks/inline/<locale>/`): a
 * package never reads an app.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_DIR = join(ROOT, 'content', 'playbooks');
export const OUT_FILE = join(ROOT, 'src', 'playbooks.generated.ts');

/** Keep in step with `PLAYBOOK_LOCALES` in src/playbooks.ts. The first is the base. */
export const LOCALES = ['es', 'en'];
export const BASE_LOCALE = LOCALES[0];
/** Keep in step with `PLAYBOOK_CATEGORIES` in src/playbooks.ts. */
export const CATEGORIES = ['ventas', 'marketing', 'ads', 'agentes'];
export const MARKER = '<!-- muro -->';
/** Keep in step with `src/playbook-media.ts`. */
export const MEDIA_KINDS = ['anim', 'img'];
const MEDIA_HINT = /<!--\s*(?:anim|img)\b/;
const MEDIA_LOOSE = /^<!--\s*(anim|img):\s*([^/|\s]*)\/([^|\s]*)\s*(?:\|(.*?))?\s*-->$/;
const MEDIA_TOKEN = /^[a-z0-9-]+$/;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A social account handle as the landing reads it from `utm_source`, e.g. `ig_homerovende`. */
const ACCOUNT = /^[a-z0-9][a-z0-9_.]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
/** A root-relative path or an https URL, with no spaces. */
const MEDIA = /^(?:\/(?!\/)|https:\/\/)\S+$/;

/** Every front matter key, whether it is required, and how its value is read. */
const FIELDS = {
  slug: { required: true, kind: 'string' },
  category: { required: true, kind: 'string' },
  title: { required: true, kind: 'string' },
  summary: { required: true, kind: 'string' },
  publishedAt: { required: true, kind: 'string' },
  promisedBy: { required: false, kind: 'list' },
  template: { required: true, kind: 'string' },
  thumbnailVideo: { required: false, kind: 'string' },
  thumbnailPoster: { required: false, kind: 'string' },
  thumbnailMotif: { required: false, kind: 'string' },
};

class PlaybookError extends Error {}

/**
 * One inline media marker line, read: `{ kind, slug, name, alt }`. Throws
 * with the file and line when the line is not a valid marker of the playbook
 * `slug`. Indentation is refused too: a marker is a block of its own.
 */
export function readMediaMarker(file, lineNo, line, slug) {
  const stripped = line.replace(/\s+$/, '');
  if (stripped !== stripped.trimStart() || !stripped.startsWith('<!--')) {
    fail(file, lineNo, 'an anim or img marker must be a line of its own, unindented');
  }
  const m = MEDIA_LOOSE.exec(stripped);
  if (!m) fail(file, lineNo, `malformed marker, expected <!-- anim: ${slug}/<name> | <alt> --> or <!-- img: ... -->: ${stripped}`);
  const [, kind, markerSlug, name, rawAlt] = m;
  if (!MEDIA_TOKEN.test(markerSlug) || markerSlug !== slug) {
    fail(file, lineNo, `${kind} marker names the playbook ${markerSlug || '(none)'}, it must be ${slug}`);
  }
  if (!MEDIA_TOKEN.test(name)) fail(file, lineNo, `${kind} marker name ${name || '(none)'} must be lowercase letters, digits and hyphens`);
  const alt = (rawAlt ?? '').trim();
  if (alt === '') fail(file, lineNo, `${kind} marker ${slug}/${name} needs an alt text after |`);
  if (alt.includes('-->') || alt.includes('<!--')) fail(file, lineNo, `${kind} marker ${slug}/${name}: the alt cannot hold <!-- or -->`);
  return { kind, slug: markerSlug, name, alt };
}

/**
 * The inline media markers of a body, checked; also refuses an HTML comment
 * that never closes, and one that wraps the `<!-- muro -->` line (body index
 * `wallAt`), which would hide the end of the preview and show a stray `-->`
 * at the top of the rest. Fenced code is skipped: a marker shown as code is
 * code. When a comment closes partway through a line, what follows the close
 * is read with the same rules, as the reader does. `firstLine` is the file
 * line of `body[0]`.
 */
export function readMediaMarkers(file, body, firstLine, slug, wallAt = -1) {
  const out = [];
  let inCode = false;
  let openedAt = 0;
  // A whole line, or what a closing comment leaves of one.
  const read = (text, lineNo) => {
    if (MEDIA_HINT.test(text)) {
      out.push(readMediaMarker(file, lineNo, text, slug));
      return;
    }
    // Any other comment is free, but it must close, or the reader would drop everything after it.
    const without = text.replace(/<!--[\s\S]*?-->/g, '');
    if (without.includes('<!--')) openedAt = lineNo;
  };
  body.forEach((line, k) => {
    const lineNo = firstLine + k;
    if (openedAt) {
      if (k === wallAt) fail(file, lineNo, `${MARKER} is inside the HTML comment opened on line ${openedAt}`);
      const close = line.indexOf('-->');
      if (close === -1) return;
      openedAt = 0;
      const after = line.slice(close + 3);
      if (after.trim() !== '') read(after, lineNo);
      return;
    }
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    read(line, lineNo);
  });
  if (openedAt) fail(file, openedAt, 'an HTML comment is opened here and never closed');
  return out;
}

function fail(file, line, message) {
  throw new PlaybookError(`${file}${line ? `:${line}` : ''}: ${message}`);
}

function unquote(raw, file, line) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      const parsed = JSON.parse(v);
      if (typeof parsed !== 'string') throw new Error('not a string');
      return parsed;
    } catch {
      fail(file, line, `malformed double-quoted value ${v}`);
    }
  }
  if (v.startsWith("'")) {
    if (v.length < 2 || !v.endsWith("'")) fail(file, line, `malformed single-quoted value ${v}`);
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

function readList(raw, file, line) {
  const v = raw.trim();
  if (!v.startsWith('[') || !v.endsWith(']')) fail(file, line, `expected a list like [a, b], got ${v}`);
  const inner = v.slice(1, -1).trim();
  if (inner === '') return [];
  // Items are split on commas BEFORE quotes are read, so a comma inside an
  // item would silently make two. List items are account handles, which never
  // hold one: refuse a quoted item that would have been cut.
  return inner.split(',').map((item) => {
    const trimmed = item.trim();
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'") && (trimmed.length < 2 || !trimmed.endsWith(quote))) {
      fail(file, line, `list items cannot hold a comma: ${v}`);
    }
    const value = unquote(item, file, line);
    if (value === '') fail(file, line, 'empty list item');
    return value;
  });
}

/** Bogota time (UTC-5, no daylight saving), like the announcements' dates. */
function readDate(value, file, line) {
  const bad = () => fail(file, line, `publishedAt must be a real YYYY-MM-DD date or an ISO date-time with an offset, got ${value}`);
  if (!DATE.test(value) && !DATETIME.test(value)) bad();
  // Date.parse rolls an impossible day over (2026-02-30 is March 2), so the
  // calendar date is read back and compared with what was written.
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) bad();
  if (DATETIME.test(value)) {
    const [hh, mm, ss = 0] = value.slice(11, 19).split(':').map((n) => Number.parseInt(n, 10));
    if (hh > 23 || mm > 59 || ss > 59) bad();
  }
  const ms = DATE.test(value) ? Date.parse(`${value}T00:00:00-05:00`) : Date.parse(value);
  if (!Number.isFinite(ms)) bad();
  return ms;
}

/**
 * One markdown file into one catalog entry, with what the cross-language
 * checks need: its markers. Throws with the file and line on anything it does
 * not understand.
 */
export function readPlaybookFile(file, text, locale = BASE_LOCALE) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') fail(file, 1, 'must start with a --- front matter line');
  const end = lines.indexOf('---', 1);
  if (end === -1) fail(file, 1, 'front matter is never closed with ---');

  const meta = {};
  for (let i = 1; i < end; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    if (line.trim() === '') continue;
    const m = /^([A-Za-z][A-Za-z0-9]*):(.*)$/.exec(line);
    if (!m) fail(file, lineNo, `expected key: value, got ${line}`);
    const [, key, raw] = m;
    const field = FIELDS[key];
    if (!field) fail(file, lineNo, `unknown front matter key ${key}`);
    if (key in meta) fail(file, lineNo, `${key} is set twice`);
    meta[key] = field.kind === 'list' ? readList(raw, file, lineNo) : unquote(raw, file, lineNo);
    if (field.kind === 'string' && meta[key] === '') fail(file, lineNo, `${key} is empty`);
  }
  for (const [key, field] of Object.entries(FIELDS)) {
    if (field.required && !(key in meta)) fail(file, 0, `missing ${key}`);
  }

  if (!SLUG.test(meta.slug)) fail(file, 0, `slug ${meta.slug} must be lowercase words joined by hyphens`);
  const expectedFile = `${meta.slug}.md`;
  if (basename(file) !== expectedFile) fail(file, 0, `slug ${meta.slug} must match the file name (${expectedFile})`);
  if (!CATEGORIES.includes(meta.category)) {
    fail(file, 0, `category ${meta.category} is not one of ${CATEGORIES.join(', ')}`);
  }
  const promisedBy = meta.promisedBy ?? [];
  for (const account of promisedBy) {
    if (!ACCOUNT.test(account)) fail(file, 0, `promisedBy account ${account} must look like ig_handle`);
  }
  if (new Set(promisedBy).size !== promisedBy.length) fail(file, 0, 'promisedBy repeats an account');
  for (const key of ['thumbnailVideo', 'thumbnailPoster']) {
    if (meta[key] !== undefined && !MEDIA.test(meta[key])) {
      fail(file, 0, `${key} must be a path starting with / or an https URL, got ${meta[key]}`);
    }
    const own = `/playbooks/${locale}/${meta.slug}`;
    if (meta[key] !== undefined && meta[key].startsWith('/') && !(meta[key].startsWith(`${own}.`) || meta[key].startsWith(`${own}-`))) {
      fail(file, 0, `${key} must be this language's file, ${own}.<ext> or ${own}-<name>.<ext>, got ${meta[key]}`);
    }
  }
  if (meta.thumbnailVideo !== undefined && !/\.(?:webm|mp4)(?:\?\S*)?$/.test(meta.thumbnailVideo)) {
    fail(file, 0, 'thumbnailVideo must be a .webm or .mp4 file');
  }
  if (meta.thumbnailPoster !== undefined && !/\.(?:png|jpe?g|webp|avif)(?:\?\S*)?$/.test(meta.thumbnailPoster)) {
    fail(file, 0, 'thumbnailPoster must be an image (.png, .jpg, .webp or .avif)');
  }

  const body = lines.slice(end + 1);
  const markers = body.reduce((n, line) => (line.trim() === MARKER ? n + 1 : n), 0);
  if (markers !== 1) fail(file, 0, `the body must hold exactly one ${MARKER} line, found ${markers}`);
  const at = body.findIndex((line) => line.trim() === MARKER);
  const preview = body.slice(0, at).join('\n').trim();
  const rest = body.slice(at + 1).join('\n').trim();
  if (preview === '') fail(file, 0, `nothing above ${MARKER}: the preview is empty`);
  if (rest === '') fail(file, 0, `nothing below ${MARKER}: the rest is empty`);
  const media = readMediaMarkers(file, body, end + 2, meta.slug, at);

  const entry = {
    slug: meta.slug,
    locale,
    category: meta.category,
    title: meta.title,
    summary: meta.summary,
    publishedAt: readDate(meta.publishedAt, file, 0),
    promisedBy,
    template: meta.template,
    thumbnailVideo: meta.thumbnailVideo ?? null,
    thumbnailPoster: meta.thumbnailPoster ?? null,
    thumbnailMotif: meta.thumbnailMotif ?? null,
    preview,
    rest,
  };
  return { entry, media };
}

/** One markdown file into one catalog entry (`readPlaybookFile` without the extras). */
export function parsePlaybook(file, text, locale = BASE_LOCALE) {
  return readPlaybookFile(file, text, locale).entry;
}

/** The playbooks of one language folder, by file name; none when the folder is not there yet. */
function readLocale(dir, locale) {
  const folder = join(dir, locale);
  if (!existsSync(folder)) return [];
  const files = readdirSync(folder)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const read = files.map((f) => readPlaybookFile(`content/playbooks/${locale}/${f}`, readFileSync(join(folder, f), 'utf8'), locale));
  const slugs = new Set();
  for (const { entry } of read) {
    if (slugs.has(entry.slug)) throw new PlaybookError(`slug ${entry.slug} is used twice in ${locale}`);
    slugs.add(entry.slug);
  }
  return read;
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The checks between the languages of one playbook: it exists in every
 * language, the fields that are
 * the playbook and not its words are equal, the markers name the same assets
 * in the same order, and a thumbnail in one language has one in the other.
 */
function checkParity(byLocale) {
  const base = new Map(byLocale[BASE_LOCALE].map((r) => [r.entry.slug, r]));
  for (const locale of LOCALES) {
    if (locale === BASE_LOCALE) continue;
    const here = new Map(byLocale[locale].map((r) => [r.entry.slug, r]));
    for (const slug of here.keys()) {
      if (!base.has(slug)) {
        fail(`content/playbooks/${locale}/${slug}.md`, 0, `has no ${BASE_LOCALE} version (content/playbooks/${BASE_LOCALE}/${slug}.md), the one every language falls back to`);
      }
    }
    for (const [slug, b] of base) {
      const baseFile = `content/playbooks/${BASE_LOCALE}/${slug}.md`;
      const file = `content/playbooks/${locale}/${slug}.md`;
      const t = here.get(slug);
      if (!t) fail(baseFile, 0, `has no ${locale} version: add ${file} (every playbook ships in every language)`);
      for (const key of ['category', 'publishedAt']) {
        if (t.entry[key] !== b.entry[key]) fail(file, 0, `${key} must be the same as in ${baseFile}`);
      }
      if (!sameList(t.entry.promisedBy, b.entry.promisedBy)) fail(file, 0, `promisedBy must be the same as in ${baseFile}`);
      for (const key of ['thumbnailVideo', 'thumbnailPoster']) {
        if ((t.entry[key] === null) !== (b.entry[key] === null)) {
          fail(file, 0, `${key} must be set in both languages or in neither (${baseFile} ${b.entry[key] === null ? 'has none' : 'has one'})`);
        }
      }
      const ids = (r) => r.media.map((m) => `${m.kind}: ${m.slug}/${m.name}`);
      const want = ids(b);
      const got = ids(t);
      if (!sameList(got, want)) {
        const i = want.findIndex((m, k) => got[k] !== m);
        const at = i < 0 ? want.length : i;
        fail(
          file,
          0,
          `its anim and img markers must name the same assets, in the same order, as ${baseFile} (only the alt is translated): marker ${at + 1} is ${got[at] ?? '(none)'}, ${BASE_LOCALE} has ${want[at] ?? '(none)'}`,
        );
      }
    }
  }
}

/**
 * Every playbook of every language, `{ es: [...], en: [...] }`, checked one
 * by one and against each other. A markdown file outside a language folder,
 * or a folder that is not a language, fails: nothing is skipped silently.
 */
export function readCatalog(dir = CONTENT_DIR) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    if (statSync(join(dir, name)).isDirectory()) {
      if (!LOCALES.includes(name)) fail(`content/playbooks/${name}`, 0, `is not a language folder (${LOCALES.join(', ')})`);
    } else if (name.endsWith('.md')) {
      fail(`content/playbooks/${name}`, 0, `a playbook lives in its language folder, content/playbooks/${BASE_LOCALE}/${name}`);
    }
  }
  const byLocale = Object.fromEntries(LOCALES.map((l) => [l, readLocale(dir, l)]));
  checkParity(byLocale);
  return Object.fromEntries(LOCALES.map((l) => [l, byLocale[l].map((r) => r.entry)]));
}

/** The entries of the base language: every playbook there is. */
export function readPlaybooks(dir = CONTENT_DIR) {
  return readCatalog(dir)[BASE_LOCALE];
}

/** The TypeScript module for this catalog. Deterministic, so `--check` can compare it byte for byte. */
export function renderModule(catalog) {
  const list = (entries) =>
    entries.length === 0 ? '[]' : `[\n${entries.map((e) => `    ${JSON.stringify(e, null, 2).replace(/\n/g, '\n    ')},`).join('\n')}\n  ]`;
  return [
    '// GENERATED by scripts/playbooks.mjs from content/playbooks/<locale>/*.md. Do not edit by hand:',
    '// edit the markdown, then run `pnpm --filter @quill/shared playbooks`.',
    "import type { PlaybookLocale, PlaybookSource } from './playbooks';",
    '',
    'export const PLAYBOOK_SOURCES: Readonly<Record<PlaybookLocale, readonly PlaybookSource[]>> = {',
    ...LOCALES.map((l) => `  ${l}: ${list(catalog[l] ?? [])},`),
    '};',
    '',
  ].join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  let next;
  try {
    next = renderModule(readCatalog());
  } catch (err) {
    if (err instanceof PlaybookError) {
      console.error(`playbooks: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  let current = '';
  try {
    current = readFileSync(OUT_FILE, 'utf8');
  } catch {
    current = '';
  }
  if (check) {
    if (current !== next) {
      console.error(
        'playbooks: src/playbooks.generated.ts is out of date with content/playbooks. Run `pnpm --filter @quill/shared playbooks`.',
      );
      process.exit(1);
    }
    console.log('playbooks: up to date');
    return;
  }
  if (current !== next) writeFileSync(OUT_FILE, next);
  console.log(`playbooks: ${current === next ? 'already up to date' : 'wrote src/playbooks.generated.ts'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
