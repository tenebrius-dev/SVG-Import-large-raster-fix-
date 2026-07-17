/**
 * code.ts — Figma Plugin sandbox entry point.
 *
 * This code runs in the Figma plugin sandbox (not the UI iframe).
 * It has access to the Figma Plugin API (figma.*) but NOT to browser APIs
 * like DOMParser, navigator, etc.
 *
 * Communication with the UI:
 *   UI → Plugin: figma.ui.onmessage
 *   Plugin → UI: figma.ui.postMessage
 */

import type { UIMessage, PluginMessage, ImportJobSVG, SVGImportResult, RasterImportResult } from '../shared/types.js';
import { importCleanSVG } from './svgImporter.js';
import { importRaster } from './rasterImporter.js';
import { findPlaceholder } from './layerOrder.js';

// ---------------------------------------------------------------------------
// Plugin initialization
// ---------------------------------------------------------------------------

figma.showUI(__html__, {
  width: 400,
  height: 600,
  title: 'SVG Smart Import',
  themeColors: true,
});

figma.ui.postMessage({ type: 'pong' } as PluginMessage);

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (rawMsg: unknown) => {
  const msg = rawMsg as UIMessage;

  switch (msg.type) {
    case 'ping':
      figma.ui.postMessage({ type: 'pong' } as PluginMessage);
      break;

    case 'resize-window':
      figma.ui.resize(msg.width, msg.height);
      break;

    case 'close':
      figma.closePlugin();
      break;

    case 'import-svg-batch':
      await handleImportBatch(msg.jobs);
      break;

    default:
      console.warn('[code] Unknown message type:', (msg as { type: string }).type);
  }
};

// ---------------------------------------------------------------------------
// Batch import handler
// ---------------------------------------------------------------------------

async function handleImportBatch(jobs: ImportJobSVG[]): Promise<void> {
  const results: SVGImportResult[] = [];
  const total = jobs.length;

  // Track x position for placing SVGs side by side
  let canvasX = Math.round(figma.viewport.center.x);
  const canvasY = Math.round(figma.viewport.center.y);
  const GAP = 100; // px between SVGs

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const { settings } = job;

    await sendProgress(`Processing "${job.svgFileName}"`, 'import-svg', i, total);

    let result: SVGImportResult;
    try {
      result = await processSingleSVG(job, canvasX, canvasY);
      canvasX += result.frameNodeId ? getFrameWidth(result.frameNodeId) + GAP : GAP;
    } catch (e) {
      result = {
        svgFileName: job.svgFileName,
        success: false,
        error: (e as Error).message,
        rastersFound: 0,
        rastersExtracted: 0,
        rasterResults: [],
        warnings: [],
        frameNodeId: null,
      };
    }

    results.push(result);

    if (settings.debugMode) {
      console.log(`[code] Completed "${job.svgFileName}":`, result);
    }
  }

  await sendProgress('Done', 'done', total, total);
  figma.ui.postMessage({ type: 'import-complete', results } as PluginMessage);

  // Scroll to view all imported frames
  try {
    const frameIds = results
      .filter((r) => r.frameNodeId)
      .map((r) => figma.getNodeById(r.frameNodeId!))
      .filter(Boolean) as SceneNode[];
    if (frameIds.length > 0) {
      figma.currentPage.selection = frameIds;
      figma.viewport.scrollAndZoomIntoView(frameIds);
    }
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Single SVG processing
// ---------------------------------------------------------------------------

async function processSingleSVG(
  job: ImportJobSVG,
  canvasX: number,
  canvasY: number,
): Promise<SVGImportResult> {
  const { svgFileName, cleanedSvgString, rasters, settings } = job;
  const frameName = svgFileName.replace(/\.svg$/i, '');
  const warnings: string[] = [];
  const rasterResults: RasterImportResult[] = [];

  // ── STEP 1: Import clean SVG (vectors + placeholder rects) ──────────────
  await sendProgress(`Importing vectors for "${svgFileName}"`, 'import-svg', 0, 1);

  let svgFrame: FrameNode;
  try {
    svgFrame = importCleanSVG(cleanedSvgString, frameName);
  } catch (e) {
    throw new Error(`SVG import failed for "${svgFileName}": ${(e as Error).message}`);
  }

  // Position on canvas
  svgFrame.x = canvasX;
  svgFrame.y = canvasY;
  figma.currentPage.appendChild(svgFrame);

  if (settings.debugMode) {
    console.log(`[code] Imported SVG frame: "${frameName}" at (${canvasX}, ${canvasY})`);
    console.log(`  Frame size: ${svgFrame.width}×${svgFrame.height}`);
    console.log(`  Children count: ${svgFrame.children.length}`);
  }

  // ── STEP 2: Import each raster separately ───────────────────────────────
  for (let i = 0; i < rasters.length; i++) {
    const payload = rasters[i]!;
    await sendProgress(
      `Importing raster "${payload.info.name}" (${i + 1}/${rasters.length})`,
      'import-raster',
      i,
      rasters.length,
    );

    try {
      const location = figma.getNodeById(svgFrame.id) 
        ? findPlaceholder(svgFrame as unknown as SceneNode, payload.info.placeholderName)
        : null;

      if (!location) {
        throw new Error(`Placeholder node "${payload.info.placeholderName}" not found in Figma tree`);
      }

      const { result } = await importRaster(payload, location.placeholderNode as RectangleNode, settings.debugMode);
      rasterResults.push(result);

      // Handle clip-path warning
      if (payload.info.clipPath) {
        warnings.push(
          `"${payload.info.name}" has clip-path="${payload.info.clipPath}" — clipping may not be fully restored`,
        );
      }
      if (payload.info.maskAttr) {
        warnings.push(
          `"${payload.info.name}" has mask="${payload.info.maskAttr}" — mask may not be fully restored`,
        );
      }
    } catch (e) {
      const errMsg = `Failed to import raster "${payload.info.name}": ${(e as Error).message}`;
      console.error('[code]', errMsg);
      rasterResults.push({
        placeholderName: payload.info.placeholderName,
        name: payload.info.name,
        actualFigmaSize: null,
        placedWidth: 0,
        placedHeight: 0,
        bitmapDimensions: payload.info.bitmapDimensions,
        error: errMsg,
      });
      warnings.push(errMsg);
    }
  }

  // Clean up any remaining placeholders (for non-extracted rasters)
  cleanRemainingPlaceholders(svgFrame, settings.debugMode);

  return {
    svgFileName,
    success: true,
    error: null,
    rastersFound: rasters.length,
    rastersExtracted: rasters.filter((r) => r.info.willExtract).length,
    rasterResults,
    warnings,
    frameNodeId: svgFrame.id,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function sendProgress(stage: string, stepId: string, current: number, total: number): Promise<void> {
  figma.ui.postMessage({
    type: 'import-progress',
    stage,
    stepId,
    current,
    total,
  } as PluginMessage);
  // Yield to Figma to allow UI to receive message and update layout
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function getFrameWidth(nodeId: string): number {
  try {
    const node = figma.getNodeById(nodeId);
    if (node && 'width' in node) return (node as FrameNode).width;
  } catch {
    // ignore
  }
  return 0;
}

/** Remove any leftover placeholder <rect> elements from the frame subtree */
function cleanRemainingPlaceholders(frame: FrameNode, debugMode: boolean): void {
  function traverse(node: SceneNode): void {
    if ('children' in node) {
      const children = [...(node as ChildrenMixin).children];
      for (const child of children) {
        if (child.name.startsWith('__svg_raster_') && child.name.endsWith('__')) {
          if (debugMode) console.log(`[code] Removing leftover placeholder: "${child.name}"`);
          child.remove();
        } else {
          traverse(child as SceneNode);
        }
      }
    }
  }
  traverse(frame as unknown as SceneNode);
}
