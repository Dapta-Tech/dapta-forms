import { propertiesFor } from '@quill/types';
import type { HubspotDestinationOptions } from './hubspot';

/**
 * The HubSpot MIRROR FORM — how a submission becomes a "Form submission"
 * activity on the contact instead of a Note.
 *
 * A Note is a different object. It shows up on the timeline as a note, it does
 * not say which form produced it, and it cannot list the properties the
 * submission set. The activity every CRM user recognises — "X submitted <form>",
 * "Updated N properties", each one named — is HubSpot's own Form object. The
 * only way to produce one is to have a form in the portal and post a submission
 * to it, which is exactly what Typeform's integration does: its forms are all
 * `formType: hubspot`, one per typeform.
 *
 * So each Dapta form gets a mirror form in the portal, carrying the contact
 * properties that form actually writes, and every completed submission is posted
 * to it. The mirror is a projection — nothing reads it back, and a portal admin
 * deleting it costs the activity, never the contact sync.
 *
 * ## The shape below is measured, not documented
 *
 * The create endpoint rejects payloads for reasons its errors describe poorly,
 * so every rule here comes from a probe against a real portal:
 *
 *  - `createdAt` is REQUIRED on create. It reads as a server-owned field and the
 *    error names it without saying where it belongs — the column it points at
 *    just tracks the end of the payload, which is what identifies it as a ROOT
 *    key rather than one on a field.
 *  - `validation` is required on an `email` field and must be ABSENT on a text
 *    one. Sending `{}` on a text field is rejected.
 *  - `single_line_text` carries any property, including an `enumeration`.
 *    Submitting `COMPUTER_GAMES` through a text field lands the internal value
 *    on the contact — the property's own type governs, not the form field's. So
 *    the mirror declares everything as text except the email, and never has to
 *    mirror a portal's picklists or keep up as they change.
 */

/** Contact-object type id, on every field of a contact form. */
const CONTACT_OBJECT_TYPE_ID = '0-1';

/** A form field as the create endpoint accepts it. */
export interface HubSpotFormField {
  objectTypeId: string;
  name: string;
  label: string;
  fieldType: 'email' | 'single_line_text';
  required: boolean;
  hidden: boolean;
  validation?: { blockedEmailDomains: string[]; useDefaultBlockList: boolean };
}

export interface HubSpotFormPayload {
  formType: 'hubspot';
  name: string;
  archived: boolean;
  createdAt: string;
  configuration: Record<string, unknown>;
  displayOptions: Record<string, unknown>;
  legalConsentOptions: { type: 'none' };
  fieldGroups: { groupType: string; richTextType: string; fields: HubSpotFormField[] }[];
}

/**
 * Every contact property this destination writes, `email` first.
 *
 * This is what decides the mirror's fields, and it has to match what the
 * adapter actually sends or the activity lists properties the submission never
 * set. Derived from the same options the adapter builds its payload from —
 * mappings, UTMs, and the score/date/outcome/static properties — rather than
 * from a list kept in step by hand.
 *
 * `inferCompanyFromEmail` is deliberately NOT included: it fills `company` and
 * `website` only for some respondents, so declaring them would promise fields
 * most submissions leave empty.
 */
export function mirrorFormProperties(opts: HubspotDestinationOptions): string[] {
  const out = new Set<string>(['email']);
  for (const target of Object.values(opts.fieldMappings ?? {})) {
    for (const property of propertiesFor(target)) out.add(property);
  }
  for (const property of Object.values(opts.utmMappings ?? {})) out.add(property);
  for (const property of [opts.scoreProperty, opts.dateProperty, opts.outcomeProperty]) {
    if (property) out.add(property);
  }
  for (const property of Object.keys(opts.staticProperties ?? {})) out.add(property);
  return [...out].filter((p) => p.trim() !== '');
}

/** A property name read back as a field label: `inbound_leads` → `Inbound leads`. */
export function labelForProperty(property: string): string {
  const words = property.replace(/[_-]+/g, ' ').trim();
  if (!words) return property;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fieldFor(property: string): HubSpotFormField {
  if (property === 'email') {
    return {
      objectTypeId: CONTACT_OBJECT_TYPE_ID,
      name: 'email',
      label: 'Email',
      fieldType: 'email',
      required: true,
      hidden: false,
      // Required on an email field. Empty lists mean "block nothing" — this
      // form is never rendered to anyone, so blocking is not its job.
      validation: { blockedEmailDomains: [], useDefaultBlockList: false },
    };
  }
  return {
    objectTypeId: CONTACT_OBJECT_TYPE_ID,
    name: property,
    label: labelForProperty(property),
    fieldType: 'single_line_text',
    required: false,
    hidden: false,
    // No `validation` key at all: the create endpoint rejects one on a text
    // field, including an empty object.
  };
}

/**
 * The mirror form's name, as it appears on the activity: "<form> (Dapta Forms)".
 *
 * The suffix is what tells a CRM user why a form they never built is in their
 * portal — the same job Typeform's "Fields and questions must be updated on
 * Typeform" does. Truncated because HubSpot caps the name, and a form whose
 * creation 400s on a long title would fail at the least explicable moment.
 */
export const MIRROR_FORM_SUFFIX = ' (Dapta Forms)';
const MAX_NAME = 200;

export function mirrorFormName(formName: string): string {
  const base = (formName || 'Untitled form').trim();
  const room = MAX_NAME - MIRROR_FORM_SUFFIX.length;
  return `${base.length > room ? `${base.slice(0, room - 1)}…` : base}${MIRROR_FORM_SUFFIX}`;
}

/**
 * The create/update payload for a form mirroring `formName` and carrying
 * `properties`. Pure — `createdAt` is passed in so the payload is a function of
 * its arguments and can be asserted on whole.
 */
export function buildMirrorFormPayload(
  formName: string,
  properties: string[],
  createdAt: string,
): HubSpotFormPayload {
  return {
    formType: 'hubspot',
    name: mirrorFormName(formName),
    archived: false,
    createdAt,
    configuration: {
      language: 'en',
      cloneable: true,
      postSubmitAction: { type: 'thank_you', value: 'Thanks for submitting the form.' },
      editable: true,
      archivable: true,
      recaptchaEnabled: false,
      notifyContactOwner: false,
      // The respondent may be new to the portal — that is the common case for a
      // lead form, and refusing to create them would drop the submission.
      createNewContactForNewEmail: true,
      prePopulateKnownValues: true,
      allowLinkToResetKnownValues: false,
      embedType: 'V3',
    },
    displayOptions: {
      renderRawHtml: false,
      theme: 'default_style',
      submitButtonText: 'Submit',
      style: {},
      cssClass: '',
    },
    // The respondent consented on the Dapta form, not on this one; the mirror is
    // never rendered, so it must not claim a consent step of its own.
    legalConsentOptions: { type: 'none' },
    // One field per group, matching how the portal's own integrations lay them
    // out. The mirror is never displayed, so grouping carries no meaning here.
    fieldGroups: properties.map((property) => ({
      groupType: 'default_group',
      richTextType: 'text',
      fields: [fieldFor(property)],
    })),
  };
}

/**
 * Where a submission is posted. `secure` is not optional: it is the only variant
 * that accepts a private-app token, and it is what the `form-submissions-write`
 * scope guards.
 */
export const HUBSPOT_FORMS_SUBMIT_BASE = 'https://api.hsforms.com';

export function mirrorSubmitUrl(portalId: string, formGuid: string, base?: string): string {
  return `${base ?? HUBSPOT_FORMS_SUBMIT_BASE}/submissions/v3/integration/secure/submit/${encodeURIComponent(portalId)}/${encodeURIComponent(formGuid)}`;
}

/**
 * The submission body: the properties the adapter just wrote to the contact,
 * as form fields.
 *
 * Only properties the mirror DECLARES are sent — HubSpot rejects a submission
 * naming a field the form does not have, which would otherwise turn a stale
 * mirror (mappings edited, mirror not yet rebuilt) into a hard failure instead
 * of a partial activity.
 */
export function buildMirrorSubmission(
  properties: Record<string, string>,
  declared: string[],
  context?: { pageUri?: string; pageName?: string },
): { fields: { objectTypeId: string; name: string; value: string }[]; context?: object } {
  const allowed = new Set(declared);
  const fields = Object.entries(properties)
    .filter(([name, value]) => allowed.has(name) && value !== '' && value != null)
    .map(([name, value]) => ({
      objectTypeId: CONTACT_OBJECT_TYPE_ID,
      name,
      value: String(value),
    }));
  return context && (context.pageUri || context.pageName) ? { fields, context } : { fields };
}
