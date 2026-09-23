/**
 * A column heading renders the whole question, clamped to two lines. The hover
 * card is added only once the browser measures the clamp cutting the text, so
 * on the server (and for a short question) there is no card at all.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ColumnHeading } from './column-heading';

describe('ColumnHeading', () => {
  const long =
    'Si alguno de los miembros de la sociedad llegara a fallecer, ¿qué debe pasar con su participación?';

  it('keeps the whole question in the heading, clamped to two lines', () => {
    const html = renderToStaticMarkup(<ColumnHeading text={long} />);
    expect(html).toMatch(
      /class="line-clamp-2"[^>]*>Si alguno de los miembros[^<]*participación\?</,
    );
  });

  it('draws no hover card before the clamp is measured', () => {
    expect(renderToStaticMarkup(<ColumnHeading text={long} />)).not.toContain(
      'column-heading-full',
    );
  });
});
