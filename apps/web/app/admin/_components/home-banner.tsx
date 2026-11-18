import type { ReactNode } from 'react';
import './agent-promo.css';

/**
 * The Home's top row when it holds two banners side by side: the agents banner
 * and an announcement's banner (see `HomeTopRow`). Both use this frame, so
 * they share one structure, top to bottom: title and line, a sliding row of
 * logo chips, the button.
 *
 * In the two-column layout each banner is a three-row SUBGRID of the row, so
 * the two titles, the two chip rows and the two buttons line up across the
 * banners even when one title wraps to more lines than the other. Stacked, a
 * banner is a plain column.
 */
export function HomeBannerFrame({
  testId,
  labelId,
  title,
  body,
  marqueeTestId,
  chips,
  chipsLabel,
  cta,
  tone,
}: {
  testId: string;
  labelId: string;
  title: string;
  body: string;
  marqueeTestId: string;
  /** One copy of the chips; the frame draws it twice for a seamless loop. */
  chips: ReactNode;
  /** What a screen reader hears for the chips (the visible ones are decoration). */
  chipsLabel: string;
  cta: ReactNode;
  /**
   * `signal`: the green invitation the agents banner always was. `neutral`:
   * the same frame on the card's own surface, so two banners side by side
   * read as a pair and not as two of the same thing.
   */
  tone: 'signal' | 'neutral';
}) {
  return (
    <section
      aria-labelledby={labelId}
      data-testid={testId}
      data-layout="split"
      // `isolate` keeps the marquee's sliding track inside this banner's own
      // stacking context, as in agent-card.tsx.
      className={`relative isolate flex min-w-0 flex-col gap-5 overflow-hidden rounded-2xl border p-5 sm:p-6 @min-[60rem]:row-span-3 @min-[60rem]:grid @min-[60rem]:grid-rows-subgrid @min-[60rem]:gap-y-5 ${
        tone === 'signal'
          ? 'border-signal/40 bg-gradient-to-br from-signal/[0.12] via-signal/[0.05] to-card'
          : 'border-border bg-gradient-to-br from-muted/70 via-card to-card'
      }`}
    >
      <div className="min-w-0">
        <h2 id={labelId} className="text-lg font-semibold leading-snug text-foreground sm:text-xl">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="ap-marquee min-w-0 overflow-hidden" data-testid={marqueeTestId}>
        <p className="sr-only">{chipsLabel}</p>
        <div className="ap-marquee__track">
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              aria-hidden
              className={`flex shrink-0 items-center gap-3 pr-3${copy === 1 ? ' ap-marquee__copy' : ''}`}
            >
              {chips}
            </ul>
          ))}
        </div>
      </div>
      <div className="mt-auto flex min-w-0 items-end @min-[60rem]:mt-0">{cta}</div>
    </section>
  );
}

/** One chip of a banner's marquee: a mark and its name. */
export function BannerChip({ children }: { children: ReactNode }) {
  return (
    <li className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm">
      {children}
    </li>
  );
}

/**
 * The Home's top row. One banner: it takes the full width, as the agents
 * banner always did. Two: side by side when the content area is at least
 * 60rem wide (a 1280px window with the rail open), stacked below that, the
 * agents banner first. Measured on the content area, not the window, so the
 * open and the collapsed rail each get the layout that fits.
 */
export function HomeTopRow({ children, split }: { children: ReactNode; split: boolean }) {
  if (!split) return <>{children}</>;
  return (
    <div className="@container mb-8" data-testid="home-top-row">
      <div className="grid grid-cols-1 gap-6 @min-[60rem]:grid-cols-2 @min-[60rem]:grid-rows-[auto_auto_auto] @min-[60rem]:gap-y-0">
        {children}
      </div>
    </div>
  );
}
