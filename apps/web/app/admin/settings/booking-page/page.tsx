import { adminApi } from '@/lib/admin-api';
import { defaultBranding, getMessages } from '@slate/shared';
import { getLocale } from '@/lib/locale';
import { Studio } from './studio';

export const dynamic = 'force-dynamic';

export default async function BookingPageSettings() {
  const me = await adminApi.me();
  const [profile, adminEvents, locale, vanity] = await Promise.all([
    me?.handle ? adminApi.profile(me.accountCode, me.handle) : Promise.resolve(null),
    adminApi.listEventTypes(),
    getLocale(),
    adminApi.vanityStatus().catch(() => ({ vanitySlug: null, shortCode: '', canClaim: false })),
  ]);
  const t = getMessages(locale).admin;

  const displayName = profile?.member.displayName ?? me?.displayName ?? 'You';
  const accent = profile?.member.brandColor ?? '#cbe84f';
  const style = (profile?.member.style ?? {}) as Record<string, unknown>;
  const def = defaultBranding(displayName);
  const axes = {
    template: (style.template as never) ?? def.template,
    cardStyle: (style.cardStyle as never) ?? def.cardStyle,
    corners: (style.corners as never) ?? def.corners,
    buttons: (style.buttons as never) ?? def.buttons,
    density: (style.density as never) ?? def.density,
    font: (style.font as never) ?? def.font,
    slotLayout: (style.slotLayout as never) ?? def.slotLayout,
    dayGroup: (style.dayGroup as never) ?? def.dayGroup,
    slotSelect: (style.slotSelect as never) ?? def.slotSelect,
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">{t.bookingPageHeader.title}</h1>
      <p className="mb-6 text-muted-foreground">{t.bookingPageHeader.subtitle}</p>
      <Studio
        messages={t.studio}
        accountCode={me?.accountCode ?? ''}
        vanity={{ ...vanity, shortCode: vanity.shortCode || me?.accountShortCode || '' }}
        subscriptionUrl={process.env.NEXT_PUBLIC_SIGNUP_URL ?? null}
        displayName={displayName}
        handle={me?.handle ?? ''}
        bio={(style.bio as string) ?? ''}
        avatarUrl={profile?.member.avatarUrl ?? ''}
        coverUrl={profile?.member.coverUrl ?? ''}
        accent={accent}
        axes={axes}
        landingEnabled={style.landingEnabled !== false}
        defaultEventSlug={(style.defaultEventSlug as string) ?? null}
        eventTypes={profile?.eventTypes ?? []}
        manageableEvents={adminEvents.map((e) => ({ id: e.id, slug: e.slug, title: e.title, hidden: e.hidden }))}
        eventOrder={Array.isArray(style.eventOrder) ? (style.eventOrder as string[]) : []}
      />
    </div>
  );
}
