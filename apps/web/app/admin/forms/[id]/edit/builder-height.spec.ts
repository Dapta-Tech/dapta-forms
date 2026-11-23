/**
 * The builder sizes itself by the room the admin shell leaves it, never by the
 * viewport. The shell puts the referral banner (48px) above it on this route,
 * and the mobile top bar below 768px: a builder that took `100dvh` for itself
 * would push its bottom edge (the inspector, "Add question", the question list)
 * that far off screen. The shell's side is covered in admin-shell-referral.spec.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = __dirname;
const VIEWPORT_HEIGHT = /\b(?:h|min-h|max-h)-(?:screen|dvh|svh|lvh|\[100(?:dvh|vh|svh|lvh)\])/;

/** Every Tailwind class list in a file: `className="..."` and `className={'...'}` / template literals. */
function classLists(source: string): string[] {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{\s*[`'"]([^`'"]*)[`'"])/g)].map((m) => m[1] ?? m[2] ?? '');
}

describe('the builder fits the room the shell leaves it', () => {
  it('its root is a flex child that fills <main>, not a viewport-tall box', () => {
    const source = readFileSync(join(DIR, 'form-editor.tsx'), 'utf8');
    const root = source.match(/<div className="([^"]*)">\s*\{\/\* Topbar/);
    expect(root, 'the editor root <div> before the topbar').not.toBeNull();
    const cls = root![1]!.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(['flex', 'min-h-0', 'flex-1', 'flex-col', 'overflow-hidden']));
    expect(root![1]).not.toMatch(VIEWPORT_HEIGHT);
  });

  it('no builder surface takes the viewport height for itself', () => {
    const files = [
      'form-editor.tsx',
      ...readdirSync(join(DIR, '_components'))
        .filter((f) => f.endsWith('.tsx') && !f.endsWith('.spec.tsx'))
        .map((f) => join('_components', f)),
    ];
    const offenders = files.flatMap((f) =>
      classLists(readFileSync(join(DIR, f), 'utf8'))
        .filter((c) => VIEWPORT_HEIGHT.test(c))
        .map((c) => `${f}: ${c}`),
    );
    expect(offenders).toEqual([]);
  });
});
