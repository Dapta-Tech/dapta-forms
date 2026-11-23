# Referral state is keyed by person, not by workspace

The referral program rewards a person for bringing new people to dForms: five referrals unlock hiding the badge. Almost everything in dForms is scoped to a workspace (CLAUDE.md invariant 3), and the in-app announcement state is the one deliberate exception, keyed by the person. Referral state is a second exception, for reasons announcements already showed and one more.

## Decision

- **Referral state is keyed by person**, the identity provider subject (the `external_id` of the caller's member row). The `referrer` table (code, unlock timestamp, banner-dismissed-until, nudge-sent timestamp) and the `referral` table (referee person, referrer person, source, created at) carry no workspace id.
- **The reward follows the person.** A referral unlock belongs to the referrer, and a workspace is referral-unlocked when any of its owners holds one. Keying by workspace would lose the credit when a person moves to, or creates, another workspace.
- **There is no person table.** A person exists only as member rows, one per workspace. The person's subject is the stable key available on every request, so the referral tables use it directly instead of introducing a person entity for one feature.
- **New-person detection is derived, not stored.** A person is new when no member row exists for their subject outside staff access grants, and a claim is accepted only while their earliest member row is under 10 minutes old. No person flag is added.
- **Scope of reads.** Referral state is read and written only for the caller about themselves. The one cross-person read is the unlock rule, which asks whether any owner of a workspace holds a referral unlock; it exposes a boolean, never who referred whom.
- **First credit wins.** The referee person is unique in `referral`, so a person is credited once, and rows are never deleted when a person leaves a workspace.
- **Teammate invites are recorded by address.** The identity provider's invitations carry no inviter, so `referral_invite` keeps the first inviter (a person) of each invited address, with the workspace it was sent from for the record only. It is read once, on the invitee's first sign-in, to credit that inviter; an invite credit judges newness as "no bound member row before this sign-in", because an adopted invite row keeps the invite's age. This is the second cross-person read, and it writes a referral, never exposes one.

## Consequences

- Every new route that touches referral state still resolves the principal, but passes the person's subject, not `accountId`, to the repository. This is the second exception to invariant 3, recorded next to the first.
- Local development keys a person by email, as it does for announcements, since there is no identity provider subject.
- Referral rows hold a person's subject and say nothing about any account. Deleting a workspace does not remove them.
- A person with several workspaces has one referral link and one count, shared across all of them.

## Considered options

- Key referral state by workspace: the credit and the unlock would split across a person's workspaces, and a referral would depend on which workspace the person signed up into.
- Add a person table: a larger change that duplicates what the member rows and the identity provider already say, for one feature.
