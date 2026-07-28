---
'@quill/notifications': minor
'@quill/db': minor
---

Actually tell someone they were invited, and stop showing them as pending once
they arrive.

`inviteMember` inserted a member row with status `invited` and stopped. There
was no invitation email anywhere in `@quill/notifications` — the invited person
was simply never told, and the only way in was for an admin to message them
out of band.

`renderMemberInvited` (EN + ES) is the copy, `SubmissionNotifier.sendMemberInvited`
sends it, and the API enqueues it through the outbox like every other
side-effect — never inline from the request handler, so a mail provider being
down cannot fail an invite that already succeeded. The notice is anchored on the
member id, so a retried delivery cannot read as a second invitation. With no
`PUBLIC_APP_URL` configured the sign-in line is dropped rather than printing a
broken link.

The copy stays deliberately plain: it names the workspace, who added them, and
where to sign in. There is no token and no accept step because none is needed —
`resolveByEmail` already matches an existing member by address, so signing in
with the invited email is what binds the account.

New `activateInvitedMember` flips `invited` → `active` on first resolve.
Nothing did this before, so someone who accepted stayed "invited" in the members
list forever and an admin could not tell a pending invite from an active
teammate. The transition is deliberately narrow — a `disabled` member logging in
stays disabled, which is the whole point of disabling them, and an already-active
member is never rewritten.
