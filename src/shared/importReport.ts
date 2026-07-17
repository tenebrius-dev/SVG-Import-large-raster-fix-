/**
 * importReport.ts — Format import results for display in the UI.
 *
 * No DOM dependencies — runs in both environments.
 */

import type { SVGImportResult, RasterImportResult } from './types.js';

// ---------------------------------------------------------------------------
// Text formatting utilities
// ---------------------------------------------------------------------------

export function formatDimensions(w: number, h: number): string {
  return `${Math.round(w * 100) / 100} × ${Math.round(h * 100) / 100}`;
}

export function formatDimensionsPx(w: number, h: number): string {
  return `${w} × ${h} px`;
}

// ---------------------------------------------------------------------------
// Raster-level report
// ---------------------------------------------------------------------------

export interface RasterReportEntry {
  name: string;
  bitmapOriginal: string;
  svgGeometry: string;
  stdSvgImportEstimate: string;
  figmaInternalSize: string;
  placedSize: string;
  status: 'success' | 'warning' | 'error';
  error: string | null;
}

export function formatRasterResult(r: RasterImportResult): RasterReportEntry {
  const bitmap = r.bitmapDimensions
    ? formatDimensionsPx(r.bitmapDimensions.width, r.bitmapDimensions.height)
    : 'Unknown';

  // Estimate of what standard SVG import would produce (power-of-two halving)
  const stdEstimate = r.bitmapDimensions
    ? estimateStandardSVGImport(r.bitmapDimensions.width, r.bitmapDimensions.height)
    : 'Unknown';

  const figmaInternal = r.actualFigmaSize
    ? formatDimensionsPx(r.actualFigmaSize.width, r.actualFigmaSize.height)
    : 'Not exposed by Figma API';

  const placed = formatDimensions(r.placedWidth, r.placedHeight) + ' Figma units';

  return {
    name: r.name,
    bitmapOriginal: bitmap,
    svgGeometry: `${Math.round(r.placedWidth)} × ${Math.round(r.placedHeight)}`,
    stdSvgImportEstimate: stdEstimate,
    figmaInternalSize: figmaInternal,
    placedSize: placed,
    status: r.error ? 'error' : 'success',
    error: r.error,
  };
}

/**
 * Estimate what standard SVG import would produce.
 * Based on observed power-of-two halving behavior:
 * - ≤4096: kept as-is
 * - 4097–8192: halved
 * - 8193–16384: quartered
 * etc.
 */
function estimateStandardSVGImport(w: number, h: number): string {
  const maxSide = Math.max(w, h);
  let divisor = 1;
  if (maxSide > 4096) divisor = 2;
  if (maxSide > 8192) divisor = 4;
  if (maxSide > 16384) divisor = 8;

  const ew = Math.ceil(w / divisor);
  const eh = Math.ceil(h / divisor);
  return `≈${formatDimensionsPx(ew, eh)}`;
}

// ---------------------------------------------------------------------------
// SVG-level summary
// ---------------------------------------------------------------------------

export interface SVGReportSummary {
  fileName: string;
  success: boolean;
  rastersFound: number;
  rastersExtracted: number;
  rasterEntries: RasterReportEntry[];
  warnings: string[];
  error: string | null;
}

export function buildSVGSummary(result: SVGImportResult): SVGReportSummary {
  return {
    fileName: result.svgFileName,
    success: result.success,
    rastersFound: result.rastersFound,
    rastersExtracted: result.rastersExtracted,
    rasterEntries: result.rasterResults.map(formatRasterResult),
    warnings: result.warnings,
    error: result.error,
  };
}
