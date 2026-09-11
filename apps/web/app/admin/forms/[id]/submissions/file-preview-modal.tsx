'use client';

/**
 * Show one uploaded file without leaving the submissions table.
 *
 * Which viewer runs is decided by the API, not here: `file.kind` arrives with
 * the signed URLs, and the URL for anything rendered from the URL itself was
 * signed with a Content-Type the API derived from the verified extension. So
 * this component never asks "what is this file", it only draws what it is
 * handed. That is deliberate. Choosing a viewer is choosing what the browser
 * will execute, and that choice belongs on the side of the wire that checked
 * the bytes.
 *
 * Word is the exception and the reason this file is longer than a switch. No
 * browser renders a .docx, so the bytes are fetched, converted to HTML here,
 * and dropped into an iframe with an empty `sandbox`. Without `allow-scripts`
 * nothing in a stranger's document runs, and without `allow-same-origin` it
 * could not reach this origin if it did. The isolation is the control, which is
 * why the markup is not hand-sanitised: a blocklist would have to stay ahead of
 * every input, and this does not.
 */
import { useEffect, useState } from 'react';
import type { SubmissionFile } from '@quill/types';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';

export interface PreviewLabels {
  loading: string;
  failed: string;
  reload: string;
  unavailable: string;
  approx: string;
  close: string;
  download: string;
}

/** The Word conversion. Every other kind draws straight from its URL. */
export type DocxState = { kind: 'loading' } | { kind: 'ready'; html: string } | { kind: 'failed' };

/** Bytes as a person would say them. Units read the same in both locales. */
export function readableSize(bytes: string): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

/**
 * Every framed kind paints its own background once it loads: a PDF viewer its
 * chrome, plain text the browser's default, a converted Word file the white
 * page its own stylesheet sets. This token only shows in the moment before
 * that, so it follows the dashboard's theme rather than flashing white in it.
 */
const FRAME = 'h-full w-full rounded-md border border-border bg-background';

/**
 * The dialog's body and footer, with every decision already made.
 *
 * Split out because the web app's vitest runs in plain node with no DOM, so a
 * component that fetches and converts on mount cannot be rendered in a test.
 * This half can, and it is the half with the rules in it.
 */
export function FilePreviewView({
  file,
  docx,
  broken,
  busy,
  labels,
  onBroken,
  onReload,
  onDownload,
  onClose,
}: {
  file: SubmissionFile;
  docx: DocxState;
  /** The image or frame reported an error, most often an expired signature. */
  broken: boolean;
  busy: boolean;
  labels: PreviewLabels;
  onBroken: () => void;
  onReload: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const size = readableSize(file.size);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-[70dvh] items-center justify-center overflow-auto rounded-lg border border-border bg-muted/30 p-2 sm:h-[75dvh]">
        <PreviewBody
          file={file}
          docx={docx}
          broken={broken}
          labels={labels}
          onBroken={onBroken}
          onReload={onReload}
        />
      </div>

      {file.kind === 'docx' && docx.kind === 'ready' ? (
        <p className="text-xs text-muted-foreground">{labels.approx}</p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs text-muted-foreground">{size}</span>
        <span className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {labels.close}
          </Button>
          <Button size="sm" onClick={onDownload} disabled={busy} data-testid="preview-download">
            <i aria-hidden className="pi pi-download" style={{ fontSize: 12 }} />
            {labels.download}
          </Button>
        </span>
      </div>
    </div>
  );
}

function PreviewBody({
  file,
  docx,
  broken,
  labels,
  onBroken,
  onReload,
}: {
  file: SubmissionFile;
  docx: DocxState;
  broken: boolean;
  labels: PreviewLabels;
  onBroken: () => void;
  onReload: () => void;
}) {
  // A signature lives minutes, so a dialog left open long enough will fail on
  // its next load. Reloading re-mints rather than retrying the dead URL.
  if (broken) return <Failed message={labels.failed} reload={labels.reload} onReload={onReload} />;
  if (!file.previewUrl) return <Unavailable message={labels.unavailable} />;

  switch (file.kind) {
    case 'image':
      return (
        <img
          src={file.previewUrl}
          alt={file.name}
          onError={onBroken}
          data-testid="preview-image"
          className="max-h-full max-w-full object-contain"
        />
      );
    case 'pdf':
    case 'text':
      return (
        <iframe
          src={file.previewUrl}
          title={file.name}
          onError={onBroken}
          data-testid={`preview-${file.kind}`}
          className={FRAME}
        />
      );
    case 'docx':
      if (docx.kind === 'failed') {
        return <Failed message={labels.failed} reload={labels.reload} onReload={onReload} />;
      }
      if (docx.kind === 'ready') {
        return (
          <iframe
            title={file.name}
            sandbox=""
            srcDoc={docx.html}
            data-testid="preview-docx"
            className={FRAME}
          />
        );
      }
      return <Loading message={labels.loading} />;
    default:
      return <Unavailable message={labels.unavailable} />;
  }
}

function Loading({ message }: { message: string }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid="preview-loading">
      {message}
    </p>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <p
      className="max-w-sm px-6 text-center text-sm text-muted-foreground"
      data-testid="preview-none"
    >
      {message}
    </p>
  );
}

function Failed({
  message,
  reload,
  onReload,
}: {
  message: string;
  reload: string;
  onReload: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 text-center" data-testid="preview-failed">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onReload}>
        {reload}
      </Button>
    </div>
  );
}

/**
 * Wrap the converted fragment in a whole document, because an iframe with an
 * empty `sandbox` has no access to this page's stylesheet and would otherwise
 * render a Word file in Times New Roman at the very top left corner.
 */
function docxDocument(body: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'body{margin:0;padding:32px 40px;font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff}',
    'h1,h2,h3{line-height:1.25;margin:1.4em 0 .5em}',
    'p{margin:0 0 .9em}',
    'img{max-width:100%;height:auto}',
    'table{border-collapse:collapse;margin:1em 0}',
    'td,th{border:1px solid #d4d4d4;padding:6px 10px;text-align:left}',
    '</style></head><body>',
    body,
    '</body></html>',
  ].join('');
}

export function FilePreviewModal({
  file,
  labels,
  busy,
  onReload,
  onDownload,
  onClose,
}: {
  file: SubmissionFile;
  labels: PreviewLabels;
  busy: boolean;
  onReload: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [docx, setDocx] = useState<DocxState>({ kind: 'loading' });
  const [broken, setBroken] = useState(false);

  const previewUrl = file.previewUrl;
  const isDocx = file.kind === 'docx';

  useEffect(() => {
    setBroken(false);
    if (!isDocx || !previewUrl) return;

    let alive = true;
    setDocx({ kind: 'loading' });
    void (async () => {
      try {
        const res = await fetch(previewUrl);
        if (!res.ok) throw new Error(String(res.status));
        const arrayBuffer = await res.arrayBuffer();
        // Loaded here and nowhere else, so the roughly half a megabyte this
        // costs is paid by the person who opened a Word file and by nobody
        // else who ever looks at this table.
        const mammoth = await import('mammoth');
        const out = await mammoth.convertToHtml({ arrayBuffer });
        if (alive) setDocx({ kind: 'ready', html: docxDocument(out.value) });
      } catch {
        // Usually the bucket allows PUT from this origin but not GET, which an
        // <img> or an <iframe> never needed and a fetch does. Nothing here can
        // tell that apart from a corrupt file, and it does not matter: the next
        // move is the download either way.
        if (alive) setDocx({ kind: 'failed' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [isDocx, previewUrl]);

  return (
    <Modal open onClose={onClose} title={file.name} labelId="file-preview-title" size="2xl">
      <FilePreviewView
        file={file}
        docx={docx}
        broken={broken}
        busy={busy}
        labels={labels}
        onBroken={() => setBroken(true)}
        onReload={onReload}
        onDownload={onDownload}
        onClose={onClose}
      />
    </Modal>
  );
}
