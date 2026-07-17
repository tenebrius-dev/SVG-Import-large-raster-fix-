/**
 * Shared types between UI (iframe) and Plugin (Figma sandbox) code.
 * This file must remain free of any DOM or Figma API references
 * so it can be safely imported in both environments.
 */

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

export type MimeType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Figma ImagePaint scale modes */
export type ScaleMode = 'FILL' | 'FIT' | 'CROP' | 'TILE';



// ---------------------------------------------------------------------------
// SVG metadata
// ---------------------------------------------------------------------------

export interface SVGViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SVGInfo {
  /** Declared SVG width in px (fallback: viewBox width) */
  width: number;
  /** Declared SVG height in px (fallback: viewBox height) */
  height: number;
  viewBox: SVGViewBox | null;
  preserveAspectRatio: string;
}

// ---------------------------------------------------------------------------
// Raster metadata
// ---------------------------------------------------------------------------

export interface RasterDimensions {
  width: number;
  height: number;
}

/**
 * Full metadata for one embedded <image> element found in an SVG.
 * Populated by rasterExtractor.ts (runs in UI).
 */
export interface EmbeddedRasterInfo {
  /** UUID used as the placeholder node name in the cleaned SVG */
  placeholderName: string;

  // ---- DOM position ----
  /** Index of the <image> element among ALL SVG child elements at root level
   *  (used to restore stacking order; -1 if inside a group) */
  rootLevelIndex: number;
  /** Full parent path e.g. ['g#layer1', 'g#icons'] */
  domPath: string[];

  // ---- Attributes ----
  svgId: string;
  svgClass: string;
  svgDataName: string;
  inkscapeLabel: string;

  /** x attribute of <image> (SVG user units, default 0) */
  svgX: number;
  /** y attribute of <image> (SVG user units, default 0) */
  svgY: number;
  /** width attribute of <image> (SVG user units) */
  svgImageWidth: number;
  /** height attribute of <image> (SVG user units) */
  svgImageHeight: number;

  /** Raw transform string on the <image> element */
  transformString: string;


  /** preserveAspectRatio attribute value */
  preserveAspectRatio: string;

  /** style attribute */
  style: string;
  /** opacity (0–1, from attribute or style) */
  opacity: number;
  /** clip-path attribute value or null */
  clipPath: string | null;
  /** mask attribute value or null */
  maskAttr: string | null;

  // ---- Image data ----
  mimeType: MimeType;
  /** Base64 data without the data:...;base64, prefix */
  base64Data: string;
  /** Actual bitmap pixel dimensions (from PNG IHDR / JPEG SOF headers) */
  bitmapDimensions: RasterDimensions | null;

  // ---- Processing decision ----
  /** Whether this raster will be extracted from the SVG and imported separately */
  willExtract: boolean;
  /** Desired Figma layer name */
  name: string;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface ComputedRasterGeometry {
  /** ImagePaint scale mode (derived from preserveAspectRatio) */
  scaleMode: ScaleMode;
}

// ---------------------------------------------------------------------------
// Import job (sent from UI → Plugin via postMessage)
// ---------------------------------------------------------------------------

export interface ProcessedRasterPayload {
  info: EmbeddedRasterInfo;
  /** Image bytes as Uint8Array */
  bytes: Uint8Array;
  geometry: ComputedRasterGeometry;
}

export interface ImportJobSVG {
  /** Original SVG file name (e.g. "design.svg") */
  svgFileName: string;
  /** Cleaned SVG string (rasters replaced with placeholder <rect> elements) */
  cleanedSvgString: string;
  /** Processed rasters to import separately */
  rasters: ProcessedRasterPayload[];
  svgInfo: SVGInfo;
  settings: PluginSettings;
}

// ---------------------------------------------------------------------------
// Plugin settings
// ---------------------------------------------------------------------------

export interface PluginSettings {
  /**
   * If true, extract rasters > 4096px and create Figma image handles separately
   * instead of relying on Figma's downsampling import.
   */
  optimizeLargeRasters: boolean;

  /**
   * If true, large images (>4096px) will be cut into 4096x4096 tiles directly in the SVG,
   * avoiding Figma's 4096px size limit completely with 0 quality loss.
   */
  sliceLargeImages: boolean;

  /**
   * If true, the plugin will run an optimization pass on the SVG to remove
   * redundant <clipPath> elements (like full-canvas wrappers).
   */
  optimizeMasks: boolean;

  /**
   * Enable verbose console logging
   */
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  optimizeLargeRasters: true,
  sliceLargeImages: false,
  debugMode: false,
  optimizeMasks: true,
};

// ---------------------------------------------------------------------------
// Import results (sent from Plugin → UI)
// ---------------------------------------------------------------------------

export interface RasterImportResult {
  placeholderName: string;
  name: string;
  /** Figma's internal stored size (from getSizeAsync), or null if not available */
  actualFigmaSize: { width: number; height: number } | null;
  /** Visual placed size (from SVG geometry) */
  placedWidth: number;
  placedHeight: number;
  /** Bitmap dimensions detected by the plugin */
  bitmapDimensions: RasterDimensions | null;
  error: string | null;
}

export interface SVGImportResult {
  svgFileName: string;
  success: boolean;
  error: string | null;
  rastersFound: number;
  rastersExtracted: number;
  rasterResults: RasterImportResult[];
  warnings: string[];
  /** Figma node ID for the created frame, used for diagnostics */
  frameNodeId: string | null;
}

// ---------------------------------------------------------------------------
// postMessage protocol
// ---------------------------------------------------------------------------

/** Messages from UI → Plugin */
export type UIMessage =
  | { type: 'import-svg-batch'; jobs: ImportJobSVG[] }
  | { type: 'close' }
  | { type: 'ping' };

/** Messages from Plugin → UI */
export type PluginMessage =
  | { type: 'pong' }
  | { type: 'import-progress'; stage: string; current: number; total: number }
  | { type: 'import-complete'; results: SVGImportResult[] }
  | { type: 'import-error'; error: string };

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Check if bitmap dimensions exceed the threshold for extraction */
export function needsExtraction(
  dims: RasterDimensions | null,
  settings: PluginSettings,
): boolean {
  if (!settings.optimizeLargeRasters) return false;
  if (dims === null) return false; // can't detect → leave as-is
  // If slicing is enabled, large images were already sliced into pieces <= 4096,
  // but just in case, we also disable extraction for large images here
  if (settings.sliceLargeImages) return false; 
  return dims.width > 4096 || dims.height > 4096;
}
