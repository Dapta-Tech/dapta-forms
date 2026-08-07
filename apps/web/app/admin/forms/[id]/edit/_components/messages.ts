import type { FormsMessages } from '@quill/shared';

/** The editor message subtree passed from the server page into the client UI. */
export type EditorMessages = FormsMessages['admin']['editor'];

/**
 * Strings the pixel-accurate preview (F5) needs on top of the shared
 * `editor.preview` subtree. Co-located here for the same reason
 * `builder-messages.ts` exists: a handful of editor-only keys does not justify
 * threading them through the shared catalog in three places. Language policy is
 * unchanged — every user-facing string exists in EN **and** ES, and the
 * `PreviewExtraMessages` interface makes the compiler enforce key parity.
 */
export interface PreviewExtraMessages {
  /** Third preview width. The 481–768px band is a real third layout: below 481
   *  the form pads 24/16 and stacks from the top, from 769 it centres a fixed
   *  478px card, and between them it does neither. */
  tablet: string;
  /** Return the preview to the cover — the frame is walkable, so it can end up
   *  deep in the form (or parked on its own Submitting screen, which never
   *  completes because nothing may reach the server from a preview). */
  restart: string;
  /** Accessible label for the "390 × 844" readout: `{width}`, `{height}`. */
  viewport: string;
  /** Appended when the frame is too big for the panel: `{percent}`. */
  scaled: string;
}

const en: PreviewExtraMessages = {
  tablet: 'Tablet',
  restart: 'Restart preview',
  viewport: 'Preview viewport: {width} × {height} px',
  scaled: 'shown at {percent}% to fit',
};

const es: PreviewExtraMessages = {
  tablet: 'Tablet',
  restart: 'Reiniciar la vista previa',
  viewport: 'Ventana de la vista previa: {width} × {height} px',
  scaled: 'se muestra al {percent}% para que quepa',
};

const CATALOG: Record<'en' | 'es', PreviewExtraMessages> = { en, es };

/** Resolve the preview extras for a locale (unknown locales fall back to EN). */
export function getPreviewExtras(locale: string): PreviewExtraMessages {
  return CATALOG[locale === 'es' ? 'es' : 'en'];
}
