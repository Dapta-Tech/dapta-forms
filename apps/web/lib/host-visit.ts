import { parseSubmissionVisit, type SubmissionVisit } from '@quill/types';
import { isEmbedded } from './top-navigate';

/**
 * The page a public form is answered on (#199), sent with each partial and
 * complete submit as `visit`.
 *
 * EMBEDDED, the frame knows almost nothing about where it sits. The landing's
 * HubSpot cookie (`hubspotutk`) belongs to another origin, its URL arrives
 * through `document.referrer` as a bare origin at best, and its title and
 * campaign parameters not at all. The host page's own `public/embed.js` can
 * read all of it, so the frame asks:
 *
 *   dapta-forms:context-request {id, v: 1}  frame to `window.parent`, to any
 *     origin. It carries only a nonce: the embedding site is by definition
 *     unknown to us, and there is nothing in it to protect.
 *   dapta-forms:context {id, v: 1, pageUri, pageName, pageId?, hutk?,
 *     hsPortalId?}  embed.js to this frame only, targeted at the origin of the
 *     frame's `src`, so a frame that navigated elsewhere never receives it.
 *     `{id, v: 1, off: true}` instead when the page switched it off with
 *     `data-dapta-forms-context="off"`: then nothing about the page is sent.
 *
 * A reply is accepted only from `window.parent` and only for a nonce this
 * frame issued, so a frame beside ours cannot feed it a page.
 *
 * Timing. At mount the frame asks, and again at 1 s and 3 s while nothing has
 * answered (the script loads `async`, and may not be listening yet). Before
 * each submit it asks AGAIN, for the cookie as it is now (consent may have
 * come mid-form), and waits at most 500 ms if the host has answered before,
 * 150 ms if it never has (a bare iframe, or an old cached script: the same
 * price as the redirect acknowledgement). On timeout it sends what the host
 * said last, else the referrer as the page. An answer that arrives after its
 * submit stopped waiting still counts: it is kept for the next submit, which
 * then gets the longer wait. Nothing here ever fails a submit.
 *
 * On a DIRECT LINK the page is the form itself: its URL keeps only `utm_*`
 * (every other parameter is prefill, which is to say answers), and the form's
 * own `hubspotutk` goes along only when the FORM loads its own HubSpot tracking
 * code. That cookie is the visitor's identity on this domain, not on the
 * customer's landing: HubSpot joins the two only with cross-domain linking.
 *
 * What is sent passes through `parseSubmissionVisit`, the same rules the API
 * applies again on arrival.
 */

/** The request the frame posts to its parent. */
export const CONTEXT_REQUEST = 'dapta-forms:context-request';
/** The answer `public/embed.js` posts back. */
export const CONTEXT_REPLY = 'dapta-forms:context';
export const CONTEXT_VERSION = 1;

/** Per submit, once the host has answered at least once. */
export const HOST_WAIT_MS = 500;
/** Per submit, while nothing has ever answered: a bare iframe pays this and no more. */
export const SILENT_WAIT_MS = 150;
/** Mount-time retries, for a host script still loading. */
export const MOUNT_RETRY_MS = [1_000, 3_000] as const;

const HUBSPOT_COOKIE = 'hubspotutk';
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** What one submit sends: the visit, and the landing's campaign for `data.utm`. */
export interface ResolvedVisit {
  visit: SubmissionVisit;
  /** The landing's `utm_*` (embedded, when the host answered); empty otherwise. */
  hostUtm: Record<string, string>;
}

export interface HostVisitOptions {
  /** The FORM loads its own HubSpot tracking code (not the deployment's default). */
  hubspotTracking: boolean;
  /** The form's public title: the page's name on a direct link, where the page IS the form. */
  formTitle: string;
}

export interface HostVisit {
  /** Mount: ask the host now and on the retry schedule. Returns the cleanup. */
  start(): () => void;
  /** Before one submit. Never rejects, never waits past `HOST_WAIT_MS`. */
  resolve(): Promise<ResolvedVisit | undefined>;
}

/** The host's answer, as far as it was read; every value is checked by the parse. */
interface HostReply {
  off: boolean;
  fields: Record<string, unknown>;
}

const INERT: HostVisit = { start: () => () => {}, resolve: async () => undefined };

export function createHostVisit(opts: HostVisitOptions): HostVisit {
  if (typeof window === 'undefined') return INERT;
  if (!isEmbedded()) return { start: () => () => {}, resolve: async () => directVisit(opts) };

  // What the host said last. Set means the host speaks, which earns a submit
  // the longer wait.
  let last: HostReply | null = null;
  // Every request this frame made. A reply to any of them is accepted, even
  // after its submit stopped waiting: a busy host page answers late, and that
  // answer is still the page as it is.
  const issued = new Set<string>();
  const waiting = new Map<string, (reply: HostReply) => void>();
  let listening = false;

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || data.type !== CONTEXT_REPLY || data.v !== CONTEXT_VERSION) return;
    const id = data.id;
    if (typeof id !== 'string' || !issued.has(id)) return;
    const reply = readReply(data);
    last = reply;
    const wake = waiting.get(id);
    waiting.delete(id);
    wake?.(reply);
  };
  const listen = () => {
    if (listening) return;
    window.addEventListener('message', onMessage);
    listening = true;
  };
  const ask = (): string => {
    const id = nonce();
    issued.add(id);
    try {
      window.parent.postMessage({ type: CONTEXT_REQUEST, id, v: CONTEXT_VERSION }, '*');
    } catch {
      /* a host that refuses messages never answers; the wait covers it */
    }
    return id;
  };

  return {
    start() {
      listen();
      const mountAsk = () => {
        if (last) return; // it answered: nothing left to wait for
        ask();
      };
      mountAsk();
      const timers = MOUNT_RETRY_MS.map((ms) => setTimeout(mountAsk, ms));
      return () => {
        for (const t of timers) clearTimeout(t);
        window.removeEventListener('message', onMessage);
        listening = false;
      };
    },
    resolve() {
      if (last?.off) return Promise.resolve(undefined);
      listen();
      const id = ask();
      return new Promise<ResolvedVisit | undefined>((resolve) => {
        const timer = setTimeout(
          () => {
            waiting.delete(id);
            resolve(embeddedVisit(last));
          },
          last ? HOST_WAIT_MS : SILENT_WAIT_MS,
        );
        waiting.set(id, (reply) => {
          clearTimeout(timer);
          resolve(embeddedVisit(reply));
        });
      });
    },
  };
}

function readReply(data: Record<string, unknown>): HostReply {
  if (data.off === true) return { off: true, fields: {} };
  const { pageUri, pageName, pageId, hutk, hsPortalId } = data;
  return { off: false, fields: { pageUri, pageName, pageId, hutk, hsPortalId } };
}

/**
 * The visit from the host's answer, else from the referrer; none once switched
 * off. The page keeps the host's own title or none: the form's title is not the
 * landing's, and the dashboard names an untitled page by its host instead.
 */
function embeddedVisit(reply: HostReply | null): ResolvedVisit | undefined {
  if (reply?.off) return undefined;
  if (!reply) {
    // Nothing answered: the referrer, usually just the landing's origin, is the page.
    const referrer = typeof document === 'undefined' ? '' : document.referrer;
    return { visit: sanitized({ pageUri: referrer || undefined, embedded: true }), hostUtm: {} };
  }
  const visit = sanitized({ ...reply.fields, embedded: true });
  return { visit, hostUtm: hostUtm(visit.pageUri) };
}

/** The form's own page, prefill stripped, with its own cookie when the form tracks. */
function directVisit(opts: HostVisitOptions): ResolvedVisit {
  let pageUri: string | undefined;
  try {
    const url = new URL(window.location.href);
    const utm = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase().startsWith('utm_')) utm.append(key, value);
    }
    const query = utm.toString();
    pageUri = `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    pageUri = undefined;
  }
  const hutk = opts.hubspotTracking ? ownHubspotCookie() : undefined;
  return { visit: sanitized({ pageUri, pageName: opts.formTitle, hutk, embedded: false }), hostUtm: {} };
}

/** Through the same rules the API applies; at least the fact of where it was answered. */
function sanitized(raw: Record<string, unknown>): SubmissionVisit {
  return parseSubmissionVisit(raw) ?? { embedded: raw.embedded === true };
}

/**
 * This page's HubSpot cookie, unless the visitor opted out of HubSpot tracking.
 * Read only, never written.
 */
function ownHubspotCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const jar = new Map<string, string>();
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    const name = (eq < 0 ? part : part.slice(0, eq)).trim();
    if (name) jar.set(name, eq < 0 ? '' : part.slice(eq + 1).trim());
  }
  if (jar.get('__hs_opt_out') === 'yes' || jar.has('__hs_do_not_track')) return undefined;
  return jar.get(HUBSPOT_COOKIE) || undefined;
}

/**
 * The `utm_*` parameters of a page URL: the landing's campaign when the form is
 * embedded, merged into `data.utm` all or nothing (see `mergeHostUtm`).
 * Controls are removed (Postgres cannot store `\u0000`), and an empty value is
 * no parameter.
 */
export function hostUtm(pageUri: string | undefined): Record<string, string> {
  if (!pageUri) return {};
  let url: URL;
  try {
    url = new URL(pageUri);
  } catch {
    return {};
  }
  const utm: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    const clean = value.replace(CONTROL, '').trim();
    if (key.toLowerCase().startsWith('utm_') && clean) utm[key] = clean;
  }
  return utm;
}

/** A request id no one else can guess. `crypto.randomUUID` needs a secure context; this does not. */
function nonce(): string {
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
