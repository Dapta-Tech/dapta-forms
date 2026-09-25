// @vitest-environment happy-dom
/**
 * The human check both public layouts share: `useCaptchaGate` (the widget
 * right above a finishing button, the fallback on the submitting screen, and
 * strict mode's hidden field) and `submitFinal` (what a final submit does with
 * each outcome). Driven through a stand-in for the provider's browser API and
 * a hand-driven IntersectionObserver, so no request leaves the test.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';
import type { PublicCaptcha } from '@quill/types';
import { resetTurnstileLoaderForTests, type TurnstileRenderOptions } from '@/lib/captcha';
import {
  captchaAborted,
  HELD_TOKEN_TTL_MS,
  submitErrorMessage,
  submitFinal,
  useCaptchaGate,
  type CaptchaGate,
  type CaptchaResult,
  type SubmitActionResult,
} from './renderer-shared';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  el: HTMLElement;
  opts: TurnstileRenderOptions;
  id: string;
}
let renders: Rendered[];
let removed: string[];
let root: Root;
let host: HTMLDivElement;
let gate: CaptchaGate;

const AUTO: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key' };
const STRICT: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key', strict: true };

const PROMPT = 'Confirma que eres una persona para enviar tus respuestas.';

function Harness({ captcha, withSlot = false }: { captcha: PublicCaptcha | undefined; withSlot?: boolean }) {
  const g = useCaptchaGate(captcha, { sessionId: 'sess-123', locale: 'es', theme: 'dark', prompt: PROMPT });
  useEffect(() => {
    gate = g;
  });
  gate = g;
  return (
    <div>
      <div data-testid="step">{g.honeypot}</div>
      <div data-testid="footer">
        {withSlot ? g.inline : null}
        <button type="button">Enviar</button>
      </div>
      <div data-testid="submitting">{g.widget}</div>
    </div>
  );
}

async function mount(captcha: PublicCaptcha | undefined, withSlot = false) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness captcha={captcha} withSlot={withSlot} />));
}

async function rerender(captcha: PublicCaptcha | undefined, withSlot: boolean) {
  await act(async () => root.render(<Harness captcha={captcha} withSlot={withSlot} />));
}

/** The observer the inline slot watches its place with; tests decide when it is seen. */
let observers: { cb: IntersectionObserverCallback; el?: Element }[];
async function scrollSlotIntoView() {
  await act(async () => {
    for (const o of observers) o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Start a check and let the widget mount and render. The pending result comes
 * back boxed: an async function returning a bare promise would await it.
 */
async function startChallenge(): Promise<{ result: Promise<CaptchaResult> }> {
  let result!: Promise<CaptchaResult>;
  await act(async () => {
    result = gate.challenge();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { result };
}

beforeEach(() => {
  resetTurnstileLoaderForTests();
  renders = [];
  removed = [];
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private entry: { cb: IntersectionObserverCallback; el?: Element };
      constructor(cb: IntersectionObserverCallback) {
        this.entry = { cb };
        observers.push(this.entry);
      }
      observe(el: Element) {
        this.entry.el = el;
      }
      disconnect() {}
    },
  );
  window.turnstile = {
    render: (el, opts) => {
      const id = `w${renders.length + 1}`;
      renders.push({ el, opts, id });
      return id;
    },
    reset: () => {},
    remove: (id) => {
      if (id) removed.push(id);
    },
  };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  delete window.turnstile;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCaptchaGate: a form served without a check', () => {
  it('renders nothing, adds no field and loads nothing', async () => {
    const appended = vi.spyOn(document.head, 'appendChild');
    delete window.turnstile;
    await mount(undefined);
    expect(gate.enabled).toBe(false);
    expect(gate.widget).toBeNull();
    expect(gate.honeypot).toBeNull();
    gate.prewarm();
    expect(appended).not.toHaveBeenCalled();
    expect(gate.submitFields()).toEqual({});
    expect(document.querySelector('[name="pf_hp"]')).toBeNull();
  });
});

describe('useCaptchaGate: automatic mode', () => {
  it('renders one widget per run, with everything the API later checks', async () => {
    await mount(AUTO);
    const { result } = await startChallenge();
    expect(renders).toHaveLength(1);
    expect(renders[0]!.opts).toMatchObject({
      sitekey: 'site-key',
      action: 'submit',
      cData: 'sess-123',
      appearance: 'interaction-only',
      language: 'es',
      theme: 'dark',
      size: 'flexible',
      retry: 'never',
    });
    // Mounted on the submitting screen, nowhere else.
    expect(host.querySelector('[data-testid="submitting"] [data-testid="captcha-widget"]')).not.toBeNull();

    await act(async () => renders[0]!.opts.callback!('tok-1'));
    await expect(result).resolves.toEqual({ status: 'token', token: 'tok-1' });
  });

  it('reports the check unavailable when the widget errors or the browser is unsupported', async () => {
    await mount(AUTO);
    const { result: errored } = await startChallenge();
    let handled: boolean | void = false;
    await act(async () => {
      handled = renders[0]!.opts['error-callback']!('300030');
    });
    await expect(errored).resolves.toMatchObject({ status: 'unavailable' });
    // Handled: the provider neither throws into the page nor logs.
    expect(handled).toBe(true);

    const { result: unsupported } = await startChallenge();
    await act(async () => renders[1]!.opts['unsupported-callback']!());
    await expect(unsupported).resolves.toMatchObject({ status: 'unavailable', reason: 'unsupported' });
  });

  it('gives up when nothing at all happens, but never while a person is on the checkbox', async () => {
    vi.useFakeTimers();
    await mount(AUTO);
    const { result: silent } = await startChallenge();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await expect(silent).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });

    const { result: human } = await startChallenge();
    await act(async () => renders[1]!.opts['before-interactive-callback']!());
    expect(gate.interactive).toBe(true);
    let settled = false;
    void human.then(() => {
      settled = true;
    });
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(settled).toBe(false);
    await act(async () => renders[1]!.opts['after-interactive-callback']!());
    expect(gate.interactive).toBe(false);
    await act(async () => renders[1]!.opts.callback!('tok-after-click'));
    await expect(human).resolves.toEqual({ status: 'token', token: 'tok-after-click' });
  });

  it('counts again once the click is done: a widget that then goes quiet does not spin forever', async () => {
    vi.useFakeTimers();
    await mount(AUTO);
    const { result } = await startChallenge();
    await act(async () => renders[0]!.opts['before-interactive-callback']!());
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => renders[0]!.opts['after-interactive-callback']!());
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await expect(result).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });

  it('a second run replaces the first widget, and a late answer from the first is ignored', async () => {
    await mount(AUTO);
    const { result: first } = await startChallenge();
    const { result: second } = await startChallenge();
    await expect(first).resolves.toMatchObject({ status: 'unavailable', reason: 'superseded' });
    expect(removed).toEqual(['w1']);
    await act(async () => renders[0]!.opts.callback!('stale-token'));
    await act(async () => renders[1]!.opts.callback!('fresh-token'));
    await expect(second).resolves.toEqual({ status: 'token', token: 'fresh-token' });
  });

  it('a renderer that goes away mid-check releases the waiting submit', async () => {
    await mount(AUTO);
    const { result: pending } = await startChallenge();
    await act(async () => root.unmount());
    await expect(pending).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('adds no hidden field: that belongs to strict mode only', async () => {
    await mount(AUTO);
    expect(document.querySelector('[name="pf_hp"]')).toBeNull();
    expect(gate.submitFields()).toEqual({});
  });
});

describe('useCaptchaGate: inline, right above the finishing button', () => {
  it('loads nothing until the person has started AND the button area is on screen', async () => {
    await mount(AUTO, true);
    expect(gate.inlineReady()).toBe(true);
    expect(renders).toHaveLength(0);
    await scrollSlotIntoView(); // seen, but nobody has answered anything yet
    expect(renders).toHaveLength(0);
    await act(async () => gate.arm());
    await act(async () => {
      await Promise.resolve();
    });
    expect(renders).toHaveLength(1);
    expect(renders[0]!.opts).toMatchObject({
      sitekey: 'site-key',
      action: 'submit',
      cData: 'sess-123',
      appearance: 'interaction-only',
      'refresh-expired': 'auto',
      retry: 'never',
    });
    // Mounted above the button, not on the submitting screen.
    expect(host.querySelector('[data-testid="footer"] [data-testid="captcha-inline"] [data-testid="captcha-widget"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="submitting"] [data-testid="captcha-widget"]')).toBeNull();
  });

  it('strict: the widget above the button is visible to everyone', async () => {
    await mount(STRICT, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    expect(renders[0]!.opts.appearance).toBe('always');
  });

  it('a token ready before the click is used at once, with no new widget', async () => {
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    await act(async () => renders[0]!.opts.callback!('early-token'));
    let result!: CaptchaResult;
    await act(async () => {
      result = await gate.challenge();
    });
    expect(result).toEqual({ status: 'token', token: 'early-token' });
    expect(renders).toHaveLength(1);
  });

  it('a click before the token is ready waits for it', async () => {
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    const { result } = await startChallenge();
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    await act(async () => renders[0]!.opts.callback!('late-token'));
    await expect(result).resolves.toEqual({ status: 'token', token: 'late-token' });
  });

  it('a click on a button whose area was never seen mounts the widget right away', async () => {
    await mount(AUTO, true); // not armed, not in view: a keyboard submit
    const { result } = await startChallenge();
    expect(renders).toHaveLength(1);
    await act(async () => renders[0]!.opts.callback!('tok'));
    await expect(result).resolves.toEqual({ status: 'token', token: 'tok' });
  });

  it('a token is single use: the next attempt gets a fresh widget', async () => {
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    await act(async () => renders[0]!.opts.callback!('first'));
    await act(async () => {
      await gate.challenge();
    });
    const { result } = await startChallenge();
    expect(renders).toHaveLength(2);
    expect(removed).toEqual(['w1']);
    await act(async () => renders[1]!.opts.callback!('second'));
    await expect(result).resolves.toEqual({ status: 'token', token: 'second' });
  });

  it('never submits an expired token: it waits for the refreshed one', async () => {
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    await act(async () => renders[0]!.opts.callback!('old'));
    await act(async () => renders[0]!.opts['expired-callback']!());
    const { result } = await startChallenge();
    // The same widget refreshes itself (refresh-expired: auto): no remount.
    expect(renders).toHaveLength(1);
    await act(async () => renders[0]!.opts.callback!('refreshed'));
    await expect(result).resolves.toEqual({ status: 'token', token: 'refreshed' });
  });

  it('shows the prompt above a checkbox, and waits for the person as long as it takes', async () => {
    vi.useFakeTimers();
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    await act(async () => renders[0]!.opts['before-interactive-callback']!());
    const slot = host.querySelector('[data-testid="captcha-inline"]')!;
    expect(slot.textContent).toContain(PROMPT);
    expect(slot.getAttribute('data-captcha-state')).toBe('interactive');
    const { result } = await startChallenge();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    await act(async () => renders[0]!.opts['after-interactive-callback']!());
    await act(async () => renders[0]!.opts.callback!('clicked'));
    await expect(result).resolves.toEqual({ status: 'token', token: 'clicked' });
    expect(slot.textContent).not.toContain(PROMPT);
  });

  it('an inline widget that errored before the click is replaced by the click', async () => {
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    await act(async () => {
      renders[0]!.opts['error-callback']!('300030');
    });
    const { result } = await startChallenge();
    expect(renders).toHaveLength(2);
    await act(async () => renders[1]!.opts.callback!('after-error'));
    await expect(result).resolves.toEqual({ status: 'token', token: 'after-error' });
  });

  it('times out a silent widget only while a submit waits', async () => {
    vi.useFakeTimers();
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    await act(async () => {
      vi.advanceTimersByTime(60_000); // nobody waiting: nothing to time out
    });
    const { result } = await startChallenge();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await expect(result).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });

  it('keeps a token when its button area goes away (a reveal after Enviar), and spends it next', async () => {
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    await act(async () => renders[0]!.opts.callback!('kept'));
    await rerender(AUTO, false);
    expect(gate.inlineReady()).toBe(false);
    let result!: CaptchaResult;
    await act(async () => {
      result = await gate.challenge();
    });
    expect(result).toEqual({ status: 'token', token: 'kept' });
    expect(host.querySelector('[data-testid="submitting"] [data-testid="captcha-widget"]')).toBeNull();
  });

  it('without a slot mounted, the check falls back to the submitting screen', async () => {
    await mount(AUTO, false);
    expect(gate.inlineReady()).toBe(false);
    await startChallenge();
    expect(host.querySelector('[data-testid="submitting"] [data-testid="captcha-widget"]')).not.toBeNull();
  });

  it('hold: waits for the token above the button without spending it', async () => {
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    let held!: Promise<CaptchaResult>;
    await act(async () => {
      held = gate.hold();
    });
    await act(async () => renders[0]!.opts.callback!('kept-for-later'));
    await expect(held).resolves.toEqual({ status: 'token', token: 'kept-for-later' });
    // The interstitial takes the page (the slot goes), then the submit spends it.
    await rerender(AUTO, false);
    let result!: CaptchaResult;
    await act(async () => {
      result = await gate.challenge();
    });
    expect(result).toEqual({ status: 'token', token: 'kept-for-later' });
    expect(renders).toHaveLength(1);
  });

  it('hold: with no slot on the page there is nothing to wait for', async () => {
    await mount(AUTO, false);
    let result!: CaptchaResult;
    await act(async () => {
      result = await gate.hold();
    });
    expect(result).toEqual({ status: 'unavailable', reason: 'no slot' });
    expect(renders).toHaveLength(0);
  });

  it('a held token past its lifetime is never handed over: a fresh widget runs instead', async () => {
    vi.useFakeTimers();
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    await act(async () => renders[0]!.opts.callback!('old'));
    await act(async () => {
      vi.advanceTimersByTime(HELD_TOKEN_TTL_MS + 1);
    });
    const { result } = await startChallenge();
    expect(renders).toHaveLength(2);
    await act(async () => renders[1]!.opts.callback!('fresh'));
    await expect(result).resolves.toEqual({ status: 'token', token: 'fresh' });
  });

  it('a submit waiting on a slot that goes away ends as aborted, not as a failure', async () => {
    await mount(AUTO, true);
    await act(async () => gate.arm());
    await scrollSlotIntoView();
    const { result } = await startChallenge();
    await rerender(AUTO, false);
    const r = await result;
    expect(r).toEqual({ status: 'unavailable', reason: 'slot gone' });
    expect(captchaAborted(r)).toBe(true);
  });

  it('renders no slot at all for a form served without a check', async () => {
    await mount(undefined, true);
    expect(gate.inline).toBeNull();
    expect(gate.inlineReady()).toBe(false);
    expect(host.querySelector('[data-testid="captcha-inline"]')).toBeNull();
  });
});

describe('useCaptchaGate: strict mode', () => {
  it('shows the widget to everyone', async () => {
    await mount(STRICT);
    await startChallenge();
    expect(renders[0]!.opts.appearance).toBe('always');
  });

  it('renders a hidden field no person can reach, and sends what a bot wrote into it', async () => {
    await mount(STRICT);
    const input = document.querySelector<HTMLInputElement>('[name="pf_hp"]')!;
    expect(input).not.toBeNull();
    expect(input.type).toBe('text');
    expect(input.getAttribute('tabindex')).toBe('-1');
    expect(input.getAttribute('aria-hidden')).toBe('true');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.className).toBe('pf-hp');
    // No label text anywhere near it: nothing to announce, nothing to read.
    expect(input.closest('[data-testid="step"]')!.textContent).toBe('');
    expect(gate.submitFields()).toEqual({ hp: '' });

    // A bot writing straight into the DOM fires no input event.
    input.value = 'https://spam.example.com';
    expect(gate.submitFields()).toEqual({ hp: 'https://spam.example.com' });
  });
});

describe('submitFinal', () => {
  const m = getMessages('es').renderer;
  const ok: SubmitActionResult = { ok: true, score: 5, outcome: 'hot' };

  /** A gate whose runs answer from a script, recording how often it ran. */
  function fakeGate(results: CaptchaResult[], fields: { hp?: string } = {}): CaptchaGate & { runs: number } {
    const g = {
      enabled: true,
      strict: false,
      interactive: false,
      runs: 0,
      arm: () => {},
      prewarm: () => {},
      inlineReady: () => false,
      challenge: async () => results[Math.min(g.runs++, results.length - 1)]!,
      hold: async () => results[0]!,
      inline: null,
      widget: null,
      honeypot: null,
      submitFields: () => fields,
    };
    return g;
  }

  it('without a check, submits once with no token', async () => {
    const send = vi.fn(async () => ok);
    const res = await submitFinal({
      gate: { ...fakeGate([]), enabled: false },
      m,
      send,
      savePartial: vi.fn(),
    });
    expect(res).toEqual({ ok: true, score: 5, outcome: 'hot' });
    expect(send).toHaveBeenCalledWith({});
  });

  it('sends the token and the hidden field with the complete', async () => {
    const send = vi.fn(async () => ok);
    await submitFinal({
      gate: fakeGate([{ status: 'token', token: 'tok' }], { hp: '' }),
      m,
      send,
      savePartial: vi.fn(),
    });
    expect(send).toHaveBeenCalledWith({ captchaToken: 'tok', hp: '' });
  });

  it('a refused token gets ONE fresh try before the refusal is shown', async () => {
    const refused: SubmitActionResult = { ok: false, error: 'CAPTCHA_FAILED', message: 'English message' };
    const passesSecond = vi.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce(ok);
    const gate1 = fakeGate([
      { status: 'token', token: 'a' },
      { status: 'token', token: 'b' },
    ]);
    expect(await submitFinal({ gate: gate1, m, send: passesSecond, savePartial: vi.fn() })).toMatchObject({
      ok: true,
    });
    expect(gate1.runs).toBe(2);
    expect(passesSecond.mock.calls.map((c) => (c[0] as { captchaToken: string }).captchaToken)).toEqual(['a', 'b']);

    const alwaysRefused = vi.fn(async () => refused);
    const gate2 = fakeGate([{ status: 'token', token: 'a' }]);
    expect(await submitFinal({ gate: gate2, m, send: alwaysRefused, savePartial: vi.fn() })).toEqual({
      ok: false,
      message: m.errors.captcha,
    });
    expect(alwaysRefused).toHaveBeenCalledTimes(2);
  });

  it('a widget error gets ONE fresh widget before the answers are kept as a partial', async () => {
    const send = vi.fn(async () => ok);
    const recovers = fakeGate([
      { status: 'unavailable', reason: 'error 300030' },
      { status: 'token', token: 'second' },
    ]);
    expect(await submitFinal({ gate: recovers, m, send, savePartial: vi.fn() })).toMatchObject({ ok: true });
    expect(recovers.runs).toBe(2);
    expect(send).toHaveBeenCalledWith({ captchaToken: 'second' });

    const savePartial = vi.fn(async () => ok);
    const keepsFailing = fakeGate([{ status: 'unavailable', reason: 'error 600010' }]);
    expect(await submitFinal({ gate: keepsFailing, m, send: vi.fn(), savePartial })).toEqual({
      ok: false,
      message: m.captcha.unavailable,
    });
    expect(keepsFailing.runs).toBe(2);
    expect(savePartial).toHaveBeenCalledTimes(1);
  });

  it('shares that one retry: a refused token after a widget error is shown, not retried again', async () => {
    const refused: SubmitActionResult = { ok: false, error: 'CAPTCHA_FAILED' };
    const gate = fakeGate([
      { status: 'unavailable', reason: 'error 300030' },
      { status: 'token', token: 'b' },
    ]);
    const send = vi.fn(async () => refused);
    expect(await submitFinal({ gate, m, send, savePartial: vi.fn() })).toEqual({ ok: false, message: m.errors.captcha });
    expect(gate.runs).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a run cut short by a newer one, or by the page going away, is dropped without a trace', async () => {
    for (const reason of ['superseded', 'unmounted']) {
      const send = vi.fn();
      const savePartial = vi.fn();
      const res = await submitFinal({ gate: fakeGate([{ status: 'unavailable', reason }]), m, send, savePartial });
      expect(res).toEqual({ ok: false, aborted: true });
      expect(send).not.toHaveBeenCalled();
      expect(savePartial).not.toHaveBeenCalled();
    }
  });

  it('with no token, saves the answers as a partial and says so, without submitting the complete', async () => {
    const send = vi.fn(async () => ok);
    const savePartial = vi.fn(async () => ok);
    const res = await submitFinal({
      gate: fakeGate([{ status: 'unavailable', reason: 'script' }]),
      m,
      send,
      savePartial,
    });
    expect(res).toEqual({ ok: false, message: m.captcha.unavailable });
    expect(savePartial).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('never claims the answers are saved when that save failed too', async () => {
    const res = await submitFinal({
      gate: fakeGate([{ status: 'unavailable', reason: 'timeout' }]),
      m,
      send: vi.fn(),
      savePartial: async () => ({ ok: false, transport: true as const, message: 'network' }),
    });
    expect(res).toEqual({ ok: false, message: m.errors.submit });
  });

  it('an outage on the API side (503) is shown as such and not retried: the API kept the answers', async () => {
    const send = vi.fn(async () => ({ ok: false, error: 'CAPTCHA_UNAVAILABLE', message: 'English' }));
    const gate = fakeGate([{ status: 'token', token: 'a' }]);
    expect(await submitFinal({ gate, m, send, savePartial: vi.fn() })).toEqual({
      ok: false,
      message: m.captcha.unavailable,
    });
    expect(gate.runs).toBe(1);
  });
});

describe('submitErrorMessage', () => {
  it('localizes every code the API sends, in both languages, and never shows its English', () => {
    for (const locale of ['en', 'es'] as const) {
      const m = getMessages(locale).renderer;
      const english = { message: 'English server text' };
      expect(submitErrorMessage({ ...english, error: 'CAPTCHA_FAILED' }, m)).toBe(m.errors.captcha);
      // A page loaded before protection was turned on has no check to run:
      // "try again" would loop, so this one says to reload.
      expect(submitErrorMessage({ ...english, error: 'CAPTCHA_REQUIRED' }, m)).toBe(m.errors.captcha_required);
      expect(submitErrorMessage({ ...english, error: 'CAPTCHA_UNAVAILABLE' }, m)).toBe(m.captcha.unavailable);
      expect(submitErrorMessage({ ...english, error: 'RATE_LIMITED' }, m)).toBe(m.errors.rate_limited);
      expect(submitErrorMessage({ ...english, error: 'ANSWER_TOO_LONG' }, m)).toBe(m.errors.answer_too_long);
    }
    expect(getMessages('es').renderer.errors.captcha).toBe(
      'No pudimos verificar que eres una persona. Inténtalo de nuevo.',
    );
  });

  it('keeps today’s behavior for a code it does not know', () => {
    const m = getMessages('en').renderer;
    expect(submitErrorMessage({ error: 'NOT_FOUND', message: 'Form not found.' }, m)).toBe('Form not found.');
    expect(submitErrorMessage({}, m)).toBe(m.errors.submit);
  });
});
