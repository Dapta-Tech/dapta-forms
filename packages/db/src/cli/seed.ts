/** CLI: seed demo data (idempotent). Runs migrations first for convenience. */
import { createDb } from '../client';
import { migrate } from '../migrate';
import { seed } from '../seed';

async function main() {
  const db = await createDb();
  try {
    await migrate(db);
    const result = await seed(db);
    console.log(`[seed] done (${db.dialect}). Try the form at:`);
    console.log(`  ${result.formPath}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exitCode = 1;
});
