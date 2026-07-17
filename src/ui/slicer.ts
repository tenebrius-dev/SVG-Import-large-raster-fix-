import { SVGInfo } from '../shared/types';

/**
 * Loads a base64 image into an HTMLImageElement asynchronously.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Slices large images (> 4096px) in the SVG Document into a grid of 4096x4096 tiles.
 * The original <image> element is replaced with an <svg viewBox="..."> wrapper
 * containing the tiles, ensuring 0 quality loss and native Figma import.
 */
export async function sliceLargeImagesInDocument(doc: Document): Promise<string[]> {
  const warnings: string[] = [];
  const images = Array.from(doc.querySelectorAll('image'));

  for (const imgEl of images) {
    const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href');
    if (!href || !href.startsWith('data:image/')) continue;

    try {
      const img = await loadImage(href);
      const width = img.naturalWidth;
      const height = img.naturalHeight;

      if (width <= 4096 && height <= 4096) {
        // Image is small enough for native import without downsampling
        continue;
      }

      warnings.push(`Slicing large image (${width}x${height}) into 4096px tiles.`);

      // Create an <svg> wrapper to replace the <image>
      const wrapperSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      
      // Copy visual attributes from original <image> to the wrapper
      const x = imgEl.getAttribute('x') || '0';
      const y = imgEl.getAttribute('y') || '0';
      const w = imgEl.getAttribute('width') || width.toString();
      const h = imgEl.getAttribute('height') || height.toString();
      const preserveAspectRatio = imgEl.getAttribute('preserveAspectRatio') || 'xMidYMid meet';
      
      wrapperSvg.setAttribute('x', x);
      wrapperSvg.setAttribute('y', y);
      wrapperSvg.setAttribute('width', w);
      wrapperSvg.setAttribute('height', h);
      wrapperSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      wrapperSvg.setAttribute('preserveAspectRatio', preserveAspectRatio);
      
      // Copy classes/style/transform to the wrapper so layout remains identical
      if (imgEl.hasAttribute('transform')) wrapperSvg.setAttribute('transform', imgEl.getAttribute('transform')!);
      if (imgEl.hasAttribute('class')) wrapperSvg.setAttribute('class', imgEl.getAttribute('class')!);
      if (imgEl.hasAttribute('style')) wrapperSvg.setAttribute('style', imgEl.getAttribute('style')!);
      if (imgEl.hasAttribute('id')) wrapperSvg.setAttribute('id', imgEl.getAttribute('id')!);
      if (imgEl.hasAttribute('data-name')) wrapperSvg.setAttribute('data-name', imgEl.getAttribute('data-name')!);

      // Slice into tiles
      const TILE_SIZE = 4096;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) throw new Error("Could not get 2d context for slicing.");

      const mimeType = href.substring(5, href.indexOf(';'));

      let tileCount = 0;
      for (let ty = 0; ty < height; ty += TILE_SIZE) {
        for (let tx = 0; tx < width; tx += TILE_SIZE) {
          const tileW = Math.min(TILE_SIZE, width - tx);
          const tileH = Math.min(TILE_SIZE, height - ty);

          canvas.width = tileW;
          canvas.height = tileH;

          // Draw the specific chunk of the image
          ctx.clearRect(0, 0, tileW, tileH);
          ctx.drawImage(img, tx, ty, tileW, tileH, 0, 0, tileW, tileH);

          // Extract base64
          // Use high quality for jpeg, default for png
          const tileDataUrl = canvas.toDataURL(mimeType, 1.0);

          // Create new <image> for this tile
          const tileImg = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
          tileImg.setAttribute('x', tx.toString());
          tileImg.setAttribute('y', ty.toString());
          tileImg.setAttribute('width', tileW.toString());
          tileImg.setAttribute('height', tileH.toString());
          tileImg.setAttribute('href', tileDataUrl);

          wrapperSvg.appendChild(tileImg);
          tileCount++;
        }
      }

      warnings.push(`Created ${tileCount} tiles for image.`);

      // Replace original image with the wrapper
      imgEl.parentNode?.replaceChild(wrapperSvg, imgEl);

    } catch (e) {
      warnings.push(`Failed to slice image: ${(e as Error).message}`);
    }
  }

  return warnings;
}
