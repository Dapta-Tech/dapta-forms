/**
 * The playbooks' markdown reader: the subset the catalog uses, and the two
 * safety rules (HTML stays text, a link only to the web or this app).
 */
import { describe, expect, it } from 'vitest';
import { PLAYBOOKS, playbookBody } from '@quill/shared/playbooks';
import { inlineText, parseInline, parseMarkdown, safeHref, type Block } from './markdown';

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, rules and quotes', () => {
    expect(parseMarkdown('## Uno\n\nUna línea\nque sigue.\n\n---\n\n> Cita\n> larga')).toEqual([
      { kind: 'heading', level: 2, text: 'Uno' },
      { kind: 'paragraph', text: 'Una línea que sigue.' },
      { kind: 'rule' },
      { kind: 'quote', blocks: [{ kind: 'paragraph', text: 'Cita larga' }] },
    ]);
  });

  it('reads an ordered list with a nested list and a numbered start', () => {
    const [list] = parseMarkdown('3. Primero:\n   - a\n   - b\n4. Segundo') as [Extract<Block, { kind: 'list' }>];
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(3);
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toEqual([
      { kind: 'paragraph', text: 'Primero:' },
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [[{ kind: 'paragraph', text: 'a' }], [{ kind: 'paragraph', text: 'b' }]],
      },
    ]);
  });

  it('keeps a list going across blank lines between its items', () => {
    const blocks = parseMarkdown('- uno\n\n- dos\n\nDespués');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'paragraph']);
    expect((blocks[0] as Extract<Block, { kind: 'list' }>).items).toHaveLength(2);
  });

  it('reads fenced blocks verbatim and tables cell by cell', () => {
    expect(parseMarkdown('```\nA:   [x]\n**no**\n```')).toEqual([{ kind: 'code', text: 'A:   [x]\n**no**' }]);
    expect(parseMarkdown('| A | B |\n|---|---|\n| 1 | |\n| x \\| y | 2 |')).toEqual([
      { kind: 'table', header: ['A', 'B'], rows: [['1', ''], ['x | y', '2']] },
    ]);
  });

  it('drops an HTML comment line and leaves any other HTML as the characters it is', () => {
    expect(parseMarkdown('Antes\n\n<!-- muro -->\n\n<script>alert(1)</script>')).toEqual([
      { kind: 'paragraph', text: 'Antes' },
      { kind: 'paragraph', text: '<script>alert(1)</script>' },
    ]);
  });

  it('reads every playbook of the catalog without losing a word', () => {
    for (const p of PLAYBOOKS) {
      const blocks = parseMarkdown(playbookBody(p));
      const h2 = blocks.filter((b) => b.kind === 'heading' && b.level === 2);
      expect(h2.length, p.slug).toBeGreaterThan(0);
      // The closing section the reader moves into its template panel.
      expect(h2.some((b) => b.kind === 'heading' && b.text === 'Hazlo con dForms'), p.slug).toBe(true);
      expect(JSON.stringify(blocks), p.slug).not.toContain('<!--');
    }
  });
});

describe('parseInline', () => {
  it('reads bold, italics, code and escapes', () => {
    expect(parseInline('**Plantilla, 10 min.** y *ojo* con `lead` \\*no\\*')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'Plantilla, 10 min.' }] },
      { kind: 'text', text: ' y ' },
      { kind: 'em', children: [{ kind: 'text', text: 'ojo' }] },
      { kind: 'text', text: ' con ' },
      { kind: 'code', text: 'lead' },
      { kind: 'text', text: ' *no*' },
    ]);
  });

  it('draws no image: its alt text stands in for it', () => {
    expect(parseInline('Mira ![el panel](/x.png) aquí')).toEqual([
      { kind: 'text', text: 'Mira ' },
      { kind: 'text', text: 'el panel' },
      { kind: 'text', text: ' aquí' },
    ]);
  });

  it('leaves snake_case and a lone star alone', () => {
    expect(inlineText('utm_source y 5 * 3')).toBe('utm_source y 5 * 3');
  });

  it('links only to the web or to this app; anything else stays text', () => {
    expect(parseInline('[docs](https://example.com/a)')).toEqual([
      { kind: 'link', href: 'https://example.com/a', children: [{ kind: 'text', text: 'docs' }] },
    ]);
    // A refused link leaves its words, and nothing of its target (no stray ")").
    expect(parseInline('[aquí](javascript:alert(1)) fin')).toEqual([
      { kind: 'text', text: 'aquí' },
      { kind: 'text', text: ' fin' },
    ]);
    expect(parseInline('[x](data:text/html,hi)')).toEqual([{ kind: 'text', text: 'x' }]);
    expect(safeHref('/admin/forms')).toBe('/admin/forms');
    expect(safeHref('//evil.example')).toBeNull();
    // Browsers read "/\\host" as another host too.
    expect(safeHref('/\\evil.example')).toBeNull();
    expect(parseInline('[x](/\\evil.example)')).toEqual([{ kind: 'text', text: 'x' }]);
    expect(safeHref('#seccion')).toBe('#seccion');
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
  });
});
