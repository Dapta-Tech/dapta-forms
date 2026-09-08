import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CHANNEL,
  isBlockedPreviewRequest,
  readPreviewMessage,
} from './protocol';

/**
 * These two functions ARE the preview's security boundary: the message gate is
 * what keeps a foreign window from feeding the preview a config (or reading the
 * draft), and the request predicate is what keeps a previewed form from writing
 * a REAL submission through the renderers' Server Actions. Everything else in
 * the preview is presentation. So they are pinned here, exhaustively, in plain
 * node — no jsdom, no browser.
 */

const ORIGIN = 'https://forms.example.com';
const BASE = `${ORIGIN}/preview`;

/** A window stand-in: the gate compares identity, never shape. */
const parentWindow = { name: 'parent' } as unknown as Window;
const strangerWindow = { name: 'stranger' } as unknown as Window;

const validConfig = { version: 1, steps: [] };

function msg(overrides: Partial<MessageEvent> & { data?: unknown }): MessageEvent {
  return {
    origin: ORIGIN,
    source: parentWindow,
    data: {
      channel: PREVIEW_CHANNEL,
      type: 'config',
      revision: 1,
      config: validConfig,
      name: 'Probe',
      locale: 'en',
      layout: 'slides',
    },
    ...overrides,
  } as MessageEvent;
}

describe('readPreviewMessage — the three gates', () => {
  it('accepts a well-formed config from the expected source at the exact origin', () => {
    const out = readPreviewMessage(msg({}), parentWindow, ORIGIN);
    expect(out?.type).toBe('config');
  });

  it('rejects a foreign origin — even a lookalike prefix', () => {
    expect(readPreviewMessage(msg({ origin: 'https://evil.example.com' }), parentWindow, ORIGIN)).toBeNull();
    expect(
      readPreviewMessage(msg({ origin: `${ORIGIN}.evil.com` }), parentWindow, ORIGIN),
    ).toBeNull();
  });

  it('rejects the right origin from the WRONG window — origin alone is not identity', () => {
    expect(readPreviewMessage(msg({ source: strangerWindow }), parentWindow, ORIGIN)).toBeNull();
  });

  it('rejects everything when no expected source exists yet', () => {
    expect(readPreviewMessage(msg({}), null, ORIGIN)).toBeNull();
    expect(readPreviewMessage(msg({}), undefined, ORIGIN)).toBeNull();
  });

  it('rejects a missing or foreign channel marker', () => {
    expect(readPreviewMessage(msg({ data: { type: 'config' } }), parentWindow, ORIGIN)).toBeNull();
    expect(
      readPreviewMessage(msg({ data: { channel: 'other', type: 'config' } }), parentWindow, ORIGIN),
    ).toBeNull();
  });

  it('rejects a config whose steps is not an array — the one structural must', () => {
    expect(
      readPreviewMessage(
        msg({ data: { channel: PREVIEW_CHANNEL, type: 'config', config: { steps: 'nope' } } }),
        parentWindow,
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      readPreviewMessage(
        msg({ data: { channel: PREVIEW_CHANNEL, type: 'config', config: null } }),
        parentWindow,
        ORIGIN,
      ),
    ).toBeNull();
  });

  it('deliberately does NOT schema-validate: a mid-edit draft must still render', () => {
    // A transiently-invalid field (say, an outcome with a bad minScore) would
    // fail formConfigSchema — and blanking the preview exactly while the author
    // types is the failure mode this shape-only check exists to avoid.
    const out = readPreviewMessage(
      msg({
        data: {
          channel: PREVIEW_CHANNEL,
          type: 'config',
          config: { version: 1, steps: [], outcomes: [{ minScore: 'not-a-number' }] },
        },
      }),
      parentWindow,
      ORIGIN,
    );
    expect(out?.type).toBe('config');
  });

  it('accepts a screen hint: a non-negative integer or the literal cover', () => {
    expect(
      readPreviewMessage(msg({ data: { ...(msg({}).data as object), screen: 2 } }), parentWindow, ORIGIN),
    ).toMatchObject({ screen: 2 });
    expect(
      readPreviewMessage(msg({ data: { ...(msg({}).data as object), screen: 0 } }), parentWindow, ORIGIN),
    ).toMatchObject({ screen: 0 });
    expect(
      readPreviewMessage(msg({ data: { ...(msg({}).data as object), screen: 'cover' } }), parentWindow, ORIGIN),
    ).toMatchObject({ screen: 'cover' });
  });

  it('degrades a malformed screen hint to absent WITHOUT rejecting the message', () => {
    for (const junk of [-1, 1.5, 'nope', null, {}, NaN, Infinity]) {
      const out = readPreviewMessage(
        msg({ data: { ...(msg({}).data as object), screen: junk } }),
        parentWindow,
        ORIGIN,
      );
      expect(out?.type).toBe('config');
      expect(out && 'screen' in out ? out.screen : undefined).toBeUndefined();
    }
  });

  it('normalises the envelope fields rather than trusting them', () => {
    const out = readPreviewMessage(
      msg({
        data: { channel: PREVIEW_CHANNEL, type: 'config', config: validConfig, revision: 'x', layout: 'diagonal' },
      }),
      parentWindow,
      ORIGIN,
    );
    expect(out).toMatchObject({ revision: 0, layout: 'slides', name: '', locale: 'en' });
  });
});

describe('isBlockedPreviewRequest — the inertness matrix', () => {
  it('blocks a same-origin POST — the Server Action dispatch shape', () => {
    expect(isBlockedPreviewRequest(`${ORIGIN}/preview`, { method: 'POST' }, BASE)).toBe(true);
    expect(isBlockedPreviewRequest('/preview', { method: 'POST' }, BASE)).toBe(true);
  });

  it('blocks every same-origin mutating method, not just POST', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(isBlockedPreviewRequest('/v1/anything', { method }, BASE)).toBe(true);
    }
  });

  it('passes same-origin GET/HEAD — assets and RSC payloads must load', () => {
    expect(isBlockedPreviewRequest(`${ORIGIN}/some/page`, undefined, BASE)).toBe(false);
    expect(isBlockedPreviewRequest(`${ORIGIN}/some/page`, { method: 'HEAD' }, BASE)).toBe(false);
  });

  it('passes a cross-origin POST — an embedded scheduler must keep working', () => {
    expect(isBlockedPreviewRequest('https://calendly.com/api/x', { method: 'POST' }, BASE)).toBe(false);
  });

  it('passes /_next/ and /__nextjs so the dev overlay works inside the frame', () => {
    expect(isBlockedPreviewRequest('/_next/whatever', { method: 'POST' }, BASE)).toBe(false);
    expect(isBlockedPreviewRequest('/__nextjs/hmr', { method: 'POST' }, BASE)).toBe(false);
  });

  it('is case-insensitive on the method', () => {
    expect(isBlockedPreviewRequest('/v1/x', { method: 'post' }, BASE)).toBe(true);
    expect(isBlockedPreviewRequest('/v1/x', { method: 'get' }, BASE)).toBe(false);
  });
});

describe('config message: locale is narrowed to a shipped language', () => {
  const post = (locale: unknown) =>
    readPreviewMessage(
      {
        origin: ORIGIN,
        source: parentWindow,
        data: { channel: PREVIEW_CHANNEL, type: 'config', config: validConfig, locale },
      } as unknown as MessageEvent,
      parentWindow,
      ORIGIN,
    );

  it('keeps en and es, and folds anything else to en', () => {
    expect(post('es')).toMatchObject({ type: 'config', locale: 'es' });
    expect(post('en')).toMatchObject({ type: 'config', locale: 'en' });
    expect(post('fr')).toMatchObject({ type: 'config', locale: 'en' });
    expect(post(undefined)).toMatchObject({ type: 'config', locale: 'en' });
  });
});
