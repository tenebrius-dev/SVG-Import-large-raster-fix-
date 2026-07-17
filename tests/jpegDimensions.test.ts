/**
 * jpegDimensions.test.ts — Tests for JPEG SOF dimension extraction.
 */

import { describe, it, expect } from 'vitest';
import { getJpegDimensions, isJpeg } from '../src/shared/jpegDimensions';

// ── Build minimal JPEG with SOF0 marker ──

function makeJpegHeader(width: number, height: number): Uint8Array {
  // Minimal: SOI + APP0 (short) + SOF0 + EOI
  const bytes: number[] = [
    // SOI
    0xff, 0xd8,
    // APP0 (length=7, minimal)
    0xff, 0xe0,
    0x00, 0x07, // length = 7
    0x00, 0x00, 0x00, 0x00, 0x00,
    // SOF0
    0xff, 0xc0,
    0x00, 0x11, // length = 17 (8 + 3*components)
    0x08,       // precision
    (height >> 8) & 0xff, height & 0xff, // height big-endian
    (width >> 8) & 0xff, width & 0xff,   // width big-endian
    0x03,       // components
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    // EOI
    0xff, 0xd9,
  ];
  return new Uint8Array(bytes);
}

describe('getJpegDimensions', () => {
  it('extracts dimensions from SOF0', () => {
    const bytes = makeJpegHeader(1920, 1080);
    const dims = getJpegDimensions(bytes);
    expect(dims).not.toBeNull();
    expect(dims!.width).toBe(1920);
    expect(dims!.height).toBe(1080);
  });

  it('extracts large dimensions (5387 × 3010)', () => {
    const bytes = makeJpegHeader(5387, 3010);
    const dims = getJpegDimensions(bytes);
    expect(dims!.width).toBe(5387);
    expect(dims!.height).toBe(3010);
  });

  it('extracts square dimensions (4096 × 4096)', () => {
    const bytes = makeJpegHeader(4096, 4096);
    const dims = getJpegDimensions(bytes);
    expect(dims!.width).toBe(4096);
    expect(dims!.height).toBe(4096);
  });

  it('returns null for too-short buffer', () => {
    expect(getJpegDimensions(new Uint8Array(4))).toBeNull();
  });

  it('returns null for non-JPEG data', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG
    expect(getJpegDimensions(bytes)).toBeNull();
  });
});

describe('isJpeg', () => {
  it('recognizes JPEG SOI', () => {
    const bytes = makeJpegHeader(100, 100);
    expect(isJpeg(bytes)).toBe(true);
  });

  it('rejects PNG', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(isJpeg(bytes)).toBe(false);
  });
});
