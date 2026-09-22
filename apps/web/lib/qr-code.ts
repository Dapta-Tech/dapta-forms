import { renderSVG } from 'uqr';
import { sizeSvg } from './download-blob';

/**
 * QR codes for sharing a form in print and on screens.
 *
 * The URL encoded is exactly what Copy link copies, with no UTM parameters, so
 * a scanned code and a pasted link land on the same page. Error correction `M`
 * survives a smudged or partly covered print (about 15% of the code) without
 * making the code dense enough to fail on a phone held at arm's length, and a
 * four module quiet zone is what the spec asks for: scanners find the code by
 * its white margin, and `uqr`'s default of one module is too thin on a
 * busy background.
 */
const ECC = 'M';
const QUIET_ZONE = 4;

/** Side of the exported files, in pixels. Big enough for a poster. */
export const QR_EXPORT_PX = 1024;

/** The QR code for `url` as an SVG string with explicit `width` and `height`. */
export function qrSvg(url: string, px: number = QR_EXPORT_PX): string {
  return sizeSvg(renderSVG(url, { ecc: ECC, border: QUIET_ZONE }), px);
}

/** `<slug>-qr.png` or `<slug>-qr.svg`, so a folder of them sorts by form. */
export function qrFilename(slug: string, ext: 'png' | 'svg'): string {
  return `${slug || 'form'}-qr.${ext}`;
}
