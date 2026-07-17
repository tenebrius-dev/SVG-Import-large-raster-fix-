/**
 * pngDimensions.test.ts — Tests for PNG IHDR dimension extraction.
 */

import { describe, it, expect } from 'vitest';
import { getPngDimensions, isPng } from '../src/shared/pngDimensions';

// ── Build minimal PNG headers for testing ──

function makePngHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  // PNG signature
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length = 13
  buf.set([0x00, 0x00, 0x00, 0x0d], 8);
  // IHDR type
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  // Width (big-endian)
  buf[16] = (width >>> 24) & 0xff;
  buf[17] = (width >>> 16) & 0xff;
  buf[18] = (width >>> 8) & 0xff;
  buf[19] = width & 0xff;
  // Height (big-endian)
  buf[20] = (height >>> 24) & 0xff;
  buf[21] = (height >>> 16) & 0xff;
  buf[22] = (height >>> 8) & 0xff;
  buf[23] = height & 0xff;
  return buf;
}

describe('getPngDimensions', () => {
  // TEST 1 — 4095 px
  it('TEST 1: correctly reads 4095 × 4095 px', () => {
    const bytes = makePngHeader(4095, 4095);
    const dims = getPngDimensions(bytes);
    expect(dims).not.toBeNull();
    expect(dims!.width).toBe(4095);
    expect(dims!.height).toBe(4095);
  });

  // TEST 2 — 4096 px
  it('TEST 2: correctly reads 4096 × 4096 px', () => {
    const bytes = makePngHeader(4096, 4096);
    const dims = getPngDimensions(bytes);
    expect(dims!.width).toBe(4096);
    expect(dims!.height).toBe(4096);
  });

  // TEST 3 — 4097 px
  it('TEST 3: correctly reads 4097 × 4097 px', () => {
    const bytes = makePngHeader(4097, 4097);
    const dims = getPngDimensions(bytes);
    expect(dims!.width).toBe(4097);
    expect(dims!.height).toBe(4097);
  });

  // TEST 4 — 5387 × 3010 px (from requirements)
  it('TEST 4: correctly reads 5387 × 3010 px', () => {
    const bytes = makePngHeader(5387, 3010);
    const dims = getPngDimensions(bytes);
    expect(dims!.width).toBe(5387);
    expect(dims!.height).toBe(3010);
  });

  // TEST 5 — 8192 px
  it('TEST 5: correctly reads 8192 × 8192 px', () => {
    const bytes = makePngHeader(8192, 8192);
    const dims = getPngDimensions(bytes);
    expect(dims!.width).toBe(8192);
    expect(dims!.height).toBe(8192);
  });

  // TEST 6 — 8193 px
  it('TEST 6: correctly reads 8193 × 8193 px', () => {
    const bytes = makePngHeader(8193, 8193);
    const dims = getPngDimensions(bytes);
    expect(dims!.width).toBe(8193);
    expect(dims!.height).toBe(8193);
  });

  it('returns null for too-short buffer', () => {
    const bytes = new Uint8Array(10);
    expect(getPngDimensions(bytes)).toBeNull();
  });

  it('returns null for invalid signature', () => {
    const bytes = makePngHeader(100, 100);
    bytes[0] = 0x00; // corrupt signature
    expect(getPngDimensions(bytes)).toBeNull();
  });

  it('returns null for non-IHDR first chunk', () => {
    const bytes = makePngHeader(100, 100);
    bytes[12] = 0x00; // corrupt chunk type
    expect(getPngDimensions(bytes)).toBeNull();
  });
});

describe('isPng', () => {
  it('recognizes valid PNG signature', () => {
    const bytes = makePngHeader(100, 100);
    expect(isPng(bytes)).toBe(true);
  });

  it('rejects JPEG', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(isPng(bytes)).toBe(false);
  });

  it('rejects short buffer', () => {
    expect(isPng(new Uint8Array(4))).toBe(false);
  });
});
