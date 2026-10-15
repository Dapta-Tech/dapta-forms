'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  API_ERROR_CODES,
  API_EXAMPLE_ERROR,
  API_ISSUE_CODES,
  API_LIMITS,
  API_NOT_ALLOWED,
  apiAnchor,
  apiExampleJson,
  t,
  type ApiNotAllowed,
} from '@quill/shared';
import { buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { SearchClearButton } from '@/components/ui/search-clear-button';
import { cn } from '@/lib/cn';
import { CodePanel, CopyButton, rich } from './code-panel';
import {
  EXAMPLE_KEY_NOT_ALLOWED,
  FLOW,
  GOTCHAS,
  SECTION_IDS,
  SKILL_DOWNLOAD_PATH,
  authCurl,
  endpointMatches,
  type ApiDocsChrome,
  type ApiDocsExtras,
  type DeveloperDocsMessages,
  type DocsArea,
  type DocsModel,
} from './docs-model';
import { EndpointCard, MethodBadge, PathText } from './endpoint-card';

/**
 * Pixels under the sticky toolbar where a section counts as the one being read.
 * More than the gap `scroll-mt-*` leaves above a section, so a section reached
 * through its anchor (or the selector) is the one marked.
 */
const SPY_SLACK = 48;

/** Sections scroll to sit under the mobile header plus the toolbar, or under the toolbar alone. */
const SECTION_SCROLL = 'scroll-mt-36 md:scroll-mt-24';

const NOT_ALLOWED_ICON: Record<ApiNotAllowed, string> = {
  keys: 'pi-key',
  members: 'pi-users',
  workspaces: 'pi-th-large',
  onboarding: 'pi-flag',
  profile: 'pi-id-card',
  integrations: 'pi-link',
};

const EXAMPLE_ERROR_JSON = apiExampleJson(API_EXAMPLE_ERROR);

/** `{count} requests per minute` with the number set large, the way a stat reads. */
function Stat({ template, value }: { template: string; value: number }) {
  const [before, after] = template.split('{count}');
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
      {before ? <span>{before.trim()}</span> : null}
      <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</span>
      {after ? <span>{after.trim()}</span> : null}
    </p>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-docs-section={id}
      className={cn('flex min-w-0 flex-col gap-5', SECTION_SCROLL)}
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{children}</p>;
}

interface TocEntry {
  id: string;
  label: string;
  count?: number;
}

/**
 * The API docs page, client side: the sticky table of contents (a selector on
 * small screens), the search, and every section. The server hands over a
 * finished model (`buildDocsModel`), so this only filters, highlights the
 * section being read and copies.
 *
 * While a search is typed, the narrative sections step aside and only the
 * matching endpoints show, area by area, with an empty state when none match.
 */
export function ApiDocsView({
  model,
  m,
  x,
  d,
  locale,
}: {
  model: DocsModel;
  m: ApiDocsChrome;
  x: ApiDocsExtras;
  d: DeveloperDocsMessages;
  locale: string;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length > 0;
  const copy = { copy: m.reference.copy, copied: m.reference.copied, copyFailed: m.reference.copyFailed };

  const areas: DocsArea[] = useMemo(
    () =>
      searching
        ? model.areas.map((a) => ({ ...a, endpoints: a.endpoints.filter((e) => endpointMatches(e, query)) }))
        : model.areas,
    [model.areas, query, searching],
  );
  const shown = areas.reduce((n, a) => n + a.endpoints.length, 0);

  const before: TocEntry[] = [
    { id: SECTION_IDS.start, label: m.toc.gettingStarted },
    { id: SECTION_IDS.auth, label: x.auth.title },
    { id: SECTION_IDS.errors, label: m.toc.errors },
    { id: SECTION_IDS.limits, label: m.toc.limits },
  ];
  const areaEntries: TocEntry[] = areas.map((a) => ({ id: a.anchor, label: a.title, count: a.endpoints.length }));
  const after: TocEntry[] = [{ id: SECTION_IDS.cannot, label: m.toc.notAllowed }];
  const visibleEntries = searching
    ? areaEntries.filter((e) => (e.count ?? 0) > 0)
    : [...before, ...areaEntries, ...after];

  // ── Scroll spy: the section (and endpoint) under the toolbar ──────────────
  const [active, setActive] = useState<string>(SECTION_IDS.start);
  const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);
  const ids = visibleEntries.map((e) => e.id).join('|');

  const spy = useCallback(() => {
    const line = (toolbarRef.current?.getBoundingClientRect().bottom ?? 0) + SPY_SLACK;
    let current: string | null = null;
    for (const id of ids.split('|')) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= line) current = id;
    }
    const list = ids.split('|');
    // At the very bottom the last section may be too short to reach the line:
    // it is still the one being read.
    const atBottom =
      window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom && list.length > 0) current = list[list.length - 1]!;
    setActive(current ?? list[0] ?? SECTION_IDS.start);
    let endpoint: string | null = null;
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="api-endpoint"]')) {
      if (el.getBoundingClientRect().top <= line) endpoint = el.id;
    }
    setActiveEndpoint(endpoint);
  }, [ids]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(spy);
    };
    spy();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [spy]);

  // A deep link (`#post-v1-forms`) on first load. The admin layout streams the
  // page in behind its loading state, so the browser looks for the fragment
  // before the page is in place and never scrolls; do it once it is.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  const goTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setActive(id);
  };

  const clear = () => {
    setQuery('');
    searchRef.current?.focus();
  };

  const activeArea = areas.find((a) => a.anchor === active);

  // ── Table of contents (desktop) ───────────────────────────────────────────
  const tocLink = (entry: TocEntry, children?: ReactNode) => {
    const isActive = entry.id === active;
    const empty = entry.count === 0;
    return (
      <li key={entry.id}>
        <a
          href={`#${entry.id}`}
          aria-current={isActive ? 'location' : undefined}
          data-toc={entry.id}
          aria-disabled={empty || undefined}
          tabIndex={empty ? -1 : undefined}
          className={cn(
            '-ml-px flex items-center justify-between gap-2 border-l-2 py-1.5 pl-3 pr-1 text-sm transition-colors',
            isActive
              ? 'border-signal font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            empty && 'pointer-events-none opacity-40',
          )}
        >
          <span className="min-w-0 truncate">{entry.label}</span>
          {entry.count !== undefined ? (
            <span className="shrink-0 font-mono text-2xs tabular-nums text-faint">{entry.count}</span>
          ) : null}
        </a>
        {children}
      </li>
    );
  };

  const toc = (
    <nav aria-label={m.toc.label} data-testid="api-docs-toc" className="flex flex-col gap-5">
      {!searching ? (
        <div className="flex flex-col gap-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-faint">{m.toc.label}</p>
          <ul className="flex flex-col border-l border-border">{before.map((e) => tocLink(e))}</ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        {searching ? (
          <p className="text-2xs font-semibold uppercase tracking-wide text-faint">{m.toc.reference}</p>
        ) : (
          <a
            href={`#${SECTION_IDS.reference}`}
            data-toc={SECTION_IDS.reference}
            className="text-2xs font-semibold uppercase tracking-wide text-faint transition-colors hover:text-foreground"
          >
            {m.toc.reference}
          </a>
        )}
        <ul className="flex flex-col border-l border-border">
          {areaEntries.map((e) =>
            tocLink(
              e,
              activeArea && activeArea.anchor === e.id && activeArea.endpoints.length > 0 ? (
                <ul className="mb-1 ml-3 mt-0.5 flex flex-col gap-0.5">
                  {activeArea.endpoints.map((ep) => (
                    <li key={ep.anchor}>
                      <a
                        href={`#${ep.anchor}`}
                        data-toc-endpoint={ep.anchor}
                        aria-current={ep.anchor === activeEndpoint ? 'location' : undefined}
                        className={cn(
                          'flex min-w-0 items-center gap-2 rounded-md px-2 py-1 font-mono text-[11px] transition-colors',
                          ep.anchor === activeEndpoint
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <MethodBadge method={ep.method} size="sm" />
                        <span className="min-w-0 truncate">{ep.path.replace(/^\/v1/, '')}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null,
            ),
          )}
        </ul>
      </div>
      {!searching ? (
        <ul className="flex flex-col border-l border-border">{after.map((e) => tocLink(e))}</ul>
      ) : null}
    </nav>
  );

  // ── Sections ──────────────────────────────────────────────────────────────
  const start = (
    <Section id={SECTION_IDS.start} title={m.toc.gettingStarted}>
      <Lead>{x.start.intro}</Lead>

      <div className="flex min-w-0 flex-col gap-2">
        <SubTitle>{d.apiUrlLabel}</SubTitle>
        {model.apiUrlConfigured ? (
          <>
            <div
              data-testid="api-docs-base-url"
              className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-panel py-1.5 pl-3 pr-1.5"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{model.apiUrl}</code>
              <CopyButton text={model.apiUrl} m={copy} label={x.endpoint.copyUrl} testId="api-docs-base-url-copy" />
            </div>
          </>
        ) : (
          <p
            data-testid="api-docs-base-url-missing"
            className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground"
          >
            {rich(d.apiUrlMissing)}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <SubTitle>{d.flowTitle}</SubTitle>
          <p className="text-sm text-muted-foreground">{d.flowBody}</p>
        </div>
        <ol className="grid min-w-0 gap-3 sm:grid-cols-2">
          {FLOW.map((step, i) => {
            const [method, path] = step.route.split(' ') as [string, string];
            return (
              <li
                key={step.id}
                data-testid={`api-docs-flow-${step.id}`}
                className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal text-2xs font-bold text-signal-foreground">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{d.flowLabels[step.id]}</span>
                </div>
                <span className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs">
                  <MethodBadge method={method as 'GET'} size="sm" />
                  <span className="min-w-0 break-all text-foreground">
                    <PathText path={path.replace(/:([A-Za-z]+)/g, '{$1}')} />
                  </span>
                </span>
                <p className="flex-1 text-sm text-muted-foreground">{rich(d.flow[step.id])}</p>
                <a
                  href={`#${apiAnchor(step.route)}`}
                  className="inline-flex items-center gap-1 self-start text-xs font-medium text-signal-ink hover:underline"
                >
                  {x.start.flowLink}
                  <i aria-hidden className="pi pi-arrow-down" style={{ fontSize: 11 }} />
                </a>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <SubTitle>{d.gotchasTitle}</SubTitle>
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {GOTCHAS.map((id) => (
            <li key={id} data-testid={`api-docs-gotcha-${id}`} className="flex min-w-0 gap-3 p-4 text-sm text-muted-foreground">
              <i aria-hidden className="pi pi-exclamation-circle mt-0.5 shrink-0 text-warning-ink" style={{ fontSize: 14 }} />
              <span className="min-w-0">{rich(d.gotchas[id])}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-signal" />
        <div className="flex min-w-0 gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-signal/15 text-signal-ink">
            <i aria-hidden className="pi pi-sparkles" style={{ fontSize: 16 }} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-semibold text-foreground">{d.skillTitle}</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">{d.skillBody}</p>
            <p className="max-w-2xl text-xs text-faint">{d.skillContents}</p>
          </div>
        </div>
        {model.apiUrlConfigured ? (
          <a
            href={SKILL_DOWNLOAD_PATH}
            download
            data-testid="api-docs-download"
            className={buttonVariants({ className: 'shrink-0 self-start sm:self-center' })}
          >
            <i aria-hidden className="pi pi-download" style={{ fontSize: 14 }} />
            {d.skillButton}
          </a>
        ) : (
          <p className="shrink-0 text-sm text-muted-foreground">{d.skillUnavailable}</p>
        )}
      </div>
    </Section>
  );

  const auth = (
    <Section id={SECTION_IDS.auth} title={x.auth.title}>
      <Lead>{rich(d.authBody)}</Lead>
      <CodePanel
        label="curl"
        code={authCurl(model.apiUrl)}
        language="curl"
        copyLabel={x.endpoint.copyCurl}
        m={copy}
        testId="api-docs-auth-curl"
      />
      <ul className="grid min-w-0 gap-3 md:grid-cols-3">
        {(
          [
            ['pi-user', x.auth.actsAs],
            ['pi-lock', x.auth.workspace],
            ['pi-key', x.auth.invalid],
          ] as const
        ).map(([icon, text]) => (
          <li key={icon} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <i aria-hidden className={`pi ${icon} text-faint`} style={{ fontSize: 15 }} />
            <span className="min-w-0">{rich(text)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );

  const statusTone = (status: number) =>
    status === 429 || status === 409
      ? 'bg-warning/15 text-warning-ink'
      : status >= 401
        ? 'bg-destructive/12 text-destructive'
        : 'bg-score/15 text-score-ink';

  const errors = (
    <Section id={SECTION_IDS.errors} title={m.errors.title}>
      <Lead>{rich(m.errors.intro)}</Lead>
      <div className="flex min-w-0 flex-col gap-3">
        <SubTitle>{m.errors.exampleTitle}</SubTitle>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{rich(m.errors.issuesBody)}</p>
        <div className="flex min-w-0 flex-col gap-2">
          <CodePanel
            label="400"
            code={EXAMPLE_ERROR_JSON}
            language="json"
            copyLabel={x.endpoint.copyResponse}
            m={copy}
            testId="api-docs-error-shape"
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <SubTitle>{m.errors.codesTitle}</SubTitle>
        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[4rem_minmax(0,13rem)_minmax(0,1fr)] gap-4 border-b border-border px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-faint sm:grid">
            <span>{m.errors.colStatus}</span>
            <span>{m.errors.colCode}</span>
            <span>{m.errors.colMeaning}</span>
          </div>
          <ul className="divide-y divide-border">
            {API_ERROR_CODES.map((c) => (
              <li
                key={c.code}
                data-testid={`api-docs-error-${c.code}`}
                className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[4rem_minmax(0,13rem)_minmax(0,1fr)] sm:gap-x-4"
              >
                <span
                  className={cn(
                    'h-5 self-start rounded-full px-2 text-center font-mono text-2xs font-semibold leading-5',
                    statusTone(c.status),
                  )}
                >
                  {c.status}
                </span>
                <code className="min-w-0 break-all font-mono text-[13px] font-semibold text-foreground">{c.code}</code>
                <p className="col-span-2 min-w-0 text-sm text-muted-foreground sm:col-span-1">
                  {rich(m.errors.codes[c.code])}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <SubTitle>{m.errors.issueCodesTitle}</SubTitle>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {API_ISSUE_CODES.map((code) => (
            <li
              key={code}
              data-testid={`api-docs-issue-${code}`}
              className="grid min-w-0 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]"
            >
              <code className="min-w-0 break-all font-mono text-[13px] font-semibold text-foreground">{code}</code>
              <p className="min-w-0 text-sm text-muted-foreground">{rich(m.errors.issueCodes[code])}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );

  const limits = (
    <Section id={SECTION_IDS.limits} title={m.limits.title}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(
          [
            ['rate', 'pi-clock', API_LIMITS.callsPerMinute, m.limits.rate, m.limits.rateBody],
            ['keys', 'pi-key', API_LIMITS.activeKeysPerMember, m.limits.keys, m.limits.keysBody],
          ] as const
        ).map(([id, icon, value, template, body]) => (
          <div
            key={id}
            data-testid={`api-docs-limit-${id}`}
            className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal/15 text-signal-ink">
              <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 14 }} />
            </span>
            <Stat template={template} value={value} />
            <p className="text-sm text-muted-foreground">{rich(body)}</p>
          </div>
        ))}
      </div>
    </Section>
  );

  const cannot = (
    <Section id={SECTION_IDS.cannot} title={m.notAllowed.title}>
      <Lead>{rich(m.notAllowed.intro)}</Lead>
      <ul className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {API_NOT_ALLOWED.map((id) => (
          <li
            key={id}
            data-testid={`api-docs-cannot-${id}`}
            className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4"
          >
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <i aria-hidden className={`pi ${NOT_ALLOWED_ICON[id]}`} style={{ fontSize: 14 }} />
              <i
                aria-hidden
                className="pi pi-ban absolute -bottom-1 -right-1 rounded-full bg-card text-destructive"
                style={{ fontSize: 11 }}
              />
            </span>
            <span className="min-w-0 pt-1.5 text-sm text-muted-foreground">{rich(m.notAllowed.items[id])}</span>
          </li>
        ))}
      </ul>
      <CodePanel
        label="403"
        code={EXAMPLE_KEY_NOT_ALLOWED}
        language="json"
        copyLabel={x.endpoint.copyResponse}
        m={copy}
        testId="api-docs-key-not-allowed"
      />
    </Section>
  );

  const referenceIntro = (
    <Section id={SECTION_IDS.reference} title={m.reference.title}>
      <Lead>{rich(m.reference.intro)}</Lead>
    </Section>
  );

  const reference = areas
    .filter((a) => !searching || a.endpoints.length > 0)
    .map((a) => (
      <section
        key={a.id}
        id={a.anchor}
        aria-labelledby={`${a.anchor}-title`}
        data-docs-section={a.anchor}
        data-testid={`api-docs-area-${a.id}`}
        className={cn('flex min-w-0 flex-col gap-4', SECTION_SCROLL)}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`${a.anchor}-title`} className="text-xl font-semibold tracking-tight text-foreground">
              {a.title}
            </h2>
            <span className="text-xs text-faint">
              {a.endpoints.length === 1 ? x.endpointCount.one : t(x.endpointCount.other, { count: a.endpoints.length })}
            </span>
          </div>
          <Lead>{rich(a.intro)}</Lead>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {a.endpoints.map((e) => (
            <EndpointCard key={e.route} endpoint={e} m={m.reference} x={x.endpoint} />
          ))}
        </div>
      </section>
    ));

  const selectOptions = visibleEntries.map((e) => ({
    value: e.id,
    label: e.count !== undefined ? `${e.label} (${e.count})` : e.label,
  }));

  return (
    <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10 xl:gap-14">
      <aside className="hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto pb-6 pr-1">{toc}</div>
      </aside>

      <div className="min-w-0">
        <div
          ref={toolbarRef}
          data-testid="api-docs-toolbar"
          className="sticky top-[61px] z-20 -mx-6 mb-8 flex min-w-0 items-center gap-2 border-b border-border bg-background/90 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:-mx-8 sm:px-8 md:top-0 lg:mx-0 lg:px-0"
        >
          {visibleEntries.length > 0 ? (
            <div className="min-w-0 basis-[44%] lg:hidden">
              <Select
                value={visibleEntries.some((e) => e.id === active) ? active : (visibleEntries[0]?.id ?? '')}
                onChange={goTo}
                options={selectOptions}
                ariaLabel={m.toc.jumpLabel}
                locale={locale}
                className="h-10"
              />
            </div>
          ) : null}
          <div className="relative min-w-0 flex-1">
            <i
              aria-hidden
              className="pi pi-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              style={{ fontSize: 13 }}
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape' && query) {
                  ev.preventDefault();
                  setQuery('');
                }
              }}
              aria-label={m.search.label}
              placeholder={m.search.placeholder}
              data-testid="api-docs-search"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-10 text-sm placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <SearchClearButton query={query} label={m.search.clear} onClear={clear} testId="api-docs-search-clear" />
          </div>
          <p
            aria-live="polite"
            data-testid="api-docs-search-count"
            className={cn('hidden shrink-0 text-xs tabular-nums text-faint', searching && 'sm:block')}
          >
            {searching ? (shown === 1 ? x.endpointCount.one : t(x.endpointCount.other, { count: shown })) : ''}
          </p>
        </div>

        {searching && shown === 0 ? (
          <div
            data-testid="api-docs-empty"
            className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <i aria-hidden className="pi pi-search" style={{ fontSize: 18 }} />
            </span>
            <p className="max-w-full break-words text-base font-semibold text-foreground">
              {t(m.search.empty, { query: query.trim() })}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">{rich(x.searchHint)}</p>
            <button
              type="button"
              onClick={clear}
              className={buttonVariants({ variant: 'soft', size: 'sm', className: 'mt-1' })}
            >
              {m.search.clear}
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-14">
            {searching ? null : (
              <>
                {start}
                {auth}
                {errors}
                {limits}
                {referenceIntro}
              </>
            )}
            {reference}
            {searching ? null : cannot}
          </div>
        )}
      </div>
    </div>
  );
}

