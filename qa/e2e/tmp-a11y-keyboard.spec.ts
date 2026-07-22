import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://localhost:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `a11y-${label}-${RUN}-${seq}`;
}
const cover = (headline: string) => ({ enabled: true, headline, ctaText: 'Start' });

async function createForm(
  request: APIRequestContext,
  name: string,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: { version: 1, ...config } } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, slug: body.slug };
}

async function openEditor(page: Page, id: string, tab?: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit${tab ? `?tab=${tab}` : ''}`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Describe the currently focused element. */
async function active(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { tag: 'none' };
    return {
      tag: el.tagName,
      testid: el.getAttribute('data-testid'),
      label: el.getAttribute('aria-label'),
      text: (el.textContent || '').trim().slice(0, 60),
      type: el.getAttribute('type'),
      value: (el as HTMLInputElement).value?.slice(0, 40),
    };
  });
}

/** Find every element carrying a React onClick handler that is NOT keyboard reachable. */
async function divClickHandlers(page: Page) {
  return page.evaluate(() => {
    const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'OPTION', 'LABEL']);
    const out: { tag: string; testid: string | null; cls: string; text: string; role: string | null }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
      if (!key) continue;
      const props = (el as unknown as Record<string, { onClick?: unknown }>)[key];
      if (!props || typeof props.onClick !== 'function') continue;
      if (NATIVE.has(el.tagName)) continue;
      const ti = el.getAttribute('tabindex');
      if (ti != null && Number(ti) >= 0) continue;
      out.push({
        tag: el.tagName,
        testid: el.getAttribute('data-testid'),
        cls: el.className?.toString().slice(0, 80) ?? '',
        text: (el.textContent || '').trim().slice(0, 50),
        role: el.getAttribute('role'),
      });
    }
    return out;
  });
}

test.describe('V5 a11y / keyboard', () => {
  test.setTimeout(90_000);

  test('HelpTip: keyboard open/close semantics', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('helptip'), {
      cover: cover('HelpTip QA'),
      steps: [{ key: 'phone', type: 'phone', question: 'Your phone?' }],
    });
    await openEditor(page, id);

    const trigger = page.getByTestId('help-tip-trigger').first();
    await expect(trigger).toBeVisible();

    // Reach it purely with the keyboard: focus it and confirm it is a real button.
    await trigger.focus();
    console.log('HELPTIP tag/role', await trigger.evaluate((el) => [el.tagName, el.getAttribute('role'), el.getAttribute('aria-label')]));
    await expect(page.getByTestId('help-tip-bubble')).toBeVisible();
    console.log('HELPTIP after focus: describedby=', await trigger.getAttribute('aria-describedby'), 'expanded=', await trigger.getAttribute('aria-expanded'));

    // The natural keyboard "activate" gesture on a focused control.
    await page.keyboard.press('Enter');
    console.log('HELPTIP after Enter: bubbles=', await page.getByTestId('help-tip-bubble').count(), 'expanded=', await trigger.getAttribute('aria-expanded'));
    await page.keyboard.press('Enter');
    console.log('HELPTIP after 2nd Enter: bubbles=', await page.getByTestId('help-tip-bubble').count());
    await page.keyboard.press('Space');
    console.log('HELPTIP after Space: bubbles=', await page.getByTestId('help-tip-bubble').count());

    // Escape from the focused trigger.
    await trigger.focus();
    await expect(page.getByTestId('help-tip-bubble')).toBeVisible();
    await page.keyboard.press('Escape');
    console.log('HELPTIP after Escape: bubbles=', await page.getByTestId('help-tip-bubble').count(), 'focus=', await active(page));

    // Focus ring visibility when reached by keyboard.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const ring = await trigger.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { outline: cs.outlineWidth + ' ' + cs.outlineStyle, boxShadow: cs.boxShadow, focusVisible: el.matches(':focus-visible') };
    });
    console.log('HELPTIP focus ring', JSON.stringify(ring));

    // Is the bubble text present in the a11y tree while closed? (screen reader)
    const snapshot = await page.locator('body').evaluate(() => 1);
    void snapshot;
  });

  test('multi-pick variant chips: keyboard toggling + no-op feedback', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('multichip'), {
      cover: cover('Multi chip QA'),
      steps: [
        {
          key: 'tools',
          type: 'multiple_choice',
          selectionMode: 'multiple',
          question: 'Which tools?',
          options: [
            { label: 'Alpha', value: 'a', points: 0 },
            { label: 'Beta', value: 'b', points: 0 },
            { label: 'Gamma', value: 'c', points: 0 },
          ],
        },
        {
          key: 'topic',
          type: 'text',
          question: 'Tell us more',
          questionField: 'tools',
          questionVariants: { a: 'Alpha follow-up', 'b,c': 'Beta+Gamma follow-up' },
        },
      ],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Tell us more/ }).first().click();

    const chips = page.getByTestId('variant-multi-option');
    await expect(chips.first()).toBeVisible();
    const n = await chips.count();
    console.log('CHIPS count', n);
    for (let i = 0; i < n; i++) {
      const c = chips.nth(i);
      console.log('CHIP', i, await c.textContent(), 'pressed=', await c.getAttribute('aria-pressed'), 'disabled=', await c.getAttribute('disabled'), 'aria-disabled=', await c.getAttribute('aria-disabled'), 'tag=', await c.evaluate((el) => el.tagName));
    }

    // Row 1 currently owns {a}. Tab reachability: focus the first chip via keyboard.
    const first = chips.first();
    await first.focus();
    console.log('CHIP focus-visible?', await first.evaluate((el) => el.matches(':focus-visible')));

    // Untick the ONLY ticked option in row 1 with the keyboard.
    const pressedBefore = await first.getAttribute('aria-pressed');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    console.log('CHIP row1 sole-option untick: pressed before/after =', pressedBefore, await first.getAttribute('aria-pressed'));
    console.log('CHIP empty-warning count =', await page.getByText(/at least one|Pick at least/i).count());

    // Now try to build a set another row already owns: row1 = {a}; tick b then c -> {a,b,c}? no.
    // Instead: from row 1, untick a is refused; tick b -> {a,b}; untick a -> {b}; tick c -> {b,c} == row2's set.
    await chips.nth(1).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    console.log('after tick b, row1 chips pressed:', await chips.nth(0).getAttribute('aria-pressed'), await chips.nth(1).getAttribute('aria-pressed'), await chips.nth(2).getAttribute('aria-pressed'));
    await chips.nth(0).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    console.log('after untick a, row1 chips pressed:', await chips.nth(0).getAttribute('aria-pressed'), await chips.nth(1).getAttribute('aria-pressed'), await chips.nth(2).getAttribute('aria-pressed'));
    await chips.nth(2).focus();
    const beforeDup = await chips.nth(2).getAttribute('aria-pressed');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    console.log('DUPLICATE-SET attempt: chip c pressed before/after =', beforeDup, await chips.nth(2).getAttribute('aria-pressed'));
    console.log('any live region / alert on page:', await page.locator('[role=alert],[aria-live]').count());
  });

  test('step-field-key: Escape reverts, Enter commits, where does focus go', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('fieldkey'), {
      cover: cover('Field key QA'),
      steps: [
        { key: 'email', type: 'email', question: 'Email?' },
        { key: 'company', type: 'text', question: 'Company?' },
      ],
    });
    await openEditor(page, id);

    const input = page.getByTestId('step-field-key');
    await expect(input).toBeVisible();
    console.log('FIELDKEY initial', await input.inputValue(), 'describedby=', await input.getAttribute('aria-describedby'), 'labelledby=', await input.getAttribute('aria-labelledby'), 'aria-label=', await input.getAttribute('aria-label'), 'id=', await input.getAttribute('id'));

    // ESCAPE revert
    await input.focus();
    await input.fill('garbage_key');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    console.log('FIELDKEY after Escape value=', await input.inputValue(), 'focus=', JSON.stringify(await active(page)));

    // ENTER commit
    await input.fill('primary_email');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    console.log('FIELDKEY after Enter value=', await input.inputValue(), 'focus=', JSON.stringify(await active(page)));

    // Next Tab after Enter — where does the keyboard land?
    await page.keyboard.press('Tab');
    console.log('FIELDKEY after Enter then Tab, focus=', JSON.stringify(await active(page)));

    // COLLISION: type the other step's key
    await input.focus();
    await input.fill('company');
    await page.waitForTimeout(300);
    const taken = page.getByTestId('step-field-key-taken');
    console.log('COLLISION alert count=', await taken.count(), 'role=', await taken.first().getAttribute('role').catch(() => 'n/a'));
    console.log('COLLISION input aria-invalid=', await input.getAttribute('aria-invalid'), 'aria-describedby=', await input.getAttribute('aria-describedby'), 'errormessage=', await input.getAttribute('aria-errormessage'));
    console.log('COLLISION alert id=', await taken.first().getAttribute('id').catch(() => 'n/a'));
    // Commit the invalid key with Enter — silent snap-back?
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    console.log('COLLISION after Enter value=', await input.inputValue(), 'alert count=', await page.getByTestId('step-field-key-taken').count(), 'focus=', JSON.stringify(await active(page)));
  });

  test('create-form inline error: announcement + focus target', async ({ page }) => {
    await page.goto('/admin/forms');
    const createBtn = page.getByRole('button', { name: /^Create/ }).first();
    await expect(createBtn).toBeVisible({ timeout: 20_000 });
    await createBtn.click();

    const dialogInput = page.locator('input[name="name"]');
    await expect(dialogInput).toBeVisible();
    console.log('CREATE autofocus lands on:', JSON.stringify(await active(page)));

    // Submit empty by keyboard only.
    await page.keyboard.press('Tab'); // cancel?
    console.log('CREATE tab1 ->', JSON.stringify(await active(page)));
    await page.keyboard.press('Tab');
    console.log('CREATE tab2 ->', JSON.stringify(await active(page)));
    // Focus the submit and press Enter
    const submit = page.getByRole('button', { name: /^Create/ }).last();
    await submit.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    const err = page.getByTestId('create-form-name-error');
    console.log('CREATE error count=', await err.count(), 'role=', await err.first().getAttribute('role').catch(() => 'n/a'), 'text=', await err.first().textContent().catch(() => ''));
    console.log('CREATE focus after failed submit:', JSON.stringify(await active(page)));
    console.log('CREATE input aria-invalid=', await dialogInput.getAttribute('aria-invalid'), 'describedby=', await dialogInput.getAttribute('aria-describedby'));

    // Does the modal itself have dialog semantics + focus trap?
    const dlg = page.locator('[role=dialog],[role=alertdialog]');
    console.log('CREATE dialog count=', await dlg.count(), 'aria-modal=', await dlg.first().getAttribute('aria-modal').catch(() => 'n/a'), 'labelledby=', await dlg.first().getAttribute('aria-labelledby').catch(() => 'n/a'));

    // Tab around the modal to see whether focus escapes into the page behind.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const a = await active(page);
      const inside = await page.evaluate(() => {
        const d = document.querySelector('[role=dialog],[role=alertdialog]');
        return d ? d.contains(document.activeElement) : null;
      });
      console.log(`CREATE trap tab${i + 1}`, JSON.stringify(a), 'insideDialog=', inside);
    }

    // Escape closes?
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    console.log('CREATE after Escape, dialog count=', await page.locator('[role=dialog],[role=alertdialog]').count(), 'focus=', JSON.stringify(await active(page)));
  });

  test('disabled outcomes fieldset: skipped by keyboard, reason reachable', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('inert'), {
      cover: cover('Inert outcomes QA'),
      scoring: { enabled: false },
      steps: [
        {
          key: 'pick',
          type: 'multiple_choice',
          question: 'Pick',
          options: [
            { label: 'A', value: 'a', points: 5 },
            { label: 'B', value: 'b', points: 0 },
          ],
        },
      ],
      outcomes: [
        { id: 'p2', label: 'P2', minScore: 0, redirectUrl: 'https://example.com/p2' },
        { id: 'p1', label: 'P1', minScore: 5, redirectUrl: 'https://example.com/p1' },
      ],
    });
    await openEditor(page, id, 'results');

    const end = page.getByTestId('results-end');
    await expect(end).toBeVisible();
    console.log('RESULTS scoring-off attr=', await end.getAttribute('data-scoring-off'));
    const inert = page.getByTestId('results-outcomes-inert');
    console.log('INERT reason count=', await inert.count(), 'text=', (await inert.first().textContent().catch(() => ''))?.slice(0, 120));

    const fieldset = end.locator('fieldset');
    console.log('FIELDSET disabled=', await fieldset.getAttribute('disabled'), 'aria-describedby=', await fieldset.getAttribute('aria-describedby'), 'has legend=', await fieldset.locator('legend').count());

    // Enumerate everything inside the fieldset that could take focus.
    const focusables = await fieldset.evaluate((fs) => {
      const sel = 'a[href],button,input,select,textarea,[tabindex],[role=button],[contenteditable=true]';
      return Array.from(fs.querySelectorAll<HTMLElement>(sel)).map((el) => ({
        tag: el.tagName,
        testid: el.getAttribute('data-testid'),
        role: el.getAttribute('role'),
        disabled: (el as HTMLButtonElement).disabled ?? null,
        tabindex: el.getAttribute('tabindex'),
        text: (el.textContent || '').trim().slice(0, 30),
      }));
    });
    console.log('FIELDSET focusable candidates:', JSON.stringify(focusables, null, 1));

    // Actually tab the page and record everything reached, to prove nothing inside is reachable.
    await page.locator('body').click({ position: { x: 3, y: 3 } });
    const reached: unknown[] = [];
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const fs = document.querySelector('[data-testid=results-end] fieldset');
        return {
          tag: el.tagName,
          testid: el.getAttribute('data-testid'),
          label: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 28),
          insideFieldset: fs ? fs.contains(el) : false,
        };
      });
      reached.push(info);
    }
    console.log('TAB ORDER (results tab):', JSON.stringify(reached));

    // Is the reason text associated to anything, or loose prose?
    const inertInfo = await inert.first().evaluate((el) => ({
      id: el.getAttribute('id'),
      role: el.getAttribute('role'),
      tag: el.tagName,
      prevSibling: el.previousElementSibling?.tagName ?? null,
    }));
    console.log('INERT node:', JSON.stringify(inertInfo));

    console.log('DIVCLICK results tab:', JSON.stringify(await divClickHandlers(page), null, 1));
  });

  test('reveal-point popover + Design link keyboard path', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('reveal'), {
      cover: cover('Reveal QA'),
      reveal: { enabled: true, headline: 'Matching…', durationMs: 800 },
      steps: [
        { key: 'email', type: 'email', question: 'Email?' },
        { key: 'company', type: 'text', question: 'Company?' },
      ],
    });
    await openEditor(page, id);

    const info = page.getByTestId('reveal-point-info');
    await expect(info).toBeVisible();
    await info.focus();
    console.log('REVEAL info focus-visible=', await info.evaluate((el) => el.matches(':focus-visible')), 'expanded=', await info.getAttribute('aria-expanded'), 'controls=', await info.getAttribute('aria-controls'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const edit = page.getByTestId('reveal-point-edit');
    console.log('REVEAL popover open, edit link count=', await edit.count(), 'expanded=', await info.getAttribute('aria-expanded'));

    // Tab from the info button — do we land on the edit link?
    const seen: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      seen.push(await active(page));
    }
    console.log('REVEAL tab path from info:', JSON.stringify(seen));

    // Escape while the popover is open.
    await info.focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    console.log('REVEAL after Escape: edit link count=', await page.getByTestId('reveal-point-edit').count());

    // Activate the Design link by keyboard and see where focus lands.
    await edit.first().focus();
    console.log('REVEAL edit tag=', await edit.first().evaluate((el) => el.tagName), 'text=', await edit.first().textContent());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    console.log('REVEAL after activating Design link: url=', page.url(), 'focus=', JSON.stringify(await active(page)));
    console.log('REVEAL design tab selected=', await page.getByTestId('editor-tab-design').getAttribute('aria-selected').catch(() => 'n/a'));
  });

  test('connect tab autosave status + global div-click audit', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('connect'), {
      cover: cover('Connect QA'),
      steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    });

    await page.goto(`/admin/forms/${id}/integrations`);
    await page.waitForLoadState('networkidle');
    console.log('CONNECT url after redirect =', page.url());
    const status = page.getByTestId('integrations-save-status');
    await expect(status).toBeVisible({ timeout: 20_000 });
    console.log('STATUS data-status=', await status.getAttribute('data-status'), 'aria-live=', await status.getAttribute('aria-live'), 'role=', await status.getAttribute('role'), 'text=', (await status.textContent())?.trim());

    console.log('DIVCLICK connect tab:', JSON.stringify(await divClickHandlers(page), null, 1));

    // Build tab audit
    await openEditor(page, id);
    console.log('DIVCLICK build tab:', JSON.stringify(await divClickHandlers(page), null, 1));

    // Logic tab audit
    await page.goto(`/admin/forms/${id}/edit?tab=logic`);
    await page.waitForTimeout(1200);
    console.log('DIVCLICK logic tab:', JSON.stringify(await divClickHandlers(page), null, 1));

    // Design tab audit
    await page.goto(`/admin/forms/${id}/edit?tab=design`);
    await page.waitForTimeout(1200);
    console.log('DIVCLICK design tab:', JSON.stringify(await divClickHandlers(page), null, 1));
  });

  test('slider warnings + token warnings: announced?', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('slider'), {
      cover: cover('Slider QA'),
      scoring: { enabled: true },
      steps: [
        {
          key: 'leads',
          type: 'slider',
          question: 'Leads?',
          min: 0,
          max: 100,
          default: 10,
          sliderScoring: [{ min: 0, max: 50, points: 1 }],
        },
      ],
    });
    await openEditor(page, id);

    // Push default out of range with the keyboard.
    const def = page.getByLabel(/Default/i).first();
    console.log('SLIDER default field found=', await def.count());
    await def.fill('500');
    await page.waitForTimeout(500);
    const warn = page.getByTestId('slider-default-out-of-range');
    console.log('SLIDER out-of-range warn count=', await warn.count(), 'role=', await warn.first().getAttribute('role').catch(() => 'n/a'), 'aria-live=', await warn.first().getAttribute('aria-live').catch(() => 'n/a'), 'text=', (await warn.first().textContent().catch(() => ''))?.slice(0, 100));
    console.log('SLIDER default input aria-invalid=', await def.getAttribute('aria-invalid'), 'describedby=', await def.getAttribute('aria-describedby'));

    // Max below min
    const max = page.getByLabel(/^Max/i).first();
    if (await max.count()) {
      await max.fill('-5');
      await page.waitForTimeout(400);
      const w2 = page.getByTestId('slider-max-below-min');
      console.log('SLIDER max-below-min count=', await w2.count(), 'role=', await w2.first().getAttribute('role').catch(() => 'n/a'));
    }

    // Unreachable scoring range
    console.log('SLIDER range-unreachable count=', await page.getByTestId('slider-range-unreachable').count(), 'role=', await page.getByTestId('slider-range-unreachable').first().getAttribute('role').catch(() => 'n/a'));
  });

  test('bare @key token warning: announced?', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('token'), {
      cover: cover('Token QA'),
      steps: [
        { key: 'email', type: 'email', question: 'Email?' },
        { key: 'company', type: 'text', question: 'Company?' },
      ],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Company\?/ }).first().click();

    const title = page.getByTestId('canvas-title-input');
    await expect(title).toBeVisible();
    await title.click();
    await title.fill('');
    await title.pressSequentially('Hi @nosuchkey there');
    await page.waitForTimeout(600);
    const warn = page.getByTestId('token-warning');
    console.log('TOKEN warn count=', await warn.count(), 'kind=', await warn.first().getAttribute('data-kind').catch(() => 'n/a'), 'form=', await warn.first().getAttribute('data-form').catch(() => 'n/a'), 'role=', await warn.first().getAttribute('role').catch(() => 'n/a'), 'aria-live=', await warn.first().getAttribute('aria-live').catch(() => 'n/a'), 'text=', (await warn.first().textContent().catch(() => ''))?.slice(0, 90));
    console.log('TOKEN title combobox describedby=', await title.getAttribute('aria-describedby'), 'expanded=', await title.getAttribute('aria-expanded'), 'controls=', await title.getAttribute('aria-controls'), 'activedescendant=', await title.getAttribute('aria-activedescendant'));
  });
});
