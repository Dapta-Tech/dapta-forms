'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { adminApi, type OnboardingProgress } from '@/lib/admin-api';

/**
 * Is this the control-flow exception `redirect()` throws?
 *
 * `adminApi` redirects to /login from inside the request helper when the API
 * answers 401, and it does that by THROWING — Next's redirect is an exception,
 * not a return. A bare `catch {}` around an api call therefore swallows the
 * sign-out and the person silently continues in a dead session. Every catch in
 * this file has to let it through.
 *
 * Identified by the `digest` string rather than an instanceof, because the error
 * class lives behind a `next/dist/...` internal path that is not part of the
 * public API and moves between releases.
 */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

/**
 * Persist one screen's worth of answers.
 *
 * Never throws into the wizard. This runs behind a screen the person cannot
 * skip, so a failed save must not become a dead end — the wizard advances
 * regardless and the API simply never hears about that step. Losing one
 * breadcrumb of telemetry is strictly better than trapping someone on question
 * two because the network blipped.
 */
export async function saveOnboardingStepAction(patch: OnboardingProgress): Promise<void> {
  try {
    await adminApi.saveOnboarding(patch);
  } catch (e) {
    // An expired session must still sign them out — see `isRedirect`.
    if (isRedirect(e)) throw e;
    /* progress is an observer of the wizard, never a participant */
  }
}

/**
 * Finish the wizard and go to the new form.
 *
 * The API is the one that decides what gets created — it resolves the template
 * id against a server-side registry — so this action forwards a name, never a
 * config.
 *
 * `?tour=1` is what turns the builder's coach marks on. It rides the redirect
 * rather than a cookie so a person who bookmarks or reloads the editor later
 * does not get the tour a second time.
 *
 * When the claim was already spent (a double-submit, a second tab) the API hands
 * back the WINNER's form id and this still lands there — both tabs end up on the
 * same form instead of one of them on an error page.
 */
export async function completeOnboardingAction(template: string): Promise<void> {
  let target = '/admin';
  try {
    const result = await adminApi.completeOnboarding({ template });
    if (result.formId) target = `/admin/forms/${result.formId}/edit?tour=1`;
  } catch (e) {
    if (isRedirect(e)) throw e;
    // The answers are already stored and the completion may well have been
    // claimed. Sending them back through the wizard would ask them to redo work
    // that is done; the dashboard is the honest fallback.
  }
  revalidatePath('/admin', 'layout');
  // OUTSIDE the try: `redirect` throws, so calling it inside would hand the
  // catch above its own control-flow exception and this action would fall
  // through to no navigation at all.
  redirect(target);
}
