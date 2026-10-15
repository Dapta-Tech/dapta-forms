// @vitest-environment happy-dom
/**
 * The API docs page, driven like a person would.
 *
 * What it promises, each pinned below:
 *   - every route of the catalog is on the page, once, under its own anchor,
 *     with its method, its `{param}` path, its prose and a curl example that
 *     calls this environment's API with `$DFORMS_API_KEY`;
 *   - the index links only to anchors that exist;
 *   - the search filters by path or description, says how many match, and
 *     shows an empty state that clears back to the full page;
 *   - the copy buttons put the exact example on the clipboard;
 *   - both locales render complete, without an em dash or an en dash.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_ERROR_CODES,
  API_ISSUE_CODES,
  API_NOT_ALLOWED,
  API_REFERENCE,
  apiAnchor,
  apiCurl,
  apiDisplayPath,
  apiEndpoints,
  getMessages,
  type Locale,
} from '@quill/shared';
import { ApiDocsView } from './api-docs-view';
import {
  PLACEHOLDER_API_URL,
  SECTION_IDS,
  buildDocsModel,
  docsChrome,
  endpointMatches,
  normalizeQuery,
  referenceProse,
} from './docs-model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.forms.example.com';
const routes = Object.keys(API_REFERENCE);

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function unmount() {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
  }
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
}

async function mount(opts: { locale?: Locale; apiUrl?: string | null } = {}) {
  const locale = opts.locale ?? 'en';
  const admin = getMessages(locale).admin;
  const model = buildDocsModel(referenceProse(admin), opts.apiUrl === undefined ? API : opts.apiUrl);
  const el = document.createElement('div');
  document.body.append(el);
  const r = createRoot(el);
  host = el;
  root = r;
  await act(async () =>
    r.render(
      <ApiDocsView
        model={model}
        m={docsChrome(admin.apiDocs)}
        x={admin.apiDocsPage}
        d={admin.developerDocs}
        locale={locale}
      />,
    ),
  );
  return { admin, model };
}

const $ = (sel: string) => document.querySelector(sel);
const $$ = (sel: string) => [...document.querySelectorAll(sel)];
const shownRoutes = () => $$('[data-testid="api-endpoint"]').map((el) => el.getAttribute('data-route'));

/** Types into a controlled input the way the browser does: native setter, then an input event. */
async function type(input: Element | null, value: string) {
  const el = input as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const click = (el: Element | null) => act(async () => (el as HTMLElement).click());

afterEach(unmount);

describe('the model', () => {
  it('carries every catalog route once, in reading order, with prose in both languages', () => {
    for (const locale of ['en', 'es'] as const) {
      const model = buildDocsModel(referenceProse(getMessages(locale).admin), API);
      const flat = model.areas.flatMap((a) => a.endpoints);
      expect(flat.map((e) => e.route)).toEqual(apiEndpoints().map((e) => e.route));
      expect(new Set(flat.map((e) => e.route)).size).toBe(routes.length);
      expect(model.total).toBe(routes.length);
      for (const e of flat) {
        expect(e.description.trim(), e.route).not.toBe('');
        for (const p of e.params) expect(p.description.trim(), `${e.route} ${p.name}`).not.toBe('');
      }
    }
  });

  it('builds each curl against this environment, and falls back to a placeholder when none is set', () => {
    const live = buildDocsModel(referenceProse(getMessages('en').admin), API);
    for (const e of live.areas.flatMap((a) => a.endpoints)) {
      expect(e.curl).toContain(`"${API}/v1/`);
      expect(e.curl).toContain('Authorization: Bearer $DFORMS_API_KEY');
    }
    const none = buildDocsModel(referenceProse(getMessages('en').admin), null);
    expect(none.apiUrlConfigured).toBe(false);
    expect(none.areas[0]!.endpoints[0]!.curl).toContain(PLACEHOLDER_API_URL);
  });

  it('matches a search by path, by method or by description, ignoring case and accents', () => {
    const model = buildDocsModel(referenceProse(getMessages('es').admin), API);
    const flat = model.areas.flatMap((a) => a.endpoints);
    const hits = (q: string) => flat.filter((e) => endpointMatches(e, q)).map((e) => e.route);
    expect(hits('/v1/forms/{id}/publish')).toEqual(['POST /v1/forms/:id/publish']);
    expect(hits('DELETE folders')).toEqual(['DELETE /v1/folders/:id']);
    expect(hits('submissions.csv')).toEqual(['GET /v1/forms/:id/submissions.csv']);
    expect(normalizeQuery('  Publicación ')).toBe('publicacion');
    expect(hits('zzz-no-such-thing')).toEqual([]);
  });
});

describe('ApiDocsView', () => {
  it('renders every endpoint of the catalog under its own anchor', async () => {
    await mount();
    expect(shownRoutes()).toEqual(apiEndpoints().map((e) => e.route));
    for (const e of apiEndpoints()) {
      const card = document.getElementById(apiAnchor(e.route));
      expect(card, e.route).not.toBeNull();
      expect(card!.getAttribute('data-route')).toBe(e.route);
      expect(card!.querySelector('[data-method]')?.textContent).toBe(e.method);
      expect(card!.querySelector('h3')?.textContent).toContain(apiDisplayPath(e.path));
      expect(card!.querySelector('[data-testid="api-endpoint-anchor"]')?.getAttribute('href')).toBe(
        `#${apiAnchor(e.route)}`,
      );
      expect(card!.querySelector(`[data-testid="${apiAnchor(e.route)}-curl"] code`)?.textContent).toBe(
        apiCurl(e, API),
      );
      // Every documented parameter has its row, and a 204 says it answers nothing.
      expect(card!.querySelectorAll('[data-testid="api-param"]')).toHaveLength(e.params?.length ?? 0);
      expect(card!.querySelector(`[data-testid="${apiAnchor(e.route)}-response"]`), e.route).not.toBeNull();
    }
    // Anchors are unique on the page.
    const ids = $$('[id]').map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks the owner-or-admin routes and the ones that delete data', async () => {
    const { admin } = await mount();
    for (const e of apiEndpoints()) {
      const text = document.getElementById(apiAnchor(e.route))!.textContent ?? '';
      expect(text.includes(admin.apiDocs.reference.adminOnly), e.route).toBe(e.adminOnly === true);
      expect(text.includes(admin.apiDocs.reference.destructive), e.route).toBe(e.destructive === true);
    }
  });

  it('links the index only to anchors that exist, in the documented order', async () => {
    const { model } = await mount();
    const targets = $$('[data-testid="api-docs-toc"] a').map((a) => a.getAttribute('href')!.slice(1));
    for (const id of targets) expect(document.getElementById(id), id).not.toBeNull();
    const sections = $$('[data-toc]').map((a) => a.getAttribute('data-toc'));
    expect(sections).toEqual([
      SECTION_IDS.start,
      SECTION_IDS.auth,
      SECTION_IDS.errors,
      SECTION_IDS.limits,
      SECTION_IDS.reference,
      ...model.areas.map((a) => a.anchor),
      SECTION_IDS.cannot,
    ]);
  });

  it('scrolls a deep link into view once the page is in place', async () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.id);
    };
    try {
      const anchor = apiAnchor('POST /v1/forms/:id/publish');
      window.history.replaceState(null, '', `#${anchor}`);
      await mount();
      expect(scrolled).toEqual([anchor]);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
      window.history.replaceState(null, '', '#');
    }
  });

  it('shows the errors, the issue codes, the limits and what a key cannot do', async () => {
    await mount();
    for (const c of API_ERROR_CODES) expect($(`[data-testid="api-docs-error-${c.code}"]`), c.code).not.toBeNull();
    for (const c of API_ISSUE_CODES) expect($(`[data-testid="api-docs-issue-${c}"]`), c).not.toBeNull();
    expect($('[data-testid="api-docs-error-shape"]')?.textContent).toContain('config.steps.1.question');
    expect($('[data-testid="api-docs-limit-rate"]')?.textContent).toContain('120');
    expect($('[data-testid="api-docs-limit-keys"]')?.textContent).toContain('10');
    for (const id of API_NOT_ALLOWED) expect($(`[data-testid="api-docs-cannot-${id}"]`), id).not.toBeNull();
    expect($('[data-testid="api-docs-key-not-allowed"]')?.textContent).toContain('KEY_NOT_ALLOWED');
  });

  it('gives the base URL and the skill download, or says neither is configured', async () => {
    await mount();
    expect($('[data-testid="api-docs-base-url"]')?.textContent).toContain(API);
    expect($('[data-testid="api-docs-download"]')?.getAttribute('href')).toBe('/api/developers/skill');
    await unmount();
    await mount({ apiUrl: null });
    expect($('[data-testid="api-docs-base-url"]')).toBeNull();
    expect($('[data-testid="api-docs-base-url-missing"]')).not.toBeNull();
    expect($('[data-testid="api-docs-download"]')).toBeNull();
  });

  it('filters the endpoints by path or description, then clears back to the full page', async () => {
    const { admin } = await mount();
    const search = $('[data-testid="api-docs-search"]');

    await type(search, '/publish');
    expect(shownRoutes()).toEqual(['POST /v1/forms/:id/publish']);
    // The narrative sections step aside while searching.
    expect(document.getElementById(SECTION_IDS.start)).toBeNull();
    expect(document.getElementById(SECTION_IDS.cannot)).toBeNull();
    expect($('[data-testid="api-docs-search-count"]')?.textContent).toBe(admin.apiDocsPage.endpointCount.one);

    await type(search, '/v1/folders');
    expect(shownRoutes()).toEqual(['GET /v1/folders', 'POST /v1/folders', 'PATCH /v1/folders/:id', 'DELETE /v1/folders/:id']);

    // By description only: words that are in no path.
    await type(search, 'failed ones');
    expect(shownRoutes()).toContain('GET /v1/forms/:id/deliveries');

    await type(search, 'zzz-nothing');
    expect(shownRoutes()).toEqual([]);
    expect($('[data-testid="api-docs-empty"]')?.textContent).toContain('zzz-nothing');

    await click($('[data-testid="api-docs-search-clear"]'));
    expect(shownRoutes()).toHaveLength(routes.length);
    expect(document.getElementById(SECTION_IDS.start)).not.toBeNull();
  });

  it('copies the exact curl of an endpoint and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { admin } = await mount();
    const route = 'POST /v1/forms';
    const anchor = apiAnchor(route);
    const button = $(`[data-testid="${anchor}-curl-copy"]`);
    await click(button);
    expect(writeText).toHaveBeenCalledWith(apiCurl(apiEndpoints().find((e) => e.route === route)!, API));
    expect(button?.textContent).toContain(admin.apiDocs.reference.copied);
    expect(button?.getAttribute('data-state')).toBe('copied');
  });

  it('says so when the clipboard refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { admin } = await mount();
    const button = $('[data-testid="api-docs-base-url-copy"]');
    await click(button);
    expect(writeText).toHaveBeenCalledWith(API);
    expect(button?.textContent).toContain(admin.apiDocs.reference.copyFailed);
  });

  it('folds a long example answer behind a button', async () => {
    await mount();
    const id = apiAnchor('GET /v1/forms/:id');
    const fold = $(`[data-testid="${id}-response-fold"]`);
    expect(fold?.getAttribute('aria-expanded')).toBe('false');
    expect($(`[data-testid="${id}-response"] pre`)?.hasAttribute('data-folded')).toBe(true);
    await click(fold);
    expect(fold?.getAttribute('aria-expanded')).toBe('true');
    expect($(`[data-testid="${id}-response"] pre`)?.hasAttribute('data-folded')).toBe(false);
  });

  it('renders complete in both languages, without an em dash or an en dash', async () => {
    for (const locale of ['en', 'es'] as const) {
      await mount({ locale });
      const text = document.body.textContent ?? '';
      expect(text, locale).not.toMatch(/\u2014|\u2015|\u2013/);
      expect(text, locale).not.toContain('undefined');
      await unmount();
    }
  });
});
