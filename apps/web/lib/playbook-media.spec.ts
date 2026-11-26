/**
 * The playbooks' media, on the web side: every marker and every thumbnail of
 * the shipped catalog, in every language, has its files in that language's
 * folder (`public/playbooks/inline/<locale>/`, `public/playbooks/<locale>/`),
 * nothing sits outside one, the size manifest is never stale, and the URLs
 * and sizes the reader uses.
 *
 * The example assets live in `tests/fixtures/playbooks/inline/`, never in
 * `public/`, so nothing a test needs is served. Its English folder lacks the
 * image on purpose.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { playbookMediaFiles, playbookMediaIn, type PlaybookMedia } from '@quill/shared';
import { PLAYBOOK_CATALOG, PLAYBOOK_LOCALES, playbookMedia } from '@quill/shared/playbooks';
import {
  LOCALES,
  MAX_BYTES,
  MEDIA_DIR,
  OUT_FILE,
  PLAYBOOKS_DIR,
  missingMediaFiles,
  oversizedMediaFiles,
  readMediaSizes,
  renderModule,
  strayMediaPaths,
  webpSize,
} from '../scripts/playbook-media.mjs';
import { mp4Sibling } from '@/components/playbooks/playbook-thumb';
import { playbookMediaSize, playbookMediaUrls } from './playbook-media';

const SCRIPT = fileURLToPath(new URL('../scripts/playbook-media.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../tests/fixtures/playbooks/inline', import.meta.url));
const SLUG = 'formularios-que-venden-con-ia';

/** Every file a list of markers needs, in one language, that is not in `dir`. */
const missing = (media: PlaybookMedia[], dir: string, locale = 'es'): string[] =>
  missingMediaFiles(media.flatMap((m) => playbookMediaFiles(m, locale)), dir);

const ALL = PLAYBOOK_LOCALES.flatMap((locale) => PLAYBOOK_CATALOG[locale]);

describe('the shipped catalog', () => {
  it('knows the languages the catalog has', () => {
    expect(LOCALES).toEqual([...PLAYBOOK_LOCALES]);
  });

  it('has every file its markers name, in the folder of each language', () => {
    for (const p of ALL) {
      expect(missing(playbookMedia(p), MEDIA_DIR, p.locale), `${p.locale}/${p.slug}`).toEqual([]);
    }
  });

  it('has every thumbnail it names, with the mp4 beside each webm loop', () => {
    for (const p of ALL) {
      const files = [p.thumbnailVideo, p.thumbnailVideo && mp4Sibling(p.thumbnailVideo), p.thumbnailPoster].filter(
        (f): f is string => !!f && f.startsWith('/playbooks/'),
      );
      for (const f of files) {
        expect(f.startsWith(`/playbooks/${p.locale}/`), `${p.locale}/${p.slug}: ${f}`).toBe(true);
        expect(existsSync(join(PLAYBOOKS_DIR, f.slice('/playbooks/'.length))), `${p.locale}/${p.slug}: ${f}`).toBe(true);
      }
    }
  });

  it('keeps every asset in a language folder', () => {
    expect(strayMediaPaths()).toEqual([]);
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

  it('looks in the folder of the language: a file Spanish has is still missing in English', () => {
    expect(missing(playbookMediaIn(text), FIXTURES, 'en')).toEqual([`en/${SLUG}/panel.webp`]);
  });

  it('names each missing file: the three of a loop, the webp of an image', () => {
    const media = playbookMediaIn(
      `${text}\n<!-- anim: ${SLUG}/otra | Falta -->\n<!-- img: ${SLUG}/foto | Falta -->\n<!-- img: ${SLUG}/demo | Solo el poster existe -->`,
    );
    expect(missing(media, FIXTURES)).toEqual([
      `es/${SLUG}/otra.webm`,
      `es/${SLUG}/otra.mp4`,
      `es/${SLUG}/otra-poster.webp`,
      `es/${SLUG}/foto.webp`,
      `es/${SLUG}/demo.webp`,
    ]);
  });

  it('reads the size of each still', () => {
    expect(readMediaSizes(FIXTURES)).toEqual({
      [`en/${SLUG}/demo-poster.webp`]: { width: 464, height: 288 },
      [`es/${SLUG}/demo-poster.webp`]: { width: 464, height: 288 },
      [`es/${SLUG}/panel.webp`]: { width: 464, height: 288 },
    });
  });
});

describe('the language folders', () => {
  it('name every asset outside one: a file left at the top, or a folder that is not a language', () => {
    const dir = mkdtempSync(join(tmpdir(), 'playbook-folders-'));
    try {
      const put = (path: string) => {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), '');
      };
      put('es/hook.webm');
      put('en/hook.webm');
      put('inline/es/hook/demo.webp');
      put('inline/en/hook/demo.webp');
      expect(strayMediaPaths(dir)).toEqual([]);
      put('hook.webm');
      put('pt/hook.webm');
      put('inline/hook/demo.webp');
      put('inline/notas.txt');
      put('.DS_Store');
      expect(strayMediaPaths(dir)).toEqual(['hook.webm', 'pt/', 'inline/hook/', 'inline/notas.txt']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the weight limit', () => {
  it('passes the shipped assets and the example ones', () => {
    expect(oversizedMediaFiles()).toEqual([]);
    expect(oversizedMediaFiles(FIXTURES)).toEqual([]);
  });

  it('names a video over 300 KB and an image over 200 KB, and nothing at the limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'playbook-media-'));
    try {
      mkdirSync(join(dir, 'es', SLUG), { recursive: true });
      const put = (name: string, bytes: number) => writeFileSync(join(dir, 'es', SLUG, name), Buffer.alloc(bytes));
      put('a.webm', MAX_BYTES.video + 1);
      put('a.mp4', MAX_BYTES.video);
      put('a-poster.webp', MAX_BYTES.image + 1);
      put('b.webp', MAX_BYTES.image);
      put('notas.txt', MAX_BYTES.video * 2);
      expect(MAX_BYTES).toEqual({ video: 300 * 1024, image: 200 * 1024 });
      expect(oversizedMediaFiles(dir)).toEqual([
        { file: `es/${SLUG}/a-poster.webp`, bytes: MAX_BYTES.image + 1, max: MAX_BYTES.image },
        { file: `es/${SLUG}/a.webm`, bytes: MAX_BYTES.video + 1, max: MAX_BYTES.video },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
  it('point at /playbooks/inline/<locale>/<slug>/', () => {
    expect(playbookMediaUrls({ kind: 'anim', slug: SLUG, name: 'demo' }, 'es')).toEqual({
      still: `/playbooks/inline/es/${SLUG}/demo-poster.webp`,
      webm: `/playbooks/inline/es/${SLUG}/demo.webm`,
      mp4: `/playbooks/inline/es/${SLUG}/demo.mp4`,
    });
    expect(playbookMediaUrls({ kind: 'img', slug: SLUG, name: 'panel' }, 'en')).toEqual({
      still: `/playbooks/inline/en/${SLUG}/panel.webp`,
      webm: null,
      mp4: null,
    });
  });

  it('size a loop by its poster and an image by itself, in its language, or not at all', () => {
    const sizes = readMediaSizes(FIXTURES);
    expect(playbookMediaSize({ kind: 'anim', slug: SLUG, name: 'demo' }, 'es', sizes)).toEqual({ width: 464, height: 288 });
    expect(playbookMediaSize({ kind: 'anim', slug: SLUG, name: 'demo' }, 'en', sizes)).toEqual({ width: 464, height: 288 });
    expect(playbookMediaSize({ kind: 'img', slug: SLUG, name: 'panel' }, 'es', sizes)).toEqual({ width: 464, height: 288 });
    expect(playbookMediaSize({ kind: 'img', slug: SLUG, name: 'panel' }, 'en', sizes)).toBeNull();
    expect(playbookMediaSize({ kind: 'img', slug: SLUG, name: 'demo' }, 'es', sizes)).toBeNull();
  });
});
