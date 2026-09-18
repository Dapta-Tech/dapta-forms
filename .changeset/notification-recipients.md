---
'@quill/db': minor
'@quill/types': minor
'@quill/notifications': minor
'@quill/shared': minor
---

Submission notifications can be sent to up to five addresses, set per account and overridden per form.

The new-submission notice had no audience to configure. It went to the account
owner because the send path looked the owner up, so a team that runs on email
rather than a CRM had to forward it by hand or wire a webhook into an
automation tool to do what a field should do.

Settings → Notifications now carries a **Send to** list on that email, and the
same control appears on a form's Connect tab, where a form can set its own.
Addresses are rows with add and remove, not a comma-separated box, so a
malformed one is marked where it is rather than reported as "something failed".
Five is the ceiling, enforced by the API and not only by the browser, which also
rejects a malformed address and the same mailbox listed twice.

Each address gets its **own** email rather than sharing a To line, and each one
is its own queued row: an address that bounces retries by itself, without
costing the other four their delivery, and every copy shows up separately in
the form's delivery history.

Inheritance is per field, like the subject and body beside it. A form with no
list of its own follows the account's, and the card says so. Emptying the list
on one form is a decision rather than a blank: that form notifies the owner
alone while the account keeps telling everyone else. An account that configures
nothing keeps receiving exactly what it received before, at the owner's address,
in one email.

- `notification_setting.recipients` (migration 0022, both dialects): a JSON
  array in TEXT, like `reminder_lead_minutes` on the same table. `null`
  inherits, `[]` is the stored "owner only", a list replaces.
- `notificationSettingPatchSchema` gains `recipients`, shared by the account PUT
  and the per-form PUT. It is refused on `submission_confirmed`, which is
  addressed to the respondent and would never read it.
- The submission email's idempotency key now names its addressee. The single
  key it carried before would have had a de-duplicating transport drop every
  copy but the first, with no error and no log.
- i18n: `admin.notifications.recipients*` (EN + ES).
