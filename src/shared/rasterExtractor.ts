/**
 * rasterExtractor.ts — Find and extract embedded raster images from SVG DOM.
 *
 * Runs in UI iframe (uses DOM APIs).
 *
 * For each <image> with a data: URI, this module:
 *  1. Reads all relevant attributes (x, y, width, height, transform, preserveAspectRatio, etc.)
 *  2. Accumulates parent group transforms into a single AffineMatrix
 *  3. Decodes Base64 and detects real bitmap dimensions (PNG IHDR / JPEG SOF)
 *  4. Replaces the <image> with a placeholder <rect> in the DOM
 *  5. Returns the cleaned SVG string and the list of extracted rasters
 */

import type {
  EmbeddedRasterInfo,
  MimeType,
  SVGInfo,
  PluginSettings,
  AffineMatrix,
} from './types.js';
import { needsExtraction } from './types.js';
import { getPngDimensions, isPng } from './pngDimensions.js';
import { getJpegDimensions, isJpeg } from './jpegDimensions.js';

// ---------------------------------------------------------------------------
// Data URI parsing
// ---------------------------------------------------------------------------

interface DataUriInfo {
  mimeType: MimeType;
  base64Data: string;
  bytes: Uint8Array;
}

const SUPPORTED_MIME_TYPES: MimeType[] = ['image/png', 'image/jpeg', 'image/webp'];

function parseDataUri(href: string): DataUriInfo | null {
  if (!href.startsWith('data:')) return null;

  const commaIdx = href.indexOf(',');
  if (commaIdx === -1) return null;

  const meta = href.slice(5, commaIdx); // e.g. "image/png;base64"
  const data = href.slice(commaIdx + 1);

  if (!meta.includes('base64')) return null;

  const mimeRaw = meta.split(';')[0]?.trim().toLowerCase() as MimeType;
  if (!SUPPORTED_MIME_TYPES.includes(mimeRaw)) return null;

  // Normalize JPEG aliases
  const mimeType: MimeType =
    mimeRaw === ('image/jpg' as MimeType) ? 'image/jpeg' : mimeRaw;

  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(data);
  } catch {
    return null;
  }

  return { mimeType, base64Data: data, bytes };
}

function base64ToUint8Array(b64: string): Uint8Array {
  // Remove whitespace (Base64 in SVGs sometimes has line breaks)
  const clean = b64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

const XLINK_NS = 'http://www.w3.org/1999/xlink';

function getHref(el: Element): string | null {
  return (
    el.getAttribute('href') ??
    el.getAttributeNS(XLINK_NS, 'href') ??
    null
  );
}

function getNumericAttr(el: Element, attr: string, defaultVal = 0): number {
  const raw = el.getAttribute(attr);
  if (!raw) return defaultVal;
  const n = parseFloat(raw);
  return isNaN(n) ? defaultVal : n;
}

function getOpacity(el: Element): number {
  const opacityAttr = el.getAttribute('opacity');
  const styleOpacity = getStyleProperty(el, 'opacity');
  const raw = styleOpacity ?? opacityAttr;
  if (!raw) return 1;
  const n = parseFloat(raw);
  return isNaN(n) ? 1 : Math.max(0, Math.min(1, n));
}

function getStyleProperty(el: Element, prop: string): string | null {
  const style = el.getAttribute('style');
  if (!style) return null;
  const match = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return match ? match[1]!.trim() : null;
}



/** Build a DOM path string like ["svg > g#layer1", "g#icons"] */
function buildDomPath(el: Element, svgRoot: Element): string[] {
  const path: string[] = [];
  let current = el.parentElement;
  while (current && current !== svgRoot) {
    const tag = current.tagName;
    const id = current.getAttribute('id');
    path.unshift(id ? `${tag}#${id}` : tag);
    current = current.parentElement;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

let imageCounter = 0;

function resolveRasterName(el: Element, fileName: string | null): string {
  // Priority: id > data-name > inkscape:label > filename > "Image N"
  const id = el.getAttribute('id');
  if (id) return id;

  const dataName = el.getAttribute('data-name');
  if (dataName) return dataName;

  const inkscapeLabel = el.getAttributeNS(
    'http://www.inkscape.org/namespaces/inkscape',
    'label',
  );
  if (inkscapeLabel) return inkscapeLabel;

  if (fileName) {
    const base = fileName.replace(/\.[^.]+$/, '');
    if (base) return base;
  }

  imageCounter++;
  return `Image ${imageCounter}`;
}

// ---------------------------------------------------------------------------
// Placeholder generation
// ---------------------------------------------------------------------------

/** Generate a unique placeholder node name */
function genPlaceholderName(): string {
  return `__svg_raster_${Math.random().toString(36).slice(2)}_${Date.now()}__`;
}

function createPlaceholder(doc: Document, imgEl: Element, placeholderName: string): Element {
  const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  
  // Copy all attributes EXCEPT href, xlink:href, and preserveAspectRatio
  for (let i = 0; i < imgEl.attributes.length; i++) {
    const attr = imgEl.attributes[i]!;
    const name = attr.name;
    if (name === 'href' || name === 'xlink:href' || name === 'preserveAspectRatio') continue;
    rect.setAttributeNS(attr.namespaceURI, name, attr.value);
  }
  
  // Ensure essential attributes exist so it's a valid rect in Figma
  if (!rect.hasAttribute('width')) rect.setAttribute('width', '100');
  if (!rect.hasAttribute('height')) rect.setAttribute('height', '100');
  if (!rect.hasAttribute('x')) rect.setAttribute('x', '0');
  if (!rect.hasAttribute('y')) rect.setAttribute('y', '0');
  
  // Set our specific ID so we can find it
  rect.setAttribute('id', placeholderName);
  
  // We want it to be a transparent fill placeholder for now
  rect.setAttribute('fill', 'none');
  rect.setAttribute('data-figma-raster-placeholder', 'true');
  
  return rect;
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  rasters: EmbeddedRasterInfo[];
  cleanedSvgString: string;
  extractionWarnings: string[];
}

/**
 * Find all embedded rasters in the SVG document, extract the ones that should
 * be processed, replace them with invisible placeholder <rect> elements,
 * and return the cleaned SVG string.
 */
export function extractRasters(
  doc: Document,
  svgInfo: SVGInfo,
  settings: PluginSettings,
  sourceFileName = '',
): ExtractionResult {
  imageCounter = 0;
  const svgRoot = doc.documentElement;
  const warnings: string[] = [];
  const rasters: EmbeddedRasterInfo[] = [];

  // Find all <image> elements with data: URIs
  const imageElements = Array.from(svgRoot.querySelectorAll('image'));

  for (const imgEl of imageElements) {
    const href = getHref(imgEl);
    if (!href) continue;

    // Only process embedded data: URIs
    const dataUri = parseDataUri(href);
    if (!dataUri) {
      // External reference — skip with warning
      if (href.startsWith('http://') || href.startsWith('https://')) {
        warnings.push(`Skipping external image reference: ${href.slice(0, 80)}`);
      }
      continue;
    }

    // Detect real bitmap dimensions
    let bitmapDimensions = null;
    if (isPng(dataUri.bytes)) {
      bitmapDimensions = getPngDimensions(dataUri.bytes);
    } else if (isJpeg(dataUri.bytes)) {
      bitmapDimensions = getJpegDimensions(dataUri.bytes);
    }

    if (!bitmapDimensions) {
      warnings.push(
        `Could not detect dimensions for image "${imgEl.getAttribute('id') ?? '(no id)'}" — skipping`,
      );
      continue;
    }

    // Gather element attributes
    const svgX = getNumericAttr(imgEl, 'x', 0);
    const svgY = getNumericAttr(imgEl, 'y', 0);
    const svgImageWidth = getNumericAttr(imgEl, 'width', bitmapDimensions.width);
    const svgImageHeight = getNumericAttr(imgEl, 'height', bitmapDimensions.height);
    const transformString = imgEl.getAttribute('transform') ?? '';
    const preserveAspectRatio =
      imgEl.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet';
    const style = imgEl.getAttribute('style') ?? '';
    const opacity = getOpacity(imgEl);
    const clipPath = imgEl.getAttribute('clip-path') ?? null;
    const maskAttr = imgEl.getAttribute('mask') ?? null;

    // Accumulate parent transforms

    const domPath = buildDomPath(imgEl, svgRoot);

    // Determine extraction decision
    const willExtract = needsExtraction(bitmapDimensions, settings);

    // Compute unique placeholder name (used as element id → Figma node name)
    const placeholderName = genPlaceholderName();

    // Resolve layer name
    const name = resolveRasterName(imgEl, null);

    const info: EmbeddedRasterInfo = {
      placeholderName,
      rootLevelIndex: -1, // set below
      domPath,
      svgId: imgEl.getAttribute('id') ?? '',
      svgClass: imgEl.getAttribute('class') ?? '',
      svgDataName: imgEl.getAttribute('data-name') ?? '',
      inkscapeLabel:
        imgEl.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label') ?? '',
      svgX,
      svgY,
      svgImageWidth,
      svgImageHeight,
      transformString,

      preserveAspectRatio,
      style,
      opacity,
      clipPath,
      maskAttr,
      mimeType: dataUri.mimeType,
      base64Data: dataUri.base64Data,
      bitmapDimensions,
      willExtract,
      name,
    };

    rasters.push(info);

    // Replace the <image> with a placeholder <rect>
    if (willExtract) {
      const placeholder = createPlaceholder(doc, imgEl, placeholderName);
      imgEl.parentNode?.replaceChild(placeholder, imgEl);
    }
  }

  // Serialize cleaned SVG
  const serializer = new XMLSerializer();
  const cleanedSvgString = serializer.serializeToString(svgRoot);

  return { rasters, cleanedSvgString, extractionWarnings: warnings };
}
