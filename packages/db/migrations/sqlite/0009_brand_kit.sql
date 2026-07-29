-- Workspace brand kit — additive.
--
--   account_branding — one row per account. `config` (TEXT JSON) holds the
--                      workspace brand kit (logo, client logos, colors, font,
--                      radius, button style) validated by `brandKitSchema` in
--                      @quill/types. Forms SNAPSHOT the kit: it is merged into a
--                      form's own `config.branding` at creation and on an
--                      explicit "apply", never resolved live at render.
--
--   form.brand_backup     — the form's `branding` object (live + draft) as it
--                           was immediately before the last kit apply, kept so
--                           an apply is reversible. NULL = nothing to revert.
--   form.brand_applied_at — epoch-ms of that apply; NULL when never applied or
--                           already reverted.
CREATE TABLE IF NOT EXISTS account_branding (
  account_id  TEXT PRIMARY KEY,
  config      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

ALTER TABLE form ADD COLUMN brand_backup TEXT;
ALTER TABLE form ADD COLUMN brand_applied_at INTEGER;
