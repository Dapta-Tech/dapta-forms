import pw from '/Users/fg_dapta/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pw;
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pages = [
  ['01-empty', 'Guided empty state'],
  ['02-gallery', 'Add-question type gallery'],
  ['03-canvas', 'WYSIWYG canvas (3-pane)'],
  ['04-logic', 'Inline logic rule builder'],
  ['05-logicmap', 'Logic map'],
  ['06-results', 'Scoring & results'],
];
const viewports = [
  ['1520', 1520, 982],
  ['360', 360, 800],
];

const browser = await chromium.launch();
for (const [file, label] of pages) {
  for (const [tag, w, h] of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(dir, file + '.html'));
    await page.waitForTimeout(250);
    const full = tag === '360'; // mobile pages scroll; desktop frames are fixed 100vh
    await page.screenshot({ path: path.join(dir, `${file}-${tag}.png`), fullPage: full });
    await ctx.close();
    console.log(`shot ${file}-${tag}.png  (${label})`);
  }
}
await browser.close();
console.log('done');
