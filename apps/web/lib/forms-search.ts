/**
 * Client-side search and grouping for the forms list. Pure: the list is
 * already loaded, so filtering by name or slug happens in the browser with no
 * round trip. Matching ignores case and accents on both sides, the way the
 * slugifier does, so "satisfaccion" finds "Satisfacción".
 */

export interface SearchableForm {
  id: string;
  name: string;
  slug: string;
  folderId: string | null;
}

export interface SearchableFolder {
  id: string;
  name: string;
}

/** A character range `[start, end)` on the ORIGINAL name, for highlighting. */
export type MatchRange = [number, number];

export interface FormMatch {
  matched: boolean;
  nameRanges: MatchRange[];
}

/** Lower-case, accents stripped, trimmed. Same recipe as `slugify`'s first steps. */
export function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Map an index in the normalized string back to the original. Accents are
 * combining marks that `normalize` removed, so the original index only ever
 * runs ahead of the normalized one; walk both in step.
 */
function rangesOnOriginal(
  original: string,
  normalizedQuery: string,
): MatchRange[] {
  const ranges: MatchRange[] = [];
  if (!normalizedQuery) return ranges;
  // Per-character normalized forms, so the map back is exact.
  const chars = [...original];
  const normChars = chars.map((c) => normalize(c) || (c === " " ? " " : ""));
  const flat = normChars.join("");
  // Offsets: the original char index at which each normalized char starts.
  const origIndexAt: number[] = [];
  chars.forEach((c, i) => {
    for (let k = 0; k < normChars[i]!.length; k++) origIndexAt.push(i);
  });
  let from = 0;
  for (;;) {
    const at = flat.indexOf(normalizedQuery, from);
    if (at < 0) break;
    const startChar = origIndexAt[at]!;
    const endChar = origIndexAt[at + normalizedQuery.length - 1]! + 1;
    // Convert char (code point) indexes to string indexes.
    const start = chars.slice(0, startChar).join("").length;
    const end = chars.slice(0, endChar).join("").length;
    ranges.push([start, end]);
    from = at + normalizedQuery.length;
  }
  return ranges;
}

/** Whether `form` matches `query` by name or slug; ranges are on the name only. */
export function matchForm(
  form: Pick<SearchableForm, "name" | "slug">,
  query: string,
): FormMatch {
  const q = normalize(query);
  if (!q) return { matched: true, nameRanges: [] };
  const nameRanges = rangesOnOriginal(form.name, q);
  const matched = nameRanges.length > 0 || normalize(form.slug).includes(q);
  return { matched, nameRanges: matched ? nameRanges : [] };
}

export interface FormSection<F extends SearchableForm = SearchableForm> {
  /** The folder id, or null for the unfiled section. */
  id: string | null;
  /** The folder name; null for the unfiled section (the caller labels it). */
  name: string | null;
  /** The forms to show (filtered by the query), in list order. */
  forms: Array<F & { match: FormMatch }>;
  /** How many forms the folder holds regardless of the query (the header count). */
  total: number;
}

/**
 * Group forms into sections: Unfiled first, then every folder alphabetically
 * (as the API lists them). Without a query every folder is a section, even an
 * empty one, so it can receive a drop. With a query, sections without a match
 * disappear and the ones left keep their full count.
 */
export function groupBySections<F extends SearchableForm>(
  forms: F[],
  folders: SearchableFolder[],
  query: string,
): FormSection<F>[] {
  const known = new Set(folders.map((f) => f.id));
  const byFolder = new Map<string | null, Array<F & { match: FormMatch }>>();
  const totals = new Map<string | null, number>();
  const keyOf = (f: F) =>
    f.folderId && known.has(f.folderId) ? f.folderId : null;
  for (const form of forms) {
    const key = keyOf(form);
    totals.set(key, (totals.get(key) ?? 0) + 1);
    const match = matchForm(form, query);
    if (!match.matched) continue;
    const list = byFolder.get(key) ?? [];
    list.push({ ...form, match });
    byFolder.set(key, list);
  }
  const searching = normalize(query).length > 0;
  const sections: FormSection<F>[] = [];
  const unfiled = byFolder.get(null) ?? [];
  if (!searching || unfiled.length > 0)
    sections.push({
      id: null,
      name: null,
      forms: unfiled,
      total: totals.get(null) ?? 0,
    });
  for (const folder of folders) {
    const list = byFolder.get(folder.id) ?? [];
    if (searching && list.length === 0) continue;
    sections.push({
      id: folder.id,
      name: folder.name,
      forms: list,
      total: totals.get(folder.id) ?? 0,
    });
  }
  return sections;
}
