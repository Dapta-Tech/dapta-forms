import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMessages, t } from '@quill/shared';
import { adminApi, ApiError, type PlaybookCard, type PlaybookList } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { parseMarkdown, inlineText, type Block } from '@/lib/markdown';
import {
  PLAYBOOK_LANG_PARAM,
  PLAYBOOK_TAB_PARAM,
  asPlaybookLocale,
  categoryLabel,
  headingId,
  isPlaybookSlug,
  nextPlaybook,
  playbookLangStorageKey,
  playbookLocaleFor,
  readingMinutes,
  withPlaybookLang,
} from '@/lib/playbooks';
import { buttonVariants } from '@/components/ui/button';
import { MarkdownView, headingIds } from '@/components/playbooks/markdown-view';
import { PlaybookOpened } from '@/components/playbooks/playbook-opened';
import { CardStatus } from '@/components/playbooks/playbooks-gallery';

export const dynamic = 'force-dynamic';

/** The anchor of the closing section, the one done with a dForms template. */
const DO_IT_ID = 'hazlo-con-dforms';

/** That section's heading as each language writes it: "Hazlo con dForms", "Do it with dForms". */
const DO_IT_HEADINGS = new Set([DO_IT_ID, 'do-it-with-dforms']);

/**
 * Splits the body at its closing "Hazlo con dForms" heading ("Do it with
 * dForms" in English): what comes before is the text, what comes after goes
 * in the template panel at the end. A playbook without that heading keeps its
 * whole body as text, and the panel shows the button alone.
 */
function splitDoIt(blocks: Block[]): { body: Block[]; doIt: Block[] } {
  const i = blocks.findIndex((b) => b.kind === 'heading' && b.level <= 2 && DO_IT_HEADINGS.has(headingId(inlineText(b.text))));
  if (i < 0) return { body: blocks, doIt: [] };
  // Up to the next level-2 heading, should one ever follow it.
  const end = blocks.findIndex((b, j) => j > i && b.kind === 'heading' && b.level <= 2);
  const stop = end < 0 ? blocks.length : end;
  return {
    body: [...blocks.slice(0, i), ...blocks.slice(stop)],
    doIt: blocks.slice(i + 1, stop),
  };
}

/** Only what a state line reads: the card goes to a client component, and the body must not ride along. */
function statusOf(c: PlaybookCard) {
  return {
    isNew: c.isNew,
    lastSeenAt: c.lastSeenAt,
    publishedAt: c.publishedAt,
  };
}

/**
 * The reader: one playbook, whole. The playbook is read before this open is
 * recorded (`PlaybookOpened` does it from the client), so its state line still
 * says what it was before. The list is read too, best effort, for the "Next"
 * card; without it the reader simply has none.
 *
 * In the playbook language of `?lang=`, else the platform's (the person's
 * stored choice is applied on the client, see `PlaybookOpened`). A playbook
 * with no version in that language comes in Spanish, with a note saying so.
 * Every link out of the reader keeps the language.
 */
export default async function PlaybookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  if (!isPlaybookSlug(slug)) notFound();
  const locale = await getLocale();
  const m = getMessages(locale).admin.playbooks;
  const contentLocale = playbookLocaleFor(query[PLAYBOOK_LANG_PARAM], locale);
  const langInUrl = asPlaybookLocale(query[PLAYBOOK_LANG_PARAM]) !== null;

  let playbook: PlaybookCard & { body: string };
  let list: PlaybookList | null;
  let memberId: string;
  try {
    [playbook, list, { memberId }] = await Promise.all([
      adminApi.playbook(slug, contentLocale),
      adminApi.playbooks(contentLocale).catch((): PlaybookList | null => null),
      adminApi.me(),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const now = Date.now();
  const blocks = parseMarkdown(playbook.body);
  const { body, doIt } = splitDoIt(blocks);
  const ids = headingIds(body);
  const toc = body.flatMap((b) => (ids.has(b) ? [{ id: ids.get(b)!, text: inlineText((b as { text: string }).text) }] : []));
  const category = categoryLabel(playbook.category, m);
  const next = list ? nextPlaybook(list.playbooks, playbook.slug) : null;
  const categoryHref = withPlaybookLang(
    `/admin/playbooks?${PLAYBOOK_TAB_PARAM}=${encodeURIComponent(playbook.category)}`,
    contentLocale,
  );

  const nextCard = next ? (
    <Link
      href={withPlaybookLang(`/admin/playbooks/${next.slug}`, contentLocale)}
      data-testid="playbook-next"
      className="group flex flex-col gap-3 rounded-xl bg-signal/10 p-4 transition-colors hover:bg-signal/15"
    >
      <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{t(m.reader.next, { category: categoryLabel(next.category, m) })}</span>
        <CardStatus card={statusOf(next)} now={now} locale={locale} m={m.status} />
      </span>
      <span lang={next.locale} className="text-base font-semibold leading-5 text-foreground">
        {next.title}
      </span>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {m.reader.read}
        <i aria-hidden className="pi pi-arrow-right transition-transform group-hover:translate-x-0.5" style={{ fontSize: 12 }} />
      </span>
    </Link>
  ) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:px-8">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <nav aria-label={m.reader.breadcrumb} className="min-w-0">
          <ol className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <li className="flex shrink-0 items-center">
              <Link
                href={withPlaybookLang('/admin/playbooks', contentLocale)}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <i aria-hidden className="pi pi-chevron-left" style={{ fontSize: 14 }} />
                {m.title}
              </Link>
            </li>
            <li aria-hidden className="text-faint">
              /
            </li>
            <li className="shrink-0">
              <Link href={categoryHref} className="hover:text-foreground">
                {category}
              </Link>
            </li>
            <li aria-hidden className="hidden text-faint sm:block">
              /
            </li>
            <li
              aria-current="page"
              lang={playbook.locale}
              className="hidden min-w-0 truncate font-medium text-foreground sm:block"
            >
              {playbook.title}
            </li>
          </ol>
        </nav>
        <PlaybookOpened
          slug={playbook.slug}
          category={playbook.category}
          locale={contentLocale}
          shownLocale={playbook.locale}
          fallback={playbook.fallback}
          langInUrl={langInUrl}
          storageKey={playbookLangStorageKey(memberId)}
          m={m.contentLanguage}
        />
      </div>

      <div className="mt-8 grid gap-10 sm:mt-12 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:gap-16">
        <article className="min-w-0 max-w-[42.5rem]">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-signal/15 px-2.5 py-0.5 font-semibold text-signal-ink">{category}</span>
            <span>{t(m.readingTime, { count: readingMinutes(playbook.body) })}</span>
            <CardStatus card={statusOf(playbook)} now={now} locale={locale} m={m.status} />
          </p>
          <h1 lang={playbook.locale} className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {playbook.title}
          </h1>
          <p lang={playbook.locale} className="mt-4 text-lg leading-7 text-muted-foreground">
            {playbook.summary}
          </p>
          {playbook.fallback ? (
            <p
              data-testid="playbook-fallback"
              className="mt-4 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              <i aria-hidden className="pi pi-info-circle shrink-0" style={{ fontSize: 14 }} />
              {m.fallback.reader}
            </p>
          ) : null}
          <hr className="my-8 border-border" />

          <div lang={playbook.locale}>
            <MarkdownView blocks={body} ids={ids} locale={playbook.locale} />
          </div>

          <section
            id={DO_IT_ID}
            aria-labelledby={`${DO_IT_ID}-title`}
            data-testid="playbook-do-it"
            className="mt-14 scroll-mt-24 rounded-2xl border border-signal/40 bg-signal/[0.06] p-5 sm:p-8"
          >
            <h2 id={`${DO_IT_ID}-title`} className="text-sm font-semibold text-signal-ink">
              {m.reader.doIt}
            </h2>
            {doIt.length > 0 ? (
              <div lang={playbook.locale}>
                <MarkdownView blocks={doIt} locale={playbook.locale} className="mt-4" />
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {/* Disabled until templates ship ("Coming soon"): the step is
                  already written above, so nothing is lost meanwhile. */}
              <button
                type="button"
                disabled
                aria-describedby={`${DO_IT_ID}-soon`}
                data-testid="playbook-use-template"
                className={buttonVariants({ variant: 'default' })}
              >
                <i aria-hidden className="pi pi-layout-template" style={{ fontSize: 16 }} />
                {m.reader.useTemplate}
              </button>
              <span
                id={`${DO_IT_ID}-soon`}
                className="rounded-full bg-signal/15 px-2.5 py-1 text-xs font-semibold text-signal-ink"
              >
                {m.reader.soon}
              </span>
            </div>
          </section>
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-8 flex flex-col gap-8">
            {toc.length > 0 ? (
              <nav aria-label={m.reader.toc}>
                <p className="mb-3 text-xs font-semibold text-muted-foreground">{m.reader.toc}</p>
                <ul className="flex flex-col border-l border-border text-sm">
                  {[...toc, { id: DO_IT_ID, text: m.reader.doIt }].map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className="-ml-px block border-l border-transparent py-1.5 pl-3.5 text-muted-foreground hover:border-foreground hover:text-foreground"
                      >
                        {item.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
            {nextCard}
          </div>
        </aside>
        {nextCard ? <div className="lg:hidden">{nextCard}</div> : null}
      </div>
    </div>
  );
}
