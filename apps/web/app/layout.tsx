import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import 'primeicons/primeicons.css';
import './globals.css';
import { fontVariables } from '@/lib/fonts';
import { getLocale } from '@/lib/locale';
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
  title: `${productName}: open-source forms`,
  description: `${productName} is open-source forms. Clone, run, and collect: anywhere.`,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The viewer's persisted choice, resolved on the server so the first response
  // already carries it — see lib/theme.server.ts for why that matters. Dark
  // unless they opted into light; the attribute is ALWAYS stamped, so the token
  // sheet's `prefers-color-scheme` fallback never decides for us.
  //
  // This is ADMIN chrome only, despite being the root. A public form does not
  // take the scheme from here: `formDesignProps` pins an unbranded form to the
  // product default and a branded one to its own colours, precisely so the
  // builder's preview cannot show the author's dashboard preference and call it
  // the published page. Read that comment before widening this one — "the viewer's
  // preference" is not what a respondent gets, because a respondent has no cookie.
  const theme = await getThemePref();
  // The admin's language, for the same reason and from the same kind of store as
  // the theme above. It was hardcoded 'en' while the app has shipped Spanish
  // since the first-run wizard, so a Spanish dashboard has been telling screen
  // readers, translation tools and search engines it is English the whole time.
  //
  // ADMIN chrome, like the theme. A respondent has no admin cookie, so a public
  // form is unaffected and still declares its OWN language on the element it
  // renders into (see the public form page) - the author's dashboard preference
  // must not decide what language a stranger's form is announced in.
  const locale = await getLocale();
  return (
    // Every curated face is declared here so a public form can switch typeface
    // without a rebuild; only the brand face is preloaded (see lib/fonts.ts).
    <html lang={locale} data-theme={theme} className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground">{children}</body>
    </html>
  );
}
