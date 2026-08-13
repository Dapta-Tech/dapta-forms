/**
 * Keeping the HubSpot mirror form in step with what a Dapta form writes.
 *
 * Two properties carry the design and are asserted hardest:
 *
 *  1. **A HubSpot failure never fails the save.** An author has to be able to
 *     edit their field mappings while the portal is unreachable or has not
 *     granted the scopes. Every failure comes back as a reason, never a throw.
 *  2. **The guid outlives the switch.** Turning the activity off stops posting;
 *     it does not delete the form, whose past submissions are activities on real
 *     contacts. Turning it back on reuses the same form.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FormDestination } from '@quill/types';
import { mirrorSignature, syncMirrorForm } from './hubspot-mirror';

const BASE = 'https://hs.test';
const NOW = () => new Date('2026-08-13T00:00:00.000Z');

const hubspot = (over: Record<string, unknown> = {}): FormDestination =>
  ({
    type: 'hubspot',
    enabled: true,
    fieldMappings: { work_email: 'email', role: 'jobtitle' },
    settings: { formActivity: true },
    ...over,
  }) as unknown as FormDestination;

/** A fetch that records its calls and answers with `reply`. */
function harness(reply: { status?: number; body?: unknown; throws?: boolean } = {}) {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    if (reply.throws) throw new Error('ECONNRESET');
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => reply.body ?? { id: 'guid-new' },
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const deps = (fetchImpl: typeof fetch, token: string | null = 'tok') => ({
  fetchImpl,
  token,
  baseUrl: BASE,
  now: NOW,
});

describe('syncMirrorForm — when it does nothing', () => {
  it('ignores a destination that is not HubSpot', async () => {
    const { calls, fetchImpl } = harness();
    const out = await syncMirrorForm(
      { type: 'webhook', enabled: true, settings: { url: 'https://a.test' } } as FormDestination,
      'Lead qualifier',
      deps(fetchImpl),
    );
    expect(out.action).toBe('noop');
    expect(calls).toHaveLength(0);
  });

  it('does not touch the portal while the switch is off', async () => {
    const { calls, fetchImpl } = harness();
    const out = await syncMirrorForm(
      hubspot({ settings: { formActivity: false, formGuid: 'guid-1' } }),
      'Lead qualifier',
      deps(fetchImpl),
    );
    expect(out.action).toBe('noop');
    expect(calls).toHaveLength(0);
  });

  it('KEEPS the guid when the switch is off, so re-enabling reuses the form', async () => {
    // Deleting it to represent "off" would erase activities on real contacts.
    const { fetchImpl } = harness();
    const out = await syncMirrorForm(
      hubspot({ settings: { formActivity: false, formGuid: 'guid-1', formSignature: 'sig' } }),
      'Lead qualifier',
      deps(fetchImpl),
    );
    expect(out.settings.formGuid).toBe('guid-1');
  });

  it('skips the portal entirely when nothing the mirror cares about changed', async () => {
    // The common path: the Connect tab autosaves, and most saves change
    // something — a redirect, a toggle — the mirror has no opinion about.
    const properties = ['email', 'jobtitle'];
    const { calls, fetchImpl } = harness();
    const out = await syncMirrorForm(
      hubspot({
        settings: {
          formActivity: true,
          formGuid: 'guid-1',
          formSignature: mirrorSignature('Lead qualifier', properties),
        },
      }),
      'Lead qualifier',
      deps(fetchImpl),
    );
    expect(out.action).toBe('unchanged');
    expect(calls).toHaveLength(0);
  });
});

describe('syncMirrorForm — creating and updating', () => {
  it('creates the form and hands back the guid to store', async () => {
    const { calls, fetchImpl } = harness({ body: { id: 'guid-new' } });
    const out = await syncMirrorForm(hubspot(), 'Lead qualifier', deps(fetchImpl));

    expect(out.action).toBe('created');
    expect(out.settings.formGuid).toBe('guid-new');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/marketing/v3/forms`);
    expect(calls[0]!.body.name).toBe('Lead qualifier (Dapta Forms)');
  });

  it('records the signature, so the next save is a no-op', async () => {
    const { fetchImpl } = harness();
    const out = await syncMirrorForm(hubspot(), 'Lead qualifier', deps(fetchImpl));
    expect(out.settings.formSignature).toBe(
      mirrorSignature('Lead qualifier', ['email', 'jobtitle']),
    );
  });

  it('PATCHES the existing form when the mapped properties change', async () => {
    const { calls, fetchImpl } = harness({ body: { id: 'guid-1' } });
    const out = await syncMirrorForm(
      hubspot({
        fieldMappings: { work_email: 'email', role: 'jobtitle', size: 'numemployees' },
        settings: {
          formActivity: true,
          formGuid: 'guid-1',
          formSignature: mirrorSignature('Lead qualifier', ['email', 'jobtitle']),
        },
      }),
      'Lead qualifier',
      deps(fetchImpl),
    );
    expect(out.action).toBe('updated');
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toBe(`${BASE}/marketing/v3/forms/guid-1`);
    const fields = (calls[0]!.body.fieldGroups as { fields: { name: string }[] }[]).flatMap(
      (g) => g.fields,
    );
    expect(fields.map((f) => f.name)).toContain('numemployees');
  });

  it('rebuilds when the FORM IS RENAMED — the name is what labels the activity', async () => {
    const { calls, fetchImpl } = harness({ body: { id: 'guid-1' } });
    const out = await syncMirrorForm(
      hubspot({
        settings: {
          formActivity: true,
          formGuid: 'guid-1',
          formSignature: mirrorSignature('Old name', ['email', 'jobtitle']),
        },
      }),
      'Lead qualifier',
      deps(fetchImpl),
    );
    expect(out.action).toBe('updated');
    expect(calls[0]!.body.name).toBe('Lead qualifier (Dapta Forms)');
  });
});

describe('syncMirrorForm — failure never costs the save', () => {
  it('reports a missing scope instead of throwing', async () => {
    const { fetchImpl } = harness({
      status: 403,
      body: { category: 'MISSING_SCOPES', message: "This app hasn't been granted all required scopes" },
    });
    const out = await syncMirrorForm(hubspot(), 'Lead qualifier', deps(fetchImpl));
    expect(out.action).toBe('failed');
    expect(out.error).toContain('scopes');
    // Nothing is stored, so the next save tries again.
    expect(out.settings.formGuid).toBeUndefined();
  });

  it('reports an unreachable portal instead of throwing', async () => {
    const { fetchImpl } = harness({ throws: true });
    const out = await syncMirrorForm(hubspot(), 'Lead qualifier', deps(fetchImpl));
    expect(out.action).toBe('failed');
    expect(out.error).toContain('Could not reach HubSpot');
  });

  it('reports a missing token instead of calling HubSpot with none', async () => {
    const { calls, fetchImpl } = harness();
    const out = await syncMirrorForm(hubspot(), 'Lead qualifier', deps(fetchImpl, null));
    expect(out.action).toBe('failed');
    expect(out.error).toContain('No HubSpot token');
    expect(calls).toHaveLength(0);
  });

  it('forgets a form the portal no longer has, so the next save recreates it', async () => {
    // The author did not delete it from here. Holding the dead guid forever
    // would leave the feature permanently broken for them.
    const { fetchImpl } = harness({ status: 404, body: { message: 'not found' } });
    const out = await syncMirrorForm(
      hubspot({ settings: { formActivity: true, formGuid: 'deleted-in-hubspot', formSignature: 'x' } }),
      'Lead qualifier',
      deps(fetchImpl),
    );
    expect(out.settings.formGuid).toBeNull();
    expect(out.settings.formSignature).toBeUndefined();
    expect(out.error).toContain('recreated');
  });

  it('does not store a guid HubSpot never returned', async () => {
    const { fetchImpl } = harness({ body: {} });
    const out = await syncMirrorForm(hubspot(), 'Lead qualifier', deps(fetchImpl));
    expect(out.action).toBe('failed');
    expect(out.settings.formGuid).toBeUndefined();
  });
});

describe('mirrorSignature', () => {
  it('ignores the ORDER properties happen to be mapped in', async () => {
    // Otherwise reordering a mapping in the editor would rebuild the form in
    // the portal for no reason.
    expect(mirrorSignature('F', ['email', 'jobtitle'])).toBe(
      mirrorSignature('F', ['jobtitle', 'email']),
    );
  });

  it('changes when the name or the properties do', () => {
    expect(mirrorSignature('F', ['email'])).not.toBe(mirrorSignature('G', ['email']));
    expect(mirrorSignature('F', ['email'])).not.toBe(mirrorSignature('F', ['email', 'x']));
  });
});

describe('the whole point', () => {
  it('builds a payload HubSpot accepts — createdAt at the root, validation only on email', async () => {
    // Measured against a real portal; re-derived here so a refactor of the
    // builder cannot quietly break the shape this endpoint demands.
    const { calls, fetchImpl } = harness();
    await syncMirrorForm(hubspot(), 'Lead qualifier', deps(fetchImpl));
    const body = calls[0]!.body as {
      createdAt?: string;
      formType?: string;
      fieldGroups: { fields: Record<string, unknown>[] }[];
    };
    expect(body.createdAt).toBe('2026-08-13T00:00:00.000Z');
    expect(body.formType).toBe('hubspot');
    const fields = body.fieldGroups.flatMap((g) => g.fields);
    const email = fields.find((f) => f.name === 'email')!;
    const other = fields.find((f) => f.name === 'jobtitle')!;
    expect(email.validation).toBeDefined();
    expect('validation' in other).toBe(false);
  });
});
