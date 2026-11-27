'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FormsMessages } from '@quill/shared';
import { recordPlaybookSeenAction } from '@/app/admin/playbook-actions';
import { callAction } from '@/lib/call-action';
import {
  pendingPlaybookLocale,
  storePlaybookLocale,
  withPlaybookLang,
  type PlaybookContentLocale,
} from '@/lib/playbooks';
import { captureEvent } from '@/lib/product-analytics';
import { PlaybookLocaleToggle } from './playbook-locale-toggle';

/** One shared empty value, so the default never changes the effect's deps. */
const NO_CAMPAIGN: Record<string, string> = {};

/** The address of this page with `?lang=` set, keeping the rest and the hash. */
function hereWithLang(locale: PlaybookContentLocale): string {
  const { pathname, search, hash } = window.location;
  return withPlaybookLang(`${pathname}${search}${hash}`, locale);
}

/**
 * The reader's language toggle, and the record of the open.
 *
 * The page renders the language of the address (`?lang=`), else the
 * platform's. Without `?lang=`, the person's stored choice wins once on
 * screen: the page is asked again in that language (`router.replace`), and
 * the open is recorded only then, so `forms_playbook_opened` carries the
 * language that was read. A change from the toggle is kept in the browser and
 * in the address, and asks the page again; it never touches the platform's
 * language.
 *
 * The open is recorded once per playbook, whatever the language: the API
 * stores it by slug (`POST /v1/me/playbooks/:slug/seen`, which also emits the
 * server's `forms_playbook_viewed`), and the client emits
 * `forms_playbook_opened` for the funnel.
 */
export function PlaybookOpened({
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
  /** The language of the text on screen (`es` when `fallback`). */
  shownLocale: string;
  fallback: boolean;
  /** The address named the language: a stored choice does not override a shared link. */
  langInUrl: boolean;
  storageKey: string;
  m: FormsMessages['admin']['playbooks']['contentLanguage'];
  /** The account's first-touch `utm_*` tags (`campaignProperties`), on every event here. */
  campaign?: Record<string, string>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // What the toggle shows: the language asked for, or the one just picked while the page comes.
  const [picked, setPicked] = useState<PlaybookContentLocale>(locale);
  useEffect(() => setPicked(locale), [locale]);

  const done = useRef<string | null>(null);
  const checkedStored = useRef(false);
  // The language the page was asked again in, until it is on screen (a
  // strict-mode second run must not record the open in the first one).
  const waitFor = useRef<PlaybookContentLocale | null>(null);
  useEffect(() => {
    if (done.current === slug) return;
    if (!langInUrl && !checkedStored.current) {
      checkedStored.current = true;
      const stored = pendingPlaybookLocale(langInUrl, storageKey, locale);
      if (stored) {
        waitFor.current = stored;
        setPicked(stored);
        startTransition(() => router.replace(hereWithLang(stored), { scroll: false }));
        return;
      }
    }
    if (waitFor.current !== null && waitFor.current !== locale) return;
    done.current = slug;
    void callAction(() => recordPlaybookSeenAction(slug, locale));
    captureEvent('playbook_opened', {
      slug,
      category,
      locale: shownLocale,
      requested_locale: locale,
      fallback,
      ...campaign,
    });
  }, [slug, category, locale, shownLocale, fallback, langInUrl, storageKey, router, campaign]);

  const change = (next: PlaybookContentLocale) => {
    if (next === picked) return;
    waitFor.current = null;
    captureEvent('playbooks_locale_changed', { from: picked, to: next, surface: 'reader', slug, ...campaign });
    setPicked(next);
    storePlaybookLocale(storageKey, next);
    startTransition(() => router.replace(hereWithLang(next), { scroll: false }));
  };

  return <PlaybookLocaleToggle value={picked} onChange={change} m={m} />;
}
