import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The public page save under a TRANSPORT failure — a real click, a real Server
 * Action, and a request whose answer never comes back.
 *
 * A client-side timeout does not abort the write, so "not applied" and
 * "applied, answer lost" look identical from the browser. Rereading cannot tell
 * them apart either: a read can overtake the in-flight write and return
 * pre-write state. The screen therefore fences — it advances the member's
 * profile revision from the revision the ambiguous save expected — through a
 * POST Route Handler that runs OFF the Server Action queue (actions from one
 * tab are serialized, so the question would otherwise queue behind the very
 * request that is stuck).
 *
 * Fence wins  -> that save can never land: nothing was applied.
 * Fence loses -> something else got there first: adopt what is stored, and say
 *                so without ever claiming we saved it.
 *
 * Every ordering below also asserts the revision ledger: exactly one increment
 * per real write, and none at all for a refusal or a repeated check.
 */

const API = 'http://localhost:4400';

/** Copy families this screen must keep distinct (en). */
const COPY = {
  notApplied: 'That save timed out and was not applied. Nothing changed.',
  noOp: 'Your last save did not complete. Your page is unchanged, but another save finished first.',
  changedElsewhere:
    'Your public page changed somewhere else. The current version is shown — review it, then save again.',
  latestLoaded:
    'Your last save did not complete. Your page changed in the meantime, so the current version is shown.',
  unresolved:
    'We still cannot tell whether your last save was applied. Editing stays off until we know.',
  checkAgain: 'Check again',
  reload: 'Reload',
  saved: 'Public page saved.',
};

interface StoredProfile {
  enabled?: boolean;
  headline?: string | null;
  links?: { label: string; url: string }[];
}

interface Stored {
  profile: StoredProfile | null;
  revision: number;
}

/** Copy families in Spanish — the same nine states, in the other locale. */
const COPY_ES = {
  noOp: 'Tu último guardado no se completó. Tu página no cambió, pero otro guardado terminó primero.',
  unresolved:
    'Todavía no podemos saber si se aplicó tu último guardado. La edición queda desactivada hasta saberlo.',
  changedElsewhere:
    'Tu página pública cambió en otro lugar. Se muestra la versión actual: revísala y vuelve a guardar.',
  saved: 'Página pública guardada.',
  checkAgain: 'Comprobar de nuevo',
};

const stored = async (request: APIRequestContext): Promise<Stored> => {
  const res = await request.get(`${API}/v2/me/profile`);
  expect(res.ok(), `profile read failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Stored;
};

/** Put the page back to "not published", whatever revision it is at now. */
async function resetProfile(request: APIRequestContext): Promise<number> {
  const before = await stored(request);
  if (before.profile === null) return before.revision;
  const res = await request.put(`${API}/v2/me/profile`, {
    data: { profile: null, expectedRevision: before.revision },
  });
  expect(res.ok(), `profile reset failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as Stored).revision;
}

/** Write a page straight through the API, at whatever revision it is at now. */
async function writeProfile(request: APIRequestContext, profile: StoredProfile): Promise<number> {
  const before = await stored(request);
  const res = await request.put(`${API}/v2/me/profile`, {
    data: { profile: { version: 1, ...profile }, expectedRevision: before.revision },
  });
  expect(res.ok(), `profile write failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as Stored).revision;
}

/** Advance the revision from outside the browser WITHOUT changing content. */
async function fenceFromOutside(request: APIRequestContext, expectedRevision: number): Promise<void> {
  const res = await request.post(`${API}/v2/me/profile/fence`, { data: { expectedRevision } });
  expect(res.ok(), `outside fence failed: ${res.status()}`).toBeTruthy();
}

const isAction = (method: string, headers: Record<string, string>): boolean =>
  method === 'POST' && Boolean(headers['next-action']);

function section(page: Page) {
  const root = page.getByTestId('public-page-settings');
  return {
    root,
    toggle: root.getByRole('switch', { name: 'Published' }),
    viewLink: root.getByRole('link', { name: 'View page' }),
    headline: root.getByRole('textbox').first(),
    saveButton: root.getByRole('button').last(),
    notice: page.getByTestId('public-page-notice'),
    status: page.getByTestId('public-page-status'),
    checkAgain: page.getByTestId('public-page-check-again'),
    reload: page.getByTestId('public-page-reload'),
  };
}

/** No toggle to click, and no on/off claim to read. */
async function writesAreBlocked(page: Page): Promise<boolean> {
  const { toggle } = section(page);
  return (await toggle.count()) === 0 || !(await toggle.isEnabled());
}

test.describe('public page: a save whose answer never arrives', () => {
  test.beforeEach(async ({ request }) => {
    await resetProfile(request);
  });

  test('fence wins: the save never landed, and the screen says exactly that', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const start = await stored(request);

    // The action never reaches the server: a dropped request, which is the
    // ambiguity this whole mechanism exists for.
    let dropped = false;
    await page.route('**/admin/settings**', async (route) => {
      const r = route.request();
      if (dropped || !isAction(r.method(), r.headers())) return route.fallback();
      dropped = true;
      return route.abort('connectionfailed');
    });

    await page.goto('/admin/settings');
    const s = section(page);
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    await s.toggle.click();

    // Settled by the fence, not by a guess.
    await expect(s.notice).toHaveText(COPY.notApplied, { timeout: 60_000 });
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false');
    await expect(s.viewLink).toHaveCount(0);
    // Never a success claim for something that was never applied.
    await expect(page.getByText(COPY.saved)).toHaveCount(0);

    const after = await stored(request);
    expect(after.profile).toBeNull();
    // Exactly one increment: the fence. The refused save burned nothing.
    expect(after.revision).toBe(start.revision + 1);
  });

  test('fence loses: the write did land, so the current page is adopted — not "Saved"', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const start = await stored(request);

    // The action runs and the write lands; only the ANSWER is held, past the
    // 15s ceiling the client puts on a Server Action.
    let held = false;
    await page.route('**/admin/settings**', async (route) => {
      const r = route.request();
      if (held || !isAction(r.method(), r.headers())) return route.fallback();
      held = true;
      // Forward it, capture the answer, then sit on it. Buffer the body first:
      // a fetched response is disposed while we wait, and this test is about
      // the ANSWER being late, not the write.
      const response = await route.fetch();
      const status = response.status();
      const body = await response.body();
      const headers = { ...response.headers() };
      delete headers['content-encoding'];
      delete headers['content-length'];
      await new Promise((resolve) => setTimeout(resolve, 17_000));
      await route.fulfill({ status, headers, body });
    });

    await page.goto('/admin/settings');
    const s = section(page);
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    await s.toggle.click();

    // While nothing is known, nothing may be written from here.
    await page.waitForTimeout(17_000);
    expect(await writesAreBlocked(page), 'writes stayed open while the state was unknown').toBe(true);

    // The fence lost to the write that landed, so the stored page is adopted and
    // the copy says the state changed — it never claims we saved it.
    await expect(s.notice).toHaveText(COPY.latestLoaded, { timeout: 60_000 });
    await expect(s.toggle).toHaveAttribute('aria-checked', 'true');
    await expect(s.viewLink).toBeVisible();
    await expect(page.getByText(COPY.saved)).toHaveCount(0);

    const after = await stored(request);
    expect(after.profile).toMatchObject({ enabled: true });
    // One increment for the write that landed; the losing fence burned nothing.
    expect(after.revision).toBe(start.revision + 1);
  });

  test('fence unreachable: editing stays blocked, and Check again settles it without burning more', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const start = await stored(request);

    let dropped = false;
    let fenceAttempts = 0;
    await page.route('**/admin/settings**', async (route) => {
      const r = route.request();
      if (dropped || !isAction(r.method(), r.headers())) return route.fallback();
      dropped = true;
      return route.abort('connectionfailed');
    });
    // The first reconciliation attempt fails too, so the screen has to sit in
    // the unresolved state and offer a way out.
    await page.route('**/api/settings/public-page/reconcile', async (route) => {
      fenceAttempts += 1;
      if (fenceAttempts === 1) return route.abort('connectionfailed');
      return route.fallback();
    });

    await page.goto('/admin/settings');
    const s = section(page);
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    await s.toggle.click();

    await expect(s.status).toHaveText(COPY.unresolved, { timeout: 60_000 });
    expect(await writesAreBlocked(page)).toBe(true);
    await expect(s.checkAgain).toBeVisible();
    await expect(s.reload).toBeVisible();
    await expect(page.getByText(COPY.saved)).toHaveCount(0);

    // "Check again" re-uses the ORIGINAL expected revision.
    await s.checkAgain.click();

    await expect(s.notice).toHaveText(COPY.notApplied, { timeout: 60_000 });
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false');

    const after = await stored(request);
    expect(after.profile).toBeNull();
    // Still exactly one increment across the whole episode: the fence that won.
    expect(after.revision).toBe(start.revision + 1);
  });

  test('an ordinary save still saves, and an ordinary conflict is not ambiguity', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const start = await stored(request);

    await page.goto('/admin/settings');
    const s = section(page);
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    // Enable: normal path, normal copy, live link.
    await s.toggle.click();
    await expect(page.getByText(COPY.saved)).toBeVisible({ timeout: 20_000 });
    await expect(s.toggle).toHaveAttribute('aria-checked', 'true');
    await expect(s.viewLink).toBeVisible();
    expect((await stored(request)).revision).toBe(start.revision + 1);

    // Disable: the mirror direction, same guarantees.
    await s.toggle.click();
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });
    await expect(s.viewLink).toHaveCount(0);
    const afterDisable = await stored(request);
    expect(afterDisable.profile).toMatchObject({ enabled: false });
    expect(afterDisable.revision).toBe(start.revision + 2);

    // Someone else writes behind this tab's back: the next save must lose and
    // adopt, not overwrite.
    const outside = await request.put(`${API}/v2/me/profile`, {
      data: {
        profile: { version: 1, enabled: true, headline: 'from another tab' },
        expectedRevision: afterDisable.revision,
      },
    });
    expect(outside.ok()).toBeTruthy();

    await s.toggle.click();
    await expect(s.toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
    const afterConflict = await stored(request);
    expect(afterConflict.profile).toMatchObject({ enabled: true });
    // The refused save burned nothing: only the outside write advanced it.
    expect(afterConflict.revision).toBe(afterDisable.revision + 1);
  });
});

test.describe('public page: settling without claiming authorship', () => {
  test.beforeEach(async ({ request }) => {
    await resetProfile(request);
  });

  for (const locale of ['en', 'es'] as const) {
    test(`a revision that advanced without changing the page gets its own copy (${locale})`, async ({
      page,
      request,
      context,
    }) => {
      test.setTimeout(120_000);
      const copy = locale === 'en' ? COPY : COPY_ES;
      const label = locale === 'en' ? 'Published' : 'Publicada';
      const baseline = { enabled: false, headline: 'Baseline' };
      const start = await writeProfile(request, baseline);
      if (locale === 'es') {
        await context.addCookies([
          { name: 'quill_locale', value: 'es', url: 'http://localhost:3400' },
        ]);
      }

      // The save never reaches the server, and the first reconciliation cannot
      // reach it either — which parks the screen where we can stage the no-op.
      let dropped = false;
      let fenceAttempts = 0;
      await page.route('**/admin/settings**', async (route) => {
        const r = route.request();
        if (dropped || !isAction(r.method(), r.headers())) return route.fallback();
        dropped = true;
        return route.abort('connectionfailed');
      });
      await page.route('**/api/settings/public-page/reconcile', async (route) => {
        fenceAttempts += 1;
        return fenceAttempts === 1 ? route.abort('connectionfailed') : route.fallback();
      });

      await page.goto('/admin/settings');
      const s = section(page);
      const toggle = page.getByTestId('public-page-settings').getByRole('switch', { name: label });
      await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

      await toggle.click();
      await expect(s.status).toHaveText(copy.unresolved, { timeout: 60_000 });

      // Something advances the revision without touching content — another tab
      // fencing its own ambiguous save, for instance.
      await fenceFromOutside(request, start);

      // The retry uses the ORIGINAL expectation, so it now conflicts against a
      // page that is byte-for-byte the one it started from.
      await s.checkAgain.click();

      await expect(s.notice).toHaveText(copy.noOp, { timeout: 60_000 });
      // Not "changed elsewhere" (nothing changed) and certainly not "Saved".
      await expect(page.getByText(copy.changedElsewhere)).toHaveCount(0);
      await expect(page.getByText(copy.saved)).toHaveCount(0);

      const after = await stored(request);
      expect(after.profile).toMatchObject(baseline);
      expect(after.revision).toBe(start + 1);
    });
  }

  test('a conflict adopts the stored page but never eats the draft being typed', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const start = await writeProfile(request, {
      enabled: false,
      headline: 'Stored headline',
      links: [{ label: 'Kept', url: 'https://kept.example' }],
    });

    await page.goto('/admin/settings');
    const s = section(page);
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    // Unsaved work in progress.
    await s.headline.fill('Draft in progress');

    // Meanwhile, somewhere else, the page is published and its links change.
    await request.put(`${API}/v2/me/profile`, {
      data: {
        profile: {
          version: 1,
          enabled: true,
          headline: 'Outside headline',
          links: [{ label: 'Outside', url: 'https://outside.example' }],
        },
        expectedRevision: start,
      },
    });

    await s.saveButton.click();

    // Authoritative state is adopted: published, live link, and the fields this
    // screen only carries.
    await expect(s.notice).toHaveText(COPY.changedElsewhere, { timeout: 30_000 });
    await expect(s.toggle).toHaveAttribute('aria-checked', 'true');
    await expect(s.viewLink).toBeVisible();
    // The draft is still exactly where the member left it.
    await expect(s.headline).toHaveValue('Draft in progress');

    // Saving again keeps the adopted links and finally stores the draft.
    await s.saveButton.click();
    await expect(page.getByText(COPY.saved)).toBeVisible({ timeout: 30_000 });

    const after = await stored(request);
    expect(after.profile).toMatchObject({ enabled: true, headline: 'Draft in progress' });
    expect(after.profile?.links).toEqual([{ label: 'Outside', url: 'https://outside.example' }]);
    expect(after.revision).toBe(start + 2);
  });

  test('after reconciling, the next save uses the reconciled revision, not the stale one', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const start = (await stored(request)).revision;

    let dropped = false;
    await page.route('**/admin/settings**', async (route) => {
      const r = route.request();
      if (dropped || !isAction(r.method(), r.headers())) return route.fallback();
      dropped = true;
      return route.abort('connectionfailed');
    });

    await page.goto('/admin/settings');
    const s = section(page);
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    await s.toggle.click();
    await expect(s.notice).toHaveText(COPY.notApplied, { timeout: 60_000 });
    const fenced = await stored(request);
    expect(fenced.revision).toBe(start + 1);

    // The reconciliation revalidated on the server and refreshed the client. If
    // any of that had put the stale initial revision back, this save would come
    // back 409 "changed somewhere else" and store nothing.
    await s.toggle.click();
    await expect(page.getByText(COPY.saved)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(COPY.changedElsewhere)).toHaveCount(0);
    await expect(s.toggle).toHaveAttribute('aria-checked', 'true');

    const saved = await stored(request);
    expect(saved.profile).toMatchObject({ enabled: true });
    expect(saved.revision).toBe(fenced.revision + 1);

    // A real remount agrees with the server, and can still write.
    await page.reload();
    await expect(s.toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
    await s.toggle.click();
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
    expect((await stored(request)).revision).toBe(saved.revision + 1);
  });
});

test.describe('public page: reconciling behind a proxy', () => {
  test.beforeEach(async ({ request }) => {
    await resetProfile(request);
  });

  /**
   * The route decides same-origin against the host this deployment ANSWERS on,
   * which behind a proxy is `X-Forwarded-Host`, not the internal `Host`. That
   * cuts both ways, and the browser can only prove the strict half: a forwarded
   * host that disagrees with the caller's Origin must be refused, which leaves
   * the screen unresolved with its way out still on offer.
   *
   * A raw-`Host` implementation ignores the forwarded header, accepts this call
   * and settles — so this run fails against it. The accepting direction (public
   * Origin, internal Host, matching X-Forwarded-Host) cannot be staged from a
   * browser, because Chromium will not let a test forge `Host`; it is asserted
   * directly against the route in
   * `apps/web/app/api/settings/public-page/reconcile/route.spec.ts`.
   */
  test('refuses a reconciliation whose forwarded host is not ours, and stays unresolved', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const start = (await stored(request)).revision;

    let dropped = false;
    await page.route('**/admin/settings**', async (route) => {
      const r = route.request();
      if (dropped || !isAction(r.method(), r.headers())) return route.fallback();
      dropped = true;
      return route.abort('connectionfailed');
    });
    await page.route('**/api/settings/public-page/reconcile', async (route) =>
      route.continue({
        headers: { ...route.request().headers(), 'x-forwarded-host': 'proxy.invalid' },
      }),
    );

    await page.goto('/admin/settings');
    const s = section(page);
    await expect(s.toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    await s.toggle.click();

    // Refused, so nothing was decided: still blocked, still offering a way out.
    await expect(s.status).toHaveText(COPY.unresolved, { timeout: 60_000 });
    await expect(s.checkAgain).toBeVisible();
    await expect(s.reload).toBeVisible();
    expect(await writesAreBlocked(page)).toBe(true);
    await expect(page.getByText(COPY.saved)).toHaveCount(0);
    await expect(page.getByText(COPY.notApplied)).toHaveCount(0);
    // A refused reconciliation fences nothing.
    expect((await stored(request)).revision).toBe(start);
  });
});
