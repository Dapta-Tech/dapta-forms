'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { referralShareLinks, type FormsMessages, type ReferralShareChannel } from '@quill/shared';
import { Modal } from '@/components/modal';
import { buttonVariants } from '@/components/ui/button';
import { captureEvent } from '@/lib/product-analytics';
import { BadgePill, ReferralTrack } from './referral-banner';
import { surfaceProps, useReferralCopy, type ReferralSurface } from './use-referral-copy';
import './referral-banner.css';

export type ReferralMessages = FormsMessages['admin']['chrome']['referral'];

/** Fill `{count}` / `{goal}` in a referral string. */
export function fillReferral(template: string, values: { count: number; goal: number }): string {
  return template.replaceAll('{count}', String(values.count)).replaceAll('{goal}', String(values.goal));
}

/**
 * The brand marks, inline: the icon sheet is Lucide outlines, which carry no
 * brand logos. Decorative; the button's text names the channel.
 */
function WhatsAppMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12.04 2a9.93 9.93 0 0 0-8.5 15.06L2 22l5.06-1.5A9.94 9.94 0 1 0 12.04 2Zm0 18.13a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3 .9.9-2.93-.2-.31a8.21 8.21 0 1 1 6.8 3.67Zm4.5-6.15c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.55.12-.16.25-.63.8-.78.97-.14.16-.29.18-.53.06a6.7 6.7 0 0 1-3.32-2.9c-.25-.43.25-.4.71-1.33.08-.16.04-.3-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.74 2.74 0 0 0-.86 2.04 4.76 4.76 0 0 0 1 2.53 10.9 10.9 0 0 0 4.17 3.68c1.55.67 2.16.73 2.94.61.47-.07 1.46-.6 1.66-1.17.2-.58.2-1.07.15-1.17-.06-.11-.22-.17-.46-.29Z" />
    </svg>
  );
}

function XMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
    </svg>
  );
}

const CHANNELS: { channel: ReferralShareChannel; icon: ReactNode }[] = [
  { channel: 'whatsapp', icon: <WhatsAppMark /> },
  {
    channel: 'email',
    icon: <i aria-hidden className="pi pi-envelope" style={{ fontSize: 14 }} />,
  },
  { channel: 'x', icon: <XMark /> },
];

/**
 * The referral dialog, the one place the program is explained and shared
 * from. The menu entry, the banner (its call to action and its "?") and the
 * locked badge switch all open it. In order: the badge (a mini form with the
 * pill highlighted at its foot, and what it is), how it works in three steps,
 * the person's progress on the same flowing bar as the banner, their link
 * with a copy button, and WhatsApp, email and X with the message already
 * written in the reader's language.
 *
 * Opening it records `referral_dialog_opened`; each copy and share is recorded
 * too, all with the surface it was opened from when the caller says.
 */
export function ReferralShareModal({
  open,
  onClose,
  link,
  count,
  goal,
  badgeLabel,
  m,
  surface,
}: {
  open: boolean;
  onClose: () => void;
  link: string;
  count: number;
  goal: number;
  /** The badge's localized label (`growth.madeWith`). */
  badgeLabel: string;
  m: ReferralMessages;
  /** Where it was opened from, carried on the open, copy and share events. */
  surface?: ReferralSurface;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { copied, copy: copyLink, reset } = useReferralCopy(link, surface);
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);
  useEffect(() => {
    if (open) captureEvent('referral_dialog_opened', surfaceProps(surface));
  }, [open, surface]);

  const copy = async () => {
    if (await copyLink()) return;
    // No clipboard (an insecure origin, a denied permission): hand the link
    // over selected, so the keyboard shortcut copies it.
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const shares = referralShareLinks(link, m.share);
  const values = { count, goal };
  const labelId = 'referral-share-title';
  const steps = [m.steps.share, m.steps.signup, fillReferral(m.steps.goal, values).replaceAll('{badge}', badgeLabel)];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.title}
      labelId={labelId}
      portal
      bare
      panelClassName="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto rounded-xl border border-border bg-popover shadow-lg"
    >
      <div data-testid="referral-modal" className="rb-theme relative flex flex-col gap-5 p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label={m.close}
          title={m.close}
          data-testid="referral-close"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
        >
          <i aria-hidden className="pi pi-times" style={{ fontSize: 14 }} />
        </button>
        <div className="pr-10">
          <h2 id={labelId} className="text-lg font-semibold leading-snug text-foreground">
            {m.title}
          </h2>
        </div>

        <div data-testid="referral-badge" className="grid grid-cols-[132px_1fr] items-center gap-4">
          <div className="rb-mock" aria-hidden="true">
            <div className="rb-mock-line" style={{ width: '55%' }} />
            <div className="rb-mock-line rb-mock-line-sub" style={{ width: '80%' }} />
            <div className="rb-mock-input" />
            <div className="rb-mock-cta" />
            <BadgePill label={badgeLabel} className="rb-mock-pill" testId="referral-mock-pill" />
          </div>
          <p className="text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground">{m.badgeTitle}</strong> {m.badgeBody}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">{m.stepsTitle}</h3>
          <ol data-testid="referral-steps" className="flex flex-col gap-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-foreground">
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-foreground"
                >
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-4">
          <ReferralTrack
            count={count}
            goal={goal}
            label={fillReferral(m.progressLabel, values)}
            testId="referral-track"
          />
          <p data-testid="referral-progress" className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
            {fillReferral(m.progressCount, values)}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="referral-link-input" className="text-sm font-medium text-foreground">
            {m.linkLabel}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              id="referral-link-input"
              data-testid="referral-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={copy}
              data-testid="referral-copy"
              aria-live="polite"
              className={`${buttonVariants({ variant: 'default' })} h-11 shrink-0`}
            >
              {copied ? m.copied : m.copy}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{m.shareOn}</p>
          <ul className="grid grid-cols-3 gap-2">
            {CHANNELS.map(({ channel, icon }) => (
              <li key={channel}>
                <a
                  href={shares[channel]}
                  // A mailto: hands off to the mail app; a new tab would stay blank.
                  {...(channel === 'email' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                  data-testid={`referral-share-${channel}`}
                  onClick={() =>
                    captureEvent('referral_link_shared', {
                      channel,
                      ...surfaceProps(surface),
                    })
                  }
                  className={`${buttonVariants({ variant: 'outline' })} h-11 w-full`}
                >
                  {icon}
                  {m[channel]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
