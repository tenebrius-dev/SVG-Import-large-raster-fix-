/**
 * poc-code.ts — Proof of Concept plugin code.
 *
 * Tests the hypothesis:
 *   "Does figma.createImage(bytes) preserve more resolution
 *    than importing a PNG embedded in an SVG?"
 *
 * Workflow:
 *   1. Receive PNG bytes from UI (extracted from SVG by the UI)
 *   2. Import via figma.createImage(bytes) → Rectangle fill
 *   3. Report getSizeAsync() result back to UI
 *   4. Optionally: also import the original SVG (with embedded PNG)
 *      for side-by-side comparison
 *
 * Build with esbuild (from project root):
 *   npx esbuild poc/poc-code.ts --bundle --outfile=poc/poc-code.js --platform=browser --target=chrome112
 */

figma.showUI(__html__, { width: 440, height: 520, title: 'SVG Import POC' });

figma.ui.onmessage = async (msg: Record<string, unknown>) => {
  if (msg['type'] === 'test-raster-import') {
    const {
      pngBytesArray,
      originalSvgString,
      svgX,
      svgY,
      svgW,
      svgH,
      transform,
      fileName,
    } = msg as {
      pngBytesArray: number[];
      originalSvgString: string;
      svgX: number;
      svgY: number;
      svgW: number;
      svgH: number;
      transform: string;
      fileName: string;
    };

    const results: Record<string, unknown> = {};
    const cx = figma.viewport.center.x;
    const cy = figma.viewport.center.y;
    const GAP = 80;

    // ── TEST A: Standard SVG import (with embedded PNG) ──
    try {
      const svgFrame = figma.createNodeFromSvg(originalSvgString);
      svgFrame.name = `[A] ${fileName} (Standard SVG import)`;
      svgFrame.x = cx - svgFrame.width / 2 - svgFrame.width / 2 - GAP;
      svgFrame.y = cy - svgFrame.height / 2;
      figma.currentPage.appendChild(svgFrame);
      results['standardSvgImport'] = 'success';
      results['svgFrameSize'] = { width: svgFrame.width, height: svgFrame.height };
    } catch (e) {
      results['standardSvgImport'] = `error: ${(e as Error).message}`;
    }

    // ── TEST B: Separate figma.createImage() import ──
    try {
      const bytes = new Uint8Array(pngBytesArray);
      const image = figma.createImage(bytes);

      // Get the actual stored size
      let actualSize: { width: number; height: number } | null = null;
      try {
        actualSize = await image.getSizeAsync();
        results['figmaImageSizeAfterImport'] = actualSize;
      } catch (e) {
        results['figmaImageSizeAfterImport'] = `getSizeAsync() failed: ${(e as Error).message}`;
      }

      // Create Rectangle with SVG geometry (NOT the image pixel dimensions)
      const rect = figma.createRectangle();
      rect.name = `[B] ${fileName} (Separate image import)`;
      rect.fills = [{ type: 'IMAGE', scaleMode: 'FIT', imageHash: image.hash }];

      // Size from SVG geometry
      rect.resize(Math.max(1, svgW), Math.max(1, svgH));
      rect.x = cx - rect.width / 2 + GAP;
      rect.y = cy - rect.height / 2;
      figma.currentPage.appendChild(rect);

      results['separateImport'] = 'success';
      results['rectPlacedSize'] = { width: rect.width, height: rect.height };
    } catch (e) {
      results['separateImport'] = `error: ${(e as Error).message}`;
    }

    // ── TEST C: Rectangle sized to actual Figma image dimensions ──
    // (To see what Figma actually stored, without any scaling)
    try {
      const bytes2 = new Uint8Array(pngBytesArray);
      const image2 = figma.createImage(bytes2);
      const actualSize2 = await image2.getSizeAsync();

      const rect2 = figma.createRectangle();
      rect2.name = `[C] ${fileName} (At Figma internal size)`;
      rect2.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image2.hash }];
      rect2.resize(actualSize2.width, actualSize2.height);
      rect2.x = cx - rect2.width / 2 + GAP * 3 + svgW;
      rect2.y = cy - rect2.height / 2;
      figma.currentPage.appendChild(rect2);

      results['testCFigmaInternalSize'] = actualSize2;
    } catch (e) {
      results['testC'] = `error: ${(e as Error).message}`;
    }

    // Send results back
    figma.ui.postMessage({ type: 'poc-results', results });

    // Zoom to view
    const allNodes = figma.currentPage.children.slice(-3);
    figma.viewport.scrollAndZoomIntoView(allNodes);
  }

  if (msg['type'] === 'close') {
    figma.closePlugin();
  }
};
