import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getMessages } from '@quill/shared';
import { getPublicProfile } from '@/lib/api';
import { getLocale } from '@/lib/locale';
import { personName } from '@/lib/person';
import { formDesignProps } from '@/lib/form-design';
import './[slug]/public-form.css';

export const dynamic = 'force-dynamic';

/**
 * The public member page — `/[accountCode]/[handle]`.
 *
 * This URL has existed in the routing shape since the first public form link,
 * but nothing was ever built at the handle level: only `[handle]/[slug]`. So a
 * handle URL was a genuine 404, and anyone who trimmed a form link back to see
 * "who is this" hit a dead end.
 *
 * It stays a 404 unless the member has explicitly enabled a page — the API
 * returns null for a missing member, a missing profile, and a disabled one
 * alike. Nobody gets published by having the column exist.
 *
 * The look reuses the form design system (`formDesignProps` + `public-form.css`)
 * rather than inventing a second set of colours and typefaces, so a page and the
 * forms it links to can be made to match.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ accountCode: string; handle: string }>;
}): Promise<Metadata> {
  const { accountCode, handle } = await params;
  const profile = await getPublicProfile(accountCode, handle);
  if (!profile) return { title: 'Not found' };
  // NEVER the raw `displayName`: for a local-auth account that column IS the
  // email address, so this line put the owner's email in the page <title> and in
  // the OpenGraph title of a page whose whole purpose is to be shared.
  const name = personName(profile.displayName) ?? profile.handle;
  return {
    title: profile.headline ? `${name} — ${profile.headline}` : name,
    description: profile.bio ?? undefined,
    openGraph: {
      title: name,
      description: profile.bio ?? undefined,
      images: profile.avatarUrl ? [profile.avatarUrl] : undefined,
    },
  };
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ accountCode: string; handle: string }>;
}) {
  const { accountCode, handle } = await params;
  const profile = await getPublicProfile(accountCode, handle);
  if (!profile) notFound();

  const locale = await getLocale();
  const m = getMessages(locale).profile;
  const design = formDesignProps(profile.branding ?? undefined);
  // Same guard as `generateMetadata` above — and it also feeds `initials`, which
  // was rendering "YO" for `you@…`.
  const name = personName(profile.displayName) ?? profile.handle;
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="pf pf--profile" {...design.attrs} style={design.style}>
      {design.fontFace ? <style>{design.fontFace}</style> : null}
      <main className="pf-profile" data-testid="member-profile">
        <header className="pf-profile__head">
          {profile.avatarUrl ? (
            <img className="pf-profile__avatar" src={profile.avatarUrl} alt="" width={72} height={72} />
          ) : (
            <span className="pf-profile__avatar pf-profile__avatar--initials" aria-hidden>
              {initials}
            </span>
          )}
          <div className="pf-profile__id">
            <h1 className="pf-profile__name">{name}</h1>
            {profile.headline ? <p className="pf-profile__headline">{profile.headline}</p> : null}
          </div>
        </header>

        {profile.bio ? <p className="pf-profile__bio">{profile.bio}</p> : null}

        {profile.links.length > 0 ? (
          <ul className="pf-profile__links">
            {profile.links.map((l) => (
              <li key={l.url}>
                {/* rel: an author-supplied outbound link must not hand the
                    destination a window reference or a referrer. */}
                <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        <section className="pf-profile__forms" aria-labelledby="pf-profile-forms-title">
          <h2 id="pf-profile-forms-title" className="pf-profile__section">
            {m.formsTitle}
          </h2>
          {profile.forms.length === 0 ? (
            <p className="pf-profile__empty">{m.noForms}</p>
          ) : (
            <ul className="pf-profile__list">
              {profile.forms.map((f) => (
                <li key={f.slug}>
                  <Link href={`/${accountCode}/${profile.handle}/${f.slug}`}>
                    <span className="pf-profile__form-name">{f.name}</span>
                    <span aria-hidden className="pf-profile__form-go">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
