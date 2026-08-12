/**
 * Which values a mapping may legally write to HubSpot — the join between the
 * live property list and what this form's mapping actually targets.
 *
 * Pure functions, no React: the interesting part of the value pickers is this
 * resolution, and it is easier to be sure about it here than through a rendered
 * dropdown. The UI layer (`OptionValueField`) only decides between a `Select`
 * and an `Input` based on what these return.
 */

import type { HubSpotPropertyOption } from '@/lib/admin-api';

/**
 * The only part of a property these functions read. Structural on purpose: the
 * editor narrows its own `properties` prop, and nothing here needs `label` or
 * `type` — `options` being present IS "this is an enumeration".
 */
export interface PropertyWithOptions {
  name: string;
  options?: HubSpotPropertyOption[];
}

/** One mapping row as the editor holds it: a form step key → a contact property. */
export interface MappingPair {
  key: string;
  property: string;
}

/**
 * The allowed values of one property, or `undefined` when it is not an
 * enumeration (or is unknown to the picker — an author typing a property name
 * the portal has never heard of must keep a free-text box, not get an empty
 * dropdown they cannot escape).
 */
export function optionsForProperty(
  properties: readonly PropertyWithOptions[],
  name: string,
): HubSpotPropertyOption[] | undefined {
  const wanted = name.trim();
  if (!wanted) return undefined;
  const found = properties.find((p) => p.name === wanted);
  // `options` is omitted (never `[]`) by the API for non-enumeration properties.
  return found?.options?.length ? found.options : undefined;
}

/**
 * Every contact property this step key's answer is written to.
 *
 * A value map is keyed by QUESTION, but the property is on the mapping — and a
 * question may be mapped more than once (fan-out to `hs_role` AND `jobtitle`).
 * Blank properties are dropped; duplicates collapse, so mapping the same
 * question to the same property twice is one target, not two.
 */
export function targetPropertiesFor(
  fieldMappings: readonly MappingPair[],
  stepKey: string,
): string[] {
  const wanted = stepKey.trim();
  if (!wanted) return [];
  const out: string[] = [];
  for (const pair of fieldMappings) {
    if (pair.key !== wanted) continue;
    const prop = pair.property.trim();
    if (prop && !out.includes(prop)) out.push(prop);
  }
  return out;
}

/**
 * The values that are valid for EVERY target — an intersection, deliberately
 * not a union.
 *
 * The HubSpot adapter writes one translated value to all of a question's target
 * properties. Offering a value that only one of them accepts would therefore
 * guarantee a partial write: the sync succeeds for one property and HubSpot
 * rejects it for the other, which surfaces later as a contact that is half
 * updated. If any target is free-text (or unknown), there is no picklist to
 * intersect and the answer is `undefined` → the UI keeps its text box.
 *
 * Labels and order come from the FIRST target: they are the same value either
 * way, and a picklist's order carries meaning worth preserving.
 */
export function sharedOptionsFor(
  properties: readonly PropertyWithOptions[],
  targets: readonly string[],
): HubSpotPropertyOption[] | undefined {
  if (targets.length === 0) return undefined;
  const first = optionsForProperty(properties, targets[0]!);
  if (!first) return undefined;
  let shared = first;
  for (const target of targets.slice(1)) {
    const next = optionsForProperty(properties, target);
    if (!next) return undefined;
    const allowed = new Set(next.map((o) => o.value));
    shared = shared.filter((o) => allowed.has(o.value));
    // Nothing writable to all of them — a text box is the only honest control.
    if (shared.length === 0) return undefined;
  }
  return shared;
}

/**
 * Does this stored value need the "custom value" escape hatch?
 *
 * A config written before the picker existed (or against a property whose
 * options have since changed) holds a value that is not in the list. Rendering
 * it in a `Select` would show an empty box — the value would look unset while
 * still being saved and still being written to HubSpot. So a non-matching
 * non-empty value opens the control in text mode, showing exactly what is
 * configured. Empty is not "unrecognised", it is unset.
 */
export function isCustomValue(
  options: readonly HubSpotPropertyOption[] | undefined,
  value: string,
): boolean {
  if (!options || value === '') return false;
  return !options.some((o) => o.value === value);
}
