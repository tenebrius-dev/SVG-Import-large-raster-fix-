/**
 * createTestSVGs.ts — Generate valid, renderable test SVG fixtures.
 *
 * Uses Node.js built-in 'zlib' to generate structurally valid,
 * solid-color PNG images. When imported to Figma, they will render
 * as solid red rectangles instead of being empty/invisible.
 *
 * Run with: npx tsx tests/fixtures/createTestSVGs.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const OUT_DIR = __dirname;

// ── CRC-32 implementation for PNG chunks ──
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]!) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Helper to write chunk
function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Generate a valid, solid-red PNG file of arbitrary dimensions.
 * Uses indexed color (palette) and deflates all-zero rows to keep size tiny.
 */
function makeSolidRedPng(width: number, height: number): string {
  // 1. Signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // 2. IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 3;  // color type: indexed
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // 3. PLTE (Palette: Index 0 = Solid Red [255, 0, 0])
  const plteData = Buffer.from([0xff, 0x00, 0x00]);
  const plte = makeChunk('PLTE', plteData);

  // 4. IDAT (Pixel data)
  // Each row has 1 filter byte (0 = None) + `width` bytes of pixel indices (all 0 for index 0)
  const rowLength = 1 + width;
  const rawPixels = Buffer.alloc(height * rowLength); // zero-initialized -> index 0 (red)
  const compressedPixels = zlib.deflateSync(rawPixels);
  const idat = makeChunk('IDAT', compressedPixels);

  // 5. IEND
  const iend = makeChunk('IEND', Buffer.alloc(0));

  const pngBuffer = Buffer.concat([sig, ihdr, plte, idat, iend]);
  return pngBuffer.toString('base64');
}

function makeSVGWithImage(opts: {
  svgWidth: number;
  svgHeight: number;
  viewBox?: string;
  imgX?: number;
  imgY?: number;
  imgW: number;
  imgH: number;
  imgBitmapW: number;
  imgBitmapH: number;
  imgTransform?: string;
  imgId?: string;
  groupTransform?: string;
  extraElements?: string;
}): string {
  const {
    svgWidth, svgHeight, viewBox, imgX = 0, imgY = 0, imgW, imgH,
    imgBitmapW, imgBitmapH, imgTransform = '', imgId = 'AI_Image',
    groupTransform = '', extraElements = '',
  } = opts;

  const b64 = makeSolidRedPng(imgBitmapW, imgBitmapH);
  const dataUri = `data:image/png;base64,${b64}`;
  const vbAttr = viewBox ? ` viewBox="${viewBox}"` : '';
  const transformAttr = imgTransform ? ` transform="${imgTransform}"` : '';
  const groupOpen = groupTransform ? `<g transform="${groupTransform}">` : '';
  const groupClose = groupTransform ? '</g>' : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${svgWidth}" height="${svgHeight}"${vbAttr}>
  <!-- Test SVG: bitmap ${imgBitmapW}×${imgBitmapH}, SVG element ${imgW}×${imgH} -->
  ${extraElements}
  ${groupOpen}
  <image id="${imgId}"
    x="${imgX}" y="${imgY}"
    width="${imgW}" height="${imgH}"
    ${transformAttr}
    href="${dataUri}"/>
  ${groupClose}
</svg>`;
}

// ── Generate test fixtures ──

interface Fixture {
  fileName: string;
  content: string;
  description: string;
}

const fixtures: Fixture[] = [
  {
    fileName: 'test1_png_4095.svg',
    description: 'TEST 1: PNG 4095×4095 — should NOT trigger extraction (≤4096)',
    content: makeSVGWithImage({
      svgWidth: 4095, svgHeight: 4095,
      imgW: 4095, imgH: 4095,
      imgBitmapW: 4095, imgBitmapH: 4095,
      imgId: 'Image_4095',
    }),
  },
  {
    fileName: 'test2_png_4096.svg',
    description: 'TEST 2: PNG 4096×4096 — boundary, should NOT trigger (≤4096)',
    content: makeSVGWithImage({
      svgWidth: 4096, svgHeight: 4096,
      imgW: 4096, imgH: 4096,
      imgBitmapW: 4096, imgBitmapH: 4096,
      imgId: 'Image_4096',
    }),
  },
  {
    fileName: 'test3_png_4097.svg',
    description: 'TEST 3: PNG 4097×4097 — SHOULD trigger extraction (>4096)',
    content: makeSVGWithImage({
      svgWidth: 4097, svgHeight: 4097,
      imgW: 4097, imgH: 4097,
      imgBitmapW: 4097, imgBitmapH: 4097,
      imgId: 'Image_4097',
    }),
  },
  {
    fileName: 'test4_png_5387x3010.svg',
    description: 'TEST 4: PNG 5387×3010 with transform — requirements key case',
    content: makeSVGWithImage({
      svgWidth: 1000, svgHeight: 560,
      imgW: 5380, imgH: 3005,
      imgBitmapW: 5387, imgBitmapH: 3010,
      imgTransform: 'translate(64.16 160) scale(.24)',
      imgId: 'AI_Image',
    }),
  },
  {
    fileName: 'test5_png_8192.svg',
    description: 'TEST 5: PNG 8192×8192 — Figma SVG import halves to 4096',
    content: makeSVGWithImage({
      svgWidth: 8192, svgHeight: 8192,
      imgW: 8192, imgH: 8192,
      imgBitmapW: 8192, imgBitmapH: 8192,
      imgId: 'Image_8192',
    }),
  },
  {
    fileName: 'test6_png_8193.svg',
    description: 'TEST 6: PNG 8193×8193 — Figma SVG import quarters to ~2049',
    content: makeSVGWithImage({
      svgWidth: 8193, svgHeight: 8193,
      imgW: 8193, imgH: 8193,
      imgBitmapW: 8193, imgBitmapH: 8193,
      imgId: 'Image_8193',
    }),
  },
  {
    fileName: 'test7_multiple_rasters.svg',
    description: 'TEST 7: Multiple embedded rasters (3 images)',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="1000" height="800">
  <rect id="background" width="1000" height="800" fill="#eee"/>
  <image id="Image_A" x="0" y="0" width="500" height="280"
    href="data:image/png;base64,${makeSolidRedPng(5387, 3010)}"/>
  <image id="Image_B" x="500" y="0" width="300" height="200"
    href="data:image/png;base64,${makeSolidRedPng(1200, 800)}"/>
  <image id="Image_C" x="0" y="400" width="800" height="400"
    href="data:image/png;base64,${makeSolidRedPng(9000, 5000)}"/>
</svg>`,
  },
  {
    fileName: 'test8_transformed_group.svg',
    description: 'TEST 8: Raster inside a transformed <g>',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="1000" height="600">
  <g id="layer1" transform="translate(50, 30) scale(0.8)">
    <image id="Raster_In_Group" x="0" y="0" width="5380" height="3005"
      transform="scale(0.15)"
      href="data:image/png;base64,${makeSolidRedPng(5387, 3010)}"/>
  </g>
</svg>`,
  },
  {
    fileName: 'test11_stacking_order.svg',
    description: 'TEST 11: Raster between two vector layers — stacking must be preserved',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="800" height="600">
  <rect id="Background" width="800" height="600" fill="#f0f0f0"/>
  <path id="Vector_A" d="M0 0 L200 200" stroke="red" stroke-width="4"/>
  <image id="Raster_Image" x="100" y="100" width="5000" height="3000"
    transform="scale(0.1)"
    href="data:image/png;base64,${makeSolidRedPng(5000, 3000)}"/>
  <path id="Vector_B" d="M600 0 L400 200" stroke="blue" stroke-width="4"/>
  <text id="Text_Label" x="400" y="550" font-size="24" fill="#333">SVG Smart Import Test</text>
</svg>`,
  },
];

// Write fixtures
for (const fixture of fixtures) {
  const filePath = path.join(OUT_DIR, fixture.fileName);
  fs.writeFileSync(filePath, fixture.content, 'utf8');
  console.log(`✓ ${fixture.fileName} — ${fixture.description}`);
}

console.log(`\nGenerated ${fixtures.length} valid solid-color test fixtures in ${OUT_DIR}`);
