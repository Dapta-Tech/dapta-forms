/**
 * The skill names the dashboard section the way the rail does. The section was
 * renamed from "Developers" to "MCP"; its addresses were not, because zips
 * already handed out link to them. A file in the zip that still says
 * "Developers" sends the person looking for an item the rail no longer has.
 */
import { describe, expect, it } from 'vitest';
import { getMessages } from '@quill/shared';
import { buildSkillFiles, SKILL_DIR } from './skill-files';

const files = buildSkillFiles({
  apiUrl: 'https://api.forms.example.com',
  appUrl: 'https://forms.example.com',
});

describe('skill: the section name', () => {
  it('never says "Developers" in any file', () => {
    for (const f of files) expect(f.content, f.path).not.toMatch(/\bDevelopers\b/);
  });

  it('tells the agent where the person creates a key, by the names the rail shows', () => {
    const skill = files.find((f) => f.path === `${SKILL_DIR}/SKILL.md`)!.content;
    const chrome = getMessages('en').admin.chrome;
    expect(skill).toContain(`${chrome.nav.developers}, then ${chrome.developersMenu.keys}`);
  });

  it('keeps linking the addresses that zips already carry', () => {
    const skill = files.find((f) => f.path === `${SKILL_DIR}/SKILL.md`)!.content;
    expect(skill).toContain('https://forms.example.com/admin/developers/keys');
  });
});
