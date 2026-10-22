import { ImageResponse } from 'next/og';
import { getPublicLinkPage } from '@/lib/api';
import { cardFonts } from '@/lib/og-fonts';
import { daptaFormsMark, DAPTA_FORMS_MARK_RATIO } from '@/lib/og-brand';
import { remoteImageDataUri } from '@/lib/og-remote-image';
import { resolveCardStyle } from '@/lib/og-card';
import { initialsOf, plausibleAccountCode } from '@/lib/public-page';

/**
 * The workspace link page's share card: its logo, name and bio on the brand
 * kit's colours and font, through the same translation the form's card uses
 * (`resolveCardStyle`). A route under `/api` rather than an
 * `opengraph-image` file in `app/[accountCode]`, because a metadata file there
 * would be inherited by every form page below it.
 *
 * The logo may be an uploaded image stored inline (a `data:` URI), which no
 * social network will fetch as `og:image`; drawing it here gives every page a
 * real image URL to point at. A remote logo goes through the same guarded
 * fetch the form card uses.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIZE = { width: 1200, height: 630 };
/** Same reuse window as the form's card: a fixed typo shows up within minutes. */
const CACHE_CONTROL = 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400';

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[,;:.\s]+$/, '')}…`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ accountCode: string }> },
): Promise<Response> {
  const { accountCode } = await ctx.params;
  const page = plausibleAccountCode(accountCode) ? await getPublicLinkPage(accountCode) : null;
  if (!page) return new Response(null, { status: 404 });

  const style = resolveCardStyle(page.branding);
  // The card renderer reads PNG, JPEG and GIF only. An uploaded WebP (the
  // editor's last resort for a large photo) falls back to the initials here.
  const logo = page.logo?.startsWith('data:')
    ? /^data:image\/(png|jpeg|gif);/.test(page.logo)
      ? page.logo
      : null
    : await remoteImageDataUri(page.logo);
  const mark = daptaFormsMark(style.isDark);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          padding: '60px 80px',
          background: style.background,
          color: style.foreground,
          fontFamily: 'Card',
          textAlign: 'center',
        }}
      >
        {logo ? (
          <img src={logo} width={168} height={168} alt="" style={{ borderRadius: 999, objectFit: 'cover' }} />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 168,
              height: 168,
              borderRadius: 999,
              background: style.button.background,
              color: style.button.color,
              fontSize: 64,
              fontWeight: 700,
            }}
          >
            {initialsOf(page.name)}
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
          {clip(page.name, 48)}
        </div>
        {page.bio ? (
          <div style={{ display: 'flex', fontSize: 28, color: style.quiet, lineHeight: 1.3, maxWidth: 900 }}>
            {clip(page.bio, 120)}
          </div>
        ) : null}
        <img src={mark} width={Math.round(24 * DAPTA_FORMS_MARK_RATIO)} height={24} alt="" style={{ marginTop: 12 }} />
      </div>
    ),
    { ...SIZE, fonts: cardFonts(style.font), headers: { 'cache-control': CACHE_CONTROL } },
  );
}
