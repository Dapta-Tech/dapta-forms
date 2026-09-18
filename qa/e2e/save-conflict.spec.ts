import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * Two editors on one form (GF-26, point 1). Before the optimistic lock this was
 * last-writer-wins with no warning: each autosave sent its whole snapshot, so
 * whichever landed last silently discarded the other's edits.
 *
 *   (a) Only the stamp moved (a write elsewhere with the SAME content, e.g. the
 *       editor's own slug rename or a CRM mapping save) → the next save adopts
 *       the new stamp and lands, no banner.
 *   (b) Real conflict: B saves a change, then A saves → A is refused, sees the
 *       conflict banner, and B's change is what the server keeps.
 *   (c) "Keep mine" from that banner → A's version overwrites, on purpose.
 *   (d) "See saved version" → reload, and A's unsaved edit comes back through
 *       the crash-recovery banner instead of being lost.
 */

const API = "http://localhost:4400";
const RUN = randomUUID().slice(0, 8);

async function createForm(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const res = await request.post(`${API}/v1/forms`, {
    data: {
      name,
      config: {
        version: 1,
        steps: [
          {
            key: "email",
            type: "email",
            question: "Your email?",
            required: true,
          },
        ],
      },
    },
  });
  expect(res.ok(), `POST /v1/forms → ${res.status()}`).toBeTruthy();
  return (await res.json()).id as string;
}

async function serverName(
  request: APIRequestContext,
  id: string,
): Promise<string> {
  const res = await request.get(`${API}/v1/forms/${id}`);
  return (await res.json()).name as string;
}

/** A second, fully independent browser session on the same editor. */
async function openEditor(browser: Browser, id: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByTestId("editor-save-status")).toHaveAttribute(
    "data-status",
    "saved",
  );
  return page;
}

const nameInput = (page: Page) => page.locator("header input").first();
const status = (page: Page) => page.getByTestId("editor-save-status");
const banner = (page: Page) => page.getByTestId("save-conflict-banner");

async function rename(page: Page, name: string) {
  await nameInput(page).fill(name);
}

test("(a) a write elsewhere with the same content only moves the stamp: the next save lands silently", async ({
  page,
  request,
}) => {
  const id = await createForm(request, `conflict-a-${RUN}`);
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(status(page)).toHaveAttribute("data-status", "saved");

  // Same content, new stamp (what a slug rename or a mapping save does).
  await new Promise((r) => setTimeout(r, 5));
  const bump = await request.put(`${API}/v1/forms/${id}`, {
    data: { name: `conflict-a-${RUN}` },
  });
  expect(bump.ok()).toBeTruthy();

  await rename(page, `conflict-a-${RUN} edited`);
  await expect(status(page)).toHaveAttribute("data-status", "saved");
  await expect(banner(page)).toHaveCount(0);
  await expect
    .poll(() => serverName(request, id))
    .toBe(`conflict-a-${RUN} edited`);
});

test("(b) a real conflict refuses the late save, shows the banner, and keeps the other edit", async ({
  page,
  browser,
  request,
}) => {
  const id = await createForm(request, `conflict-b-${RUN}`);
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(status(page)).toHaveAttribute("data-status", "saved");
  const other = await openEditor(browser, id);

  await rename(other, "From B");
  await expect(status(other)).toHaveAttribute("data-status", "saved");
  await expect.poll(() => serverName(request, id)).toBe("From B");

  await rename(page, "From A");
  await expect(status(page)).toHaveAttribute("data-status", "conflict");
  await expect(banner(page)).toBeVisible();
  // Nothing of A's reached the server; B's edit is what the row holds.
  expect(await serverName(request, id)).toBe("From B");
  await other.context().close();
});

test('(c) "Keep mine" takes the newer stamp and overwrites on purpose', async ({
  page,
  browser,
  request,
}) => {
  const id = await createForm(request, `conflict-c-${RUN}`);
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(status(page)).toHaveAttribute("data-status", "saved");
  const other = await openEditor(browser, id);
  await rename(other, "From B");
  await expect(status(other)).toHaveAttribute("data-status", "saved");
  await other.context().close();

  await rename(page, "From A");
  await expect(banner(page)).toBeVisible();
  await banner(page).getByRole("button").nth(1).click(); // Keep mine
  await expect(status(page)).toHaveAttribute("data-status", "saved");
  await expect(banner(page)).toHaveCount(0);
  await expect.poll(() => serverName(request, id)).toBe("From A");
});

test('(d) "See saved version" reloads onto the other edit and offers mine back through recovery', async ({
  page,
  browser,
  request,
}) => {
  const id = await createForm(request, `conflict-d-${RUN}`);
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(status(page)).toHaveAttribute("data-status", "saved");
  const other = await openEditor(browser, id);
  await rename(other, "From B");
  await expect(status(other)).toHaveAttribute("data-status", "saved");
  await other.context().close();

  await rename(page, "From A");
  await expect(banner(page)).toBeVisible();
  await banner(page).getByRole("button").nth(0).click(); // See saved version
  await page.waitForLoadState("load");
  await expect(nameInput(page)).toHaveValue("From B");
  await expect(page.getByTestId("draft-recovery-banner")).toBeVisible();
  expect(await serverName(request, id)).toBe("From B");
});
