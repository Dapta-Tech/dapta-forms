/**
 * The code an outbound call died with, as the Salesforce connect refusal
 * reports it. Only a code ever comes back: never a message, which can carry
 * the URL and the body that was being sent.
 */
import { describe, expect, it } from 'vitest';
import { networkCause } from './integrations.controller';

describe('networkCause', () => {
  it("reads the socket code Node's fetch puts on `cause`", () => {
    const err = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) });
    expect(networkCause(err)).toBe('ECONNRESET');
  });

  it('names a timeout', () => {
    expect(networkCause(new DOMException('The operation timed out.', 'TimeoutError'))).toBe('TimeoutError');
  });

  it('drops anything that is not a code', () => {
    expect(networkCause(new Error('POST https://acme.my.salesforce.com/services/oauth2/token failed'))).toBeUndefined();
    expect(networkCause({ code: 'client_secret=abc' })).toBeUndefined();
    expect(networkCause(null)).toBeUndefined();
  });
});
