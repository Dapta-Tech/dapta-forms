/**
 * Smart auto-map heuristic for the HubSpot mapping UI. Pure + framework-free so
 * the "Auto-map" action is instant and unit-testable (no React/server imports).
 */

/** One mappable form question, surfaced from the form's steps (page.tsx). */
export interface QuestionMeta {
  key: string;
  label: string;
  type: string;
}

/**
 * Guess a HubSpot contact property for a form question by matching its key/label
 * (and field type) to well-known property names (email→email, first/name→
 * firstname, last→lastname, phone→mobilephone|phone, company→company,
 * website→website, EN + ES synonyms). Only returns a property that actually
 * exists in the connected portal: `byLower` maps a lowercased property name →
 * its real-cased name, and the match is returned in the portal's own casing.
 * Returns null when nothing sensible matches (so empty stays empty).
 */
export function suggestProperty(q: QuestionMeta, byLower: Map<string, string>): string | null {
  const pick = (...cands: string[]): string | null => {
    for (const c of cands) {
      const real = byLower.get(c);
      if (real) return real;
    }
    return null;
  };
  // Normalize separators (snake_case, kebab-case) to spaces so `first_name` and
  // `sitio-web` match the same synonyms as "first name" / "sitio web".
  const hay = `${q.key} ${q.label}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const type = q.type;
  if (type === 'email' || /\bemail\b|e\s?mail|correo/.test(hay)) return pick('email');
  if (type === 'phone' || /phone|mobile|whats\s?app|tel[eé]fono|celular|\btel\b/.test(hay))
    return pick('mobilephone', 'phone');
  if (type === 'url') return pick('website');
  if (/last\s?name|surname|apellidos?/.test(hay)) return pick('lastname');
  if (/first\s?name|given\s?name|primer\s?nombre/.test(hay)) return pick('firstname');
  // Website before company so "company website" maps to website, not company.
  if (/website|web\s?site|\burl\b|\bsite\b|sitio\s?web/.test(hay)) return pick('website');
  if (/company|organi[sz]ation|empresa|negocio|business/.test(hay)) return pick('company');
  if (/job\s?title|\brole\b|position|puesto|cargo/.test(hay)) return pick('jobtitle');
  if (type === 'name' || /\bname\b|full\s?name|nombre/.test(hay)) return pick('firstname');
  return null;
}

/** Convenience: build the lowercased→real name lookup auto-map matches against. */
export function propertyLookup(properties: { name: string }[]): Map<string, string> {
  return new Map(properties.map((p) => [p.name.toLowerCase(), p.name]));
}
