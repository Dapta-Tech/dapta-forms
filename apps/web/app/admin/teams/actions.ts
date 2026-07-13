'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { adminApi } from '@/lib/admin-api';

export type ActionResult = { ok: boolean; message?: string };

export interface TeamCreatePayload {
  name: string;
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  timeZone: string;
}

/** Dedicated create-page action: creates the team then redirects to its detail. */
export async function createTeamFullAction(p: TeamCreatePayload): Promise<ActionResult> {
  let id: string | undefined;
  try {
    const team = await adminApi.createTeam(p);
    id = team.id;
    revalidatePath('/admin/teams');
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Could not create the team.' };
  }
  redirect(`/admin/teams/${id}`);
}
/** Invite outcome carries a stable code so the client can localize the message. */
export type InviteResult = { ok: boolean; code?: 'INVALID_EMAIL' | 'NO_MATCH' | 'FAILED'; message?: string };

export async function deleteTeamAction(id: string): Promise<ActionResult> {
  try {
    await adminApi.deleteTeam(id);
    revalidatePath('/admin/teams');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    // Orphan guard (409: delete the team's event types first) etc.
    return { ok: false, message: e instanceof Error ? e.message : 'Could not delete the team.' };
  }
}

export async function addMemberAction(
  teamId: string,
  memberId: string,
  role: 'owner' | 'member' = 'member',
): Promise<ActionResult> {
  try {
    await adminApi.addTeamMember(teamId, { memberId, role });
    revalidatePath('/admin/teams');
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Could not add member.' };
  }
}

/**
 * Invite-by-email (old-app parity): resolve the email to an existing account
 * member and add them with the chosen role. A fork's local provider has no
 * pending-invite/email flow, so we match by an already-registered account
 * member and report honestly when there's no match (they must sign up first).
 */
export async function inviteMemberByEmailAction(
  teamId: string,
  email: string,
  role: 'owner' | 'member' = 'member',
): Promise<InviteResult> {
  const target = email.trim().toLowerCase();
  if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    return { ok: false, code: 'INVALID_EMAIL' };
  }
  try {
    const members = await adminApi.listMembers();
    const match = members.find((m) => m.email?.trim().toLowerCase() === target);
    if (!match) {
      return { ok: false, code: 'NO_MATCH' };
    }
    await adminApi.addTeamMember(teamId, { memberId: match.id, role });
    revalidatePath('/admin/teams');
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    // BE may 409 when already on the team — pass its message through verbatim.
    return { ok: false, code: 'FAILED', message: e instanceof Error ? e.message : undefined };
  }
}

export async function removeMemberAction(
  teamId: string,
  memberId: string,
): Promise<ActionResult> {
  try {
    await adminApi.removeTeamMember(teamId, memberId);
    revalidatePath('/admin/teams');
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    // Surfaces LAST_OWNER (409) etc.
    return { ok: false, message: e instanceof Error ? e.message : 'Could not remove member.' };
  }
}

export async function setMemberRoleAction(
  teamId: string,
  memberId: string,
  role: 'owner' | 'member',
): Promise<ActionResult> {
  try {
    await adminApi.updateTeamMemberRole(teamId, memberId, role);
    revalidatePath('/admin/teams');
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Could not change role.' };
  }
}
