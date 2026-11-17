// @vitest-environment happy-dom
/**
 * The campaign a booking page is handed is renderer STATE, not a ref read at
 * render time: when a save resolves the landing's campaign (an embedded form
 * with no `utm_*` of its own), the booking page re-renders with it instead of
 * keeping the empty set it mounted with.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { sameCampaign, useCampaignUtm } from './renderer-shared';

let root: Root | null = null;
let host: HTMLElement | null = null;
let record: ((utm: Record<string, string>) => void) | null = null;
let learnHost: ((hostUtm: Record<string, string>) => void) | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.history.replaceState(null, '', '/');
});

function Probe() {
  const campaign = useCampaignUtm();
  record = campaign.record;
  learnHost = campaign.learnHost;
  return <pre data-utm={JSON.stringify(campaign.utm)} data-own={JSON.stringify(campaign.own)} />;
}

const read = () => {
  const pre = host!.querySelector('pre')!;
  return { utm: JSON.parse(pre.dataset.utm!), own: JSON.parse(pre.dataset.own!) };
};

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
}

describe('useCampaignUtm', () => {
  it("starts from the form URL's own campaign", async () => {
    window.history.replaceState(null, '', '/?utm_source=newsletter&utm_content=own-link');
    await mount();
    expect(read().utm).toEqual({ utm_source: 'newsletter', utm_content: 'own-link' });
    expect(sameCampaign(read().utm, read().own)).toBe(true);
  });

  it('re-renders with the landing campaign a save resolved', async () => {
    await mount();
    expect(read().utm).toEqual({});
    const landing = { utm_source: 'linkedin', utm_content: 'carousel-2' };
    await act(async () => record!(landing));
    expect(read().utm).toEqual(landing);
    // The page's own set is empty, so a preloaded widget would lose it.
    expect(sameCampaign(read().utm, read().own)).toBe(false);
  });

  it("takes the landing's campaign from the host's answer, with no save before the scheduler", async () => {
    await mount();
    await act(async () => learnHost!({ utm_source: 'linkedin', utm_content: 'carousel-2' }));
    expect(read().utm).toEqual({ utm_source: 'linkedin', utm_content: 'carousel-2' });
  });

  it("never lets the landing's campaign replace the form URL's own", async () => {
    window.history.replaceState(null, '', '/?utm_content=own-link');
    await mount();
    await act(async () => learnHost!({ utm_content: 'landing' }));
    expect(read().utm).toEqual({ utm_content: 'own-link' });
  });
});
