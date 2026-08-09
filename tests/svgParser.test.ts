import { describe, it, expect } from 'vitest';
import { parseSVGDocument } from '../src/shared/svgParser.js';

describe('parseSVGDocument', () => {
  it('should correctly extract viewBox, width, and height', () => {
    const raw = `<svg width="200px" height="100px" viewBox="0 0 400 200"><rect width="50" height="50"/></svg>`;
    const { info } = parseSVGDocument(raw);

    expect(info.width).toBe(200);
    expect(info.height).toBe(100);
    expect(info.viewBox).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it('should fall back to viewBox dimensions if width/height are omitted', () => {
    const raw = `<svg viewBox="0 0 500 300"><circle cx="10" cy="10" r="5"/></svg>`;
    const { info } = parseSVGDocument(raw);

    expect(info.width).toBe(500);
    expect(info.height).toBe(300);
  });

  it('should throw error for invalid non-SVG XML', () => {
    const raw = `<div>Hello world</div>`;
    expect(() => parseSVGDocument(raw)).toThrow();
  });
});
