import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { createTeam, addTeamMember, removeTeamMember, updateTeamMemberRole } from './crud';

describe('team owner-protection (F14/DL6)', () => {
  let db: Db;
  let accountId: string;
  let m1: string;
  let m2: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    const members = await db.all<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} ORDER BY created_at ASC LIMIT 2`,
    );
    m1 = members[0]!.id;
    m2 = members[1]!.id;
  });

  it('refuses to remove or demote the LAST owner, allows it once another owner exists', async () => {
    const team = await createTeam(db, accountId, { name: 'Crew', slug: 'crew' });
    if (!team.ok) throw new Error('setup');
    // Seed the sole owner (mirrors the controller adding the creator as owner).
    await addTeamMember(db, accountId, team.value.id, m1, 'owner');

    // Sole owner cannot be removed or demoted.
    const rm = await removeTeamMember(db, accountId, team.value.id, m1);
    expect(rm.ok).toBe(false);
    if (!rm.ok) expect(rm.reason).toBe('LAST_OWNER');
    const demote = await updateTeamMemberRole(db, accountId, team.value.id, m1, 'member');
    expect(demote.ok).toBe(false);

    // Add a second owner → now the first can be removed.
    await addTeamMember(db, accountId, team.value.id, m2, 'owner');
    const rm2 = await removeTeamMember(db, accountId, team.value.id, m1);
    expect(rm2.ok).toBe(true);
  });
});
