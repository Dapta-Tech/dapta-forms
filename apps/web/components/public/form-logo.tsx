'use client';

import { useState } from 'react';

/**
 * The form's logo in the top bar. Uses the per-form logo URL when set, else a
 * text fallback (the form name). No hardcoded tenant asset — the pilot's baked-in
 * Dapta logo is generalized to config-driven branding.
 *
 * `fallback` is what happens when there is no usable image. `'name'` prints the
 * form's name, which is right for the top bar: a form with no logo still needs a
 * header. `'none'` renders nothing, and exists for surfaces where the name would
 * be worse than silence — the name here is the ADMIN's name for the form, and a
 * respondent has no business reading "Q3 paid-ads lead gen v2" because an image
 * 404'd.
 */
export function FormLogo({
  src,
  name,
  fallback = 'name',
}: {
  src?: string | null;
  name: string;
  fallback?: 'name' | 'none';
}) {
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
  if (fallback === 'none') return null;
  return (
    <span className="pf__logo--fallback">
      {name}
      <span className="pf__logo-dot">.</span>
    </span>
  );
}
