/**
 * The HubSpot settings this screen does NOT edit.
 *
 * `settings` carries two values the author never sees: `formGuid`, the mirror
 * form the API built in their portal, and `formSignature`, what it was built
 * from. The Connect tab saves the whole destination on every keystroke, so the
 * moment it writes `settings` wholesale it deletes both — stranding a form in
 * the customer's portal that nothing points at, and making a fresh one on the
 * next save. The author would see nothing wrong; their portal would fill with
 * duplicates.
 */
import { describe, expect, it } from 'vitest';
import { mergeHubspotSettings } from './integrations-editor';

const EDITED = { note: true, formActivity: true };

describe('mergeHubspotSettings', () => {
  it('keeps the mirror form the API created', () => {
    const merged = mergeHubspotSettings(
      { note: false, formGuid: 'guid-1', formSignature: 'sig-1' },
      EDITED,
    );
    expect(merged.formGuid).toBe('guid-1');
    expect(merged.formSignature).toBe('sig-1');
  });

  it('still applies what the author DID change', () => {
    const merged = mergeHubspotSettings({ note: true, formActivity: false }, EDITED);
    expect(merged.note).toBe(true);
    expect(merged.formActivity).toBe(true);
  });

  it('keeps the guid when the author switches the activity OFF', () => {
    // Off means stop posting, not delete the form: its past submissions are
    // activities on real contacts. Switching back on reuses it.
    const merged = mergeHubspotSettings({ formGuid: 'guid-1' }, { note: true, formActivity: false });
    expect(merged.formGuid).toBe('guid-1');
    expect(merged.formActivity).toBe(false);
  });

  it('carries a key this build has never heard of', () => {
    // A newer API writing a field an older web build does not know about must
    // not lose it on the next save.
    const merged = mergeHubspotSettings({ somethingNewer: 42 }, EDITED);
    expect(merged.somethingNewer).toBe(42);
  });

  it('works on a destination that has no settings yet', () => {
    expect(mergeHubspotSettings(undefined, EDITED)).toEqual({ note: true, formActivity: true });
  });
});
