/**
 * svgParser.ts — Parse SVG document metadata.
 *
 * Uses DOMParser — runs in UI iframe ONLY (not in plugin sandbox).
 *
 * Extracts:
 *  - root <svg> width, height (resolved from attributes or viewBox)
 *  - viewBox
 *  - preserveAspectRatio
 */

import type { SVGInfo, SVGViewBox } from './types.js';

// ---------------------------------------------------------------------------
// Main parsing entry
// ---------------------------------------------------------------------------

/**
 * Parse an SVG string and extract document-level metadata.
 * @throws if the SVG is not well-formed XML.
 */
export function parseSVGDocument(svgString: string): {
  doc: Document;
  info: SVGInfo;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  // Check for parser errors
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    throw new Error(`Invalid SVG: ${errorNode.textContent?.slice(0, 200)}`);
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    throw new Error('Document root is not an <svg> element');
  }

  const info = extractSVGInfo(root);
  return { doc, info };
}

// ---------------------------------------------------------------------------
// SVG info extraction
// ---------------------------------------------------------------------------

export function extractSVGInfo(svgEl: Element): SVGInfo {
  const viewBox = parseViewBox(svgEl.getAttribute('viewBox'));
  const par = svgEl.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet';

  // Resolve width / height
  const rawW = svgEl.getAttribute('width');
  const rawH = svgEl.getAttribute('height');

  const width = resolveLength(rawW, viewBox?.width ?? 300);
  const height = resolveLength(rawH, viewBox?.height ?? 150);

  return { width, height, viewBox, preserveAspectRatio: par };
}

/** Parse a viewBox="x y w h" string. Returns null if absent or invalid. */
function parseViewBox(raw: string | null | undefined): SVGViewBox | null {
  if (!raw) return null;
  const nums = raw.trim().split(/[\s,]+/).map(Number);
  if (nums.length < 4 || nums.some(isNaN)) return null;
  const [x, y, w, h] = nums;
  if (w! <= 0 || h! <= 0) return null;
  return { x: x!, y: y!, width: w!, height: h! };
}

/**
 * Resolve a raw SVG length string to a number.
 * Handles px, em-less numbers, and % (uses `fallback` for %).
 */
function resolveLength(raw: string | null | undefined, fallback: number): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) return fallback; // percentage → use viewBox fallback
  const n = parseFloat(trimmed);
  return isNaN(n) ? fallback : n;
}
