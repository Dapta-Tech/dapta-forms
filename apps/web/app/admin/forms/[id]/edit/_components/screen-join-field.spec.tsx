// @vitest-environment happy-dom
/**
 * The settings panel's "Show on the same screen as the question above" (#200).
 * Below lg it is the only way to group questions, so a boundary that cannot be
 * joined must stay reachable by keyboard and say why, never drop out of the
 * Tab order the way a natively disabled switch does.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBuilderMessages } from './builder-messages';
import { ScreenJoinField } from './screen-join-field';
import type { ScreenBoundary } from './screen-util';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getBuilderMessages('en');
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function renderField(boundary: ScreenBoundary) {
  const onJoin = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ScreenJoinField boundary={boundary} onJoin={onJoin} m={m} />));
  const button = host.querySelector<HTMLButtonElement>('[data-testid="behavior-screen-join"]')!;
  return { onJoin, button };
}

describe('ScreenJoinField', () => {
  it('joins an open boundary, and splits a joined one', async () => {
    const open = await renderField({ joined: false, blocked: null });
    expect(open.button.getAttribute('aria-checked')).toBe('false');
    expect(open.button.hasAttribute('aria-disabled')).toBe(false);
    await act(async () => open.button.click());
    expect(open.onJoin).toHaveBeenCalledWith(true);
    await act(async () => root?.unmount());
    host?.remove();

    const joined = await renderField({ joined: true, blocked: null });
    expect(joined.button.getAttribute('aria-checked')).toBe('true');
    await act(async () => joined.button.click());
    expect(joined.onJoin).toHaveBeenCalledWith(false);
  });

  it('a blocked boundary stays focusable, is announced as unavailable with its reason, and a click does nothing', async () => {
    const { onJoin, button } = await renderField({ joined: false, blocked: 'solo' });
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(reason!.textContent).toBe(m.screens.soloType);
    await act(async () => button.click());
    expect(onJoin).not.toHaveBeenCalled();
  });

  it('names the cap in its reason', async () => {
    const { button } = await renderField({ joined: false, blocked: 'max' });
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
      m.screens.max.replace('{max}', '10'),
    );
  });
});
