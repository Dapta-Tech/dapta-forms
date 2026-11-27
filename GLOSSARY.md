# dForms

Self-hostable forms platform: people build forms in the admin, respondents answer them, and agents operate them through the API and the MCP server.

## Language

### Who

**Workspace**:
The unit that owns forms, responses, brand kit and integrations. Every request acts inside exactly one workspace.
_Avoid_: Account, organization, tenant

**Member**:
A person's place in one workspace, with one role. A person can be a member of several workspaces.
_Avoid_: User, seat

**Role**:
What a member may do in a workspace: owner, admin or member. Checked on every request, never cached in a credential.
_Avoid_: Permission level

**Staff**:
A person whose email is on one of the deployment's staff domains. Staff can find and enter any workspace, as an admin, through a staff access grant. Judged again on every request, never stored.
_Avoid_: Superuser, support user

**Staff access grant**:
The admin member row a staff person gets in a workspace they are not a member of, marked as a grant. It never shows on the team's roster, is never revoked, and works only while its holder is still staff.
_Avoid_: Impersonation, guest membership

**Respondent**:
Someone who answers a published form. Never a member by virtue of answering.
_Avoid_: User, lead, contact

**Person**:
One human across workspaces, identified by the identity provider's subject. A person has a member in each workspace they belong to; there is no person table, and a person is known only through those member rows.
_Avoid_: User, account holder

**Referral link**:
A person's personal link to dForms, carrying a short random code. Whoever signs up through it is credited to that person.
_Avoid_: Invite link, affiliate link

**Referrer**:
The person who owns a referral link. Their referral state (code, unlock, banner and nudge timestamps) is kept per person, not per workspace.
_Avoid_: Affiliate, sponsor

**Referral**:
One new person credited to one referrer, by link or by a teammate invite. A person is credited at most once, and the first credit wins.
_Avoid_: Conversion, signup

**Referral unlock**:
What a referrer earns on reaching five referrals: the badge can be hidden on every workspace they own, with no expiry. Unlike a paid verdict, it never lapses.
_Avoid_: Reward, perk

### What people read

**Playbook**:
A free resource in the in-app gallery and on the landing's resource hub: a long text with a category, a step done with a dForms template, and a public preview. Its full text needs a sign-in, unless a guide promises it. Defined in code, never in the database, once per playbook language.
_Avoid_: Guide, resource, article, lead magnet

**Playbook language**:
The language a playbook is written in, Spanish or English, chosen with the ES / EN toggle of the gallery and the reader. It is separate from the platform's language: switching it changes the playbooks only. Spanish is the base: a playbook with no version in the language asked for is served in Spanish, marked as a fallback. One playbook is the same playbook in every language, with one slug, one category, one publication date and one playbook state.
_Avoid_: Content locale, translation

**Playbook state**:
What one person has done with the playbooks: when they first and last opened each one, and when they last visited the gallery. Kept per person, not per workspace, and per playbook, not per playbook language; "New" is a playbook published after that last visit and never opened.
_Avoid_: Progress, read receipt

### How agents get in

**API key**:
A secret a member creates for one workspace; it acts as that member, with the member's current role, in that workspace only.
_Avoid_: Token, PAT

**MCP connection**:
An agent client (a chat app or a coding agent) signed in to the MCP server as a person through OAuth. Unlike an API key it is not tied to one workspace: each call names the workspace it acts in.
_Avoid_: OAuth key, integration

**Identity provider**:
The login service that signs an MCP connection's token. dForms only verifies its tokens; it never sees a password.
_Avoid_: Auth server, SSO
