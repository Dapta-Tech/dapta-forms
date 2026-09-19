import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Publish waits for the pending autosave (GF-26, point 2).
 *
 * The publish API copies the draft the SERVER holds. Before this, the editor
 * called it as soon as the button was clicked, so an edit still inside the
 * autosave debounce (typed a redirect, pressed Publish in the same gesture)
 * was left out of the live config and landed as a fresh draft right after:
 * "published", with the badge back on and the redirect not live.
 *
 * Two fixes under test, both on the Design tab's redirect field:
 *   - the redirect commits as it is typed (no blur needed), like the headline;
 *   - Publish flushes the autosave and waits for it before calling the API.
 * Plus: when that flush fails, nothing is published and the person is told.
 */

const API = "http://localhost:4400";
const REDIRECT_TYPED = "tbreakthrough.com/gracias";
const REDIRECT_STORED = "https://tbreakthrough.com/gracias";

type Ending = { redirectUrl?: string | null; headline?: string | null };
type FormRow = {
  config: { ending?: Ending };
  draftConfig: { ending?: Ending } | null;
  publishedAt: number | null;
};

async function createForm(request: APIRequestContext, name: string) {
  const res = await request.post(`${API}/v1/forms`, {
    data: {
      name,
      config: {
        version: 1,
        cover: { enabled: false },
        steps: [{ key: "q1", type: "email", question: "Work email?" }],
      },
    },
  });
  expect(res.status(), "POST /v1/forms should create the form").toBe(201);
  return (await res.json()) as { id: string };
}

async function getForm(
  request: APIRequestContext,
  id: string,
): Promise<FormRow> {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as FormRow;
}

const publishBtn = (page: Page) =>
  page.getByRole("button", { name: "Publish", exact: true });
const status = (page: Page) => page.getByTestId("editor-save-status");

/** Open the editor on the Design tab, with ONE save already landed so the
 *  Publish button is armed (as it was for the person in the ticket, who had
 *  saved the headline and body before typing the URL). */
async function openDesignArmed(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(publishBtn(page)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("editor-tab-design").click();
  await page.getByTestId("ending-headline").fill("Thanks, you are on the list");
  await expect(page.getByText("Unpublished changes")).toBeVisible({
    timeout: 15_000,
  });
  await expect(status(page)).toHaveAttribute("data-status", "saved", {
    timeout: 15_000,
  });
}

test("the redirect reaches the draft as it is typed, without leaving the field", async ({
  page,
  request,
}) => {
  const form = await createForm(request, `qa-pubwait-typed-${Date.now()}`);
  await openDesignArmed(page, form.id);

  const redirect = page.getByTestId("ending-redirect");
  await redirect.fill(REDIRECT_TYPED);
  // Focus stays in the field: no blur, no Enter.
  await expect(redirect).toBeFocused();
  await expect
    .poll(
      async () =>
        (await getForm(request, form.id)).draftConfig?.ending?.redirectUrl ??
        null,
      {
        timeout: 15_000,
      },
    )
    .toBe(REDIRECT_STORED);
  // The visible text is still what was typed; the https:// prefix only shows on blur.
  await expect(redirect).toHaveValue(REDIRECT_TYPED);
  await redirect.blur();
  await expect(redirect).toHaveValue(REDIRECT_STORED);
});

test("typing the redirect and pressing Publish in one gesture publishes it", async ({
  page,
  request,
}) => {
  const form = await createForm(request, `qa-pubwait-gesture-${Date.now()}`);
  await openDesignArmed(page, form.id);

  await page.getByTestId("ending-redirect").fill(REDIRECT_TYPED);
  // Straight to Publish: the autosave debounce (~0.9s) has not fired yet.
  await publishBtn(page).click();
  await expect(page.getByText(/Changes published/)).toBeVisible({
    timeout: 15_000,
  });

  const after = await getForm(request, form.id);
  expect(after.publishedAt).not.toBeNull();
  expect(after.config.ending?.redirectUrl).toBe(REDIRECT_STORED);
  // No draft left behind: what was published is exactly what was on screen.
  expect(after.draftConfig).toBeNull();
  await expect(page.getByText("Unpublished changes")).toHaveCount(0);
  await expect(publishBtn(page)).toBeDisabled();
});

test("when the pending save cannot land, nothing is published and the button says why", async ({
  page,
  request,
}) => {
  const form = await createForm(request, `qa-pubwait-fail-${Date.now()}`);
  await openDesignArmed(page, form.id);

  // Cut the server actions (POSTs to the page URL, `?tab=design` included,
  // carrying `next-action`): the flush the publish triggers cannot reach the
  // server.
  const EDIT_URL = /\/admin\/forms\/[^/]+\/edit(\?|$)/;
  await page.route(EDIT_URL, (route) =>
    route.request().method() === "POST" &&
    route.request().headers()["next-action"]
      ? route.abort("connectionfailed")
      : route.continue(),
  );
  await page.getByTestId("ending-redirect").fill(REDIRECT_TYPED);
  await publishBtn(page).click();
  await expect(
    page.getByText(/could not be saved, so nothing was published/),
  ).toBeVisible({
    timeout: 30_000,
  });
  expect((await getForm(request, form.id)).publishedAt).toBeNull();
  await expect(publishBtn(page)).toBeEnabled();

  // Back online: the autosave's own retry lands the URL, and Publish now works.
  await page.unroute(EDIT_URL);
  await expect(status(page)).toHaveAttribute("data-status", "saved", {
    timeout: 40_000,
  });
  await publishBtn(page).click();
  await expect(page.getByText(/Changes published/)).toBeVisible({
    timeout: 15_000,
  });
  expect((await getForm(request, form.id)).config.ending?.redirectUrl).toBe(
    REDIRECT_STORED,
  );
});
