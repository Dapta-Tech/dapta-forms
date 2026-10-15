// @vitest-environment happy-dom
/**
 * A form opened before a deploy can be finished after it, in both renderers.
 *
 * The page talks to a fake server through the REAL transport (`transport.ts`):
 * `fetch` is the only thing stubbed. The fake server behaves like a rolling
 * deploy: build A answers until the switch, then the request in flight on the
 * dying pod gets a 504, and build B answers 404 to any Server Action id it did
 * not compile (what stranded every respondent before this fix). It keeps one
 * submission per session, like the API's unique index.
 *
 * And a reload mid-form gives the person their answers back.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';
import { answerDraftKey } from './renderer-shared';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'quill-form-acme-f';
const steps = [
  { key: 'name', type: 'text' as const, question: 'Name?', required: true },
  { key: 'company', type: 'text' as const, question: 'Company?', required: true },
  { key: 'email', type: 'email' as const, question: 'Email?', required: true },
];
const slides = { version: 1, steps, partialSubmitAfterStep: 2 } as never;
const onePage = { version: 1, layout: 'vertical', steps } as never;

/* ── The fake server ────────────────────────────────────────────────────── */

type Row = { data: Record<string, unknown>; completed: boolean };
const server = {
  build: 'A' as 'A' | 'B',
  /** Submits the dying pod of build A still answers with a gateway timeout. */
  dyingPodTimeouts: 0,
  rows: new Map<string, Row>(),
  bookings: 0,
  requests: [] as {
    path: string;
    status: number;
    headers: Record<string, string>;
    body?: { type?: string };
  }[],
};

function reply(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json' },
  });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input);
  const headers = Object.fromEntries(
    Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  );
  const done = (res: Response) => {
    server.requests.push({
      path,
      status: res.status,
      headers,
      body: init?.body ? (JSON.parse(String(init.body)) as { type?: string }) : undefined,
    });
    return res;
  };
  // A Server Action call carries its compiled id. Build B never compiled
  // build A's ids: this is the 404 every retry used to get.
  if (headers['next-action'] && server.build === 'B')
    return done(reply(404, 'Server action not found.'));
  const op = /^\/api\/public\/forms\/acme\/f\/(submissions|events|booking|uploads)$/.exec(
    path,
  )?.[1];
  if (!op) return done(reply(404, 'Not Found'));
  // The submit in flight when the old pod goes away (what the ticket saw).
  if (op === 'submissions' && server.dyingPodTimeouts > 0) {
    server.dyingPodTimeouts -= 1;
    return done(reply(504, '<html>Gateway Timeout</html>'));
  }
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    sessionId: string;
    data?: Record<string, unknown>;
    partial?: boolean;
  };
  if (op === 'submissions') {
    // One row per (form, session); a late partial never reopens a complete.
    const row = server.rows.get(body.sessionId);
    if (!row?.completed)
      server.rows.set(body.sessionId, { data: body.data ?? {}, completed: !body.partial });
    return done(reply(200, { ok: true, score: 0, outcome: null }));
  }
  if (op === 'booking') server.bookings += 1;
  return done(reply(200, { ok: true }));
}

/** The rollout: from the next request on, build B serves; `timeouts` submits hit the dying pod first. */
function deploy(timeouts = 1) {
  server.build = 'B';
  server.dyingPodTimeouts = timeouts;
}

/* ── Harness ────────────────────────────────────────────────────────────── */

let root: Root | undefined;
let el: HTMLDivElement | undefined;

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/acme/f/quote');
  server.build = 'A';
  server.dyingPodTimeouts = 0;
  server.rows.clear();
  server.bookings = 0;
  server.requests = [];
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root!.render(node));
  await settle();
}

/** What a reload of the tab does to the renderer: a fresh mount, same storage. */
async function unmount() {
  await act(async () => root?.unmount());
  el?.remove();
  root = undefined;
  el = undefined;
}

/** Let promises and short timers run (the submit retry waits 1s, then 2s). */
async function settle(ms = 0) {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms ? ms / 10 : 0));
    });
  }
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const button = () =>
  [...el!.querySelectorAll<HTMLButtonElement>('button.pf__btn')].find(
    (b) => !b.classList.contains('pf__back'),
  )!;
const slideInput = () => el!.querySelector<HTMLInputElement>('.pf__fields input')!;
const slideQuestion = () => el!.querySelector('.pf__fields')?.closest('.pf')?.textContent ?? '';
const onePageInputs = () => el!.querySelectorAll<HTMLInputElement>('.pf-v__question input');
const sessionId = () => window.sessionStorage.getItem(KEY);
const completeRows = () => [...server.rows.values()].filter((r) => r.completed);

async function answerSlide(value: string) {
  await act(async () => typeInto(slideInput(), value));
  await act(async () => button().click());
  await settle();
}

/* ── A deploy mid-form ──────────────────────────────────────────────────── */

describe('slides: a deploy between two answers', () => {
  it('the final submit lands after the deploy, once, without a reload', async () => {
    await mount(
      <FormRenderer accountCode="acme" slug="f" name="Quote" config={slides} locale="en" resume />,
    );
    const session = sessionId();
    await answerSlide('Ada');
    await answerSlide('Analytical Engines');
    // The partial at the threshold landed on build A.
    expect(server.rows.get(session!)).toEqual({
      data: { name: 'Ada', company: 'Analytical Engines' },
      completed: false,
    });

    deploy();
    await answerSlide('ada@example.com');
    await settle(1500); // the first attempt met the dying pod; the retry waits 1s

    expect(el!.textContent).toMatch(/thank you/i);
    expect(server.rows.size).toBe(1);
    expect(completeRows()).toEqual([
      {
        data: { name: 'Ada', company: 'Analytical Engines', email: 'ada@example.com' },
        completed: true,
      },
    ]);
    const submits = server.requests.filter((r) => r.path.endsWith('/submissions'));
    expect(submits.map((r) => r.status)).toEqual([200, 504, 200]);
    // Nothing the page sent depended on a build's action ids.
    expect(server.requests.every((r) => !r.headers['next-action'])).toBe(true);
    expect(server.requests.every((r) => r.status !== 404)).toBe(true);
  });
});

describe('one page: a deploy between two answers', () => {
  it('the final submit lands after the deploy, once, without a reload', async () => {
    await mount(
      <VerticalFormRenderer
        accountCode="acme"
        slug="f"
        name="Quote"
        config={onePage}
        locale="en"
        resume
      />,
    );
    const session = sessionId();
    await act(async () => typeInto(onePageInputs()[0]!, 'Ada'));
    await act(async () => typeInto(onePageInputs()[1]!, 'Analytical Engines'));
    await settle();

    deploy();
    await act(async () => typeInto(onePageInputs()[2]!, 'ada@example.com'));
    await act(async () => button().click());
    await settle(1500);

    expect(el!.textContent).toMatch(/thank you/i);
    expect([...server.rows.keys()]).toEqual([session]);
    expect(completeRows()).toEqual([
      {
        data: { name: 'Ada', company: 'Analytical Engines', email: 'ada@example.com' },
        completed: true,
      },
    ]);
    const submits = server.requests.filter((r) => r.path.endsWith('/submissions'));
    expect(submits.map((r) => r.status)).toEqual([504, 200]);
    expect(server.requests.every((r) => !r.headers['next-action'])).toBe(true);
  });
});

/* ── A reload mid-form ──────────────────────────────────────────────────── */

describe('slides: a reload mid-form', () => {
  const render = (resume = true) => (
    <FormRenderer
      accountCode="acme"
      slug="f"
      name="Quote"
      config={slides}
      locale="en"
      resume={resume}
    />
  );

  it('comes back on the same question with every answer, and finishes as the same response', async () => {
    await mount(render());
    const session = sessionId();
    await answerSlide('Ada');
    await answerSlide('Analytical Engines');
    expect(slideQuestion()).toContain('Email?');

    await unmount();
    await mount(render());
    expect(sessionId()).toBe(session);
    expect(slideQuestion()).toContain('Email?');
    await answerSlide('ada@example.com');

    expect(el!.textContent).toMatch(/thank you/i);
    expect(server.rows.size).toBe(1);
    expect(server.rows.get(session!)).toEqual({
      data: { name: 'Ada', company: 'Analytical Engines', email: 'ada@example.com' },
      completed: true,
    });
    // The response is over: nothing is kept for the next one in this tab.
    expect(window.sessionStorage.getItem(answerDraftKey(KEY))).toBeNull();
  });

  it('keeps nothing and restores nothing without `resume` (the builder preview)', async () => {
    await mount(render(false));
    await answerSlide('Ada');
    expect(window.sessionStorage.getItem(answerDraftKey(KEY))).toBeNull();
    await unmount();
    await mount(render(false));
    expect(slideQuestion()).toContain('Name?');
    expect(slideInput().value).toBe('');
  });

  it("never restores another session's answers", async () => {
    window.sessionStorage.setItem(KEY, 'mine');
    window.sessionStorage.setItem(
      answerDraftKey(KEY),
      JSON.stringify({ sessionId: 'someone-else', answers: { name: 'Eve' }, index: 1 }),
    );
    await mount(render());
    expect(slideQuestion()).toContain('Name?');
    expect(slideInput().value).toBe('');
  });
});

describe('one page: a reload mid-form', () => {
  it('comes back with every answer, and finishes as the same response', async () => {
    const render = () => (
      <VerticalFormRenderer
        accountCode="acme"
        slug="f"
        name="Quote"
        config={onePage}
        locale="en"
        resume
      />
    );
    await mount(render());
    const session = sessionId();
    await act(async () => typeInto(onePageInputs()[0]!, 'Ada'));
    await act(async () => typeInto(onePageInputs()[1]!, 'Analytical Engines'));
    await settle();

    await unmount();
    await mount(render());
    expect(sessionId()).toBe(session);
    expect([...onePageInputs()].map((i) => i.value)).toEqual(['Ada', 'Analytical Engines', '']);
    await act(async () => typeInto(onePageInputs()[2]!, 'ada@example.com'));
    await act(async () => button().click());
    await settle();

    expect(el!.textContent).toMatch(/thank you/i);
    expect(server.rows.get(session!)).toEqual({
      data: { name: 'Ada', company: 'Analytical Engines', email: 'ada@example.com' },
      completed: true,
    });
    expect(window.sessionStorage.getItem(answerDraftKey(KEY))).toBeNull();
  });
});

describe('a reload with a slider', () => {
  const sliderSteps = [
    { key: 'budget', type: 'slider' as const, question: 'Budget?', min: 0, max: 10, default: 2 },
    { key: 'name', type: 'text' as const, question: 'Name?', required: true },
  ];
  const range = () => el!.querySelector<HTMLInputElement>('input[type="range"]')!;
  function slideTo(value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(range(), value);
    range().dispatchEvent(new Event('input', { bubbles: true }));
    range().dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('one page: the moved slider comes back where it was, not at its default', async () => {
    const config = { version: 1, layout: 'vertical', steps: sliderSteps } as never;
    const render = () => (
      <VerticalFormRenderer
        accountCode="acme"
        slug="f"
        name="Quote"
        config={config}
        locale="en"
        resume
      />
    );
    await mount(render());
    const session = sessionId();
    await act(async () => slideTo('7'));
    await settle();
    expect(range().value).toBe('7');

    await unmount();
    await mount(render());
    expect(range().value).toBe('7');
    await act(async () =>
      typeInto(
        el!.querySelector<HTMLInputElement>(
          '.pf-v__question input[type="text"], .pf-v__question input:not([type])',
        )!,
        'Ada',
      ),
    );
    await act(async () => button().click());
    await settle();
    expect(server.rows.get(session!)).toEqual({
      data: { budget: 7, name: 'Ada' },
      completed: true,
    });
  });

  it('slides: the moved slider comes back where it was, not at its default', async () => {
    const config = { version: 1, steps: sliderSteps } as never;
    const render = () => (
      <FormRenderer accountCode="acme" slug="f" name="Quote" config={config} locale="en" resume />
    );
    await mount(render());
    await act(async () => slideTo('7'));
    await settle();

    await unmount();
    await mount(render());
    expect(range().value).toBe('7');
  });
});

describe('a reload before answering anything', () => {
  it.each([
    [
      'slides',
      () => (
        <FormRenderer accountCode="acme" slug="f" name="Quote" config={slides} locale="en" resume />
      ),
      async () => answerSlide('Ada'),
    ],
    [
      'one page',
      () => (
        <VerticalFormRenderer
          accountCode="acme"
          slug="f"
          name="Quote"
          config={onePage}
          locale="en"
          resume
        />
      ),
      async () => {
        await act(async () => typeInto(onePageInputs()[0]!, 'Ada'));
        await settle();
      },
    ],
  ])(
    '%s: does not count as started, so `start` still goes out with the first answer',
    async (_, render, answerFirst) => {
      await mount(render());
      await unmount();
      server.requests = [];
      await mount(render());
      await answerFirst();
      const types = server.requests
        .filter((r) => r.path.endsWith('/events'))
        .map((r) => r.body?.type);
      expect(types).toContain('start');
    },
  );
});
