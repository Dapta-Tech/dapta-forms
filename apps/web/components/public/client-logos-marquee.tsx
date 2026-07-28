'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormClientLogo } from '@quill/engine';

function LogoChip({ logo, dup }: { logo: FormClientLogo; dup?: boolean }) {
  const [failed, setFailed] = useState(false);
  const showText = !logo.src || failed;
  return (
    <div
      className={dup ? 'pf-logos__chip pf-logos__chip--dup' : 'pf-logos__chip'}
      aria-hidden={dup || undefined}
    >
      {!showText && logo.src ? (
        <img
          src={logo.src}
          alt={dup ? '' : logo.name}
          className="pf-logos__img"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{logo.name}</span>
      )}
    </div>
  );
}

/**
 * Optional "trusted by" marquee on the cover. Config-driven logos (image or text
 * fallback).
 *
 * The CSS loop translates the track by -50%, which is only seamless when each
 * HALF of the track is at least as wide as the viewport. With two or three
 * logos a single copy is far narrower than the 620px viewport, so the old
 * duplicate-once version scrolled a giant empty gap through the mask on every
 * cycle — it looked like the carousel "ended" and restarted. The set is now
 * repeated as many times as the measured widths require (a hidden one-set row
 * provides the copy width; re-measured on resize).
 *
 * Every chip beyond the first set is a visual duplicate: aria-hidden here, and
 * hidden entirely by the reduced-motion CSS so the static wrapped fallback
 * shows each logo exactly once.
 */
export function ClientLogosMarquee({
  logos,
  label,
}: {
  logos: FormClientLogo[];
  label: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Copies of the set per half-track. SSR renders 1 — exactly the old
  // duplicate-once layout — and the effect corrects it after hydration.
  const [setsPerHalf, setSetsPerHalf] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!viewport || !measure) return;
    const update = () => {
      const vw = viewport.offsetWidth;
      const oneSet = measure.scrollWidth;
      if (vw > 0 && oneSet > 0) setSetsPerHalf(Math.max(1, Math.ceil(vw / oneSet)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [logos]);

  if (!logos.length) return null;

  const totalSets = setsPerHalf * 2;
  return (
    <div className="pf-logos">
      {label ? <p className="pf-logos__label">{label}</p> : null}
      <div ref={viewportRef} className="pf-logos__viewport">
        {/* Hidden single-set row, purely for measuring one copy's width. */}
        <div ref={measureRef} className="pf-logos__track pf-logos__track--measure" aria-hidden>
          {logos.map((logo, i) => (
            <LogoChip key={`m-${logo.name}-${i}`} logo={logo} dup />
          ))}
        </div>
        <div className="pf-logos__track">
          {Array.from({ length: totalSets }, (_, s) =>
            logos.map((logo, i) => (
              <LogoChip key={`${s}-${logo.name}-${i}`} logo={logo} dup={s > 0} />
            )),
          )}
        </div>
      </div>
    </div>
  );
}
