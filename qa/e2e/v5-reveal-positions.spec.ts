import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V5-A12 — the reveal must play from EVERY position, reliably.
 *
 * The V4 tester reported this as intermittent: "hubieron un par de veces que el
 * reveal screen no me funcionaba cuando lo ponía de último, pero ahora ya,
 * revisa que funcione bien sin importar donde esté." An intermittent report is
 * not a bug you can fix from a description — it is one you either reproduce or
 * close with evidence, so this spec is the evidence.
 *
 * It walks the public form to completion for every legal position (after Q1, Q2,
 * Q3-the-last, and with the position ABSENT so the engine's default applies) and
 * asserts the reveal actually rendered. The LAST slot — the one he saw fail — is
 * run repeatedly, since a flake that shows up "a couple of times" will not show
 * up in a single pass.
 *
 * Detection uses a MutationObserver armed BEFORE the click rather than polling:
 * the reveal is a timed screen (durationMs), so a poll can straddle it and
 * report a false failure — which is itself a plausible explanation for an
 * intermittent-looking report.
 */

const API = 'http://localhost:4400';

/** Per-run nonce so reruns mint distinct forms (Date.now is banned in specs). */
const RUN = randomUUID().slice(0, 8);
let formSeq = 0;

/** How many times to replay the position he saw fail. */
const LAST_SLOT_REPEATS = 5;

async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), 'GET /v1/me should resolve the local principal').toBeTruthy();
  const me = (await res.json()) as { accountCode?: string; accountShortCode?: string };
  const code = me.accountCode ?? me.accountShortCode;
  expect(code, '/v1/me must expose an account code').toBeTruthy();
  return code as string;
}

/** A live 3-question form whose reveal sits at `afterStep` (absent = default). */
async function createForm(
  request: APIRequestContext,
  afterStep: number | undefined,
): Promise<{ id: string; slug: string }> {
  formSeq += 1;
  const name = `v5rev-${RUN}-w${test.info().workerIndex}-${formSeq}`;
  const config = {
    version: 1,
    steps: [
      { key: 'q1', type: 'text', question: 'First question', required: true },
      { key: 'q2', type: 'text', question: 'Second question', required: true },
      { key: 'q3', type: 'text', question: 'Third question', required: true },
    ],
    reveal: { enabled: true, headline: 'Reviewing your answers…', durationMs: 700 },
    ...(afterStep != null ? { revealAfterStep: afterStep } : {}),
  };
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

/**
 * Arm a MutationObserver that records the reveal headline the moment it appears.
 * Armed before the interaction that triggers it, so a 700ms screen cannot be
 * missed between assertions.
 */
async function watchForReveal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __revealSeen: string[] };
    w.__revealSeen = [];
    const seen = () => {
      const el = document.querySelector('.pf-reveal__headline');
      const text = el?.textContent?.trim();
      if (text && w.__revealSeen[w.__revealSeen.length - 1] !== text) w.__revealSeen.push(text);
    };
    seen();
    new MutationObserver(seen).observe(document.body, { childList: true, subtree: true });
  });
}

const revealsSeen = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __revealSeen: string[] }).__revealSeen ?? []);

/** Answer the visible text question and continue. */
async function answerStep(page: Page, value: string): Promise<void> {
  await page.locator('.pf__fields input, .pf__fields textarea').first().fill(value);
  await page.locator('.pf__btn--inline, .pf__btn').first().click();
}

/**
 * Load the public form and wait for its first question.
 *
 * The public API is a per-IP token bucket (60 burst, 1/s refill) shared by every
 * QA spec, and this test alone walks five whole forms back to back. When the
 * bucket empties, the page's server-side config fetch 429s, `getJson` throws,
 * and the subtree's error boundary renders "This page didn't load" — no
 * `.pf__fields` at all. That is the harness throttling itself, not the reveal
 * regression this spec exists to catch, so pause for a refill and reload.
 */
async function openForm(page: Page, url: string): Promise<void> {
  const firstInput = page.locator('.pf__fields input, .pf__fields textarea').first();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto(url);
    const up = await firstInput
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (up) return;
    await page.waitForTimeout(5_000); // let the rate-limit bucket refill
  }
  await expect(firstInput).toBeVisible({ timeout: 10_000 });
}

/**
 * Run the whole form. Returns the reveal headlines observed and whether the
 * done screen was reached — a reveal that plays but strands the respondent is
 * just as broken as one that never plays.
 */
async function runToCompletion(
  page: Page,
  url: string,
): Promise<{ reveals: string[]; finished: boolean }> {
  await openForm(page, url);
  await watchForReveal(page);
  for (const value of ['one', 'two', 'three']) {
    // A mid-form reveal replaces the question while it plays; wait for the next
    // question (or the done screen) rather than assuming an immediate swap.
    await expect(page.locator('.pf__fields input, .pf__fields textarea').first()).toBeVisible({
      timeout: 10_000,
    });
    await answerStep(page, value);
  }
  // Walking the steps is pure client work — only the FINAL submit crosses the
  // network — so this is the one place the shared rate-limit bucket can bite
  // mid-run. A throttled submit is not a dead end: `finalize` puts the phase
  // back to `steps` with the message in `.pf__error`, so the respondent still
  // has their Continue button. Retry it like they would, instead of reporting a
  // reveal regression that isn't one.
  const done = page.locator('.pf-done__title');
  let finished = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    finished = await done
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (finished) break;
    const errored = await page
      .locator('.pf__error')
      .first()
      .isVisible()
      .catch(() => false);
    if (!errored) break; // not a throttle — report the miss as the real signal
    await page.waitForTimeout(5_000); // let the rate-limit bucket refill
    await page.locator('.pf__btn--inline, .pf__btn').first().click();
  }
  return { reveals: await revealsSeen(page), finished };
}

test.describe('V5-A12 — the reveal plays from every position', () => {
  for (const [label, afterStep] of [
    ['after question 1', 1],
    ['after question 2', 2],
    ['after the LAST question', 3],
    ['with no explicit position (engine default)', undefined],
  ] as const) {
    test(`plays ${label}`, async ({ page, request }) => {
      const code = await accountCode(request);
      const { slug } = await createForm(request, afterStep);
      const { reveals, finished } = await runToCompletion(page, `/${code}/you/${slug}`);
      expect(reveals, `no reveal rendered with revealAfterStep=${String(afterStep)}`).toContain(
        'Reviewing your answers…',
      );
      expect(finished, 'the respondent must still reach the done screen').toBe(true);
    });
  }

  /**
   * The reported case, replayed. He saw the LAST slot fail "a couple of times"
   * out of several — a single green run would not have caught that, so this
   * runs it repeatedly on a fresh form each time and reports every miss at once
   * instead of dying on the first.
   */
  test(`the last slot survives ${LAST_SLOT_REPEATS} consecutive runs`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const code = await accountCode(request);
    const misses: string[] = [];
    for (let i = 1; i <= LAST_SLOT_REPEATS; i++) {
      const { slug } = await createForm(request, 3);
      const { reveals, finished } = await runToCompletion(page, `/${code}/you/${slug}`);
      if (!reveals.includes('Reviewing your answers…')) misses.push(`run ${i}: reveal never rendered`);
      if (!finished) misses.push(`run ${i}: never reached the done screen`);
    }
    expect(misses, `intermittent failures across ${LAST_SLOT_REPEATS} runs`).toEqual([]);
  });
});
