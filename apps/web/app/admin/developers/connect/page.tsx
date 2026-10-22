import Link from 'next/link';
import { getMessages } from '@quill/shared';
import { getLocale } from '@/lib/locale';
import { mcpOauthEnabled, mcpSnippets, publicMcpUrl } from '@/lib/developer-skill/mcp-connect';
import { buttonVariants } from '@/components/ui/button';
import { McpLogos } from '@/components/mcp-logos';
import { ConnectGuide } from '../connect-guide';
import { stepText } from '../step-text';
import { ToolsCard } from '../tools-card';

export const dynamic = 'force-dynamic';

/**
 * The connect page: how to connect Claude, ChatGPT, Claude Code, Codex,
 * Cursor or OpenClaw to dForms by logging in to the person's account (the
 * MCP's OAuth sign-in), no API key. The header, the recommended sign-in card
 * with a tab per app (a walkthrough on top, the steps under it), then what
 * the MCP can do, which leads to the Tools page.
 *
 * The MCP address is `MCP_PUBLIC_URL`, read from the server's runtime
 * environment on every request. The guide shows only when the MCP takes a
 * sign-in (`mcpOauthEnabled`, which also requires that address, the audience
 * the API checks every token against); otherwise a note says the connector is
 * not available on this deployment.
 *
 * API keys have no place in the dashboard any more: none is created, listed
 * or revoked here. Keys that already exist keep working with the REST API.
 */
export default async function DeveloperConnectPage() {
  const locale = await getLocale();
  const m = getMessages(locale).admin;
  const c = m.developers.connect;
  const mcpUrl = mcpOauthEnabled() ? publicMcpUrl() : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-signal-ink">
            <McpLogos size={16} />
            {m.developers.title}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{c.heading}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{c.intro}</p>
        </div>
        <Link
          href="/admin/developers/tools"
          data-testid="tools-link"
          className={`${buttonVariants({ variant: 'soft' })} shrink-0 self-start`}
        >
          <i aria-hidden className="pi pi-sparkles" style={{ fontSize: 13 }} />
          {m.chrome.nav.tools}
        </Link>
      </header>

      <div className="flex flex-col gap-6">
        {mcpUrl ? (
          <ConnectGuide m={c} snippets={mcpSnippets(mcpUrl)} />
        ) : (
          <section
            data-testid="mcp-connect-unavailable"
            className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-6 sm:px-7"
          >
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <i aria-hidden className="pi pi-info-circle text-muted-foreground" style={{ fontSize: 15 }} />
              {c.unavailableTitle}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{stepText(c.unavailableBody)}</p>
          </section>
        )}

        <ToolsCard m={m.developers} />
      </div>
    </div>
  );
}
