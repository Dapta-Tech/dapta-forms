import Link from 'next/link';
import { t, type FormsMessages, type Locale } from '@quill/shared';
import type { AccountWebhook } from '@/lib/admin-api';

type Msgs = FormsMessages['admin']['connections']['webhooks'];

/**
 * The account's webhook inventory, below the connections grid.
 *
 * It is a SECTION rather than a fourth card because the grid above is not a list
 * of integrations — it is a list of account credentials, and every card in it
 * answers "are you connected?" with a token. A webhook has no token and no
 * singular connection state; it is N per-form configurations, and dropping it in
 * that grid would force it to answer a question it has no answer to. (The grid is
 * also two columns with three children, so a fourth card would pair visually with
 * the not-yet-shipped Google Sheets card — the one association to avoid.)
 *
 * Read-only, deliberately. A webhook belongs to a form, and the form's Connect
 * tab is already its editor; a second writer here would race that tab's autosave
 * over the same `destinations` array.
 *
 * A server component: the account's endpoint URLs never reach the client bundle,
 * and there is nothing here to interact with.
 */
export function WebhooksSection({
  items,
  loadError,
  m,
  locale,
}: {
  items: AccountWebhook[];
  loadError?: boolean;
  m: Msgs;
  locale: Locale;
}) {
  return (
    <section
      data-testid="account-webhooks"
      className="mt-10 flex flex-col gap-4 border-t border-border pt-8"
    >
      <div className="flex flex-col gap-1">
        {/* Never an accessible name of "HubSpot"/"Calendly": the connect e2e finds
            those cards by their level-2 heading and would match this instead. */}
        <h2 className="text-lg font-semibold text-foreground">{m.title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{m.subtitle}</p>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {m.loadError}
        </div>
      ) : items.length === 0 ? (
        <EmptyState m={m} />
      ) : (
        <WebhookTable items={items} m={m} locale={locale} />
      )}
    </section>
  );
}

function EmptyState({ m }: { m: Msgs }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <i aria-hidden className="pi pi-send" style={{ fontSize: 20 }} />
      </div>
      <p className="font-medium text-foreground">{m.emptyTitle}</p>
      <p className="max-w-md text-sm text-muted-foreground">{m.emptyBody}</p>
      <Link
        href="/admin/forms"
        className="mt-2 text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
      >
        {m.emptyCta}
      </Link>
    </div>
  );
}

function WebhookTable({ items, m, locale }: { items: AccountWebhook[]; m: Msgs; locale: Locale }) {
  return (
    <>
      {/* Horizontal scroll lives INSIDE this container: a long endpoint must not
          make the page scroll sideways. */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-faint">
              <th className="whitespace-nowrap px-4 py-3 font-medium">{m.colForm}</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">{m.colEndpoint}</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">{m.colEvents}</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">{m.colStatus}</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">{m.colHealth}</th>
              <th className="px-4 py-3" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((w, i) => {
              // The editor's tab, not the retired /integrations route, which only
              // redirects here anyway.
              const href = `/admin/forms/${w.formId}/edit?tab=connect`;
              return (
                <tr
                  // A form may legitimately own several webhooks and legacy ones
                  // carry no id, so neither alone is a stable key.
                  key={`${w.formId}:${w.webhookId ?? i}`}
                  data-testid="webhook-row"
                  data-form-id={w.formId}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="max-w-[220px] px-4 py-3">
                    {/* The name repeats when a form owns two webhooks. No rowspan:
                        it breaks the scroll container and reorders the row for a
                        screen reader. */}
                    <Link
                      href={href}
                      className="block truncate font-medium text-foreground underline-offset-4 hover:underline"
                      title={w.formName}
                    >
                      {w.formName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        dir="ltr"
                        title={w.url}
                        className="block max-w-[420px] truncate font-mono text-xs text-muted-foreground"
                      >
                        {w.url}
                      </span>
                      {w.hasSecret ? (
                        <i
                          className="pi pi-lock text-faint"
                          style={{ fontSize: 12 }}
                          title={m.signed}
                          aria-label={m.signed}
                        />
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {eventsLabel(w, m)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {/* A disabled webhook is LISTED, not hidden: one that quietly
                        stopped firing is the case worth finding here. */}
                    <span
                      data-testid="webhook-status"
                      data-state={w.enabled ? 'on' : 'off'}
                      className={
                        w.enabled
                          ? 'inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-foreground'
                          : 'inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground'
                      }
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${w.enabled ? 'bg-primary-edge' : 'bg-faint'}`}
                      />
                      {w.enabled ? m.on : m.off}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {/* Nothing is rendered when nothing failed — never a green
                        tick. Successful deliveries are not queried, so an outbox
                        with no failures cannot be told apart from a webhook that
                        has never fired, and claiming health for the second would
                        be worse than saying nothing. */}
                    {w.failures ? (
                      <span
                        data-testid="webhook-health"
                        title={`${t(m.lastFailure, {
                          date: new Date(w.failures.lastAt).toLocaleString(locale),
                        })}${w.failures.lastError ? `\n${w.failures.lastError}` : ''}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive"
                      >
                        <i aria-hidden className="pi pi-exclamation-triangle" style={{ fontSize: 11 }} />
                        {t(m.failedCount, { n: w.failures.count })}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Link
                      data-testid="webhook-row-edit"
                      href={href}
                      className="text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
                    >
                      {m.edit} →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.some((w) => w.failures) ? (
        <p className="text-xs text-muted-foreground">{m.failuresScopeNote}</p>
      ) : null}
    </>
  );
}

/**
 * Which submissions this webhook is sent. The server has already resolved the
 * back-compat rule (absent triggers = both), so this only names the answer.
 */
function eventsLabel(w: AccountWebhook, m: Msgs): string {
  if (w.firesPartial && w.firesComplete) return m.eventsBoth;
  if (w.firesComplete) return m.eventsComplete;
  return m.eventsPartial;
}
