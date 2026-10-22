---
'@quill/web': patch
---

Session recordings of the admin now look like the app. The MCP item's rotating Claude, ChatGPT and Cursor logos are drawn as inline SVG instead of a CSS mask over a file, so a replay (which rebuilds the page on another origin and cannot load that mask) no longer shows an empty slot where the icon is. The self-hosted fonts under `/_next/static/media/` are served with `Access-Control-Allow-Origin: *`, so a replay loads the app's own typeface instead of a fallback. A test fails if any CSS `url()` in the web app names a file on its own origin again.
