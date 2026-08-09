/**
 * security.ts — SVG sanitization before import.
 *
 * Removes potentially dangerous content from SVG documents:
 *   - <script> elements
 *   - on* event handler attributes
 *   - javascript: href values
 *   - <foreignObject> (can embed HTML)
 *   - External image references (http:// / https://) — logs warning
 *
 * Runs in UI iframe (uses DOM).
 * Returns a cleaned SVG string.
 */

/** Attributes that can contain executable code */
const DANGEROUS_ATTRS = [
  'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
  'onchange', 'onsubmit', 'onkeydown', 'onkeypress', 'onkeyup',
  'onabort', 'onerror', 'onscroll', 'onwheel',
];

function getXMLSerializer(): XMLSerializer {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer();
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<svg></svg>', { contentType: 'image/svg+xml', url: 'https://example.com' });
    return new dom.window.XMLSerializer();
  } catch (e) {
    throw new Error(`XMLSerializer is not available in this environment: ${(e as Error).message}`);
  }
}

export interface SanitizeResult {
  svgString: string;
  warnings: string[];
}

/**
 * Sanitize an SVG document node in-place and return a serialized string.
 * @param doc — Parsed SVG document (from DOMParser)
 * @param originalFileName — Used in warnings
 */
export function sanitizeSVGDocument(doc: Document, originalFileName: string): SanitizeResult {
  const warnings: string[] = [];

  // 1. Remove <script> elements
  const scripts = doc.querySelectorAll('script');
  if (scripts.length > 0) {
    warnings.push(`Removed ${scripts.length} <script> element(s) from "${originalFileName}"`);
    scripts.forEach((el) => el.remove());
  }

  // 2. Remove <foreignObject> elements
  const foreign = doc.querySelectorAll('foreignObject');
  if (foreign.length > 0) {
    warnings.push(`Removed ${foreign.length} <foreignObject> element(s) from "${originalFileName}"`);
    foreign.forEach((el) => el.remove());
  }

  // 3. Remove on* event handler attributes from all elements
  const allElements = doc.querySelectorAll('*');
  allElements.forEach((el) => {
    // Check all attributes
    const attrNames = Array.from(el.attributes).map((a) => a.name);
    attrNames.forEach((attr) => {
      if (
        DANGEROUS_ATTRS.includes(attr.toLowerCase()) ||
        attr.toLowerCase().startsWith('on')
      ) {
        el.removeAttribute(attr);
        warnings.push(`Removed event handler attribute "${attr}" from element <${el.tagName}>`);
      }
    });

    // Remove javascript: href values
    const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href && href.trim().toLowerCase().startsWith('javascript:')) {
      el.removeAttribute('href');
      el.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      warnings.push(`Removed javascript: href from element <${el.tagName}>`);
    }
  });

  // 4. Warn about external image references (don't block — user may need them)
  const images = doc.querySelectorAll('image');
  images.forEach((img) => {
    const href =
      img.getAttribute('href') ??
      img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
      '';
    if (href.startsWith('http://') || href.startsWith('https://')) {
      warnings.push(
        `External image reference detected: "${href.slice(0, 80)}..." — will not be auto-loaded`,
      );
    }
  });

  // Serialize back to string
  const serializer = getXMLSerializer();
  const svgString = serializer.serializeToString(doc.documentElement);

  return { svgString, warnings };
}
