import Link from 'next/link';
import type { FormsMessages } from '@quill/shared';
import { AgentLogo } from '@/components/agent-logos';
import { MCP_APPS, MCP_APP_NAMES } from '@/components/mcp-apps';
import { buttonVariants } from '@/components/ui/button';
import './agent-promo.css';

type BannerMessages = FormsMessages['admin']['home']['agentBanner'];

export const CONNECT_PATH = '/admin/developers/connect';

/**
 * The home's top banner: control dForms from an AI agent, a marquee of the
 * apps' official logos, and the way to connect. It stays on the home.
 */
export function AgentBanner({ m }: { m: BannerMessages }) {
  return (
    <section
      aria-labelledby="agent-banner-title"
      data-testid="home-agent-banner"
      className="relative mb-8 overflow-hidden rounded-2xl border border-signal/40 bg-gradient-to-r from-signal/[0.12] via-signal/[0.05] to-card"
    >
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:gap-8">
        <div className="min-w-0 lg:max-w-md">
          <h2 id="agent-banner-title" className="text-lg font-semibold leading-snug text-foreground sm:text-xl">
            {m.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{m.body}</p>
        </div>
        <div className="ap-marquee min-w-0 flex-1 overflow-hidden" data-testid="home-agent-marquee">
          <div className="ap-marquee__track">
            {[0, 1].map((copy) => (
              <ul
                key={copy}
                aria-hidden={copy === 1 || undefined}
                className={`flex shrink-0 items-center gap-3 pr-3${copy === 1 ? ' ap-marquee__copy' : ''}`}
              >
                {MCP_APPS.map((app) => (
                  <li
                    key={app}
                    className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm"
                  >
                    <AgentLogo app={app} size={18} />
                    {MCP_APP_NAMES[app]}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
        <Link
          href={CONNECT_PATH}
          data-testid="home-agent-banner-cta"
          className={`${buttonVariants({ variant: 'default' })} shrink-0 self-start lg:self-center`}
        >
          {m.cta}
          <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
        </Link>
      </div>
    </section>
  );
}
