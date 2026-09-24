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
import { getBuilderMessages } from './builder-messages';
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
