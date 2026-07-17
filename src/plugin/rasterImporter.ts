/**
 * rasterImporter.ts — Import a single raster image into Figma.
 *
 * Uses figma.createImage(bytes) to import the raster separately,
 * bypassing the SVG importer's embedded-raster downsampling.
 *
 * Then creates a Rectangle node with the correct geometry from the
 * original SVG data — NOT from the Figma image dimensions.
 *
 * Runs in Plugin sandbox.
 */

import type {
  ProcessedRasterPayload,
  RasterImportResult,
} from '../shared/types.js';

/**
 * Import a single raster as a Figma image fill on a Rectangle.
 *
 * @returns The created RectangleNode and a result report entry.
 */
export async function importRaster(
  payload: ProcessedRasterPayload,
  placeholderNode: RectangleNode,
  debugMode = false,
): Promise<{ node: RectangleNode; result: RasterImportResult }> {
  const { info, bytes, geometry } = payload;

  if (debugMode) {
    console.log(`[rasterImporter] Importing raster "${info.name}"`);
    console.log(`  Bitmap: ${info.bitmapDimensions?.width}×${info.bitmapDimensions?.height} px`);
    console.log(`  ScaleMode: ${geometry.scaleMode}`);
  }

  // 1. Create Figma Image handle (this is where separate raster pipeline happens)
  let figmaImage: Image;
  try {
    figmaImage = figma.createImage(bytes);
  } catch (e) {
    const err = `figma.createImage() failed for "${info.name}": ${(e as Error).message}`;
    console.error('[rasterImporter]', err);
    return {
      node: placeholderNode,
      result: {
        placeholderName: info.placeholderName,
        name: info.name,
        actualFigmaSize: null,
        placedWidth: placeholderNode.width,
        placedHeight: placeholderNode.height,
        bitmapDimensions: info.bitmapDimensions,
        error: err,
      },
    };
  }

  // 2. Try to get the actual stored size (diagnostic — may not reflect downsampling)
  let actualFigmaSize: { width: number; height: number } | null = null;
  try {
    actualFigmaSize = await figmaImage.getSizeAsync();
  } catch (e) {
    console.warn('[rasterImporter] getSizeAsync() failed:', (e as Error).message);
  }

  // 3. Rename placeholder
  placeholderNode.name = info.name;

  // 4. Set opacity from SVG attribute (preserve the existing node opacity if any, but multiply if needed, or just set if info.opacity < 1)
  if (info.opacity < 1) {
    placeholderNode.opacity = Math.max(0, Math.min(1, info.opacity * placeholderNode.opacity));
  }

  // 5. Apply image fill (overwriting the transparent placeholder fill)
  placeholderNode.fills = [
    {
      type: 'IMAGE',
      scaleMode: geometry.scaleMode,
      imageHash: figmaImage.hash,
    },
  ];

  // 6. Report visual placed size based on the Figma node's width/height
  const placedWidth = placeholderNode.width;
  const placedHeight = placeholderNode.height;

  if (debugMode) {
    console.log(`  Visual placed size: ${placedWidth.toFixed(2)}×${placedHeight.toFixed(2)} Figma units`);
  }

  const result: RasterImportResult = {
    placeholderName: info.placeholderName,
    name: info.name,
    actualFigmaSize,
    placedWidth,
    placedHeight,
    bitmapDimensions: info.bitmapDimensions,
    error: null,
  };

  return { node: placeholderNode, result };
}
