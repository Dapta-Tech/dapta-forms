#!/usr/bin/env node
// Makes the downloadable PDF of every playbook, in every language:
// assets/playbooks-pdf/<locale>/<slug>.pdf, committed next to the code, and
// the manifest that says what each one was made from
// (scripts/playbook-pdfs.manifest.json). They are outside public/ on purpose:
// only a signed-in person gets one, through app/api/playbooks/[slug]/pdf.
//
//   pnpm --filter @quill/web playbook-pdfs          print what is missing or out of date
//   pnpm --filter @quill/web playbook-pdfs --all    print every one again
//   pnpm --filter @quill/web playbook-pdfs --check  fail if a PDF is missing, out of date,
//                                                   over MAX_PDF_BYTES, changed by hand,
//                                                   embedding a font that is not in the
//                                                   repository, or left over from a playbook
//                                                   that is gone
//   ... --html <folder>                             also leave the printed pages there
//
// A PDF is one HTML page printed by Chromium: the playbook's markdown read by
// the reader's own parser (lib/markdown.ts), the same split of its closing
// section (lib/playbook-body.ts), every animation as its poster and every
// image as it is, in dForms type and colors. Before printing, each picture is
// redrawn as a JPEG, which the PDF holds as is (a WebP would be stored
// uncompressed and weigh several times more).
//
// "Out of date" is decided without a browser: the page of each PDF is built
// again, with every file it embeds named by its content hash, and hashed
// together with the print settings and PRINT_VERSION. So an edit to the
// markdown, to a picture, to the parser, to this template or to the copy it
// prints makes the check fail until the PDF is printed again, and nothing else
// does. A change to HOW a page is printed (the code below that drives the
// browser) is invisible to that hash: bump PRINT_VERSION with it. CI runs the
// check (`lib/playbook-pdfs.spec.ts`); only printing needs Chromium
// (`pnpm exec playwright install chromium`, or an installed Chrome, or
// CHROME=<path to the executable>).
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, readCatalog } from '../../../packages/shared/scripts/playbooks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const repo = resolve(web, '..', '..');
const PUBLIC_DIR = join(web, 'public');
export const PDF_DIR = join(web, 'assets', 'playbooks-pdf');
export const MANIFEST_FILE = join(here, 'playbook-pdfs.manifest.json');
/** The brand face, one static file per weight the pages use. */
const FONT_WEIGHTS = [400, 600, 700, 800];
const fontFile = (weight) => join(web, 'assets', 'fonts', `hanken-grotesk-${weight}.ttf`);
/** The symbols the brand face lacks (scripts/build-symbols-font.py). */
const SYMBOLS_FILE = join(web, 'assets', 'fonts', 'dforms-symbols.ttf');
/** The only faces a PDF may embed, by the start of their PostScript name. */
const OWN_FONTS = /^(?:HankenGrotesk|dFormsSymbols)-/;
/**
 * Part of every PDF's hash. Bump it when the way a page is turned into a PDF
 * changes (`print`, `toJpeg`, the Chromium major printed with), so the check
 * asks for every file again.
 */
export const PRINT_VERSION = 2;
const LOGO_FILE = join(PUBLIC_DIR, 'forms_wordmark.svg');

/** The most a PDF may weigh: it is downloaded on a phone. */
export const MAX_PDF_BYTES = 1_500_000;

/** Where the playbooks are read on the web, per language. */
const SITE = { es: 'https://dforms.ai/recursos/', en: 'https://dforms.ai/en/recursos/' };
/** A link of the text that points at a page of the app. */
const APP_ORIGIN = 'https://app.dforms.ai';

/**
 * How the pictures are redrawn, from the best down: the next step is only used
 * for a PDF that would weigh over the limit with the one before.
 */
const PICTURE_STEPS = [
  { maxWidth: 1400, quality: 0.82 },
  { maxWidth: 1200, quality: 0.74 },
  { maxWidth: 1000, quality: 0.66 },
];

const PRINT = {
  format: 'A4',
  margin: { top: '16mm', right: '16mm', bottom: '18mm', left: '16mm' },
  printBackground: true,
  tagged: true,
  outline: true,
};

/**
 * How tall a picture may print, in millimetres, for the PDFs that paginate
 * badly at the default: one that would end on a nearly empty page, or leave
 * half a page blank before a picture that did not fit. Chosen by looking at
 * the pages, so look again (`pdftoppm`) after a long edit to a playbook.
 */
const PICTURE_MM = 115;
const PICTURE_MM_FOR = {
  'es/chatgpt-recomiende-tu-marca': 108,
  'es/formularios-que-venden-con-ia': 100,
  'en/formularios-que-venden-con-ia': 100,
  'es/hook-de-dolor': 70,
  'en/hook-de-dolor': 80,
  'es/manual-del-vendedor': 75,
  'en/manual-del-vendedor': 85,
  'en/prompts-prohibidos-vender-con-ia': 95,
  'en/vender-en-autopiloto-con-ia': 75,
};

const CSS = `
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:'Hanken Grotesk','dForms Symbols';font-synthesis:weight none;color:#45454C;background:#fff;font-size:11.5pt;line-height:1.6;overflow-wrap:break-word}
header{display:flex;justify-content:space-between;align-items:center;gap:6mm;padding-bottom:9mm;font-size:9pt;color:#67676F}
header img{width:28mm;height:auto}
a{color:#1A1A1C;text-decoration:underline;text-decoration-color:#3DDC84}
header a,footer a{color:inherit}
.category{margin:0 0 3mm;font-size:10pt;font-weight:600;color:#0E7A3F}
h1{margin:0 0 4mm;font-size:27pt;line-height:1.08;letter-spacing:-.03em;font-weight:800;color:#1A1A1C}
.summary{margin:0 0 8mm;padding-bottom:7mm;border-bottom:1px solid #E6E6E8;font-size:13pt;line-height:1.5}
h2{margin:8mm 0 3mm;font-size:16pt;line-height:1.25;letter-spacing:-.02em;font-weight:700;color:#1A1A1C;break-after:avoid}
h3,h4{margin:5mm 0 2mm;font-size:12.5pt;line-height:1.35;font-weight:700;color:#1A1A1C;break-after:avoid}
p{margin:0 0 3mm;orphans:3;widows:3}
strong{font-weight:700;color:#1A1A1C}
blockquote{margin:4mm 0;padding-left:4mm;border-left:1mm solid #3DDC84;font-weight:600;color:#1A1A1C;break-inside:avoid}
blockquote p{margin:0}
ul,ol{margin:0 0 3mm;padding-left:6mm}
li{margin-bottom:1.5mm}
li>ul,li>ol,li>p:last-child{margin-bottom:0}
pre{margin:0 0 4mm;padding:3mm 4mm;border:1px solid #E6E6E8;border-radius:2mm;background:#F5F5F7;font-family:inherit;font-size:10.5pt;line-height:1.55;color:#1A1A1C;white-space:pre-wrap}
code{font-family:inherit;font-weight:600;color:#1A1A1C}
table{width:100%;border-collapse:collapse;margin:0 0 4mm;font-size:10pt;line-height:1.45}
tr{break-inside:avoid}
th,td{padding:2mm 2.5mm;border:1px solid #E6E6E8;text-align:left;vertical-align:top}
th{background:#F5F5F7;font-weight:700;color:#1A1A1C}
hr{margin:6mm 0;border:0;border-top:1px solid #E6E6E8}
figure{margin:2mm 0 5mm;break-inside:avoid}
figure img{display:block;max-width:100%;max-height:var(--picture);width:auto;height:auto;margin:0 auto;border:1px solid #E6E6E8;border-radius:2mm}
section.do-it{margin-top:8mm;padding:1mm 6mm 3mm;border:1px solid #BFEFD3;border-radius:3mm;background:#F0FBF5;-webkit-box-decoration-break:clone;box-decoration-break:clone}
section.do-it h2{margin-top:4mm}
footer{margin-top:6mm;padding-top:3mm;border-top:1px solid #D5EFE0;font-size:9pt;color:#67676F}
.tail{break-inside:avoid}
`;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const posix = (path) => path.split(sep).join('/');
const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let sources;
/**
 * The app's own modules the pages are built with, bundled from TypeScript on
 * the spot (nothing needs to be built first): the markdown reader, the split
 * of the closing section, the catalogs of copy and the media file names.
 */
function appSources() {
  sources ??= (async () => {
    const { build } = await import('esbuild');
    const shared = join(repo, 'packages', 'shared', 'src');
    // The app imports these from the package root; the root also pulls modules
    // the pages have no use for, so only what they read stands in for it.
    const root = {
      name: 'quill-shared-sources',
      setup(b) {
        b.onResolve({ filter: /^@quill\/shared$/ }, () => ({ path: 'root', namespace: 'quill-shared' }));
        b.onLoad({ filter: /.*/, namespace: 'quill-shared' }, () => ({
          contents: "export * from './playbook-media'; export * from './i18n/index';",
          resolveDir: shared,
          loader: 'ts',
        }));
      },
    };
    const result = await build({
      stdin: {
        contents: [
          "export { parseMarkdown, parseInline, inlineText } from './lib/markdown';",
          "export { splitDoIt } from './lib/playbook-body';",
          "export { playbookMediaStill, PLAYBOOK_MEDIA_BASE, getMessages } from '@quill/shared';",
        ].join('\n'),
        resolveDir: web,
        loader: 'ts',
      },
      plugins: [root],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
    });
    const code = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  })();
  return sources;
}

/** `asset:<path from the repo root>#<hash>`: how a page names a file it embeds. */
function assetRef(path) {
  if (!existsSync(path)) throw new Error(`playbook-pdfs: missing file ${posix(relative(repo, path))}`);
  return `asset:${posix(relative(repo, path))}#${sha256(readFileSync(path))}`;
}

const fontFace = (weight) =>
  `@font-face{font-family:'Hanken Grotesk';font-weight:${weight};src:url("${assetRef(fontFile(weight))}") format("truetype")}`;

/**
 * In a printed quote every line is a line of its own (the quotes of the
 * playbooks are sample conversations with an AI), where the markdown reader
 * would run them into one paragraph. A blank quoted line between two quoted
 * ones keeps them apart.
 */
export const splitQuoteLines = (markdown) => markdown.replace(/^(>[ \t]*[^\s|].*)\n(?=>[ \t]*[^\s|])/gm, '$1\n>\n');

const symbolsFace = () =>
  `@font-face{font-family:'dForms Symbols';font-weight:100 900;src:url("${assetRef(SYMBOLS_FILE)}") format("truetype")}`;

const words = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function renderer(app, locale) {
  const inline = (nodes) =>
    nodes
      .map((n) => {
        if (n.kind === 'text') return escapeHtml(n.text);
        if (n.kind === 'code') return `<code>${escapeHtml(n.text)}</code>`;
        if (n.kind === 'strong') return `<strong>${inline(n.children)}</strong>`;
        if (n.kind === 'em') return `<em>${inline(n.children)}</em>`;
        // An anchor of the reader has nothing to point at in the file.
        if (n.href.startsWith('#')) return inline(n.children);
        const href = n.href.startsWith('/') ? `${APP_ORIGIN}${n.href}` : n.href;
        return `<a href="${escapeHtml(href)}">${inline(n.children)}</a>`;
      })
      .join('');
  const text = (value) => inline(app.parseInline(value));

  const block = (b, tight = false) => {
    switch (b.kind) {
      case 'heading': {
        const level = Math.max(2, b.level);
        return `<h${level}>${text(b.text)}</h${level}>`;
      }
      case 'paragraph':
        return tight ? text(b.text) : `<p>${text(b.text)}</p>`;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
        const items = b.items.map(
          (item) => `<li>${item.map((child, j) => block(child, item.length === 1 || (j === 0 && child.kind === 'paragraph'))).join('')}</li>`,
        );
        return `<${tag}${start}>${items.join('')}</${tag}>`;
      }
      case 'quote':
        return `<blockquote>${b.blocks.map((child) => block(child)).join('')}</blockquote>`;
      case 'code':
        return `<pre>${escapeHtml(b.text)}</pre>`;
      case 'table': {
        const head = b.header.map((cell) => `<th scope="col">${text(cell)}</th>`).join('');
        const rows = b.rows.map((row) => `<tr>${b.header.map((_, j) => `<td>${text(row[j] ?? '')}</td>`).join('')}</tr>`);
        return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
      }
      case 'rule':
        return '<hr>';
      case 'media': {
        // The still of the language: the poster of a loop, the image itself.
        const file = join(PUBLIC_DIR, app.PLAYBOOK_MEDIA_BASE, app.playbookMediaStill(b.media, locale));
        return `<figure><img src="${assetRef(file)}" alt="${escapeHtml(b.media.alt)}"></figure>`;
      }
      default:
        throw new Error(`playbook-pdfs: the reader draws a "${b.kind}" block this script does not`);
    }
  };
  return { block, text };
}

/** The page one playbook is printed from, every embedded file named by its hash. */
export async function playbookPage(playbook) {
  const app = await appSources();
  const { locale, slug } = playbook;
  const m = app.getMessages(locale).admin.playbooks;
  const { block, text } = renderer(app, locale);
  const markdown = splitQuoteLines(`${playbook.preview}\n\n${playbook.rest}`);
  const { body, doIt, heading } = app.splitDoIt(app.parseMarkdown(markdown));
  // Most playbooks open on their summary; read twice in a row it looks like a mistake.
  const first = body.findIndex((b) => b.kind !== 'media');
  const opening = body[first];
  const repeated = opening?.kind === 'paragraph' && words(app.inlineText(opening.text)) === words(playbook.summary);
  const main = repeated ? body.filter((_, i) => i !== first) : body;
  const page = `${SITE[locale]}${slug}/`;
  const link = (url) => `<a href="${url}">${url.replace('https://', '')}</a>`;
  // The closing line travels with the block before it, so it never gets a page
  // of its own.
  const footer = `<footer>${escapeHtml(m.pdf.footer)} ${link(SITE[locale])}</footer>`;
  const closed = (blocks) => {
    const html = blocks.map((b) => block(b));
    const last = html.pop() ?? '';
    return [...html, `<div class="tail">${last}${footer}</div>`].join('\n');
  };
  return [
    '<!DOCTYPE html>',
    `<html lang="${locale}" style="--picture:${PICTURE_MM_FOR[`${locale}/${slug}`] ?? PICTURE_MM}mm"><head><meta charset="utf-8"><title>${escapeHtml(playbook.title)}</title>`,
    `<style>${FONT_WEIGHTS.map(fontFace).join('')}${symbolsFace()}${CSS}</style></head><body>`,
    `<header><img src="${assetRef(LOGO_FILE)}" alt="dForms"><span>${link(page)}</span></header>`,
    '<main>',
    `<p class="category">${escapeHtml(m.categories[playbook.category])}</p>`,
    `<h1>${escapeHtml(playbook.title)}</h1>`,
    `<p class="summary">${escapeHtml(playbook.summary)}</p>`,
    ...(heading === null
      ? [closed(main)]
      : [...main.map((b) => block(b)), `<section class="do-it"><h2>${text(heading)}</h2>${closed(doIt)}</section>`]),
    '</main>',
    '</body></html>',
  ].join('\n');
}

/** The hash a PDF is up to date with: its page and the settings it is printed with. */
export function sourceHash(page) {
  return sha256(JSON.stringify({ version: PRINT_VERSION, page, print: PRINT, pictures: PICTURE_STEPS }));
}

/** Every playbook of every language, with its key (`<locale>/<slug>`) and its page. */
export async function playbookPages(catalog = readCatalog()) {
  const out = [];
  for (const locale of LOCALES) {
    for (const playbook of catalog[locale]) {
      const page = await playbookPage(playbook);
      out.push({ key: `${locale}/${playbook.slug}`, page, source: sourceHash(page) });
    }
  }
  return out;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

export function readManifest(file = MANIFEST_FILE) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/**
 * The faces a PDF embeds that are not the repository's: a glyph neither of ours
 * has is drawn with a font of the printing machine, which may not be ours to
 * ship. Chromium writes the font dictionaries uncompressed.
 */
export function foreignFonts(data) {
  const names = [...data.toString('latin1').matchAll(/\/(?:BaseFont|FontName)\s*\/(?:[A-Z]{6}\+)?([^\s/<>[\]()]+)/g)].map((m) => m[1]);
  return [...new Set(names.filter((name) => !OWN_FONTS.test(name)))].sort();
}

/**
 * What is wrong with the committed PDFs, one line per problem (none when all
 * is well): `pages` is what the catalog asks for (`playbookPages`).
 */
export function pdfProblems(pages, { dir = PDF_DIR, manifest = readManifest(), maxBytes = MAX_PDF_BYTES } = {}) {
  const problems = [];
  const wanted = new Set(pages.map((p) => `${p.key}.pdf`));
  for (const { key, source } of pages) {
    const file = join(dir, `${key}.pdf`);
    if (!existsSync(file)) {
      problems.push(`${key}.pdf is missing`);
      continue;
    }
    const data = readFileSync(file);
    const entry = manifest[key];
    if (data.length > maxBytes) problems.push(`${key}.pdf weighs ${data.length} bytes, over the ${maxBytes} limit`);
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') problems.push(`${key}.pdf is not a PDF`);
    const foreign = foreignFonts(data);
    if (foreign.length > 0) {
      problems.push(`${key}.pdf embeds ${foreign.join(', ')}: a character neither of our faces has (see scripts/build-symbols-font.py)`);
    }
    if (!entry) problems.push(`${key}.pdf is not in the manifest`);
    else if (entry.source !== source) problems.push(`${key}.pdf is out of date: its playbook, a picture or the template changed`);
    else if (entry.pdf !== sha256(data)) problems.push(`${key}.pdf is not the file the manifest was written for`);
  }
  for (const path of walk(dir)) {
    const name = posix(relative(dir, path));
    if (!wanted.has(name)) problems.push(`${name} belongs to no playbook: delete it`);
  }
  for (const key of Object.keys(manifest)) {
    if (!wanted.has(`${key}.pdf`)) problems.push(`the manifest names ${key}, which is no playbook`);
  }
  return problems;
}

async function launch() {
  const { chromium } = await import('@playwright/test');
  if (process.env.CHROME) return chromium.launch({ executablePath: process.env.CHROME });
  try {
    return await chromium.launch();
  } catch (err) {
    // No browser downloaded for this Playwright: an installed Chrome prints the same page.
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch {
      throw err;
    }
  }
}

const MIME = { webp: 'image/webp', svg: 'image/svg+xml', ttf: 'font/ttf' };
const dataUrl = (path) =>
  `data:${MIME[path.split('.').pop()] ?? 'application/octet-stream'};base64,${readFileSync(path).toString('base64')}`;

/** Redraw one picture as a JPEG on white, at most `maxWidth` wide, in the browser. */
function toJpeg(tab, url, { maxWidth, quality }) {
  return tab.evaluate(
    async ({ url, maxWidth, quality }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const width = Math.min(maxWidth, img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round((img.naturalHeight * width) / img.naturalWidth);
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', quality);
    },
    { url, maxWidth, quality },
  );
}

async function print(browser, page, step) {
  const tab = await browser.newPage();
  try {
    let html = page;
    for (const [ref, path] of new Map([...page.matchAll(/asset:([^#"]+)#[0-9a-f]{64}/g)].map((m) => [m[0], m[1]]))) {
      const url = dataUrl(join(repo, path));
      html = html.replaceAll(ref, path.endsWith('.webp') ? await toJpeg(tab, url, step) : url);
    }
    await tab.setContent(html, { waitUntil: 'load' });
    await tab.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
      const faces = [...document.fonts];
      if (faces.some((f) => f.status === 'error') || !faces.some((f) => f.status === 'loaded')) throw new Error('the brand font did not load');
    });
    return await tab.pdf(PRINT);
  } finally {
    await tab.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const pages = await playbookPages();
  if (args.includes('--check')) {
    const problems = pdfProblems(pages);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`playbook-pdfs: ${problem}`);
      console.error('playbook-pdfs: run `pnpm --filter @quill/web playbook-pdfs` and commit the result.');
      process.exit(1);
    }
    console.log(`playbook-pdfs: ${pages.length} PDFs up to date`);
    return;
  }

  const htmlDir = args.includes('--html') ? resolve(args[args.indexOf('--html') + 1]) : null;
  const manifest = readManifest();
  const next = {};
  // The files of playbooks that are gone.
  const wanted = new Set(pages.map((p) => `${p.key}.pdf`));
  for (const path of walk(PDF_DIR)) {
    if (!wanted.has(posix(relative(PDF_DIR, path)))) rmSync(path);
  }

  let browser;
  let printed = 0;
  try {
    for (const { key, page, source } of pages) {
      const file = join(PDF_DIR, `${key}.pdf`);
      if (htmlDir) {
        mkdirSync(dirname(join(htmlDir, key)), { recursive: true });
        writeFileSync(join(htmlDir, `${key}.html`), page);
      }
      const upToDate = existsSync(file) && manifest[key]?.source === source && manifest[key]?.pdf === sha256(readFileSync(file));
      if (upToDate && !args.includes('--all')) {
        next[key] = manifest[key];
        continue;
      }
      browser ??= await launch();
      let data;
      for (const step of PICTURE_STEPS) {
        data = await print(browser, page, step);
        if (data.length <= MAX_PDF_BYTES) break;
      }
      if (data.length > MAX_PDF_BYTES) throw new Error(`playbook-pdfs: ${key}.pdf weighs ${data.length} bytes, over the ${MAX_PDF_BYTES} limit`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
      next[key] = { source, pdf: sha256(data), bytes: data.length };
      printed += 1;
      console.log(`playbook-pdfs: ${key}.pdf, ${Math.round(data.length / 1000)} kB`);
    }
  } finally {
    await browser?.close();
  }
  const sorted = Object.fromEntries(Object.keys(next).sort().map((key) => [key, next[key]]));
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  const total = Object.values(next).reduce((sum, e) => sum + e.bytes, 0);
  console.log(`playbook-pdfs: printed ${printed}, ${pages.length} PDFs, ${(total / 1_000_000).toFixed(2)} MB in total`);
}

// Through the real paths: run from a checkout reached by a symlink, the two
// spell the same file differently, and a check that did nothing would pass.
const invoked = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : null;
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
