/**
 * The WORKSPACE LINK PAGES: up to `LINK_PAGE_MAX_PAGES` public pages per
 * workspace, each a column of buttons (forms the team chose, mixed with custom
 * links), a row of social icons and a logo, name and bio. The default page
 * answers at `/{accountCode}`, every other one at `/{accountCode}/p/{slug}`.
 *
 * Each page's content is one JSON blob (a `link_page` row's `config`,
 * migration 0027; the single page before it lived on `account.link_page`,
 * 0025), versioned like the form config and extended the same way: add
 * optional fields, never repurpose one.
 *
 * `enabled` defaults to FALSE and the column defaults to NULL, so the page
 * answers 404 until someone in the workspace turns it on.
 *
 * Everything that decides what the page SHOWS lives in `resolveLinkPage`, a
 * pure function the API runs for the public page and the admin editor runs
 * for its live preview, so the two cannot disagree.
 */
import { z } from 'zod';
import { isSafeHttpUrl, validateVanitySlug, withNewFormBranding, type FormBranding } from '@quill/engine';
import type { BrandKit } from './index';

// --- Socials -------------------------------------------------------------------

/** The networks the page offers, in the order the icons render. */
export const LINK_PAGE_SOCIALS = ['instagram', 'x', 'youtube', 'tiktok', 'whatsapp'] as const;
export type LinkPageSocial = (typeof LINK_PAGE_SOCIALS)[number];

/** Hosts each URL network accepts. A link to anywhere else is refused. */
const SOCIAL_HOSTS: Record<Exclude<LinkPageSocial, 'whatsapp'>, readonly string[]> = {
  instagram: ['instagram.com', 'www.instagram.com', 'm.instagram.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'mobile.x.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'],
};

/** How a bare handle becomes a URL on each network. */
const HANDLE_URL: Record<Exclude<LinkPageSocial, 'whatsapp'>, (handle: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}`,
  x: (h) => `https://x.com/${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
};

/**
 * What each network allows in a handle (the part after `@`). Instagram and
 * TikTok take dots and underscores; X takes no dot; YouTube handles take
 * dots, hyphens and underscores.
 */
const HANDLE_RULES: Record<Exclude<LinkPageSocial, 'whatsapp'>, RegExp> = {
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
  youtube: /^[A-Za-z0-9._-]{3,30}$/,
  tiktok: /^[A-Za-z0-9._]{2,24}$/,
};

/**
 * Endings that make a dotted value read as a web address rather than a handle.
 * `@josue.hernandez` is always a handle; without the `@`, `josue.hernandez` is
 * a handle too, while `acme.com` is a domain and is checked as a link (and
 * refused, unless it is the network's own).
 */
const DOMAIN_ENDINGS = new Set([
  'com', 'net', 'org', 'co', 'io', 'ai', 'app', 'dev', 'me', 'tv', 'us', 'uk', 'es', 'mx', 'ar',
  'br', 'cl', 'pe', 'de', 'fr', 'it', 'info', 'biz', 'xyz', 'site', 'shop', 'store', 'online', 'be',
]);

function looksLikeDomain(value: string): boolean {
  const last = value.split('.').pop()?.toLowerCase() ?? '';
  return value.includes('.') && DOMAIN_ENDINGS.has(last);
}

/**
 * E.164 allows at most 15 digits, country code included. Eight is the
 * shortest real number WITH a country code.
 */
const WHATSAPP_DIGITS = /^\d{8,15}$/;

/**
 * A WhatsApp number as `wa.me` wants it: digits only, country code first.
 *
 * Only an INTERNATIONAL number is accepted, because `wa.me` reads the first
 * digits as the country code and a local number opens a chat with someone in
 * another country. That means a leading `+` (`+57 300 123 4567`), a leading
 * `00` (`0057 300 123 4567`, also `+0057 ...`), or a `wa.me` link, which is
 * international by definition. A number with neither is refused, and the
 * editor asks for the country code.
 */
export function whatsappDigits(input: string): string | null {
  const raw = input.trim();
  const link = /^(?:https?:\/\/)?(?:api\.)?(?:wa\.me|whatsapp\.com)\/(?:send\?phone=)?([^/?#]+)/i.exec(raw);
  let digits: string;
  if (link) {
    digits = (link[1] ?? '').replace(/\D/g, '');
  } else {
    const plus = raw.startsWith('+');
    digits = raw.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (!plus) return null;
  }
  return WHATSAPP_DIGITS.test(digits) ? digits : null;
}

/** The click-to-chat link for a stored number. No Meta API, no verification. */
export function whatsappHref(digits: string): string {
  return `https://wa.me/${digits}`;
}

/**
 * Turn what someone typed into a network field into the canonical value that
 * is stored, or null when it is not a link to that network.
 *
 * URL networks take a full URL, a URL without the scheme
 * (`instagram.com/yourbrand`, the placeholder the editor shows) or a bare
 * handle (`@yourbrand`, `your.brand`). The stored value is always an
 * `https://` URL on one of the network's own hosts, so the public page never
 * has to guess. WhatsApp stores digits only (see `whatsappDigits`).
 */
export function normalizeSocial(network: LinkPageSocial, input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (network === 'whatsapp') return whatsappDigits(value);

  if (value.startsWith('@')) {
    const handle = value.slice(1);
    return HANDLE_RULES[network].test(handle) ? HANDLE_URL[network](handle) : null;
  }
  if (!value.includes('/') && !looksLikeDomain(value)) {
    return HANDLE_RULES[network].test(value) ? HANDLE_URL[network](value) : null;
  }

  // Parsed by hand: this package compiles against ES2022 alone, with no `URL`.
  // The authority may hold no credentials and no port, only a host.
  const parts = /^(?:https?:\/\/)?([A-Za-z0-9.-]+)(\/[^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/i.exec(value);
  if (!parts) return null;
  const host = parts[1]!.toLowerCase();
  if (!SOCIAL_HOSTS[network].includes(host)) return null;
  const path = parts[2] ?? '';
  // A bare host is the network's home page, not the brand's profile.
  if (path === '' || path === '/') return null;
  return `https://${host}${path}${parts[3] ?? ''}`;
}

/** The link a stored social value opens. */
export function socialHref(network: LinkPageSocial, stored: string): string {
  return network === 'whatsapp' ? whatsappHref(stored) : stored;
}

/**
 * The refusal for a value that does not normalize. English, like every API
 * message; the editor shows its own localized copy from the catalog.
 */
export const LINK_PAGE_SOCIAL_MESSAGES: Record<LinkPageSocial, string> = {
  instagram: 'Enter an Instagram profile link or handle, like @yourbrand.',
  x: 'Enter an X profile link or handle, like @yourbrand.',
  youtube: 'Enter a YouTube channel link or handle, like @yourbrand.',
  tiktok: 'Enter a TikTok profile link or handle, like @yourbrand.',
  whatsapp: 'Enter the WhatsApp number with its country code, starting with +, like +57 300 123 4567.',
};

/** A social field: blank or null clears it, anything else must normalize. */
function socialField(network: LinkPageSocial) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .max(512)
      .transform((v, ctx) => {
        const n = normalizeSocial(network, v);
        if (n == null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: LINK_PAGE_SOCIAL_MESSAGES[network] });
          return z.NEVER;
        }
        return n;
      })
      .nullable()
      .optional(),
  );
}

export const linkPageSocialsSchema = z.object({
  instagram: socialField('instagram'),
  x: socialField('x'),
  youtube: socialField('youtube'),
  tiktok: socialField('tiktok'),
  whatsapp: socialField('whatsapp'),
});
export type LinkPageSocials = z.infer<typeof linkPageSocialsSchema>;

// --- Logo ----------------------------------------------------------------------

/**
 * The longest uploaded logo kept inline. The editor downscales an upload to
 * a small square before it gets here, which usually lands far below this.
 *
 * A page at every limit at once (this logo, 30 links of 2048 characters, a
 * full bio and five socials) is about 160 KB of JSON, more than the API's
 * default 100 KB body limit. So `PUT /v1/link-page` alone reads bodies up to
 * `LINK_PAGE_MAX_BODY_BYTES`.
 */
export const LINK_PAGE_LOGO_MAX_CHARS = 90_000;

/**
 * The request body ceiling for `PUT /v1/link-page`. Comfortably above the
 * largest page the schema accepts, even with every label in four-byte
 * characters, and still small.
 */
export const LINK_PAGE_MAX_BODY_BYTES = 256 * 1024;

/** An uploaded raster image, inlined. SVG is refused: it is a document, not a picture. */
const INLINE_LOGO = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export function isLinkPageLogo(value: string): boolean {
  const v = value.trim();
  if (INLINE_LOGO.test(v)) return v.length <= LINK_PAGE_LOGO_MAX_CHARS;
  return v.length <= 2048 && isSafeHttpUrl(v);
}

// --- Colours -------------------------------------------------------------------

/** A colour a page sets for itself: `#rgb` or `#rrggbb`, what a colour picker gives. */
const PAGE_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * The colours one page sets for itself, over the brand kit. Each field is
 * optional: ABSENT (or null) takes the brand kit's, the same rule as the logo,
 * so a page that never set one keeps following the kit when the kit changes.
 */
export const linkPageColorsSchema = z.object({
  primaryColor: z.string().regex(PAGE_COLOR, 'Colors must be hex, like #3DDC84.').nullable().optional(),
  background: z.string().regex(PAGE_COLOR, 'Colors must be hex, like #3DDC84.').nullable().optional(),
  foreground: z.string().regex(PAGE_COLOR, 'Colors must be hex, like #3DDC84.').nullable().optional(),
});
export type LinkPageColors = z.infer<typeof linkPageColorsSchema>;
export const LINK_PAGE_COLOR_FIELDS = ['primaryColor', 'background', 'foreground'] as const;

// --- Buttons -------------------------------------------------------------------

/** How many buttons a page holds. A page is a short list, not a sitemap. */
export const LINK_PAGE_MAX_ITEMS = 30;

export const linkPageItemSchema = z.discriminatedUnion('type', [
  /** One of the workspace's forms, by id: a slug rename never drops it. */
  z.object({ type: z.literal('form'), formId: z.string().trim().min(1).max(64) }),
  z.object({
    type: z.literal('link'),
    label: z.string().trim().min(1).max(80),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine(isSafeHttpUrl, { message: 'Link URL must use http(s).' }),
  }),
]);
export type LinkPageItem = z.infer<typeof linkPageItemSchema>;

export const linkPageSchema = z.object({
  version: z.literal(1),
  /** Off until someone turns it on: absent/false keeps the 404. */
  enabled: z.boolean().default(false),
  /** The heading. Blank or absent = the workspace name. */
  name: z.string().trim().max(80).nullable().optional(),
  bio: z.string().trim().max(280).nullable().optional(),
  /**
   * ABSENT = the brand kit's logo (the default), null = no logo at all, a
   * string = this one (an http(s) URL or an uploaded image, inlined).
   */
  logo: z
    .string()
    .refine(isLinkPageLogo, { message: 'Logo must be an http(s) URL or a PNG, JPEG, WebP or GIF image.' })
    .nullable()
    .optional(),
  /** Forms and links in ONE ordered list: the order here is the order on the page. */
  items: z.array(linkPageItemSchema).max(LINK_PAGE_MAX_ITEMS).optional(),
  socials: linkPageSocialsSchema.optional(),
  /** This page's own colours over the brand kit. Absent = the brand kit's. */
  colors: linkPageColorsSchema.optional(),
});
export type LinkPage = z.infer<typeof linkPageSchema>;
/** What a client sends; `linkPageSchema` normalizes it into `LinkPage`. */
export type LinkPageInput = z.input<typeof linkPageSchema>;

/**
 * A stored page as a body the schema accepts again. The one value that does
 * not round-trip by itself is WhatsApp: stored as bare digits, which on input
 * would read as a number without its country code, so it gets its `+` back.
 */
export function linkPageToInput(page: LinkPage): LinkPageInput {
  const whatsapp = page.socials?.whatsapp;
  return {
    ...page,
    ...(page.socials ? { socials: { ...page.socials, whatsapp: whatsapp ? `+${whatsapp}` : whatsapp } } : {}),
  };
}

/**
 * Read a STORED page blob back. Stored values are already canonical, except
 * that a stored WhatsApp number is bare digits, which the input rule refuses
 * (no country code prefix). It is read as the international number it is.
 * Null when the blob is missing or no longer parses.
 */
export function parseStoredLinkPage(raw: unknown): LinkPage | null {
  if (raw == null || typeof raw !== 'object') return null;
  const blob = raw as { socials?: { whatsapp?: unknown } };
  const whatsapp = blob.socials?.whatsapp;
  const input =
    typeof whatsapp === 'string' && /^\d+$/.test(whatsapp)
      ? { ...blob, socials: { ...blob.socials, whatsapp: `+${whatsapp}` } }
      : blob;
  const parsed = linkPageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

// --- What the page renders ---------------------------------------------------

/** One of the workspace's forms, as the page and the editor know it. */
export interface LinkPageFormRef {
  id: string;
  slug: string;
  /** The private dashboard label, the fallback when no public title is set. */
  name: string;
  /** The author's public title, when the form has one. */
  title: string | null;
}

export type PublicLinkPageButton =
  | { type: 'form'; label: string; slug: string }
  | { type: 'link'; label: string; url: string };

/** What `GET /v1/public/pages/:accountCode` returns. */
export interface PublicLinkPage {
  /** The workspace's canonical public code (a vanity or retired code resolves to it). */
  accountCode: string;
  name: string;
  bio: string | null;
  /** Null = draw the name's initials instead. */
  logo: string | null;
  buttons: PublicLinkPageButton[];
  socials: Array<{ network: LinkPageSocial; href: string }>;
  branding: FormBranding;
  /**
   * Which of the workspace's pages this is. Set by the API on the public read
   * (the editor's preview does not need them): the page's CURRENT slug, which
   * differs from a requested one when the request used a retired slug, and
   * whether it is the default page served at `/{accountCode}`.
   */
  pageSlug?: string;
  isDefault?: boolean;
}

/** The brand kit fields that style the page. The kit's logo is handled apart. */
const KIT_STYLE_FIELDS = [
  'primaryColor',
  'background',
  'foreground',
  'fontFamily',
  'customFont',
  'radius',
  'buttonStyle',
] as const;

/**
 * The page's design: the workspace brand kit, read LIVE (not snapshotted the
 * way forms are), on top of the dForms colours a new form is born with, with
 * the page's own colours (if it set any) on top of both. A workspace with no
 * kit and a page with no colours get the same look a brand new form gets.
 */
export function linkPageBranding(
  kit: BrandKit | null | undefined,
  colors?: LinkPageColors | null,
): FormBranding {
  const own: Record<string, unknown> = {};
  for (const field of KIT_STYLE_FIELDS) {
    const value = kit?.[field];
    if (value != null) own[field] = value;
  }
  // The page's own colours win over the kit's, field by field.
  for (const field of LINK_PAGE_COLOR_FIELDS) {
    const value = colors?.[field];
    if (value) own[field] = value;
  }
  const config = withNewFormBranding({ version: 1, steps: [], branding: own });
  return (config.branding ?? {}) as FormBranding;
}

/**
 * Everything the page shows, decided in one place.
 *
 * - A form button whose form no longer exists (deleted, or an id from another
 *   workspace) is dropped silently: never a broken button.
 * - The form's public title wins over its dashboard name.
 * - Only the socials that hold a value render, in `LINK_PAGE_SOCIALS` order.
 * - No name falls back to the workspace's; an absent logo to the brand kit's.
 */
export function resolveLinkPage(
  page: LinkPage,
  ctx: {
    accountCode: string;
    accountName: string;
    forms: LinkPageFormRef[];
    brandKit: BrandKit | null | undefined;
  },
): PublicLinkPage {
  const byId = new Map(ctx.forms.map((f) => [f.id, f]));
  const buttons: PublicLinkPageButton[] = [];
  for (const item of page.items ?? []) {
    if (item.type === 'link') {
      buttons.push({ type: 'link', label: item.label, url: item.url });
      continue;
    }
    const form = byId.get(item.formId);
    if (!form) continue;
    buttons.push({ type: 'form', label: form.title?.trim() || form.name, slug: form.slug });
  }

  const socials: PublicLinkPage['socials'] = [];
  for (const network of LINK_PAGE_SOCIALS) {
    const value = page.socials?.[network];
    if (value) socials.push({ network, href: socialHref(network, value) });
  }

  const logo = page.logo === undefined ? (ctx.brandKit?.logo ?? null) : page.logo;

  return {
    accountCode: ctx.accountCode,
    name: page.name?.trim() || ctx.accountName,
    bio: page.bio?.trim() || null,
    logo: logo && logo.trim() ? logo : null,
    buttons,
    socials,
    branding: linkPageBranding(ctx.brandKit, page.colors),
  };
}

// --- Analytics -----------------------------------------------------------------

/** What a click on the page was: one of the three kinds of thing it links to. */
export const LINK_PAGE_LINK_TYPES = ['form', 'link', 'social'] as const;
export type LinkPageLinkType = (typeof LINK_PAGE_LINK_TYPES)[number];

/**
 * Body of `POST /v1/public/pages/:accountCode/events`: a page view, or a click
 * on one of its buttons or icons. Nothing about the visitor travels here.
 */
export const linkPageEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('view') }),
  z.object({
    type: z.literal('click'),
    linkType: z.enum(LINK_PAGE_LINK_TYPES),
    /** 0-based position of the button in the column, or of the icon in its row. */
    position: z.number().int().min(0).max(100).optional(),
    /** The network, on a social click. */
    network: z.enum(LINK_PAGE_SOCIALS).optional(),
    /** The form's slug, on a form click. */
    slug: z.string().trim().min(1).max(120).optional(),
  }),
]);
export type LinkPageEvent = z.infer<typeof linkPageEventSchema>;


// --- Several pages per workspace ---------------------------------------------

/** How many pages one workspace keeps. A page per fair, per channel or per country. */
export const LINK_PAGE_MAX_PAGES = 20;

/** The slug the existing page got when workspaces went from one page to several (0027). */
export const LINK_PAGE_DEFAULT_SLUG = 'main';

/** The fixed segment extra pages live under: `/{accountCode}/p/{slug}`, like `/f/` for forms. */
export const LINK_PAGE_SEGMENT = 'p';

/** Internal label of a page ("Expo 2026"). Blank is allowed: the admin shows a default. */
export const linkPageNameSchema = z.string().trim().max(80);

export const LINK_PAGE_SLUG_MESSAGES = {
  invalid: 'Use 3 to 30 lowercase letters, numbers or single hyphens, starting and ending with a letter or number.',
  reserved: 'That address is reserved. Pick another one.',
} as const;

/**
 * A page's slug: the same shape and blocklist as a workspace's vanity code
 * (`validateVanitySlug`), lowercased on the way in.
 */
export const linkPageSlugSchema = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .superRefine((v, ctx) => {
    const issue = validateVanitySlug(v);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: LINK_PAGE_SLUG_MESSAGES[issue] });
  });

/**
 * A slug made from a page's name: lowercase ASCII letters and digits joined by
 * single hyphens, cut to fit. Null when the name gives nothing usable (too
 * short once cleaned, or a reserved word); the caller picks a fallback.
 */
export function slugFromName(name: string): string | null {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return validateVanitySlug(base) ? null : base;
}

/**
 * The first free slug for `base`: `base` itself, else `base-2`, `base-3`...
 * kept within the 30 characters a slug allows. `taken` holds every slug the
 * workspace uses (its pages' slugs; retired ones may be reclaimed).
 */
export function uniqueLinkPageSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base) && !validateVanitySlug(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 30 - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.has(candidate) && !validateVanitySlug(candidate)) return candidate;
  }
  return `page-${Date.now().toString(36)}`;
}

/** One page in the workspace's list. */
export interface LinkPageSummary {
  id: string;
  slug: string;
  /** The internal label; blank when nobody named it (the admin shows a default). */
  name: string;
  isDefault: boolean;
  /** Saved with `enabled: true`: its address serves it. */
  live: boolean;
  /** How many buttons the page holds (forms and links). */
  buttons: number;
  createdAt: number;
  updatedAt: number;
}

/** The public path of a page: the default at `/{code}`, the others under `/p/`. */
export function linkPagePath(accountCode: string, page: { slug: string; isDefault: boolean }): string {
  const code = encodeURIComponent(accountCode);
  return page.isDefault ? `/${code}` : `/${code}/${LINK_PAGE_SEGMENT}/${encodeURIComponent(page.slug)}`;
}

/**
 * Body of `POST /v1/link-pages`. The slug is optional: absent, one is made
 * from the name. The page content is optional too: absent, the new page is
 * empty and unpublished.
 */
export const linkPageCreateSchema = z.object({
  name: linkPageNameSchema.optional(),
  slug: linkPageSlugSchema.optional(),
  page: linkPageSchema.optional(),
});
export type LinkPageCreateInput = z.input<typeof linkPageCreateSchema>;

/**
 * Body of `PUT /v1/link-pages/:id`: every field optional, an absent one stays
 * as it is. `page` replaces the whole content when present (like
 * `PUT /v1/link-page`). `isDefault: true` makes this page the default; there
 * is no `false`, since a workspace always has one default: make another page
 * the default instead.
 */
export const linkPageUpdateSchema = z.object({
  name: linkPageNameSchema.optional(),
  slug: linkPageSlugSchema.optional(),
  isDefault: z.literal(true).optional(),
  page: linkPageSchema.optional(),
});
export type LinkPageUpdateInput = z.input<typeof linkPageUpdateSchema>;

/** Body of `POST /v1/link-pages/:id/duplicate`: both optional. */
export const linkPageDuplicateSchema = z.object({
  name: linkPageNameSchema.optional(),
  slug: linkPageSlugSchema.optional(),
});
export type LinkPageDuplicateInput = z.input<typeof linkPageDuplicateSchema>;
