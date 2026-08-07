import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import 'primeicons/primeicons.css';
import './globals.css';
import { fontVariables } from '@/lib/fonts';
import { themeAttribute } from '@/lib/theme';
import { getThemePref } from '@/lib/theme.server';

// Customer-facing name comes from the deployment (NEXT_PUBLIC_PRODUCT_NAME,
// inlined at build time) — "Dapta Forms" in Dapta's builds, "Forms"
// for a bare fork. "Quill" is the internal/repo identifier only and must
// never surface in the UI.
const productName = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Forms';

// Absolute base for OG/twitter URLs (PUBLIC_APP_URL is the deployment's public
// web origin — already in .env for public form links). Bad value → localhost.
function appBaseUrl(): URL {
  try {
    return new URL(process.env.PUBLIC_APP_URL || 'http://localhost:3000');
  } catch {
    return new URL('http://localhost:3000');
  }
}

export const metadata: Metadata = {
  metadataBase: appBaseUrl(),
  title: `${productName} — open-source forms`,
  description: `${productName} is open-source forms. Clone, run, and collect — anywhere.`,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The scheme used to be the literal `data-theme="dark"`, which pinned the whole
  // product to dark and made the token sheet's light theme unreachable. It is now
  // the viewer's persisted choice, resolved on the server so the first response
  // already carries it — see lib/theme.ts for why that matters.
  //
  // This reaches PUBLIC FORM pages too, which is the behaviour the renderer was
  // built for: `formDesignProps` returns `themeMode: null` for a form whose author
  // fixed no background, meaning "inherit the viewer's preference". A form that
  // DID choose colours pins them inline and is unaffected either way.
  const theme = themeAttribute(await getThemePref());
  return (
    // Every curated face is declared here so a public form can switch typeface
    // without a rebuild; only the brand face is preloaded (see lib/fonts.ts).
    <html lang="en" data-theme={theme} className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground">{children}</body>
    </html>
  );
}
