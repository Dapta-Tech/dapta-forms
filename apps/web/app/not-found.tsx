import Link from 'next/link';
import { BrandMark } from '@/components/brand/brand';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {/* A dead URL is often someone's first impression of the product, so it
          gets the mark too — decorative here, the heading carries the meaning. */}
      <BrandMark className="h-8 w-auto text-muted-foreground" />
      <h1 className="text-3xl font-semibold">Not found</h1>
      <p className="text-muted-foreground">This page doesn’t exist.</p>
      <Link href="/" className="text-primary underline underline-offset-4">
        Go home
      </Link>
    </main>
  );
}
