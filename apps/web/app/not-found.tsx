import Link from 'next/link';
import { getMessages } from '@quill/shared';
import { BrandMark } from '@/components/brand/brand';
import { preferredLocale } from '@/lib/locale';

export default async function NotFound() {
  // The persisted admin choice when there is one, else the browser: a dead
  // public URL is usually reached by a visitor who never saw the switcher.
  const m = getMessages(await preferredLocale()).renderer;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {/* A dead URL is often someone's first impression of the product, so it
          gets the mark too: decorative here, the heading carries the meaning. */}
      <BrandMark className="h-8 w-auto text-muted-foreground" />
      <h1 className="text-3xl font-semibold">{m.notFoundTitle}</h1>
      <p className="text-muted-foreground">{m.notFoundBody}</p>
      <Link href="/" className="text-primary underline underline-offset-4">
        {m.notFoundHome}
      </Link>
    </main>
  );
}
