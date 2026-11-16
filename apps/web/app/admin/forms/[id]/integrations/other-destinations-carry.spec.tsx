/**
 * Destinations the Connect tab does not edit at all.
 *
 * The sibling of `webhook-carry.spec.tsx`, and the same class of bug one level
 * up. That one was about a SECOND webhook; this is about a whole destination
 * KIND the screen has no card for.
 *
 * The save path assembles the `destinations` array from scratch out of the two
 * things this tab renders, and autosave rewrites the whole array on any edit.
 * So the moment a Google Sheets destination could exist, opening this tab and
 * touching an unrelated field would delete it: no warning, nothing on screen to
 * hint at it, and a save that reports success. `carriedOthers` is the rule that
 * stops it, written as "not the two kinds this screen knows" so the destination
 * kind after this one is carried by default rather than quietly dropped.
 */
import { describe, expect, it } from 'vitest';
import type { FormDestination } from '@quill/types';
import { carriedOthers, carriedWebhooks } from './integrations-editor';

const hook = (url: string): FormDestination =>
  ({ type: 'webhook', enabled: true, settings: { url } }) as unknown as FormDestination;

const hubspot = (): FormDestination =>
  ({ type: 'hubspot', enabled: true, settings: {} }) as unknown as FormDestination;

const sheets = (spreadsheetId = 'sheet-1'): FormDestination =>
  ({
    type: 'google-sheets',
    enabled: true,
    settings: { spreadsheetId, sheetTitle: 'Responses' },
    columns: [{ header: 'Email', source: 'answer', key: 'email' }],
  }) as unknown as FormDestination;

describe('carriedOthers', () => {
  it('carries a Google Sheets destination the screen cannot show', () => {
    expect(carriedOthers([hook('https://a.test/h'), sheets(), hubspot()])).toEqual([sheets()]);
  });

  it('carries every one of them, in their stored order', () => {
    const a = sheets('sheet-a');
    const b = sheets('sheet-b');
    expect(carriedOthers([a, hubspot(), b])).toEqual([a, b]);
  });

  it('carries nothing when the form only holds the two kinds this screen edits', () => {
    expect(carriedOthers([hook('https://a.test/h'), hook('https://b.test/h'), hubspot()])).toEqual([]);
    expect(carriedOthers([])).toEqual([]);
  });

  it('never double-counts a webhook, which has its own carry rule', () => {
    // The two rules partition the array: anything carried here must NOT also be
    // carried by `carriedWebhooks`, or a save would store it twice.
    const destinations = [hook('https://a.test/h'), hook('https://b.test/h'), sheets(), hubspot()];
    const others = carriedOthers(destinations);
    const webhooks = carriedWebhooks(destinations);
    expect(others.some((d) => webhooks.includes(d))).toBe(false);
    expect(others).toEqual([sheets()]);
    expect(webhooks).toEqual([hook('https://b.test/h')]);
  });

  it('carries a kind nobody has written yet, which is the point of the rule', () => {
    const future = { type: 'something-new', enabled: true } as unknown as FormDestination;
    expect(carriedOthers([hubspot(), future])).toEqual([future]);
  });
});
