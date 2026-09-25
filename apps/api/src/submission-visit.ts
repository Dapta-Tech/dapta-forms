import { formDestinationSchema, type FormDestination, type SubmissionVisit } from '@quill/types';
import { mirrorGuidFor } from './hubspot-portal';

/**
 * Does this destination use the landing's HubSpot cookie (`hutk`)? A webhook
 * does (its envelope carries the visit), and a HubSpot destination does only
 * when it records the form submission, the one HubSpot call that accepts it.
 */
export function destinationUsesHutk(destination: FormDestination): boolean {
  if (destination.enabled === false) return false;
  if (destination.type === 'webhook') return true;
  return mirrorGuidFor(destination.settings) != null;
}

/** The visit without its cookie. */
export function withoutHutk(visit: SubmissionVisit): SubmissionVisit {
  const { hutk: _dropped, ...rest } = visit;
  return rest;
}

/**
 * Does anything on this form use the landing's HubSpot cookie (`hutk`)?
 *
 * Two things do: a HubSpot destination that records the form submission (the
 * only HubSpot call that accepts the cookie, see `mirrorGuidFor`), and an
 * enabled webhook, whose envelope carries the visit for receivers that sync
 * HubSpot through their own flows. Anything else would only be holding an
 * online identifier nobody reads.
 */
export function hutkConsumed(config: unknown): boolean {
  const destinations = (config as { destinations?: unknown } | null)?.destinations;
  if (!Array.isArray(destinations)) return false;
  return destinations.some((raw) => {
    const parsed = formDestinationSchema.safeParse(raw);
    return parsed.success && destinationUsesHutk(parsed.data);
  });
}

/** The visit as it is stored: the cookie only on a form that will use it. */
export function storedVisit(visit: SubmissionVisit | undefined, config: unknown): SubmissionVisit | undefined {
  if (!visit?.hutk || hutkConsumed(config)) return visit;
  return withoutHutk(visit);
}

/** Was a cookie reported that the contract then refused? Never says what it was. */
export function hutkRefused(raw: unknown, parsed: SubmissionVisit | undefined): boolean {
  const reported = (raw as { visit?: { hutk?: unknown } } | null)?.visit;
  if (reported == null || typeof reported !== 'object') return false;
  const hutk = reported.hutk;
  return hutk != null && hutk !== '' && !parsed?.hutk;
}
