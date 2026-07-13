import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Poppins } from 'next/font/google';
import 'primeicons/primeicons.css';
import './globals.css';

// Poppins is the brand typeface (Dapta design system). next/font self-hosts it
// after the first build, so runtime stays offline-safe.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={poppins.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground">{children}</body>
    </html>
  );
}
