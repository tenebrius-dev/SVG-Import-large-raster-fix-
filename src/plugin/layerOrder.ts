/**
 * layerOrder.ts — Restore raster nodes to correct stacking position.
 *
 * Strategy:
 *   After createNodeFromSvg() produces a FrameNode, we search its entire
 *   subtree for a node whose name matches the placeholder name. Once found,
 *   we note the parent and child index, remove the placeholder, and insert
 *   the raster node at that exact index.
 *
 * Runs in Plugin sandbox.
 */

// ---------------------------------------------------------------------------
// Tree search
// ---------------------------------------------------------------------------

interface PlaceholderLocation {
  parent: ChildrenMixin & BaseNode;
  index: number;
  placeholderNode: SceneNode;
}

/**
 * Recursively search for a node by name within a subtree.
 * Returns the node, its parent, and its index among siblings.
 */
export function findPlaceholder(
  root: SceneNode,
  targetName: string,
): PlaceholderLocation | null {
  // Breadth-first search
  const queue: SceneNode[] = [root];

  while (queue.length > 0) {
    const node = queue.shift()!;

    if ('children' in node) {
      const children = (node as ChildrenMixin).children as SceneNode[];
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        if (child.name === targetName) {
          return {
            parent: node as ChildrenMixin & BaseNode,
            index: i,
            placeholderNode: child,
          };
        }
        queue.push(child);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Node insertion
// ---------------------------------------------------------------------------

/**
 * Replace a placeholder node with the raster node at the same position.
 * If the placeholder is not found, appends the raster to the SVG frame.
 */
export function replacePlaceholderWithRaster(
  svgFrame: FrameNode,
  placeholderName: string,
  rasterNode: RectangleNode,
  debugMode = false,
): void {
  const location = findPlaceholder(svgFrame as unknown as SceneNode, placeholderName);

  if (location) {
    const { parent, index, placeholderNode } = location;
    if (debugMode) {
      console.log(
        `[layerOrder] Found placeholder "${placeholderName}" at index ${index} in "${parent.name}"`,
      );
    }
    placeholderNode.remove();
    (parent as FrameNode).insertChild(index, rasterNode);
    if (debugMode) {
      console.log(`[layerOrder] Inserted raster "${rasterNode.name}" at index ${index}`);
    }
  } else {
    // Fallback: append to frame
    console.warn(
      `[layerOrder] Placeholder "${placeholderName}" not found — appending "${rasterNode.name}" to frame`,
    );
    svgFrame.appendChild(rasterNode);
  }
}
