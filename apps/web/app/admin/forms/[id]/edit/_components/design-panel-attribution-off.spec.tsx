// @vitest-environment happy-dom
/**
 * The Design tab's badge control with the workspace switch built in:
 * Small | Medium | Off. Off is the SAME workspace setting as Brand kit (it
 * hides the attribution on every form, page and email at once); the sizes are
 * this form's. Who may pick Off, what a size click does while it is hidden,
 * and what a refusal looks like.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormConfig } from '@quill/engine';
import { getMessages } from '@quill/shared';
import type { AttributionStatus } from '@/lib/admin-api';

vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    Hanken_Grotesk: font,
    JetBrains_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});
vi.mock('./preview-frame', () => ({ PreviewFrame: () => null }));
const save = vi.hoisted(() => vi.fn());
vi.mock('@/app/admin/account/brand-kit/actions', () => ({ saveAttributionAction: save }));

import { DesignPanel } from './design-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages('en').admin.editor;
const d = m.design;
const a = getMessages('en').admin.attributionSetting;

const ON: AttributionStatus = { hideAttribution: false, canHide: true, showing: true, verdictSeen: true };
const OFF: AttributionStatus = { hideAttribution: true, canHide: true, showing: false, verdictSeen: true };
const FREE: AttributionStatus = { hideAttribution: false, canHide: false, showing: true, verdictSeen: true };
const LAPSED: AttributionStatus = { hideAttribution: true, canHide: false, showing: true, verdictSeen: true };

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let statusSeen: AttributionStatus[] = [];

beforeEach(() => {
  save.mockReset();
  statusSeen = [];
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function Harness({
  initial,
  canEdit,
  daptaAiUrl,
  onBrandingChange,
}: {
  initial: AttributionStatus;
  canEdit: boolean;
  daptaAiUrl: string | null;
  onBrandingChange: (p: unknown) => void;
}) {
  // FormEditor holds this state; the panel reports changes up.
  const [status, setStatus] = useState(initial);
  const config = {
    version: 1,
    layout: 'slides',
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    branding: { badgeSize: 'md' },
  } as unknown as FormConfig;
  return (
    <DesignPanel
      config={config}
      name="Clinic contact"
      publicPath="/acme/f/contact"
      locale="en"
      layout="slides"
      onTitleChange={() => {}}
      onLanguageChange={() => {}}
      onLabelsChange={() => {}}
      onLayoutChange={() => {}}
      hasReveal={false}
      onEndRevealChange={() => {}}
      onCoverChange={() => {}}
      onBrandingChange={onBrandingChange}
      showAttribution={status.showing}
      attribution={{
        status,
        canEdit,
        daptaAiUrl,
        onChange: (next) => {
          statusSeen.push(next);
          setStatus(next);
        },
      }}
      m={m}
    />
  );
}

async function mount(initial: AttributionStatus, opts: { canEdit?: boolean; daptaAiUrl?: string | null } = {}) {
  const onBrandingChange = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <Harness
        initial={initial}
        canEdit={opts.canEdit ?? true}
        daptaAiUrl={opts.daptaAiUrl === undefined ? 'https://dapta.ai' : opts.daptaAiUrl}
        onBrandingChange={onBrandingChange}
      />,
    ),
  );
  return { onBrandingChange };
}

const group = () => host!.querySelector<HTMLElement>('[data-testid="design-badge-size"]')!;
const option = (label: string) =>
  [...group().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === label)!;
const checked = () => group().querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.textContent;
const click = (label: string) => act(async () => option(label).click());

describe('Design: Small | Medium | Off', () => {
  it('a paying owner sees three options, the size selected and the usual hint', async () => {
    await mount(ON);
    expect([...group().querySelectorAll('[role="radio"]')].map((b) => b.textContent)).toEqual([
      d.sizeSm,
      d.sizeMd,
      d.badgeOff,
    ]);
    expect(checked()).toBe(d.sizeMd);
    expect(option(d.badgeOff).getAttribute('aria-disabled')).toBeNull();
    expect(group().textContent).toContain(d.badgeSizeHint);
    expect(host!.querySelector('[data-testid="design-badge-subscribers-only"]')).toBeNull();
  });

  it('Off saves the workspace setting, selects Off and says it reaches every form', async () => {
    save.mockResolvedValue({ ok: true, value: OFF });
    await mount(ON);
    await click(d.badgeOff);
    expect(save).toHaveBeenCalledWith(true);
    expect(statusSeen.at(-1)).toEqual(OFF);
    expect(checked()).toBe(d.badgeOff);
    expect(group().textContent).toContain(d.badgeOffHint);
  });

  it('a size while it is off turns the attribution back on, then sets this form size', async () => {
    save.mockResolvedValue({ ok: true, value: ON });
    const { onBrandingChange } = await mount(OFF);
    expect(checked()).toBe(d.badgeOff);
    await click(d.sizeSm);
    expect(save).toHaveBeenCalledWith(false);
    expect(onBrandingChange).toHaveBeenCalledWith({ badgeSize: 'sm' });
    // The harness does not apply the branding patch, so the stored size (md)
    // is what shows; what matters is that Off is no longer selected.
    expect(checked()).toBe(d.sizeMd);
  });

  it('a size while it shows is only this form size: no workspace write', async () => {
    const { onBrandingChange } = await mount(ON);
    await click(d.sizeSm);
    expect(save).not.toHaveBeenCalled();
    expect(onBrandingChange).toHaveBeenCalledWith({ badgeSize: 'sm' });
  });

  it('not paying: Off cannot be chosen, with the subscribers text on hover and as a linked note', async () => {
    await mount(FREE);
    const off = option(d.badgeOff);
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(off.title).toBe('Only for Dapta AI subscribers.');
    await click(d.badgeOff);
    expect(save).not.toHaveBeenCalled();
    expect(checked()).toBe(d.sizeMd);
    const note = host!.querySelector('[data-testid="design-badge-subscribers-only"]')!;
    expect(note.textContent).toBe('Only for Dapta AI subscribers.');
    const link = note.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://dapta.ai');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('not paying, no Dapta AI URL configured: the note is plain text', async () => {
    await mount(FREE, { daptaAiUrl: null });
    const note = host!.querySelector('[data-testid="design-badge-subscribers-only"]')!;
    expect(note.textContent).toBe('Only for Dapta AI subscribers.');
    expect(note.querySelector('a')).toBeNull();
  });

  it('lapsed: the attribution shows again, so the size is selected, with both notes', async () => {
    save.mockResolvedValue({ ok: true, value: FREE });
    const { onBrandingChange } = await mount(LAPSED);
    expect(checked()).toBe(d.sizeMd);
    expect(host!.querySelector('[data-testid="design-badge-lapsed"]')!.textContent).toBe(a.lapsed);
    expect(host!.querySelector('[data-testid="design-badge-subscribers-only"]')).not.toBeNull();
    expect(option(d.badgeOff).getAttribute('aria-disabled')).toBe('true');
    // A size click shows it for good: the stored "hidden" is cleared.
    await click(d.sizeSm);
    expect(save).toHaveBeenCalledWith(false);
    expect(onBrandingChange).toHaveBeenCalledWith({ badgeSize: 'sm' });
  });

  it('a member: sizes work while it shows, Off is the admins call', async () => {
    const { onBrandingChange } = await mount(ON, { canEdit: false });
    const off = option(d.badgeOff);
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(off.title).toBe(a.readOnly);
    expect(host!.querySelector('[data-testid="design-badge-read-only"]')!.textContent).toBe(a.readOnly);
    await click(d.sizeSm);
    expect(onBrandingChange).toHaveBeenCalledWith({ badgeSize: 'sm' });
    expect(save).not.toHaveBeenCalled();
  });

  it('a member while it is off: cannot turn it back on either', async () => {
    const { onBrandingChange } = await mount(OFF, { canEdit: false });
    expect(option(d.sizeSm).getAttribute('aria-disabled')).toBe('true');
    await click(d.sizeSm);
    expect(save).not.toHaveBeenCalled();
    expect(onBrandingChange).not.toHaveBeenCalled();
  });

  it('a refusal (the subscription lapsed since load) greys Off out and says why', async () => {
    save.mockResolvedValue({ ok: false, code: 'DAPTA_SUBSCRIPTION_REQUIRED', status: FREE });
    await mount(ON);
    await click(d.badgeOff);
    expect(statusSeen.at(-1)).toEqual(FREE);
    expect(checked()).toBe(d.sizeMd);
    expect(option(d.badgeOff).getAttribute('aria-disabled')).toBe('true');
    expect(host!.querySelector('[data-testid="design-badge-error"]')!.textContent).toBe(a.notSubscribed);
  });

  it('any other failure keeps the state and shows the generic message', async () => {
    save.mockResolvedValue({ ok: false, error: 'boom' });
    await mount(ON);
    await click(d.badgeOff);
    expect(statusSeen).toHaveLength(0);
    expect(checked()).toBe(d.sizeMd);
    expect(host!.querySelector('[data-testid="design-badge-error"]')!.textContent).toBe(a.saveFailed);
  });

  it('speaks Spanish', () => {
    const es = getMessages('es').admin.editor.design;
    expect(es.badgeOff).toBe('Oculto');
    expect(es.badgeOffHint).toContain('todos los formularios');
  });
});
