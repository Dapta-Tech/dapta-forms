'use client';

import { useEffect, useState } from 'react';
import type { FormsMessages } from '@quill/shared';
import { buttonVariants } from '@/components/ui/button';
import {
  PLAYBOOK_PDF_PARAM,
  pendingPlaybookLocale,
  playbookPdfFileName,
  playbookPdfHref,
  withoutPdfParam,
  type PlaybookContentLocale,
} from '@/lib/playbooks';
import { captureEvent } from '@/lib/product-analytics';
import { cn } from '@/lib/cn';

/** One shared empty value, so the default never changes the effect's deps. */
const NO_CAMPAIGN: Record<string, string> = {};

/** Start a download the way a click on a link would. */
function startDownload(href: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * The PDF of the playbook being read: a button under its summary, and the
 * automatic download of `?pdf=1` (the return path of someone who asked for the
 * PDF on the landing's resource hub).
 *
 * `?pdf=1` starts the download once and leaves the address
 * (`history.replaceState`), so a reload or a shared link does not repeat it.
 * A page cannot tell whether a browser let a download through (the in-app
 * browsers of social networks often do not), so after an automatic one the
 * button becomes a notice with a large one that stays on screen.
 *
 * It waits while the page is being asked again in the person's stored language
 * (`pendingPlaybookLocale`), so the file is the one in the language read.
 */
export function PlaybookPdf({
  slug,
  category,
  locale,
  shownLocale,
  fallback,
  langInUrl,
  storageKey,
  m,
  campaign = NO_CAMPAIGN,
}: {
  slug: string;
  category: string;
  /** The language asked for: the address's, else the platform's. */
  locale: PlaybookContentLocale;
  /** The language of the text on screen (`es` when `fallback`): the file's. */
  shownLocale: string;
  fallback: boolean;
  /** The address named the language: a stored choice does not override a shared link. */
  langInUrl: boolean;
  storageKey: string;
  /** The copy in `shownLocale`. */
  m: FormsMessages['admin']['playbooks']['pdf'];
  /** The account's first-touch `utm_*` tags (`campaignProperties`). */
  campaign?: Record<string, string>;
}) {
  /** The playbook whose automatic download was started on this page. */
  const [started, setStarted] = useState<string | null>(null);
  const href = playbookPdfHref(slug, shownLocale);
  const fileName = playbookPdfFileName(slug, shownLocale);

  const record = (trigger: 'button' | 'auto') =>
    captureEvent('playbook_pdf_downloaded', {
      slug,
      category,
      locale: shownLocale,
      requested_locale: locale,
      fallback,
      trigger,
      ...campaign,
    });

  useEffect(() => {
    // The address is the record of what is left to do: once the parameter is
    // out of it, a second run of this effect finds nothing.
    const { pathname, search, hash } = window.location;
    if (new URLSearchParams(search).get(PLAYBOOK_PDF_PARAM) !== '1') return;
    if (pendingPlaybookLocale(langInUrl, storageKey, locale)) return;
    // `null` state, so the router takes the new address as its own and a later
    // refresh of this page does not bring the parameter back. Before the click:
    // a browser that opens the file in place of the page comes back without it.
    window.history.replaceState(null, '', withoutPdfParam(`${pathname}${search}${hash}`));
    setStarted(slug);
    record('auto');
    startDownload(href, fileName);
    // `record` reads the same props as the deps below.
  }, [slug, category, locale, shownLocale, fallback, langInUrl, storageKey, campaign, href, fileName]);

  const auto = started === slug;
  const link = (
    <a
      href={href}
      download={fileName}
      onClick={() => record('button')}
      data-testid="playbook-pdf-download"
      className={cn(
        buttonVariants(auto ? { variant: 'default', size: 'lg' } : { variant: 'outline' }),
        auto && 'h-12 w-full shrink-0 text-base sm:w-auto',
      )}
    >
      <i aria-hidden className="pi pi-download" style={{ fontSize: 16 }} />
      {auto ? m.noticeButton : m.download}
    </a>
  );

  return (
    <div lang={shownLocale} className="mt-6">
      {/* Always in the page, so a screen reader hears the notice arrive. */}
      <div role="status">
        {auto ? (
          <div
            data-testid="playbook-pdf-notice"
            className="flex flex-col gap-4 rounded-2xl border border-signal/40 bg-signal/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm leading-6 text-muted-foreground">
              <strong className="block text-base font-semibold text-foreground">{m.noticeTitle}</strong>
              {m.noticeBody}
            </p>
            {link}
          </div>
        ) : null}
      </div>
      {auto ? null : link}
    </div>
  );
}
