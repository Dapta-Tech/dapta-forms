import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * The Advanced settings group must stay REACHABLE, at every viewport height.
 *
 * This is a layout regression test, and it exists because the bug it guards
 * against is invisible to every other kind of test. The group carried
 * `overflow-hidden` (to clip its children to the rounded corners). Any
 * `overflow` other than `visible` makes CSS resolve `min-height: auto` to 0,
 * which strips the box's min-content floor — and as a flex child of the
 * settings column, which routinely overflows, the browser compressed the entire
 * group to **2px**, open or closed.
 *
 * Nothing threw. The DOM was correct, every unit test passed, the children were
 * laid out at their full height — silently clipped inside a 2px box, with the
 * column's scrollHeight never growing, so there was nothing to scroll to
 * either. It reached us as "I can expand it, but I cannot scroll to the
 * options, they hide behind the screen."
 *
 * Only a real browser measuring real boxes can catch that, which is why this
 * lives in the Playwright suite rather than beside the component.
 */

/** The QA API. Overridable so this can also be pointed at a dev instance. */
const API = process.env.QA_API_URL ?? 'http://localhost:4400';

async function createForm(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string }> {
  const res = await request.post(`${API}/v1/forms`, {
    data: {
      name,
      config: {
        version: 1,
        steps: [
          {
            // The type the bug was reported on: a choice question carries
            // options AND a Logic section, so its panel is one of the tallest,
            // which is exactly when the group used to be squashed away.
            key: 'role',
            type: 'multiple_choice',
            question: 'What best describes you?',
            required: true,
            options: [
              { label: 'Founder', value: 'founder' },
              { label: 'Team lead', value: 'lead' },
              { label: 'Individual', value: 'individual' },
            ],
          },
        ],
      },
    },
  });
  expect(res.ok(), `POST /v1/forms failed: ${res.status()}`).toBeTruthy();
  return { id: (await res.json()).id };
}

// Short viewports are where a squashed flex child hurts most, so the shortest
// one here is deliberately smaller than any laptop we expect someone to use.
for (const height of [900, 720, 560]) {
  test(`advanced settings expands and every row is reachable at 1440x${height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height });
    const form = await createForm(request, `qa-advanced-reach-${height}-${Date.now()}`);
    await page.goto(`/admin/forms/${form.id}/edit`);

    const advanced = page.locator('[data-testid="advanced-settings"]');
    await expect(advanced).toBeVisible();

    // Collapsed, the header alone must still occupy real height — this is the
    // exact assertion that fails at 2px.
    const collapsed = await advanced.boundingBox();
    expect(collapsed!.height, 'collapsed header has real height').toBeGreaterThan(24);

    await advanced.locator('button').first().click();
    await expect(advanced).toHaveAttribute('data-open', 'true');

    // Expanded, the box must be as tall as what it contains: nothing may be
    // clipped INSIDE it, which is how the content used to disappear.
    const hidden = await advanced.evaluate((el) => {
      const body = el.querySelector(':scope > div');
      if (!body) return -1;
      return Math.max(0, Math.round(body.scrollHeight - el.getBoundingClientRect().height));
    });
    expect(hidden, 'no rows clipped inside the group').toBe(0);

    // And it must be possible to actually get to the last row by scrolling, the
    // way a person would.
    const panel = page.locator('div.flex.h-full.flex-col.gap-5.overflow-y-auto');
    await panel.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const lastRowVisible = await advanced.evaluate((el, vh) => {
      const rows = [...(el.querySelector(':scope > div')?.children ?? [])];
      const last = rows[rows.length - 1];
      if (!last) return false;
      const r = last.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= vh + 1;
    }, height);
    expect(lastRowVisible, 'the last advanced row can be scrolled into view').toBe(true);
  });
}
