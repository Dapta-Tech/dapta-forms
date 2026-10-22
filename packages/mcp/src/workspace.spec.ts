import { describe, expect, it } from 'vitest';
import { SEARCH_FOLD_FROM, SEARCH_FOLD_TO, foldSearchText, normalizeWorkspaceSearch } from './workspace';

/** What a database does with the fold table: `translate(lower_ascii(x), FROM, TO)`, then marks and ASCII punctuation dropped. */
function foldLikeSql(text: string): string {
  const lowerAscii = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  let out = '';
  for (const ch of lowerAscii) {
    const at = SEARCH_FOLD_FROM.indexOf(ch);
    out += at >= 0 ? SEARCH_FOLD_TO[at] : ch;
  }
  // eslint-disable-next-line no-control-regex
  return out.replace(/[\x01-\x2f\x3a-\x60\x7b-\x7f]/g, '').replace(/[\u0300-\u036f]/g, '');
}

describe('normalizeWorkspaceSearch', () => {
  it('drops ASCII punctuation and spaces and lowercases, as before', () => {
    expect(normalizeWorkspaceSearch("Call-Center's  Workspace")).toBe('callcentersworkspace');
    expect(normalizeWorkspaceSearch('a%b_c')).toBe('abc');
    expect(normalizeWorkspaceSearch(undefined)).toBe('');
  });

  it('folds accents, so "jose" finds "José" and "JOSÉ", and "penalosa" finds "Peñalosa"', () => {
    for (const name of ['José', 'JOSÉ', 'Jose\u0301', 'jose']) expect(normalizeWorkspaceSearch(name)).toBe('jose');
    expect(normalizeWorkspaceSearch('Peñalosa & Hijos')).toBe('penalosahijos');
    expect(normalizeWorkspaceSearch('ÅNGSTRÖM Ødegaard Łódź')).toBe('angstromodegaardlodz');
  });

  it('lowercases letters of other scripts too', () => {
    expect(normalizeWorkspaceSearch('МОСКВА')).toBe('москва');
    expect(normalizeWorkspaceSearch('ΑΘΉΝΑ')).toBe('αθηνα');
  });

  it('agrees with the table a database applies, whatever its collation does to case', () => {
    for (const name of ['José María', 'JOSÉ MARÍA', 'Peñalosa & Hijos', 'ÅNGSTRÖM Ødegaard Łódź', 'Café Ñandú', 'МОСКВА', 'Ἀθῆναι']) {
      expect(foldLikeSql(name)).toBe(normalizeWorkspaceSearch(name));
    }
  });
});

describe('the fold table', () => {
  it('maps one character to one, with no character listed twice', () => {
    expect([...SEARCH_FOLD_FROM]).toHaveLength([...SEARCH_FOLD_TO].length);
    expect(SEARCH_FOLD_FROM.length).toBe(SEARCH_FOLD_TO.length);
    expect(new Set(SEARCH_FOLD_FROM).size).toBe(SEARCH_FOLD_FROM.length);
  });

  it('folds every character it lists the same way in a database as here', () => {
    for (const ch of SEARCH_FOLD_FROM) expect(foldLikeSql(ch)).toBe(normalizeWorkspaceSearch(ch));
  });

  it('is what foldSearchText applies, and folding twice changes nothing', () => {
    for (const name of ['José', 'Ødegaard', 'МОСКВА']) expect(foldSearchText(foldSearchText(name))).toBe(foldSearchText(name));
  });
});
