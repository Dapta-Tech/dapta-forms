import { publicTitle } from '@quill/engine';
import { getMessages, t } from '@quill/shared';
import { ImageResponse } from 'next/og';
import { headers } from 'next/headers';
import { getPublicForm } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import { selfHost } from '@/lib/request-origin';
import { cardFonts } from '@/lib/og-fonts';
import { daptaFormsMark, DAPTA_FORMS_MARK_RATIO } from '@/lib/og-brand';
import { remoteImageDataUri } from '@/lib/og-remote-image';
import { backgroundScrim, resolveCardStyle } from '@/lib/og-card';

/**
 * The form's social-share card.
 *
 * A form is shared as a link far more often than it is visited from a search
 * result, so this image is the first impression for most respondents. It is
 * generated from the form's OWN design — palette, typeface, corner radius,
 * button style, background treatment, logo — so the card and the page it opens
 * are recognisably one thing, and choosing a colour in the Design tab restyles
 * the share card too with nothing to upload. `lib/og-card.ts` is where that
 * translation lives; this file only lays it out.
 *
 * `branding.ogImage` overrides it entirely for an author who has a designed
 * asset; that path is handled in `generateMetadata`, which points `openGraph` at
 * their URL instead of this route.
 */
export const runtime = 'nodejs';
export const alt = 'Form';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Truncate on a WORD boundary.
 *
 * A cut mid-word is the single loudest tell that an image was generated rather
 * than designed, and headlines here are author text of unbounded length. Falls
 * back to the hard cut only when the last space is so early that word-breaking
 * would throw most of the line away.
 */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[,;:.\s]+$/, '')}…`;
}

export default async function OgImage({
  params,
}: {
  // `params` is a Promise in this major. Typing it as a plain object and reading
  // it synchronously is not a compile error — nothing checks the shape a route
  // file declares — it just yields `undefined` for every key, which sent this
  // route to `/v1/public/forms/undefined/undefined`, took the 404, and rendered
  // the "no form" fallback for EVERY form on the platform.
  params: Promise<{ accountCode: string; slug: string }>;
}) {
  const { accountCode, slug } = await params;
  const form = await getPublicForm(accountCode, slug);

  const config = form?.config;
  const cover = config?.cover;
  const style = resolveCardStyle(config?.branding);
  const messages = getMessages(await publicLocale());

  const headline =
    cover?.headline?.trim() ||
    (form && config ? publicTitle(config, form.name) : null) ||
    messages.growth.shareCardUntitled;
  // The cover's own subheadline is the author's pitch; without one, the first
  // question is the truest preview of what the link asks for.
  const secondary = cover?.subheadline?.trim() || config?.steps?.[0]?.question?.trim() || '';
  const banner = cover?.bannerText?.trim() || '';
  const steps = config?.steps?.length ?? 0;

  // Both remote assets are optional and independent: a logo that cannot be drawn
  // must not cost the card its photograph, and vice versa.
  const [logo, backdrop] = await Promise.all([
    remoteImageDataUri(config?.branding?.logo ?? cover?.logo),
    remoteImageDataUri(style.backdropUrl),
  ]);

  const requestHeaders = await headers();
  const host = selfHost((name) => requestHeaders.get(name));

  const layers: string[] = [];
  if (backdrop) {
    const scrim = backgroundScrim(style, style.backdropOverlay);
    layers.push(`linear-gradient(${scrim}, ${scrim})`, `url(${backdrop})`);
  } else if (style.backgroundImage) {
    layers.push(style.backgroundImage);
  }

  const mark = daptaFormsMark(style.isDark);

  /**
   * Where the two marks go.
   *
   * The rail carries exactly one, and it is the author's whenever there is one
   * to draw. With no author logo the Dapta Forms mark takes the rail outright,
   * at the size the author's would have had — an earlier pass left a bare accent
   * bar up there instead, which on a card with nothing else in the rail read as
   * a stray dash rather than as a brand.
   *
   * The product mark then goes wherever the author's is not: opposite it in the
   * rail when the logo sits left, down to the meta row when it is centred and
   * there is no opposite end to take.
   */
  const railIsProductMark = !logo;
  const markHeight = railIsProductMark ? Math.round(style.logo.height * 0.62) : 22;
  const productMark = (
    <img
      src={mark}
      width={Math.round(markHeight * DAPTA_FORMS_MARK_RATIO)}
      height={markHeight}
      alt=""
    />
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '52px 60px',
          background: style.background,
          color: style.foreground,
          fontFamily: 'Card',
          ...(layers.length
            ? { backgroundImage: layers.join(', '), backgroundSize: 'cover', backgroundPosition: 'center' }
            : {}),
        }}
      >
        {/* Rail. A form that centres its logo centres it here too, and the Dapta
            Forms mark steps down to the footer rather than fighting it. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: style.logo.centered ? 'center' : 'space-between',
          }}
        >
          {logo ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                ...(style.logo.plate
                  ? {
                      background: style.logo.plate,
                      borderRadius: style.radii.logo,
                      padding: '10px 16px',
                    }
                  : {}),
              }}
            >
              {/* Width is left to Satori, which reads it off the file: the author's
                  logo has no fixed proportion and forcing one would squash it. */}
              <img src={logo} height={style.logo.height} alt="" />
            </div>
          ) : (
            productMark
          )}
          {logo && !style.logo.centered ? productMark : null}
        </div>

        {/* Body. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            alignItems: style.align,
            textAlign: style.align === 'center' ? 'center' : 'left',
          }}
        >
          {banner ? (
            <div
              style={{
                display: 'flex',
                background: style.accent,
                color: style.button.background === style.accent ? style.button.color : style.foreground,
                borderRadius: style.radii.chip,
                padding: '9px 16px',
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              {clip(banner, 52)}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              fontSize: 62,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            {clip(headline, 66)}
          </div>
          {secondary ? (
            <div style={{ display: 'flex', fontSize: 26, color: style.quiet, lineHeight: 1.3 }}>
              {clip(secondary, 104)}
            </div>
          ) : null}
        </div>

        {/* Base: the form's own progress signal, then the meta row. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Progress style={style} steps={steps} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 19, color: style.faint }}>
              {steps > 0 ? <div style={{ display: 'flex' }}>{t(messages.growth.shareCardSteps, { count: steps })}</div> : null}
              {host ? <div style={{ display: 'flex' }}>{host}</div> : null}
              {logo && style.logo.centered ? productMark : null}
            </div>
            <div
              style={{
                display: 'flex',
                background: style.button.background,
                color: style.button.color,
                borderRadius: style.radii.button,
                padding: '12px 24px',
                fontSize: 20,
                fontWeight: 700,
                ...(style.button.border ? { border: style.button.border } : {}),
              }}
            >
              {messages.renderer.start}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: cardFonts(style.font) },
  );
}

/**
 * The step signal, drawn the way the form draws it — `bar`, `dots`, `steps` or
 * nothing. A form whose author turned progress off does not get a progress bar
 * on its share card.
 */
function Progress({
  style,
  steps,
}: {
  style: ReturnType<typeof resolveCardStyle>;
  steps: number;
}) {
  if (steps < 1 || style.progress === 'none') return null;

  if (style.progress === 'dots') {
    // Capped: past ~18 the dots stop reading as a count and start reading as a
    // texture, and a 60-step form would run off the card.
    const shown = Math.min(steps, 18);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Array.from({ length: shown }, (_, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              width: 10,
              height: 10,
              borderRadius: 999,
              background: i === 0 ? style.accent : style.hairline,
            }}
          />
        ))}
      </div>
    );
  }

  if (style.progress === 'steps') {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      <div style={{ display: 'flex', fontSize: 18, fontWeight: 700, color: style.faint, letterSpacing: 1.2 }}>
        {`${pad(1)} / ${pad(steps)}`}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        height: 6,
        borderRadius: style.radii.pill,
        background: style.hairline,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: `${Math.max(100 / steps, 4)}%`,
          height: 6,
          borderRadius: style.radii.pill,
          background: style.accent,
        }}
      />
    </div>
  );
}
