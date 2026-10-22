import Link from 'next/link';
import { getMessages, t } from '@quill/shared';
import { getLocale } from '@/lib/locale';
import { buttonVariants } from '@/components/ui/button';
import { TOOL_COUNT, TOOL_GROUPS, TOOL_GROUP_ICONS, TOOL_GROUP_ORDER } from '../tool-groups';

/**
 * Tools: what an agent can do in dForms once it is connected, in plain words.
 * Every tool of the MCP server, grouped like the connect page, each with a
 * one-line description and an example of what a person would ask. No routes,
 * no parameters, no JSON: the agent picks the tool, the person only asks.
 *
 * The names come from `TOOL_GROUPS`, which a spec holds to the server's
 * catalog, and the copy is keyed by those names in both languages, so the
 * page never drifts from what the MCP really offers.
 */
export default async function ToolsPage() {
  const locale = await getLocale();
  const m = getMessages(locale).admin;
  const x = m.developers.tools;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{x.title}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t(x.intro, { count: TOOL_COUNT })}</p>
        </div>
        <Link
          href="/admin/developers/connect"
          data-testid="tools-connect-link"
          className={`${buttonVariants({ variant: 'default' })} shrink-0 self-start`}
        >
          {x.connectCta}
          <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
        </Link>
      </header>

      <nav aria-label={x.title} className="mb-8 flex flex-wrap gap-2">
        {TOOL_GROUP_ORDER.map((group) => (
          <a
            key={group}
            href={`#${group}`}
            className="rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {x.groups[group].title}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-6">
        {TOOL_GROUP_ORDER.map((group) => (
          <section
            key={group}
            id={group}
            aria-labelledby={`tools-${group}`}
            data-testid={`tools-group-${group}`}
            className="scroll-mt-6 rounded-2xl border border-border bg-card px-5 py-6 sm:px-7"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-signal/15 text-signal-ink">
                <i aria-hidden className={`pi ${TOOL_GROUP_ICONS[group]}`} style={{ fontSize: 16 }} />
              </span>
              <div className="min-w-0">
                <h2 id={`tools-${group}`} className="text-lg font-semibold text-foreground">
                  {x.groups[group].title}
                  <span className="ml-2 align-middle text-xs font-medium text-muted-foreground">
                    {t(x.count, { n: TOOL_GROUPS[group].length })}
                  </span>
                </h2>
                <p className="text-sm text-muted-foreground">{x.groups[group].body}</p>
              </div>
            </div>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {TOOL_GROUPS[group].map((name) => {
                const item = x.items[name];
                return (
                  <li
                    key={name}
                    data-testid="tools-item"
                    data-tool={name}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-panel p-4"
                  >
                    <p className="text-sm font-medium text-foreground">{item?.what}</p>
                    <p className="flex gap-2 rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground">
                      <i aria-hidden className="pi pi-comment mt-0.5 shrink-0 text-signal-ink" style={{ fontSize: 13 }} />
                      <span>
                        <span className="font-medium text-foreground">{x.askLabel}</span> <span className="italic">{item?.ask}</span>
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
