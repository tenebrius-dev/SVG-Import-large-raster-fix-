import { describe, it, expect } from 'vitest';
import { sanitizeSVGDocument } from '../src/shared/security.js';
import { parseSVGDocument } from '../src/shared/svgParser.js';

describe('sanitizeSVGDocument', () => {
  it('should remove dangerous <script> tags', () => {
    const raw = `<svg width="100" height="100"><script>alert('xss')</script><rect width="50" height="50"/></svg>`;
    const { doc } = parseSVGDocument(raw);
    const { svgString, warnings } = sanitizeSVGDocument(doc, 'test.svg');

    expect(svgString).not.toContain('<script');
    expect(warnings.some(w => w.includes('<script>'))).toBe(true);
  });

  it('should remove event handler attributes like onload or onclick', () => {
    const raw = `<svg width="100" height="100" onload="alert(1)"><rect width="50" height="50" onclick="evil()"/></svg>`;
    const { doc } = parseSVGDocument(raw);
    const { svgString, warnings } = sanitizeSVGDocument(doc, 'test.svg');

    expect(svgString).not.toContain('onload');
    expect(svgString).not.toContain('onclick');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should sanitize javascript: URLs in href attributes', () => {
    const raw = `<svg width="100" height="100"><a href="javascript:alert(1)"><rect width="50" height="50"/></a></svg>`;
    const { doc } = parseSVGDocument(raw);
    const { svgString, warnings } = sanitizeSVGDocument(doc, 'test.svg');

    expect(svgString).not.toContain('javascript:');
    expect(warnings.some(w => w.includes('javascript:'))).toBe(true);
  });
});
