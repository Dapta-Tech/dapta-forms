/**
 * Brand marks for the integration providers, drawn INLINE.
 *
 * Not an <img> and not an icon font: a fork of this project has to run with no
 * network and no CDN reachable, and the CSP on the public pages blocks external
 * hosts outright. An inline path always renders.
 *
 * These are the OFFICIAL marks — HubSpot's sprocket and Calendly's ring — and
 * they replace a pair of geometric approximations drawn by hand. A logo that is
 * nearly right reads as a knock-off, which is a poor thing to sit beside a
 * prompt for someone's CRM credentials. The marks are the trademarks of
 * HubSpot, Inc. and Calendly LLC, used only to identify which service an
 * integration talks to — never as our own branding.
 *
 * `mono` drops the brand colour for `currentColor`, for places where a coloured
 * logo would fight the surrounding text (an inline mention, a disabled state).
 */

export type LogoProvider = 'hubspot' | 'calendly';

const BRAND: Record<LogoProvider, string> = {
  hubspot: '#FF7A59',
  calendly: '#006BFF',
};

/** Each mark is one filled path on a 24×24 grid, so `mono` is a single swap. */
const PATH: Record<LogoProvider, string> = {
  hubspot:
    'M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z',
  calendly:
    'M19.655 14.262c.281 0 .557.023.828.064 0 .005-.005.01-.005.014-.105.267-.234.534-.381.786l-1.219 2.106c-1.112 1.936-3.177 3.127-5.411 3.127h-2.432c-2.23 0-4.294-1.191-5.412-3.127l-1.218-2.106a6.251 6.251 0 0 1 0-6.252l1.218-2.106C6.736 4.832 8.8 3.641 11.035 3.641h2.432c2.23 0 4.294 1.191 5.411 3.127l1.219 2.106c.147.252.271.519.381.786 0 .004.005.009.005.014-.267.041-.543.064-.828.064-1.816 0-2.501-.607-3.291-1.306-.764-.676-1.711-1.517-3.44-1.517h-1.029c-1.251 0-2.387.455-3.2 1.278-.796.805-1.233 1.904-1.233 3.099v1.411c0 1.196.437 2.295 1.233 3.099.813.823 1.949 1.278 3.2 1.278h1.034c1.729 0 2.676-.841 3.439-1.517.791-.703 1.471-1.306 3.287-1.301Zm.005-3.237c.399 0 .794-.036 1.179-.11-.002-.004-.002-.01-.002-.014-.073-.414-.193-.823-.349-1.218.731-.12 1.407-.396 1.986-.819 0-.004-.005-.013-.005-.018-.331-1.085-.832-2.101-1.489-3.03-.649-.915-1.435-1.719-2.331-2.395-1.867-1.398-4.088-2.138-6.428-2.138-1.448 0-2.855.28-4.175.841-1.273.543-2.423 1.315-3.407 2.299S2.878 6.552 2.341 7.83c-.557 1.324-.842 2.726-.842 4.175 0 1.448.281 2.855.842 4.174.542 1.274 1.314 2.423 2.298 3.407s2.129 1.761 3.407 2.299c1.324.556 2.727.841 4.175.841 2.34 0 4.561-.74 6.428-2.137a10.815 10.815 0 0 0 2.331-2.396c.652-.929 1.158-1.949 1.489-3.03 0-.004.005-.014.005-.018-.579-.423-1.255-.699-1.986-.819.161-.395.276-.804.349-1.218.005-.009.005-.014.005-.023.869.166 1.692.506 2.404 1.035.685.505.552 1.075.446 1.416C22.184 20.437 17.619 24 12.221 24c-6.625 0-12-5.375-12-12s5.37-12 12-12c5.398 0 9.963 3.563 11.471 8.464.106.341.239.915-.446 1.421-.717.529-1.535.873-2.404 1.034.128.716.128 1.45 0 2.166-.387-.074-.782-.11-1.182-.11-4.184 0-3.968 2.823-6.736 2.823h-1.029c-1.899 0-3.15-1.357-3.15-3.095v-1.411c0-1.738 1.251-3.094 3.15-3.094h1.034c2.768 0 2.552 2.823 6.731 2.827Z',
};

/** The provider's own name, for the accessible label when one is asked for. */
const LABEL: Record<LogoProvider, string> = { hubspot: 'HubSpot', calendly: 'Calendly' };

export function ProviderLogo({
  provider,
  size = 18,
  mono = false,
  titled = false,
  className,
}: {
  provider: LogoProvider;
  size?: number;
  /** Inherit `currentColor` instead of painting the brand colour. */
  mono?: boolean;
  /**
   * Give the mark an accessible name. Only set this where the logo stands
   * ALONE — beside the provider's own name it is decoration, and announcing
   * "HubSpot HubSpot" is worse than announcing nothing.
   */
  titled?: boolean;
  className?: string;
}) {
  const name = LABEL[provider];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={titled ? 'img' : undefined}
      aria-label={titled ? name : undefined}
      aria-hidden={titled ? undefined : true}
      focusable="false"
      data-provider-logo={provider}
    >
      {titled ? <title>{name}</title> : null}
      <path d={PATH[provider]} fill={mono ? 'currentColor' : BRAND[provider]} />
    </svg>
  );
}
