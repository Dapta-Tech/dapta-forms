/**
 * "At most one HubSpot destination per form", on every path that can WRITE a
 * destinations array, end to end on in-memory SQLite through the real
 * controllers → AuthService → db.
 *
 * A second HubSpot destination is a trap, not a feature: the Connect screen and
 * the booking flow both resolve `destinations.find(type === 'hubspot')`, so the
 * second one is invisible in the admin AND silently does nothing when a meeting
 * is booked — while still running at submit time. Forms carrying two came from
 * the era when a field mapping was one question → one property; a mapping now
 * fans out, so the workaround has no remaining use case.
 *
 * What this locks down:
 *
 *   1. PUT /v1/forms/:id/destinations refuses a second HubSpot entry (400);
 *   2. POST /v1/forms refuses one in the initial `config` — the OTHER path a
 *      destinations array reaches the row through (PUT /v1/forms/:id stages a
 *      draft, and drafts strip the key entirely);
 *   3. several WEBHOOKS stay legal — the rule is about HubSpot only;
 *   4. **reads stay tolerant.** A form that ALREADY stores two must keep
 *      parsing and keep being editable, or the rule would brick exactly the
 *      forms it exists to fix. This is why the check is a write-path guard and
 *      not a `formConfigSchema` refinement.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  getFormById,
  listForms,
  updateForm,
  type Db,
} from '@quill/db';
import { formConfigSchema, ONE_HUBSPOT_DESTINATION_MESSAGE } from '@quill/types';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { FormDestinationsController } from './integrations.controller';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';
import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

/** The local stub resolves the seeded owner with no header at all. */
const asOwner = (): ReqLike => ({ headers: {} });

const HUBSPOT = { type: 'hubspot', enabled: true, settings: {} };
const webhook = (url: string) => ({ type: 'webhook', enabled: true, settings: { url } });

describe('one HubSpot destination per form', () => {
  let db: Db;
  let destinations: FormDestinationsController;
  let forms: AdminCrudController;
  let accountId: string;
  let formId: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const account = await getAccountByCode(db, 'acme');
    accountId = account!.id;
    formId = (await listForms(db, accountId)).find((f) => f.slug === 'lead-qualifier')!.id;

    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    const auth = new AuthService(db, provider);
    destinations = new FormDestinationsController(db, auth);
    forms = new AdminCrudController(
      db,
      auth,
      new AdminService(db),
      // Nothing in this spec submits or notifies — the log-only notifier is
      // enough to satisfy the constructor.
      new SubmissionService(db, new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db)),
      new AnalyticsService(db),
    );
  });

  afterEach(async () => {
    await db.close();
  });

  // --- PUT /v1/forms/:id/destinations ---------------------------------------

  it('refuses a second HubSpot destination with a message that says what to do instead', async () => {
    await expect(
      destinations.putDestinations(asOwner(), formId, {
        destinations: [HUBSPOT, { ...HUBSPOT, fieldMappings: { problem: 'goal_ai_agent' } }],
      }),
    ).rejects.toThrow(BadRequestException);

    // The refusal must name the fan-out alternative — an author who hits this
    // is trying to write a second property from one question.
    await destinations
      .putDestinations(asOwner(), formId, { destinations: [HUBSPOT, HUBSPOT] })
      .catch((err: BadRequestException) => {
        expect((err.getResponse() as { message: string }).message).toBe(
          ONE_HUBSPOT_DESTINATION_MESSAGE,
        );
      });

    // Nothing was written.
    const form = await getFormById(db, accountId, formId);
    const stored = (form!.config as { destinations?: unknown[] }).destinations ?? [];
    expect(stored.filter((d) => (d as { type: string }).type === 'hubspot')).toHaveLength(0);
  });

  it('accepts exactly one HubSpot destination, fanning out from one question', async () => {
    const out = await destinations.putDestinations(asOwner(), formId, {
      destinations: [
        { ...HUBSPOT, fieldMappings: { problem: ['typeform_use_case', 'goal_ai_agent'] } },
      ],
    });
    const stored = (out.config as { destinations: Array<{ type: string; fieldMappings: unknown }> })
      .destinations;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.fieldMappings).toEqual({
      problem: ['typeform_use_case', 'goal_ai_agent'],
    });
  });

  it('accepts one HubSpot alongside several webhooks — the rule is HubSpot-only', async () => {
    const out = await destinations.putDestinations(asOwner(), formId, {
      destinations: [
        webhook('https://a.example.com/hook'),
        HUBSPOT,
        webhook('https://b.example.com/hook'),
      ],
    });
    expect((out.config as { destinations: unknown[] }).destinations).toHaveLength(3);
  });

  it('accepts zero destinations (clearing the tab)', async () => {
    const out = await destinations.putDestinations(asOwner(), formId, { destinations: [] });
    expect((out.config as { destinations: unknown[] }).destinations).toHaveLength(0);
  });

  // --- POST /v1/forms --------------------------------------------------------

  it('refuses two HubSpot destinations in a created form\'s config', async () => {
    await expect(
      forms.createForm(asOwner(), {
        name: 'Two CRMs',
        config: { version: 1, steps: [], destinations: [HUBSPOT, HUBSPOT] },
      }),
    ).rejects.toThrow(BadRequestException);

    expect((await listForms(db, accountId)).some((f) => f.name === 'Two CRMs')).toBe(false);
  });

  it('creates a form carrying one HubSpot destination', async () => {
    const created = await forms.createForm(asOwner(), {
      name: 'One CRM',
      config: { version: 1, steps: [], destinations: [HUBSPOT] },
    });
    expect((created.config as { destinations: unknown[] }).destinations).toHaveLength(1);
  });

  // --- Reads stay tolerant ---------------------------------------------------

  // The rule exists to fix forms that already have two. If enforcing it broke
  // their parse, it would take the admin screen and every delivery down with it.
  it('a form that already stores two keeps parsing and stays editable', async () => {
    await updateForm(db, accountId, formId, {
      config: { version: 1, steps: [], destinations: [HUBSPOT, HUBSPOT] },
    });

    const stored = await getFormById(db, accountId, formId);
    expect(formConfigSchema.safeParse(stored!.config).success).toBe(true);

    // And the fix itself — saving the Connect tab down to one — goes through.
    const out = await destinations.putDestinations(asOwner(), formId, {
      destinations: [{ ...HUBSPOT, fieldMappings: { problem: ['a', 'b'] } }],
    });
    expect((out.config as { destinations: unknown[] }).destinations).toHaveLength(1);
  });
});
