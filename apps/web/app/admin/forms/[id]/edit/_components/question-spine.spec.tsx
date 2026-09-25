// @vitest-environment happy-dom
/**
 * The partial submit point's popover while spam protection holds partials.
 *
 * The builder recommends placing the point right after the email question, so
 * an author with protection on is exactly the one who needs to be told that a
 * partial is now saved and sent nowhere. Said on the marker itself, where the
 * decision is made, and only while it is true.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FormStep } from '@quill/engine';
import { getBuilderMessages, tb } from './builder-messages';
import { QuestionSpine } from './question-spine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

const steps = [
  { key: 'email', type: 'email', question: 'Email?' },
  { key: 'company', type: 'text', question: 'Company?' },
] as FormStep[];

async function openPopover(partialsHeld: boolean | undefined, locale: 'en' | 'es' = 'en') {
  const m = getBuilderMessages(locale);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QuestionSpine
        steps={steps}
        layout="slides"
        selectedIndex={0}
        onSelect={() => {}}
        onReorder={() => {}}
        onAdd={() => {}}
        partialAfterStep={1}
        onPartialChange={() => {}}
        partialsHeld={partialsHeld}
        m={m}
      />,
    ),
  );
  await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="partial-point-info"]')!.click());
  return m;
}

describe('the partial submit point with spam protection', () => {
  it('says partials are saved but not sent while protection holds them', async () => {
    const m = await openPopover(true, 'es');
    expect(host!.querySelector('[data-testid="partial-point-captcha"]')!.textContent).toBe(m.partial.tipCaptcha);
    // Beside, not instead of, what the point still does.
    expect(host!.textContent).toContain(m.partial.tipCapture);
  });

  it('says nothing about it otherwise', async () => {
    await openPopover(false);
    expect(host!.querySelector('[data-testid="partial-point-captcha"]')).toBeNull();
    await act(async () => root?.unmount());
    host?.remove();
    await openPopover(undefined);
    expect(host!.querySelector('[data-testid="partial-point-captcha"]')).toBeNull();
  });
});

describe('screens in the spine (#200)', () => {
  const grouped = [
    { key: 'intro', type: 'message', question: 'Hi' },
    { key: 'name', type: 'text', question: 'Name?', screenGroup: 'screen_1' },
    { key: 'email', type: 'email', question: 'Email?', screenGroup: 'screen_1' },
    { key: 'meet', type: 'scheduler', question: 'Book' },
    { key: 'extra', type: 'text', question: 'Extra', hidden: true },
    { key: 'last', type: 'text', question: 'Last?' },
  ] as FormStep[];

  async function renderSpine(layout: 'slides' | 'vertical', onScreenJoin = (_i: number, _j: boolean) => {}) {
    const m = getBuilderMessages('en');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <QuestionSpine
          steps={grouped}
          layout={layout}
          selectedIndex={0}
          onSelect={() => {}}
          onReorder={() => {}}
          onScreenJoin={onScreenJoin}
          onAdd={() => {}}
          onPartialChange={() => {}}
          m={m}
        />,
      ),
    );
    return m;
  }
  const toggle = (i: number) => host!.querySelector<HTMLButtonElement>(`[data-testid="screen-toggle-${i}"]`)!;

  it('offers a toggle on every row, joined where the screen is', async () => {
    const m = await renderSpine('slides');
    expect(host!.querySelectorAll('[data-testid^="screen-toggle-"]')).toHaveLength(grouped.length);
    expect(toggle(2).dataset.joined).toBe('true');
    expect(toggle(2).getAttribute('aria-label')).toBe(m.screens.split);
    expect(toggle(1).dataset.joined).toBe('false');
    expect(toggle(1).getAttribute('aria-label')).toBe(m.screens.join);
    expect(toggle(1).getAttribute('aria-disabled')).toBeNull();
  });

  it('names the screen on its first row, and nowhere else', async () => {
    const m = await renderSpine('slides');
    const chips = host!.querySelectorAll('[data-testid="spine-screen-chip"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toBe(tb(m.screens.chip, { n: 2, count: 2 }));
  });

  it('refuses a boundary that cannot be joined, and says why', async () => {
    const m = await renderSpine('slides');
    const cases: Array<[number, string]> = [
      [0, m.screens.first],
      [3, m.screens.soloType],
      [4, m.screens.hidden],
    ];
    for (const [i, reason] of cases) {
      expect(toggle(i).getAttribute('aria-disabled')).toBe('true');
      expect(toggle(i).title).toBe(reason);
      // Described by the row's question, then the reason.
      const described = toggle(i)
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => document.getElementById(id)!.textContent);
      expect(described).toEqual([grouped[i]!.question, reason]);
    }
  });

  it('joins and splits through the editor, and a refused click does nothing', async () => {
    const calls: Array<[number, boolean]> = [];
    await renderSpine('slides', (i, joined) => calls.push([i, joined]));
    await act(async () => toggle(1).click());
    await act(async () => toggle(2).click());
    await act(async () => toggle(3).click());
    expect(calls).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('draws nothing of it on one page', async () => {
    await renderSpine('vertical');
    expect(host!.querySelector('[data-testid^="screen-toggle-"]')).toBeNull();
    expect(host!.querySelector('[data-testid="spine-screen-chip"]')).toBeNull();
    expect(host!.querySelector('[data-screen-row]')).toBeNull();
  });
});

describe('the lead-capture nudge on a form with screens (#200)', () => {
  it('stays away when the email is on the last screen, where the point could never fire', async () => {
    const m = getBuilderMessages('en');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const steps = [
      { key: 'intro', type: 'message', question: 'Hi' },
      { key: 'email', type: 'email', question: 'Email?', screenGroup: 'last' },
      { key: 'name', type: 'text', question: 'Name?', screenGroup: 'last' },
    ] as FormStep[];
    const render = (layout: 'slides' | 'vertical') =>
      root!.render(
        <QuestionSpine
          steps={steps}
          layout={layout}
          selectedIndex={0}
          onSelect={() => {}}
          onReorder={() => {}}
          onScreenJoin={() => {}}
          onAdd={() => {}}
          onPartialChange={() => {}}
          m={m}
        />,
      );
    await act(async () => render('slides'));
    expect(host!.querySelector('[data-testid="partial-point-suggest"]')).toBeNull();
    // On one page the email is not last, so the point after it still means something.
    await act(async () => render('vertical'));
    expect(host!.querySelector('[data-testid="partial-point-suggest"]')).not.toBeNull();
  });
});
