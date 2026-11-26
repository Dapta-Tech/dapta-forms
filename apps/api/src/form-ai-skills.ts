import { z } from 'zod';

export const LEAD_QUALIFICATION_SKILL = 'qualify-leads';

const gitPath = z.string().refine((path) =>
  path.split('/').every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..'),
);
const catalogSchema = z.object({ plugins: z.array(z.object({ name: z.string() }).passthrough()) });
const skillSchema = z.object({
  version: z.string().regex(/^[\w.+-]{1,80}$/),
  source: z.object({
    source: z.literal('git-subdir'),
    url: z.string().url(),
    path: gitPath,
    ref: gitPath.optional(),
    sha: z.string().regex(/^[a-f\d]{40}$/i).optional(),
  }),
});

export async function loadLeadQualificationSkill(baseUrl: string, headers: Record<string, string>) {
  const signal = AbortSignal.timeout(4_000);
  try {
    const catalogResponse = await fetch(`${baseUrl.slice(0, -'/v1'.length)}/claude-code/marketplace.json`, {
      headers,
      redirect: 'error',
      signal,
    });
    if (!catalogResponse.ok) return null;
    const catalog = catalogSchema.safeParse(await catalogResponse.json());
    if (!catalog.success) return null;
    const skill = skillSchema.safeParse(catalog.data.plugins.find(({ name }) => name === LEAD_QUALIFICATION_SKILL));
    if (!skill.success) return null;

    const { source, version } = skill.data;
    const repository = new URL(source.url);
    const repoPath = /^\/([a-z\d-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(repository.pathname)?.[1];
    if (
      repository.origin !== 'https://github.com' || repository.username || repository.password ||
      repository.search || repository.hash || !repoPath
    ) return null;

    const revision = source.sha ?? source.ref ?? 'HEAD';
    // The proxy key is only for the catalogue. The registered GitHub source is public.
    const skillResponse = await fetch(`https://raw.githubusercontent.com/${repoPath}/${revision}/${source.path}/SKILL.md`, {
      redirect: 'error',
      signal,
    });
    if (!skillResponse.ok) return null;
    const markdown = await skillResponse.text();
    if (markdown.length > 32_768) return null;
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (!frontmatter || !/^name:[ \t]*(?:qualify-leads|"qualify-leads"|'qualify-leads')[ \t]*\r?$/m.test(frontmatter[1] ?? '')) {
      return null;
    }
    const instructions = markdown.slice(frontmatter[0].length).trim();
    return instructions ? { instructions, version } : null;
  } catch {
    return null;
  }
}
