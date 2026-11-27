/**
 * The playbooks' PDFs: every playbook of the catalog has one per language,
 * made from what is in the repository now, light enough to download on a
 * phone, embedding our faces only and never served as a public file. The check needs no browser (`scripts/playbook-pdfs.mjs`), so CI fails
 * a markdown, picture or template edit whose PDFs were not printed again.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PLAYBOOK_CATALOG, PLAYBOOK_LOCALES, playbookMedia } from '@quill/shared/playbooks';
import {
  MAX_PDF_BYTES,
  PDF_DIR,
  PRINT_VERSION,
  foreignFonts,
  pdfProblems,
  playbookPage,
  playbookPages,
  readManifest,
  sourceHash,
  splitQuoteLines,
} from '../scripts/playbook-pdfs.mjs';
import nextConfig from '../next.config.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/playbook-pdfs.mjs', import.meta.url));
const ALL = PLAYBOOK_LOCALES.flatMap((locale) => PLAYBOOK_CATALOG[locale]);

type Page = { key: string; page: string; source: string };
let pages: Page[];
beforeAll(async () => {
  pages = await playbookPages();
}, 60_000);

describe('the committed PDFs', () => {
  it('has one per playbook and language', () => {
    expect(pages.map((p) => p.key).sort()).toEqual(ALL.map((p) => `${p.locale}/${p.slug}`).sort());
    expect(Object.keys(readManifest()).sort()).toEqual(pages.map((p) => p.key).sort());
  });

  it('are up to date with the playbooks and under the weight limit', () => {
    expect(MAX_PDF_BYTES).toBeLessThanOrEqual(1_500_000);
    expect(pdfProblems(pages)).toEqual([]);
    for (const { key } of pages) {
      expect(readFileSync(join(PDF_DIR, `${key}.pdf`)).length, key).toBeLessThanOrEqual(MAX_PDF_BYTES);
    }
  });

  it('pass the check the script runs', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' })).not.toThrow();
  }, 60_000);

  it('are checked too when the script is reached through a symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'playbook-pdfs-link-'));
    try {
      const repo = join(dir, 'checkout');
      symlinkSync(fileURLToPath(new URL('../../..', import.meta.url)), repo);
      const out = execFileSync(process.execPath, [join(repo, 'apps/web/scripts/playbook-pdfs.mjs'), '--check'], {
        encoding: 'utf8',
      });
      expect(out).toContain(`${ALL.length} PDFs up to date`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('embed the faces of the repository and no other', () => {
    for (const { key } of pages) {
      const data = readFileSync(join(PDF_DIR, `${key}.pdf`));
      expect(foreignFonts(data), key).toEqual([]);
      expect(data.toString('latin1'), key).toContain('+HankenGrotesk-');
      expect(data.toString('latin1'), key).not.toContain('/Type3');
    }
  });

  it('are outside public/, and traced into the standalone build for their route', () => {
    const served = readdirSync(fileURLToPath(new URL('../public', import.meta.url)), { recursive: true });
    expect(served.filter((f) => String(f).endsWith('.pdf'))).toEqual([]);
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      '/api/playbooks/*/pdf': ['./assets/playbooks-pdf/**/*.pdf'],
    });
  });
});

describe('the page a PDF is printed from', () => {
  it('carries the whole playbook: every section, every picture as a still, no video', () => {
    for (const p of ALL) {
      const key = `${p.locale}/${p.slug}`;
      const { page } = pages.find((x) => x.key === key)!;
      expect(page, key).toContain(`<html lang="${p.locale}" style="--picture:`);
      // A `## ` inside a fenced block is part of a prompt, not a section.
      const sections = `${p.preview}\n${p.rest}`.replace(/^```[\s\S]*?^```/gm, '').match(/^## .+$/gm) ?? [];
      expect((page.match(/<h2>/g) ?? []).length, key).toBe(sections.length);
      const pictures = [...page.matchAll(/<figure><img src="asset:([^#"]+)#/g)].map((m) => m[1]);
      expect(pictures, key).toEqual(
        playbookMedia(p).map(
          (m) => `apps/web/public/playbooks/inline/${p.locale}/${m.slug}/${m.name}${m.kind === 'anim' ? '-poster' : ''}.webp`,
        ),
      );
      expect(page, key).not.toContain('<video');
      expect(page, key).toContain('class="do-it"');
      expect(page, key).toContain(p.locale === 'es' ? 'https://dforms.ai/recursos/' : 'https://dforms.ai/en/recursos/');
    }
  });

  it('writes the markdown as text, never as HTML', async () => {
    const page = await playbookPage({
      ...PLAYBOOK_CATALOG.es[0]!,
      title: 'A <b> & "c"',
      preview: '<script>alert(1)</script>\n\n[malo](javascript:alert(1)) y [bueno](/admin/forms)',
      rest: 'Fin.',
    });
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('javascript:alert');
    expect(page).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
    expect(page).toContain('href="https://app.dforms.ai/admin/forms"');
  });

  it('changes its hash with the text', async () => {
    const base = PLAYBOOK_CATALOG.es[0]!;
    const edited = await playbookPage({ ...base, rest: `${base.rest}\n\nUna línea más.` });
    expect(sourceHash(edited)).not.toBe(sourceHash(await playbookPage(base)));
  });

  it('is hashed with the print version, so a change to how it is printed asks for it again', () => {
    expect(Number.isInteger(PRINT_VERSION)).toBe(true);
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).toContain('sha256(JSON.stringify({ version: PRINT_VERSION, page,');
  });

  it('keeps each line of a quoted conversation on its own', () => {
    expect(splitQuoteLines('> **Claude**\n> Tú: hola\n> Claude: listo\n\nTexto')).toBe(
      '> **Claude**\n>\n> Tú: hola\n>\n> Claude: listo\n\nTexto',
    );
  });
});

describe('the check, on example files', () => {
  const data = Buffer.from('%PDF-1.4 example');
  const hash = createHash('sha256').update(data).digest('hex');
  const wanted = [{ key: 'es/hook', source: 'abc' }];
  const manifest = { 'es/hook': { source: 'abc', pdf: hash, bytes: data.length } };
  let dir: string;
  const put = (name: string, content: Buffer = data) => {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'playbook-pdfs-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const check = (over: object = {}) => pdfProblems(wanted as Page[], { dir, manifest, ...over });

  it('passes a file made from the page asked for', () => {
    put('es/hook.pdf');
    expect(check()).toEqual([]);
  });

  it('names a missing file', () => {
    expect(check()).toEqual(['es/hook.pdf is missing']);
  });

  it('names a file made from an older page, and one changed by hand', () => {
    put('es/hook.pdf');
    expect(check({ manifest: { 'es/hook': { ...manifest['es/hook'], source: 'old' } } })).toEqual([
      expect.stringContaining('es/hook.pdf is out of date'),
    ]);
    put('es/hook.pdf', Buffer.from('%PDF-1.4 other'));
    expect(check()).toEqual(['es/hook.pdf is not the file the manifest was written for']);
  });

  it('names a file that embeds a face that is not ours', () => {
    const borrowed = Buffer.from(
      '%PDF-1.4 /BaseFont /AAAAAA+HankenGrotesk-Regular /BaseFont /BAAAAA+dFormsSymbols-Regular /FontName /CAAAAA+.SFNS-Regular /BaseFont/DAAAAA+ZapfDingbatsITC',
    );
    expect(foreignFonts(borrowed)).toEqual(['.SFNS-Regular', 'ZapfDingbatsITC']);
    put('es/hook.pdf', borrowed);
    const sum = createHash('sha256').update(borrowed).digest('hex');
    expect(check({ manifest: { 'es/hook': { source: 'abc', pdf: sum, bytes: borrowed.length } } })).toEqual([
      expect.stringContaining('es/hook.pdf embeds .SFNS-Regular, ZapfDingbatsITC'),
    ]);
  });

  it('names a file over the limit', () => {
    put('es/hook.pdf');
    expect(check({ maxBytes: 4 })).toEqual([`es/hook.pdf weighs ${data.length} bytes, over the 4 limit`]);
  });

  it('names what no playbook asks for', () => {
    put('es/hook.pdf');
    put('es/gone.pdf');
    expect(check({ manifest: { ...manifest, 'es/gone': manifest['es/hook'] } })).toEqual([
      'es/gone.pdf belongs to no playbook: delete it',
      'the manifest names es/gone, which is no playbook',
    ]);
  });
});
