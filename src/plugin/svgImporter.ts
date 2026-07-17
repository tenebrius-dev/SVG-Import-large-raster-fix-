/**
 * svgImporter.ts — Wrapper around figma.createNodeFromSvg().
 *
 * Runs in Plugin sandbox.
 */

/**
 * Import a cleaned SVG string as a Figma FrameNode.
 * The returned frame contains all vector elements from the SVG,
 * with placeholder <rect> nodes where rasters were extracted.
 *
 * @throws if Figma's SVG importer fails (malformed SVG, etc.)
 */
export function importCleanSVG(svgString: string, frameName: string): FrameNode {
  let frame: FrameNode;
  try {
    frame = figma.createNodeFromSvg(svgString);
  } catch (e) {
    throw new Error(`figma.createNodeFromSvg() failed: ${(e as Error).message}`);
  }

  frame.name = frameName;
  return frame;
}
