import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * V4-17 — the redesigned Logic view (read-only routing map).
 *
 * Builds a form with a branching question (two `goto` rules: one that skips
 * straight to the end, one that jumps to a later question) plus scored outcomes,
 * opens the editor's Logic tab, and asserts the map renders the expected node
 * graph: a Start node, one card per question, the labelled purple branch edges
 * (including the skip-to-end ending and the jump target), the traceable
 * "Otherwise" default path, and the lime outcome/ending nodes. A screenshot of
 * the map is captured for visual review.
 *
 * Forms are created per test via the admin API with a `v4lv-` slug prefix so the
 * spec is self-contained and independent of seeded data.
 */

const API = 'http://localhost:4400';

let seq = 0;
function formName(label: string, workerIndex: number): string {
  seq += 1;
  return `v4lv logic ${label} w${workerIndex}-${seq}`;
}

/** A form whose first question branches (skip-to-end + forward jump) and that
 *  resolves to two scored outcome buckets. Created as the LIVE config. */
const branchingConfig = {
  version: 1,
  cover: { enabled: true, headline: 'Logic view QA', ctaText: 'Start' },
  steps: [
    {
      key: 'company_size',
      type: 'multiple_choice',
      selectionMode: 'single',
      question: 'How big is your company?',
      options: [
        { label: 'Just me', value: 'solo', points: 0 },
        { label: '2–10', value: 'smb', points: 3 },
        { label: '1000+', value: 'ent', points: 10 },
      ],
      goto: [
        { values: ['solo'], target: null }, // skip straight to the end
        { values: ['ent'], target: 'budget' }, // jump forward to the budget slider
      ],
    },
    { key: 'role', type: 'text', question: 'What is your role?' },
    { key: 'budget', type: 'slider', question: 'Monthly budget?', min: 0, max: 100, default: 10 },
    { key: 'work_email', type: 'email', question: 'Work email', required: true },
  ],
  scoring: { enabled: true },
  outcomes: [
    { id: 'hot', label: 'Hot lead', minScore: 5, redirectUrl: 'https://example.com/book' },
    { id: 'nurture', label: 'Nurture', minScore: -100 },
  ],
};

async function createForm(request: APIRequestContext, name: string): Promise<{ id: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: branchingConfig } });
  expect(res.ok(), `create form failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.slug.startsWith('v4lv'), `slug should be v4lv-prefixed, got ${body.slug}`).toBeTruthy();
  return { id: body.id };
}

test('Logic tab renders the routing map: nodes, branch edges, otherwise path and endings', async ({
  page,
  request,
}, testInfo) => {
  // The vertical LIST view under test here now only renders below the `lg`
  // breakpoint — at desktop widths the Logic tab is the pan/zoom canvas
  // (covered by the canvas test below). Pin the viewport under 1024 so this
  // spec keeps exercising the surface it describes.
  await page.setViewportSize({ width: 1000, height: 900 });
  const { id } = await createForm(request, formName('map', testInfo.workerIndex));

  await page.goto(`/admin/forms/${id}/edit?tab=logic`);

  // The map mounts and the Logic tab is the active section.
  const map = page.getByTestId('logic-map');
  await expect(map).toBeVisible();
  await expect(page.getByTestId('editor-tab-logic')).toHaveAttribute('aria-current', 'true');

  // Start capsule + one card per authored question.
  await expect(page.getByTestId('logic-start')).toBeVisible();
  await expect(page.getByTestId('logic-node')).toHaveCount(4);
  await expect(map.getByText('How big is your company?')).toBeVisible();

  // Two branch edges off the first question: a skip-to-end ending and a jump.
  await expect(page.getByTestId('logic-branch')).toHaveCount(2);
  // The skip-to-end edge is labelled with the human option label, and renders a
  // lime ending node ("Thank you").
  await expect(map.getByText('If Just me → skip to end')).toBeVisible();
  await expect(page.getByTestId('logic-end')).toHaveCount(1);
  // The jump edge points forward to the budget slider question.
  await expect(map.getByText('If 1000+ → Monthly budget?')).toBeVisible();
  await expect(page.getByTestId('logic-jump')).toHaveCount(1);

  // The default ("Otherwise") path is labelled so the flow is traceable.
  await expect(page.getByTestId('logic-otherwise')).toHaveCount(1);
  await expect(map.getByText('Otherwise', { exact: false })).toBeVisible();

  // The scored outcomes render as terminal ending nodes (one carries a redirect).
  await expect(page.getByTestId('logic-outcome')).toHaveCount(2);
  await expect(map.getByText('Hot lead')).toBeVisible();
  await expect(map.getByText('Nurture')).toBeVisible();
  await expect(map.getByText('example.com/book', { exact: false })).toBeVisible();

  // Capture the whole map for visual review. The map lives in a scroll
  // container, so grow the viewport first to bring every node into paint
  // (otherwise the below-the-fold endings stitch in blank). Stay under 1024 —
  // crossing the `lg` breakpoint would swap the list for the canvas mid-test.
  await page.setViewportSize({ width: 1000, height: 1500 });
  await page.getByTestId('logic-outcome').last().scrollIntoViewIfNeeded();
  await expect(map.getByText('Nurture')).toBeVisible();
  await map.screenshot({ path: 'qa/shots/v4-logic-view.png' });
});

test('desktop Logic tab is the canvas: parallel outcomes, real jump edges, a shared end node', async ({
  page,
  request,
}, testInfo) => {
  // Playwright's default 1280×720 viewport is ≥ the `lg` breakpoint, so this
  // exercises what a desktop author actually sees — the canvas, not the list.
  const { id } = await createForm(request, formName('canvas', testInfo.workerIndex));

  await page.goto(`/admin/forms/${id}/edit?tab=logic`);

  await expect(page.getByTestId('logic-canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('logic-start')).toBeVisible();
  // One card per authored question, same count the list view asserts.
  await expect(page.getByTestId('logic-node')).toHaveCount(4);

  // The two goto rules on Q1 draw REAL edges now: the forward jump to the
  // budget question, and the skip-to-end into ONE shared terminal node —
  // the branch the old map drew as a chip with nothing joining it.
  await expect(page.getByTestId('logic-edge-goto')).toHaveCount(2);
  await expect(page.getByTestId('logic-end')).toHaveCount(1);

  // Outcomes are parallel terminal nodes, never a series: both render, and
  // they share an x column (alternatives), not a vertical sequence.
  const outcomes = page.getByTestId('logic-outcome');
  await expect(outcomes).toHaveCount(2);
  const boxes = [await outcomes.nth(0).boundingBox(), await outcomes.nth(1).boundingBox()];
  expect(Math.abs((boxes[0]?.x ?? 0) - (boxes[1]?.x ?? 1e9))).toBeLessThan(2);
  expect(Math.abs((boxes[0]?.y ?? 0) - (boxes[1]?.y ?? 0))).toBeGreaterThan(10);

  // The canvas chrome is present: zoom controls and the pin escape hatch.
  await expect(page.getByTestId('logic-zoom-fit')).toBeVisible();
  await expect(page.getByTestId('logic-auto-arrange')).toBeVisible();
});
