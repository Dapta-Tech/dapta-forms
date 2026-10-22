import { isConnection, type McpCaller, type McpCredential } from './backend';
import { ToolFailure } from './support';

/**
 * Which workspace a tool call acts in.
 *
 * An API key has one workspace and keeps it: a call may leave `workspace_id`
 * out or name the key's own, and any other is refused, so a key never leaves
 * its workspace. An MCP connection names a person who may hold members in
 * several workspaces: a call names one with `workspace_id`, and with exactly
 * one workspace it may leave it out. The choice is among the person's active
 * members as the host read them on this request, so for anyone but staff an
 * id of any other workspace (one they never joined, one they were removed
 * from, one an earlier staff access grant reached) is reported exactly like
 * an id that does not exist.
 *
 * Staff of the deployment (`McpConnection.staff`, judged again on every
 * request) may also name any other live workspace, which they then act in
 * through a staff access grant. Staff always name the workspace, even with
 * one of their own, and the agent confirms it with the user first: a staff
 * call can reach any customer's forms.
 */

/** A staff search needs at least this many letters or digits. */
export const STAFF_SEARCH_MIN_CHARS = 3;
/** A staff search never returns more than this many workspaces. */
export const STAFF_SEARCH_MAX_RESULTS = 20;

/** Letters that do not decompose under NFD but read as one plain letter. */
const FOLD_EXTRA: Readonly<Record<string, string>> = {
  ø: 'o', Ø: 'o', đ: 'd', Đ: 'd', ð: 'd', Ð: 'd', ł: 'l', Ł: 'l', ħ: 'h', Ħ: 'h', ı: 'i', ŧ: 't', Ŧ: 't', ς: 'σ',
};
/** Latin (with Extended-A/B and Additional), Greek (and Extended) and Cyrillic. */
const FOLD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00c0, 0x024f],
  [0x0370, 0x03ff],
  [0x0400, 0x052f],
  [0x1e00, 0x1fff],
];
const COMBINING_MARKS = /[\u0300-\u036f]/g;

function buildFoldTable(): { from: string; to: string } {
  let from = '';
  let to = '';
  for (const [lo, hi] of FOLD_RANGES) {
    for (let cp = lo; cp <= hi; cp += 1) {
      const ch = String.fromCharCode(cp);
      if (!/\p{L}/u.test(ch)) continue;
      const base = (FOLD_EXTRA[ch] ?? ch.normalize('NFD').replace(COMBINING_MARKS, '')).toLowerCase();
      if (base.length === 1 && base !== ch) {
        from += ch;
        to += base;
      }
    }
  }
  return { from, to };
}

const FOLD_TABLE = buildFoldTable();
/**
 * The fold table, one character of `SEARCH_FOLD_FROM` to the character at the
 * same place in `SEARCH_FOLD_TO`: every accented Latin letter to its plain
 * lowercase letter (`É` and `é` to `e`, `Ø` to `o`), and every upper-case
 * Greek and Cyrillic letter to its lower case. A host's SQL applies it with
 * `translate(lower(name), FROM, TO)`, so a search folds the same way in a
 * database whose collation lowercases ASCII only (collation `C`) and needs no
 * extension (`unaccent`).
 */
export const SEARCH_FOLD_FROM = FOLD_TABLE.from;
export const SEARCH_FOLD_TO = FOLD_TABLE.to;
const FOLD = new Map([...SEARCH_FOLD_FROM].map((ch, i) => [ch, SEARCH_FOLD_TO[i]!] as const));

/**
 * Text folded for a search: lowercased, the fold table applied, and any
 * combining mark left (a decomposed accent) dropped. So "José", "JOSÉ" and
 * "Jose" plus a combining accent all fold to "jose". Idempotent.
 */
export function foldSearchText(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) out += FOLD.get(ch) ?? ch;
  return out.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC');
}

/**
 * A workspace search as it is compared: folded (`foldSearchText`: lowercased,
 * accents dropped), then every ASCII character that is not a letter or a
 * digit dropped (spaces, punctuation, symbols), so "Call Center" finds
 * "callcenter's workspace", "jose" finds "José", and a search can never carry
 * a LIKE wildcard. A host applies the same rule to the names in SQL with the
 * fold table (`SEARCH_FOLD_FROM`, `SEARCH_FOLD_TO`), whatever its locale.
 */
export function normalizeWorkspaceSearch(text: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return foldSearchText(text ?? '').replace(/[\x00-\x2f\x3a-\x60\x7b-\x7f]/g, '');
}

/**
 * What staff do to pick a workspace: search, confirm with the user, then name
 * it. The message it follows already says the caller is staff, so it does not
 * say it again.
 */
export const STAFF_WORKSPACE_HINT =
  'Find the workspace the user means with list_my_workspaces(search=<part of its name>), confirm it with the user by name and account (even when only one matches), then repeat this call with its workspace_id.';

export const LIST_WORKSPACES_HINT =
  'Call list_my_workspaces, ask the user which workspace by its name (never pick one yourself), then repeat this call with that workspace_id.';

/**
 * What a person with no dForms workspace (or no dForms account) yet does
 * about it, as one clause: open dForms once, then `then`. `appUrl` is the
 * address they open, when the host knows it. The one wording every surface
 * uses (the tools, whoami and the host's refusal at the door).
 */
export function openDFormsOnce(appUrl?: string, then = 'try again'): string {
  return `open dForms once with this account${appUrl ? ` (${appUrl})` : ''}, then ${then}.`;
}

/** The message for a person with no workspace yet. `appUrl` is the dForms address they open, when the host knows it. */
export function noWorkspace(appUrl?: string): ToolFailure {
  return new ToolFailure('NO_WORKSPACE', 'You are not an active member of any dForms workspace yet.', `Ask the user to ${openDFormsOnce(appUrl)}`);
}

/** A workspace id as compared and echoed: ids are UUIDs, so case and stray spaces carry no meaning. */
export function normalizeWorkspaceId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * The caller a tool call acts as, or a `ToolFailure` the model can act on.
 * `required` false (whoami): null instead of a failure when the call does not
 * name a workspace and there is not exactly one to use (staff: when it names
 * none).
 */
export async function resolveWorkspace(
  credential: McpCredential,
  workspaceId: string | undefined,
  opts: { required: boolean; appUrl?: string },
): Promise<McpCaller | null> {
  const wanted = workspaceId === undefined ? undefined : normalizeWorkspaceId(workspaceId);
  if (!isConnection(credential)) {
    if (wanted !== undefined && wanted !== normalizeWorkspaceId(credential.accountId)) {
      throw new ToolFailure(
        'WORKSPACE_MISMATCH',
        'This API key belongs to one workspace and cannot act in another.',
        'Leave workspace_id out (the key always uses its own workspace), or ask the user for an API key of the other workspace.',
      );
    }
    return credential;
  }
  const { workspaces, staff } = credential;
  if (wanted !== undefined) {
    const named = workspaces.find((w) => normalizeWorkspaceId(w.accountId) === wanted);
    if (named) return named;
    if (staff) {
      const entered = await staff.enter(wanted);
      if (entered) return entered;
      throw new ToolFailure('NOT_FOUND', 'No live workspace has this id. As staff of this deployment you can act in any live one.', STAFF_WORKSPACE_HINT);
    }
    throw new ToolFailure(
      'NOT_FOUND',
      'No workspace of yours has this id.',
      'Use an id from list_my_workspaces: you may have been removed from that workspace.',
    );
  }
  if (staff) {
    if (!opts.required) return null;
    throw new ToolFailure(
      'WORKSPACE_REQUIRED',
      'You are staff of this deployment, so every call must name its workspace in workspace_id, even with one workspace of your own.',
      STAFF_WORKSPACE_HINT,
    );
  }
  if (workspaces.length === 1) return workspaces[0]!;
  if (!opts.required) return null;
  if (workspaces.length === 0) throw noWorkspace(opts.appUrl);
  throw new ToolFailure(
    'WORKSPACE_REQUIRED',
    `You are a member of ${workspaces.length} dForms workspaces, so this call must name one in workspace_id.`,
    LIST_WORKSPACES_HINT,
  );
}

/**
 * The rate-limit bucket of one request at the door. An API key: the key. An
 * MCP connection: the member of the workspace the call acts in (the one a
 * `tools/call` names, or the only one), so one person's clients share a
 * budget per workspace; a request that acts in no workspace (initialize,
 * tools/list, a call that names none) counts against the person.
 */
export function bucketOf(credential: McpCredential, body: unknown): string {
  if (!isConnection(credential)) return credential.credentialId;
  const named = workspaceIdOf(body);
  const caller =
    named !== undefined
      ? credential.workspaces.find((w) => w.accountId === named)
      : credential.workspaces.length === 1
        ? credential.workspaces[0]
        : undefined;
  return caller ? caller.credentialId : `person:${credential.personId}`;
}

/** The `workspace_id` argument of a `tools/call` body, when it has a string one. */
function workspaceIdOf(body: unknown): string | undefined {
  const rpc = body as { method?: unknown; params?: { arguments?: { workspace_id?: unknown } } } | undefined;
  if (rpc?.method !== 'tools/call') return undefined;
  const id = rpc.params?.arguments?.workspace_id;
  return typeof id === 'string' ? id : undefined;
}
