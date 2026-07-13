import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">Not found</h1>
      <p className="text-muted-foreground">This page doesn’t exist.</p>
      <Link href="/" className="text-primary underline underline-offset-4">
        Go home
      </Link>
    </main>
  );
}
