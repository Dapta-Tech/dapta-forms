# Playbook state is keyed by person, not by workspace

The playbooks gallery shows each person which playbooks they have opened, when they last did, and which ones are new since their last visit. Almost everything in dForms is scoped to a workspace (CLAUDE.md invariant 3); the in-app announcement state and the referral state ([ADR 0005](0005-referral-state-is-keyed-by-person.md)) are the two deliberate exceptions, keyed by the person. Playbook state is a third, for the same reasons announcements are.

## Decision

- **Playbook state is keyed by person**, with exactly the key the announcements use (`announcementUserKey`): the identity provider subject (the `external_id` of the caller's member row), or `member:{member.id}` for a member the identity provider does not know. The `playbook_state` table (migration 0035) holds the person key, the playbook slug, the first open and the last open, and no workspace id.
- **What a person read follows the person.** Reading is something a human does, not a workspace: someone who reads a playbook in one workspace has read it in all of them, and "New" means new to that person.
- **The gallery visit is a row in the same table**, under the reserved slug `_gallery`. A playbook published after its `last_seen_at` is new to the person. Playbook slugs are lowercase words joined by hyphens, so none can take the reserved slug. No second table for one timestamp.
- **The playbooks live in code**, like the announcements: markdown files in `packages/shared/content/playbooks`, turned into a typed module by a committed script. Publishing one is a pull request; the table never holds the content.
- **Scope of reads.** Playbook state is read and written only for the caller about themselves. There is no cross-person read.
- **The announcements' key, not the referrals'.** The two existing exceptions spell the local-development fallback differently (`member:{id}` and `email:{address}`). Unifying them is out of scope here; playbooks reuse the announcements' key, which is the nearest feature (in-app, per person, read state).

## Consequences

- Every route under `/v1/me/playbooks` still resolves the principal, but passes the person key, not `accountId`, to the repository. This is the third exception to invariant 3, recorded next to the other two.
- Local development keys a person by member row, as announcements do, so one email in two local workspaces counts as two people there. Production keys by the identity provider subject and has no such split.
- Playbook rows hold a person key and a slug and say nothing about any account. Deleting a workspace does not remove them.
- Playbook state is keyed by slug, not by slug and language. A playbook read in English is read in Spanish too, and "New" ends in both: the languages are versions of one playbook, which is why they share the slug, the category and the publication date. The language a person read only travels in the `forms_playbook_viewed` event.
- An API key or an MCP connection is refused on every playbook route: it is no person, and its reads would mark playbooks opened for someone who never opened them.

## Considered options

- Key playbook state by workspace: a person would see a playbook they already read marked unread, and "New" again, in each of their workspaces.
- Keep the state in the browser: it would be lost on another device or browser, and the API could not compute "New" for the rail.
- Add a person table: the same reason ADR 0005 gives, a larger change for one feature.
