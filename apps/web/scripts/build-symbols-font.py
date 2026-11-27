#!/usr/bin/env python3
"""
Draws assets/fonts/dforms-symbols.ttf: the few symbols the playbooks use that
the brand face does not have, so the printed PDFs never fall back to a font of
whoever prints them (scripts/playbook-pdfs.mjs refuses a PDF that embeds one).

The shapes are drawn here, for this repository, and released under the SIL Open
Font License 1.1. To add a symbol, add it to GLYPHS, run

    pip install fonttools
    python3 apps/web/scripts/build-symbols-font.py

and print the PDFs again.
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'fonts' / 'dforms-symbols.ttf'

# name: (code point, advance width, contour), on a 1000 unit em, clockwise.
GLYPHS = {
    'arrowright': (0x2192, 900, [
        (70, 300), (70, 384), (650, 384), (492, 542), (552, 602), (832, 342),
        (552, 82), (492, 142), (650, 300),
    ]),
    'checkmark': (0x2713, 760, [
        (55, 305), (135, 385), (285, 235), (645, 665), (730, 593), (290, 70),
    ]),
    'multiplicationx': (0x2715, 700, [
        (80, 145), (278, 343), (80, 541), (149, 610), (347, 412), (545, 610),
        (614, 541), (416, 343), (614, 145), (545, 76), (347, 274), (149, 76),
    ]),
}


def glyph(points):
    pen = TTGlyphPen(None)
    if points:
        pen.moveTo(points[0])
        for point in points[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def main():
    order = ['.notdef', *GLYPHS]
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({code: name for name, (code, _, _) in GLYPHS.items()})
    glyphs = {'.notdef': glyph([]), **{name: glyph(points) for name, (_, _, points) in GLYPHS.items()}}
    builder.setupGlyf(glyphs)
    widths = {'.notdef': 500, **{name: width for name, (_, width, _) in GLYPHS.items()}}
    builder.setupHorizontalMetrics({name: (widths[name], getattr(builder.font['glyf'][name], 'xMin', 0)) for name in order})
    # The vertical metrics of the brand face, so a line holding a symbol keeps its height.
    builder.setupHorizontalHeader(ascent=1000, descent=-303)
    builder.setupNameTable({
        'familyName': 'dForms Symbols',
        'styleName': 'Regular',
        'psName': 'dFormsSymbols-Regular',
        'copyright': 'Copyright 2026 The dForms Authors.',
        'licenseDescription': 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
        'licenseInfoURL': 'https://openfontlicense.org',
    })
    builder.setupOS2(sTypoAscender=1000, sTypoDescender=-303, usWinAscent=1000, usWinDescent=303, fsType=0)
    builder.setupPost()
    # Fixed dates: the same shapes give the same bytes.
    builder.font['head'].created = builder.font['head'].modified = 3_850_000_000
    builder.font.recalcTimestamp = False
    builder.save(OUT)
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
