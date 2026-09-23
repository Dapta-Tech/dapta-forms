/**
 * The QR dialog's body. Static markup only: the web app's vitest runs in plain
 * node with no DOM, so the wrapper that reads `window.location` and builds the
 * files is covered by the e2e run instead. What is pinned here is what a person
 * sees: the code, the link it encodes, and both downloads.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { qrSvg } from '@/lib/qr-code';
import { getBuilderMessages } from './_components/builder-messages';
import { QrModalView, type QrLabels } from './qr-modal';

const URL_ = 'http://localhost:3400/acme/me/tech-week-signup';

function labels(locale: 'en' | 'es'): QrLabels {
  const s = getBuilderMessages(locale).shell;
  return {
    qrTitle: s.qrTitle,
    qrIntro: s.qrIntro,
    qrAlt: s.qrAlt,
    qrDownloadPng: s.qrDownloadPng,
    qrDownloadSvg: s.qrDownloadSvg,
    qrPngFailed: s.qrPngFailed,
    copyLink: s.copyLink,
    copied: s.copied,
  };
}

function render(
  opts: { copied?: boolean; busy?: boolean; failed?: boolean; locale?: 'en' | 'es' } = {},
) {
  return renderToStaticMarkup(
    <QrModalView
      svg={qrSvg(URL_)}
      url={URL_}
      copied={opts.copied ?? false}
      busy={opts.busy ?? false}
      failed={opts.failed ?? false}
      labels={labels(opts.locale ?? 'en')}
      onCopy={() => {}}
      onDownloadPng={() => {}}
      onDownloadSvg={() => {}}
    />,
  );
}

describe('QrModalView', () => {
  it('draws the code as an SVG image on an explicit white tile', () => {
    const html = render();
    expect(html).toContain('data-testid="qr-image"');
    expect(html).toContain('src="data:image/svg+xml;charset=utf-8,');
    // Not a theme token: `bg-popover` inverts in dark mode and scanners need
    // dark on light.
    expect(html).toMatch(/class="[^"]*bg-white[^"]*"><img/);
  });

  it('shows the exact link the code encodes', () => {
    const html = render();
    expect(html).toContain(`>${URL_}</span>`);
    expect(html).toContain('data-testid="qr-url"');
  });

  it('offers both downloads', () => {
    const html = render();
    expect(html).toContain('data-testid="qr-download-png"');
    expect(html).toContain('data-testid="qr-download-svg"');
    expect(html).toContain('Download PNG');
    expect(html).toContain('Download SVG');
  });

  it('flips the copy button to a check while the copy is fresh', () => {
    expect(render()).toContain('pi-copy');
    const html = render({ copied: true });
    expect(html).toContain('pi-check');
    expect(html).toContain('aria-label="Copied"');
  });

  it('disables the PNG button while it rasterizes, and never the SVG one', () => {
    const html = render({ busy: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="qr-download-png"/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="qr-download-svg"/);
  });

  it('points at the SVG when the PNG fails, and says nothing otherwise', () => {
    expect(render()).not.toContain('data-testid="qr-png-failed"');
    expect(render({ failed: true })).toContain('Try the SVG instead');
  });

  it('renders Spanish copy for a Spanish dashboard', () => {
    const html = render({ locale: 'es' });
    expect(html).toContain('Descargar PNG');
    expect(html).toContain('Descargar SVG');
    expect(html).toContain('alt="Código QR que abre este formulario"');
  });
});
