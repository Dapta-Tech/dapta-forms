/**
 * Brand marks for the integration providers, drawn INLINE.
 *
 * Not an <img> and not an icon font: a fork of this project has to run with no
 * network and no CDN reachable, and the CSP on the public pages blocks external
 * hosts outright. An inline path always renders.
 *
 * These are simplified geometric marks — enough for someone scanning the page to
 * recognise which service a card belongs to, which the generic `pi-sync` and
 * `pi-calendar` glyphs never did. `mono` drops the brand colour and inherits
 * `currentColor` for places where a coloured logo would fight the surrounding
 * text (an inline mention, a disabled state).
 */

export type LogoProvider = 'hubspot' | 'calendly';

const BRAND: Record<LogoProvider, string> = {
  hubspot: '#FF7A59',
  calendly: '#006BFF',
};

export function ProviderLogo({
  provider,
  size = 18,
  mono = false,
  className,
}: {
  provider: LogoProvider;
  size?: number;
  /** Inherit `currentColor` instead of painting the brand colour. */
  mono?: boolean;
  className?: string;
}) {
  const color = mono ? 'currentColor' : BRAND[provider];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-provider-logo={provider}
    >
      {provider === 'hubspot' ? (
        // The sprocket: a wheel, the stem rising from it, and the crossbar of
        // nodes at the top. Read as a whole it is the HubSpot silhouette.
        <g stroke={color} strokeWidth={1.9} strokeLinecap="round">
          <circle cx="8.6" cy="16.4" r="5" />
          <path d="M8.6 11.4V7.2" />
          <path d="M8.6 7.2h9.2" />
          <circle cx="19.4" cy="7.2" r="2.1" fill={color} stroke="none" />
          <circle cx="8.6" cy="4.4" r="1.9" fill={color} stroke="none" />
        </g>
      ) : (
        // A thick open ring with squared terminals — the Calendly silhouette
        // without tracing the wordmark.
        <g stroke={color} strokeWidth={2.6} strokeLinecap="round">
          <path d="M17.6 7.8a6.4 6.4 0 1 0 0 8.4" />
          <path d="M19.6 5.6 17.2 8" />
          <path d="M19.6 18.4 17.2 16" />
        </g>
      )}
    </svg>
  );
}
