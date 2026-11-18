/**
 * The HighLevel rows of the delivery history, in the author's language.
 *
 * The adapter writes its reasons word for word from `GOHIGHLEVEL_REASONS`, so
 * the history can match them whole and translate them; HighLevel's own text
 * (a 422's message) is kept exactly as it came, under dForms' sentence.
 */
import { describe, expect, it } from 'vitest';
import { getMessages } from '@quill/shared';
import { GOHIGHLEVEL_REASONS } from '@quill/types';
import { describeDeliveryReason } from './delivery-reason';

describe.each(['en', 'es'] as const)('HighLevel delivery reasons (%s)', (locale) => {
  const m = getMessages(locale).admin.integrations;
  const r = m.historyReasons;

  it.each([
    [GOHIGHLEVEL_REASONS.notConnected, 'highlevelNotConnected'],
    [GOHIGHLEVEL_REASONS.noEmailOrPhone, 'highlevelNoEmailOrPhone'],
    [GOHIGHLEVEL_REASONS.tokenRejected, 'highlevelTokenRejected'],
    [GOHIGHLEVEL_REASONS.locationForbidden, 'highlevelLocationForbidden'],
  ] as const)('translates "%s"', (reason, key) => {
    expect(describeDeliveryReason('gohighlevel', reason, m)).toBe(r[key]);
  });

  it('keeps a retryable failure’s detail and names HighLevel', () => {
    expect(describeDeliveryReason('gohighlevel', 'gohighlevel delivery failed: HTTP 503', m)).toBe(
      r.deliveryFailed.replace('{provider}', 'HighLevel').replace('{detail}', 'HTTP 503'),
    );
  });

  it('keeps HighLevel’s own refusal text, under dForms’ sentence', () => {
    expect(describeDeliveryReason('gohighlevel', 'HTTP 422: email must be an email', m)).toBe(
      r.providerAnsweredDetail
        .replace('{provider}', 'HighLevel')
        .replace('{status}', '422')
        .replace('{detail}', 'email must be an email'),
    );
  });

  it('leaves a reason that merely contains one of these words as recorded', () => {
    const odd = `note: ${GOHIGHLEVEL_REASONS.tokenRejected}`;
    expect(describeDeliveryReason('gohighlevel', odd, m)).toBe(odd);
  });
});
