# MCP connections sign in through the host's identity provider

> How a token maps to a person is superseded by [0003](0003-mcp-sign-in-maps-through-web-logins.md) and then [0004](0004-mcp-sign-in-link-first-directory-fallback.md): through the link a web login records first, and the identity service's database (now optional) for whoever the link does not cover.

Chat clients (browser connectors) can only reach an MCP server through OAuth, so the MCP server gains a second door beside the API key. We do not run our own authorization server: the MCP server is an OAuth resource server that verifies tokens signed by the identity provider the deployment already uses for logins, through an adapter selected by configuration (the hosted deployment uses WorkOS AuthKit, the same way its sibling MCP server does). Every issuer, domain and credential comes from the environment, so a self-hosted install without that adapter keeps working with API keys only.

## Consequences

- An MCP connection is a person, not a workspace: each tool call carries a workspace, chosen from the workspaces where that person has an active member (only one: used without asking). An API key keeps fixing its workspace, and a different one in a call is refused. (For the deployment's staff this no longer holds: see [0002](0002-staff-access-over-mcp.md).)
- The token names the person in the provider's terms; the adapter maps it to the person the members are keyed by. Access is cut by deactivating the member, which takes effect on the next call; the provider's session is not revoked by dForms.
- Rate limits for MCP connections count per member, so one person with several connected clients shares one budget.
- The resource URL is registered with the provider and is the audience of every token, so changing the MCP host later means re-registering it and every connection signing in again.

## Considered options

- Our own authorization server (dynamic client registration, consent, token store): weeks of work and a larger security surface, for no gain while the deployment already has a provider.
- Sharing another product's in-house OAuth server: not ready, and couples our launch to theirs.
