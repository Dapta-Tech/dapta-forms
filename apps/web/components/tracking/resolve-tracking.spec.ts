import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POSTHOG_HOST,
  hasAnyTracking,
  resolveTracking,
  type TrackingEnv,
} from './resolve-tracking';

const EMPTY_ENV: TrackingEnv = {};

const FULL_ENV: TrackingEnv = {
  NEXT_PUBLIC_GTM_ID: 'GTM-ENV',
  NEXT_PUBLIC_META_PIXEL_ID: 'env-pixel',
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_env',
  NEXT_PUBLIC_POSTHOG_HOST: 'https://ph.env.example',
  NEXT_PUBLIC_HUBSPOT_TRACKING_ID: 'env-hubspot',
};

describe('resolveTracking', () => {
  it('resolves everything off when neither config nor env provide ids', () => {
    const resolved = resolveTracking(undefined, EMPTY_ENV);
    expect(resolved).toEqual({
      gtmId: null,
      metaPixelId: null,
      posthogKey: null,
      posthogHost: DEFAULT_POSTHOG_HOST,
      hubspotTrackingId: null,
    });
    expect(hasAnyTracking(resolved)).toBe(false);
  });

  it('treats null config (legacy forms) the same as absent config', () => {
    expect(resolveTracking(null, EMPTY_ENV)).toEqual(resolveTracking(undefined, EMPTY_ENV));
  });

  it('falls back to env defaults when the form config has no tracking', () => {
    const resolved = resolveTracking(undefined, FULL_ENV);
    expect(resolved).toEqual({
      gtmId: 'GTM-ENV',
      metaPixelId: 'env-pixel',
      posthogKey: 'phc_env',
      posthogHost: 'https://ph.env.example',
      hubspotTrackingId: 'env-hubspot',
    });
    expect(hasAnyTracking(resolved)).toBe(true);
  });

  it('prefers per-form config over env for every id', () => {
    const resolved = resolveTracking(
      {
        gtmId: 'GTM-FORM',
        metaPixelId: 'form-pixel',
        posthogKey: 'phc_form',
        posthogHost: 'https://ph.form.example',
        hubspotTrackingId: 'form-hubspot',
      },
      FULL_ENV,
    );
    expect(resolved).toEqual({
      gtmId: 'GTM-FORM',
      metaPixelId: 'form-pixel',
      posthogKey: 'phc_form',
      posthogHost: 'https://ph.form.example',
      hubspotTrackingId: 'form-hubspot',
    });
  });

  it('merges per-id: config wins where set, env fills the rest', () => {
    const resolved = resolveTracking({ gtmId: 'GTM-FORM' }, FULL_ENV);
    expect(resolved.gtmId).toBe('GTM-FORM');
    expect(resolved.metaPixelId).toBe('env-pixel');
    expect(resolved.posthogKey).toBe('phc_env');
    expect(resolved.hubspotTrackingId).toBe('env-hubspot');
  });

  it('treats null/empty/blank config values as absent (falls through to env)', () => {
    const resolved = resolveTracking(
      { gtmId: null, metaPixelId: '', posthogKey: '   ', hubspotTrackingId: undefined },
      FULL_ENV,
    );
    expect(resolved.gtmId).toBe('GTM-ENV');
    expect(resolved.metaPixelId).toBe('env-pixel');
    expect(resolved.posthogKey).toBe('phc_env');
    expect(resolved.hubspotTrackingId).toBe('env-hubspot');
  });

  it('treats blank env values as absent (tracker stays off)', () => {
    const resolved = resolveTracking(undefined, {
      NEXT_PUBLIC_GTM_ID: '  ',
      NEXT_PUBLIC_META_PIXEL_ID: '',
    });
    expect(resolved.gtmId).toBeNull();
    expect(resolved.metaPixelId).toBeNull();
    expect(hasAnyTracking(resolved)).toBe(false);
  });

  it('trims whitespace around ids', () => {
    const resolved = resolveTracking({ gtmId: '  GTM-FORM  ' }, EMPTY_ENV);
    expect(resolved.gtmId).toBe('GTM-FORM');
  });

  it('defaults the PostHog host when a key is set but no host is configured', () => {
    const resolved = resolveTracking({ posthogKey: 'phc_form' }, EMPTY_ENV);
    expect(resolved.posthogKey).toBe('phc_form');
    expect(resolved.posthogHost).toBe(DEFAULT_POSTHOG_HOST);
  });

  it('takes the PostHog host with the same config-over-env precedence', () => {
    expect(resolveTracking({ posthogHost: 'https://ph.form.example' }, FULL_ENV).posthogHost).toBe(
      'https://ph.form.example',
    );
    expect(resolveTracking({ posthogKey: 'phc_form' }, FULL_ENV).posthogHost).toBe(
      'https://ph.env.example',
    );
  });
});
