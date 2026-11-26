/**
 * The playbooks catalog: the markdown in `content/playbooks/` is what ships
 * (the committed module is never stale), every entry is well formed, and the
 * markdown reader refuses what it does not understand instead of guessing.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error: a plain ESM script with no type declarations.
import { parsePlaybook, readPlaybooks, renderModule, OUT_FILE } from '../scripts/playbooks.mjs';
import {
  PLAYBOOKS,
  PLAYBOOK_CATEGORIES,
  findPlaybook,
  isPlaybookNew,
  playbookBody,
  publishedPlaybooks,
  sortPlaybooks,
  type Playbook,
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
const parse = (text: string) => parsePlaybook('content/playbooks/demo.md', text);

describe('the committed module', () => {
  it('is exactly what the markdown generates', () => {
    expect(readFileSync(OUT_FILE, 'utf8')).toBe(renderModule(readPlaybooks()));
    expect(() => execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('the shipped catalog', () => {
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

  it('carries no em dash or horizontal bar in what a reader sees', () => {
    for (const p of PLAYBOOKS) {
      const text = [p.title, p.summary, p.template, p.preview, p.rest].join('\n');
      const banned = [0x2014, 0x2015].map((c) => String.fromCharCode(c));
      expect(banned.some((d) => text.includes(d)), p.slug).toBe(false);
    }
  });
});

describe('parsePlaybook', () => {
  it('reads the front matter subset and splits the body at the marker', () => {
    expect(parse(file(FRONT))).toEqual({
      slug: 'demo',
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
          '\nthumbnailVideo: /playbooks/demo.webm\nthumbnailPoster: https://cdn.example.test/demo.png',
      ),
    );
    expect(p).toMatchObject({
      promisedBy: [],
      thumbnailVideo: '/playbooks/demo.webm',
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
    ['a list that is not a list', FRONT.replace(/promisedBy: .*/, 'promisedBy: ig_a'), /expected a list/],
    ['a repeated account', FRONT.replace(/promisedBy: .*/, 'promisedBy: [ig_a, ig_a]'), /repeats/],
    ['a video that is not a video', FRONT + '\nthumbnailVideo: /a.png', /thumbnailVideo must be/],
    ['a protocol-relative poster', FRONT + '\nthumbnailPoster: //x.test/a.png', /thumbnailPoster must be/],
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
