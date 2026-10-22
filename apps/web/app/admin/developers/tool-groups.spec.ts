/**
 * The MCP page groups the server's tools by hand (the client page cannot
 * import the server package). Held to the server's catalog here: every tool in
 * exactly one group, none that the server does not register.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG } from '@quill/mcp';
import { getMessages } from '@quill/shared';
import { TOOL_COUNT, TOOL_GROUPS, TOOL_GROUP_ORDER } from './tool-groups';

describe('TOOL_GROUPS', () => {
  const grouped = Object.values(TOOL_GROUPS).flat() as string[];
  const served = CATALOG.map((tool) => tool.name);

  it('places every tool the MCP serves in exactly one group', () => {
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...served].sort());
    expect(TOOL_COUNT).toBe(served.length);
  });

  it('shows every group once', () => {
    expect([...TOOL_GROUP_ORDER].sort()).toEqual(Object.keys(TOOL_GROUPS).sort());
  });

  it('has plain-language copy for every tool in both languages, and none for tools that do not exist', () => {
    for (const l of ['en', 'es'] as const) {
      const items = getMessages(l).admin.developers.tools.items;
      expect(Object.keys(items).sort()).toEqual([...served].sort());
    }
  });
});
