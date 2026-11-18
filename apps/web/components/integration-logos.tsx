'use client';

import type { ReactNode } from 'react';
import { DaptaMark } from './brand/dapta-logo';
import { DcalLogo } from './ui/dcal-logo';
import { GoHighLevelLogo, GoogleSheetsLogo, ProviderLogo } from './ui/provider-logo';
import { useLogoRotation } from './logo-rotation';
import { IS_DAPTA_BRAND } from '@/lib/product-name';

/**
 * The services the Integrations item stands for, in the order they take turns.
 * HubSpot first: it is the static icon under reduced motion, and the most
 * familiar "this connects to other tools" mark of the set. Dapta last.
 *
 * Webhooks are not here: a webhook has no brand mark, only a generic icon.
 */
export const INTEGRATION_LOGOS = [
  'hubspot',
  'salesforce',
  'gohighlevel',
  'google-sheets',
  'calendly',
  'dcal',
  'dapta',
] as const;
export type IntegrationLogo = (typeof INTEGRATION_LOGOS)[number];

/**
 * The logos a build shows. Dapta's own mark only on a Dapta build (the same
 * open-core gate as `PlatformMark`): a fork is never made to carry Dapta's
 * artwork, so its rail rotates through the third-party marks alone.
 */
export function integrationLogosFor(daptaBrand: boolean): readonly IntegrationLogo[] {
  return daptaBrand ? INTEGRATION_LOGOS : INTEGRATION_LOGOS.filter((l) => l !== 'dapta');
}

/**
 * Half a turn behind "Connect your agent", the carousel right below it, so the
 * two rows never swap logos on the same frame.
 */
const OFFSET_MS = 800;

/**
 * Every mark is the one the app already ships for that service, never redrawn
 * here: `provider-logo.tsx` (HubSpot, Salesforce, Calendly, Google Sheets,
 * HighLevel), `dcal-logo.tsx` and Dapta's `d` from `brand/dapta-logo.tsx`.
 * Brand marks keep their colours; dCal's `dC` and Dapta's bowl take
 * `currentColor`, so they follow the row's ink in light and in dark.
 */
function mark(logo: IntegrationLogo, size: number): ReactNode {
  return <IntegrationMark logo={logo} size={size} />;
}

/** The service's name as it brands itself; never translated. */
export const INTEGRATION_NAMES: Record<IntegrationLogo, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  gohighlevel: 'HighLevel',
  'google-sheets': 'Google Sheets',
  calendly: 'Calendly',
  dcal: 'dCal',
  dapta: 'Dapta',
};

/** One service's mark, as the rail and the Home's integrations banner draw it. */
export function IntegrationMark({ logo, size }: { logo: IntegrationLogo; size: number }): ReactNode {
  switch (logo) {
    case 'google-sheets':
      return <GoogleSheetsLogo size={size} />;
    case 'gohighlevel':
      return <GoHighLevelLogo size={size} />;
    case 'dcal':
      // A wordmark about 1.6:1, so it is sized by its width to fit the square.
      return <DcalLogo width={size} />;
    case 'dapta':
      return <DaptaMark width={size} height={size} />;
    default:
      return <ProviderLogo provider={logo} size={size} />;
  }
}

/**
 * The icon of the rail's Integrations item: the marks of the services dForms
 * connects to, taking turns with the same crossfade, timing and rules as the
 * "Connect your agent" logos (`useLogoRotation`, the `.mcp-logos` styles):
 * still while the pointer is on the row, never moving under
 * `prefers-reduced-motion` (HubSpot is then the icon), and a fixed square, so
 * nothing around it shifts while it turns.
 *
 * Decoration only: the row's label ("Integrations") is its accessible name, so
 * the stack is `aria-hidden` and a screen reader hears one stable name.
 */
export function IntegrationLogos({
  size = 20,
  paused = false,
  daptaBrand = IS_DAPTA_BRAND,
}: {
  size?: number;
  paused?: boolean;
  /** Whether Dapta's mark takes a turn. A Dapta build by default. */
  daptaBrand?: boolean;
}) {
  const logos = integrationLogosFor(daptaBrand);
  const index = useLogoRotation(logos.length, { paused, delayMs: OFFSET_MS });
  return (
    <span
      aria-hidden
      data-testid="integration-logos"
      className="mcp-logos shrink-0"
      style={{ width: size, height: size }}
    >
      {logos.map((logo, i) => (
        <span
          key={logo}
          data-logo={logo}
          data-active={i === index ? 'true' : undefined}
          className={`mcp-logos__logo flex items-center justify-center${i === index ? ' is-active' : ''}`}
        >
          {mark(logo, size)}
        </span>
      ))}
    </span>
  );
}
