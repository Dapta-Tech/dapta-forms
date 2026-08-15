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
  latestLoaded:
    'Your last save did not complete. Your page changed in the meantime, so the current version is shown.',
  unresolved:
    'We still cannot tell whether your last save was applied. Editing stays off until we know.',
  checkAgain: 'Check again',
  reload: 'Reload',
  saved: 'Public page saved.',
};

interface Stored {
  profile: { enabled?: boolean } | null;
  revision: number;
}

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

const isAction = (method: string, headers: Record<string, string>): boolean =>
  method === 'POST' && Boolean(headers['next-action']);

function section(page: Page) {
  const root = page.getByTestId('public-page-settings');
  return {
    root,
    toggle: root.getByRole('switch', { name: 'Published' }),
    viewLink: root.getByRole('link', { name: 'View page' }),
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
