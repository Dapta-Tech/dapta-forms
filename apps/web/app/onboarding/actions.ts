'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { adminApi, type OnboardingComplete, type OnboardingProgress } from '@/lib/admin-api';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/locale';

/**
 * Persist one screen's worth of answers.
 *
 * Never throws into the wizard. This runs behind a screen the person cannot
 * skip, so a failed save must not become a dead end — the wizard advances
 * regardless and the API simply never hears about that step. Losing one
 * breadcrumb of telemetry is strictly better than trapping someone on question
 * two because the network blipped.
 *
 * `unstable_rethrow` first, always. `adminApi` signs a dead session out by
 * THROWING Next's redirect — the framework's control flow is an exception, not
 * a return — and the same is true of `notFound()`, dynamic-usage bailouts and
 * postpone errors. A catch that does not re-throw those swallows the sign-out
 * and leaves the person clicking through a wizard nobody is authenticated for.
 */
export async function saveOnboardingStepAction(patch: OnboardingProgress): Promise<void> {
  try {
    await adminApi.saveOnboarding(patch);
  } catch (e) {
    unstable_rethrow(e);
    /* progress is an observer of the wizard, never a participant */
  }
}

/**
 * What the wizard gets back when the completion did NOT go through.
 *
 * There is no success variant, and that is not an oversight: every path where
 * the API answered ends in a `redirect`, which throws. The only way this
 * function returns a value is a failure the wizard has to show.
 */
export interface CompleteOnboardingFailure {
  ok: false;
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
 *
 * ONLY an answering API redirects. A thrown failure returns `{ ok: false }` and
 * the wizard shows it, because `/admin` is not a reachable fallback while the
 * claim is unwritten: the layout's first-run gate reads the same NULL column
 * this request failed to set, so it would bounce them straight back here — into
 * a wizard that remounts at question one with none of their answers, since the
 * component's state died with the navigation. A redirect loop that silently
 * erases the work is worse than an error with a retry button.
 *
 * `/admin` IS the right target when the API answers without a form id, which is
 * a different case: the claim is written by then (by this caller or by the one
 * that beat it), so the gate lets them through to an empty dashboard where "New
 * form" is the obvious next click.
 */
export async function completeOnboardingAction(
  input: OnboardingComplete,
): Promise<CompleteOnboardingFailure> {
  let target: string;
  try {
    const result = await adminApi.completeOnboarding(input);
    target = result.formId ? `/admin/forms/${result.formId}/edit?tour=1` : '/admin';
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }

  // The wizard resolved its language from `Accept-Language`, because nobody
  // arriving at it has ever seen the switcher — but everything past this
  // redirect reads the COOKIE and answers English without one. Persisting it
  // here is what stops a Spanish signup finishing the wizard in Spanish and
  // landing in an English builder, with the three coach marks in English on top.
  if (input.locale === 'es' || input.locale === 'en') {
    (await cookies()).set(LOCALE_COOKIE, input.locale, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
    });
  }

  revalidatePath('/admin', 'layout');
  // OUTSIDE the try: `redirect` throws, so calling it inside would hand the
  // catch above its own control-flow exception. `unstable_rethrow` would let it
  // back out correctly, but keeping it out here says the intent plainly.
  redirect(target);
}
