/**
 * Renaming a form's public URL.
 *
 * The feature is one UPDATE; the reason it needs a suite is everything that
 * must NOT happen alongside it. A slug is a public address, so retiring one
 * cannot break the links already carrying it, cannot hand the address to a
 * different form, and cannot silently drop the form off the member pages that
 * list it by slug.
 *
 * Defaults to a temp SQLite file; CI runs the identical assertions against
 * DATABASE_URL on Postgres.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { createForm, deleteForm, getPublishedForm, setFormSlug } from './forms';

let db: Db;
let accountId: string;
let accountCode: string;
let sqliteDir: string | undefined;

async function newForm(name: string): Promise<{ id: string; slug: string }> {
  const created = await createForm(db, accountId, { name });
  if (!created.ok) throw new Error(`fixture form "${name}" failed: ${created.reason}`);
  return { id: created.value.id, slug: created.value.slug };
}

async function aliasesOf(formId: string): Promise<string[]> {
  const rows = await db.all<{ alias: string }>(
    sql`SELECT alias FROM form_alias WHERE account_id = ${accountId} AND form_id = ${formId} ORDER BY alias`,
  );
  return rows.map((r) => String(r.alias));
}

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-form-rename-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');

  db = await createDb(databaseUrl);
  await migrate(db);

  accountId = randomUUID();
  accountCode = `r${accountId.slice(0, 8)}`;
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${accountCode}, ${'Rename'}, ${Date.now()})`,
  );
});

afterEach(async () => {
  if (db) {
    await db.run(sql`DELETE FROM form_alias WHERE account_id = ${accountId}`);
    await db.run(sql`DELETE FROM form WHERE account_id = ${accountId}`);
    await db.run(sql`DELETE FROM member WHERE account_id = ${accountId}`);
    await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  }
  await db?.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

describe('setFormSlug', () => {
  it('renames the form and keeps the old slug resolving to it', async () => {
    const form = await newForm('Lead qualifier');

    const renamed = await setFormSlug(db, accountId, form.id, 'talk-to-sales');
    expect(renamed).toMatchObject({ ok: true, value: { slug: 'talk-to-sales' } });

    const viaNew = await getPublishedForm(db, accountCode, 'talk-to-sales');
    expect(viaNew?.id).toBe(form.id);

    // The whole point: the printed QR code still lands on the form.
    const viaOld = await getPublishedForm(db, accountCode, form.slug);
    expect(viaOld?.id).toBe(form.id);
    // And it reports the CANONICAL slug, which is what the public page compares
    // against to decide whether to redirect.
    expect(viaOld?.slug).toBe('talk-to-sales');
  });

  it('keeps every slug in a rename chain alive', async () => {
    const form = await newForm('Contact');
    await setFormSlug(db, accountId, form.id, 'contact-us');
    await setFormSlug(db, accountId, form.id, 'say-hello');

    expect(await aliasesOf(form.id)).toEqual(['contact', 'contact-us']);
    for (const slug of ['contact', 'contact-us', 'say-hello']) {
      expect((await getPublishedForm(db, accountCode, slug))?.id).toBe(form.id);
    }
  });

  it('drops the alias row when a form re-claims one of its own old slugs', async () => {
    const form = await newForm('Contact');
    await setFormSlug(db, accountId, form.id, 'contact-us');
    const back = await setFormSlug(db, accountId, form.id, 'contact');

    expect(back).toMatchObject({ ok: true, value: { slug: 'contact' } });
    // `contact` is canonical again, so an alias row for it would be dead weight
    // the resolver never consults. Only the slug it just left is retired.
    expect(await aliasesOf(form.id)).toEqual(['contact-us']);
  });

  it('refuses a slug another form holds', async () => {
    const first = await newForm('Pricing');
    const second = await newForm('Demo');

    expect(await setFormSlug(db, accountId, second.id, first.slug)).toMatchObject({
      ok: false,
      reason: 'SLUG_TAKEN',
    });
  });

  it('refuses a slug another form RETIRED', async () => {
    const first = await newForm('Pricing');
    await setFormSlug(db, accountId, first.id, 'plans');
    const second = await newForm('Demo');

    // Allowing this would point every link already published for `pricing` at
    // somebody else's form: the direct match wins over the alias.
    expect(await setFormSlug(db, accountId, second.id, 'pricing')).toMatchObject({
      ok: false,
      reason: 'SLUG_TAKEN',
    });
    expect((await getPublishedForm(db, accountCode, 'pricing'))?.id).toBe(first.id);
  });

  it('refuses a malformed slug without touching the form', async () => {
    const form = await newForm('Lead qualifier');

    for (const bad of ['Talk To Sales', 'talk--to-sales', '-leading', 'trailing-', 'x'.repeat(81)]) {
      expect(await setFormSlug(db, accountId, form.id, bad)).toMatchObject({
        ok: false,
        reason: 'SLUG_INVALID',
      });
    }
    expect((await getPublishedForm(db, accountCode, form.slug))?.slug).toBe(form.slug);
    expect(await aliasesOf(form.id)).toEqual([]);
  });

  it('treats a rename to the current slug as a no-op success', async () => {
    const form = await newForm('Lead qualifier');

    expect(await setFormSlug(db, accountId, form.id, form.slug)).toMatchObject({
      ok: true,
      value: { slug: form.slug },
    });
    // No self-alias: the resolver would never read it, and `formSlugInUse`
    // would then report the form's own live slug as spoken for.
    expect(await aliasesOf(form.id)).toEqual([]);
  });

  it('is NOT_FOUND for a form in another account', async () => {
    const other = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${other}, ${`z${other.slice(0, 8)}`}, ${'Other'}, ${Date.now()})`,
    );
    const form = await newForm('Lead qualifier');

    expect(await setFormSlug(db, other, form.id, 'stolen')).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    await db.run(sql`DELETE FROM account WHERE id = ${other}`);
  });

  it('follows the rename into the member pages that list the form', async () => {
    // Cosmetic, not load-bearing: what keeps the form ON the page is the read
    // path resolving retired slugs (see `public-profile.spec.ts`). This only
    // keeps the public-page EDITOR showing a checked box rather than an entry
    // it no longer recognizes, which is why it is allowed to lose a race.
    const form = await newForm('Lead qualifier');
    const memberId = randomUUID();
    await db.run(
      sql`INSERT INTO member (id, account_id, email, display_name, handle, role, created_at)
          VALUES (${memberId}, ${accountId}, ${'a@example.test'}, ${'A'}, ${'a'}, ${'owner'}, ${Date.now()})`,
    );
    await db.run(
      sql`UPDATE member SET profile = ${JSON.stringify({
        version: 1,
        enabled: true,
        formSlugs: [form.slug, 'something-else'],
      })} WHERE id = ${memberId}`,
    );

    await setFormSlug(db, accountId, form.id, 'talk-to-sales');

    const row = await db.get<{ profile: unknown }>(sql`SELECT profile FROM member WHERE id = ${memberId}`);
    const profile =
      typeof row?.profile === 'string' ? JSON.parse(row.profile) : (row?.profile as Record<string, unknown>);
    // The stored selection follows the rename, so the editor's checkbox for
    // this form stays checked.
    expect(profile.formSlugs).toEqual(['talk-to-sales', 'something-else']);
  });
});

describe('slug allocation around retired slugs', () => {
  it('does not hand a new form a slug another form retired', async () => {
    const first = await newForm('Contact');
    await setFormSlug(db, accountId, first.id, 'contact-us');

    const second = await newForm('Contact');

    expect(second.slug).toBe('contact-2');
    expect((await getPublishedForm(db, accountCode, 'contact'))?.id).toBe(first.id);
  });

  it("frees a deleted form's aliases", async () => {
    const first = await newForm('Contact');
    await setFormSlug(db, accountId, first.id, 'contact-us');
    await deleteForm(db, accountId, first.id);

    expect(await getPublishedForm(db, accountCode, 'contact')).toBeNull();
    const second = await newForm('Contact');
    expect(second.slug).toBe('contact');
  });
});
