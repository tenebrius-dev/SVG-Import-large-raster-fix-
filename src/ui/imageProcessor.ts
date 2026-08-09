/**
 * imageProcessor.ts — Downscaling & format handling for raster images.
 *
 * Ensures raster images fit within Figma's 4096px dimension limit using HTML5 Canvas.
 */

export interface ProcessedImageResult {
  bytes: Uint8Array;
  dimensions: { width: number; height: number };
  downscaled: boolean;
}

/**
 * Ensures the raster image fits within Figma's 4096px limit.
 * If it exceeds 4096px on either side, it is downscaled using HTML5 Canvas.
 */
export async function processAndDownscaleImage(
  base64Data: string,
  mimeType: string,
  bitmapDimensions: { width: number; height: number } | null
): Promise<ProcessedImageResult> {
  // If dimensions are known and within limits, skip canvas decoding
  if (bitmapDimensions && bitmapDimensions.width <= 4096 && bitmapDimensions.height <= 4096) {
    const clean = base64Data.replace(/\s/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, dimensions: bitmapDimensions, downscaled: false };
  }

  // Load image into an Image object to verify or downscale
  const img = new Image();
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  img.src = dataUrl;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image for canvas resizing'));
  });

  const origW = img.naturalWidth;
  const origH = img.naturalHeight;

  if (origW <= 4096 && origH <= 4096) {
    const clean = base64Data.replace(/\s/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, dimensions: { width: origW, height: origH }, downscaled: false };
  }

  // Calculate new downscaled dimensions maintaining aspect ratio
  const scale = 4096 / Math.max(origW, origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, newW, newH);

  // Convert canvas back to base64
  const newDataUrl = canvas.toDataURL(mimeType, 0.95);
  const commaIdx = newDataUrl.indexOf(',');
  const newBase64 = newDataUrl.slice(commaIdx + 1);

  const bin = atob(newBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  return {
    bytes,
    dimensions: { width: newW, height: newH },
    downscaled: true
  };
}
