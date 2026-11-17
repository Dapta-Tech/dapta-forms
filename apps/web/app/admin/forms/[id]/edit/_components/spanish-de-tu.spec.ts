/**
 * The Spanish copy addresses people as tú (Colombia), never vos.
 *
 * Both catalogs are walked, the shared one and the builder's, because a sweep
 * that knows about one misses the other, and voseo forms kept coming back
 * one string at a time ("Conectá", "probá de nuevo", "usá la sincronización").
 * The list names voseo verb forms by their accented ending; it is a guard for
 * the forms that have shipped here, not a grammar checker.
 */
import { describe, expect, it } from 'vitest';
import { getMessages } from '@quill/shared';
import { getBuilderMessages } from './builder-messages';

const VOSEO =
  /(^|[^\p{L}])(vos|conectá|mandá|agregá|usá|probá|revisá|elegí|quitá|mirá|tocá|pegá|copiá|cambiá|borrá|guardá|creá|completá|ingresá|seleccioná|activá|desactivá|escribí|abrí|subí|pedí|esperá|intentá|hacé|poné|volvé|configurá|editá|eliminá|podés|tenés|querés|sabés|necesitás|fijate|asegurate|acordate)(?![\p{L}])/iu;

function strings(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe('Spanish copy uses tú', () => {
  it.each([
    ['shared catalog', getMessages('es')],
    ['builder catalog', getBuilderMessages('es')],
  ])('the %s has no voseo', (_name, catalog) => {
    const hits = strings(catalog).filter(([, text]) => VOSEO.test(text));
    expect(hits).toEqual([]);
  });

  it('would catch the forms that shipped before', () => {
    for (const bad of ['Conectá Calendly', 'probá de nuevo', 'usá la sincronización', '¿Podés?']) {
      expect(VOSEO.test(bad)).toBe(true);
    }
    for (const good of ['Conecta Calendly', 'prueba de nuevo', 'aquí está', 'después']) {
      expect(VOSEO.test(good)).toBe(false);
    }
  });
});
