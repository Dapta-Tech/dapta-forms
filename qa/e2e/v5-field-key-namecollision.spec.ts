import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V5-V4-12/13 — renaming a field key onto a name step's subfield must be
 * REFUSED VISIBLY, not silently.
 *
 * The engine already refuses it (renameStepKey returns the config untouched when
 * the new key collides with a name step's firstname/lastname answer slot). But
 * the builder's collision list was only the other steps' keys, so the UI thought
 * "firstname" was free: it called rename, the engine no-op'd, and the input kept
 * showing the rejected key with no error — indistinguishable from success.
 *
 * The fix feeds the same reserved set the engine uses (step keys + name
 * subfields) into the editor, so the collision is caught and shown.
 */

const API = 'http://localhost:4400';
const RUN = randomUUID().slice(0, 8);
let seq = 0;

async function createForm(request: APIRequestContext): Promise<{ id: string }> {
  seq += 1;
  const name = `v5fk-${RUN}-w${test.info().workerIndex}-${seq}`;
  const config = {
    version: 1,
    steps: [
      { key: 'who', type: 'name', question: 'Your name' },
      { key: 'src', type: 'text', question: 'Where from?', hidden: true },
    ],
  };
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

/** Keys from the autosaved DRAFT (where builder edits land) or the live config
 *  when no draft is staged. A rename is a builder edit, so it rides the draft. */
async function stepKeys(request: APIRequestContext, id: string): Promise<string[]> {
  const res = await request.get(`${API}/v1/forms/${id}`);
  const f = (await res.json()) as {
    config?: { steps?: { key: string }[] };
    draftConfig?: string | { steps?: { key: string }[] } | null;
  };
  const draft =
    typeof f.draftConfig === 'string'
      ? (JSON.parse(f.draftConfig) as { steps?: { key: string }[] })
      : f.draftConfig;
  const steps = draft?.steps ?? f.config?.steps ?? [];
  return steps.map((s) => s.key);
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

test('renaming a field key onto a name subfield is refused with a visible error', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { id } = await createForm(request);
  await openEditor(page, id);

  // Select the text step so its Field Key editor is shown.
  await page.getByTestId('question-spine').getByRole('button', { name: /Where from\?/ }).click();
  const keyInput = page.getByTestId('step-field-key');
  await expect(keyInput).toBeVisible();
  await expect(keyInput).toHaveValue('src');

  // Try to rename it onto the name step's `firstname` answer slot.
  await keyInput.fill('firstname');
  await keyInput.press('Enter');

  // The collision must surface: error shown, field marked invalid, value reverted.
  await expect(page.getByTestId('step-field-key-taken')).toBeVisible();
  await expect(keyInput).toHaveValue('src');

  // And the stored config is unchanged — the rename never took.
  await expect
    .poll(() => stepKeys(request, id), { timeout: 5_000 })
    .toEqual(['who', 'src']);

  // A legitimate rename still works (guards against over-blocking).
  await keyInput.fill('referrer');
  await keyInput.press('Enter');
  await expect(page.getByTestId('step-field-key-taken')).toHaveCount(0);
  await expect
    .poll(() => stepKeys(request, id), { timeout: 10_000 })
    .toEqual(['who', 'referrer']);
});
