/**
 * The save-time check of a HighLevel destination's custom-field targets: each
 * kind of mapping may only target the custom-field types
 * `goHighLevelSlotAccepts` allows (a number field for the score, a date field
 * for the submitted day, a text field for a UTM, any mappable type for an
 * answer or a fixed value). The schema accepts every type GHL reports, so a
 * stored config keeps parsing; this is the authoring rule, run where a
 * destination is written.
 *
 * Like the one-per-form rule, only what is NEW is refused: a target the form
 * already stores in the same place is kept, so narrowing the rule later never
 * makes an untouched form unsaveable (the builder writes the whole array back
 * on every edit).
 */
import {
  formDestinationSchema,
  goHighLevelSlotAccepts,
  type GoHighLevelCustomFieldTarget,
  type GoHighLevelDestination,
  type GoHighLevelMappingSlot,
} from '@quill/types';

export interface GoHighLevelMappingIssue {
  index: number;
  path: string;
  message: string;
}

interface Target {
  slot: GoHighLevelMappingSlot;
  /** Where it sits in the entry, for the message's `path`. */
  path: string;
  /** What the author mapped, in words. */
  what: string;
  target: GoHighLevelCustomFieldTarget;
}

/** Every custom-field target a delivery reads (drafts are never delivered). */
function targetsOf(entry: GoHighLevelDestination): Target[] {
  const out: Target[] = [];
  for (const [key, targets] of Object.entries(entry.fieldMappings ?? {})) {
    targets.forEach((t, i) => {
      if (t.kind === 'custom') {
        out.push({ slot: 'field', path: `fieldMappings.${key}.${i}`, what: `the answer to "${key}"`, target: t });
      }
    });
  }
  for (const [utm, t] of Object.entries(entry.utmMappings ?? {})) {
    if (t) out.push({ slot: 'utm', path: `utmMappings.${utm}`, what: utm, target: t });
  }
  if (entry.scoreField) out.push({ slot: 'score', path: 'scoreField', what: 'the score', target: entry.scoreField });
  if (entry.dateField) out.push({ slot: 'date', path: 'dateField', what: 'the submitted date', target: entry.dateField });
  (entry.staticFields ?? []).forEach((s, i) => {
    if (s.target.kind === 'custom') {
      out.push({ slot: 'field', path: `staticFields.${i}.target`, what: 'a fixed value', target: s.target });
    }
  });
  return out;
}

const signature = (t: Target): string => `${t.slot}\n${t.path}\n${t.target.id}\n${t.target.dataType}`;

const NEEDS: Record<GoHighLevelMappingSlot, string> = {
  field: 'HighLevel does not take a value from dForms in that type of field. Choose another custom field.',
  score: 'The score goes to a number custom field (NUMERICAL).',
  date: 'The submitted date goes to a date custom field (DATE).',
  utm: 'A UTM goes to a text custom field (TEXT or LARGE_TEXT).',
};

function goHighLevelEntries(list: unknown): Array<{ index: number; entry: GoHighLevelDestination }> {
  if (!Array.isArray(list)) return [];
  const out: Array<{ index: number; entry: GoHighLevelDestination }> = [];
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || (raw as { type?: unknown }).type !== 'gohighlevel') return;
    const parsed = formDestinationSchema.safeParse(raw);
    if (parsed.success && parsed.data.type === 'gohighlevel') out.push({ index, entry: parsed.data });
  });
  return out;
}

/**
 * The first new HighLevel target whose custom-field type cannot receive what
 * is mapped to it, or null. `stored` is the form's current destinations
 * (nothing, for a form being created).
 */
export function goHighLevelMappingIssue(incoming: unknown, stored?: unknown): GoHighLevelMappingIssue | null {
  const kept = new Set<string>();
  for (const { entry } of goHighLevelEntries(stored)) for (const t of targetsOf(entry)) kept.add(signature(t));
  for (const { index, entry } of goHighLevelEntries(incoming)) {
    for (const t of targetsOf(entry)) {
      if (goHighLevelSlotAccepts(t.slot, t.target.dataType) || kept.has(signature(t))) continue;
      const field = t.target.key || t.target.id;
      return {
        index,
        path: `destinations.${index}.${t.path}`,
        message: `Destination ${index + 1} (HighLevel) maps ${t.what} to the custom field "${field}", whose type ${t.target.dataType} cannot receive it. ${NEEDS[t.slot]}`,
      };
    }
  }
  return null;
}
