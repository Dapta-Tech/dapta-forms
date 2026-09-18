/**
 * Resolving a STALE refusal from the editor's guarded save.
 *
 * The stamp moves on every write to the form row, not only on content edits:
 * this editor's own slug rename, a CRM mapping saved from the question panel,
 * the brand kit applied from settings. The API's 409 carries what the server
 * holds now, so the editor compares it with what IT last saved successfully.
 * Same content: only the stamp moved, adopt it and save again, nobody notices.
 * Different content: another editor changed the form, and only a person can
 * decide between the two versions.
 */

export interface SavedContent {
  name: string;
  config: unknown;
}

/** JSON with object keys in sorted order at every depth, so two configs that
 *  differ only in key order (Postgres jsonb reorders them) compare equal. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Whether what the server holds is what this editor last saved. `destinations`
 * is left out on both sides: the draft never stages it (the integrations
 * screen edits it live), so the live copy the server hands back always
 * carries a set the editor's snapshot never sent.
 */
export function sameSavedContent(
  server: SavedContent | null,
  mine: SavedContent,
): boolean {
  if (!server) return false;
  if (server.name !== mine.name) return false;
  return (
    stableStringify(withoutDestinations(server.config)) ===
    stableStringify(withoutDestinations(mine.config))
  );
}

function withoutDestinations(config: unknown): unknown {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return config;
  const { destinations: _dropped, ...rest } = config as Record<string, unknown>;
  return rest;
}
