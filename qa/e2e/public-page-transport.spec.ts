import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * The public page switch under a TRANSPORT failure — the one state a unit test
 * in node cannot reach, because it needs a real click, a real server action and
 * a request that is still in flight when the client stops waiting.
 *
 * `callAction` gives up after 15s, but the timeout does NOT abort the PUT: the
 * write lands, and the browser never hears about it. Anything the screen shows
 * from that moment is a guess. The screen used to keep showing the value it had
 * before the save and let you save again from it, so the switch (and the "View
 * page" link) could disagree with the stored profile until a reload, and the
 * next save would resubmit the stale value over the newer stored one.
 *
 * The run below holds the action response past that 15s deadline while letting
 * the write reach the API, then checks what the screen does with the gap:
 * writes stay blocked while nothing is known, the profile is reread, and the
 * switch and the link settle on what the server actually stores.
 */

const API = 'http://localhost:4400';

/** Longer than `callAction`'s 15s ceiling, so the client gives up first. */
const HOLD_MS = 22_000;

/** The stored profile, straight from the API — the truth the UI must match. */
async function storedProfile(request: APIRequestContext): Promise<{ enabled?: boolean } | null> {
  const res = await request.get(`${API}/v1/me/profile`);
  expect(res.ok(), `profile read failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { profile: { enabled?: boolean } | null }).profile;
}

test.describe('public page: a save the client never hears back about', () => {
  test.beforeEach(async ({ request }) => {
    // Start from "no public page" so the run is idempotent and the click below
    // is an ENABLE: prior value off, requested value on.
    const res = await request.put(`${API}/v1/me/profile`, { data: { profile: null } });
    expect(res.ok(), `profile reset failed: ${res.status()}`).toBeTruthy();
  });

  test('blocks writes, rereads, and settles on the stored profile', async ({ page, request }) => {
    test.setTimeout(180_000);

    // Every server action this tab sends, counted: the save, and then whatever
    // the screen does to find out what actually happened.
    let actionPosts = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.headers()['next-action']) actionPosts += 1;
    });

    // Hold the FIRST action response past the client's deadline. The request is
    // forwarded first, so the write really does land server-side — this is a
    // client that stopped listening, not a write that never happened.
    let held = false;
    await page.route('**/admin/settings**', async (route) => {
      const req = route.request();
      if (held || req.method() !== 'POST' || !req.headers()['next-action']) return route.fallback();
      held = true;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      await route.fulfill({ response });
    });

    await page.goto('/admin/settings');
    const section = page.getByTestId('public-page-settings');
    const toggle = section.getByRole('switch', { name: 'Published' });
    const viewLink = section.getByRole('link', { name: 'View page' });
    // The section's only plain button is the save control. Located by role, not
    // by label, because its label changes while a save is unresolved.
    const saveButton = section.getByRole('button');

    // Nothing published yet: switch off, no link to a page that would 404.
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });
    await expect(viewLink).toHaveCount(0);

    await toggle.click();

    // Past the 15s ceiling: the client has given up, the write is landing (or
    // has landed) anyway, and the screen knows nothing about the stored state.
    await page.waitForTimeout(17_000);

    // While nothing is known, no profile write may leave this screen — neither
    // from the toggle nor from the Save button — because any payload built here
    // would carry the pre-save value over whatever the server now stores.
    const toggleIsWritable = (await toggle.count()) > 0 && (await toggle.isEnabled());
    expect(toggleIsWritable, 'the toggle stayed writable while the stored state was unknown').toBe(
      false,
    );
    await expect(saveButton).toBeDisabled();

    // A click attempted in that window must not reach the server. Bounded, so
    // it fails while the write is blocked instead of queueing until the screen
    // settles and then landing a save of its own.
    await toggle.click({ force: true, timeout: 1_500 }).catch(() => undefined);

    // The screen has to go and ask, and then show the answer: the save landed,
    // so the page is published and the link to it is offered.
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 60_000 });
    await expect(viewLink).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // It asked: the save plus at least one reread. The value alone would not
    // prove that — only a reread can tell this tab what the server stores.
    expect(actionPosts, 'no reread followed the transport failure').toBeGreaterThanOrEqual(2);

    // And nothing stale was written back on top of it.
    expect(await storedProfile(request)).toMatchObject({ enabled: true });
  });
});
