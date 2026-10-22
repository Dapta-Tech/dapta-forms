/**
 * Turn an uploaded photo or logo into a small inline image the page can store.
 *
 * The page renders the logo as a 96 to 112px circle, so a phone photo of
 * several megabytes is cropped to a centred square and redrawn at
 * `LOGO_PX`, then encoded as PNG (keeps a logo's transparency), else JPEG
 * (a photo), else WebP. PNG and JPEG first because the share card's renderer
 * cannot draw WebP. Returns null when nothing fits under `maxChars`.
 *
 * Browser only: it needs `createImageBitmap` and a canvas.
 */
export const LOGO_PX = 320;

export async function downscaleLogo(file: File, maxChars: number): Promise<string | null> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('unsupported image type');
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const out = Math.min(LOGO_PX, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
    for (const [type, quality] of [
      ['image/png', undefined],
      ['image/jpeg', 0.85],
      ['image/webp', 0.86],
    ] as const) {
      const url = canvas.toDataURL(type, quality);
      // `toDataURL` falls back to PNG for a type it cannot write; that is fine.
      if (url.length <= maxChars) return url;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
