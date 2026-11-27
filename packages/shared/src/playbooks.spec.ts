/**
 * The playbooks catalog: the markdown in `content/playbooks/<locale>/` is what
 * ships (the committed module is never stale), every entry is well formed,
 * the languages of a playbook agree with each other, and the markdown reader
 * refuses what it does not understand instead of guessing.
 *
 * The English example lives in `test/fixtures/playbooks/`, never in
 * `content/`: nothing a test needs ships.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error: a plain ESM script with no type declarations.
import { parsePlaybook, readCatalog, readPlaybooks, renderModule, OUT_FILE } from '../scripts/playbooks.mjs';
import {
  PLAYBOOKS,
  PLAYBOOK_CATALOG,
  PLAYBOOK_CATEGORIES,
  PLAYBOOK_LOCALES,
  findPlaybook,
  isPlaybookLocale,
  isPlaybookNew,
  localizedPlaybook,
  playbookBody,
  publishedPlaybooks,
  sortPlaybooks,
  type Playbook,
  type PlaybookCatalog,
} from './playbooks';

const SCRIPT = fileURLToPath(new URL('../scripts/playbooks.mjs', import.meta.url));

const file = (front: string, body = 'Intro.\n\n<!-- muro -->\n\nThe rest.') => `---\n${front}\n---\n${body}\n`;
const FRONT = [
  'slug: demo',
  'category: ventas',
  'title: "Demo: a title with a colon"',
  'summary: A summary',
  'publishedAt: 2026-12-01',
  'promisedBy: [ig_homerovende, ig_burrovende]',
  "template: 'Calificador de leads (plantilla `lead`), it''s fine'",
].join('\n');
const parse = (text: string, locale = 'es') => parsePlaybook(`content/playbooks/${locale}/demo.md`, text, locale);

describe('the committed module', () => {
  it('is exactly what the markdown generates', () => {
    expect(readFileSync(OUT_FILE, 'utf8')).toBe(renderModule(readCatalog()));
    expect(() => execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('the shipped catalog', () => {
  it('has every playbook in every language, and only the languages it knows', () => {
    expect(Object.keys(PLAYBOOK_CATALOG)).toEqual([...PLAYBOOK_LOCALES]);
    expect(PLAYBOOKS).toBe(PLAYBOOK_CATALOG.es);
    expect(readPlaybooks()).toEqual(readCatalog().es);
    const base = PLAYBOOKS.map((p) => p.slug);
    for (const locale of PLAYBOOK_LOCALES) {
      expect(PLAYBOOK_CATALOG[locale].map((p) => p.slug), locale).toEqual(base);
      for (const p of PLAYBOOK_CATALOG[locale]) expect(p.locale, p.slug).toBe(locale);
    }
  });

  it('has unique slugs, known categories and both halves of every body', () => {
    expect(PLAYBOOKS.length).toBeGreaterThan(0);
    const slugs = PLAYBOOKS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of PLAYBOOKS) {
      expect(PLAYBOOK_CATEGORIES, p.slug).toContain(p.category);
      expect(p.preview.length, p.slug).toBeGreaterThan(0);
      expect(p.rest.length, p.slug).toBeGreaterThan(0);
      expect(p.preview + p.rest, p.slug).not.toContain('<!-- muro -->');
      expect(Number.isFinite(p.publishedAt), p.slug).toBe(true);
    }
  });

  it('carries no em dash, en dash or horizontal bar in what a reader sees', () => {
    for (const p of PLAYBOOK_LOCALES.flatMap((l) => PLAYBOOK_CATALOG[l])) {
      const text = [p.title, p.summary, p.template, p.preview, p.rest].join('\n');
      const banned = [0x2014, 0x2013, 0x2015].map((c) => String.fromCharCode(c));
      expect(banned.some((d) => text.includes(d)), p.slug).toBe(false);
    }
  });
});

describe('parsePlaybook', () => {
  it('reads the front matter subset and splits the body at the marker', () => {
    expect(parse(file(FRONT))).toEqual({
      slug: 'demo',
      locale: 'es',
      category: 'ventas',
      title: 'Demo: a title with a colon',
      summary: 'A summary',
      publishedAt: Date.parse('2026-12-01T00:00:00-05:00'),
      promisedBy: ['ig_homerovende', 'ig_burrovende'],
      template: "Calificador de leads (plantilla `lead`), it's fine",
      thumbnailVideo: null,
      thumbnailPoster: null,
      thumbnailMotif: null,
      preview: 'Intro.',
      rest: 'The rest.',
    });
  });

  it('reads the optional thumbnail and an empty promisedBy', () => {
    const p = parse(
      file(
        FRONT.replace(/promisedBy: .*/, 'promisedBy: []') +
          '\nthumbnailVideo: /playbooks/es/demo.webm\nthumbnailPoster: https://cdn.example.test/demo.png',
      ),
    );
    expect(p).toMatchObject({
      promisedBy: [],
      thumbnailVideo: '/playbooks/es/demo.webm',
      thumbnailPoster: 'https://cdn.example.test/demo.png',
    });
  });

  it('accepts a full date-time with its offset', () => {
    const p = parse(file(FRONT.replace('publishedAt: 2026-12-01', 'publishedAt: 2026-12-01T09:30:00-05:00')));
    expect(p.publishedAt).toBe(Date.parse('2026-12-01T14:30:00Z'));
  });

  it.each([
    ['an unknown key', FRONT + '\ncolour: green', /unknown front matter key colour/],
    ['a missing field', FRONT.replace(/summary: .*\n/, ''), /missing summary/],
    ['an unknown category', FRONT.replace('category: ventas', 'category: growth'), /category growth/],
    ['a slug that is not the file name', FRONT.replace('slug: demo', 'slug: other'), /must match the file name/],
    ['a bad date', FRONT.replace('2026-12-01', '01/12/2026'), /publishedAt/],
    ['a day the month does not have', FRONT.replace('2026-12-01', '2026-02-30'), /real YYYY-MM-DD/],
    ['an impossible time', FRONT.replace('2026-12-01', '2026-12-01T25:00:00-05:00'), /publishedAt/],
    ['a slug that is only the end of the file name', FRONT.replace('slug: demo', 'slug: mo'), /must match the file name/],
    ['a comma inside a quoted list item', FRONT.replace(/promisedBy: .*/, 'promisedBy: ["ig_a, ig_b"]'), /cannot hold a comma/],
    ['a list that is not a list', FRONT.replace(/promisedBy: .*/, 'promisedBy: ig_a'), /expected a list/],
    ['a repeated account', FRONT.replace(/promisedBy: .*/, 'promisedBy: [ig_a, ig_a]'), /repeats/],
    ['a video that is not a video', FRONT + '\nthumbnailVideo: /a.png', /thumbnailVideo must be/],
    ['a protocol-relative poster', FRONT + '\nthumbnailPoster: //x.test/a.png', /thumbnailPoster must be/],
    ['a thumbnail outside the language folder', FRONT + '\nthumbnailVideo: /playbooks/demo.webm', /this language's file, \/playbooks\/es\/demo/],
    ['a thumbnail of another playbook', FRONT + '\nthumbnailPoster: /playbooks/es/otro-poster.webp', /this language's file/],
    ['a flag to ship a playbook untranslated: parity is required', FRONT + '\nuntranslated: [en]', /unknown front matter key untranslated/],
  ])('refuses %s', (_label, front, message) => {
    expect(() => parse(file(front))).toThrow(message);
  });

  it('refuses a body without exactly one marker, or with an empty half', () => {
    expect(() => parse(file(FRONT, 'No marker.'))).toThrow(/exactly one/);
    expect(() => parse(file(FRONT, 'A\n<!-- muro -->\nB\n<!-- muro -->\nC'))).toThrow(/exactly one/);
    expect(() => parse(file(FRONT, '<!-- muro -->\nB'))).toThrow(/preview is empty/);
    expect(() => parse(file(FRONT, 'A\n<!-- muro -->\n'))).toThrow(/rest is empty/);
  });
});

const playbook = (over: Partial<Playbook>): Playbook => ({
  slug: 'a',
  locale: 'es',
  category: 'ventas',
  title: 'A',
  summary: 'A',
  publishedAt: 1000,
  promisedBy: [],
  template: 'T',
  thumbnailVideo: null,
  thumbnailPoster: null,
  thumbnailMotif: null,
  preview: 'P',
  rest: 'R',
  ...over,
});

describe('helpers', () => {
  it('sorts newest first, then by category tab, then by slug', () => {
    const list = [
      playbook({ slug: 'old', publishedAt: 1 }),
      playbook({ slug: 'b-ads', category: 'ads' }),
      playbook({ slug: 'z-ventas', category: 'ventas' }),
      playbook({ slug: 'a-ventas', category: 'ventas' }),
    ];
    expect(sortPlaybooks(list).map((p) => p.slug)).toEqual(['a-ventas', 'z-ventas', 'b-ads', 'old']);
  });

  it('hides a playbook until its date', () => {
    const list = [playbook({ slug: 'now', publishedAt: 100 }), playbook({ slug: 'later', publishedAt: 200 })];
    expect(publishedPlaybooks(199, list).map((p) => p.slug)).toEqual(['now']);
    expect(publishedPlaybooks(200, list).map((p) => p.slug)).toEqual(['later', 'now']);
    expect(findPlaybook('later', list)?.slug).toBe('later');
  });

  it('joins the two halves without the marker', () => {
    expect(playbookBody(playbook({ preview: 'Top', rest: 'Bottom' }))).toBe('Top\n\nBottom');
  });

  it('is new when published after the last gallery visit and never opened', () => {
    const p = playbook({ publishedAt: 100 });
    expect(isPlaybookNew(p, { lastSeenAt: null, galleryLastSeenAt: null })).toBe(true);
    expect(isPlaybookNew(p, { lastSeenAt: null, galleryLastSeenAt: 99 })).toBe(true);
    expect(isPlaybookNew(p, { lastSeenAt: null, galleryLastSeenAt: 100 })).toBe(false);
    expect(isPlaybookNew(p, { lastSeenAt: 150, galleryLastSeenAt: 99 })).toBe(false);
  });
});

describe('parsePlaybook in another language', () => {
  it('stamps the language and wants the thumbnail in its folder', () => {
    const front = `${FRONT}\nthumbnailVideo: /playbooks/en/demo.webm`;
    expect(parse(file(front), 'en')).toMatchObject({ locale: 'en', thumbnailVideo: '/playbooks/en/demo.webm' });
    expect(() => parse(file(FRONT + '\nthumbnailVideo: /playbooks/es/demo.webm'), 'en')).toThrow(/\/playbooks\/en\/demo/);
  });
});

/**
 * The checks between languages, on a catalog copied from the fixture to a
 * temporary folder, so each case can break one thing.
 */
describe('readCatalog: parity between languages', () => {
  const FIXTURE = fileURLToPath(new URL('../test/fixtures/playbooks', import.meta.url));
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  /** A copy of the fixture with `edit` applied to some of its files (`es/demo.md`: text or null to delete). */
  const catalog = (edit: Record<string, ((text: string) => string) | null | string> = {}) => {
    dir = mkdtempSync(join(tmpdir(), 'playbooks-'));
    cpSync(FIXTURE, dir, { recursive: true });
    for (const [path, change] of Object.entries(edit)) {
      const at = join(dir, path);
      if (change === null) rmSync(at);
      else {
        mkdirSync(join(at, '..'), { recursive: true });
        writeFileSync(at, typeof change === 'string' ? change : change(readFileSync(at, 'utf8')));
      }
    }
    return () => readCatalog(dir);
  };
  const en = (fn: (t: string) => string) => ({ 'en/demo.md': fn });

  it('reads both languages of the fixture, each stamped with its own', () => {
    const read = catalog()();
    expect(Object.keys(read)).toEqual(['es', 'en']);
    expect(read.es.map((p: Playbook) => [p.slug, p.locale, p.title])).toEqual([['demo', 'es', 'Un playbook de prueba']]);
    expect(read.en.map((p: Playbook) => [p.slug, p.locale, p.title])).toEqual([['demo', 'en', 'A test playbook']]);
    expect(renderModule(read)).toContain('  en: [\n    {\n      "slug": "demo",\n      "locale": "en",');
  });

  it('renders a language with nothing in it as an empty list', () => {
    expect(renderModule({ es: [], en: [] })).toContain('\n  es: [],\n  en: [],\n');
  });

  it('refuses a playbook missing in English: every playbook ships in every language', () => {
    expect(catalog({ 'en/demo.md': null })).toThrow(/es\/demo\.md: has no en version: add content\/playbooks\/en\/demo\.md/);
  });

  it('refuses a playbook that exists only in English: Spanish is what everyone falls back to', () => {
    const only = readFileSync(join(FIXTURE, 'en/demo.md'), 'utf8').replace(/demo/g, 'solo');
    expect(catalog({ 'en/solo.md': only })).toThrow(/en\/solo\.md: has no es version/);
  });

  it.each([
    ['category', (t: string) => t.replace('category: ventas', 'category: ads'), /category must be the same as in content\/playbooks\/es\/demo\.md/],
    ['publishedAt', (t: string) => t.replace('2026-12-01', '2026-12-02'), /publishedAt must be the same/],
    ['promisedBy', (t: string) => t.replace('promisedBy: []', 'promisedBy: [ig_a]'), /promisedBy must be the same/],
    ['a thumbnail only one language has', (t: string) => t.replace(/thumbnailVideo: .*\n/, ''), /thumbnailVideo must be set in both languages or in neither/],
  ])('refuses a translation with another %s', (_label, change, message) => {
    expect(catalog(en(change))).toThrow(message);
  });

  it.each([
    ['a missing marker', (t: string) => t.replace('<!-- img: demo/panel | The panel -->\n', ''), /marker 2 is \(none\), es has img: demo\/panel/],
    ['an extra marker', (t: string) => t.replace('The rest.', '<!-- img: demo/extra | Extra -->\n\nThe rest.'), /marker 3 is img: demo\/extra, es has \(none\)/],
    ['another name', (t: string) => t.replace('demo/panel', 'demo/board'), /marker 2 is img: demo\/board, es has img: demo\/panel/],
    ['another kind', (t: string) => t.replace('anim: demo/loop', 'img: demo/loop'), /marker 1 is img: demo\/loop, es has anim: demo\/loop/],
    [
      'the same markers in another order',
      (t: string) =>
        t
          .replace('<!-- anim: demo/loop | A test loop -->', 'TMP')
          .replace('<!-- img: demo/panel | The panel -->', '<!-- anim: demo/loop | A test loop -->')
          .replace('TMP', '<!-- img: demo/panel | The panel -->'),
      /marker 1 is img: demo\/panel, es has anim: demo\/loop/,
    ],
  ])('refuses markers that do not match the Spanish ones: %s', (_label, change, message) => {
    expect(catalog(en(change))).toThrow(message);
  });

  it('lets the alt text be translated', () => {
    expect(catalog(en((t) => t.replace('A test loop', 'Otro texto del todo')))).not.toThrow();
  });

  it('refuses a playbook outside a language folder, and a folder that is not a language', () => {
    const text = readFileSync(join(FIXTURE, 'es/demo.md'), 'utf8');
    expect(catalog({ 'demo.md': text })).toThrow(/content\/playbooks\/demo\.md: a playbook lives in its language folder, content\/playbooks\/es\/demo\.md/);
    expect(catalog({ 'pt/demo.md': text })).toThrow(/content\/playbooks\/pt: is not a language folder/);
  });

  it('refuses a catalog without the English folder', () => {
    const read = catalog();
    rmSync(join(dir!, 'en'), { recursive: true });
    expect(read).toThrow(/has no en version/);
  });
});

describe('localizedPlaybook', () => {
  const ES = playbook({ slug: 'a', locale: 'es', title: 'Hola' });
  const EN = playbook({ slug: 'a', locale: 'en', title: 'Hello' });
  const ONLY_ES = playbook({ slug: 'b', locale: 'es' });
  const CATALOG: PlaybookCatalog = { es: [ES, ONLY_ES], en: [EN] };

  it('gives the language asked for when it exists', () => {
    expect(localizedPlaybook(ES, 'en', CATALOG)).toEqual({ playbook: EN, fallback: false });
    expect(localizedPlaybook(ES, 'es', CATALOG)).toEqual({ playbook: ES, fallback: false });
  });

  it('falls back to Spanish, and says so', () => {
    expect(localizedPlaybook(ONLY_ES, 'en', CATALOG)).toEqual({ playbook: ONLY_ES, fallback: true });
  });

  it('knows its languages', () => {
    expect(PLAYBOOK_LOCALES).toEqual(['es', 'en']);
    expect(isPlaybookLocale('en')).toBe(true);
    expect(isPlaybookLocale('pt')).toBe(false);
    expect(isPlaybookLocale(undefined)).toBe(false);
  });
});
