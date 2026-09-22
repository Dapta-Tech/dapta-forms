/**
 * Save bytes the browser built itself (not a URL the server can stream) as a
 * file, and rasterize an SVG to PNG for the places that will not take a vector.
 *
 * Browser only. Nothing here runs during render: both are called from a click.
 */

/** An SVG as a URL an `<img>` can load, with no request and no blob to revoke. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * How long the object URL outlives the click. The download is handed off
 * asynchronously, and Safari in particular reads the blob after `click()`
 * returns, so revoking straight away can cancel the file it just started.
 */
const REVOKE_AFTER_MS = 30_000;

/** Save a blob under `filename` through a transient `<a download>`. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // Attached for the click: Firefox ignores a click on a detached anchor.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** Resolve once the image has loaded AND decoded, so the canvas never draws a blank. */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('svg image failed to load'));
    img.src = src;
  });
  // `load` fires before decoding is guaranteed to be finished in Safari, and a
  // `drawImage` in that window paints nothing. Some WebKit builds also reject
  // `decode()` for SVG sources that are perfectly drawable, so a rejection here
  // is not fatal: the load above already proved the image is usable.
  await img.decode?.().catch(() => undefined);
  return img;
}

/**
 * Rasterize an SVG to a `px` x `px` PNG on an opaque white background.
 *
 * The SVG must already carry `width` and `height` on its root: Safari draws an
 * SVG with only a `viewBox` at 0 x 0. Sizing it is the caller's job (see
 * `qrSvg`), so there is one place that decides what the file looks like.
 *
 * White rather than transparent on purpose: a transparent PNG dropped onto a
 * dark slide or flyer turns a QR code's light modules dark, and scanners need
 * dark on light.
 */
export async function svgToPngBlob(svg: string, px: number): Promise<Blob> {
  const img = await loadImage(svgDataUrl(svg));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.drawImage(img, 0, 0, px, px);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob) return blob;
  // `toBlob` hands back null on some older WebKit builds instead of failing
  // loudly. The data URL path produces the same bytes.
  const res = await fetch(canvas.toDataURL('image/png'));
  return res.blob();
}
