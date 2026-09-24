// @vitest-environment happy-dom
/**
 * The builder preview never runs spam protection's human check. The renderers
 * only activate it when handed `captcha`, which only the public page passes,
 * so this pins the other half: the preview document, fed a draft whose owner
 * switched protection fully on, hands neither layout a `captcha`.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ slides: [] as Record<string, unknown>[], vertical: [] as Record<string, unknown>[] }));

vi.mock('@/app/[accountCode]/[handle]/[slug]/form-renderer', () => ({
  FormRenderer: (props: Record<string, unknown>) => {
    seen.slides.push(props);
    return null;
  },
}));
vi.mock('@/app/[accountCode]/[handle]/[slug]/vertical-form-renderer', () => ({
  VerticalFormRenderer: (props: Record<string, unknown>) => {
    seen.vertical.push(props);
    return null;
  },
}));

import { PreviewDocument } from './preview-document';
import { PREVIEW_CHANNEL } from './protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function preview(layout: 'slides' | 'vertical') {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<PreviewDocument />));
  const message = new MessageEvent('message', {
    origin: window.location.origin,
    source: window.parent,
    data: {
      channel: PREVIEW_CHANNEL,
      type: 'config',
      revision: 1,
      name: 'Protected',
      locale: 'en',
      layout,
      config: {
        version: 1,
        steps: [{ key: 'email', type: 'email', question: 'Email?' }],
        spamProtection: { captcha: true, strict: true },
      },
    },
  });
  await act(async () => {
    window.dispatchEvent(message);
  });
}

describe('the builder preview and spam protection', () => {
  it('renders the slides layout with the draft, and no captcha', async () => {
    await preview('slides');
    const props = seen.slides.at(-1)!;
    expect((props.config as { spamProtection?: unknown }).spamProtection).toEqual({ captcha: true, strict: true });
    expect(props).not.toHaveProperty('captcha');
  });

  it('renders the one-page layout with the draft, and no captcha', async () => {
    await preview('vertical');
    const props = seen.vertical.at(-1)!;
    expect(props.config).toBeTruthy();
    expect(props).not.toHaveProperty('captcha');
  });
});
