/**
 * The landing's HubSpot visitor cookie (`hutk`) is an online identifier. It may
 * go to HubSpot and to a customer's webhook, and nowhere else: never a log,
 * never the dashboard.
 *
 * Every adapter passes what it keeps for people to read (a delivery transcript,
 * a receiver's answer, a logged error) through `scrubHutk` first, because the
 * cookie comes back in places nobody put it: a receiver that answers with the
 * request it got (request bins and workflow tools do), or HubSpot quoting the
 * body it refused. Scrub BEFORE anything is cut to length, or the cut can keep
 * a piece of it.
 */

/** What is shown in place of the cookie. */
export const HIDDEN_HUTK = '[hidden]';

/** A HubSpot visitor cookie: 32 hex characters, the only shape the API ever stores. */
const HUTK = /^[0-9a-f]{32}$/i;

/** `text` with every occurrence of the cookie replaced, whatever its case. */
export function scrubHutk(text: string, hutk: string | undefined): string {
  // Checked before it becomes a pattern: 32 hex characters carry no regex syntax.
  if (!hutk || !HUTK.test(hutk)) return text;
  return text.replace(new RegExp(hutk, 'gi'), HIDDEN_HUTK);
}
