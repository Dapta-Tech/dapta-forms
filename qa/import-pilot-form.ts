/**
 * Import a pilot-shaped (dapta_bookings `PublicFormConfig`) JSON file as a
 * Dapta Forms form. Translates the legacy shape into formConfig v1:
 * steps (+variants/conditions/personal-email branch), scoring ranges → outcomes
 * (+booking embeds +answer overrides), cover, reveal, partial submit, and the
 * hubspot destination (field/utm mappings).
 *
 * Run from the repo root (tsx lives in @quill/db):
 *   DATABASE_URL="file:./.data/qa.db" \
 *   pnpm --filter @quill/db exec tsx ../../qa/import-pilot-form.ts \
 *     --file ../../qa/fixtures/pilot-style-config.json --account acme --name "Pilot Lead Qualifier"
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb, getAccountByCode, createForm } from '../packages/db/src/index';
import { formConfigSchema } from '../packages/types/src/index';
import { normalizeConfig } from '../packages/engine/src/index';

type PilotStep = Record<string, any>;
type PilotConfig = Record<string, any>;

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function translateStep(s: PilotStep, pilot: PilotConfig, index: number): Record<string, unknown> {
  const key = s.field && s.field !== 'name' ? s.field : (s.id ?? `step_${index}`);
  const step: Record<string, unknown> = {
    key,
    type: s.type,
    question: s.question ?? '',
    required: s.required ?? false,
    flowGroup: s.flowGroup,
  };
  if (s.options) {
    step.options = s.options.map((o: any) => ({
      label: o.label,
      value: o.value,
      ...(o.points !== undefined ? { points: o.points } : {}),
      ...(o.icon ? { icon: o.icon } : {}),
    }));
  }
  if (s.type === 'slider') {
    if (s.min !== undefined) step.min = s.min;
    if (s.max !== undefined) step.max = s.max;
    if (s.step !== undefined) step.step = s.step;
    if (s.default !== undefined) step.default = s.default;
    if (s.sliderScoring) step.sliderScoring = s.sliderScoring;
    if (s.sliderLabelVariants) step.sliderLabelVariants = s.sliderLabelVariants;
  }
  if (s.type === 'name') {
    if (s.fields) step.fields = s.fields;
    // Pilot placeholders are a positional array; Forms keys them by field name.
    if (Array.isArray(s.placeholders) && Array.isArray(s.fields)) {
      step.placeholders = Object.fromEntries(
        s.fields.map((f: string, i: number) => [f, s.placeholders[i]]).filter(([, v]: any[]) => v != null),
      );
    } else if (s.placeholders && !Array.isArray(s.placeholders)) {
      step.placeholders = s.placeholders;
    }
  }
  if (s.questionField) {
    step.questionField = s.questionField;
    step.questionVariants = s.questionVariants ?? {};
  }
  if (s.showWhen) step.showWhen = { field: s.showWhen.field, values: s.showWhen.values };
  if (s.hideWhen) step.hideWhen = { field: s.hideWhen.field, values: s.hideWhen.values };
  if (s.validation?.corporateEmailOnly) step.corporateEmailOnly = true;
  // Pilot semantics: the website step only appears for personal-email respondents.
  if (key === 'website') step.showForPersonalEmailOnly = true;
  // Pilot disqualification: message step that skips booking = terminal step.
  if (s.type === 'message' && s.skipCalendly) step.terminal = true;
  return step;
}

function translate(pilot: PilotConfig): unknown {
  const steps = (pilot.steps ?? []).map((s: PilotStep, i: number) => translateStep(s, pilot, i));

  // Reveal: pilot triggers the matching loader after config-index `matchingAfterStep`.
  if (typeof pilot.matchingAfterStep === 'number') {
    const idx = pilot.matchingAfterStep - 1;
    if (steps[idx]) steps[idx].triggersReveal = true;
  }

  // Scoring ranges -> outcomes (sorted by minScore by the normalizer).
  const ranges: any[] = pilot.scoring?.ranges ?? [];
  const outcomes = ranges.map((r) => {
    const id = String(r.label ?? `range_${r.min}`).toLowerCase();
    const outcome: Record<string, unknown> = {
      id,
      label: r.label ?? id,
      minScore: r.min,
      ...(r.url ? { redirectUrl: r.url } : {}),
    };
    if (r.calendlyUrl) {
      outcome.booking = {
        provider: r.calendlyUrl.includes('calendly.com') ? 'calendly' : 'hubspot_meetings',
        url: r.calendlyUrl,
        prefill: true,
      };
    }
    return outcome;
  });

  // Pilot hard rules → outcome overrides on the lowest bucket (P0):
  //   - disqualifying answer (problema = ninguna)
  //   - zero inbound leads forces P0 regardless of score
  const p0 = outcomes.find((o) => o.id === 'p0') ?? outcomes[outcomes.length - 1];
  if (p0) {
    const overrides: Record<string, unknown>[] = [];
    const disqualifier = (pilot.steps ?? []).find((s: PilotStep) => s.type === 'message' && s.skipCalendly);
    if (disqualifier?.showWhen) {
      overrides.push({ field: disqualifier.showWhen.field, values: disqualifier.showWhen.values });
    }
    const slider = (pilot.steps ?? []).find((s: PilotStep) => s.type === 'slider');
    if (slider) overrides.push({ field: slider.field ?? slider.id, maxValue: 0 });
    if (overrides.length) p0.overrides = overrides;
  }

  const destinations: unknown[] = [];
  if (pilot.hubspotEnabled && pilot.hubspotMapping) {
    // Pilot maps field->property; Forms maps stepKey->property (keys above reuse pilot fields).
    destinations.push({
      type: 'hubspot',
      enabled: true,
      settings: { note: true },
      fieldMappings: pilot.hubspotMapping,
      utmMappings: pilot.utmTracking ?? {},
      outcomeProperty: 'lead_qualification_bucket',
      inferCompanyFromEmail: true,
    });
  }

  return {
    version: 1,
    branding: pilot.branding?.primaryColor ? { primaryColor: pilot.branding.primaryColor } : undefined,
    cover: pilot.cover
      ? {
          enabled: pilot.cover.enabled !== false,
          bannerText: pilot.cover.bannerText,
          badge: pilot.cover.badge,
          headline: pilot.cover.title ?? pilot.cover.headline,
          subheadline: pilot.cover.subheadline,
          ctaText: pilot.cover.ctaText,
        }
      : undefined,
    steps,
    scoring: { enabled: true },
    outcomes,
    reveal:
      typeof pilot.matchingAfterStep === 'number'
        ? {
            enabled: true,
            headline: 'Finding your best match…',
            durationMs: 5000,
            subtitleTemplate: 'Matching an advisor for [industry]',
            prewarm: true,
          }
        : undefined,
    partialSubmitAfterStep: pilot.partialSubmitAfterStep,
    destinations,
  };
}

async function main() {
  const file = arg('--file', 'qa/fixtures/pilot-style-config.json')!;
  const accountCode = arg('--account', 'acme')!;
  const name = arg('--name', 'Pilot Lead Qualifier')!;

  const pilot = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const candidate = translate(pilot);
  const parsed = formConfigSchema.parse(candidate);
  const config = normalizeConfig(parsed);

  const db = await createDb();
  try {
    const account = await getAccountByCode(db, accountCode);
    if (!account) throw new Error(`account not found: ${accountCode}`);
    const created = await createForm(db, account.id, { name, config });
    if (!created.ok) throw new Error(`createForm failed: ${created.reason}`);
    console.log(`[import] created form "${name}" (${created.value.id})`);
    console.log(`[import] public path: /${accountCode}/me/${created.value.slug}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('[import] failed:', err);
  process.exit(1);
});
