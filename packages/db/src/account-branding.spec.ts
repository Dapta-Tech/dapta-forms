/**
 * Workspace brand kit: storage round-trip + the snapshot apply/revert flow.
 * Honors DATABASE_URL like the submission-integrity spec so the Postgres parity
 * job exercises the same flow; locally it runs on in-memory SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  applyBrandKit,
  getAccountBranding,
  mergeKitIntoBranding,
  revertBrandKit,
  upsertAccountBranding,
} from './account-branding';
import { createForm, getFormById, listForms, publishForm, saveDraftConfig } from './forms';

const KIT = {
  logo: 'https://cdn.example.com/logo.png',
  primaryColor: '#ff5500',
  background: '#111111',
  foreground: '#fafafa',
  radius: 'round' as const,
  buttonStyle: 'outline' as const,
};

describe('account_branding repo', () => {
  let db: Db;
  let accountId: string;

  beforeEach(async () => {
    db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
    await migrate(db);
    accountId = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${accountId}, ${'t' + accountId.slice(0, 5)}, ${'Test'}, ${Date.now()})`,
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it('upsert round-trips and updates in place', async () => {
    expect(await getAccountBranding(db, accountId)).toBeNull();
    await upsertAccountBranding(db, accountId, KIT);
    expect((await getAccountBranding(db, accountId))!.config).toEqual(KIT);
    await upsertAccountBranding(db, accountId, { ...KIT, primaryColor: '#00ff00' });
    const row = await getAccountBranding(db, accountId);
    expect(row!.config.primaryColor).toBe('#00ff00');
  });

  it('mergeKitIntoBranding overwrites only kit fields and clears themePreset', () => {
    const merged = mergeKitIntoBranding(
      { primaryColor: '#123456', backgroundImage: 'https://x/img.png', themePreset: 'midnight' },
      KIT,
    );
    expect(merged.primaryColor).toBe('#ff5500'); // kit wins on a kit field
    expect(merged.backgroundImage).toBe('https://x/img.png'); // per-form field untouched
    expect(merged.radius).toBe('round');
    expect('themePreset' in merged).toBe(false);
  });

  it('apply merges into live config, backs up, and revert restores exactly', async () => {
    const created = await createForm(db, accountId, {
      name: 'F1',
      config: {
        version: 1,
        steps: [],
        branding: { primaryColor: '#0000ff', backgroundImage: 'https://x/bg.png' },
      },
    });
    const id = created.ok ? created.value.id : '';
    await upsertAccountBranding(db, accountId, KIT);

    const applied = await applyBrandKit(db, accountId, [id]);
    expect(applied.applied).toEqual([id]);

    let form = (await getFormById(db, accountId, id))!;
    let branding = (form.config as { branding: Record<string, unknown> }).branding;
    expect(branding.primaryColor).toBe('#ff5500');
    expect(branding.logo).toBe(KIT.logo);
    expect(branding.backgroundImage).toBe('https://x/bg.png'); // non-kit field survives
    expect(form.brandAppliedAt).toEqual(expect.any(Number));

    const summaries = await listForms(db, accountId);
    expect(summaries.find((s) => s.id === id)!.brandAppliedAt).toEqual(expect.any(Number));

    const reverted = await revertBrandKit(db, accountId, [id]);
    expect(reverted.reverted).toEqual([id]);
    form = (await getFormById(db, accountId, id))!;
    branding = (form.config as { branding: Record<string, unknown> }).branding;
    expect(branding.primaryColor).toBe('#0000ff'); // pre-apply value restored
    expect('logo' in branding).toBe(false); // field the form never had is gone again
    expect(branding.backgroundImage).toBe('https://x/bg.png');
    expect(form.brandAppliedAt).toBeNull();
  });

  it('apply patches a pending draft so publishing cannot undo the brand', async () => {
    const created = await createForm(db, accountId, {
      name: 'F2',
      config: { version: 1, steps: [], branding: { primaryColor: '#0000ff' } },
    });
    const id = created.ok ? created.value.id : '';
    await saveDraftConfig(db, accountId, id, {
      version: 1,
      steps: [],
      branding: { primaryColor: '#00aaaa' },
    });
    await upsertAccountBranding(db, accountId, KIT);
    await applyBrandKit(db, accountId, [id]);

    // Publish the draft that was pending at apply time — the brand must survive.
    await publishForm(db, accountId, id);
    const form = (await getFormById(db, accountId, id))!;
    const branding = (form.config as { branding: Record<string, unknown> }).branding;
    expect(branding.primaryColor).toBe('#ff5500');
  });

  it('re-apply keeps the ORIGINAL backup; revert returns to pre-brand state', async () => {
    const created = await createForm(db, accountId, {
      name: 'F3',
      config: { version: 1, steps: [], branding: { primaryColor: '#0000ff' } },
    });
    const id = created.ok ? created.value.id : '';
    await upsertAccountBranding(db, accountId, KIT);
    await applyBrandKit(db, accountId, [id]);
    // Second apply with a changed kit must not snapshot the first kit as "backup".
    await upsertAccountBranding(db, accountId, { ...KIT, primaryColor: '#333333' });
    await applyBrandKit(db, accountId, [id]);

    await revertBrandKit(db, accountId, [id]);
    const form = (await getFormById(db, accountId, id))!;
    const branding = (form.config as { branding: Record<string, unknown> }).branding;
    expect(branding.primaryColor).toBe('#0000ff');
  });

  it('apply and revert are account-scoped; revert without a backup is a no-op', async () => {
    const stranger = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${stranger}, ${'s' + stranger.slice(0, 5)}, ${'Other'}, ${Date.now()})`,
    );
    const theirs = await createForm(db, stranger, { name: 'Not yours' });
    const theirId = theirs.ok ? theirs.value.id : '';
    await upsertAccountBranding(db, accountId, KIT);

    expect((await applyBrandKit(db, accountId, [theirId])).applied).toEqual([]);
    expect((await revertBrandKit(db, accountId, [theirId])).reverted).toEqual([]);

    const mine = await createForm(db, accountId, { name: 'Mine' });
    const myId = mine.ok ? mine.value.id : '';
    expect((await revertBrandKit(db, accountId, [myId])).reverted).toEqual([]); // never applied
  });
});
