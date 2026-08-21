/** CLI: apply pending migrations for the active DATABASE_URL. */
import { createDb } from '../client';
import { migrate } from '../migrate';
import { withDb } from './with-db';

async function main() {
  const db = await createDb();
  await withDb('migrate', db, async () => {
    const applied = await migrate(db);
    if (applied.length === 0) {
      console.log(`[migrate] up to date (${db.dialect})`);
    } else {
      console.log(`[migrate] applied ${applied.length} migration(s) on ${db.dialect}:`);
      for (const name of applied) console.log(`  - ${name}`);
    }
  });
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exitCode = 1;
});
