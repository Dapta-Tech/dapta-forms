---
'@quill/api': patch
---

The MCP endpoint logs an unexpected failure by error class and code only, never its stack, and the CORS check matches `/mcp` in any letter case, so `/MCP` gets the MCP policy instead of the dashboard's.
