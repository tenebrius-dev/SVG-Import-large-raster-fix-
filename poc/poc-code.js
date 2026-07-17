"use strict";
(() => {
  // poc/poc-code.ts
  figma.showUI(__html__, { width: 440, height: 520, title: "SVG Import POC" });
  figma.ui.onmessage = async (msg) => {
    if (msg["type"] === "test-raster-import") {
      const {
        pngBytesArray,
        originalSvgString,
        svgX,
        svgY,
        svgW,
        svgH,
        transform,
        fileName
      } = msg;
      const results = {};
      const cx = figma.viewport.center.x;
      const cy = figma.viewport.center.y;
      const GAP = 80;
      try {
        const svgFrame = figma.createNodeFromSvg(originalSvgString);
        svgFrame.name = `[A] ${fileName} (Standard SVG import)`;
        svgFrame.x = cx - svgFrame.width / 2 - svgFrame.width / 2 - GAP;
        svgFrame.y = cy - svgFrame.height / 2;
        figma.currentPage.appendChild(svgFrame);
        results["standardSvgImport"] = "success";
        results["svgFrameSize"] = { width: svgFrame.width, height: svgFrame.height };
      } catch (e) {
        results["standardSvgImport"] = `error: ${e.message}`;
      }
      try {
        const bytes = new Uint8Array(pngBytesArray);
        const image = figma.createImage(bytes);
        let actualSize = null;
        try {
          actualSize = await image.getSizeAsync();
          results["figmaImageSizeAfterImport"] = actualSize;
        } catch (e) {
          results["figmaImageSizeAfterImport"] = `getSizeAsync() failed: ${e.message}`;
        }
        const rect = figma.createRectangle();
        rect.name = `[B] ${fileName} (Separate image import)`;
        rect.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: image.hash }];
        rect.resize(Math.max(1, svgW), Math.max(1, svgH));
        rect.x = cx - rect.width / 2 + GAP;
        rect.y = cy - rect.height / 2;
        figma.currentPage.appendChild(rect);
        results["separateImport"] = "success";
        results["rectPlacedSize"] = { width: rect.width, height: rect.height };
      } catch (e) {
        results["separateImport"] = `error: ${e.message}`;
      }
      try {
        const bytes2 = new Uint8Array(pngBytesArray);
        const image2 = figma.createImage(bytes2);
        const actualSize2 = await image2.getSizeAsync();
        const rect2 = figma.createRectangle();
        rect2.name = `[C] ${fileName} (At Figma internal size)`;
        rect2.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image2.hash }];
        rect2.resize(actualSize2.width, actualSize2.height);
        rect2.x = cx - rect2.width / 2 + GAP * 3 + svgW;
        rect2.y = cy - rect2.height / 2;
        figma.currentPage.appendChild(rect2);
        results["testCFigmaInternalSize"] = actualSize2;
      } catch (e) {
        results["testC"] = `error: ${e.message}`;
      }
      figma.ui.postMessage({ type: "poc-results", results });
      const allNodes = figma.currentPage.children.slice(-3);
      figma.viewport.scrollAndZoomIntoView(allNodes);
    }
    if (msg["type"] === "close") {
      figma.closePlugin();
    }
  };
})();
