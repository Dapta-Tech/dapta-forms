// @vitest-environment happy-dom
/**
 * Brand kit, "Show “Made with dForms” on my forms and pages": the three
 * states a workspace can be in (on, off while paying, off but lapsed), the
 * workspace that does not pay (disabled, with the subscribers note as tooltip
 * and as text, linked when the deployment names the landing), and a member's
 * read-only view, in English and Spanish. Clicking stores the choice through
 * the server action.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';
import type { AttributionStatus } from '@/lib/admin-api';

const actions = vi.hoisted(() => ({ saveAttributionAction: vi.fn() }));
vi.mock('./actions', () => actions);

import { AttributionSetting, attributionMode } from './attribution-setting';

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

const LANDING = 'https://platform.example.test/';

async function mount(
  initial: AttributionStatus,
  opts: { canEdit?: boolean; locale?: 'en' | 'es'; daptaAiUrl?: string | null } = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <AttributionSetting
        initial={initial}
        canEdit={opts.canEdit ?? true}
        daptaAiUrl={opts.daptaAiUrl === undefined ? LANDING : opts.daptaAiUrl}
        m={getMessages(opts.locale ?? 'en').admin.attributionSetting}
      />,
    ),
  );
  const el = container;
  return {
    el,
    sw: () => el.querySelector<HTMLButtonElement>('[data-testid="attribution-switch"]')!,
    row: () => el.querySelector<HTMLElement>('[data-testid="attribution-switch-row"]')!,
    q: (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`),
  };
}

const ON: AttributionStatus = { hideAttribution: false, canHide: true, showing: true };
const OFF: AttributionStatus = { hideAttribution: true, canHide: true, showing: false };
const LAPSED: AttributionStatus = { hideAttribution: true, canHide: false, showing: true };
const NOT_PAID: AttributionStatus = { hideAttribution: false, canHide: false, showing: true };

const en = getMessages('en').admin.attributionSetting;
const es = getMessages('es').admin.attributionSetting;

describe('attributionMode', () => {
  it('names the three states', () => {
    expect(attributionMode(ON)).toBe('on');
    expect(attributionMode(NOT_PAID)).toBe('on');
    expect(attributionMode(OFF)).toBe('off');
    expect(attributionMode(LAPSED)).toBe('lapsed');
  });
});

describe('AttributionSetting', () => {
  it('reads the title and the switch label', async () => {
    const { el, sw } = await mount(ON);
    expect(el.textContent).toContain('dForms attribution');
    expect(sw().getAttribute('aria-label')).toBe('Show “Made with dForms” on my forms and pages');
  });

  it('on, for a paying owner: the switch is on and usable, no note', async () => {
    const { sw, q, row } = await mount(ON);
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(sw().disabled).toBe(false);
    expect(q('attribution-subscribers-only')).toBeNull();
    expect(q('attribution-lapsed')).toBeNull();
    expect(row().getAttribute('title')).toBeNull();
  });

  it('off while paying: the switch is off and usable', async () => {
    const { sw, q } = await mount(OFF);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(sw().disabled).toBe(false);
    expect(q('attribution-lapsed')).toBeNull();
  });

  it('lapsed: the stored choice, the sentence, and who can hide it (note, link, tooltip); turning it back on stays possible', async () => {
    const { sw, q, row } = await mount(LAPSED);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(sw().disabled).toBe(false);
    const lapsed = q('attribution-lapsed')!;
    expect(lapsed.textContent).toBe(
      'Your Dapta AI subscription ended, so the attribution is showing again. Your choice is saved.',
    );
    const note = q('attribution-subscribers-only')!;
    expect(note.textContent).toBe('Only for Dapta AI subscribers.');
    expect(note.querySelector('a')!.getAttribute('href')).toBe(LANDING);
    expect(row().getAttribute('title')).toBe('Only for Dapta AI subscribers.');
    // The sentence first, then the note; the switch is described by both.
    expect(lapsed.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sw().getAttribute('aria-describedby')).toBe(`${lapsed.id} ${note.id}`);
  });

  it('lapsed, with no landing configured: the note is plain text', async () => {
    const { q } = await mount(LAPSED, { daptaAiUrl: null });
    expect(q('attribution-subscribers-only')!.querySelector('a')).toBeNull();
    expect(q('attribution-lapsed')).not.toBeNull();
  });

  it('off while paying carries neither note nor tooltip', async () => {
    const { q, row } = await mount(OFF);
    expect(q('attribution-subscribers-only')).toBeNull();
    expect(row().getAttribute('title')).toBeNull();
  });

  it('not paid: disabled, muted, with the note as tooltip and as text, "Dapta AI" linked to the landing', async () => {
    const { sw, q, row } = await mount(NOT_PAID);
    expect(sw().disabled).toBe(true);
    expect(row().getAttribute('title')).toBe('Only for Dapta AI subscribers.');
    expect(row().querySelector('span.text-muted-foreground')!.textContent).toBe(en.switchLabel);
    const note = q('attribution-subscribers-only')!;
    expect(note.textContent).toBe('Only for Dapta AI subscribers.');
    const link = note.querySelector<HTMLAnchorElement>('a')!;
    expect(link.textContent).toBe('Dapta AI');
    expect(link.getAttribute('href')).toBe(LANDING);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(sw().getAttribute('aria-describedby')).toBe(note.id);
  });

  it('not paid, with no landing configured: the note is plain text', async () => {
    const { q, row } = await mount(NOT_PAID, { daptaAiUrl: null });
    const note = q('attribution-subscribers-only')!;
    expect(note.querySelector('a')).toBeNull();
    expect(note.textContent).toBe('Only for Dapta AI subscribers.');
    expect(row().getAttribute('title')).toBe('Only for Dapta AI subscribers.');
  });

  it('a member reads it and cannot change it, in every state', async () => {
    for (const state of [ON, OFF, LAPSED, NOT_PAID]) {
      const { sw, q } = await mount(state, { canEdit: false });
      expect(sw().disabled).toBe(true);
      expect(q('attribution-read-only')!.textContent).toBe(en.readOnly);
      await act(async () => root?.unmount());
      container?.remove();
    }
  });

  it('speaks Spanish, with the quotes the catalog uses', async () => {
    const { el, sw, q } = await mount(NOT_PAID, { locale: 'es' });
    expect(el.textContent).toContain('Atribución de dForms');
    expect(sw().getAttribute('aria-label')).toBe('Mostrar «Hecho con dForms» en mis formularios y páginas');
    expect(q('attribution-subscribers-only')!.textContent).toBe('Solo para suscriptores de Dapta AI.');
    await act(async () => root?.unmount());
    container?.remove();
    const lapsed = await mount(LAPSED, { locale: 'es' });
    expect(lapsed.q('attribution-lapsed')!.textContent).toBe(
      'Tu suscripción de Dapta AI terminó, así que la atribución volvió a aparecer. Tu elección queda guardada.',
    );
    expect(es.readOnly).toBe('Solo un admin o el owner puede cambiar esto.');
  });

  it('turning it off stores the choice and shows the new state', async () => {
    actions.saveAttributionAction.mockResolvedValue({ ok: true, value: OFF });
    const { sw, el } = await mount(ON);
    await act(async () => sw().click());
    expect(actions.saveAttributionAction).toHaveBeenCalledWith(true);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain(en.saved);
  });

  it('lapsed: an owner turns it back on, and it then rests as not paid (disabled)', async () => {
    actions.saveAttributionAction.mockResolvedValue({ ok: true, value: NOT_PAID });
    const { sw, q } = await mount(LAPSED);
    await act(async () => sw().click());
    expect(actions.saveAttributionAction).toHaveBeenCalledWith(false);
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(sw().disabled).toBe(true);
    expect(q('attribution-subscribers-only')).not.toBeNull();
  });

  it('any other failure leaves the switch where it was, with the generic message', async () => {
    for (const result of [{ ok: false, code: 'FORBIDDEN' }, { ok: false }, { ok: false, transport: true, message: 'x' }]) {
      actions.saveAttributionAction.mockResolvedValue(result);
      const { sw, el, q } = await mount(ON);
      await act(async () => sw().click());
      expect(sw().getAttribute('aria-checked')).toBe('true');
      expect(sw().disabled).toBe(false);
      expect(q('attribution-save-error')!.textContent).toBe(en.saveFailed);
      expect(el.textContent).not.toContain(en.notSubscribed);
      expect(q('attribution-subscribers-only')).toBeNull();
      await act(async () => root?.unmount());
      container?.remove();
    }
  });

  it('a 403 DAPTA_SUBSCRIPTION_REQUIRED says why and rests the row in the state the server sends', async () => {
    // The verdict lapsed between the page load and the click.
    actions.saveAttributionAction.mockResolvedValue({ ok: false, code: 'DAPTA_SUBSCRIPTION_REQUIRED', status: NOT_PAID });
    const { sw, q, row } = await mount(ON);
    await act(async () => sw().click());
    expect(actions.saveAttributionAction).toHaveBeenCalledWith(true);
    expect(q('attribution-save-error')!.textContent).toBe('Hiding the attribution is only for Dapta AI subscribers.');
    // Not paid: grey switch, tooltip, and the note with its link.
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(sw().disabled).toBe(true);
    expect(row().getAttribute('title')).toBe('Only for Dapta AI subscribers.');
    expect(q('attribution-subscribers-only')!.querySelector('a')!.getAttribute('href')).toBe(LANDING);
  });

  it('the same refusal with no server state still greys the switch out, in Spanish too', async () => {
    actions.saveAttributionAction.mockResolvedValue({ ok: false, code: 'DAPTA_SUBSCRIPTION_REQUIRED' });
    const { sw, q } = await mount(ON, { locale: 'es' });
    await act(async () => sw().click());
    expect(q('attribution-save-error')!.textContent).toBe('Ocultar la atribución es solo para suscriptores de Dapta AI.');
    expect(sw().disabled).toBe(true);
    expect(q('attribution-subscribers-only')!.textContent).toBe('Solo para suscriptores de Dapta AI.');
  });
});
