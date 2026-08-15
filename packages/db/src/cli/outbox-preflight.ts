/** CLI: fail deployment preflight when a live outbox lease remains. */
import { countLiveOutboxClaims } from '../outbox';
import { createDb } from '../client';

async function main() {
  const db = await createDb();
  const live = await countLiveOutboxClaims(db, Date.now());
  await db.close();
  console.log(`[outbox-preflight] live_claims=${live}`);
  if (live > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[outbox-preflight] failed:', err);
  process.exit(1);
});
