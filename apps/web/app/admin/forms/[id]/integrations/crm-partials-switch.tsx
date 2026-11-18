'use client';

/**
 * The "send partial responses too" switch every CRM card carries (HubSpot,
 * Salesforce, and HighLevel when its card lands).
 *
 * The switch reads the destination's stored `events` through the same phase
 * rule the API delivers with (`destinationFiresForPhase`), so what it shows is
 * what a respondent's partial actually does: on for a HubSpot config with no
 * `events` (both phases, as before the switch existed), off for a Salesforce
 * or HighLevel one (complete only).
 *
 * Only a flip writes `events`, and always explicitly: on is both phases, off is
 * complete only. A card that is opened and never flipped keeps `events` exactly
 * as stored (absent stays absent), so a legacy config saves back unchanged.
 */
import type { FormsMessages } from '@quill/shared';
import { destinationFiresForPhase, type DestinationEvent } from '@quill/types';
import { Switch } from '@/components/ui/switch';

type Msgs = FormsMessages['admin']['integrations'];

/** The CRM kinds that carry the switch. */
export type CrmPartialsType = 'hubspot' | 'salesforce' | 'gohighlevel';

/** Whether a CRM destination with these stored `events` receives partials. */
export function crmSendsPartials(type: CrmPartialsType, events: DestinationEvent[] | undefined): boolean {
  return destinationFiresForPhase({ type, events }, 'partial');
}

/**
 * The `events` a flip of the switch stores. Explicit either way, so the
 * stored value never leans on a default that differs between kinds.
 */
export function crmEventsFor(sendPartials: boolean): DestinationEvent[] {
  return sendPartials ? ['partial', 'complete'] : ['complete'];
}

export function CrmPartialsSwitch({
  type,
  events,
  onChange,
  partialsHeld = false,
  warning,
  testId,
  m,
}: {
  type: CrmPartialsType;
  /** The destination's `events` as the card holds them (absent = its kind's default). */
  events: DestinationEvent[] | undefined;
  /** Called with the explicit `events` to store. */
  onChange: (events: DestinationEvent[]) => void;
  /** Spam protection holds the form's partials: none is sent meanwhile. */
  partialsHeld?: boolean;
  /** Shown under the switch while it is on (Salesforce's placeholder Lead). */
  warning?: string;
  /** Prefix for this card's test ids (`hubspot`, `salesforce`). */
  testId: string;
  m: Msgs;
}) {
  const on = crmSendsPartials(type, events);
  return (
    <div data-testid={`${testId}-partials`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium">{m.crmPartials}</label>
            {/* The switch stays as saved (switching protection off restores
                it); what changes is that nothing partial is sent meanwhile.
                Same badge as the webhook's Partial trigger. */}
            {partialsHeld && on ? (
              <span
                data-testid={`${testId}-partials-held`}
                className="rounded-full bg-secondary/15 px-2 py-0.5 text-xs font-medium text-secondary"
              >
                {m.eventPartialHeld}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{m.crmPartialsHelp}</p>
        </div>
        <Switch
          checked={on}
          data-testid={`${testId}-partials-switch`}
          onCheckedChange={(next) => onChange(crmEventsFor(next))}
          aria-label={m.crmPartials}
        />
      </div>
      {on && warning ? (
        <p
          data-testid={`${testId}-partials-warning`}
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <i aria-hidden className="pi pi-info-circle mt-px shrink-0" style={{ fontSize: 12 }} />
          {warning}
        </p>
      ) : null}
    </div>
  );
}
