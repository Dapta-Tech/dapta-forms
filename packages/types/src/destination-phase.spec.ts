/**
 * Which phase each destination kind fires for.
 *
 * The interesting case is Google Sheets, because a spreadsheet is APPEND-ONLY
 * and that makes a partial a different thing there than anywhere else. A
 * webhook receiving a partial and then the complete can reconcile them on its
 * own key; a CRM upserts onto the same contact. A sheet cannot: it would hold
 * one row from halfway through the form and a second, fuller row underneath,
 * with nothing in either saying they are the same person.
 */
import { describe, expect, it } from 'vitest';
import { destinationFiresForPhase } from './index';

describe('destinationFiresForPhase', () => {
  it('fires a spreadsheet on the complete only, whatever its config says', () => {
    const sheets = { type: 'google-sheets' };
    expect(destinationFiresForPhase(sheets, 'complete')).toBe(true);
    expect(destinationFiresForPhase(sheets, 'partial')).toBe(false);
    // Not left to the schema's absent-events default, which means BOTH: that
    // default is right for every other kind and wrong for exactly this one.
    expect(destinationFiresForPhase({ type: 'google-sheets', events: ['partial'] }, 'partial')).toBe(
      false,
    );
  });

  it('still fires every other kind on both phases by default', () => {
    for (const type of ['webhook', 'hubspot']) {
      expect(destinationFiresForPhase({ type }, 'partial')).toBe(true);
      expect(destinationFiresForPhase({ type }, 'complete')).toBe(true);
    }
  });

  it('still honours a webhook’s own trigger filter', () => {
    const complete = { type: 'webhook', events: ['complete' as const] };
    expect(destinationFiresForPhase(complete, 'complete')).toBe(true);
    expect(destinationFiresForPhase(complete, 'partial')).toBe(false);
  });
});
