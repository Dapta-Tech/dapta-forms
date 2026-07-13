/**
 * The permission layer. Pure capability predicates + thin assertions the host
 * controllers call after resolving the principal. The account role
 * (`HostPrincipal.role`, from `member.role`) is the single input; a violation is
 * a 403 with a stable `FORBIDDEN` body.
 *
 * Capability model (see ROLES-PERMISSIONS-PLAN):
 *   - owner  — everything (+ transfer / delete workspace, act on other owners)
 *   - admin  — manage members (except owners) and everyone's resources; NOT owners
 *   - member — own resources only
 *
 * This is the ACCOUNT role, distinct from the per-team `team_membership.role`.
 */
import { ForbiddenException } from '@nestjs/common';
import type { AccountRole } from '@quill/db';

/** Just enough of the principal to make an authorization decision. */
export interface RoledPrincipal {
  memberId: string;
  role: AccountRole;
}

export const isOwner = (role: AccountRole): boolean => role === 'owner';
/** admin OR owner — the "workspace admin" tier that manages members + settings. */
export const isAdmin = (role: AccountRole): boolean => role === 'owner' || role === 'admin';

function forbidden(message: string): never {
  throw new ForbiddenException({ error: 'FORBIDDEN', message });
}

/** Workspace-settings + member-management + cross-member routes: admin/owner only. */
export function assertAdmin(p: RoledPrincipal): void {
  if (!isAdmin(p.role)) forbidden('Requires an admin or owner.');
}

/** Owner-only routes (transfer ownership, delete workspace, act on another owner). */
export function assertOwner(p: RoledPrincipal): void {
  if (!isOwner(p.role)) forbidden('Requires the workspace owner.');
}

/**
 * Own-resource routes: a plain member may act only on a
 * resource they own; admin/owner may act on anyone's. A resource with no owning
 * member (an account-owned resource, `ownerMemberId === null`) is admin-only.
 */
export function assertOwnsOrAdmin(p: RoledPrincipal, ownerMemberId: string | null): void {
  if (isAdmin(p.role)) return;
  if (ownerMemberId && ownerMemberId === p.memberId) return;
  forbidden('You can only manage your own resources.');
}

/**
 * Member-management target guard: an admin may manage members but NOT owners
 * (only an owner can act on another owner — demote, remove, disable, or promote
 * someone to owner). Call AFTER assertAdmin.
 */
export function assertCanManageTarget(
  p: RoledPrincipal,
  target: { role: AccountRole },
  opts: { toRole?: AccountRole } = {},
): void {
  const touchesOwner = isOwner(target.role) || opts.toRole === 'owner';
  if (touchesOwner && !isOwner(p.role)) forbidden('Only an owner can manage owners.');
}

/**
 * No self-administration via the member-management endpoints: a caller may not
 * change their OWN role/status or remove themselves (they can't lock themselves
 * out or self-escalate). Own-profile edits go through /v1/me; ownership changes
 * hands go through a dedicated (future) transfer flow.
 */
export function assertNotSelf(p: RoledPrincipal, targetMemberId: string): void {
  if (p.memberId === targetMemberId) forbidden('You cannot change your own membership here.');
}
