import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, type ApiKey } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { publicApiUrl } from '@/lib/developer-skill/public-api-url';
import { PageHeader } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import { ApiKeysPanel } from '../api-keys';
import { SKILL_DOWNLOAD_PATH } from '../docs/docs-model';

export const dynamic = 'force-dynamic';

/**
 * MCP, API keys: where a person creates the key that connects an AI agent (or
 * their own code) to this workspace, and downloads the skill that teaches the
 * agent to use it (the same zip as on the API docs page, so the two steps sit
 * together). What a key can call lives on the docs page next door
 * (`/admin/developers/docs`), linked from the header.
 *
 * The keys come from `GET /v1/api-keys`, which already scopes them by role (a
 * member gets their own, an owner or admin all of the workspace's). A failed
 * read renders the error state rather than an empty list, so nobody is told
 * they have no keys when the truth is that nobody could check.
 */
export default async function DeveloperKeysPage() {
  const locale = await getLocale();
  const m = getMessages(locale).admin;
  // Independent reads, so in parallel. A failed key list is the error state;
  // a failed `/v1/me` throws like on every other admin page.
  const [me, listed] = await Promise.all([
    adminApi.me(),
    adminApi.listApiKeys().then(
      (r) => ({ ok: true as const, keys: r.keys }),
      (e: unknown) => ({ ok: false as const, error: e }),
    ),
  ]);

  let keys: ApiKey[] = [];
  let loadError = false;
  if (listed.ok) keys = listed.keys;
  else {
    unstable_rethrow(listed.error); // let a 401 redirect escape
    loadError = true;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 sm:px-8">
      <PageHeader
        title={m.developers.title}
        subtitle={m.developers.subtitle}
        action={
          <Link
            href="/admin/developers/docs"
            data-testid="api-docs-link"
            className={buttonVariants({ variant: 'soft' })}
          >
            <i aria-hidden className="pi pi-file-code" style={{ fontSize: 13 }} />
            {m.chrome.developersMenu.docs}
          </Link>
        }
      />
      <ApiKeysPanel
        initialKeys={keys}
        loadError={loadError}
        viewer={{ memberId: me.memberId, role: me.role, displayName: me.displayName, email: me.email }}
        m={m.developers.keys}
        locale={locale}
        timeZone={me.timezone ?? 'UTC'}
      />
      <SkillDownload
        title={m.developers.skill.title}
        body={m.developers.skill.body}
        button={m.developerDocs.skillButton}
        unavailable={m.developerDocs.skillUnavailable}
        // Read at request time like the docs page does: the route answers 503
        // without a public API address, so the button would only fail.
        available={publicApiUrl() !== null}
      />
    </div>
  );
}

/**
 * The skill zip, beside the keys it works with. Same card as the API docs
 * page's download (the accent bar, the tinted icon), shorter: one line on what
 * it is for and the button.
 */
function SkillDownload({
  title,
  body,
  button,
  unavailable,
  available,
}: {
  title: string;
  body: string;
  button: string;
  unavailable: string;
  available: boolean;
}) {
  return (
    <section
      aria-labelledby="skill-download-title"
      data-testid="api-keys-skill"
      className="relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-signal" />
      <div className="flex min-w-0 gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-signal/15 text-signal-ink">
          <i aria-hidden className="pi pi-sparkles" style={{ fontSize: 16 }} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="skill-download-title" className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
      {available ? (
        <a
          href={SKILL_DOWNLOAD_PATH}
          download
          data-testid="api-keys-skill-download"
          className={buttonVariants({ className: 'shrink-0 self-start sm:self-center' })}
        >
          <i aria-hidden className="pi pi-download" style={{ fontSize: 14 }} />
          {button}
        </a>
      ) : (
        <p data-testid="api-keys-skill-unavailable" className="shrink-0 text-sm text-muted-foreground">
          {unavailable}
        </p>
      )}
    </section>
  );
}
