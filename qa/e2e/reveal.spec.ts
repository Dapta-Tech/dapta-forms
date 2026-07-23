import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Reveal screen behavior on the public form (config-driven, no builder).
 *
 * Covers:
 *  1. Reveal copy: `.pf-reveal__headline` shows the configured headline and the
 *     subtitle interpolates `[pick]` from the just-given answer.
 *  2. Auto-advance: the interstitial plays ~durationMs (1500) then shows the
 *     next step — total wait well under 5s.
 *  3. Prewarm: with `reveal.prewarm` and a pending booking outcome
 *     (hubspot_meetings), a <link rel="preconnect"> to meetings.hubspot.com is
 *     injected into <head> while the reveal is on screen.
 *  4. No interstitial when `reveal.enabled === false` or when no step sets
 *     `triggersReveal` — steps transition directly.
 *
 * Each test creates its own form via the admin API (:4400) so reruns are
 * idempotent. Interpolation uses the raw answer VALUE, so the option value is
 * the human-readable string ("Real Estate").
 */

const API = 'http://localhost:4400';

const PICK_STEP = {
  key: 'pick',
  type: 'multiple_choice',
  question: 'Pick your industry',
  flowGroup: 'qualification',
  triggersReveal: true,
  options: [
    { label: 'Real Estate', value: 'Real Estate', points: 10 },
    { label: 'Other', value: 'Other', points: 0 },
  ],
};

const EMAIL_STEP = { key: 'email', type: 'email', question: 'Your email?', required: true };

/** Base config: choice (triggersReveal) + email, booking outcome, reveal on. */
function revealConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Reveal QA', ctaText: 'Start' },
    steps: [PICK_STEP, EMAIL_STEP],
    scoring: { enabled: true },
    outcomes: [
      {
        id: 'p1',
        label: 'P1',
        minScore: 5, // only the 10-point option qualifies → prewarm sees a pending booking outcome
        booking: {
          provider: 'hubspot_meetings',
          url: 'https://meetings.hubspot.com/qa/reveal-spec',
          prefill: true,
        },
      },
    ],
    reveal: {
      enabled: true,
      headline: 'Hold on…',
      durationMs: 1500,
      subtitleTemplate: 'Advisor for [pick]',
      prewarm: true,
    },
    ...overrides,
  };
}

/**
 * POST /v1/forms (create writes LIVE config) → public path
 * /<accountCode>/me/<slug>. The account code is resolved from GET /v1/me —
 * the local auth stub's principal is NOT the `acme` account (it resolves to
 * the second seeded account, code `kea9if`), so never hardcode it.
 */
async function createForm(
  request: APIRequestContext,
  name: string,
  config: Record<string, unknown>,
): Promise<string> {
  const me = await request.get(`${API}/v1/me`);
  expect(me.ok(), `GET /v1/me failed: ${me.status()}`).toBeTruthy();
  const { accountCode } = (await me.json()) as { accountCode: string };

  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { slug: string };
  return `/${accountCode}/me/${body.slug}`;
}

/** Never let a test hit third-party hosts (preconnect tags alone are fine). */
async function blockExternal(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    return route.abort();
  });
}

/**
 * Open the public form and click through the cover to the first step.
 *
 * The public API is rate-limited per IP (60-token bucket, 1 token/s refill)
 * and the bucket is SHARED by every concurrently running QA spec — when it is
 * drained the server component gets a 429 and renders the not-found page.
 * Reload (tokens refill at 1/s) until the cover appears instead of failing on
 * a transient 429.
 */
async function openToFirstStep(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const start = page.getByRole('button', { name: 'Start' });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const visible = await start
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) break;
    await page.waitForTimeout(1_500);
    await page.reload();
  }
  await start.click();
  await expect(page.locator('.pf__question')).toHaveText('Pick your industry');
}

test('reveal shows configured headline and subtitle interpolated from the answer', async ({
  page,
  request,
}) => {
  await blockExternal(page);
  const path = await createForm(request, `reveal-qa-copy-${Date.now()}`, revealConfig());
  await openToFirstStep(page, path);

  await page.getByRole('radio', { name: 'Real Estate' }).click();

  // The interstitial only plays 1500ms — snapshot headline+subtitle the moment
  // it appears (rAF polling) instead of racing two separate locator waits.
  const copyHandle = await page.waitForFunction(
    () => {
      const h = document.querySelector('.pf-reveal__headline');
      const s = document.querySelector('.pf-reveal__subtitle');
      if (!h || !s) return null;
      // visible = takes up layout space
      if ((h as HTMLElement).getBoundingClientRect().height === 0) return null;
      return { headline: h.textContent ?? '', subtitle: s.textContent ?? '' };
    },
    undefined,
    { timeout: 5_000 },
  );
  const copy = (await copyHandle.jsonValue()) as { headline: string; subtitle: string };
  expect(copy.headline).toBe('Hold on…');
  expect(copy.subtitle).toBe('Advisor for Real Estate'); // [pick] → answer value
});

test('reveal auto-advances to the next step after ~1.5s', async ({ page, request }) => {
  await blockExternal(page);
  const path = await createForm(request, `reveal-qa-advance-${Date.now()}`, revealConfig());
  await openToFirstStep(page, path);

  const startedAt = Date.now();
  await page.getByRole('radio', { name: 'Real Estate' }).click();

  // The interstitial appears...
  await expect(page.locator('.pf-reveal__headline')).toBeVisible({ timeout: 3_000 });
  // ...and hands off to the email step on its own — no interaction needed.
  await expect(page.locator('.pf__question')).toHaveText('Your email?', { timeout: 5_000 });
  const elapsed = Date.now() - startedAt;
  expect(elapsed, `answer→next-step took ${elapsed}ms`).toBeLessThan(5_000);
  // It actually played the interstitial (durationMs 1500), not an instant skip.
  expect(elapsed, `reveal skipped too fast (${elapsed}ms)`).toBeGreaterThanOrEqual(1_000);
  await expect(page.locator('.pf-reveal__headline')).toHaveCount(0);
});

test('prewarm injects a hubspot preconnect link during the reveal', async ({ page, request }) => {
  await blockExternal(page);
  const path = await createForm(request, `reveal-qa-prewarm-${Date.now()}`, revealConfig());
  await openToFirstStep(page, path);

  // The 10-point option makes the pending outcome the booking one (minScore 5).
  await page.getByRole('radio', { name: 'Real Estate' }).click();

  // While the reveal is on screen, <head> must carry the preconnect warm-up.
  await page.waitForFunction(
    () => {
      const revealShowing = !!document.querySelector('.pf-reveal__headline');
      const preconnects = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel=preconnect]'),
      );
      const warmed = preconnects.some((l) => l.href.startsWith('https://meetings.hubspot.com'));
      return revealShowing && warmed;
    },
    undefined,
    { timeout: 5_000 },
  );

  // Sanity: enumerate hrefs — the provider host must be among them.
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel=preconnect]')).map(
      (l) => l.href,
    ),
  );
  expect(hrefs.some((h) => h.startsWith('https://meetings.hubspot.com'))).toBeTruthy();
});

test('no reveal screen when disabled or when no step triggers it', async ({ page, request }) => {
  // Two full public-page flows in one test; leave room for rate-limit reloads.
  test.setTimeout(60_000);
  await blockExternal(page);

  // Variant A: reveal.enabled false (step still sets triggersReveal). A long
  // durationMs (4000) means: if the interstitial DID play, the next question
  // could not appear within the 2.5s assertion window below.
  const disabledPath = await createForm(
    request,
    `reveal-qa-disabled-${Date.now()}`,
    revealConfig({
      reveal: {
        enabled: false,
        headline: 'Hold on…',
        durationMs: 4000,
        subtitleTemplate: 'Advisor for [pick]',
      },
    }),
  );
  await openToFirstStep(page, disabledPath);
  await page.getByRole('radio', { name: 'Real Estate' }).click();
  await expect(page.locator('.pf__question')).toHaveText('Your email?', { timeout: 2_500 });
  await expect(page.locator('.pf-reveal__headline')).toHaveCount(0);

  // Variant B: reveal enabled, but the choice step has NO triggersReveal.
  const noTriggerPath = await createForm(
    request,
    `reveal-qa-notrigger-${Date.now()}`,
    revealConfig({
      steps: [{ ...PICK_STEP, triggersReveal: undefined }, EMAIL_STEP],
      reveal: {
        enabled: true,
        headline: 'Hold on…',
        durationMs: 4000,
        subtitleTemplate: 'Advisor for [pick]',
      },
    }),
  );
  await openToFirstStep(page, noTriggerPath);
  await page.getByRole('radio', { name: 'Real Estate' }).click();
  await expect(page.locator('.pf__question')).toHaveText('Your email?', { timeout: 2_500 });
  await expect(page.locator('.pf-reveal__headline')).toHaveCount(0);
});
