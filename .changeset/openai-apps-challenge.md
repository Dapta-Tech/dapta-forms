---
'@quill/config': patch
---

Add `OPENAI_APPS_CHALLENGE_TOKEN`: the API serves it as plain text at `/.well-known/openai-apps-challenge`, the domain check OpenAI runs before a ChatGPT app built on the MCP server can be submitted. Unset (the default), that path answers 404.
