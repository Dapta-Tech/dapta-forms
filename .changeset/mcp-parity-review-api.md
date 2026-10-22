---
'@quill/api': patch
---

The MCP's `export_responses_csv` reads only the rows it returns (a `LIMIT` plus a `COUNT(*)` for `total_rows`) through the CSV route's own setup and cell encoding, so the text is the download's and a large form is never read in full; the CSV download itself is unchanged. Its 100,000 character cap counts the header, and the first row always comes back whole. `get_response` returns each answer with its `step_key`, `type` and `step_removed`, and the outcome, as `list_responses` does. A tool that reads an id before it deletes it counts once against the API key's 120 calls a minute.
