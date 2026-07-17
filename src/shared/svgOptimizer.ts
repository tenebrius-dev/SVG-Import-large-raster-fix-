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

    // ── Rule C: Artboard-bounds clip ──────────────────────────────────────
    const isArtboardClip =
      Math.abs(rx) < 1.5 &&
      Math.abs(ry) < 1.5 &&
      Math.abs(rw - info.width) < 5 &&
      Math.abs(rh - info.height) < 5;

    if (isArtboardClip) {
      warnings.push(`Removed redundant clip-path "#${id}" (document bounds)`);
      usages.forEach(el => removeClipPathRef(el, id, classToClipMap, classOnlyClipSet));
      clip.remove();
      continue;
    }

    // ── Rule D: Element-bounds clip (single <image> usage only) ──────────
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
        if (child.tagName.toLowerCase() === 'image') {
          ex = parseFloat(child.getAttribute('x') || '0');
          ey = parseFloat(child.getAttribute('y') || '0');
          ew = parseFloat(child.getAttribute('width') || '0');
          eh = parseFloat(child.getAttribute('height') || '0');
        }
      }

      if (!isNaN(ew) && ew > 0) {
        const isElementBounds =
          Math.abs(rx - ex) < 0.1 &&
          Math.abs(ry - ey) < 0.1 &&
          Math.abs(rw - ew) < 1 &&
          Math.abs(rh - eh) < 1;

        if (isElementBounds) {
          warnings.push(`Removed redundant clip-path "#${id}" (element bounds)`);
          usages.forEach(el => removeClipPathRef(el, id, classToClipMap, classOnlyClipSet));
          clip.remove();
        }
      }
    }
  }

  return warnings;
}
