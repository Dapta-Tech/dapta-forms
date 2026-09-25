// @vitest-environment happy-dom
/**
 * `useAnnounceScreenChange`: a renderer announces whole-screen swaps, and never
 * the screen it first renders with, so an embedded page never moves its host
 * on load. Checked under StrictMode too, whose development double run of
 * effects is exactly what would turn the first screen into a "change".
 */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { EMBED_SCREEN_EVENT, useAnnounceScreenChange } from './embed-screen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let heard = 0;
const listen = () => {
  heard += 1;
};

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  window.removeEventListener(EMBED_SCREEN_EVENT, listen);
  heard = 0;
});

function Screen({ phase }: { phase: string }) {
  useAnnounceScreenChange(phase);
  return null;
}

async function render(phase: string) {
  await act(async () =>
    root!.render(
      <StrictMode>
        <Screen phase={phase} />
      </StrictMode>,
    ),
  );
}

describe('useAnnounceScreenChange', () => {
  it('stays quiet on the first screen, then announces each real change once', async () => {
    window.addEventListener(EMBED_SCREEN_EVENT, listen);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await render('form');
    expect(heard).toBe(0);

    await render('form'); // a re-render on the same screen is not a swap
    expect(heard).toBe(0);

    await render('submitting');
    expect(heard).toBe(1);

    await render('done');
    expect(heard).toBe(2);
  });
});
