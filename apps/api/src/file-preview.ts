/**
 * Whether one stored file can be shown in the dashboard, and as what.
 *
 * The decision is made from the file's EXTENSION, never from the `mime` on the
 * answer. That field is the string the browser typed when it asked for an
 * upload URL, and nothing on the way in ever checked it: `verifyAnswers` copies
 * it through verbatim, and the object's stored Content-Type is the same
 * unverified string. The extension is the one claim about a file that HAS been
 * checked, because `verifyObject` compares it against the file's own magic
 * bytes before the object is promoted out of staging.
 *
 * So this module is the only thing that decides what may be served inline, the
 * dashboard is told what it is getting rather than asking for it, and a visitor
 * cannot talk their way into rendering an upload as a page by naming a type.
 */
import type { PreviewKind } from '@quill/types';
import { canonicalExt, extensionOf } from './storage';

export interface PreviewPlan {
  kind: PreviewKind;
  /**
   * The Content-Type to force on the signed URL, for a file the browser renders
   * from the URL itself. Null when the dashboard reads the bytes and renders
   * them itself, which is what a .docx needs, and null when there is no
   * preview at all.
   */
  inlineContentType: string | null;
}

const NO_PREVIEW: PreviewPlan = { kind: 'none', inlineContentType: null };

/**
 * Extension to plan, for everything the browser can draw from a URL.
 *
 * Deliberately short. Every entry is a format a browser renders natively and
 * that cannot carry script, which is why svg is absent even though it is an
 * image: it is already refused at upload, and leaving it out here is the second
 * lock rather than a duplicate of the first. Formats a browser cannot draw
 * (tiff, heic, doc, xls, zip) are absent for the same reason they need no
 * entry: they fall through to a download, which is the honest answer.
 */
const INLINE: Record<string, PreviewPlan> = {
  png: { kind: 'image', inlineContentType: 'image/png' },
  jpg: { kind: 'image', inlineContentType: 'image/jpeg' },
  gif: { kind: 'image', inlineContentType: 'image/gif' },
  webp: { kind: 'image', inlineContentType: 'image/webp' },
  avif: { kind: 'image', inlineContentType: 'image/avif' },
  bmp: { kind: 'image', inlineContentType: 'image/bmp' },

  pdf: { kind: 'pdf', inlineContentType: 'application/pdf' },

  // Text is forced to text/plain whatever it claims to be. A .json or .xml
  // upload is never verified against anything (nothing detects a signature for
  // it), so the only safe way to show one is as characters rather than as a
  // document the browser might try to parse.
  txt: { kind: 'text', inlineContentType: 'text/plain; charset=utf-8' },
  csv: { kind: 'text', inlineContentType: 'text/plain; charset=utf-8' },
  tsv: { kind: 'text', inlineContentType: 'text/plain; charset=utf-8' },
  md: { kind: 'text', inlineContentType: 'text/plain; charset=utf-8' },
  log: { kind: 'text', inlineContentType: 'text/plain; charset=utf-8' },
  json: { kind: 'text', inlineContentType: 'text/plain; charset=utf-8' },
  xml: { kind: 'text', inlineContentType: 'text/plain; charset=utf-8' },
  yml: { kind: 'text', inlineContentType: 'text/plain; charset=utf-8' },

  // No browser renders a .docx. The dashboard fetches the bytes and converts
  // them itself, so there is nothing to force on the URL.
  docx: { kind: 'docx', inlineContentType: null },
};

/**
 * The ceiling on what is worth previewing, independent of the upload limit.
 *
 * `UPLOAD_MAX_FILE_MB` can be raised to 1 GB by a deployment that wants to
 * accept video, and a browser asked to open a 600 MB file in a dialog does not
 * fail, it just hangs while it downloads all of it. Past this, the answer is a
 * download, which at least shows progress.
 */
export const PREVIEW_MAX_BYTES = 25_000_000;

/** How to show one file, or `none` when the honest answer is a download. */
export function previewFor(filename: string, sizeBytes: number): PreviewPlan {
  const plan = INLINE[canonicalExt(extensionOf(filename))];
  if (!plan) return NO_PREVIEW;
  // A size of 0 means the answer did not carry one, not that the file is empty,
  // so an unknown size is allowed through rather than blocking on a missing
  // field. The real bytes are S3's problem either way.
  if (Number.isFinite(sizeBytes) && sizeBytes > PREVIEW_MAX_BYTES) return NO_PREVIEW;
  return plan;
}
