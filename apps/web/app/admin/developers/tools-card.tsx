import Link from 'next/link';
import { t, type FormsMessages } from '@quill/shared';
import { TOOL_COUNT, TOOL_GROUPS, TOOL_GROUP_ICONS, TOOL_GROUP_ORDER } from './tool-groups';

type DevMessages = FormsMessages['admin']['developers'];

/**
 * "What you can do with the MCP" on the connect page: the eight groups of
 * tools, each with what it covers and how many tools it holds, and the way to
 * the Tools page, where every tool is spelled out with an example request.
 */
export function ToolsCard({ m }: { m: DevMessages }) {
  return (
    <section
      aria-labelledby="mcp-tools-title"
      data-testid="mcp-tools"
      className="rounded-2xl border border-border bg-card px-5 py-6 sm:px-7"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="mcp-tools-title" className="text-lg font-semibold text-foreground">
            {m.connect.toolsTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(m.connect.toolsIntro, { count: TOOL_COUNT })}</p>
        </div>
        <Link
          href="/admin/developers/tools"
          data-testid="mcp-tools-link"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
        >
          {m.connect.toolsLink}
          <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
        </Link>
      </div>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TOOL_GROUP_ORDER.map((group) => (
          <li key={group} data-testid={`mcp-tools-${group}`}>
            <Link
              href={`/admin/developers/tools#${group}`}
              className="flex h-full flex-col rounded-xl border border-border bg-panel p-4 transition-colors hover:border-foreground/20"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal/15 text-signal-ink">
                  <i aria-hidden className={`pi ${TOOL_GROUP_ICONS[group]}`} style={{ fontSize: 14 }} />
                </span>
                <span className="rounded-full bg-card px-2 py-0.5 font-mono text-2xs font-medium text-muted-foreground">
                  {TOOL_GROUPS[group].length}
                </span>
              </span>
              <span className="mt-3 text-sm font-semibold text-foreground">{m.tools.groups[group].title}</span>
              <span className="mt-1 text-sm text-muted-foreground">{m.tools.groups[group].body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
