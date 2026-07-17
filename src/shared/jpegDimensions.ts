/**
 * jpegDimensions.ts — Extract pixel width and height from a JPEG binary.
 *
 * JPEG uses a marker-based structure. Dimension markers are:
 *   FF C0  SOF0  — Baseline DCT
 *   FF C1  SOF1  — Extended sequential
 *   FF C2  SOF2  — Progressive DCT
 *   FF C3  SOF3  — Lossless
 *   FF C5  SOF5  — Differential sequential
 *   FF C6  SOF6  — Differential progressive
 *   FF C7  SOF7  — Differential lossless
 *   FF C9..FF CF (various)
 *
 * The SOF segment layout (after the 0xFF 0xCX marker bytes):
 *   2 bytes: segment length
 *   1 byte:  precision
 *   2 bytes: height  (big-endian)
 *   2 bytes: width   (big-endian)
 *   ...
 *
 * No DOM dependencies.
 */

import type { RasterDimensions } from './types.js';

const JPEG_SOI = [0xff, 0xd8]; // Start of Image

/** SOF marker bytes that contain dimension information */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

/**
 * Read width and height from a JPEG byte array.
 * @returns {RasterDimensions} or null if parsing fails.
 */
export function getJpegDimensions(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 4) return null;

  // Check SOI marker
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;

  while (offset < bytes.length - 1) {
    // Each marker starts with 0xFF
    if (bytes[offset] !== 0xff) {
      // Try to resync by scanning for next 0xFF
      offset++;
      continue;
    }

    // Skip any 0xFF padding bytes
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset++;
    }

    if (offset >= bytes.length) break;

    const marker = bytes[offset]!;
    offset++;

    // SOI / EOI / RST markers have no length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    // Read segment length (includes the 2 length bytes, excludes the marker bytes)
    if (offset + 1 >= bytes.length) break;
    const segLen = readUint16BE(bytes, offset);
    if (segLen < 2) break;

    if (SOF_MARKERS.has(marker)) {
      // SOF segment: 2 (len) + 1 (precision) + 2 (height) + 2 (width)
      if (offset + 4 < bytes.length) {
        const height = readUint16BE(bytes, offset + 3);
        const width = readUint16BE(bytes, offset + 5);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    }

    offset += segLen;
  }

  return null;
}

/** Quick check: is the byte array a JPEG? */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}
