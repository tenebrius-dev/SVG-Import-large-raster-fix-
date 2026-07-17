import type { SVGInfo } from './types.js';

/**
 * Remove redundant <clipPath> masks and unwrap redundant <g> wrappers.
 * Runs in-place on the Document.
 * Returns a list of optimization messages (warnings).
 *
 * Uses TreeWalker + precise regex matching to avoid false prefix matches
 * (e.g. "#clippath" vs "#clippath-1").
 */
export function optimizeSVGDocument(doc: Document, info: SVGInfo): string[] {
  const warnings: string[] = [];
  const root = doc.documentElement;

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Walk all Element nodes in the document subtree. */
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
   * Build a regex that matches `url(#id)` exactly — NOT `url(#id-suffix)`.
   * Handles optional quotes and whitespace.
   */
  function makeIdRegex(id: string): RegExp {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // After #id must come ) or whitespace or quote — not a word char
    return new RegExp(`url\\(['"\\s]*#${esc}['"\\s]*\\)`, 'i');
  }

  /**
   * Find all elements that reference a given clipPath id **exactly**.
   * Checks both the `clip-path` attribute and inline `style`.
   * Uses TreeWalker to avoid querySelectorAll attribute-selector quirks.
   */
  function findClipPathUsages(id: string): Element[] {
    const re = makeIdRegex(id);
    return allElements().filter(el => {
      const attr = el.getAttribute('clip-path') ?? el.getAttribute('clipPath') ?? '';
      if (re.test(attr)) return true;
      const style = el.getAttribute('style') ?? '';
      return style.includes('clip-path') && re.test(style);
    });
  }

  /** Remove the clip-path reference pointing to `id` from an element. */
  function removeClipPathRef(el: Element, id: string): void {
    const re = makeIdRegex(id);
    const attr = el.getAttribute('clip-path') ?? el.getAttribute('clipPath') ?? '';
    if (re.test(attr)) {
      el.removeAttribute('clip-path');
      el.removeAttribute('clipPath');
    }
    const style = el.getAttribute('style') ?? '';
    if (style.includes('clip-path') && re.test(style)) {
      // Remove the clip-path: url(#id) declaration from style
      const cleaned = style.replace(/clip-path\s*:\s*url\([^)]*\)\s*;?/gi, '').trim();
      if (cleaned) el.setAttribute('style', cleaned);
      else el.removeAttribute('style');
    }
  }

  // ── Gather all <clipPath> elements ─────────────────────────────────────
  // Collect once up-front so DOM mutations during the loop don't affect iteration.
  const clipPaths = allElements().filter(
    el => el.tagName === 'clipPath' || el.tagName.toLowerCase() === 'clippath',
  );

  for (const clip of clipPaths) {
    const id = clip.getAttribute('id');
    if (!id) continue;

    const children = Array.from(clip.children);

    // ── Rule A: Completely empty <clipPath> (no children) ─────────────────
    if (children.length === 0) {
      const usages = findClipPathUsages(id);
      warnings.push(`Removed empty clip-path "#${id}"`);
      usages.forEach(el => removeClipPathRef(el, id));
      clip.remove();
      continue;
    }

    // ── Rule B: Unused <clipPath> ────────────────────────────────────────
    const usages = findClipPathUsages(id);
    if (usages.length === 0) {
      warnings.push(`Removed unused clip-path "#${id}"`);
      clip.remove();
      continue;
    }

    // From here: clipPath has children and IS referenced.
    // Only continue analysis for the simple single-rect case.
    if (children.length !== 1 || children[0]!.tagName.toLowerCase() !== 'rect') continue;

    const rect = children[0]!;
    const rx = parseFloat(rect.getAttribute('x') || '0');
    const ry = parseFloat(rect.getAttribute('y') || '0');
    const rw = parseFloat(rect.getAttribute('width') || '0');
    const rh = parseFloat(rect.getAttribute('height') || '0');

    // ── Rule C: Artboard-bounds clip ─────────────────────────────────────
    // The clip rect equals the full SVG document size.
    // Figma wraps everything in its own frame, so this clip is always redundant.
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
    // The clip rect perfectly matches the exact size of the clipped element,
    // meaning the clip has zero visual effect.
    if (usages.length === 1) {
      const usage = usages[0]!;
      let ex = NaN, ey = NaN, ew = NaN, eh = NaN;

      if (usage.tagName.toLowerCase() === 'image') {
        ex = parseFloat(usage.getAttribute('x') || '0');
        ey = parseFloat(usage.getAttribute('y') || '0');
        ew = parseFloat(usage.getAttribute('width') || '0');
        eh = parseFloat(usage.getAttribute('height') || '0');
      } else if (usage.tagName.toLowerCase() === 'g' && usage.children.length === 1) {
        const child = usage.children[0]!;
        // Only if the single child is an image — don't guess bounds of complex groups
        if (child.tagName.toLowerCase() === 'image') {
          ex = parseFloat(child.getAttribute('x') || '0');
          ey = parseFloat(child.getAttribute('y') || '0');
          ew = parseFloat(child.getAttribute('width') || '0');
          eh = parseFloat(child.getAttribute('height') || '0');
        }
      }

      if (!isNaN(ex) && !isNaN(ey) && !isNaN(ew) && !isNaN(eh)) {
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
  }

  // ── Rule E: Redundant no-op <g> wrappers ───────────────────────────────
  // Unwrap <g> elements that carry no meaningful attributes AND wrap exactly
  // one child. Process bottom-up so inner redundant groups collapse first.
  //
  // NEVER unwrap if the group has clip-path, mask, filter, opacity, display,
  // visibility, or pointer-events — these all have visual/semantic meaning.
  const protectedAttrs = new Set([
    'clip-path', 'clipPath', 'mask', 'filter', 'opacity',
    'display', 'visibility', 'pointer-events',
  ]);
  const graphicsTags = new Set([
    'g', 'path', 'rect', 'circle', 'ellipse', 'line',
    'polyline', 'polygon', 'text', 'tspan', 'image', 'use', 'svg',
  ]);

  let groupsRemoved = 0;
  // Re-collect after clip-path mutations, process bottom-up
  const groups = allElements().filter(el => el.tagName.toLowerCase() === 'g').reverse();

  for (const g of groups) {
    // Skip if group has any protected attribute
    const hasProtected = Array.from(g.attributes).some(a => protectedAttrs.has(a.name));
    if (hasProtected) continue;

    const graphicsChildren = Array.from(g.children).filter(c =>
      graphicsTags.has(c.tagName.toLowerCase()),
    );

    if (graphicsChildren.length === 1 && g.children.length === graphicsChildren.length) {
      const parent = g.parentNode;
      if (!parent) continue;
      const child = graphicsChildren[0]!;

      // Merge safe attributes down to child before removing the group
      for (const attr of Array.from(g.attributes)) {
        const name = attr.name;
        if (protectedAttrs.has(name)) continue;
        const childVal = child.getAttribute(name);
        if (name === 'transform') {
          child.setAttribute('transform', childVal ? `${attr.value} ${childVal}` : attr.value);
        } else if (name === 'class') {
          child.setAttribute('class', childVal ? `${attr.value} ${childVal}` : attr.value);
        } else if (name === 'style') {
          child.setAttribute('style', childVal ? `${attr.value}; ${childVal}` : attr.value);
        } else if (!childVal) {
          child.setAttribute(name, attr.value);
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
