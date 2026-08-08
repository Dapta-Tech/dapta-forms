'use client';

import { useEffect, useRef } from 'react';
import Script from 'next/script';
import {
  buildAnalyticsSnippet,
  identifyMember,
  type AnalyticsIdentity,
  type ResolvedProductAnalytics,
} from '@/lib/product-analytics';

/**
 * Loads product analytics for the ADMIN dashboard and attaches the signed-in
 * member's identity to the session.
 *
 * Mounted from `app/admin/layout.tsx` ONLY. Public form pages must never load
 * it: a respondent is not a user of this product, and capturing them would both
 * pollute our own funnels and quietly send a form owner's traffic to our
 * analytics project. The admin layout is the boundary that guarantees this.
 *
 * Renders nothing at all when `analytics.key` is null (the default, and every
 * bare fork) — no script tag, no request.
 */
export function ProductAnalytics({
  analytics,
  identity,
}: {
  analytics: ResolvedProductAnalytics;
  identity: AnalyticsIdentity;
}) {
  const { key, host } = analytics;
  const { email, memberId, accountId, accountCode, role, attribution } = identity;

  // `attribution` is an OBJECT, re-created by every RSC payload, so depending on
  // it directly would re-run the effect — and re-identify the session — on every
  // render. The effect depends on a value-derived STRING instead and reads the
  // object through a ref, which is what keeps "re-run when the tags actually
  // change" and "do not re-run when only the reference changed" both true.
  const attributionKey = attribution ? JSON.stringify(attribution) : '';
  const attributionRef = useRef(attribution);
  attributionRef.current = attribution;

  useEffect(() => {
    if (!key) return;
    // The vendor's loader stub queues calls made before the real script
    // finishes downloading, so identifying here is safe on first paint and
    // needs no readiness check.
    identifyMember({
      email,
      memberId,
      accountId,
      accountCode,
      role,
      attribution: attributionRef.current,
    });
    // Re-runs on a workspace switch: `account_id` is a super property and a
    // group, so it has to follow the member into the workspace they are
    // actually looking at, or every event after a switch is filed under the
    // wrong account. The campaign tags are a property of that same WORKSPACE and
    // change with it, which is why `attributionKey` is here too.
  }, [key, email, memberId, accountId, accountCode, role, attributionKey]);

  if (!key) return null;

  return (
    <Script id="product-analytics" data-testid="product-analytics" strategy="afterInteractive">
      {buildAnalyticsSnippet(key, host)}
    </Script>
  );
}
