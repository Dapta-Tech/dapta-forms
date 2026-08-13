/**
 * The mirror form's guid is the API's, not the caller's.
 *
 * `formGuid` and `formSignature` are bookkeeping the server writes for itself:
 * which form in the portal represents this Dapta form, and what it was built
 * from. They travel in the same `settings` object as the author's own switches
 * only because that is where the schema puts them — and the save used to read
 * them straight out of the request body.
 *
 * That made a duplicate factory. A client that did not echo the guid back sent
 * settings with none, so there was no form to PATCH and no signature to compare
 * against: every save POSTed a NEW form and abandoned the previous one, which by
 * then held "Form submission" activities on real contacts. The Connect tab is
 * exactly that client — it autosaves per keystroke and never learns the guid,
 * because the save action returns `{ok, formActivityError}` and drops the config
 * the API just wrote. One editing session with the switch on was one new form in
 * the portal per debounce, all identically named, with the contact timeline
 * split across them.
 *
 * Fixing it in the editor would have fixed one caller. Sourcing the two keys
 * from the STORED row fixes every caller there will ever be, so that is what
 * these tests pin: the request's copy is ignored, on every path, including the
 * ones that make no HubSpot call at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import type { ServerEnv } from '@quill/config/env';
import { FormDestinationsController } from './integrations.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

const asOwner = (): ReqLike => ({ headers: {} });

const FORMS_URL = 'https://api.hubapi.com/marketing/v3/forms';
const STORED_GUID = 'stored-guid-1';

interface Call {
  url: string;
  method: string;
}

let db: Db;
let controller: FormDestinationsController;
let accountId: string;
let formId: string;
let calls: Call[];

/** Answers every HubSpot call with a created/updated form, recording the shape. */
function hubspotFetch(newId = 'fresh-guid'): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    // PATCH keeps the id it was called on; POST mints a new one — the same
    // distinction the portal makes, and the one the whole bug turned on.
    const id = init?.method === 'PATCH' ? url.slice(url.lastIndexOf('/') + 1) : newId;
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/** The HubSpot destination as the Connect tab sends it: no guid, no signature. */
function fromEditor(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'hubspot',
    enabled: true,
    settings: { note: true, formActivity: true },
    fieldMappings: { contact_email: 'email', first: 'firstname' },
    ...over,
  };
}

/** Put a mirror already in place, below the controller. */
async function storeMirror(settings: Record<string, unknown>): Promise<void> {
  await updateForm(db, accountId, formId, {
    config: {
      version: 1,
      steps: [],
      destinations: [
        {
          type: 'hubspot',
          enabled: true,
          settings,
          fieldMappings: { contact_email: 'email', first: 'firstname' },
        },
      ],
    },
  });
}

/** The HubSpot settings a form has stored right now. */
async function storedSettings(): Promise<Record<string, unknown>> {
  const form = await getFormById(db, accountId, formId);
  const destinations =
    (form!.config as { destinations?: Record<string, unknown>[] }).destinations ?? [];
  return (destinations.find((d) => d.type === 'hubspot')?.settings ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  accountId = (await getAccountByCode(db, 'acme'))!.id;
  formId = (await listForms(db, accountId)).find((f) => f.slug === 'lead-qualifier')!.id;
  calls = [];

  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  // The server token is enough to reach HubSpot — this spec is about which guid
  // the sync uses, not about where the credential came from.
  const env = {
    NODE_ENV: 'test',
    FORMS_ENCRYPTION_KEY: undefined,
    HUBSPOT_PRIVATE_APP_TOKEN: 'server-token',
  } as unknown as ServerEnv;
  controller = new FormDestinationsController(db, new AuthService(db, provider), env);
  controller.fetchImpl = hubspotFetch();
});

afterEach(async () => {
  await db.close();
});

describe('the mirror guid comes from the stored row', () => {
  it('PATCHES the stored form when the caller sends no guid', async () => {
    await storeMirror({ note: true, formActivity: true, formGuid: STORED_GUID });

    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor()] });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toBe(`${FORMS_URL}/${STORED_GUID}`);
    expect((await storedSettings()).formGuid).toBe(STORED_GUID);
  });

  it('makes NO HubSpot call when the stored signature already matches', async () => {
    // The common path, and the one the bug destroyed: with no guid in the body
    // the short-circuit could never fire, so every autosave hit the portal.
    const first = await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor()],
    });
    expect(first).toBeTruthy();
    const afterCreate = calls.length;

    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor()] });

    expect(calls).toHaveLength(afterCreate);
  });

  it('creates ONE form across a burst of saves, not one per save', async () => {
    // A stand-in for the debounced autosave: same payload, three times.
    for (let i = 0; i < 3; i++) {
      await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor()] });
    }
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect((await storedSettings()).formGuid).toBe('fresh-guid');
  });

  it('PATCHES rather than creating when the mapping changes', async () => {
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor()] });
    calls = [];

    await controller.putDestinations(asOwner(), formId, {
      destinations: [
        fromEditor({ fieldMappings: { contact_email: 'email', first: 'firstname', role: 'jobtitle' } }),
      ],
    });

    expect(calls.map((c) => c.method)).toEqual(['PATCH']);
    expect((await storedSettings()).formGuid).toBe('fresh-guid');
  });

  it('IGNORES a guid the caller invented for a form that has none', async () => {
    // The failure worth being explicit about: a body-supplied guid could point
    // one account's form at another account's mirror.
    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor({ settings: { formActivity: true, formGuid: 'someone-elses' } })],
    });

    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(FORMS_URL);
    expect((await storedSettings()).formGuid).toBe('fresh-guid');
  });

  it('IGNORES a guid the caller invented for a form that already has one', async () => {
    await storeMirror({ note: true, formActivity: true, formGuid: STORED_GUID });

    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor({ settings: { formActivity: true, formGuid: 'someone-elses' } })],
    });

    expect(calls[0]!.url).toBe(`${FORMS_URL}/${STORED_GUID}`);
    expect((await storedSettings()).formGuid).toBe(STORED_GUID);
  });

  it('discards a caller-supplied SIGNATURE, so a lie cannot skip the sync', async () => {
    // Claiming to be in step is the cheap way to leave a stale form in place.
    await storeMirror({ note: true, formActivity: true, formGuid: STORED_GUID });

    await controller.putDestinations(asOwner(), formId, {
      destinations: [
        fromEditor({
          settings: { formActivity: true, formSignature: 'whatever the caller says' },
          fieldMappings: { contact_email: 'email', role: 'jobtitle' },
        }),
      ],
    });

    expect(calls).toHaveLength(1);
    const stored = await storedSettings();
    expect(stored.formSignature).not.toBe('whatever the caller says');
    expect(stored.formGuid).toBe(STORED_GUID);
  });
});

describe('the guid survives edits that are not about it', () => {
  it('keeps the guid when the activity is switched OFF', async () => {
    // Documented intent: turning the switch off STOPS posting without destroying
    // the form, whose past submissions are activities on real contacts. Returning
    // the caller's entry untouched on the `noop` path dropped it instead.
    await storeMirror({ note: true, formActivity: true, formGuid: STORED_GUID });

    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor({ settings: { note: true, formActivity: false } })],
    });

    expect(calls).toHaveLength(0);
    const stored = await storedSettings();
    expect(stored.formGuid).toBe(STORED_GUID);
    expect(stored.formActivity).toBe(false);
  });

  it('reuses the same form when the activity is switched back ON', async () => {
    await storeMirror({ note: true, formActivity: true, formGuid: STORED_GUID });
    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor({ settings: { formActivity: false } })],
    });
    calls = [];

    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor()] });

    expect(calls.map((c) => c.method)).toEqual(['PATCH']);
    expect((await storedSettings()).formGuid).toBe(STORED_GUID);
  });

  it('keeps the guid when a WEBHOOK is the only thing being edited', async () => {
    await storeMirror({ note: true, formActivity: true, formGuid: STORED_GUID });

    await controller.putDestinations(asOwner(), formId, {
      destinations: [
        { type: 'webhook', enabled: true, settings: { url: 'https://example.com/hook' } },
        fromEditor(),
      ],
    });

    expect((await storedSettings()).formGuid).toBe(STORED_GUID);
  });

  it('leaves the author-owned settings exactly as the caller sent them', async () => {
    // The fix replaces two keys and must not become a merge of everything else —
    // an author turning the note off has to see it turn off.
    await storeMirror({ note: true, formActivity: true, formGuid: STORED_GUID });

    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor({ settings: { note: false, formActivity: true } })],
    });

    expect((await storedSettings()).note).toBe(false);
  });
});
