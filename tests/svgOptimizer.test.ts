import { describe, it, expect } from 'vitest';
import { optimizeSVGDocument } from '../src/shared/svgOptimizer.js';
import type { SVGInfo } from '../src/shared/types.js';
import { JSDOM } from 'jsdom';

function createDocument(svgString: string): Document {
  const dom = new JSDOM(svgString, { contentType: 'image/svg+xml', url: 'https://example.com' });
  return dom.window.document;
}

describe('optimizeSVGDocument', () => {
  it('should remove artboard clip-path', () => {
    const svg = `
      <svg width="1000" height="500" viewBox="0 0 1000 500">
        <clipPath id="artboard">
          <rect width="1000" height="500"></rect>
        </clipPath>
        <g clip-path="url(#artboard)">
          <path d="M0 0 L10 10" />
        </g>
      </svg>
    `;
    const doc = createDocument(svg);
    const info: SVGInfo = {
      width: 1000,
      height: 500,
      viewBox: { x: 0, y: 0, width: 1000, height: 500 },
      preserveAspectRatio: 'xMidYMid meet'
    };

    const warnings = optimizeSVGDocument(doc, info);
    
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('document bounds');
    expect(doc.querySelector('clipPath')).toBeNull();
    // Top-level <g> remains, but clip-path is removed
    expect(doc.querySelector('g')?.hasAttribute('clip-path')).toBe(false);
  });

  it('should remove exact element bounds clip-path for image', () => {
    const svg = `
      <svg width="1000" height="500">
        <clipPath id="image-clip">
          <rect x="10" y="20" width="100" height="200"></rect>
        </clipPath>
        <g clip-path="url(#image-clip)">
          <image x="10" y="20" width="100" height="200" href="foo.png" />
        </g>
      </svg>
    `;
    const doc = createDocument(svg);
    const info: SVGInfo = {
      width: 1000, height: 500, viewBox: null, preserveAspectRatio: ''
    };

    const warnings = optimizeSVGDocument(doc, info);
    
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('element bounds');
    expect(doc.querySelector('clipPath')).toBeNull();
    // Top-level <g> remains, but clip-path is removed
    expect(doc.querySelector('g')?.hasAttribute('clip-path')).toBe(false);
  });

  it('should keep complex clip paths', () => {
    const svg = `
      <svg width="1000" height="500">
        <clipPath id="complex-clip">
          <circle cx="50" cy="50" r="20"></circle>
          <rect x="10" y="20" width="100" height="200"></rect>
        </clipPath>
        <g clip-path="url(#complex-clip)">
          <path d="M0 0 L10 10" />
        </g>
      </svg>
    `;
    const doc = createDocument(svg);
    const info: SVGInfo = {
      width: 1000, height: 500, viewBox: null, preserveAspectRatio: ''
    };

    const warnings = optimizeSVGDocument(doc, info);
    
    expect(warnings).toHaveLength(0); // clip-path is protected on <g>, complex clipPath kept
    expect(doc.querySelector('clipPath')).not.toBeNull();
    expect(doc.querySelector('g')).not.toBeNull();
  });

  it('should remove unused clip paths', () => {
    const svg = `
      <svg width="1000" height="500">
        <clipPath id="unused">
          <path d="M0 0 L10 10" />
        </clipPath>
      </svg>
    `;
    const doc = createDocument(svg);
    const info: SVGInfo = { width: 1000, height: 500, viewBox: null, preserveAspectRatio: '' };

    const warnings = optimizeSVGDocument(doc, info);
    
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('unused');
    expect(doc.querySelector('clipPath')).toBeNull();
  });

  it('should unwrap redundant groups', () => {
    const svg = `
      <svg width="1000" height="500">
        <g id="OuterLayer">
          <g id="InnerLayer">
            <path d="M0 0 L10 10" />
          </g>
        </g>
        <g opacity="0.5">
          <path d="M0 0 L10 10" />
        </g>
        <g>
          <!-- Empty group -->
        </g>
      </svg>
    `;
    const doc = createDocument(svg);
    const info: SVGInfo = { width: 1000, height: 500, viewBox: null, preserveAspectRatio: '' };

    const warnings = optimizeSVGDocument(doc, info);
    
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[warnings.length - 1]).toContain('Unwrapped 2 redundant <g>');
    
    // Top level OuterLayer and opacity group remain, empty group removed
    const allGroups = doc.querySelectorAll('g');
    expect(allGroups.length).toBe(2);
    
    const paths = doc.querySelectorAll('path');
    expect(paths.length).toBe(2);
  });
});
