'use client';

import type { ReactNode } from 'react';
import { t, type ApiMethod, type ApiParamIn } from '@quill/shared';
import { cn } from '@/lib/cn';
import { CodePanel, rich } from './code-panel';
import type { ApiDocsChrome, ApiDocsExtras, DocsEndpoint, DocsParam } from './docs-model';

type ReferenceMessages = ApiDocsChrome['reference'];
type ExtraMessages = ApiDocsExtras['endpoint'];

/**
 * Method colours, one per verb family: reads green, creates violet, changes
 * amber, deletes red. Soft fills with the `-ink` text tokens, which clear
 * contrast on both themes.
 */
const METHOD_TONE: Record<ApiMethod, string> = {
  GET: 'bg-signal/15 text-signal-ink',
  POST: 'bg-score/15 text-score-ink',
  PUT: 'bg-warning/15 text-warning-ink',
  PATCH: 'bg-warning/15 text-warning-ink',
  DELETE: 'bg-destructive/12 text-destructive',
};

export function MethodBadge({ method, size = 'md' }: { method: ApiMethod; size?: 'sm' | 'md' }) {
  return (
    <span
      data-method={method}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-mono font-semibold tracking-wide',
        size === 'md' ? 'h-6 min-w-[3.75rem] px-2 text-2xs' : 'h-4 min-w-[2.75rem] px-1 text-[9px]',
        METHOD_TONE[method],
      )}
    >
      {method}
    </span>
  );
}

/**
 * `/v1/forms/{id}` with its parameters set apart from the fixed segments. A
 * narrow screen wraps it before a slash, never in the middle of a segment.
 */
export function PathText({ path }: { path: string }) {
  return (
    <>
      {path.split(/(\{[^}]+\})/).map((part, i) =>
        part.startsWith('{') ? (
          <span key={i} className="text-signal-ink">
            {part}
          </span>
        ) : (
          part.split(/(?=\/)/).map((seg, j) => (
            <span key={`${i}-${j}`}>
              {j > 0 ? <wbr /> : null}
              {seg}
            </span>
          ))
        ),
      )}
    </>
  );
}

function StatusPill({ status }: { status: number }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-signal/15 px-2 font-mono text-2xs font-semibold text-signal-ink">
      {status}
    </span>
  );
}

const PARAM_GROUPS: readonly ApiParamIn[] = ['path', 'query', 'body'];

function Params({ params, m, x }: { params: DocsParam[]; m: ReferenceMessages; x: ExtraMessages }) {
  if (params.length === 0) {
    return <p className="text-sm text-faint">{x.noParameters}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {PARAM_GROUPS.map((group) => {
        const rows = params.filter((p) => p.in === group);
        if (rows.length === 0) return null;
        return (
          <div key={group} data-param-group={group} className="flex min-w-0 flex-col">
            <h5 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">{m.in[group]}</h5>
            <ul className="divide-y divide-border border-y border-border">
              {rows.map((p) => (
                <li
                  key={`${group}-${p.name}`}
                  data-testid="api-param"
                  className="grid min-w-0 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <code className="break-all font-mono text-[13px] font-semibold text-foreground">{p.name}</code>
                    <span className="break-words font-mono text-2xs text-faint">{p.type}</span>
                    {p.required ? (
                      <span className="text-2xs font-semibold uppercase tracking-wide text-warning-ink">
                        {m.required}
                      </span>
                    ) : null}
                  </div>
                  <p className="min-w-0 text-sm text-muted-foreground">{rich(p.description)}</p>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Flag({ icon, tone, label, hint }: { icon: string; tone: string; label: string; hint: string }) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span
        className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium', tone)}
      >
        <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 11 }} />
        {label}
      </span>
      <span className="min-w-0">{rich(hint)}</span>
    </p>
  );
}

export function EndpointCard({
  endpoint: e,
  m: em,
  x,
  className,
}: {
  endpoint: DocsEndpoint;
  m: ReferenceMessages;
  x: ExtraMessages;
  className?: string;
}) {
  const copy = { copy: em.copy, copied: em.copied, copyFailed: em.copyFailed };
  const flags: ReactNode[] = [];
  if (e.adminOnly) {
    flags.push(
      <Flag
        key="admin"
        icon="pi-shield"
        tone="border-score/30 text-score-ink"
        label={em.adminOnly}
        hint={em.adminOnlyHint}
      />,
    );
  }
  if (e.destructive) {
    flags.push(
      <Flag
        key="destructive"
        icon="pi-exclamation-triangle"
        tone="border-destructive/30 text-destructive"
        label={em.destructive}
        hint={em.destructiveHint}
      />,
    );
  }

  return (
    <article
      id={e.anchor}
      data-testid="api-endpoint"
      data-route={e.route}
      aria-labelledby={`${e.anchor}-title`}
      className={cn('min-w-0 scroll-mt-36 rounded-xl border border-border bg-card md:scroll-mt-24', className)}
    >
      <header className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <MethodBadge method={e.method} />
          <h3
            id={`${e.anchor}-title`}
            className="min-w-0 flex-1 pt-0.5 font-mono text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]"
          >
            <span className="sr-only">{e.method} </span>
            <PathText path={e.path} />
          </h3>
          <a
            href={`#${e.anchor}`}
            aria-label={t(em.anchorLabel, { route: `${e.method} ${e.path}` })}
            data-testid="api-endpoint-anchor"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-muted hover:text-foreground"
          >
            <i aria-hidden className="pi pi-link" style={{ fontSize: 13 }} />
          </a>
        </div>
        <p className="text-sm text-muted-foreground">{rich(e.description)}</p>
        {flags.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {flags}
          </div>
        ) : null}
      </header>

      <div className="flex min-w-0 flex-col gap-5 border-t border-border p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-xs font-semibold text-foreground">{em.params}</h4>
          <Params params={e.params} m={em} x={x} />
        </div>

        <div className="grid min-w-0 gap-4">
          <CodePanel
            label={em.request}
            code={e.curl}
            language="curl"
            copyLabel={x.copyCurl}
            m={copy}
            testId={`${e.anchor}-curl`}
          />
          {e.response !== null ? (
            <CodePanel
              label={
                e.responseType === 'csv'
                  ? `${t(em.response, { status: e.status })} · ${x.csv}`
                  : t(em.response, { status: e.status })
              }
              code={e.response}
              language={e.responseType === 'csv' ? 'text' : 'json'}
              copyLabel={x.copyResponse}
              m={copy}
              fold={{ more: x.showMore, less: x.showLess }}
              testId={`${e.anchor}-response`}
            />
          ) : (
            <div
              data-testid={`${e.anchor}-response`}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground"
            >
              <StatusPill status={e.status} />
              <span>{em.noContent}</span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
