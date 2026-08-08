import type { Metadata } from 'next';
import { PreviewDocument } from './preview-document';

/**
 * `/preview` — the builder's device-preview document, loaded in a same-origin
 * iframe by `PreviewFrame` and by nothing else.
 *
 * It is deliberately OUTSIDE `[accountCode]` (it is not a public form) and
 * outside `/admin` (it must not inherit the dashboard shell, whose chrome and
 * fonts would sit inside the frame and whose auth gate would redirect it).
 * It reads no params and fetches nothing: the whole input arrives by
 * `postMessage` from the editor, so an unaddressed load renders an empty page.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function FormPreviewPage() {
  return <PreviewDocument />;
}
