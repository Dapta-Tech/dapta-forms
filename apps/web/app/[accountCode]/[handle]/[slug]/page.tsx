import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { getMessages, t } from '@slate/shared';
import { getAvailability, getProfile } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import { BookingFlow } from '@/components/booking-flow';
import { BrandedShell } from '@/components/branded-shell';
import { MadeWithBadge } from '@/components/made-with-badge';

// Per-page SEO/OG from event + host data (R11 audit). getProfile is
// request-cached (shared with the page render); the event's public listing
// carries everything the tags need — no availability call here.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ accountCode: string; handle: string; slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { accountCode, handle, slug } = await params;
  const { lang } = await searchParams;
  const profile = await getProfile(accountCode, handle);
  const event = profile?.eventTypes.find((e) => e.slug === slug);
  if (!profile || !event) return {};
  const name = profile.member.displayName ?? profile.member.handle;
  const title = `${event.title} — ${name}`;
  const description =
    event.description ||
    t(getMessages(await publicLocale(lang)).growth.seoEvent, {
      event: event.title,
      name,
      minutes: event.lengthMinutes,
    });
  const avatar = profile.member.avatarUrl;
  const images = avatar && /^https?:\/\//i.test(avatar) ? [avatar] : undefined;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', images },
    twitter: { card: 'summary', title, description, images },
  };
}

// Public booking page. A Server Component fetches slots (free SEO + streaming);
// the interactive slot picker + form is a client island (BookingFlow).
export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountCode: string; handle: string; slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { accountCode, handle, slug } = await params;
  const { lang } = await searchParams;
  const locale = await publicLocale(lang);

  const now = new Date();
  const from = now.toISOString();
  const to = new Date(now.getTime() + 21 * 86_400_000).toISOString();

  const [profile, availability] = await Promise.all([
    getProfile(accountCode, handle),
    getAvailability({ accountCode, handle, slug, from, to }),
  ]);

  if (!profile || !availability) notFound();

  // Canonical-code guard (short-links §4): alias URLs 308 to the canonical code.
  const code = profile!.account.code;
  if (accountCode !== code) {
    permanentRedirect(`/${code}/${handle}/${slug}${lang ? `?lang=${lang}` : ''}`);
  }

  return (
    <BrandedShell brandColor={profile.member.brandColor} style={profile.member.style}>
      <main className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8 flex flex-col gap-1">
        <Link
          href={`/${code}/${handle}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {profile.member.displayName ?? profile.member.handle}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{availability.eventType.title}</h1>
        <p className="text-sm text-muted-foreground">
          {availability.eventType.lengthMinutes} min · with{' '}
          {profile.member.displayName ?? profile.member.handle}
        </p>
      </header>

        <BookingFlow
          accountCode={accountCode}
          ownerSlug={handle}
          slug={slug}
          slots={availability.slots}
          emptyReason={availability.emptyReason}
          bookingFields={availability.eventType.bookingFields}
          initialTimeZone={availability.timeZone}
          locale={locale}
        />
      </main>
      <MadeWithBadge locale={locale} accountCode={accountCode} />
    </BrandedShell>
  );
}
