/**
 * How each agent with a terminal takes the skill: the shell that puts the
 * unzipped folder where that agent looks. One source for two readers, the
 * skill's `INSTALL.md` and the setup guide on the API keys page, so the zip and
 * the page never tell a person two different things.
 *
 * Pure strings, no URLs: the commands only name the zip and the folder, which
 * are the same in every environment.
 */
import { SKILL_DIR, SKILL_ZIP_NAME } from './skill-names';

export const SETUP_AGENTS = ['claude-code', 'codex', 'cursor'] as const;
export type SetupAgent = (typeof SETUP_AGENTS)[number];

/** The agent's own name, the same in every language. */
export const SETUP_AGENT_NAMES: Record<SetupAgent, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

/** The variable the skill reads the key from. */
export const API_KEY_ENV = 'DFORMS_API_KEY';

/** The line that hands the key to the agent; a placeholder when the key is not known. */
export function exportKeyCommand(key = 'dforms_your_key_here'): string {
  return `export ${API_KEY_ENV}="${key}"`;
}

/** Unzip the skill where `agent` reads it, plus the pointer file it needs. */
export function installCommand(agent: SetupAgent): string {
  switch (agent) {
    case 'claude-code':
      return `unzip ${SKILL_ZIP_NAME} -d ~/.claude/skills/`;
    case 'codex':
      return `unzip ${SKILL_ZIP_NAME} -d .
cat >> AGENTS.md <<'EOF'

## dForms
For any task about dForms forms, responses or analytics, read ${SKILL_DIR}/SKILL.md first and follow its rules. The references and recipes it names are in ${SKILL_DIR}/.
EOF`;
    case 'cursor':
      return `unzip ${SKILL_ZIP_NAME} -d .
mkdir -p .cursor/rules
cat > .cursor/rules/${SKILL_DIR}.mdc <<'EOF'
---
description: Use the dForms API to create, edit, publish and revert forms and to read responses and analytics.
alwaysApply: false
---
Read ${SKILL_DIR}/SKILL.md and follow its rules. References and recipes are in ${SKILL_DIR}/.
EOF`;
  }
}
