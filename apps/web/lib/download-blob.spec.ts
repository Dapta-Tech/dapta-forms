/**
 * The web app's vitest runs in plain node, so the browser objects these helpers
 * touch are stubbed with the smallest shape each call needs. What is pinned is
 * the order of operations the real browsers are picky about, not the pixels:
 * those are checked by the e2e run in Chromium and WebKit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBlob, svgDataUrl, svgToPngBlob } from './download-blob';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('svgDataUrl', () => {
  it('percent-encodes the markup so a # or a quote cannot end the URL early', () => {
    const url = svgDataUrl('<svg fill="#000"></svg>');
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).not.toContain('#');
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe('<svg fill="#000"></svg>');
  });
});

describe('saveBlob', () => {
  let anchor: {
    href: string;
    download: string;
    rel: string;
    click: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let revoke: ReturnType<typeof vi.fn>;
  let append: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    anchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() };
    revoke = vi.fn();
    append = vi.fn();
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: append } });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:qr', revokeObjectURL: revoke });
  });

  it('clicks an attached download anchor named after the file', () => {
    saveBlob(new Blob(['x']), 'acme-qr.svg');
    expect(anchor.href).toBe('blob:qr');
    expect(anchor.download).toBe('acme-qr.svg');
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });

  it('keeps the object URL alive past the click, then frees it', () => {
    saveBlob(new Blob(['x']), 'acme-qr.svg');
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:qr');
  });
});

describe('svgToPngBlob', () => {
  type Canvas = {
    width: number;
    height: number;
    getContext: () => unknown;
    toBlob: (cb: (b: Blob | null) => void) => void;
    toDataURL: () => string;
  };

  function stubBrowser(toBlobResult: Blob | null) {
    const calls: string[] = [];
    const ctx = {
      fillStyle: '',
      fillRect: (...a: number[]) => calls.push(`fill ${ctx.fillStyle} ${a.join(',')}`),
      drawImage: (_img: unknown, ...a: number[]) => calls.push(`draw ${a.join(',')}`),
    };
    const canvas: Canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb) => cb(toBlobResult),
      toDataURL: () => 'data:image/png;base64,AAAA',
    };
    let loadedSrc = '';
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) {
        loadedSrc = v;
        queueMicrotask(() => this.onload?.());
      }
      decode() {
        calls.push('decode');
        return Promise.resolve();
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('document', { createElement: () => canvas });
    const fetchMock = vi.fn(async () => ({
      blob: async () => new Blob(['fallback'], { type: 'image/png' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return { calls, canvas, fetchMock, src: () => loadedSrc };
  }

  it('paints white first, then the decoded QR, on a canvas of the requested size', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const b = stubBrowser(png);
    const out = await svgToPngBlob('<svg viewBox="0 0 10 10"></svg>', 1024);
    expect(out).toBe(png);
    expect(b.canvas.width).toBe(1024);
    expect(b.canvas.height).toBe(1024);
    expect(b.calls).toEqual(['decode', 'fill #ffffff 0,0,1024,1024', 'draw 0,0,1024,1024']);
    expect(b.fetchMock).not.toHaveBeenCalled();
  });

  it('draws the SVG exactly as handed over, without reshaping it', async () => {
    // Sizing belongs to the caller (`qrSvg`); a second pass here once meant two
    // places deciding what the file looks like.
    const svg = '<svg width="512" height="512" viewBox="0 0 10 10"></svg>';
    const b = stubBrowser(new Blob(['png']));
    await svgToPngBlob(svg, 512);
    expect(decodeURIComponent(b.src().slice(b.src().indexOf(',') + 1))).toBe(svg);
  });

  it('falls back to the data URL when toBlob yields null', async () => {
    const b = stubBrowser(null);
    const out = await svgToPngBlob('<svg viewBox="0 0 10 10"></svg>', 64);
    expect(b.fetchMock).toHaveBeenCalledWith('data:image/png;base64,AAAA');
    expect(await out.text()).toBe('fallback');
  });
});
