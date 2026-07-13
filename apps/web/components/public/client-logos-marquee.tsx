'use client';

import { useState } from 'react';
import type { FormClientLogo } from '@quill/engine';

function LogoChip({ logo }: { logo: FormClientLogo }) {
  const [failed, setFailed] = useState(false);
  const showText = !logo.src || failed;
  return (
    <div className="pf-logos__chip">
      {!showText && logo.src ? (
        <img
          src={logo.src}
          alt={logo.name}
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
 * fallback); duplicated once for a seamless loop. Falls back to a static wrapped
 * row when the viewer prefers reduced motion (handled in CSS).
 */
export function ClientLogosMarquee({
  logos,
  label,
}: {
  logos: FormClientLogo[];
  label: string;
}) {
  if (!logos.length) return null;
  const items = [...logos, ...logos];
  return (
    <div className="pf-logos">
      {label ? <p className="pf-logos__label">{label}</p> : null}
      <div className="pf-logos__viewport">
        <div className="pf-logos__track">
          {items.map((logo, i) => (
            <LogoChip key={`${logo.name}-${i}`} logo={logo} />
          ))}
        </div>
      </div>
    </div>
  );
}
