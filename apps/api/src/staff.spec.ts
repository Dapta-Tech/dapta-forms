import { describe, expect, it } from 'vitest';
import { isStaffEmail, upstreamWorkspaceIdOf } from './staff';
import { WorkspaceProjection } from './workspace-projection';
import type { Db } from '@quill/db';
import type { IamWorkspacesClient } from './iam-workspaces';

describe('upstreamWorkspaceIdOf', () => {
  it('names the identity service workspace, and nothing for a local-only account', () => {
    expect(upstreamWorkspaceIdOf('9b2f6c1e-0000-4000-8000-000000000001')).toBe('9b2f6c1e-0000-4000-8000-000000000001');
    for (const local of [null, undefined, '', 'local:abc', 'dev:abc', 'legacy:abc']) expect(upstreamWorkspaceIdOf(local)).toBeNull();
  });
});

describe('isStaffEmail', () => {
  const domains = ['example.com', 'staff.example.org'];

  it('is true for an email on a listed domain, in any letter case and with stray spaces', () => {
    expect(isStaffEmail('ana@example.com', domains)).toBe(true);
    expect(isStaffEmail('Ana@EXAMPLE.com ', domains)).toBe(true);
    expect(isStaffEmail('ops@staff.example.org', domains)).toBe(true);
  });

  it('matches the exact domain only, never a look-alike or a subdomain', () => {
    expect(isStaffEmail('ana@notexample.com', domains)).toBe(false);
    expect(isStaffEmail('ana@sub.example.com', domains)).toBe(false);
    expect(isStaffEmail('ana@example.com.evil.test', domains)).toBe(false);
    expect(isStaffEmail('example.com@evil.test', domains)).toBe(false);
  });

  it('is false for anything but one local part, one @ and one domain', () => {
    // The domain after the LAST @ used to decide: these all read as staff.
    expect(isStaffEmail('evil@x.com@example.com', domains)).toBe(false);
    expect(isStaffEmail('@example.com', domains)).toBe(false);
    expect(isStaffEmail('a@@example.com', domains)).toBe(false);
    expect(isStaffEmail('ana smith@example.com', domains)).toBe(false);
    expect(isStaffEmail('ana@exa mple.com', domains)).toBe(false);
    expect(isStaffEmail('ana@example.com\n@evil.test', domains)).toBe(false);
  });

  it('is false without an email, without a domain, or with no domains listed', () => {
    expect(isStaffEmail(null, domains)).toBe(false);
    expect(isStaffEmail(undefined, domains)).toBe(false);
    expect(isStaffEmail('', domains)).toBe(false);
    expect(isStaffEmail('ana', domains)).toBe(false);
    expect(isStaffEmail('ana@', domains)).toBe(false);
    expect(isStaffEmail('ana@example.com', [])).toBe(false);
    expect(isStaffEmail('ana@example.com', undefined)).toBe(false);
  });

  it('is the rule the workspace switcher applies', () => {
    const projection = new WorkspaceProjection({} as Db, {} as IamWorkspacesClient, { staffDomains: domains });
    for (const email of ['ana@example.com', 'ana@notexample.com', null, 'ana@']) {
      expect(projection.isStaff(email)).toBe(isStaffEmail(email, domains));
    }
  });
});
