'use client';

/**
 * The control on a file answer's cell: open the file, or fetch it.
 *
 * The URLs are asked for on click rather than rendered into the page, and that
 * is the point: a signed URL expires in minutes, so a table of fifty rows
 * rendered with fifty live URLs would be fifty credentials sitting in the HTML,
 * most of them dead by the time anyone clicked. Asking at the moment of the
 * click means the link is always fresh and never exists anywhere it does not
 * need to.
 *
 * One click, then a fork. A type the API can show opens the dialog; a type it
 * cannot (a spreadsheet, an archive, a Word file older than 2007) downloads
 * straight away, as it always did. The alternative was a dialog whose only
 * content is a download button, which is a click of ceremony in front of the
 * thing the person already asked for.
 */
import { useState } from 'react';
import type { SubmissionFile } from '@quill/types';
import { submissionFileUrlAction } from './actions';
import { FilePreviewModal, type PreviewLabels } from './file-preview-modal';
import { callAction, isTransportError } from '@/lib/call-action';

export interface FileButtonLabels extends PreviewLabels {
  downloadFailed: string;
}

export function SubmissionFileButton({
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
  labels: FileButtonLabels;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [file, setFile] = useState<SubmissionFile | null>(null);

  /** Ask for a fresh pair of URLs. Null when the answer is "you cannot have it". */
  const mint = async (): Promise<SubmissionFile | null> => {
    setBusy(true);
    setFailed(false);
    const r = await callAction(() => submissionFileUrlAction(formId, submissionId, stepKey));
    setBusy(false);
    if (isTransportError(r) || !r.ok) {
      setFailed(true);
      return null;
    }
    return r.file;
  };

  /**
   * A new tab, not a navigation: the download URL responds as an attachment, so
   * the tab closes itself once the transfer starts and the table the person was
   * reading is still there behind it.
   */
  const save = (url: string): void => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const open = async (): Promise<void> => {
    const next = await mint();
    if (!next) return;
    if (next.kind === 'none') {
      save(next.url);
      return;
    }
    setFile(next);
  };

  // Re-minted rather than reusing what the dialog was opened with. A dialog can
  // sit open longer than a signature lives, and the download is the one action
  // that must not fail after the person decided to keep the file.
  const download = async (): Promise<void> => {
    const fresh = await mint();
    if (fresh) save(fresh.url);
  };

  const reload = async (): Promise<void> => {
    const fresh = await mint();
    if (fresh) setFile(fresh);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        title={failed ? labels.downloadFailed : `${labels.download}: ${name}`}
        className="inline-flex max-w-full items-center gap-1.5 truncate text-left underline decoration-dotted underline-offset-2 hover:decoration-solid disabled:opacity-60"
      >
        <i aria-hidden className="pi pi-paperclip shrink-0" style={{ fontSize: 11 }} />
        <span className="truncate">{name}</span>
      </button>

      {file ? (
        <FilePreviewModal
          file={file}
          labels={labels}
          busy={busy}
          onReload={() => void reload()}
          onDownload={() => void download()}
          onClose={() => setFile(null)}
        />
      ) : null}
    </>
  );
}
