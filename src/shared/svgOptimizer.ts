import type { SVGInfo } from './types.js';

/**
 * Remove redundant <clipPath> masks from an SVG Document.
 * Runs in-place on the Document.
 * Returns a list of optimization messages (warnings).
 *
 * SAFE rules only:
 *  - Rule 1: Remove artboard-bounds clip-paths (whole document rect) — safe, Figma adds its own bounds.
 *  - Rule 2: Remove truly empty <clipPath> elements (no children at all).
 *  - Rule 3: Unwrap <g> groups that have NO attributes and a single child — purely structural wrappers.
 *
 * REMOVED (too risky):
 *  - "Element bounds" clip-path matching — can cause false positives.
 *  - "Unused clip-path" detection — querySelectorAll('[clip-path]') is unreliable in Figma iframe.
 */
export function optimizeSVGDocument(doc: Document, info: SVGInfo): string[] {
  const warnings: string[] = [];

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Find all elements that reference a given clipPath id (attribute or style). */
  function findClipPathUsages(id: string): Element[] {
    const usages: Element[] = [];
    // Walk the entire document manually — more reliable than querySelectorAll
    const walker = doc.createTreeWalker(doc.documentElement, 0x1 /* SHOW_ELEMENT */);
    let node: Node | null = walker.currentNode;
    while (node) {
      const el = node as Element;
      const attrVal = el.getAttribute('clip-path') || el.getAttribute('clipPath') || '';
      if (attrVal.includes(`#${id}`) && attrVal.includes('url(')) {
        usages.push(el);
      } else {
        const styleVal = el.getAttribute('style') || '';
        if (styleVal.includes('clip-path') && styleVal.includes(`#${id}`) && styleVal.includes('url(')) {
          usages.push(el);
        }
      }
      node = walker.nextNode();
    }
    return usages;
  }

  /** Remove clip-path references (attribute + inline style) from an element. */
  function removeClipPathUsage(el: Element, id: string): void {
    const attrVal = el.getAttribute('clip-path') || el.getAttribute('clipPath') || '';
    if (attrVal.includes(`#${id}`)) {
      el.removeAttribute('clip-path');
      el.removeAttribute('clipPath');
    }
    const styleVal = el.getAttribute('style') || '';
    if (styleVal.includes('clip-path') && styleVal.includes(`#${id}`)) {
      const cleaned = styleVal.replace(/clip-path\s*:\s*url\([^)]*\)\s*;?/gi, '').trim();
      if (cleaned) el.setAttribute('style', cleaned);
      else el.removeAttribute('style');
    }
  }

  // ── Rule 1: Artboard-bounds clip paths ────────────────────────────────────
  // These are <clipPath> elements that clip exactly to the full document rect.
  // Figma adds its own frame bounds, so these are always redundant.
  const allClipPaths = Array.from(doc.querySelectorAll('clipPath'));
  for (const clip of allClipPaths) {
    const id = clip.getAttribute('id');
    if (!id) continue;

    const children = Array.from(clip.children);
    if (children.length !== 1 || children[0]!.tagName.toLowerCase() !== 'rect') continue;

    const rect = children[0]!;
    const x = parseFloat(rect.getAttribute('x') || '0');
    const y = parseFloat(rect.getAttribute('y') || '0');
    const w = parseFloat(rect.getAttribute('width') || '0');
    const h = parseFloat(rect.getAttribute('height') || '0');

    const isArtboardClip =
      Math.abs(x) < 0.1 &&
      Math.abs(y) < 0.1 &&
      Math.abs(w - info.width) < 1 &&
      Math.abs(h - info.height) < 1;

    if (!isArtboardClip) continue;

    // Verify it's actually used before removing (belt-and-suspenders)
    const usages = findClipPathUsages(id);
    warnings.push(`Removed redundant clip-path "#${id}" (document bounds)`);
    usages.forEach(el => removeClipPathUsage(el, id));
    clip.remove();
  }

  // ── Rule 2: Completely empty <clipPath> elements ───────────────────────────
  // A <clipPath> with zero children is invalid and can cause rendering issues.
  const remainingClipPaths = Array.from(doc.querySelectorAll('clipPath'));
  for (const clip of remainingClipPaths) {
    const id = clip.getAttribute('id');
    if (!id) continue;
    if (clip.children.length === 0) {
      const usages = findClipPathUsages(id);
      warnings.push(`Removed empty clip-path "#${id}"`);
      usages.forEach(el => removeClipPathUsage(el, id));
      clip.remove();
    }
  }

  // ── Rule 3: Pure no-attribute single-child <g> wrappers ───────────────────
  // Only unwrap if:
  //   a) The <g> has NO attributes at all (no id, class, style, clip-path, transform, etc.)
  //   b) The <g> has exactly 1 child element.
  // This is the most conservative possible approach.
  const graphicsTags = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'image', 'use', 'svg']);
  let groupsRemoved = 0;

  // Process bottom-up
  const groups = Array.from(doc.querySelectorAll('g')).reverse();
  for (const g of groups) {
    // Must have zero attributes — any attribute means it carries semantic information
    if (g.attributes.length > 0) continue;

    const graphicsChildren = Array.from(g.children).filter(c =>
      graphicsTags.has(c.tagName.toLowerCase()),
    );

    if (graphicsChildren.length === 1 && g.children.length === 1) {
      // Safe to unwrap: move child out, delete group
      const parent = g.parentNode;
      if (!parent) continue;
      const child = graphicsChildren[0]!;
      parent.insertBefore(child, g);
      g.remove();
      groupsRemoved++;
    }
  }

  if (groupsRemoved > 0) {
    warnings.push(`Unwrapped ${groupsRemoved} redundant <g> groups`);
  }

  return warnings;
}
