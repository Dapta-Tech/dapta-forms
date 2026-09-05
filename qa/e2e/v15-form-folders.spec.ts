import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Folders + keyboard search on the forms list (V15).
 *
 * Seeded through the API (folders and forms alike) so the assertions are
 * about the list, not about the create dialog. Names carry a random tag: the
 * QA database survives between runs and folder names are unique per
 * workspace without regard to case, so a fixed name would 409 on the second
 * run. Every test cleans up its own folder and forms.
 */

const API = "http://localhost:4400";

function tag() {
  return randomUUID().slice(0, 8);
}

async function createFolder(request: APIRequestContext, name: string) {
  const res = await request.post(`${API}/v1/folders`, { data: { name } });
  expect(res.status(), "POST /v1/folders should create the folder").toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createForm(
  request: APIRequestContext,
  name: string,
  folderId?: string,
) {
  const res = await request.post(`${API}/v1/forms`, {
    data: {
      name,
      config: { version: 1, steps: [] },
      ...(folderId ? { folderId } : {}),
    },
  });
  expect(res.status(), "POST /v1/forms should create the form").toBe(201);
  return (await res.json()) as {
    id: string;
    slug: string;
    folderId: string | null;
  };
}

async function folderOf(
  request: APIRequestContext,
  formId: string,
): Promise<string | null> {
  const res = await request.get(`${API}/v1/forms`);
  const rows = (await res.json()) as Array<{
    id: string;
    folderId: string | null;
  }>;
  return rows.find((r) => r.id === formId)?.folderId ?? null;
}

async function cleanup(
  request: APIRequestContext,
  ids: { forms: string[]; folders: string[] },
) {
  for (const id of ids.forms) await request.delete(`${API}/v1/forms/${id}`);
  for (const id of ids.folders) await request.delete(`${API}/v1/folders/${id}`);
}

function section(page: Page, folderId: string) {
  return page.locator(
    `[data-testid="folder-section"][data-folder-id="${folderId}"]`,
  );
}

test.describe("forms list: folders and search", () => {
  test("sections: Unfiled first, folders alphabetically, counts, and the fold survives a reload", async ({
    page,
    request,
  }) => {
    const t = tag();
    const beta = await createFolder(request, `qa-${t}-Beta`);
    const alpha = await createFolder(request, `qa-${t}-alpha`);
    const inBeta = await createForm(request, `qa-${t}-in-beta`, beta.id);
    const loose = await createForm(request, `qa-${t}-loose`);
    try {
      await page.goto("/admin/forms");
      const unfiled = page.getByTestId("unfiled-section");
      await expect(unfiled).toBeVisible();
      // Unfiled comes first in DOM order, then the folders alphabetically (case-insensitive).
      const order = await page
        .locator(
          '[data-testid="unfiled-section"], [data-testid="folder-section"]',
        )
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-folder-id")),
        );
      expect(order[0]).toBe("");
      expect(order.indexOf(alpha.id)).toBeLessThan(order.indexOf(beta.id));
      await expect(
        section(page, beta.id).getByTestId("folder-count"),
      ).toHaveText(/1 form/);
      await expect(
        section(page, beta.id).locator(`[data-form-id="${inBeta.id}"]`),
      ).toBeVisible();
      await expect(
        unfiled.locator(`[data-form-id="${loose.id}"]`),
      ).toBeVisible();

      // Collapse Beta, reload: still collapsed (per-browser memory).
      await section(page, beta.id).getByTestId("folder-toggle").click();
      await expect(
        section(page, beta.id).getByTestId("folder-toggle"),
      ).toHaveAttribute("aria-expanded", "false");
      await page.reload();
      await expect(
        section(page, beta.id).getByTestId("folder-toggle"),
      ).toHaveAttribute("aria-expanded", "false");
      await expect(
        section(page, beta.id).locator(`[data-form-id="${inBeta.id}"]`),
      ).toBeHidden();
    } finally {
      await cleanup(request, {
        forms: [inBeta.id, loose.id],
        folders: [alpha.id, beta.id],
      });
    }
  });

  test("search: Ctrl+K focuses, matches without accents, highlights, hides empty sections, Escape clears", async ({
    page,
    request,
  }) => {
    const t = tag();
    const folder = await createFolder(request, `qa-${t}-Ventas`);
    const hit = await createForm(request, `qa-${t}-Satisfacción`, folder.id);
    const miss = await createForm(request, `qa-${t}-Other`);
    try {
      await page.goto("/admin/forms");
      await page.keyboard.press("Control+K");
      await expect(page.getByTestId("forms-search")).toBeFocused();
      await page.keyboard.type("satisfaccion");
      await expect(page.locator(`[data-form-id="${hit.id}"] mark`)).toHaveText(
        "Satisfacción",
      );
      await expect(page.locator(`[data-form-id="${miss.id}"]`)).toHaveCount(0);
      await expect(
        section(page, folder.id).getByTestId("folder-toggle"),
      ).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("forms-search")).toHaveValue("");
      await expect(page.locator(`[data-form-id="${miss.id}"]`)).toBeVisible();
      // Arrow down from the box lands on the first row title; Enter opens the editor.
      await page.getByTestId("forms-search").focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.locator("[data-form-link]").first()).toBeFocused();
    } finally {
      await cleanup(request, {
        forms: [hit.id, miss.id],
        folders: [folder.id],
      });
    }
  });

  test('move: kebab "Move to folder", drag by the grip, and deleting a folder keeps its forms', async ({
    page,
    request,
  }) => {
    const t = tag();
    const folder = await createFolder(request, `qa-${t}-Sales`);
    const form = await createForm(request, `qa-${t}-mover`);
    try {
      await page.goto("/admin/forms");
      const row = page.locator(`[data-form-id="${form.id}"]`);
      await row.getByTestId("form-row-menu").click();
      await page.getByTestId(`form-row-move-${folder.id}`).click();
      await expect(
        section(page, folder.id).locator(`[data-form-id="${form.id}"]`),
      ).toBeVisible();
      await expect.poll(() => folderOf(request, form.id)).toBe(folder.id);

      // Drag it back to Unfiled by the grip (pointer sensor needs > 6px of travel).
      const grip = section(page, folder.id)
        .locator(`[data-form-id="${form.id}"]`)
        .getByTestId("form-row-grip");
      const target = page
        .getByTestId("unfiled-section")
        .getByTestId("folder-toggle");
      const from = (await grip.boundingBox())!;
      const to = (await target.boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        from.x + from.width / 2 + 12,
        from.y + from.height / 2 + 12,
        { steps: 4 },
      );
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
        steps: 12,
      });
      await page.mouse.up();
      await expect(
        page
          .getByTestId("unfiled-section")
          .locator(`[data-form-id="${form.id}"]`),
      ).toBeVisible();
      await expect.poll(() => folderOf(request, form.id)).toBeNull();

      // Back into the folder, then delete the folder: the form survives, unfiled.
      await row.getByTestId("form-row-menu").click();
      await page.getByTestId(`form-row-move-${folder.id}`).click();
      await expect.poll(() => folderOf(request, form.id)).toBe(folder.id);
      await section(page, folder.id).getByTestId("folder-menu").click();
      await page.getByTestId("folder-delete").click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /delete folder|eliminar carpeta/i })
        .click();
      await expect(section(page, folder.id)).toHaveCount(0);
      await expect(
        page
          .getByTestId("unfiled-section")
          .locator(`[data-form-id="${form.id}"]`),
      ).toBeVisible();
      await expect.poll(() => folderOf(request, form.id)).toBeNull();
    } finally {
      await cleanup(request, { forms: [form.id], folders: [folder.id] });
    }
  });

  test("folder names are unique per workspace without regard to case: the dialog says so inline", async ({
    page,
    request,
  }) => {
    const t = tag();
    const folder = await createFolder(request, `qa-${t}-Marketing`);
    try {
      await page.goto("/admin/forms");
      await page.getByTestId("new-folder").click();
      await page.getByTestId("folder-name-input").fill(`qa-${t}-MARKETING`);
      await page.getByTestId("folder-dialog-submit").click();
      await expect(page.getByTestId("folder-name-error")).toBeVisible();
      // Renaming the folder to its own name in another case is fine.
      await page.keyboard.press("Escape");
      await section(page, folder.id).getByTestId("folder-menu").click();
      await page.getByTestId("folder-rename").click();
      await page.getByTestId("folder-name-input").fill(`qa-${t}-marketing`);
      await page.getByTestId("folder-dialog-submit").click();
      await expect(
        section(page, folder.id).getByTestId("folder-toggle"),
      ).toContainText(`qa-${t}-marketing`);
    } finally {
      await cleanup(request, { forms: [], folders: [folder.id] });
    }
  });
});
