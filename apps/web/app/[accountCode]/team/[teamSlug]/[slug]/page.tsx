import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { getMessages, schedulingMethodLabel, t } from '@slate/shared';
import { getTeamAvailability, getTeamProfile } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import { BookingFlow } from '@/components/booking-flow';
import { BrandedShell } from '@/components/branded-shell';
import { MadeWithBadge } from '@/components/made-with-badge';

// Per-page SEO/OG from team + event data (R11 audit); getTeamProfile is
// request-cached, so this shares the page's fetch.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ accountCode: string; teamSlug: string; slug: string }>;
}): Promise<Metadata> {
  const { accountCode, teamSlug, slug } = await params;
  const team = await getTeamProfile(accountCode, teamSlug);
  const event = team?.eventTypes.find((e) => e.slug === slug);
  if (!team || !event) return {};
  const title = `${event.title} — ${team.team.name}`;
  const description =
    event.description ||
    t(getMessages(await publicLocale()).growth.seoEvent, {
      event: event.title,
      name: team.team.name,
      minutes: event.lengthMinutes,
    });
  const logo = team.team.logoUrl;
  const images = logo && /^https?:\/\//i.test(logo) ? [logo] : undefined;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', images },
    twitter: { card: 'summary', title, description, images },
  };
}

export default async function TeamBookingPage({
  params,
}: {
  params: Promise<{ accountCode: string; teamSlug: string; slug: string }>;
}) {
  const { accountCode, teamSlug, slug } = await params;
  const locale = await publicLocale();
  const messages = getMessages(locale);
  const now = new Date();
  const from = now.toISOString();
  const to = new Date(now.getTime() + 21 * 86_400_000).toISOString();

  const [team, availability] = await Promise.all([
    getTeamProfile(accountCode, teamSlug),
    getTeamAvailability({ accountCode, teamSlug, slug, from, to }),
  ]);
  if (!team || !availability) notFound();

  // Canonical-code guard (short-links §4): alias URLs 308 to the canonical code.
  const code = team!.account.code;
  if (accountCode !== code) permanentRedirect(`/${code}/team/${teamSlug}/${slug}`);

  return (
    <BrandedShell brandColor={null} style={null}>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 flex flex-col gap-1">
          <Link href={`/${code}/team/${teamSlug}`} className="text-sm text-muted-foreground hover:text-foreground">
            ← {team.team.name}
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{availability.eventType.title}</h1>
          <p className="text-sm text-muted-foreground">
            {availability.eventType.lengthMinutes} min · {team.team.name} ·{' '}
            {schedulingMethodLabel(messages, availability.eventType.schedulingType)}
          </p>
        </header>

        <BookingFlow
          accountCode={accountCode}
          ownerSlug={teamSlug}
          slug={slug}
          mode="team"
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
