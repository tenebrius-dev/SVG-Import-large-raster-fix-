import { describe, it, expect } from 'vitest';
import { extractRasters } from '../src/shared/rasterExtractor.js';
import { parseSVGDocument } from '../src/shared/svgParser.js';
import { DEFAULT_SETTINGS } from '../src/shared/types.js';

describe('extractRasters', () => {
  it('should identify embedded base64 large image and replace with placeholder', () => {
    // 5000x5000 PNG base64 header
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAE4gAABOI';
    const raw = `<svg width="5000" height="5000"><image width="5000" height="5000" href="data:image/png;base64,${pngBase64}"/></svg>`;
    const { doc, info } = parseSVGDocument(raw);

    const { rasters, cleanedSvgString } = extractRasters(doc, info, DEFAULT_SETTINGS, 'test.svg');

    expect(rasters.length).toBe(1);
    expect(rasters[0]!.willExtract).toBe(true);
    expect(rasters[0]!.mimeType).toBe('image/png');
    expect(cleanedSvgString).not.toContain('data:image/png;base64');
    expect(cleanedSvgString).toContain('__svg_raster_');
  });

  it('should detect small images without replacing if under 4096px threshold', () => {
    // 100x100 PNG base64 header
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABk';
    const raw = `<svg width="100" height="100"><image width="100" height="100" href="data:image/png;base64,${pngBase64}"/></svg>`;
    const { doc, info } = parseSVGDocument(raw);

    const { rasters } = extractRasters(doc, info, DEFAULT_SETTINGS, 'test.svg');

    expect(rasters.length).toBe(1);
    expect(rasters[0]!.willExtract).toBe(false);
  });

  it('should skip non-data URI image hrefs', () => {
    const raw = `<svg width="100" height="100"><image width="100" height="100" href="http://example.com/logo.png"/></svg>`;
    const { doc, info } = parseSVGDocument(raw);

    const { rasters, cleanedSvgString } = extractRasters(doc, info, DEFAULT_SETTINGS, 'test.svg');

    expect(rasters.length).toBe(0);
    expect(cleanedSvgString).toContain('http://example.com/logo.png');
  });
});
