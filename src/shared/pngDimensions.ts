/**
 * pngDimensions.ts — Extract pixel width and height from a PNG binary.
 *
 * PNG spec §11.2.2: the IHDR chunk always starts at byte 8 (after the 8-byte signature)
 * and contains width (4 bytes BE) and height (4 bytes BE) at offsets 16 and 20.
 *
 * PNG signature: 89 50 4E 47 0D 0A 1A 0A
 *
 * No DOM dependencies.
 */

import type { RasterDimensions } from './types.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Read width and height from a PNG byte array.
 * @returns {RasterDimensions} or null if the data is not a valid PNG.
 */
export function getPngDimensions(bytes: Uint8Array): RasterDimensions | null {
  // Must have at least 24 bytes: 8 sig + 4 len + 4 type + 4 width + 4 height
  if (bytes.length < 24) return null;

  // Verify PNG signature
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }

  // IHDR starts at byte 8:
  //   8..11  → chunk length (4 bytes) — typically 0x00 00 00 0D = 13
  //   12..15 → chunk type "IHDR"      (49 48 44 52)
  //   16..19 → width  (big-endian uint32)
  //   20..23 → height (big-endian uint32)
  const ihdrType = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (ihdrType !== 'IHDR') {
    // Corrupt or non-standard PNG — try offset 12 anyway
    return null;
  }

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);

  if (width <= 0 || height <= 0) return null;

  return { width, height };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0 // Convert to unsigned
  );
}

/** Quick check: is the byte array a PNG? */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}
