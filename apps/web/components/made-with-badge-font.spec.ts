/**
 * The "Made with dForms" pill keeps the brand face on every form.
 *
 * `.pf` sets `font-family: var(--pf-font, ...)` from `branding.fontFamily` (or an
 * uploaded custom font), and the pill used to inherit it, so the product's own
 * signature changed voice with every form. This pins the rule that stops the
 * inheritance: the pill link names `--font-sans` (Hanken Grotesk) itself, and
 * never `--pf-font`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  fileURLToPath(new URL('../app/[accountCode]/[handle]/[slug]/public-form.css', import.meta.url)),
  'utf8',
);

/** Every declaration block whose selector list is exactly `selector`. */
function blocks(selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of CSS.matchAll(re)) {
    const sel = match[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (sel === selector) out.push(match[2]!);
  }
  return out;
}

describe('Made with dForms pill font', () => {
  it('sets the brand face on the link, not the form font', () => {
    const link = blocks('.pf__attribution-link');
    expect(link).toHaveLength(1);
    expect(link[0]).toMatch(/font-family:\s*var\(--font-sans\b/);
    expect(link[0]).not.toContain('--pf-font');
  });

  it('no attribution rule switches it back to the form font', () => {
    for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = match[1]!.replace(/\/\*[\s\S]*?\*\//g, '');
      if (!sel.includes('pf__attribution')) continue;
      expect(match[2]).not.toContain('--pf-font');
    }
  });
});
