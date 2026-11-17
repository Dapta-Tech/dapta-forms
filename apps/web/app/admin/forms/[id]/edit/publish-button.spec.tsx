// @vitest-environment happy-dom
/**
 * The publish menu's "Revert to the previous published version", driven like
 * a person would.
 *
 * What it promises, each pinned below:
 *   - disabled while the form has no earlier published version, and says so;
 *   - when there is one, it shows the date that version went live, and asks
 *     first in a dialog that names that date and says the draft does not change;
 *   - a confirmed revert flushes pending edits, calls the API and hands the
 *     editor the result; a cancelled one calls nothing;
 *   - a publish lights the item up without a reload, and a 409
 *     NOTHING_TO_REVERT greys it out again;
 *   - English and Spanish.
 *
 * The server actions are mocked: the API side is pinned by the controller spec.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, t, type Locale } from '@quill/shared';

const actions = vi.hoisted(() => ({
  publishFormAction: vi.fn(),
  revertFormAction: vi.fn(),
}));
vi.mock('@/app/admin/actions', () => actions);
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), toast: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import {
  publishFormSave,
  publishIntegrationsSave,
  readCombinedSave,
} from '@/lib/integrations-save-status';
import { PublishButton } from './publish-button';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PREVIOUS_AT = Date.UTC(2026, 9, 3, 14, 30);
const LATER_AT = Date.UTC(2026, 9, 9, 9, 0);

let root: Root;
let host: HTMLDivElement;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
/**
 * Not pressable. The main half is `aria-disabled`, never natively `disabled`:
 * it has to stay focusable and hoverable so its reason can be reached.
 */
const isBlocked = (el: Element | null) => el!.getAttribute('aria-disabled') === 'true';
/** The accessible description: the text of whatever `aria-describedby` points at. */
const describedBy = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

const flush = vi.fn();
const onReverted = vi.fn();

/** The form DRAFT's save states (the builder's autosave). No `partial`: that one is the integrations'. */
type SaveStatus = 'saved' | 'saving' | 'retrying' | 'error' | 'conflict';
interface MountOpts {
  previousAt?: number | null;
  hasDraft?: boolean;
  locale?: Locale;
  /** The draft's own save state; `saved` (clean) unless a test says otherwise. */
  saveStatus?: SaveStatus;
  hasQuestions?: boolean;
  /** Successful autosaves so far: each one writes a draft. */
  saveCount?: number;
}

const element = (opts: MountOpts) => (
  <PublishButton
    formId="form-1"
    locale={opts.locale ?? 'en'}
    initialHasDraft={opts.hasDraft ?? false}
    initialPreviousPublishedAt={opts.previousAt ?? null}
    saveStatus={opts.saveStatus ?? 'saved'}
    hasQuestions={opts.hasQuestions ?? true}
    saveCount={opts.saveCount ?? 0}
    flush={flush}
    onReverted={onReverted}
  />
);

async function mount(opts: MountOpts = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(element(opts)));
}

/** The editor re-rendering the pill with new props (an edit, a save landing). */
const rerender = (opts: MountOpts) => act(async () => root.render(element(opts)));

const when = (ms: number, locale: Locale = 'en') =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);

async function openMenu() {
  await click($('[data-testid="publish-menu-button"]'));
  expect($('[data-testid="publish-menu"]')).not.toBeNull();
}

const revertItem = () => $('[data-testid="publish-menu-revert"]')!;

const reverted = (over: Record<string, unknown> = {}) => ({
  ok: true,
  updatedAt: 1_700_000_000_500,
  saved: { name: 'Lead quiz', config: { version: 1, steps: [] } },
  hasDraft: false,
  previousPublishedAt: LATER_AT,
  ...over,
});

const m = getMessages('en').admin.publish;

beforeEach(() => {
  // No layout here: a menu whose anchor measures 0x0 closes itself (the
  // trigger is hidden), so the buttons get a size.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 900, y: 10, width: 32, height: 36 }),
  );
  actions.publishFormAction.mockReset();
  actions.revertFormAction.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
  flush.mockReset().mockResolvedValue({ ok: true });
  onReverted.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the publish menu', () => {
  it('sits beside Publish and opens even with nothing to publish', async () => {
    await mount({ hasDraft: false });
    expect(isBlocked($('[data-testid="publish-button"]'))).toBe(true);
    const trigger = $<HTMLButtonElement>('[data-testid="publish-menu-button"]')!;
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-label')).toBe(m.moreOptions);
    await openMenu();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(revertItem().textContent).toContain(m.revert);
  });
});

/**
 * The pill reads as ONE control in every state. The product owner saw a pale,
 * washed-out Publish beside a solid chevron, with a notch at the seam: each half
 * painted its own fill and rim, the main half alone took `opacity-50` whenever it
 * was disabled (including while publishing), and the chevron added a border on
 * top of both rims. What is pinned here is structural, so it holds in either
 * theme: the fill lives on the wrapper only, the halves share their classes, no
 * opacity anywhere, one divider.
 */
describe('the Publish pill', () => {
  const control = () => $('[data-testid="publish-control"]')!;
  const main = () => $<HTMLButtonElement>('[data-testid="publish-button"]')!;
  const chevron = () => $<HTMLButtonElement>('[data-testid="publish-menu-button"]')!;
  const classes = (el: Element) => el.className.split(/\s+/).filter(Boolean);
  /** The label a person sees (and hears) on the main half. */
  const label = () => main().querySelector('[data-current]')!.textContent;
  /** Classes that would make one half look unlike the other, or washed out. */
  const forbidden = (el: Element) =>
    classes(el).filter(
      (c) =>
        /^(bg-signal|bg-card|bg-muted|rounded-full)$/.test(c) ||
        /(^|:)(opacity-|border|ring-|brightness|scale-)/.test(c),
    );

  function expectOnePill() {
    expect(control().contains(main())).toBe(true);
    expect(control().contains(chevron())).toBe(true);
    // The halves never paint a fill, a border, a ring or an opacity of their own.
    expect(forbidden(main())).toEqual([]);
    expect(forbidden(chevron())).toEqual([]);
    expect(control().querySelectorAll('[class*="opacity-50"]')).toHaveLength(0);
    // Matching outer radius: the wrapper is the pill, each half rounds its outer side.
    expect(classes(control())).toContain('rounded-full');
    expect(classes(main())).toContain('rounded-l-full');
    expect(classes(chevron())).toContain('rounded-r-full');
    // Same height for both halves: they stretch to the wrapper, which sets it.
    expect(classes(control())).toEqual(expect.arrayContaining(['h-9', 'items-stretch']));
    // Shared base classes, including the focus treatment: the outside outline
    // is suppressed and BOTH halves draw the same fully rounded capsule inside
    // themselves, so neither ring is square at the divider.
    const shared = classes(main()).filter((c) => classes(chevron()).includes(c));
    expect(shared).toEqual(
      expect.arrayContaining([
        'text-inherit',
        'focus-visible:!outline-hidden',
        'after:absolute',
        'after:inset-[3px]',
        'after:rounded-full',
        'focus-visible:after:shadow-[inset_0_0_0_2px_currentColor]',
      ]),
    );
    for (const half of [main(), chevron()]) {
      expect(classes(half).filter((c) => /^focus-visible:(?!after:|!outline-hidden$)/.test(c))).toEqual([]);
    }
    // Every label is always laid out in one grid cell, so the main half is as
    // wide as its widest label in every state and the pill never resizes.
    const stacked = [...main().querySelectorAll('[data-label]')];
    expect(stacked.map((el) => (el as HTMLElement).dataset.label)).toEqual([
      'publish',
      'published',
      'saving',
      'publishing',
      'reverting',
    ]);
    for (const el of stacked) expect(classes(el)).toEqual(expect.arrayContaining(['col-start-1', 'row-start-1']));
    const visible = stacked.filter((el) => !classes(el).includes('invisible'));
    expect(visible).toHaveLength(1);
    expect(visible[0]!.getAttribute('aria-hidden')).toBeNull();
    for (const el of stacked) if (el !== visible[0]) expect(el.getAttribute('aria-hidden')).toBe('true');
    // One divider between them, nothing else.
    expect(main().nextElementSibling).toBe($('[data-testid="publish-divider"]'));
    expect($('[data-testid="publish-divider"]')!.nextElementSibling).toBe(chevron());
  }

  it('is solid Signal Green with changes to publish, with no disabled styling', async () => {
    await mount({ hasDraft: true });
    expect(control().dataset.state).toBe('pending');
    expect(classes(control())).toEqual(
      expect.arrayContaining(['bg-signal', 'text-signal-foreground']),
    );
    expect(isBlocked(main())).toBe(false);
    expect(main().className).not.toMatch(/cursor-not-allowed/);
    expect(label()).toBe(m.publish);
    expectOnePill();
  });

  it('says Published with a check on a solid surface, not a pale button, with nothing to publish', async () => {
    await mount({ hasDraft: false });
    expect(control().dataset.state).toBe('idle');
    // A solid card with the full-strength text colour and a green rim: never
    // the muted grey, never an opacity.
    expect(classes(control())).toEqual(
      expect.arrayContaining(['bg-card', 'text-foreground', 'shadow-[inset_0_0_0_1px_var(--signal-edge)]']),
    );
    expect(classes(control())).not.toEqual(expect.arrayContaining(['bg-signal']));
    expect(classes(control()).some((c) => /muted/.test(c))).toBe(false);
    expect(label()).toBe(getMessages('en').admin.forms.statusLive);
    expect($('[data-current] .pi-check')).not.toBeNull();
    expect(isBlocked(main())).toBe(true);
    expect(describedBy(main())).toBe(m.noChanges);
    // The menu half stays usable: revert is useful exactly now.
    expect(chevron().disabled).toBe(false);
    expectOnePill();
  });

  it('stays solid while publishing, says so, and marks itself busy', async () => {
    let finish!: (v: unknown) => void;
    actions.publishFormAction.mockReturnValue(new Promise((r) => (finish = r)));
    await mount({ hasDraft: true });
    await click(main());
    expect(control().dataset.state).toBe('busy');
    expect(classes(control())).toContain('bg-signal');
    expect(isBlocked(main())).toBe(true);
    expect(main().getAttribute('aria-busy')).toBe('true');
    expect(label()).toBe(m.publishing);
    expect($('[data-current] .pi-spin')).not.toBeNull();
    expectOnePill();
    await act(async () =>
      finish({
        ok: true,
        updatedAt: 1_700_000_000_100,
        saved: { name: 'Lead quiz', config: { version: 1, steps: [] } },
        previousPublishedAt: PREVIOUS_AT,
      }),
    );
    expect(control().dataset.state).toBe('idle');
    expectOnePill();
  });

  it('says Publicado in Spanish', async () => {
    await mount({ hasDraft: false, locale: 'es' });
    expect(label()).toBe('Publicado');
  });

  it('marks the menu half as pressed while the menu is open', async () => {
    await mount({ hasDraft: true });
    await openMenu();
    expect(chevron().getAttribute('aria-expanded')).toBe('true');
    expect(classes(chevron()).some((c) => c.startsWith('aria-expanded:bg-'))).toBe(true);
    expectOnePill();
  });
});

/**
 * What the main half is CALLED, state by state, and what it says about why it
 * cannot be pressed. Eight e2e specs located this button by the name
 * "Publish"; when the idle label became "Published" they found nothing, and
 * one of them was missed for a release. Pinned here by the accessible name and
 * description, so a renamed label fails a unit test before it reaches a
 * locator, the pill can never again claim "Published" over edits the server
 * does not hold, and a blocked Publish is never silent about its cause.
 */
describe('the accessible name and description of Publish, by state', () => {
  const main = () => $<HTMLButtonElement>('[data-testid="publish-button"]')!;
  const state = () => $('[data-testid="publish-control"]')!.dataset.state;
  /**
   * The name a browser computes for a button with no `aria-label`: its text,
   * minus every subtree hidden from the accessibility tree. (The real thing is
   * asserted with `getByRole` against Chromium and WebKit in QA; this is the
   * same rule, small enough to run on every push.)
   */
  function accessibleName(el: Element): string {
    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return '';
      return [...node.childNodes].map(walk).join('');
    };
    return (el.getAttribute('aria-label') ?? walk(el)).replace(/\s+/g, ' ').trim();
  }

  const en = getMessages('en');
  const es = getMessages('es');
  const PUBLISH = en.admin.publish.publish;
  const PUBLISHED = en.admin.forms.statusLive;
  const SAVING = en.admin.publish.saving;

  it('keeps the words apart, in both languages', () => {
    // If these ever collapse into one word the states stop being tellable apart.
    expect(PUBLISH).toBe('Publish');
    expect(PUBLISHED).toBe('Published');
    expect(SAVING).toBe('Saving…');
    expect(es.admin.publish.publish).toBe('Publicar');
    expect(es.admin.forms.statusLive).toBe('Publicado');
    expect(es.admin.publish.saving).toBe('Guardando…');
  });

  interface Case {
    name: string;
    opts: MountOpts;
    expected: string;
    blocked: boolean;
    state: string;
    /** The accessible description; '' = none (the button can be pressed). */
    reason: string;
  }
  const cases: Case[] = [
    {
      // Its config is live from creation (the link serves it), with or without
      // a first press of Publish. `previousAt: null` = no earlier version.
      name: 'never published through the draft flow, clean, with questions',
      opts: { hasDraft: false, previousAt: null },
      expected: PUBLISHED,
      blocked: true,
      state: 'idle',
      reason: m.noChanges,
    },
    {
      name: 'never published and with no questions yet',
      opts: { hasDraft: false, previousAt: null, hasQuestions: false },
      expected: PUBLISH,
      blocked: true,
      state: 'empty',
      reason: m.blockedEmpty,
    },
    {
      name: 'published and clean',
      opts: { hasDraft: false, previousAt: PREVIOUS_AT },
      expected: PUBLISHED,
      blocked: true,
      state: 'idle',
      reason: m.noChanges,
    },
    {
      // `saving` is what the autosave reports from the first keystroke on (the
      // debounce counts as saving), so this is "dirty" too.
      name: 'dirty or saving: an edit the server does not hold yet',
      opts: { hasDraft: false, previousAt: PREVIOUS_AT, saveStatus: 'saving' },
      expected: SAVING,
      blocked: true,
      state: 'saving',
      reason: m.blockedSaving,
    },
    {
      name: 'retrying a save (the API is down)',
      opts: { hasDraft: false, previousAt: PREVIOUS_AT, saveStatus: 'retrying' },
      expected: PUBLISH,
      blocked: true,
      state: 'unsaved',
      reason: m.blockedRetrying,
    },
    {
      name: 'save failed',
      opts: { hasDraft: false, previousAt: PREVIOUS_AT, saveStatus: 'error' },
      expected: PUBLISH,
      blocked: true,
      state: 'unsaved',
      reason: m.blockedSaveFailed,
    },
    {
      name: 'save stopped on a conflict',
      opts: { hasDraft: false, previousAt: PREVIOUS_AT, saveStatus: 'conflict' },
      expected: PUBLISH,
      blocked: true,
      state: 'unsaved',
      reason: m.blockedConflict,
    },
    {
      name: 'a draft is pending',
      opts: { hasDraft: true, previousAt: PREVIOUS_AT },
      expected: PUBLISH,
      blocked: false,
      state: 'pending',
      reason: '',
    },
    {
      // Pressing it flushes the save first, so it does not wait for one.
      name: 'a draft is pending and a newer edit is still saving',
      opts: { hasDraft: true, previousAt: PREVIOUS_AT, saveStatus: 'saving' },
      expected: PUBLISH,
      blocked: false,
      state: 'pending',
      reason: '',
    },
    {
      name: 'a draft is pending and the last save failed',
      opts: { hasDraft: true, previousAt: PREVIOUS_AT, saveStatus: 'error' },
      expected: PUBLISH,
      blocked: false,
      state: 'pending',
      reason: '',
    },
  ];

  for (const c of cases) {
    it(`${c.name}: "${c.expected}", ${c.blocked ? 'blocked' : 'pressable'}`, async () => {
      await mount(c.opts);
      expect(accessibleName(main())).toBe(c.expected);
      expect(isBlocked(main())).toBe(c.blocked);
      expect(state()).toBe(c.state);
      expect(describedBy(main())).toBe(c.reason);
      // Never natively disabled: that would take it out of the tab order and
      // put its reason out of a keyboard's reach.
      expect(main().disabled).toBe(false);
      expect(main().hasAttribute('disabled')).toBe(false);
      // No native `title` beside the tooltip (two bubbles saying the same thing).
      expect(main().hasAttribute('title')).toBe(false);
    });
  }

  it('gives every blocked state a reason of its own, in English and Spanish', () => {
    for (const cat of [en.admin.publish, es.admin.publish]) {
      const reasons = [
        cat.noChanges,
        cat.blockedSaving,
        cat.blockedRetrying,
        cat.blockedSaveFailed,
        cat.blockedConflict,
        cat.blockedEmpty,
      ];
      for (const r of reasons) expect(r.trim().length).toBeGreaterThan(10);
      expect(new Set(reasons).size).toBe(reasons.length);
    }
    expect(es.admin.publish.blockedSaving).not.toBe(en.admin.publish.blockedSaving);
  });

  it('never reads "Published" unless the draft save is clean, whatever else is true', async () => {
    for (const saveStatus of ['saving', 'retrying', 'error', 'conflict'] as const) {
      for (const hasDraft of [false, true]) {
        for (const hasQuestions of [false, true]) {
          await mount({ saveStatus, hasDraft, hasQuestions, previousAt: PREVIOUS_AT });
          const name = accessibleName(main());
          expect(name, `${saveStatus} draft=${hasDraft} questions=${hasQuestions}`).not.toBe(PUBLISHED);
          expect([PUBLISH, SAVING]).toContain(name);
          expect(document.querySelector('[data-current] .pi-check')).toBeNull();
          await act(async () => root.unmount());
          host.remove();
        }
      }
    }
    await mount();
  });

  it('while publishing: "Publishing…", blocked, busy, with no reason to give', async () => {
    actions.publishFormAction.mockReturnValue(new Promise(() => {}));
    await mount({ hasDraft: true });
    await click(main());
    expect(accessibleName(main())).toBe(m.publishing);
    expect(isBlocked(main())).toBe(true);
    expect(main().getAttribute('aria-busy')).toBe('true');
    expect(describedBy(main())).toBe('');
    expect(state()).toBe('busy');
  });

  it('while reverting: "Reverting…", blocked', async () => {
    actions.revertFormAction.mockReturnValue(new Promise(() => {}));
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    await click(revertItem());
    await click($('[data-testid="confirm-dialog-confirm"]'));
    expect(accessibleName(main())).toBe(m.reverting);
    expect(isBlocked(main())).toBe(true);
    expect(state()).toBe('busy');
  });

  it('follows an edit: Published, Saving… with a spinner at the first keystroke, Publish when the save lands', async () => {
    await mount({ previousAt: PREVIOUS_AT });
    expect(accessibleName(main())).toBe(PUBLISHED);

    await rerender({ previousAt: PREVIOUS_AT, saveStatus: 'saving' });
    expect(accessibleName(main())).toBe(SAVING);
    expect(isBlocked(main())).toBe(true);
    // The transient state is the only blocked one that LOOKS not pressable.
    expect($('[data-current] .pi-spinner.pi-spin')).not.toBeNull();

    // The API is down: retrying, then failed. Not "Published", and no spinner:
    // how the standing blocked states look is the product owner's call.
    await rerender({ previousAt: PREVIOUS_AT, saveStatus: 'retrying' });
    expect(accessibleName(main())).toBe(PUBLISH);
    expect($('[data-current] .pi-spin')).toBeNull();
    expect(describedBy(main())).toBe(m.blockedRetrying);
    await rerender({ previousAt: PREVIOUS_AT, saveStatus: 'error' });
    expect(accessibleName(main())).toBe(PUBLISH);
    expect(isBlocked(main())).toBe(true);
    expect(describedBy(main())).toBe(m.blockedSaveFailed);

    // The save lands: a draft is pending.
    await rerender({ previousAt: PREVIOUS_AT, saveStatus: 'saved', saveCount: 1 });
    expect(accessibleName(main())).toBe(PUBLISH);
    expect(isBlocked(main())).toBe(false);
    expect(describedBy(main())).toBe('');
    expect(state()).toBe('pending');
  });

  it('keeps the width reserved in the saving, unsaved and empty states too', async () => {
    for (const opts of [{ saveStatus: 'saving' as const }, { saveStatus: 'error' as const }, { hasQuestions: false }]) {
      await mount(opts);
      const stacked = [...main().querySelectorAll('[data-label]')].map((el) => (el as HTMLElement).dataset.label);
      expect(stacked).toEqual(['publish', 'published', 'saving', 'publishing', 'reverting']);
      // They wear the pending look: solid green, never the Published surface.
      expect($('[data-testid="publish-control"]')!.className).toMatch(/\bbg-signal\b/);
      await act(async () => root.unmount());
      host.remove();
    }
    await mount();
  });

  it('speaks Spanish: Publicado, Guardando…, Publicar, Publicando…, with Spanish reasons', async () => {
    const pm = es.admin.publish;
    await mount({ locale: 'es', previousAt: PREVIOUS_AT });
    expect(accessibleName(main())).toBe('Publicado');
    expect(describedBy(main())).toBe(pm.noChanges);
    await rerender({ locale: 'es', previousAt: PREVIOUS_AT, saveStatus: 'saving' });
    expect(accessibleName(main())).toBe('Guardando…');
    expect(describedBy(main())).toBe(pm.blockedSaving);
    await rerender({ locale: 'es', previousAt: PREVIOUS_AT, saveStatus: 'conflict' });
    expect(accessibleName(main())).toBe('Publicar');
    expect(describedBy(main())).toBe(pm.blockedConflict);
    await rerender({ locale: 'es', previousAt: PREVIOUS_AT, hasQuestions: false });
    expect(describedBy(main())).toBe(pm.blockedEmpty);
    await rerender({ locale: 'es', previousAt: PREVIOUS_AT, saveStatus: 'saved', saveCount: 1 });
    expect(accessibleName(main())).toBe('Publicar');
    actions.publishFormAction.mockReturnValue(new Promise(() => {}));
    await click(main());
    expect(accessibleName(main())).toBe(pm.publishing);
  });
});

/**
 * The pill follows the form DRAFT's save, not the top bar's combined state.
 * Integrations are saved straight to the live form and are never part of the
 * draft Publish publishes. Fed the combined state, a webhook switched on with
 * no URL (a standing `partial`) or a lost integrations save left the pill on a
 * blocked "Publish" right after a publish that had gone through.
 */
describe('the pill and the integrations save', () => {
  const main = () => $<HTMLButtonElement>('[data-testid="publish-button"]')!;
  const label = () => main().querySelector('[data-current]')!.textContent;
  const FORM = 'form-combined';

  for (const integrations of ['partial', 'error', 'retrying', 'saving'] as const) {
    it(`reads "Published" with a clean, published draft while the integrations are on ${integrations}`, async () => {
      const draft = { status: 'saved', detail: null } as const;
      publishFormSave(FORM, draft);
      publishIntegrationsSave(FORM, { status: integrations, detail: 'webhook has no URL', lost: integrations === 'error' });
      // The top bar goes on showing the worse of the two...
      expect(readCombinedSave(FORM).status).toBe(integrations);
      // ...and the pill, fed what the editor feeds it (the draft's own state), does not.
      await mount({ previousAt: PREVIOUS_AT, saveStatus: draft.status });
      expect(label()).toBe(getMessages('en').admin.forms.statusLive);
      expect($('[data-testid="publish-control"]')!.dataset.state).toBe('idle');
      publishIntegrationsSave(FORM, { status: 'saved', detail: null });
    });
  }

  it('does not read "Published" when it is the DRAFT save that is dirty or failed, integrations clean', async () => {
    publishIntegrationsSave(FORM, { status: 'saved', detail: null });
    for (const status of ['saving', 'retrying', 'error', 'conflict'] as const) {
      publishFormSave(FORM, { status, detail: null });
      expect(readCombinedSave(FORM).status).toBe(status);
      await mount({ previousAt: PREVIOUS_AT, saveStatus: status });
      expect(label()).not.toBe(getMessages('en').admin.forms.statusLive);
      await act(async () => root.unmount());
      host.remove();
    }
    publishFormSave(FORM, { status: 'saved', detail: null });
    await mount();
  });

  it('cannot be handed the combined state: `partial` is not a draft save state', () => {
    // If this line ever compiles, the prop was widened back to the combined
    // status and the editor can wire the wrong one without a type error.
    // @ts-expect-error `CombinedSaveState['status']` includes `partial`
    const wrong = <PublishButton formId={FORM} locale="en" saveStatus={readCombinedSave(FORM).status} />;
    expect(wrong).toBeTruthy();
  });
});

/**
 * The reason, as a tooltip. Hidden from sight (not from the tree) until the
 * main half is hovered, focused with the keyboard, or pressed while blocked.
 */
describe('the reason under a blocked Publish', () => {
  const main = () => $<HTMLButtonElement>('[data-testid="publish-button"]')!;
  const reason = () => $('[data-testid="publish-reason"]');
  const hover = (type: 'mouseover' | 'mouseout') =>
    act(async () => {
      main().dispatchEvent(new MouseEvent(type, { bubbles: true }));
    });

  it('is in the tree but visually hidden, and wired as the description', async () => {
    await mount({ hasQuestions: false });
    expect(reason()!.textContent).toBe(m.blockedEmpty);
    expect(reason()!.getAttribute('role')).toBe('tooltip');
    expect(reason()!.className).toBe('sr-only');
    expect(main().getAttribute('aria-describedby')).toBe(reason()!.id);
    // A sibling of the button, not inside it: it must not leak into the name.
    expect(main().contains(reason())).toBe(false);
  });

  it('shows on hover and hides on leave, at normal weight', async () => {
    await mount({ saveStatus: 'error' });
    await hover('mouseover');
    expect(reason()!.dataset.open).toBe('true');
    expect(reason()!.className).not.toMatch(/\bsr-only\b/);
    expect(reason()!.className).toMatch(/\bfont-normal\b/);
    await hover('mouseout');
    expect(reason()!.className).toBe('sr-only');
  });

  it('shows on a press of the blocked button, publishes nothing, and Escape puts it away', async () => {
    await mount({ saveStatus: 'conflict' });
    await click(main());
    expect(actions.publishFormAction).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(reason()!.dataset.open).toBe('true');
    expect(reason()!.textContent).toBe(m.blockedConflict);
    await act(async () => {
      main().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(reason()!.className).toBe('sr-only');
  });

  it('is absent when Publish can be pressed, and a press publishes', async () => {
    actions.publishFormAction.mockResolvedValue({
      ok: true,
      updatedAt: 1_700_000_000_100,
      saved: { name: 'Lead quiz', config: { version: 1, steps: [] } },
      previousPublishedAt: PREVIOUS_AT,
    });
    await mount({ hasDraft: true });
    expect(reason()).toBeNull();
    expect(main().hasAttribute('aria-describedby')).toBe(false);
    await click(main());
    expect(actions.publishFormAction).toHaveBeenCalledTimes(1);
  });
});

describe('the revert dialog', () => {
  it('is rendered beside the pill, not inside it, so it does not take the pill\'s semibold', async () => {
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    await click(revertItem());
    const dialog = $('[data-testid="confirm-dialog"]')!;
    expect(dialog).not.toBeNull();
    const pill = $('[data-testid="publish-control"]')!;
    expect(pill.contains(dialog)).toBe(false);
    // No ancestor of the dialog sets a weight, and the card resets it anyway.
    for (let el = dialog.parentElement; el && el !== document.body; el = el.parentElement) {
      expect(el.className).not.toMatch(/font-(medium|semibold|bold)/);
    }
    expect(dialog.className).toMatch(/\bfont-normal\b/);
  });
});

describe('Revert to the previous published version', () => {
  it('is disabled with no earlier published version, says so, and does nothing on click', async () => {
    await mount({ previousAt: null });
    await openMenu();
    expect(revertItem().getAttribute('aria-disabled')).toBe('true');
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(m.revertUnavailable);

    await click(revertItem());
    expect($('[data-testid="confirm-dialog"]')).toBeNull();
    expect(actions.revertFormAction).not.toHaveBeenCalled();
  });

  it('shows when the previous version went live', async () => {
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    expect(revertItem().getAttribute('aria-disabled')).toBe('false');
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(
      t(m.revertAvailable, { date: when(PREVIOUS_AT) }),
    );
  });

  it('asks first, naming the date and saying the draft does not change; cancel calls nothing', async () => {
    await mount({ previousAt: PREVIOUS_AT, hasDraft: true });
    await openMenu();
    await click(revertItem());

    const dialog = $('[data-testid="confirm-dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain(m.revertTitle);
    expect(dialog.textContent).toContain(when(PREVIOUS_AT));
    expect(dialog.textContent).toContain('Your draft does not change.');
    expect($('[data-testid="confirm-dialog-confirm"]')!.textContent).toBe(m.revertConfirm);

    await click($('[data-testid="confirm-dialog-cancel"]'));
    expect($('[data-testid="confirm-dialog"]')).toBeNull();
    expect(actions.revertFormAction).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('on confirm, saves pending edits first, reverts, and hands the editor the result', async () => {
    const order: string[] = [];
    flush.mockImplementation(async () => {
      order.push('flush');
      return { ok: true };
    });
    actions.revertFormAction.mockImplementation(async () => {
      order.push('revert');
      return reverted();
    });
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    await click(revertItem());
    await click($('[data-testid="confirm-dialog-confirm"]'));

    expect(order).toEqual(['flush', 'revert']);
    expect(actions.revertFormAction).toHaveBeenCalledWith('form-1');
    expect(onReverted).toHaveBeenCalledWith(reverted());
    expect(toasts.success).toHaveBeenCalledWith(m.reverted);

    // The version just replaced is now the one a revert brings back.
    await openMenu();
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(
      t(m.revertAvailable, { date: when(LATER_AT) }),
    );
  });

  it('reverts nothing when the pending edits cannot be saved', async () => {
    flush.mockResolvedValue({ ok: false, kind: 'error' });
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    await click(revertItem());
    await click($('[data-testid="confirm-dialog-confirm"]'));

    expect(actions.revertFormAction).not.toHaveBeenCalled();
    expect(onReverted).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m.revertSaveFirst);
  });

  it('greys out after a 409 NOTHING_TO_REVERT', async () => {
    actions.revertFormAction.mockResolvedValue({ ok: false, code: 'NOTHING_TO_REVERT' });
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    await click(revertItem());
    await click($('[data-testid="confirm-dialog-confirm"]'));

    expect(toasts.error).toHaveBeenCalledWith(m.nothingToRevert);
    expect(onReverted).not.toHaveBeenCalled();
    await openMenu();
    expect(revertItem().getAttribute('aria-disabled')).toBe('true');
  });

  it('lights up after a publish, without a reload', async () => {
    actions.publishFormAction.mockResolvedValue({
      ok: true,
      updatedAt: 1_700_000_000_100,
      saved: { name: 'Lead quiz', config: { version: 1, steps: [] } },
      previousPublishedAt: PREVIOUS_AT,
    });
    await mount({ previousAt: null, hasDraft: true });
    await click($('[data-testid="publish-button"]'));
    expect(actions.publishFormAction).toHaveBeenCalled();

    await openMenu();
    expect(revertItem().getAttribute('aria-disabled')).toBe('false');
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(
      t(m.revertAvailable, { date: when(PREVIOUS_AT) }),
    );
  });

  it('speaks Spanish with the Spanish catalog', async () => {
    const es = getMessages('es').admin.publish;
    await mount({ previousAt: PREVIOUS_AT, locale: 'es' });
    expect($('[data-testid="publish-menu-button"]')!.getAttribute('aria-label')).toBe(es.moreOptions);
    await openMenu();
    expect(revertItem().textContent).toContain('Volver a la versión publicada anterior');
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(
      t(es.revertAvailable, { date: when(PREVIOUS_AT, 'es') }),
    );
    await click(revertItem());
    expect($('[data-testid="confirm-dialog"]')!.textContent).toContain('Tu borrador no cambia.');
  });
});
