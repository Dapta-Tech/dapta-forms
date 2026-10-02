// Generates app/icons.css: the app's icon sheet.
//
// Every icon in the app is an `<i className="pi pi-NAME" />`, and icon names
// travel through the code as plain strings (toolbar configs, the question-type
// gallery, the nav table). This script keeps that contract and swaps what is
// drawn: each `pi-NAME` becomes a CSS mask over `currentColor`, cut from a Lucide
// outline, so an icon still sizes with `font-size` and colours with `color`
// exactly as the icon font did, and no call site changes.
//
//   node scripts/build-icons.mjs          write app/icons.css
//   node scripts/build-icons.mjs --check  fail if a `pi-NAME` in the source has
//                                         no entry here, or the sheet is stale
//
// The output is committed, so a build needs neither this script nor the
// `lucide-static` dev dependency it reads from.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const ICONS = join(web, 'node_modules', 'lucide-static', 'icons');
const OUT = join(web, 'app', 'icons.css');

/**
 * `pi-NAME` → Lucide icon. A trailing `:fill` paints the outline solid, for the
 * handful of names that mean "this one is on" (an active filter, a set flag).
 */
const MAP = {
  'align-left': 'text-align-start',
  'angle-double-left': 'panel-left-close',
  'angle-double-right': 'panel-left-open',
  'angle-down': 'chevron-down',
  'arrow-down': 'arrow-down',
  'arrow-left': 'arrow-left',
  'arrow-right': 'arrow-right',
  'arrow-up-right': 'arrow-up-right',
  'arrows-alt': 'move',
  at: 'at-sign',
  ban: 'ban',
  bars: 'menu',
  bell: 'bell',
  bolt: 'zap',
  book: 'book-open',
  calendar: 'calendar',
  'calendar-plus': 'calendar-plus',
  'chart-bar': 'chart-column',
  'chart-line': 'chart-line',
  check: 'check',
  'check-circle': 'circle-check',
  'check-square': 'square-check',
  'chevron-circle-down': 'circle-chevron-down',
  'chevron-down': 'chevron-down',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  'chevron-up': 'chevron-up',
  circle: 'circle',
  'circle-off': 'circle-off',
  clock: 'clock',
  clipboard: 'clipboard',
  clone: 'layers-2',
  code: 'code',
  cog: 'settings',
  comment: 'message-square',
  copy: 'copy',
  desktop: 'monitor',
  directions: 'signpost',
  download: 'download',
  'ellipsis-v': 'ellipsis-vertical',
  envelope: 'mail',
  'exclamation-circle': 'circle-alert',
  'exclamation-triangle': 'triangle-alert',
  expand: 'expand',
  'external-link': 'arrow-up-right',
  eye: 'eye',
  'file-edit': 'file-pen-line',
  'file-import': 'file-input',
  filter: 'funnel',
  'filter-fill': 'funnel:fill',
  flag: 'flag',
  'flag-fill': 'flag:fill',
  folder: 'folder',
  'folder-plus': 'folder-plus',
  globe: 'globe',
  history: 'history',
  home: 'house',
  'id-card': 'id-card',
  inbox: 'inbox',
  'info-circle': 'info',
  key: 'key-round',
  link: 'link',
  list: 'list',
  lock: 'lock',
  'microchip-ai': 'sparkle',
  minus: 'minus',
  mobile: 'smartphone',
  moon: 'moon',
  palette: 'droplet',
  paperclip: 'paperclip',
  pencil: 'pencil',
  phone: 'phone',
  plus: 'plus',
  qrcode: 'qr-code',
  refresh: 'refresh-cw',
  replay: 'rotate-ccw',
  search: 'search',
  send: 'send',
  shield: 'shield',
  'sign-out': 'log-out',
  sitemap: 'split',
  'sliders-h': 'sliders-horizontal',
  'sort-amount-down': 'arrow-down-wide-narrow',
  'sort-amount-up-alt': 'arrow-up-narrow-wide',
  sparkles: 'sparkles',
  spinner: 'loader-circle',
  star: 'star',
  'star-fill': 'star:fill',
  stop: 'square',
  sun: 'sun',
  sync: 'refresh-cw',
  table: 'table',
  tablet: 'tablet',
  'th-large': 'layout-grid',
  times: 'x',
  trash: 'trash-2',
  user: 'user',
  users: 'users',
  'window-maximize': 'maximize-2',
  'window-minimize': 'minimize-2',
};

/** Not icons: modifier classes, and the string `api-url` the name regex also hits. */
const NOT_ICONS = new Set(['spin', 'url']);

function svgFor(spec) {
  const [name, mode] = spec.split(':');
  let svg;
  try {
    svg = readFileSync(join(ICONS, `${name}.svg`), 'utf8');
  } catch {
    throw new Error(`lucide-static has no icon named "${name}"`);
  }
  const inner = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[\s\S]*?>/, '')
    .replace(/<\/svg>/, '')
    .replace(/\s*\n\s*/g, '')
    .trim();
  const fill = mode === 'fill' ? '#000' : 'none';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}" stroke="#000" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
  );
}

function dataUri(svg) {
  const body = svg
    .replace(/"/g, "'")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E');
  return `url("data:image/svg+xml,${body}")`;
}

function build() {
  const rules = Object.keys(MAP)
    .sort()
    .map((name) => `.pi-${name}{--pi:${dataUri(svgFor(MAP[name]))}}`)
    .join('\n');
  return `/* GENERATED by scripts/build-icons.mjs. Do not edit: change the map there and
   rerun \`pnpm --filter @quill/web icons\`.

   Icon outlines are from Lucide (https://lucide.dev), ISC License,
   Copyright (c) Lucide Contributors. Portions derived from Feather (MIT),
   Copyright (c) 2013-2023 Cole Bemis. */

/* One icon = one mask over \`currentColor\`. It sizes with \`font-size\` (1em
   square) and colours with \`color\`, which is the contract every call site was
   written against. An unmapped name paints NOTHING rather than a solid square:
   the fallback mask is fully transparent, and \`--check\` is what catches it. */
.pi {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  vertical-align: -0.125em;
  background-color: currentColor;
  -webkit-mask: var(--pi, linear-gradient(transparent, transparent)) center / contain no-repeat;
  mask: var(--pi, linear-gradient(transparent, transparent)) center / contain no-repeat;
}

.pi-spin {
  animation: pi-spin 0.9s linear infinite;
}

@keyframes pi-spin {
  to {
    transform: rotate(360deg);
  }
}

${rules}
`;
}

/** Every `pi-NAME` literal in the app source. */
function usedNames() {
  const names = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.next')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/.test(entry)) {
        for (const m of readFileSync(full, 'utf8').matchAll(/\bpi-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) names.add(m[1]);
      }
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(join(web, root));
  return names;
}

const css = build();
if (process.argv.includes('--check')) {
  const missing = [...usedNames()].filter((n) => !MAP[n] && !NOT_ICONS.has(n)).sort();
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    /* no sheet yet */
  }
  if (missing.length) console.error(`No icon mapped for: ${missing.map((n) => `pi-${n}`).join(', ')}`);
  if (current !== css) console.error('app/icons.css is stale. Run: pnpm --filter @quill/web icons');
  process.exit(missing.length || current !== css ? 1 : 0);
}
writeFileSync(OUT, css);
console.log(`icons.css: ${Object.keys(MAP).length} icons, ${(css.length / 1024).toFixed(1)} KB`);
