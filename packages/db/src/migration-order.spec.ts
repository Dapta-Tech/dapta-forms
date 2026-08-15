/**
 * How the migrator decides what has run — the contract behind numbered files.
 *
 * Migrations arrive from parallel branches, so numbers are claimed before they
 * merge and they do not merge in order. That is safe here, and these pin why:
 * application is tracked by FILENAME, not by a high-water mark, so a gap in the
 * numbering is not a hole to be filled and a lower-numbered file that lands
 * later still applies on its own.
 *
 * Concretely: `0016_member_profile_revision.sql` adds a member column and has no
 * dependency on the `0015` slot, which belongs to a separate account-integration
 * change on another branch. Either can be applied first, or alone.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';

let db: Db;
let root: string;
let dir: string;

const write = (name: string, body: string): void => writeFileSync(join(dir, name), body, 'utf8');

/** Only the scratch files — the real ones are already recorded. */
const appliedNames = async (): Promise<string[]> => {
  const rows = await db.all<{ name: string }>(
    sql`SELECT name FROM _migrations WHERE name LIKE '%scratch%' ORDER BY name`,
  );
  return rows.map((r) => r.name);
};

beforeEach(async () => {
  db = await createDb('file::memory:');
  // Start from the real schema, applied by the real migrator, so these tests
  // measure ORDERING against the code that actually ships. The scratch set
  // below then exercises arrival order on top of it.
  await migrate(db);
  root = mkdtempSync(join(tmpdir(), 'quill-migrations-'));
  dir = join(root, db.dialect);
  mkdirSync(dir, { recursive: true });
});

afterEach(async () => {
  await db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('migration application is tracked by name', () => {
  it('records each file by filename, not by a highest-number watermark', async () => {
    write('0001_scratch_first.sql', 'CREATE TABLE scratch_a (id TEXT);');
    write('0003_scratch_third.sql', 'CREATE TABLE scratch_c (id TEXT);');

    expect(await migrate(db, root)).toEqual(['0001_scratch_first.sql', '0003_scratch_third.sql']);
    expect(await appliedNames()).toEqual(['0001_scratch_first.sql', '0003_scratch_third.sql']);
  });

  it('allows numeric gaps: a missing number is not a missing migration', async () => {
    write('0001_scratch_first.sql', 'CREATE TABLE scratch_a (id TEXT);');
    write('0003_scratch_third.sql', 'CREATE TABLE scratch_c (id TEXT);');
    await migrate(db, root);

    // Nothing is waiting for 0002 to show up.
    expect(await migrate(db, root)).toEqual([]);
  });

  it('applies a lower-numbered file that arrives later, on its own', async () => {
    // This is the merge order these branches actually produce: the higher number
    // lands first, and the other branch's file appears afterwards.
    await db.execRaw('CREATE TABLE scratch_high (id TEXT); CREATE TABLE scratch_low (id TEXT);');
    write('0016_scratch_higher.sql', 'ALTER TABLE scratch_high ADD COLUMN x TEXT;');
    expect(await migrate(db, root)).toEqual(['0016_scratch_higher.sql']);

    write('0015_scratch_lower.sql', 'ALTER TABLE scratch_low ADD COLUMN y TEXT;');

    // It applies independently, and does not re-run the one already recorded.
    expect(await migrate(db, root)).toEqual(['0015_scratch_lower.sql']);
    expect(await appliedNames()).toEqual(['0015_scratch_lower.sql', '0016_scratch_higher.sql']);
  });

  it('never applies the same file twice', async () => {
    write('0001_scratch_first.sql', 'CREATE TABLE scratch_a (id TEXT);');
    await migrate(db, root);

    // A second run would fail outright on the CREATE if the name check did not
    // hold, so a clean empty list is the assertion.
    expect(await migrate(db, root)).toEqual([]);
  });
});

describe('the shipped 0016 stands alone', () => {
  it('only touches member.profile_revision, so no other numbered change gates it', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sqlText = readFileSync(
      fileURLToPath(new URL('../migrations/sqlite/0016_member_profile_revision.sql', import.meta.url)),
      'utf8',
    );
    const pg = readFileSync(
      fileURLToPath(
        new URL('../migrations/postgres/0016_member_profile_revision.sql', import.meta.url),
      ),
      'utf8',
    );

    for (const text of [sqlText, pg]) {
      const statements = text
        .split('\n')
        .filter((line) => !line.trim().startsWith('--') && line.trim() !== '');
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/ALTER TABLE member ADD COLUMN/);
      expect(statements[0]).toContain('profile_revision');
      // No dependency on the account-integration work that owns the 0015 slot.
      expect(text).not.toMatch(/account_integration/);
    }
  });
});
