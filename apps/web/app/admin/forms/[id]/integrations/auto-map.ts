/**
 * Smart auto-map heuristic for the HubSpot mapping UI. Pure + framework-free so
 * the "Auto-map" action is instant and unit-testable (no React/server imports).
 */
import { nameFields, stepQuestionText, type FormStep } from '@quill/engine';

/**
 * One mappable answer key, surfaced from the form's steps by
 * {@link mappableQuestions}. Usually one per question; a `name` question gives
 * one per sub-field, because that is how its answer is stored.
 */
export interface QuestionMeta {
  key: string;
  label: string;
  type: string;
  /**
   * Set only on the entries a `name` question expands into: which half of the
   * name this key holds. Auto-map reads it instead of the label, since a label
   * like "Name and surname · First name" names both halves.
   */
  namePart?: 'first' | 'last';
}

/** The fallback sub-field labels for a `name` question, in the author's language. */
export interface NamePartLabels {
  first: string;
  last: string;
}

/**
 * The answer keys the destination pickers (HubSpot, Google Sheets, Salesforce)
 * offer, in the form's order. `message` steps collect nothing and are left out.
 *
 * A `name` step never stores an answer under its own key: it writes each
 * sub-field flat (`firstname`, `lastname`, or its custom `fields`), which is
 * what the delivery adapters read. Offering the step key would let an author
 * map "Full name" to a CRM field that then always arrives empty, so a name
 * step becomes one entry per sub-field instead, labelled "{question} · {part}"
 * with the step's own sub-field label when it has one.
 *
 * A key offered twice (two name steps on the stock fields write the same
 * answers) is offered once, at its first capture.
 */
export function mappableQuestions(steps: readonly FormStep[], parts: NamePartLabels): QuestionMeta[] {
  const out: QuestionMeta[] = [];
  const seen = new Set<string>();
  const push = (q: QuestionMeta) => {
    if (seen.has(q.key)) return;
    seen.add(q.key);
    out.push(q);
  };
  for (const s of steps) {
    if (s.type === 'message') continue;
    const title = stepQuestionText(s).trim() || s.key;
    if (s.type !== 'name') {
      push({ key: s.key, label: title, type: s.type });
      continue;
    }
    nameFields(s).forEach((field, i) => {
      const namePart = i === 0 ? 'first' : i === 1 ? 'last' : undefined;
      const own = (s.fieldLabels?.[field] ?? '').trim();
      const part = own || (namePart ? parts[namePart] : field);
      push({ key: field, label: `${title} · ${part}`, type: s.type, ...(namePart ? { namePart } : {}) });
    });
  }
  return out;
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
  // A sub-field of a `name` question already says which half it is; its label
  // names the question too ("Nombre y Apellido · Nombre"), so a keyword sweep
  // would read the first name as a surname.
  if (q.namePart === 'first') return pick('firstname');
  if (q.namePart === 'last') return pick('lastname');
  const hay = `${q.key} ${q.label}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const type = q.type;
  if (type === 'email' || /\bemail\b|e\s?mail|correo/.test(hay)) return pick('email');
  if (type === 'phone' || /phone|mobile|whats\s?app|tel[eé]fono|celular|\btel\b/.test(hay))
    return pick('mobilephone', 'phone');
  if (type === 'url') return pick('website');
  // A file answer is an object holding an object key, so there is no contact
  // property it could sensibly fill. Returning early also stops the keyword
  // sweep below from matching on a question like "Upload your company logo"
  // and mapping a PDF into `company`.
  if (type === 'file') return null;
  // A checkbox answers `true`: no contact property should guess it from the
  // words of a consent line ("... de la empresa" is not a company name).
  if (type === 'checkbox') return null;
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
