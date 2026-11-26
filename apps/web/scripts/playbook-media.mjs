#!/usr/bin/env node
// Generates lib/playbook-media.generated.ts: the pixel size of every still
// under public/playbooks/inline/<locale>/ (the `<name>.webp` of an inline image
// and the `<name>-poster.webp` of an inline animation), so the reader can give
// each figure its width and height and the text never jumps when a picture
// loads. The keys are `<locale>/<slug>/<file>`.
//
// Every playbook asset lives in the folder of its language: the inline media
// in public/playbooks/inline/<locale>/<slug>/, the card thumbnails in
// public/playbooks/<locale>/. Anything outside a language folder (an asset
// left where it was before the playbooks had languages, or a folder that is
// not one) fails the check, so it is never served by accident.
//
//   node scripts/playbook-media.mjs          write lib/playbook-media.generated.ts
//   node scripts/playbook-media.mjs --check  fail if it is stale, a still is not a WebP it can read,
//                                            an asset is too heavy (see MAX_BYTES), or sits
//                                            outside a language folder
//
// Run it after adding or replacing an inline asset. `lib/playbook-media.spec.ts`
// runs `--check`, and also fails when a marker of the catalog
// (`<!-- anim: ... -->`, `<!-- img: ... -->`) or a thumbnail, in any language,
// names a file that is not there.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
/** Keep in step with `PLAYBOOK_LOCALES` in @quill/shared. */
export const LOCALES = ['es', 'en'];
/** The card thumbnails, `<locale>/<slug>.webm` and the like, and the inline media below `inline/`. */
export const PLAYBOOKS_DIR = join(web, 'public', 'playbooks');
export const MEDIA_DIR = join(PLAYBOOKS_DIR, 'inline');
export const OUT_FILE = join(web, 'lib', 'playbook-media.generated.ts');

/**
 * The most an inline asset may weigh: a playbook carries several, and each
 * loads as its reader scrolls, on a phone too. 300 KB for a video (the webm
 * and the mp4 of a loop), 200 KB for an image (a still or a loop's poster).
 */
export const MAX_BYTES = { video: 300 * 1024, image: 200 * 1024 };
const VIDEO = /\.(?:webm|mp4)$/;
const IMAGE = /\.(?:webp|png|jpe?g|avif|gif)$/;

/**
 * The width and height of a WebP, read from its header: the simple lossy
 * (`VP8 `), lossless (`VP8L`) and extended (`VP8X`) formats. Null for
 * anything else.
 */
export function webpSize(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b = buf.subarray(21, 25);
    return {
      width: 1 + (b[0] | ((b[1] & 0x3f) << 8)),
      height: 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10)),
    };
  }
  return null;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

/** `{ 'slug/name-poster.webp': { width, height } }` for every WebP under `dir`, sorted by path. */
export function readMediaSizes(dir = MEDIA_DIR) {
  /** @type {Record<string, { width: number, height: number }>} */
  const sizes = {};
  for (const path of walk(dir)) {
    if (!path.endsWith('.webp')) continue;
    const key = relative(dir, path).split(sep).join('/');
    const size = webpSize(readFileSync(path));
    if (!size || size.width <= 0 || size.height <= 0) throw new Error(`playbook-media: ${key} is not a WebP this script can read`);
    sizes[key] = size;
  }
  return sizes;
}

/** The assets under `dir` heavier than `MAX_BYTES`, as `{ file, bytes, max }` sorted by path. */
export function oversizedMediaFiles(dir = MEDIA_DIR, max = MAX_BYTES) {
  const out = [];
  for (const path of walk(dir)) {
    const limit = VIDEO.test(path) ? max.video : IMAGE.test(path) ? max.image : null;
    if (limit === null) continue;
    const bytes = statSync(path).size;
    if (bytes > limit) out.push({ file: relative(dir, path).split(sep).join('/'), bytes, max: limit });
  }
  return out;
}

/**
 * The paths under `dir` (`public/playbooks/`) that are outside a language
 * folder: a file at its top or at the top of `inline/`, or a folder there
 * that is not a language. Sorted; empty when everything is in place.
 */
export function strayMediaPaths(dir = PLAYBOOKS_DIR, locales = LOCALES) {
  if (!existsSync(dir)) return [];
  const out = [];
  const top = (folder, prefix, allowed) => {
    if (!existsSync(folder)) return;
    for (const name of readdirSync(folder).sort()) {
      if (name.startsWith('.')) continue;
      const isDir = statSync(join(folder, name)).isDirectory();
      if (!isDir || !allowed.includes(name)) out.push(`${prefix}${name}${isDir ? '/' : ''}`);
    }
  };
  top(dir, '', [...locales, 'inline']);
  top(join(dir, 'inline'), 'inline/', locales);
  return out;
}

/** The files of `files` (paths relative to `dir`) that are not there. */
export function missingMediaFiles(files, dir = MEDIA_DIR) {
  return files.filter((f) => !existsSync(join(dir, f)));
}

/** The module for these sizes. Deterministic, so `--check` can compare it byte for byte. */
export function renderModule(sizes) {
  const rows = Object.entries(sizes).map(([key, s]) => `  ${JSON.stringify(key)}: { width: ${s.width}, height: ${s.height} },`);
  return [
    '// GENERATED by scripts/playbook-media.mjs from public/playbooks/inline/. Do not edit by hand:',
    '// add or replace the asset, then run `pnpm --filter @quill/web playbook-media`.',
    '',
    '/** The pixel size of each still under `/playbooks/inline/`, by its path below that folder (`<locale>/<slug>/<file>`). */',
    `export const PLAYBOOK_MEDIA_SIZES: Readonly<Record<string, { width: number; height: number }>> = {${rows.length ? '\n' + rows.join('\n') + '\n' : ''}};`,
    '',
  ].join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  let next;
  try {
    next = renderModule(readMediaSizes());
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
  if (check) {
    const stray = strayMediaPaths();
    if (stray.length > 0) {
      for (const path of stray) {
        console.error(`playbook-media: public/playbooks/${path} is outside a language folder (${LOCALES.join(', ')}): move it to public/playbooks/<locale>/ or public/playbooks/inline/<locale>/`);
      }
      process.exit(1);
    }
    const heavy = oversizedMediaFiles();
    if (heavy.length > 0) {
      const kb = (n) => `${Math.round(n / 1024)} KB`;
      for (const h of heavy) console.error(`playbook-media: ${h.file} weighs ${kb(h.bytes)}, over the ${kb(h.max)} limit`);
      process.exit(1);
    }
    if (current !== next) {
      console.error('playbook-media: lib/playbook-media.generated.ts is out of date. Run `node apps/web/scripts/playbook-media.mjs`.');
      process.exit(1);
    }
    console.log('playbook-media: up to date');
    return;
  }
  if (current !== next) writeFileSync(OUT_FILE, next);
  console.log(`playbook-media: ${current === next ? 'already up to date' : 'wrote lib/playbook-media.generated.ts'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
