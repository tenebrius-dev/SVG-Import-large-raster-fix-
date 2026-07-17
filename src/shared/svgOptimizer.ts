import type { SVGInfo } from './types.js';

/**
 * Remove redundant <clipPath> masks and unwrap redundant <g> wrappers.
 * Runs in-place on the Document.
 * Returns a list of optimization messages (warnings).
 *
 * Uses TreeWalker for element traversal — more reliable than querySelectorAll
 * in Figma's sandboxed iframe environment where attribute selectors for SVG
 * may behave inconsistently.
 */
export function optimizeSVGDocument(doc: Document, info: SVGInfo): string[] {
  const warnings: string[] = [];
  const root = doc.documentElement;

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Walk all Element nodes in the document. */
  function allElements(): Element[] {
    const els: Element[] = [];
    const walker = doc.createTreeWalker(root, 0x1 /* SHOW_ELEMENT */);
    let node: Node | null = walker.currentNode;
    while (node) {
      els.push(node as Element);
      node = walker.nextNode();
    }
    return els;
  }

  /**
   * Find all elements that reference a given clipPath id.
   * Checks both the `clip-path` attribute and inline `style`.
   * Uses TreeWalker to avoid querySelectorAll attribute-selector quirks.
   */
  function findClipPathUsages(id: string): Element[] {
    const needle = `#${id}`;
    return allElements().filter(el => {
      const attr = el.getAttribute('clip-path') ?? el.getAttribute('clipPath') ?? '';
      if (attr.includes(needle) && attr.includes('url(')) return true;
      const style = el.getAttribute('style') ?? '';
      return style.includes('clip-path') && style.includes(needle) && style.includes('url(');
    });
  }

  /** Remove the clip-path reference pointing to `id` from an element. */
  function removeClipPathRef(el: Element, id: string): void {
    const needle = `#${id}`;
    const attr = el.getAttribute('clip-path') ?? el.getAttribute('clipPath') ?? '';
    if (attr.includes(needle)) {
      el.removeAttribute('clip-path');
      el.removeAttribute('clipPath');
    }
    const style = el.getAttribute('style') ?? '';
    if (style.includes('clip-path') && style.includes(needle)) {
      const cleaned = style.replace(/clip-path\s*:\s*url\([^)]*\)\s*;?/gi, '').trim();
      if (cleaned) el.setAttribute('style', cleaned);
      else el.removeAttribute('style');
    }
  }

  // ── Gather all <clipPath> elements ─────────────────────────────────────
  const clipPaths = allElements().filter(el => el.tagName.toLowerCase() === 'clippath' || el.tagName === 'clipPath');

  for (const clip of clipPaths) {
    const id = clip.getAttribute('id');
    if (!id) continue;

    const usages = findClipPathUsages(id);
    const children = Array.from(clip.children);

    // ── Rule A: Completely empty <clipPath> (no children) ─────────────────
    // Invalid SVG, causes rendering issues. Safe to remove unconditionally.
    if (children.length === 0) {
      warnings.push(`Removed empty clip-path "#${id}"`);
      usages.forEach(el => removeClipPathRef(el, id));
      clip.remove();
      continue;
    }

    // ── Rule B: Unused <clipPath> ────────────────────────────────────────
    // If nothing references this clipPath, it's dead code — safe to remove.
    if (usages.length === 0) {
      warnings.push(`Removed unused clip-path "#${id}"`);
      clip.remove();
      continue;
    }

    // From here: the clipPath has children and is actually used.
    // Only remove it if it is provably redundant.

    // We only handle the simple case: single <rect> child.
    if (children.length !== 1 || children[0]!.tagName.toLowerCase() !== 'rect') continue;

    const rect = children[0]!;
    const rx = parseFloat(rect.getAttribute('x') || '0');
    const ry = parseFloat(rect.getAttribute('y') || '0');
    const rw = parseFloat(rect.getAttribute('width') || '0');
    const rh = parseFloat(rect.getAttribute('height') || '0');

    // ── Rule C: Artboard-bounds clip ──────────────────────────────────────
    // The clip rect equals the full document size — Figma adds its own frame
    // boundary, so this clip is always redundant.
    const isArtboardClip =
      Math.abs(rx) < 0.1 &&
      Math.abs(ry) < 0.1 &&
      Math.abs(rw - info.width) < 1 &&
      Math.abs(rh - info.height) < 1;

    if (isArtboardClip) {
      warnings.push(`Removed redundant clip-path "#${id}" (document bounds)`);
      usages.forEach(el => removeClipPathRef(el, id));
      clip.remove();
      continue;
    }

    // ── Rule D: Element-bounds clip (single usage, clip == element bounds) ─
    // The clip rect perfectly matches the clipped element's own size.
    // This means the clip has no visual effect — safe to remove.
    if (usages.length === 1) {
      const usage = usages[0]!;
      let ex: number, ey: number, ew: number, eh: number;

      if (usage.tagName.toLowerCase() === 'image') {
        ex = parseFloat(usage.getAttribute('x') || '0');
        ey = parseFloat(usage.getAttribute('y') || '0');
        ew = parseFloat(usage.getAttribute('width') || '0');
        eh = parseFloat(usage.getAttribute('height') || '0');
      } else if (usage.tagName.toLowerCase() === 'g' && usage.children.length === 1) {
        // <g clip-path="..."><image .../></g>
        const child = usage.children[0]!;
        ex = parseFloat(child.getAttribute('x') || '0');
        ey = parseFloat(child.getAttribute('y') || '0');
        ew = parseFloat(child.getAttribute('width') || '0');
        eh = parseFloat(child.getAttribute('height') || '0');
      } else {
        continue; // Can't determine bounds safely — skip
      }

      const isElementBounds =
        Math.abs(rx - ex) < 0.1 &&
        Math.abs(ry - ey) < 0.1 &&
        Math.abs(rw - ew) < 1 &&
        Math.abs(rh - eh) < 1;

      if (isElementBounds) {
        warnings.push(`Removed redundant clip-path "#${id}" (element bounds)`);
        usages.forEach(el => removeClipPathRef(el, id));
        clip.remove();
      }
    }
  }

  // ── Rule E: Redundant <g> wrappers ─────────────────────────────────────
  // Unwrap <g> elements that carry no meaningful attributes and wrap a single
  // child. Process bottom-up so inner redundant groups collapse first.
  const graphicsTags = new Set([
    'g', 'path', 'rect', 'circle', 'ellipse', 'line',
    'polyline', 'polygon', 'text', 'tspan', 'image', 'use', 'svg',
  ]);
  // Attributes that carry visual/structural meaning — never unwrap if present
  const protectedAttrs = new Set([
    'clip-path', 'clipPath', 'mask', 'filter', 'opacity',
    'display', 'visibility', 'pointer-events',
  ]);

  let groupsRemoved = 0;
  // Re-collect groups after clip-path changes
  const groups = allElements().filter(el => el.tagName.toLowerCase() === 'g').reverse();

  for (const g of groups) {
    // Don't unwrap if group has any protected attribute
    const hasProtectedAttr = Array.from(g.attributes).some(a => protectedAttrs.has(a.name));
    if (hasProtectedAttr) continue;

    const graphicsChildren = Array.from(g.children).filter(c =>
      graphicsTags.has(c.tagName.toLowerCase()),
    );

    if (graphicsChildren.length === 1 && g.children.length === graphicsChildren.length) {
      const parent = g.parentNode;
      if (!parent) continue;
      const child = graphicsChildren[0]!;

      // Merge safe non-protected attributes down to child
      for (const attr of Array.from(g.attributes)) {
        const name = attr.name;
        if (protectedAttrs.has(name)) continue; // shouldn't happen, but guard anyway
        const childVal = child.getAttribute(name);
        if (name === 'transform') {
          child.setAttribute('transform', childVal ? `${attr.value} ${childVal}` : attr.value);
        } else if (name === 'class') {
          child.setAttribute('class', childVal ? `${attr.value} ${childVal}` : attr.value);
        } else if (name === 'style') {
          child.setAttribute('style', childVal ? `${attr.value}; ${childVal}` : attr.value);
        } else if (name === 'id' || name === 'data-name') {
          if (!childVal) child.setAttribute(name, attr.value);
        } else {
          if (!childVal) child.setAttribute(name, attr.value);
        }
      }

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
