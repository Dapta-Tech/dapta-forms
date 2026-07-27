import { ImageResponse } from 'next/og';
import { clampAccent, readableOn, DEFAULT_CANVAS, DEFAULT_CANVAS_FOREGROUND } from '@quill/shared';
import { getPublicForm } from '@/lib/api';

/**
 * The form's social-share card.
 *
 * A form is shared as a link far more often than it is visited from a search
 * result, so this image is the first impression for most respondents — and
 * before this it did not exist, leaving every form to render as a bare text
 * card. It is generated from the form's own branding, so choosing a background
 * and an accent in the Design tab restyles the share card too, with nothing to
 * upload.
 *
 * `branding.ogImage` overrides it entirely for an author who has a designed
 * asset; that path is handled in `generateMetadata`, which points `openGraph`
 * at their URL instead of this route.
 */
export const runtime = 'nodejs';
export const alt = 'Form';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage({
  params,
}: {
  params: { accountCode: string; slug: string };
}) {
  const { accountCode, slug } = params;
  const form = await getPublicForm(accountCode, slug);

  const branding = form?.config.branding ?? {};
  const background = branding.background?.trim() || DEFAULT_CANVAS;
  const foreground = branding.foreground?.trim() || (branding.background ? readableOn(background) : DEFAULT_CANVAS_FOREGROUND);
  const accent = clampAccent(branding.primaryColor || '#cbe84f', background);

  const headline = form?.config.cover?.headline || form?.name || 'Form';
  const sub = form?.config.cover?.subheadline ?? '';
  const eyebrow = form?.config.cover?.eyebrow ?? form?.config.cover?.badge ?? '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background,
          color: foreground,
          padding: '80px 90px',
          // No custom font is loaded: `next/og` would need the font BINARY
          // fetched per render, and a share card that blocks on a third-party
          // file is worse than one set in the default face.
          fontFamily: 'sans-serif',
        }}
      >
        {/* The accent reads as a brand mark rather than as text, so it needs no
            contrast against the ground beyond the 3:1 the clamp guarantees. */}
        <div style={{ display: 'flex', width: 96, height: 10, borderRadius: 999, background: accent }} />
        {eyebrow ? (
          <div
            style={{
              display: 'flex',
              marginTop: 36,
              fontSize: 26,
              letterSpacing: 3,
              textTransform: 'uppercase',
              opacity: 0.7,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            marginTop: eyebrow ? 16 : 40,
            fontSize: 68,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -1.5,
          }}
        >
          {headline.slice(0, 90)}
        </div>
        {sub ? (
          <div style={{ display: 'flex', marginTop: 26, fontSize: 30, opacity: 0.72, lineHeight: 1.35 }}>
            {sub.slice(0, 140)}
          </div>
        ) : null}
      </div>
    ),
    size,
  );
}
