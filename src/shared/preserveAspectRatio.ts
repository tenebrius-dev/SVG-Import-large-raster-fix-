/**
 * preserveAspectRatio.ts — Parse and map SVG preserveAspectRatio to Figma ScaleMode.
 *
 * SVG spec: preserveAspectRatio="<align> [<meetOrSlice>]"
 *   align: none | xMinYMin | xMidYMin | xMaxYMin | xMinYMid | xMidYMid | xMaxYMid
 *                         | xMinYMax | xMidYMax | xMaxYMax
 *   meetOrSlice: meet (default) | slice
 *
 * Mapping to Figma ImagePaint:
 *   none          → FILL  (no perfect "stretch" in Figma; FILL is closest)
 *   *meet         → FIT   (scale to fit, letter-boxing)
 *   *slice        → FILL  (scale to fill, cropping)
 *
 * No DOM dependencies.
 */

import type { ScaleMode } from './types.js';

export interface ParsedPreserveAspectRatio {
  align: string;
  meetOrSlice: 'meet' | 'slice';
  isNone: boolean;
}

/** Parse a preserveAspectRatio attribute string. */
export function parsePreserveAspectRatio(
  raw: string | null | undefined,
): ParsedPreserveAspectRatio {
  const str = (raw ?? 'xMidYMid meet').trim();

  if (str === 'none') {
    return { align: 'none', meetOrSlice: 'meet', isNone: true };
  }

  const parts = str.split(/\s+/);
  const align = parts[0] ?? 'xMidYMid';
  const meetOrSlice = (parts[1] === 'slice' ? 'slice' : 'meet') as 'meet' | 'slice';

  return { align, meetOrSlice, isNone: false };
}

/**
 * Map a parsed preserveAspectRatio to the best-fit Figma ScaleMode.
 *
 * Note: Figma has no "stretch" mode (preserveAspectRatio="none").
 * FILL is used as the closest approximation.
 */
export function toFigmaScaleMode(par: ParsedPreserveAspectRatio): ScaleMode {
  if (par.isNone) return 'FILL'; // closest approximation
  if (par.meetOrSlice === 'slice') return 'FILL'; // crop to fill
  return 'FIT'; // meet → fit within bounds
}

/** Convenience: parse and convert in one step. */
export function svgPreserveAspectRatioToScaleMode(raw: string | null | undefined): ScaleMode {
  return toFigmaScaleMode(parsePreserveAspectRatio(raw));
}
