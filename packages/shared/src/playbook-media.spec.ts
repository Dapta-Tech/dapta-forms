/**
 * The inline media markers of a playbook body: the grammar the renderer reads
 * (`parsePlaybookMediaMarker`), the stricter check the catalog build runs
 * (`readMediaMarker` in scripts/playbooks.mjs, which also wants the slug of
 * the file), and the two agreeing on every line.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ESM script with no type declarations.
import { parsePlaybook, readMediaMarker } from '../scripts/playbooks.mjs';
import {
  parsePlaybookMediaMarker,
  playbookMediaFiles,
  playbookMediaIn,
  playbookMediaMarker,
  playbookMediaStill,
  stripHtmlComments,
} from './playbook-media';
import { playbookMedia, playbookOutline, playbookReadingMinutes, type Playbook } from './playbooks';

const SLUG = 'formularios-que-venden-con-ia';
const build = (line: string) => readMediaMarker('content/playbooks/x.md', 7, line, SLUG);

const VALID: [string, { kind: 'anim' | 'img'; name: string; alt: string }][] = [
  [`<!-- anim: ${SLUG}/demo | Claude crea el form -->`, { kind: 'anim', name: 'demo', alt: 'Claude crea el form' }],
  [`<!-- img: ${SLUG}/panel-2 | El panel de respuestas -->`, { kind: 'img', name: 'panel-2', alt: 'El panel de respuestas' }],
  [`<!--anim:${SLUG}/demo|Sin espacios-->`, { kind: 'anim', name: 'demo', alt: 'Sin espacios' }],
  [`<!-- anim: ${SLUG}/demo | Claude | ChatGPT, alternando -->`, { kind: 'anim', name: 'demo', alt: 'Claude | ChatGPT, alternando' }],
  [`<!-- img: ${SLUG}/demo | Con espacios al final -->   `, { kind: 'img', name: 'demo', alt: 'Con espacios al final' }],
];

const INVALID: [string, string, RegExp][] = [
  ['no alt', `<!-- anim: ${SLUG}/demo -->`, /needs an alt/],
  ['an empty alt', `<!-- anim: ${SLUG}/demo |   -->`, /needs an alt/],
  ['an uppercase name', `<!-- anim: ${SLUG}/Demo | Alt -->`, /name Demo/],
  ['a name with an underscore', `<!-- img: ${SLUG}/de_mo | Alt -->`, /name de_mo/],
  ['a dotted name', `<!-- img: ${SLUG}/demo.webp | Alt -->`, /name demo\.webp/],
  ['no name', `<!-- anim: ${SLUG}/ | Alt -->`, /name \(none\)/],
  ['no slash', `<!-- anim: demo | Alt -->`, /malformed marker/],
  ['an unknown kind', `<!-- anim2: ${SLUG}/demo | Alt -->`, /malformed marker/],
  ['an alt that closes the comment early', `<!-- anim: ${SLUG}/demo | a --> b -->`, /cannot hold/],
  ['a missing close', `<!-- anim: ${SLUG}/demo | Alt`, /malformed marker/],
  ['a marker inside a paragraph', `Texto <!-- anim: ${SLUG}/demo | Alt -->`, /line of its own/],
];

describe('parsePlaybookMediaMarker and the build agree', () => {
  it.each(VALID)('reads %s', (line, want) => {
    expect(parsePlaybookMediaMarker(line)).toEqual({ ...want, slug: SLUG });
    expect(build(line)).toEqual({ ...want, slug: SLUG });
  });

  it.each(INVALID)('refuses %s', (_label, line, message) => {
    // The renderer drops it like any other comment; the build names the line.
    expect(parsePlaybookMediaMarker(line)).toBeNull();
    expect(() => build(line)).toThrow(message);
    expect(() => build(line)).toThrow(/content\/playbooks\/x\.md:7/);
  });

  it('refuses an indented marker in the build, so one never lands inside a list', () => {
    expect(() => build(`  <!-- anim: ${SLUG}/demo | Alt -->`)).toThrow(/line of its own, unindented/);
  });

  it('reads any slug, but the build wants the one of the file', () => {
    const line = '<!-- anim: otro-playbook/demo | Alt -->';
    expect(parsePlaybookMediaMarker(line)).toEqual({ kind: 'anim', slug: 'otro-playbook', name: 'demo', alt: 'Alt' });
    expect(() => build(line)).toThrow(/names the playbook otro-playbook, it must be formularios-que-venden-con-ia/);
    expect(() => build('<!-- img: Otro/demo | Alt -->')).toThrow(/names the playbook Otro/);
  });

  it('is not a marker for the wall or any other comment', () => {
    expect(parsePlaybookMediaMarker('<!-- muro -->')).toBeNull();
    expect(parsePlaybookMediaMarker('<!-- animación pendiente -->')).toBeNull();
  });

  it('writes back what it reads', () => {
    for (const [line] of VALID) {
      const media = parsePlaybookMediaMarker(line)!;
      expect(parsePlaybookMediaMarker(playbookMediaMarker(media))).toEqual(media);
    }
  });
});

describe('the files of a marker', () => {
  it('are a webm, an mp4 and a poster for a loop, a webp for a still', () => {
    expect(playbookMediaFiles({ kind: 'anim', slug: 'a', name: 'b' })).toEqual(['a/b.webm', 'a/b.mp4', 'a/b-poster.webp']);
    expect(playbookMediaFiles({ kind: 'img', slug: 'a', name: 'b' })).toEqual(['a/b.webp']);
    expect(playbookMediaStill({ kind: 'anim', slug: 'a', name: 'b' })).toBe('a/b-poster.webp');
    expect(playbookMediaStill({ kind: 'img', slug: 'a', name: 'b' })).toBe('a/b.webp');
  });
});

describe('playbookMediaIn', () => {
  it('lists the valid markers in order, skipping fenced code and broken ones', () => {
    const text = [
      `<!-- anim: ${SLUG}/uno | Uno -->`,
      '```',
      `<!-- img: ${SLUG}/codigo | En un bloque de código -->`,
      '```',
      `<!-- img: ${SLUG}/dos | Dos -->`,
      `<!-- img: ${SLUG}/roto -->`,
    ].join('\n');
    expect(playbookMediaIn(text).map((m) => m.name)).toEqual(['uno', 'dos']);
  });
});

const FRONT = ['slug: formularios-que-venden-con-ia', 'category: ventas', 'title: T', 'summary: S', 'publishedAt: 2026-12-01', 'template: T'].join('\n');
const parse = (body: string) => parsePlaybook(`content/playbooks/${SLUG}.md`, `---\n${FRONT}\n---\n${body}\n`);

describe('the catalog build', () => {
  it('keeps the markers in the preview and the rest, as written', () => {
    const anim = `<!-- anim: ${SLUG}/demo | Claude crea el form -->`;
    const img = `<!-- img: ${SLUG}/panel | El panel -->`;
    const p = parse(`Intro.\n\n${anim}\n\n<!-- muro -->\n\n## Paso\n\n${img}\n\nTexto.`);
    expect(p.preview).toBe(`Intro.\n\n${anim}`);
    expect(p.rest).toBe(`## Paso\n\n${img}\n\nTexto.`);
  });

  it('names the file line of a broken marker', () => {
    // Line 1 is ---, the front matter is 6 lines, line 8 is ---, the body starts on line 9.
    expect(() => parse(`Intro.\n<!-- anim: ${SLUG}/demo -->\n<!-- muro -->\nRest.`)).toThrow(/formularios-que-venden-con-ia\.md:10: .*needs an alt/);
    expect(() => parse(`Intro.\n<!-- muro -->\n<!-- img: otro/demo | Alt -->`)).toThrow(/:11: img marker names the playbook otro/);
  });

  it('leaves a marker inside fenced code alone', () => {
    expect(() => parse('Intro.\n<!-- muro -->\n```\n<!-- anim: roto -->\n```')).not.toThrow();
  });

  it('accepts other comments, even across lines, but refuses one that never closes', () => {
    expect(() => parse('Intro.\n<!-- nota\nde dos líneas -->\n<!-- muro -->\nRest.')).not.toThrow();
    expect(() => parse('Intro. <!-- nota --> fin.\n<!-- muro -->\nRest.')).not.toThrow();
    expect(() => parse('Intro.\n<!-- muro -->\nRest.\n<!-- nota sin cerrar\nY esto no se vería.')).toThrow(/:12: an HTML comment is opened here and never closed/);
  });
});

const playbook = (preview: string, rest: string): Playbook => ({
  slug: SLUG,
  category: 'ventas',
  title: 'T',
  summary: 'S',
  publishedAt: 0,
  promisedBy: [],
  template: 'T',
  thumbnailVideo: null,
  thumbnailPoster: null,
  thumbnailMotif: null,
  preview,
  rest,
});

describe('reading time and outline', () => {
  it('do not read a marker as text', () => {
    const words = (n: number) => Array(n).fill('palabra').join(' ');
    const marker = `<!-- anim: ${SLUG}/demo | ${words(50)} -->`;
    // 200 words read in one minute; the 50 words of the alt would make it two.
    const p = playbook(`${words(100)}\n\n${marker}`, `## Paso\n\n${marker}\n\n${words(99)}`);
    expect(playbookReadingMinutes(p)).toBe(1);
    expect(playbookOutline(p)).toEqual(['Paso']);
    expect(playbookMedia(p).map((m) => m.kind)).toEqual(['anim', 'anim']);
  });

  it('strips every comment, on one line or several', () => {
    expect(stripHtmlComments('a <!-- x --> b <!--\ny\n--> c').split(/\s+/)).toEqual(['a', 'b', 'c']);
  });
});
