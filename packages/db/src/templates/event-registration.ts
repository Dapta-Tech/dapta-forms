/**
 * TEMPLATE — Event registration. Offered to whoever answers "register people for
 * an event" in the onboarding wizard.
 *
 * Deliberately does NOT use a `scheduler` step. That step needs a real Calendly
 * or HubSpot event-type URL to render anything, and a template cannot ship one —
 * it would arrive broken, which is a worse first impression than not offering it.
 * A registration form collects who is coming; picking a time slot is a different
 * job the author can add once their own scheduling link exists.
 *
 * Scoring is OFF: an attendee list is a list, not a ranking, and a score column
 * on it is noise the author would have to go and switch off.
 */
import type { FormConfig } from '@quill/types';

export const EVENT_REGISTRATION_CONFIG: FormConfig = {
  version: 1,
  branding: { primaryColor: '#7c3aed' },
  cover: {
    enabled: true,
    eyebrow: 'You are invited',
    headline: 'Save your spot',
    subheadline: 'Tell us who is coming and we will send the details straight to your inbox.',
    ctaText: 'Register',
    trustBadge: 'Free to attend — we will only email you about this event',
  },
  steps: [
    {
      key: 'name',
      type: 'name',
      question: 'Who should we put on the list?',
      required: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'email',
      type: 'email',
      question: 'Where should we send your confirmation?',
      placeholder: 'you@company.com',
      required: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'attending',
      type: 'multiple_choice',
      question: 'How will you be joining us?',
      required: true,
      showIcons: true,
      options: [
        { label: 'In person', value: 'in_person', icon: '\u{1F3E2}' },
        { label: 'Online', value: 'online', icon: '\u{1F4BB}' },
      ],
    },
    {
      key: 'guests',
      type: 'slider',
      question: 'Bringing anyone with you?',
      helper: '0 means just you.',
      min: 0,
      max: 5,
      step: 1,
      default: 0,
      sliderUnitLabel: 'guests',
    },
    {
      key: 'notes',
      type: 'textarea',
      question: 'Anything we should know?',
      placeholder: 'Dietary requirements, accessibility needs, or nothing at all.',
      required: false,
    },
  ],
  ending: {
    headline: 'You are on the list',
    body: 'Check your inbox for the details. See you there.',
  },
  partialSubmitAfterStep: 2,
};
