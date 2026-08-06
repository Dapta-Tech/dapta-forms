import type { BookingFieldKind } from '@quill/engine';
import type { FormsMessages } from '@quill/shared';

type IntegrationsMessages = FormsMessages['admin']['integrations'];

/**
 * The shared catalog's name for one of a booking's facts.
 *
 * `bookingFieldsFor` in `@quill/engine` says WHICH facts a booking produces and
 * under which keys; this says what to call them. Both the builder's question
 * panel and the Connect screen resolve their row labels through here, so neither
 * can rename a row the other still prints by its old name.
 *
 * It lives in the web app rather than the engine because the engine holds no
 * user-facing copy — see the i18n invariant in CLAUDE.md.
 */
export function bookingLabel(kind: BookingFieldKind, m: IntegrationsMessages): string {
  switch (kind) {
    case 'start_time':
      return m.bookingStart;
    case 'name':
      return m.inviteeName;
    case 'first_name':
      return m.inviteeFirstName;
    case 'last_name':
      return m.inviteeLastName;
    case 'phone':
      return m.inviteePhone;
  }
}
