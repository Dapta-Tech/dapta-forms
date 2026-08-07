/**
 * FORM TEMPLATES — the starting points the onboarding wizard offers for a
 * workspace's first form.
 *
 * One entry per `FormTemplateId` (@quill/types), and the union is exhaustive by
 * construction: `Record<FormTemplateId, …>` makes adding an id without a
 * template a compile error rather than a runtime 404 on the one screen a new
 * user cannot skip.
 *
 * `customer-feedback` IS the old auto-seeded demo form, reused rather than
 * rewritten. Before the wizard it was pushed on everyone; now it is one of four
 * things a person can choose, which is the same config doing an honester job.
 *
 * `blank` carries NO config on purpose — `config: null` means "let the API apply
 * whatever a brand-new form gets", so the empty starting point can never drift
 * away from what the dashboard's own "new form" button produces.
 *
 * The config never crosses the wire: the web posts a template ID and the API
 * resolves it here, so a client cannot hand us an arbitrary form config through
 * the onboarding path.
 */
import type { FormConfig, FormTemplateId } from '@quill/types';
import { DEMO_FORM_CONFIG, DEMO_FORM_NAME } from '../demo-form';
import { LEAD_QUALIFIER_CONFIG } from './lead-qualifier';
import { EVENT_REGISTRATION_CONFIG } from './event-registration';
import { APPLICATION_CONFIG } from './application';

export { LEAD_QUALIFIER_CONFIG } from './lead-qualifier';
export { EVENT_REGISTRATION_CONFIG } from './event-registration';
export { APPLICATION_CONFIG } from './application';

export interface FormTemplate {
  /** The form's display name at creation; the person can rename it immediately. */
  name: string;
  /** The starting config, or null for the blank form (the API's own default). */
  config: FormConfig | null;
}

export const FORM_TEMPLATES: Readonly<Record<FormTemplateId, FormTemplate>> = {
  'lead-qualifier': { name: 'Lead qualifier', config: LEAD_QUALIFIER_CONFIG },
  'customer-feedback': { name: DEMO_FORM_NAME, config: DEMO_FORM_CONFIG },
  'event-registration': { name: 'Event registration', config: EVENT_REGISTRATION_CONFIG },
  application: { name: 'Applications and requests', config: APPLICATION_CONFIG },
  blank: { name: 'Untitled form', config: null },
};

/**
 * Resolve a template id to its definition.
 *
 * Takes `string`, not `FormTemplateId`: the caller is an HTTP handler, and the
 * value arrives from a request body. Returning `undefined` for anything
 * unrecognized keeps the "is this a real template?" check in one place instead
 * of scattering a cast at every call site.
 */
export function getFormTemplate(id: string): FormTemplate | undefined {
  return Object.prototype.hasOwnProperty.call(FORM_TEMPLATES, id)
    ? FORM_TEMPLATES[id as FormTemplateId]
    : undefined;
}
