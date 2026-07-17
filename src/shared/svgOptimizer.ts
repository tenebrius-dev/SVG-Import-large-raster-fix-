import type { SVGInfo } from './types.js';

/**
 * Remove redundant <clipPath> masks and unwrap redundant <g> wrappers.
 * Runs in-place on the Document.
 * Returns a list of optimization messages (warnings).
 *
 * Handles both:
 *  - Direct attribute: clip-path="url(#id)"
 *  - CSS class: .cls-N { clip-path: url(#id); } applied via class="cls-N"
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
   * Handles optional quotes and whitespace inside url().
   */
  function makeIdRegex(id: string): RegExp {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`url\\(['"\\s]*#${esc}['"\\s]*\\)`, 'i');
  }

  /**
   * Parse the SVG <style> block and build a map:
   *   className → list of clipPath ids referenced via clip-path
   *
   * Example: .cls-2 { clip-path: url(#clippath-1); }
   * → { 'cls-2': ['clippath-1'] }
   */
  function buildClassToClipMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const styleEls = Array.from(doc.querySelectorAll('style'));
    for (const styleEl of styleEls) {
      const css = styleEl.textContent || '';
      // Match .className { ... clip-path: url(#id) ... }
      const ruleRe = /\.([\w-]+)\s*\{([^}]*)\}/g;
      let ruleMatch: RegExpExecArray | null;
      while ((ruleMatch = ruleRe.exec(css)) !== null) {
        const className = ruleMatch[1]!;
        const body = ruleMatch[2]!;
        const cpRe = /clip-path\s*:\s*url\(['"]*#([\w-]+)['"]*\)/gi;
        let cpMatch: RegExpExecArray | null;
        while ((cpMatch = cpRe.exec(body)) !== null) {
          const clipId = cpMatch[1]!;
          const existing = map.get(className) ?? [];
          existing.push(clipId);
          map.set(className, existing);
        }
      }
    }
    return map;
  }

  /**
   * Find all elements that reference a given clipPath id.
   * Checks: direct clip-path/clipPath attribute, inline style, and CSS class rules.
   */
  function findClipPathUsages(id: string, classMap: Map<string, string[]>): Element[] {
    const re = makeIdRegex(id);
    const els = allElements();

    return els.filter(el => {
      // 1. Direct attribute
      const attr = el.getAttribute('clip-path') ?? el.getAttribute('clipPath') ?? '';
      if (re.test(attr)) return true;

      // 2. Inline style
      const style = el.getAttribute('style') ?? '';
      if (style.includes('clip-path') && re.test(style)) return true;

      // 3. CSS class
      const classList = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
      for (const cls of classList) {
        const clipIds = classMap.get(cls) ?? [];
        if (clipIds.includes(id)) return true;
      }

      return false;
    });
  }

  /**
   * Remove the clip-path reference pointing to `id` from an element.
   * Also removes CSS classes that only exist to apply this clip-path
   * (if the class has no other declarations).
   */
  function removeClipPathRef(
    el: Element,
    id: string,
    classMap: Map<string, string[]>,
    classOnlyClipMap: Set<string>,
  ): void {
    // Direct attribute
    const attrVal = el.getAttribute('clip-path') ?? el.getAttribute('clipPath') ?? '';
    if (makeIdRegex(id).test(attrVal)) {
      el.removeAttribute('clip-path');
      el.removeAttribute('clipPath');
    }

    // Inline style
    const styleVal = el.getAttribute('style') ?? '';
    if (styleVal.includes('clip-path') && makeIdRegex(id).test(styleVal)) {
      const cleaned = styleVal.replace(/clip-path\s*:\s*url\([^)]*\)\s*;?/gi, '').trim();
      if (cleaned) el.setAttribute('style', cleaned);
      else el.removeAttribute('style');
    }

    // CSS class — remove class if it was clip-path-only
    const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const remaining = classes.filter(cls => {
      const clipIds = classMap.get(cls) ?? [];
      if (clipIds.includes(id)) {
        // Only remove the class if it ONLY sets clip-path (nothing else visual)
        return !classOnlyClipMap.has(cls);
      }
      return true;
    });
    if (remaining.length !== classes.length) {
      if (remaining.length > 0) el.setAttribute('class', remaining.join(' '));
      else el.removeAttribute('class');
    }
  }

  // ── Build CSS class → clipPath map ────────────────────────────────────
  const classToClipMap = buildClassToClipMap();

  // Determine which classes ONLY set clip-path (so they can be fully removed)
  const classOnlyClipSet = new Set<string>();
  const styleEls = Array.from(doc.querySelectorAll('style'));
  for (const styleEl of styleEls) {
    const css = styleEl.textContent || '';
    const ruleRe = /\.([\w-]+)\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css)) !== null) {
      const cls = m[1]!;
      const body = m[2]!.trim();
      // Only clip-path declaration?
      const withoutCp = body.replace(/clip-path\s*:\s*url\([^)]*\)\s*;?/gi, '').trim();
      if (!withoutCp) classOnlyClipSet.add(cls);
    }
  }

  // ── Gather all <clipPath> elements ─────────────────────────────────────
  const clipPaths = allElements().filter(
    el => el.tagName === 'clipPath' || el.tagName.toLowerCase() === 'clippath',
  );

  for (const clip of clipPaths) {
    const id = clip.getAttribute('id');
    if (!id) continue;

    const children = Array.from(clip.children);

    // ── Rule A: Empty <clipPath> ──────────────────────────────────────────
    if (children.length === 0) {
      const usages = findClipPathUsages(id, classToClipMap);
      warnings.push(`Removed empty clip-path "#${id}"`);
      usages.forEach(el => removeClipPathRef(el, id, classToClipMap, classOnlyClipSet));
      clip.remove();
      continue;
    }

    // ── Rule B: Unused <clipPath> ─────────────────────────────────────────
    const usages = findClipPathUsages(id, classToClipMap);
    if (usages.length === 0) {
      warnings.push(`Removed unused clip-path "#${id}"`);
      clip.remove();
      continue;
    }

    // Only analyze single-rect clips further
    if (children.length !== 1 || children[0]!.tagName.toLowerCase() !== 'rect') continue;

    const rect = children[0]!;
    const rx = parseFloat(rect.getAttribute('x') || '0');
    const ry = parseFloat(rect.getAttribute('y') || '0');
    const rw = parseFloat(rect.getAttribute('width') || '0');
    const rh = parseFloat(rect.getAttribute('height') || '0');

    // ── Rule C & D: Rectangular Bounding Box Clip ─────────────────────────
    // In SVGs exported from design tools, single-rect clipPaths are almost
    // entirely garbage bounding boxes (artboard bounds or image bounds).
    // Because calculating exact bounds across nested transform matrices in pure
    // JS is unreliable, we aggressively remove all single-rect clipPaths.
    warnings.push(`Removed rectangular bounding-box clip-path "#${id}"`);
    usages.forEach(el => removeClipPathRef(el, id, classToClipMap, classOnlyClipSet));
    clip.remove();
  }

  // ── Clean up <style> block ─────────────────────────────────────────────
  // After removing clipPath definitions and their class attributes from elements,
  // also remove the CSS rules that reference those clip-paths from the <style> block.
  // Figma reads and applies <style> CSS during SVG import, so orphaned clip-path
  // CSS rules would still create "Clip path group" layers.
  //
  // We remove entire CSS rules (.cls-N { ... }) that contain clip-path declarations
  // pointing to clip-path IDs that no longer exist in the document.
  const remainingClipIds = new Set(
    allElements()
      .filter(el => el.tagName === 'clipPath' || el.tagName.toLowerCase() === 'clippath')
      .map(el => el.getAttribute('id'))
      .filter(Boolean) as string[],
  );

  for (const styleEl of Array.from(doc.querySelectorAll('style'))) {
    let css = styleEl.textContent || '';

    // Remove CSS rules whose clip-path references a deleted clipPath id
    css = css.replace(/\.([\w-]+)\s*\{([^}]*)\}/g, (fullRule, _cls, body) => {
      const cpRe = /clip-path\s*:\s*url\(['"]*#([\w-]+)['"]*\)/gi;
      let cpMatch: RegExpExecArray | null;
      let hasDeletedClip = false;

      while ((cpMatch = cpRe.exec(body)) !== null) {
        const clipId = cpMatch[1]!;
        if (!remainingClipIds.has(clipId)) {
          hasDeletedClip = true;
          break;
        }
      }

      if (hasDeletedClip) {
        // Remove only the clip-path declaration from the body; if nothing remains, drop entire rule
        const cleanedBody = body.replace(/clip-path\s*:\s*url\([^)]*\)\s*;?/gi, '').trim();
        if (!cleanedBody) return ''; // Remove entire rule
        return fullRule.replace(body, cleanedBody); // Keep rule, remove only clip-path line
      }
      return fullRule; // Keep as-is
    });

    // Clean up extra blank lines
    css = css.replace(/\n{3,}/g, '\n\n').trim();
    styleEl.textContent = css || '';

    // If style block is now empty, remove it entirely
    if (!css) styleEl.remove();
  }

  // ── Rule E: Redundant no-op <g> wrappers ───────────────────────────────
  // Unwrap <g> elements that carry no meaningful attributes AND wrap exactly
  // one child. Process bottom-up so inner redundant groups collapse first.
  const protectedAttrs = new Set([
    'clip-path', 'clipPath', 'mask', 'filter', 'opacity',
    'display', 'visibility', 'pointer-events',
  ]);
  const graphicsTags = new Set([
    'g', 'path', 'rect', 'circle', 'ellipse', 'line',
    'polyline', 'polygon', 'text', 'tspan', 'image', 'use', 'svg',
  ]);

  let groupsRemoved = 0;
  const groups = allElements().filter(el => el.tagName.toLowerCase() === 'g').reverse();

  for (const g of groups) {
    let hasProtected = false;
    for (const attr of Array.from(g.attributes)) {
      if (protectedAttrs.has(attr.name.toLowerCase())) {
        hasProtected = true;
        break;
      }
    }
    if (hasProtected) continue;

    const validChildren = Array.from(g.children).filter(child => graphicsTags.has(child.tagName.toLowerCase()));
    if (validChildren.length !== 1 || g.children.length !== 1) continue;

    const child = validChildren[0]!;

    if (g.hasAttribute('transform') && child.hasAttribute('transform')) continue;

    for (const attr of Array.from(g.attributes)) {
      if (attr.name === 'id' || attr.name === 'data-name') {
        // Outer groups often contain the human-readable layer name.
        // Because we process bottom-up, outer groups are processed last,
        // so overwriting here ensures the outermost name wins.
        child.setAttribute(attr.name, attr.value);
      } else if (!child.hasAttribute(attr.name)) {
        child.setAttribute(attr.name, attr.value);
      } else if (attr.name === 'class') {
        child.setAttribute('class', `${attr.value} ${child.getAttribute('class')}`.trim());
      }
    }

    g.parentNode?.replaceChild(child, g);
    groupsRemoved++;
  }

  if (groupsRemoved > 0) {
    warnings.push(`Unwrapped ${groupsRemoved} redundant <g> groups`);
  }

  return warnings;
}
