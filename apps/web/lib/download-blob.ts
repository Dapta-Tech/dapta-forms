/**
 * Save bytes the browser built itself (not a URL the server can stream) as a
 * file, and rasterize an SVG to PNG for the places that will not take a vector.
 *
 * Browser only. Nothing here runs during render: both are called from a click.
 */

/**
 * Give an SVG explicit `width` and `height` on its root element.
 *
 * Generators such as `uqr` emit only a `viewBox`. That is enough for a page to
 * scale it, but an `<img>` loading it from a data URL has no intrinsic size to
 * go on, and Safari then draws it at 0 x 0, which turns the PNG export into an
 * empty white square. Any size already on the root is replaced, never doubled.
 */
export function sizeSvg(svg: string, px: number): string {
  return svg.replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
    const rest = attrs.replace(/\s(?:width|height)="[^"]*"/g, '');
    return `<svg width="${px}" height="${px}"${rest}>`;
  });
}

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
 * White rather than transparent on purpose: a transparent PNG dropped onto a
 * dark slide or flyer turns a QR code's light modules dark, and scanners need
 * dark on light.
 */
export async function svgToPngBlob(svg: string, px: number): Promise<Blob> {
  const img = await loadImage(svgDataUrl(sizeSvg(svg, px)));
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
