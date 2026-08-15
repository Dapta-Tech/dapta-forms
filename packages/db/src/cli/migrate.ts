/** CLI: apply pending migrations for the active DATABASE_URL. */
import { createDb } from '../client';
import { migrate } from '../migrate';

async function main() {
  const db = await createDb();
  try {
    const applied = await migrate(db);
    if (applied.length === 0) {
      console.log(`[migrate] up to date (${db.dialect})`);
    } else {
      console.log(`[migrate] applied ${applied.length} migration(s) on ${db.dialect}:`);
      for (const name of applied) console.log(`  - ${name}`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exitCode = 1;
});
