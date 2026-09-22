'use client';

/**
 * The form's public link as a QR code, for flyers, badges and slides.
 *
 * In-person events send people to forms through printed codes, and until this
 * dialog those codes were made in some other tool from a pasted link. The code
 * encodes exactly what Copy link copies, so a scan and a click land on the same
 * page, and a later rename keeps printed codes working through `form_alias`.
 */
import { useMemo, useState } from 'react';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { saveBlob, svgDataUrl, svgToPngBlob } from '@/lib/download-blob';
import { QR_EXPORT_PX, qrFilename, qrSvg } from '@/lib/qr-code';

export interface QrLabels {
  qrTitle: string;
  qrIntro: string;
  qrAlt: string;
  qrDownloadPng: string;
  qrDownloadSvg: string;
  qrPngFailed: string;
  copyLink: string;
  copied: string;
}

/**
 * The dialog's body with everything already resolved.
 *
 * Split out because the web app's vitest runs in plain node with no DOM, and
 * the wrapper below reads `window.location` and builds files in the browser.
 * This half renders anywhere, and it is the half a person looks at.
 */
export function QrModalView({
  svg,
  url,
  copied,
  busy,
  failed,
  labels,
  onCopy,
  onDownloadPng,
  onDownloadSvg,
}: {
  svg: string;
  /** The absolute public URL, the one encoded in `svg`. */
  url: string;
  copied: boolean;
  /** The PNG is being rasterized. */
  busy: boolean;
  /** The last PNG attempt failed. */
  failed: boolean;
  labels: QrLabels;
  onCopy: () => void;
  onDownloadPng: () => void;
  onDownloadSvg: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{labels.qrIntro}</p>
      {/* An explicit white tile, not a theme token: `bg-popover` goes dark in
          dark mode, and scanners expect dark modules on a light ground. */}
      <div className="mx-auto rounded-lg border border-border bg-white p-2">
        <img
          src={svgDataUrl(svg)}
          alt={labels.qrAlt}
          width={224}
          height={224}
          className="block h-56 w-56"
          data-testid="qr-image"
        />
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 py-1 pl-3 pr-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
          title={url}
          data-testid="qr-url"
        >
          {url}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={copied ? labels.copied : labels.copyLink}
          title={copied ? labels.copied : labels.copyLink}
          data-testid="qr-copy-link"
        >
          <i
            aria-hidden
            className={`pi ${copied ? 'pi-check' : 'pi-copy'}`}
            style={{ fontSize: 12 }}
          />
        </button>
      </div>
      {failed ? (
        <p role="alert" className="text-xs text-destructive" data-testid="qr-png-failed">
          {labels.qrPngFailed}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDownloadSvg} data-testid="qr-download-svg">
          <i aria-hidden className="pi pi-download" style={{ fontSize: 12 }} />{' '}
          {labels.qrDownloadSvg}
        </Button>
        <Button onClick={onDownloadPng} disabled={busy} data-testid="qr-download-png">
          <i aria-hidden className="pi pi-download" style={{ fontSize: 12 }} />{' '}
          {labels.qrDownloadPng}
        </Button>
      </div>
    </div>
  );
}

/**
 * The link and its copy come from `LinkActions`, the one place that builds the
 * public URL, so the code, the row under it and the header's Copy link can
 * never disagree. Mounted only while open, so the URL is always read in the
 * browser and reflects a path a rename just handed back.
 */
export function QrModal({
  url,
  slug,
  copied,
  labels,
  onCopy,
  onClose,
}: {
  /** The absolute public URL, exactly what Copy link copies. */
  url: string;
  slug: string;
  copied: boolean;
  labels: QrLabels;
  onCopy: () => void;
  onClose: () => void;
}) {
  const svg = useMemo(() => qrSvg(url), [url]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const downloadSvg = () => {
    saveBlob(new Blob([svg], { type: 'image/svg+xml' }), qrFilename(slug, 'svg'));
  };

  const downloadPng = async () => {
    setBusy(true);
    setFailed(false);
    try {
      saveBlob(await svgToPngBlob(svg, QR_EXPORT_PX), qrFilename(slug, 'png'));
    } catch {
      // Rasterizing depends on the browser's canvas; the SVG path does not, so
      // the message points there instead of leaving a button that did nothing.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={labels.qrTitle} labelId="qr-form-title">
      <QrModalView
        svg={svg}
        url={url}
        copied={copied}
        busy={busy}
        failed={failed}
        labels={labels}
        onCopy={onCopy}
        onDownloadPng={() => void downloadPng()}
        onDownloadSvg={downloadSvg}
      />
    </Modal>
  );
}
