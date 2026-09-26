// @vitest-environment happy-dom
/**
 * The Connect tab's "Spam protection" section: the owner's switch for the human
 * check before the final submit, and its two modes. What it pins is the editor
 * half of "combinations that must not exist": the switch cannot be turned on
 * where the deployment cannot run the check, a saved switch there says it is
 * not active, and the mode only exists while the switch is on.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';
import type { FormSpamProtection } from '@quill/types';
import { SpamProtectionSection } from './connect-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function render(
  value: FormSpamProtection | null | undefined,
  available: boolean,
  locale: 'en' | 'es' = 'en',
) {
  const onChange = vi.fn<(next: FormSpamProtection | undefined) => void>();
  const mc = getMessages(locale).admin.editor.connect;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(<SpamProtectionSection value={value} available={available} onChange={onChange} mc={mc} />),
  );
  const $ = <T extends Element>(sel: string) => host!.querySelector<T>(sel);
  return { onChange, mc, $, text: () => host!.textContent ?? '' };
}

describe('SpamProtectionSection', () => {
  it('off by default: the switch and what it does, no mode, nothing staged', async () => {
    const { $, mc, text } = await render(undefined, true);
    const toggle = $<HTMLButtonElement>('[data-testid="spam-toggle"]')!;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.disabled).toBe(false);
    expect(text()).toContain(mc.spamTitle);
    expect(text()).toContain(mc.spamToggle);
    expect(text()).toContain(mc.spamHelp);
    expect($('[data-testid="spam-mode-auto"]')).toBeNull();
    expect($('[data-testid="spam-draft-note"]')).toBeNull();
  });

  it('turning it on stages { captcha: true }, and off removes the key entirely', async () => {
    const off = await render(undefined, true);
    await act(async () => off.$<HTMLButtonElement>('[data-testid="spam-toggle"]')!.click());
    expect(off.onChange).toHaveBeenLastCalledWith({ captcha: true });
    await act(async () => root?.unmount());
    host?.remove();

    const on = await render({ captcha: true, strict: true }, true);
    await act(async () => on.$<HTMLButtonElement>('[data-testid="spam-toggle"]')!.click());
    // Absent, not `false`: a form switched back off keeps the legacy config shape.
    expect(on.onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('on: Automatic is the default mode, and the held partials and the draft are explained', async () => {
    const { $, mc, text } = await render({ captcha: true }, true);
    expect($<HTMLButtonElement>('[data-testid="spam-toggle"]')!.getAttribute('aria-checked')).toBe('true');
    expect($<HTMLInputElement>('[data-testid="spam-mode-auto"]')!.checked).toBe(true);
    expect($<HTMLInputElement>('[data-testid="spam-mode-strict"]')!.checked).toBe(false);
    expect(text()).toContain(mc.spamModeAuto);
    expect(text()).toContain(mc.spamModeStrict);
    expect(text()).toContain(mc.spamModeStrictHelp);
    expect($('[data-testid="spam-partial-note"]')!.textContent).toBe(mc.spamPartialNote);
    expect($('[data-testid="spam-draft-note"]')!.textContent).toContain(mc.spamDraftNote);
    // The two modes are one group with a name a screen reader announces.
    const group = $('fieldset')!;
    expect(group.querySelector('legend')!.textContent).toBe(mc.spamModeGroup);
  });

  it('picking a mode stages it; Automatic drops `strict` rather than storing false', async () => {
    const { $, onChange } = await render({ captcha: true }, true);
    await act(async () => $<HTMLInputElement>('[data-testid="spam-mode-strict"]')!.click());
    expect(onChange).toHaveBeenLastCalledWith({ captcha: true, strict: true });
    await act(async () => root?.unmount());
    host?.remove();

    const strict = await render({ captcha: true, strict: true }, true);
    expect(strict.$<HTMLInputElement>('[data-testid="spam-mode-strict"]')!.checked).toBe(true);
    await act(async () => strict.$<HTMLInputElement>('[data-testid="spam-mode-auto"]')!.click());
    expect(strict.onChange).toHaveBeenLastCalledWith({ captcha: true });
  });

  it('strict saved without the switch is off, and shows no mode', async () => {
    const { $ } = await render({ strict: true }, true);
    expect($<HTMLButtonElement>('[data-testid="spam-toggle"]')!.getAttribute('aria-checked')).toBe('false');
    expect($('[data-testid="spam-mode-strict"]')).toBeNull();
  });

  it('on a deployment without keys the switch is disabled, with the reason beside it', async () => {
    const { $, mc } = await render(undefined, false);
    expect($<HTMLButtonElement>('[data-testid="spam-toggle"]')!.disabled).toBe(true);
    expect($('[data-testid="spam-unavailable"]')!.textContent).toBe(mc.spamUnavailable);
  });

  it('a switch saved on where it cannot run says it is not active here, and can still be turned off', async () => {
    const { $, mc, onChange } = await render({ captcha: true }, false, 'es');
    expect($('[data-testid="spam-unavailable"]')!.textContent).toBe(mc.spamInactiveHere);
    const toggle = $<HTMLButtonElement>('[data-testid="spam-toggle"]')!;
    expect(toggle.disabled).toBe(false);
    // Nothing is held on this deployment, so there is no partial note to make.
    expect($('[data-testid="spam-partial-note"]')).toBeNull();
    expect($<HTMLInputElement>('[data-testid="spam-mode-auto"]')!.disabled).toBe(true);
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
