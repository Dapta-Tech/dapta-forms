import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getMessages, t } from '@slate/shared';
import { getTeamProfile } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import { MadeWithBadge } from '@/components/made-with-badge';

// Per-page SEO/OG from team data (R11 audit); getTeamProfile is request-cached.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ accountCode: string; teamSlug: string }>;
}): Promise<Metadata> {
  const { accountCode, teamSlug } = await params;
  const team = await getTeamProfile(accountCode, teamSlug);
  if (!team) return {};
  const title = `${team.team.name} — ${team.account.name}`;
  const description = t(getMessages(await publicLocale()).growth.seoProfile, {
    name: team.team.name,
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

export default async function TeamPage({
  params,
}: {
  params: Promise<{ accountCode: string; teamSlug: string }>;
}) {
  const { accountCode, teamSlug } = await params;
  const [team, locale] = await Promise.all([getTeamProfile(accountCode, teamSlug), publicLocale()]);
  if (!team) notFound();

  // Canonical-code guard (short-links §4): alias URLs 308 to the canonical code.
  const code = team!.account.code;
  if (accountCode !== code) permanentRedirect(`/${code}/team/${teamSlug}`);

  return (
    <>
      <main className="mx-auto max-w-2xl px-6 py-16">
        <header className="mb-8 flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{team.account.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{team.team.name}</h1>
          <p className="text-sm text-muted-foreground">Times in {team.team.timeZone}</p>
        </header>

        <ul className="flex flex-col gap-3">
          {team.eventTypes.map((et) => (
            <li key={et.slug}>
              <Link
                href={`/${code}/team/${teamSlug}/${et.slug}`}
                className="flex items-center justify-between rounded-md border border-border bg-card p-4 transition-transform hover:border-primary active:scale-[0.99]"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{et.title}</span>
                  {et.description ? (
                    <span className="text-sm text-muted-foreground">{et.description}</span>
                  ) : null}
                </span>
                <span className="rounded-sm bg-muted px-2 py-1 text-sm text-muted-foreground">
                  {et.lengthMinutes} min
                </span>
              </Link>
            </li>
          ))}
          {team.eventTypes.length === 0 ? (
            <li className="text-muted-foreground">No bookable team events yet.</li>
          ) : null}
        </ul>
      </main>
      <MadeWithBadge locale={locale} accountCode={code} />
    </>
  );
}
