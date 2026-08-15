/**
 * CLI: reset the local SQLite database file, then migrate + seed fresh.
 * Refuses to run against Postgres (production safety).
 */
import { rmSync } from 'node:fs';
import { createDb, sqlitePathFromUrl } from '../client';
import { migrate } from '../migrate';
import { seed } from '../seed';
import { isPostgresUrl } from '@quill/config/env';

async function main() {
  const url = process.env.DATABASE_URL ?? 'file:./.data/dev.db';
  if (isPostgresUrl(url)) {
    console.error('[reset] refusing to reset a Postgres database. Drop/recreate it manually.');
    process.exitCode = 1;
    return;
  }
  const path = sqlitePathFromUrl(url);
  if (path !== ':memory:') {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        rmSync(path + suffix);
      } catch {
        /* file may not exist — fine */
      }
    }
    console.log(`[reset] removed ${path}`);
  }
  const db = await createDb(url);
  try {
    await migrate(db);
    const result = await seed(db);
    console.log(`[reset] fresh database ready. Form: ${result.formPath}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('[reset] failed:', err);
  process.exitCode = 1;
});
