import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  createLinkPage,
  deleteLinkPage,
  findPublicLinkPage,
  getAccountBranding,
  getDefaultLinkPageRow,
  getLinkPageRow,
  getMe,
  linkPageSlugsInUse,
  listLinkPageForms,
  listLinkPages,
  setLinkPage,
  updateLinkPage,
  type LinkPageRow,
  type LinkPageWriteFailure,
} from '@quill/db';
import {
  LINK_PAGE_MAX_PAGES,
  linkPageEventSchema,
  parseStoredLinkPage,
  resolveLinkPage,
  slugFromName,
  uniqueLinkPageSlug,
  type BrandKit,
  type LinkPage,
  type LinkPageFormRef,
  type LinkPageSummary,
  type PublicLinkPage,
} from '@quill/types';
import { AnalyticsEffects } from './analytics-effects';
import type { ServiceError } from './http';
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

/** Which page an editor view is about. Null on the legacy view of a workspace with no page. */
export interface LinkPageIdentity {
  id: string | null;
  slug: string | null;
  name: string | null;
  isDefault: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

/** One page, as its editor (and `GET /v1/link-pages/:id`) reads it. */
export type LinkPageDetailView = LinkPageEditorView & LinkPageIdentity;

/** The workspace's pages, as the list screen reads them. */
export interface LinkPageListView {
  accountCode: string;
  max: number;
  pages: LinkPageSummary[];
}

/** The message each refused write answers with (English, like every API message). */
const FAILURES: Record<LinkPageWriteFailure, ServiceError> = {
  NOT_FOUND: { error: 'NOT_FOUND', message: 'Not found.', status: 404 },
  SLUG_TAKEN: {
    error: 'SLUG_TAKEN',
    message: 'Another page of this workspace already uses that address. Pick another one.',
    status: 409,
  },
  LIMIT: {
    error: 'PAGE_LIMIT',
    message: `A workspace keeps up to ${LINK_PAGE_MAX_PAGES} pages. Delete one before adding another.`,
    status: 409,
  },
  DEFAULT_PAGE: {
    error: 'DEFAULT_PAGE',
    message: 'The default page cannot be deleted. Make another page the default first.',
    status: 409,
  },
  OTHER_PAGES: {
    error: 'DEFAULT_PAGE',
    message: 'This workspace has other pages, so its default page cannot be deleted. Make another page the default first.',
    status: 409,
  },
};

export function failure(reason: LinkPageWriteFailure): ServiceError {
  return FAILURES[reason];
}

/** The fields a page row carries into a view. */
function identity(row: LinkPageRow | null): LinkPageIdentity {
  return {
    id: row?.id ?? null,
    slug: row?.slug ?? null,
    name: row?.name ?? null,
    isDefault: row?.isDefault ?? false,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export function summaryOf(row: LinkPageRow): LinkPageSummary {
  const page = parseStoredLinkPage(row.config);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isDefault: row.isDefault,
    live: page?.enabled === true,
    buttons: page?.items?.length ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface LinkPageCreate {
  name?: string;
  slug?: string;
  page?: LinkPage;
}

export interface LinkPageUpdate {
  name?: string;
  slug?: string;
  isDefault?: true;
  page?: LinkPage;
}

/**
 * The workspace link pages: the public reads, the editor's reads and writes,
 * and the pages' analytics. What a page shows is decided by
 * `resolveLinkPage` (@quill/types), the same function the editor's preview runs.
 *
 * Every admin method takes the caller's `accountId` and reads or writes only
 * that workspace's pages: an id from another workspace is a 404.
 */
@Injectable()
export class LinkPageService {
  private readonly log = new Logger('LinkPageService');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(AnalyticsEffects) private readonly analytics?: AnalyticsEffects,
  ) {}

  /**
   * A published page for a public URL, or null (a 404) for every case that is
   * not an explicitly enabled page: no such workspace, no such page, a page
   * switched off, or a stored blob that no longer parses. `slug` null is the
   * default page (`/{accountCode}`); a retired slug answers the page that
   * used to have it, with its current `pageSlug`, so the caller redirects.
   */
  async publicPage(accountCode: string, slug: string | null = null): Promise<PublicLinkPage | null> {
    const found = await findPublicLinkPage(this.db, accountCode, slug);
    if (!found?.page) return null;
    const page = parseStoredLinkPage(found.page.config);
    if (!page?.enabled) return null;
    const [forms, kit] = await Promise.all([
      listLinkPageForms(this.db, found.accountId),
      getAccountBranding(this.db, found.accountId),
    ]);
    return {
      ...resolveLinkPage(page, {
        accountCode: found.accountCode,
        accountName: found.accountName,
        forms,
        brandKit: kit?.config ?? null,
      }),
      pageSlug: found.page.slug,
      isDefault: found.page.isDefault,
    };
  }

  private async context(accountId: string, memberId: string) {
    const me = await getMe(this.db, accountId, memberId);
    if (!me) return null;
    const [forms, kit] = await Promise.all([
      listLinkPageForms(this.db, accountId),
      getAccountBranding(this.db, accountId),
    ]);
    return {
      accountCode: me.accountCode,
      accountName: me.accountName,
      forms,
      brandKit: (kit?.config ?? null) as BrandKit | null,
    };
  }

  /** The DEFAULT page and everything its editor needs (`GET /v1/link-page`). */
  async editorView(accountId: string, memberId: string): Promise<LinkPageDetailView | null> {
    const ctx = await this.context(accountId, memberId);
    if (!ctx) return null;
    const row = await getDefaultLinkPageRow(this.db, accountId);
    return { ...ctx, page: row ? parseStoredLinkPage(row.config) : null, ...identity(row) };
  }

  /** One page and everything its editor needs, or null when it is not this workspace's. */
  async pageView(accountId: string, memberId: string, id: string): Promise<LinkPageDetailView | null> {
    const row = await getLinkPageRow(this.db, accountId, id);
    if (!row) return null;
    const ctx = await this.context(accountId, memberId);
    if (!ctx) return null;
    return { ...ctx, page: parseStoredLinkPage(row.config), ...identity(row) };
  }

  /** Every page of the workspace, the default first. */
  async list(accountId: string, memberId: string): Promise<LinkPageListView | null> {
    const me = await getMe(this.db, accountId, memberId);
    if (!me) return null;
    const rows = await listLinkPages(this.db, accountId);
    return { accountCode: me.accountCode, max: LINK_PAGE_MAX_PAGES, pages: rows.map(summaryOf) };
  }

  /**
   * Form buttons naming a form this workspace does not have are dropped, so
   * a stored page only ever points at the workspace's own forms (the public
   * read drops them too, for a form deleted later).
   */
  private async ownFormsOnly(accountId: string, page: LinkPage): Promise<LinkPage> {
    const own = new Set((await listLinkPageForms(this.db, accountId)).map((f) => f.id));
    return { ...page, items: page.items?.filter((item) => item.type === 'link' || own.has(item.formId)) };
  }

  /**
   * Store an already validated page as the DEFAULT page (`PUT /v1/link-page`):
   * created as `main` when the workspace has none. `null` removes it when it
   * is the workspace's only page, as it always did.
   */
  async save(accountId: string, page: LinkPage | null): Promise<LinkPage | null | ServiceError> {
    const kept = page == null ? null : await this.ownFormsOnly(accountId, page);
    const r = await setLinkPage(this.db, accountId, kept);
    if (!r.ok) return failure(r.reason);
    return kept;
  }

  /** A free slug for a new page: the asked one as is, or one made from `base`. */
  private async freeSlug(accountId: string, base: string): Promise<string> {
    return uniqueLinkPageSlug(base, await linkPageSlugsInUse(this.db, accountId));
  }

  /**
   * Add a page. Without a slug, one is made from the name (or `page`), made
   * unique; a slug asked for explicitly that is taken is a 409. Without
   * content, the page starts empty and unpublished. The workspace's first page
   * becomes its default.
   */
  async create(accountId: string, input: LinkPageCreate): Promise<LinkPageRow | ServiceError> {
    const name = input.name ?? '';
    const slug = input.slug ?? (await this.freeSlug(accountId, slugFromName(name) ?? 'page'));
    const config = input.page ? await this.ownFormsOnly(accountId, input.page) : { version: 1, enabled: false };
    const r = await createLinkPage(this.db, { accountId, name, slug, config });
    return r.ok ? r.value : failure(r.reason);
  }

  /** Change a page's name, slug, content, or make it the default. */
  async update(accountId: string, id: string, input: LinkPageUpdate): Promise<LinkPageRow | ServiceError> {
    const config = input.page ? await this.ownFormsOnly(accountId, input.page) : undefined;
    const r = await updateLinkPage(this.db, accountId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(input.isDefault ? { makeDefault: true } : {}),
    });
    return r.ok ? r.value : failure(r.reason);
  }

  /** Delete a page that is not the default. */
  async remove(accountId: string, id: string): Promise<LinkPageRow | ServiceError> {
    const r = await deleteLinkPage(this.db, accountId, id);
    return r.ok ? r.value : failure(r.reason);
  }

  /**
   * Copy a page: same content, switched OFF (a copy is a draft for the next
   * fair, not a second live page), never the default, under a new slug (the
   * original's plus `-2`, `-3`... unless one is given) and, unless one is
   * given, the same name.
   */
  async duplicate(accountId: string, id: string, input: { name?: string; slug?: string }): Promise<LinkPageRow | ServiceError> {
    const source = await getLinkPageRow(this.db, accountId, id);
    if (!source) return failure('NOT_FOUND');
    const stored = (source.config && typeof source.config === 'object' ? source.config : { version: 1 }) as Record<
      string,
      unknown
    >;
    const slug = input.slug ?? (await this.freeSlug(accountId, source.slug));
    const r = await createLinkPage(this.db, {
      accountId,
      name: input.name ?? source.name,
      slug,
      config: { ...stored, enabled: false },
    });
    return r.ok ? r.value : failure(r.reason);
  }

  /**
   * One page view or click, for product analytics.
   *
   * Enqueued through the outbox like every other capture (never inline), and
   * only for a page that is really published: a click reported against a
   * page that is not live is dropped, so the endpoint cannot be used to write
   * events about any workspace code. The distinct id is the WORKSPACE, never
   * the visitor and never the owner: visitors are not users of the product,
   * and the owner did not do the viewing. `page_slug` and `page_id` say which
   * of the workspace's pages it was, so clicks compare per page.
   */
  async event(
    accountCode: string,
    raw: unknown,
    slug: string | null = null,
  ): Promise<{ ok: true } | { error: string; message: string; status: number }> {
    const input = linkPageEventSchema.parse(raw);
    const found = await findPublicLinkPage(this.db, accountCode, slug);
    if (!found?.page || !parseStoredLinkPage(found.page.config)?.enabled) {
      return { error: 'NOT_FOUND', message: 'Page not found.', status: 404 };
    }
    if (!this.analytics?.enabled) return { ok: true };
    const base = {
      account_code: found.accountCode,
      page_slug: found.page.slug,
      page_id: found.page.id,
      page_is_default: found.page.isDefault,
    };
    const distinctId = `account:${found.accountId}`;
    try {
      if (input.type === 'view') {
        await this.analytics.capture('link_page_viewed', { distinctId, accountId: found.accountId, properties: base });
      } else {
        await this.analytics.capture('link_page_clicked', {
          distinctId,
          accountId: found.accountId,
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
      this.log.warn(`link page event dropped for ${found.accountCode}: ${String(err)}`);
    }
    return { ok: true };
  }
}
