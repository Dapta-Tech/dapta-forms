import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  getAccountBranding,
  getLinkPageByCode,
  getLinkPageRaw,
  getMe,
  listLinkPageForms,
  setLinkPage,
} from '@quill/db';
import {
  linkPageEventSchema,
  parseStoredLinkPage,
  resolveLinkPage,
  type BrandKit,
  type LinkPage,
  type LinkPageFormRef,
  type PublicLinkPage,
} from '@quill/types';
import { AnalyticsEffects } from './analytics-effects';
import { DB } from './tokens';

/** What the editor loads: the stored page and everything its preview needs. */
export interface LinkPageEditorView {
  accountCode: string;
  accountName: string;
  /** The stored blob, parsed, or null when the workspace has no page yet. */
  page: LinkPage | null;
  forms: LinkPageFormRef[];
  brandKit: BrandKit | null;
}

/**
 * The workspace link page: the public read, the editor's read and write, and
 * the page's analytics. What the page shows is decided by `resolveLinkPage`
 * (@quill/types), the same function the editor's preview runs.
 */
@Injectable()
export class LinkPageService {
  private readonly log = new Logger('LinkPageService');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(AnalyticsEffects) private readonly analytics?: AnalyticsEffects,
  ) {}

  /**
   * The published page for a public code, or null (a 404) for every case that
   * is not an explicitly enabled page: no such workspace, no page saved, a
   * page switched off, or a stored blob that no longer parses.
   */
  async publicPage(accountCode: string): Promise<PublicLinkPage | null> {
    const row = await getLinkPageByCode(this.db, accountCode);
    if (!row) return null;
    const page = parseStoredLinkPage(row.page);
    if (!page?.enabled) return null;
    const [forms, kit] = await Promise.all([
      listLinkPageForms(this.db, row.accountId),
      getAccountBranding(this.db, row.accountId),
    ]);
    return resolveLinkPage(page, {
      accountCode: row.accountCode,
      accountName: row.accountName,
      forms,
      brandKit: kit?.config ?? null,
    });
  }

  /** Everything the editor needs, scoped to the caller's workspace. */
  async editorView(accountId: string, memberId: string): Promise<LinkPageEditorView | null> {
    const me = await getMe(this.db, accountId, memberId);
    if (!me) return null;
    const [raw, forms, kit] = await Promise.all([
      getLinkPageRaw(this.db, accountId),
      listLinkPageForms(this.db, accountId),
      getAccountBranding(this.db, accountId),
    ]);
    return {
      accountCode: me.accountCode,
      accountName: me.accountName,
      page: parseStoredLinkPage(raw),
      forms,
      brandKit: kit?.config ?? null,
    };
  }

  /**
   * Store an already validated page. Form buttons naming a form this
   * workspace does not have are dropped here, so the stored list only ever
   * points at the workspace's own forms (the public read drops them too, for
   * a form deleted later).
   */
  async save(accountId: string, page: LinkPage | null): Promise<LinkPage | null> {
    if (page == null) {
      await setLinkPage(this.db, accountId, null);
      return null;
    }
    const own = new Set((await listLinkPageForms(this.db, accountId)).map((f) => f.id));
    const kept: LinkPage = {
      ...page,
      items: page.items?.filter((item) => item.type === 'link' || own.has(item.formId)),
    };
    await setLinkPage(this.db, accountId, kept);
    return kept;
  }

  /**
   * One page view or click, for product analytics.
   *
   * Enqueued through the outbox like every other capture (never inline), and
   * only for a page that is really published: a click reported against a
   * workspace with no live page is dropped, so the endpoint cannot be used to
   * write events about any workspace code. The distinct id is the WORKSPACE,
   * never the visitor and never the owner: visitors are not users of the
   * product, and the owner did not do the viewing.
   */
  async event(accountCode: string, raw: unknown): Promise<{ ok: true } | { error: string; message: string; status: number }> {
    const input = linkPageEventSchema.parse(raw);
    const row = await getLinkPageByCode(this.db, accountCode);
    if (!row || !parseStoredLinkPage(row.page)?.enabled) {
      return { error: 'NOT_FOUND', message: 'Page not found.', status: 404 };
    }
    if (!this.analytics?.enabled) return { ok: true };
    const base = { account_code: row.accountCode };
    try {
      if (input.type === 'view') {
        await this.analytics.capture('link_page_viewed', {
          distinctId: `account:${row.accountId}`,
          accountId: row.accountId,
          properties: base,
        });
      } else {
        await this.analytics.capture('link_page_clicked', {
          distinctId: `account:${row.accountId}`,
          accountId: row.accountId,
          properties: {
            ...base,
            link_type: input.linkType,
            position: input.position ?? null,
            network: input.network ?? null,
            form_slug: input.slug ?? null,
          },
        });
      }
    } catch (err) {
      this.log.warn(`link page event dropped for ${row.accountCode}: ${String(err)}`);
    }
    return { ok: true };
  }
}
