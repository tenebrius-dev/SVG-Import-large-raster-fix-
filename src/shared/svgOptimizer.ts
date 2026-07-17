import type { SVGInfo } from './types.js';

function findClipPathUsages(doc: Document, id: string): Element[] {
  const usages: Element[] = [];
  const attrElements = Array.from(doc.querySelectorAll('[clip-path]'));
  for (const el of attrElements) {
    const val = el.getAttribute('clip-path') || '';
    if (val.includes(`#${id}`) && val.includes('url(')) usages.push(el);
  }
  const styleElements = Array.from(doc.querySelectorAll('[style*="clip-path"]'));
  for (const el of styleElements) {
    const val = el.getAttribute('style') || '';
    if (val.includes('clip-path') && val.includes(`#${id}`) && val.includes('url(')) {
      if (!usages.includes(el)) usages.push(el);
    }
  }
  return usages;
}

function removeClipPathUsage(el: Element, id: string): void {
  const attr = el.getAttribute('clip-path');
  if (attr && attr.includes(`#${id}`)) el.removeAttribute('clip-path');
  
  const style = el.getAttribute('style');
  if (style && style.includes('clip-path') && style.includes(`#${id}`)) {
    const newStyle = style.replace(/clip-path\s*:\s*url\([^)]*#[^)]*\)\s*;?/i, '').trim();
    if (newStyle) el.setAttribute('style', newStyle);
    else el.removeAttribute('style');
  }
}

/**
 * Remove redundant <clipPath> masks from an SVG Document.
 * Runs in-place on the Document.
 * Returns a list of optimization messages (warnings).
 */
export function optimizeSVGDocument(doc: Document, info: SVGInfo): string[] {
  const warnings: string[] = [];

  const clipPaths = Array.from(doc.querySelectorAll('clipPath'));

  clipPaths.forEach((clip) => {
    const id = clip.getAttribute('id');
    if (!id) return;

    // A redundant clip path is one that has exactly one <rect> child
    const children = Array.from(clip.children);
    if (children.length !== 1 || children[0]!.tagName.toLowerCase() !== 'rect') {
      return;
    }

    const rect = children[0]!;
    
    // Check if the rect is just covering the entire document (artboard clip)
    const x = parseFloat(rect.getAttribute('x') || '0');
    const y = parseFloat(rect.getAttribute('y') || '0');
    const w = parseFloat(rect.getAttribute('width') || '0');
    const h = parseFloat(rect.getAttribute('height') || '0');

    // Rule 1: Artboard clip
    const isArtboardClip =
      Math.abs(x) < 0.1 &&
      Math.abs(y) < 0.1 &&
      Math.abs(w - info.width) < 1 &&
      Math.abs(h - info.height) < 1;

    let isRedundant = isArtboardClip;
    let reason = 'document bounds';

    // Rule 2: Element bounds clip (e.g., wrapping an image perfectly)
    // We check if this clipPath is used, and if so, if it just wraps exactly what it clips.
    if (!isRedundant) {
      // Find all elements using this clip path
      // Note: CSS selector for exact match
      const usages = findClipPathUsages(doc, id);
      
      if (usages.length === 1) {
        const usage = usages[0]!;
        // Often it's a <g> wrapping a single <image> or <path>
        // But if the clipPath rect matches the exact bounds of the `<image>`, it's redundant.
        // We can do a simple heuristic: if the usage is a <g> and it has 1 child which has the same x, y, width, height.
        if (usage.tagName.toLowerCase() === 'g' && usage.children.length === 1) {
          const child = usage.children[0]!;
          const cx = parseFloat(child.getAttribute('x') || '0');
          const cy = parseFloat(child.getAttribute('y') || '0');
          const cw = parseFloat(child.getAttribute('width') || '0');
          const ch = parseFloat(child.getAttribute('height') || '0');
          
          if (
            Math.abs(x - cx) < 0.1 &&
            Math.abs(y - cy) < 0.1 &&
            Math.abs(w - cw) < 1 &&
            Math.abs(h - ch) < 1
          ) {
            isRedundant = true;
            reason = 'element bounds';
          }
        } else if (usage.tagName.toLowerCase() === 'image') {
          const cx = parseFloat(usage.getAttribute('x') || '0');
          const cy = parseFloat(usage.getAttribute('y') || '0');
          const cw = parseFloat(usage.getAttribute('width') || '0');
          const ch = parseFloat(usage.getAttribute('height') || '0');

          if (
            Math.abs(x - cx) < 0.1 &&
            Math.abs(y - cy) < 0.1 &&
            Math.abs(w - cw) < 1 &&
            Math.abs(h - ch) < 1
          ) {
            isRedundant = true;
            reason = 'element bounds';
          }
        }
      }
    }

    if (isRedundant) {
      warnings.push(`Removed redundant clip-path "#${id}" (${reason})`);
      
      // Remove clip-path attributes from all elements referencing it
      const usages = findClipPathUsages(doc, id);
      usages.forEach(el => removeClipPathUsage(el, id));
      
      // Remove the clipPath definition itself
      clip.remove();
      return;
    }
  });

  // Rule 3: Empty/unused clip paths
  // Only remove empty ones or ones that are completely unused.
  const remainingClipPaths = Array.from(doc.querySelectorAll('clipPath'));
  remainingClipPaths.forEach(clip => {
    const id = clip.getAttribute('id');
    if (!id) return;
    
    const usages = findClipPathUsages(doc, id);
    if (usages.length === 0) {
      warnings.push(`Removed unused clip-path "#${id}"`);
      clip.remove();
    } else if (clip.children.length === 0) {
      warnings.push(`Removed empty clip-path "#${id}"`);
      usages.forEach(el => removeClipPathUsage(el, id));
      clip.remove();
    }
  });

  // Rule 4: Redundant <g> elements
  // We process bottom-up (reverse order) so nested redundant groups collapse upwards.
  const groups = Array.from(doc.querySelectorAll('g')).reverse();
  let groupsRemoved = 0;

  groups.forEach((g) => {
    // Only count visible graphic elements
    const graphicsTags = ['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'image', 'use'];
    const graphicsChildren = Array.from(g.children).filter(c => graphicsTags.includes(c.tagName.toLowerCase()));
    
    // If no graphic elements, but maybe defs/title? Move them out and remove the group
    if (graphicsChildren.length === 0) {
      while (g.firstChild) {
        g.parentNode?.insertBefore(g.firstChild, g);
      }
      g.remove();
      groupsRemoved++;
      return;
    }

    // If exactly 1 graphic element child, check if we can unwrap
    if (graphicsChildren.length === 1) {
      const child = graphicsChildren[0]!;
      
      // Check if we can safely merge attributes
      const unmergeable = ['opacity', 'clip-path', 'mask', 'filter'];
      let canUnwrap = true;
      for (const attr of unmergeable) {
        if (g.hasAttribute(attr) && child.hasAttribute(attr)) {
          canUnwrap = false;
          break;
        }
      }

      if (canUnwrap) {
        // Merge attributes down to the single graphic child
        for (const attr of Array.from(g.attributes)) {
          const name = attr.name;
          const pVal = attr.value;
          const cVal = child.getAttribute(name);

          if (name === 'transform') {
            child.setAttribute('transform', cVal ? `${pVal} ${cVal}` : pVal);
          } else if (name === 'class') {
            child.setAttribute('class', cVal ? `${pVal} ${cVal}` : pVal);
          } else if (name === 'style') {
            child.setAttribute('style', cVal ? `${pVal}; ${cVal}` : pVal);
          } else if (name === 'id' || name === 'data-name') {
            if (!cVal) child.setAttribute(name, pVal);
          } else {
            // Presentation attributes (fill, stroke, etc.)
            // Child overrides parent. So if child doesn't have it, inherit from parent.
            if (!cVal) child.setAttribute(name, pVal);
          }
        }

        // Move ALL nodes (including text nodes, defs, etc) out of the group, then remove group
        while (g.firstChild) {
          g.parentNode?.insertBefore(g.firstChild, g);
        }
        g.remove();
        groupsRemoved++;
      }
    }
  });

  if (groupsRemoved > 0) {
    warnings.push(`Unwrapped ${groupsRemoved} redundant <g> groups`);
  }

  return warnings;
}
