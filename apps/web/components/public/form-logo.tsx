'use client';

import { useState } from 'react';

/**
 * The form's logo in the top bar. Uses the per-form logo URL when set, else a
 * text fallback (the form name). No hardcoded tenant asset — the pilot's baked-in
 * Dapta logo is generalized to config-driven branding.
 */
export function FormLogo({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        className="pf__logo-img"
        height={32}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="pf__logo--fallback">
      {name}
      <span className="pf__logo-dot">.</span>
    </span>
  );
}
