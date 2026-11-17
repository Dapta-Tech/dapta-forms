import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';

/**
 * Mounts real admin components in a blank page, with the app's real CSS.
 *
 * The page is built from two artifacts, both made from the source tree on the
 * first call and reused for the rest of the run:
 *
 *  - the JS: `entry.tsx` bundled with esbuild, which follows the imports into
 *    `apps/web` and so ships the component under test exactly as written;
 *  - the CSS: `apps/web/app/globals.css` run through the app's own Tailwind
 *    PostCSS plugin, the same input and the same plugin `next build` uses.
 *
 * So a spec measures what a browser does with the shipped component and the
 * shipped utilities, and needs no API, no database and no port. The one thing
 * it does need is the workspace packages built (`pnpm build:packages`, which
 * `pnpm qa:component` runs first): `@quill/shared` resolves to its `dist/`.
 *
 * What it does NOT get is the app's web font: text is set in the fallback face,
 * so specs must assert on relations (inside this box, same width as before),
 * never on a pixel count that depends on glyph widths.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const web = path.join(repo, 'apps/web');

// Tailwind and PostCSS are the web app's dependencies, not the repo root's.
// Resolving them through the app is what guarantees this is the plugin (and the
// version) that compiles the real stylesheet, rather than a second copy pinned
// here that could drift from it.
const webRequire = createRequire(path.join(web, 'package.json'));
const tailwindPath = webRequire.resolve('@tailwindcss/postcss');

async function compileCss(): Promise<string> {
  const tailwind = webRequire('@tailwindcss/postcss') as (options: { base: string }) => unknown;
  const postcss = createRequire(tailwindPath)('postcss') as (plugins: unknown[]) => {
    process: (css: string, options: { from: string }) => Promise<{ css: string }>;
  };
  const from = path.join(web, 'app/globals.css');
  // `base` is where Tailwind looks for class names. Next runs the plugin from
  // `apps/web`, so that is what makes the utilities here the app's own set: a
  // class the app does not use does not exist in this page either.
  const result = await postcss([tailwind({ base: web })]).process(await readFile(from, 'utf8'), { from });
  return result.css;
}

async function compileJs(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(here, 'entry.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    // The `@/` alias, and React resolved from the app (the entry lives outside it).
    tsconfig: path.join(web, 'tsconfig.json'),
    nodePaths: [path.join(web, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  return result.outputFiles[0]!.text;
}

let assets: Promise<{ css: string; js: string }> | undefined;

/**
 * Replace the page with `body` (plain HTML scaffolding) and mount a component
 * into every placeholder it contains. See `entry.tsx` for the placeholders.
 *
 * Scaffolding may use any utility class the app already uses, since those are
 * in the compiled sheet; anything else needs an inline style.
 */
export async function mount(page: Page, body: string, theme: 'light' | 'dark' = 'light'): Promise<void> {
  assets ??= Promise.all([compileCss(), compileJs()]).then(([css, js]) => ({ css, js }));
  const { css, js } = await assets;
  await page.setContent(
    `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${body}</body></html>`,
  );
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() => document.documentElement.dataset.mounted === 'true');
}
