'use client';

/**
 * Opens one uploaded file from the submissions table.
 *
 * The URL is fetched on click rather than rendered into the page, and that is
 * the point: a download link is a signed URL that expires in minutes, so a
 * table of fifty rows rendered with fifty live URLs would be fifty credentials
 * sitting in the HTML, most of them dead by the time anyone clicked. Asking for
 * one at the moment of the click means the link is always fresh and never
 * exists anywhere it does not need to.
 */
import { useState } from 'react';
import { submissionFileUrlAction } from './actions';
import { callAction, isTransportError } from '@/lib/call-action';

export function DownloadFileButton({
  formId,
  submissionId,
  stepKey,
  name,
  labels,
}: {
  formId: string;
  submissionId: string;
  stepKey: string;
  /** The respondent's own filename, which is the only useful label. */
  name: string;
  labels: { download: string; failed: string };
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    const r = await callAction(() => submissionFileUrlAction(formId, submissionId, stepKey));
    setBusy(false);
    if (isTransportError(r) || !r.ok) {
      setFailed(true);
      return;
    }
    // A new tab, not a navigation: the signed URL responds as an attachment,
    // so the tab closes itself once the download starts and the dashboard page
    // the person was reading is still there behind it.
    window.open(r.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      title={failed ? labels.failed : `${labels.download}: ${name}`}
      className="inline-flex max-w-full items-center gap-1.5 truncate text-left underline decoration-dotted underline-offset-2 hover:decoration-solid disabled:opacity-60"
    >
      <i aria-hidden className="pi pi-paperclip shrink-0" style={{ fontSize: 11 }} />
      <span className="truncate">{name}</span>
    </button>
  );
}
