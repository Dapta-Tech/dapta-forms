---
'@quill/mcp': patch
---

The MCP tools read the way the Claude and ChatGPT connector directories ask for.

- Behaviour hints: `update_form`, `update_brand_kit`, `update_notification` and `update_form_notification` are destructive (they replace a whole draft or kit, or upsert copy that is lost). `create_form`, `duplicate_form`, `publish_form`, `revert_form`, `set_form_slug`, `delete_form`, `update_brand_kit`, `apply_brand_kit` and `revert_brand_kit` are open world, since each changes a public page.
- Tool descriptions, argument and result schemas, the server instructions and the `get_form_guide` text say what each tool does, takes and changes instead of giving the model orders. The recommendation to confirm a destructive call with the user stays, said as a recommendation.
- Behaviour, tool names and the tool count are unchanged.
- A new spec fails when any tool lacks a title or one of the four hints, when the destructive or open world sets drift, or when a description, a schema, the instructions or the guide holds `ALWAYS`, `NEVER`, `MUST`, `IMPORTANT`, `Do NOT`, "call this first", "before anything" or "ignore earlier instructions".
