'use client';

import { Fragment, type ReactNode } from 'react';
import type { FormsMessages } from '@quill/shared';
import { BrandMark } from '@/components/brand/brand';
import { fillLock, type ReferralLock } from '@/lib/referral-lock';
import { useOpenReferralDialog } from './referral-dialog-context';
import { ReferralLinkField } from './referral-link-field';
import './referral-banner.css';

type AttributionMessages = FormsMessages['admin']['attributionSetting'];

/**
 * A replica of the real "Made with dForms" pill (the public form's
 * `.pf__attribution-link`): the product mark and the localized label, so a
 * person who never looked at the foot of their form sees what "the badge" is.
 * Not a link: it only shows the badge. It wears the banner's green chip
 * (`rb-chip`, in referral-banner.css), so it stands out from the setting.
 */
export function BadgePill({ label }: { label: string }) {
  return (
    <span
      data-testid="badge-pill"
      className="rb-chip mx-0.5 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-xs font-medium leading-tight shadow-sm"
    >
      <BrandMark className="h-3 w-auto shrink-0" />
      <span>{label}</span>
    </span>
  );
}

/** Split a template on `{token}` and put `node` where it was. */
function withNode(template: string, token: string, node: ReactNode): ReactNode[] {
  return template.split(token).flatMap((part, i) =>
    i === 0 ? [part] : [<Fragment key={i}>{node}</Fragment>, part],
  );
}

/**
 * Locked badge switch, referral program on: "Invite 5 or pay for Dapta AI"
 * (the product linked to its landing, as the subscribers note did), how the
 * referrals unlock it with the pill replica, a compact progress bar with the
 * count, and the person's link with a copy button.
 */
export function ReferralBadgeLock({
  lock,
  daptaAiUrl,
  madeWith,
  m,
  idPrefix,
  testId,
}: {
  lock: ReferralLock;
  daptaAiUrl: string | null;
  /** `growth.madeWith`: the badge's own label in the reader's language. */
  madeWith: string;
  m: AttributionMessages;
  /** Unique on the page, for the field's id. */
  idPrefix: string;
  testId: string;
}) {
  const { count, goal, link } = lock;
  // The shell's referral dialog (the share buttons), when there is one.
  const openDialog = useOpenReferralDialog();
  const shown = Math.min(count, goal);
  const product = daptaAiUrl ? (
    <a href={daptaAiUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
      {m.product}
    </a>
  ) : (
    m.product
  );
  const title = withNode(m.referralLocked.replaceAll('{goal}', String(goal)), '{product}', product);
  const body = withNode(m.referralLockedBody.replaceAll('{goal}', String(goal)), '{badge}', <BadgePill label={madeWith} />);
  return (
    <div data-testid={testId} className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
      <p data-testid={`${testId}-title`} className="text-sm font-medium text-foreground">
        {title}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      <div className="flex items-center gap-2">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={shown}
          aria-label={fillLock(m.referralProgress, { count: shown, goal, product: m.product })}
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-signal transition-[width]"
            style={{ width: `${Math.round((shown / Math.max(goal, 1)) * 100)}%` }}
          />
        </div>
        <span data-testid={`${testId}-progress`} className="shrink-0 text-xs font-medium tabular-nums text-foreground">
          {fillLock(m.referralProgress, { count: shown, goal, product: m.product })}
        </span>
      </div>
      <ReferralLinkField
        link={link}
        label={m.referralLinkLabel}
        copy={m.referralCopy}
        copied={m.referralCopied}
        inputId={`${idPrefix}-referral-link`}
        surface="badge_switch"
        share={m.referralShare}
        onShare={openDialog ? () => openDialog('badge_switch') : undefined}
      />
    </div>
  );
}
