import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The Publish pill follows the form DRAFT's save, and says why when it cannot
 * be pressed.
 *
 * Integrations are saved straight to the live form; they are never part of the
 * draft that Publish publishes. The pill once read the top bar's COMBINED save
 * state, so a webhook switched on with no URL (a standing `partial`) left it on
 * a blocked "Publish" right after a publish that had gone through. The unit
 * spec pins the pill; this pins the wiring in the real editor.
 */

const API = 'http://localhost:4400';

async function createForm(request: APIRequestContext, name: string, steps: unknown[]) {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, config: { version: 1, cover: { enabled: false }, steps } },
  });
  expect(res.status(), 'POST /v1/forms should create the form').toBe(201);
  return (await res.json()) as { id: string };
}

const QUESTION = [{ key: 'q1', type: 'email', question: 'Work email?' }];
// By test id, never by name: the name is what is under test.
const pill = (page: Page) => page.getByTestId('publish-control');
const publishBtn = (page: Page) => page.getByTestId('publish-button');
const topBar = (page: Page) => page.getByTestId('editor-save-status');

test('a webhook with no URL does not hold the pill: publish, then it reads Published', async ({
  page,
  request,
}) => {
  const form = await createForm(request, `qa-pill-webhook-${Date.now()}`, QUESTION);
  await page.goto(`/admin/forms/${form.id}/edit?tab=connect`);

  // Switch the webhook on and leave its URL empty: the integrations save is
  // `partial` for as long as that card stays like this.
  const webhook = page.getByRole('switch', { name: 'Webhook', exact: true });
  await expect(webhook).toBeVisible({ timeout: 20_000 });
  await webhook.click();
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'partial', {
    timeout: 15_000,
  });
  await expect(topBar(page)).toHaveAttribute('data-status', 'partial');
  // Nothing in the draft changed, so the pill is not held even now.
  await expect(pill(page)).toHaveAttribute('data-state', 'idle');

  // A real draft edit, then publish.
  await page.getByTestId('editor-tab-design').click();
  await page.getByTestId('ending-headline').fill('Thanks, you are on the list');
  await expect(pill(page)).toHaveAttribute('data-state', 'pending', { timeout: 15_000 });
  await publishBtn(page).click();
  await expect(page.getByText(/Changes published/)).toBeVisible({ timeout: 15_000 });

  // The publish went through, and the pill says so, while the top bar goes on
  // reporting the webhook card.
  await expect(pill(page)).toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Published', exact: true })).toHaveCount(1);
  await expect(topBar(page)).toHaveAttribute('data-status', 'partial');
  const stored = (await (await request.get(`${API}/v1/forms/${form.id}`)).json()) as {
    publishedAt: number | null;
    draftConfig: unknown;
  };
  expect(stored.publishedAt).toEqual(expect.any(Number));
  expect(stored.draftConfig).toBeNull();
});

test('a blocked Publish is focusable and says why', async ({ page, request }) => {
  const form = await createForm(request, `qa-pill-empty-${Date.now()}`, []);
  await page.goto(`/admin/forms/${form.id}/edit`);
  await expect(pill(page)).toBeVisible({ timeout: 20_000 });
  await expect(pill(page)).toHaveAttribute('data-state', 'empty');

  const button = publishBtn(page);
  await expect(button).toHaveAccessibleName('Publish');
  await expect(button).toHaveAccessibleDescription('Add a question first. Then you can publish.');
  // `aria-disabled`, not `disabled`: it has to stay in the tab order.
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).not.toHaveAttribute('disabled', /.*/);
  await button.focus();
  await expect(button).toBeFocused();

  // Hovering shows the reason; pressing it publishes nothing.
  await button.hover();
  await expect(page.getByTestId('publish-reason')).toHaveAttribute('data-open', 'true');
  await button.click({ force: true });
  const stored = (await (await request.get(`${API}/v1/forms/${form.id}`)).json()) as {
    publishedAt: number | null;
  };
  expect(stored.publishedAt).toBeNull();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 320, height: 700 }, hasTouch: true });

  test('the reason opened by a tap covers no tool, takes no taps, and goes away', async ({ page, request }) => {
    const form = await createForm(request, `qa-pill-phone-${Date.now()}`, []);
    await page.goto(`/admin/forms/${form.id}/edit`);
    // Visible first: while the page streams in, the pill is in the DOM (so its
    // attributes read) inside a hidden boundary, with no box to tap.
    await expect(pill(page)).toBeVisible({ timeout: 20_000 });
    await expect(pill(page)).toHaveAttribute('data-state', 'empty');
    const reason = page.getByTestId('publish-reason');
    // A real touch at the button's centre: `tap()` refuses an aria-disabled target.
    const tapPublish = async () => {
      const box = (await publishBtn(page).boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };

    await tapPublish();
    await expect(reason).toHaveAttribute('data-opened-by', 'press');
    const geometry = await page.evaluate(() => {
      const tip = document.querySelector('[data-testid="publish-reason"]')!;
      const t = tip.getBoundingClientRect();
      const bar = document.querySelector('[data-testid="editor-header"]')!;
      const control = document.querySelector('[data-testid="publish-control"]')!;
      const covered = [...bar.querySelectorAll('button, a, input')]
        .filter((el) => !control.contains(el))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && !(r.right <= t.left || r.left >= t.right || r.bottom <= t.top || r.top >= t.bottom));
      return {
        left: t.left,
        right: t.right,
        top: t.top,
        barBottom: bar.getBoundingClientRect().bottom,
        covered: covered.length,
        pointerEvents: getComputedStyle(tip).pointerEvents,
      };
    });
    // The top bar is two rows here; the reason hangs under both, inside the screen.
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.barBottom);
    expect(geometry.covered).toBe(0);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(320);
    expect(geometry.pointerEvents).toBe('none');

    // A tool takes the tap while the reason is up, and that tap puts it away.
    await page.getByTestId('toolbar-preview').tap();
    await expect(page.getByTestId('preview-viewport')).toBeVisible();
    await expect(reason).not.toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Escape');

    // Left alone, it goes by itself.
    await tapPublish();
    await expect(reason).toHaveAttribute('data-open', 'true');
    await expect(reason).not.toHaveAttribute('data-open', 'true', { timeout: 6_000 });
  });
});
