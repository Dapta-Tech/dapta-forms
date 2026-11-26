/**
 * The inline media of the playbooks, on the web side: every marker of the
 * shipped catalog has its files under `public/playbooks/inline/`, the size
 * manifest is never stale, and the URLs and sizes the reader uses.
 *
 * The example assets live in `tests/fixtures/playbooks/inline/`, never in
 * `public/`, so nothing a test needs is served.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { playbookMediaFiles, playbookMediaIn, type PlaybookMedia } from '@quill/shared';
import { PLAYBOOKS, playbookMedia } from '@quill/shared/playbooks';
import { MEDIA_DIR, OUT_FILE, missingMediaFiles, readMediaSizes, renderModule, webpSize } from '../scripts/playbook-media.mjs';
import { playbookMediaSize, playbookMediaUrls } from './playbook-media';

const SCRIPT = fileURLToPath(new URL('../scripts/playbook-media.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../tests/fixtures/playbooks/inline', import.meta.url));
const SLUG = 'formularios-que-venden-con-ia';

/** Every file a list of markers needs that is not in `dir`. */
const missing = (media: PlaybookMedia[], dir: string): string[] =>
  missingMediaFiles(media.flatMap((m) => playbookMediaFiles(m)), dir);

describe('the shipped catalog', () => {
  it('has every file its markers name', () => {
    for (const p of PLAYBOOKS) {
      expect(missing(playbookMedia(p), MEDIA_DIR), p.slug).toEqual([]);
    }
  });

  it('has a size manifest that is exactly what the assets give', () => {
    expect(readFileSync(OUT_FILE, 'utf8')).toBe(renderModule(readMediaSizes()));
    expect(() => execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('the asset check, on the example assets', () => {
  const text = [
    `<!-- anim: ${SLUG}/demo | Claude crea el form -->`,
    `<!-- img: ${SLUG}/panel | El panel -->`,
  ].join('\n');

  it('passes when every file is there', () => {
    expect(missing(playbookMediaIn(text), FIXTURES)).toEqual([]);
  });

  it('names each missing file: the three of a loop, the webp of an image', () => {
    const media = playbookMediaIn(
      `${text}\n<!-- anim: ${SLUG}/otra | Falta -->\n<!-- img: ${SLUG}/foto | Falta -->\n<!-- img: ${SLUG}/demo | Solo el poster existe -->`,
    );
    expect(missing(media, FIXTURES)).toEqual([
      `${SLUG}/otra.webm`,
      `${SLUG}/otra.mp4`,
      `${SLUG}/otra-poster.webp`,
      `${SLUG}/foto.webp`,
      `${SLUG}/demo.webp`,
    ]);
  });

  it('reads the size of each still', () => {
    expect(readMediaSizes(FIXTURES)).toEqual({
      [`${SLUG}/demo-poster.webp`]: { width: 464, height: 288 },
      [`${SLUG}/panel.webp`]: { width: 464, height: 288 },
    });
  });
});

describe('webpSize', () => {
  const header = (chunk: string, bytes: number[]) => {
    const buf = Buffer.alloc(32);
    buf.write('RIFF', 0, 'ascii');
    buf.write('WEBP', 8, 'ascii');
    buf.write(chunk, 12, 'ascii');
    bytes.forEach((b, i) => (buf[20 + i] = b));
    return buf;
  };

  it('reads the extended and the lossless headers too', () => {
    // VP8X: flags, 3 reserved bytes, then width-1 and height-1 as 24-bit little endian.
    expect(webpSize(header('VP8X', [0, 0, 0, 0, 0xff, 0x03, 0, 0x1f, 0x02, 0]))).toEqual({ width: 1024, height: 544 });
    // VP8L: signature 0x2f, then 14 bits of width-1 and 14 of height-1.
    const w = 100 - 1;
    const h = 50 - 1;
    const bits = w | (h << 14);
    expect(webpSize(header('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]))).toEqual({
      width: 100,
      height: 50,
    });
  });

  it('refuses what is not a WebP', () => {
    expect(webpSize(Buffer.from('not an image at all, just some text'))).toBeNull();
    expect(webpSize(header('VP8 ', [0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe('playbookMediaUrls and playbookMediaSize', () => {
  it('point at /playbooks/inline/<slug>/', () => {
    expect(playbookMediaUrls({ kind: 'anim', slug: SLUG, name: 'demo' })).toEqual({
      still: `/playbooks/inline/${SLUG}/demo-poster.webp`,
      webm: `/playbooks/inline/${SLUG}/demo.webm`,
      mp4: `/playbooks/inline/${SLUG}/demo.mp4`,
    });
    expect(playbookMediaUrls({ kind: 'img', slug: SLUG, name: 'panel' })).toEqual({
      still: `/playbooks/inline/${SLUG}/panel.webp`,
      webm: null,
      mp4: null,
    });
  });

  it('size a loop by its poster and an image by itself, or not at all', () => {
    const sizes = readMediaSizes(FIXTURES);
    expect(playbookMediaSize({ kind: 'anim', slug: SLUG, name: 'demo' }, sizes)).toEqual({ width: 464, height: 288 });
    expect(playbookMediaSize({ kind: 'img', slug: SLUG, name: 'panel' }, sizes)).toEqual({ width: 464, height: 288 });
    expect(playbookMediaSize({ kind: 'img', slug: SLUG, name: 'demo' }, sizes)).toBeNull();
  });
});
