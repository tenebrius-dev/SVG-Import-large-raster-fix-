/**
 * clipboardHandler.ts — Read SVG from the system clipboard.
 *
 * Runs in UI iframe (uses navigator.clipboard and paste events).
 *
 * Strategy:
 *   1. Try navigator.clipboard.readText() (modern, requires user gesture)
 *   2. Listen for 'paste' event on the drop zone (Cmd+V / Ctrl+V)
 *   3. Try navigator.clipboard.read() for image/svg+xml MIME type
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClipboardSVGResult {
  svgString: string;
  source: 'clipboard-api' | 'paste-event';
}

// ---------------------------------------------------------------------------
// Validate SVG content
// ---------------------------------------------------------------------------

/** Check if a string looks like an SVG (starts with <svg or has svg tag) */
export function looksLikeSVG(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('<svg') ||
    trimmed.startsWith('<?xml') ||
    /<svg[\s>]/i.test(trimmed)
  );
}

// ---------------------------------------------------------------------------
// navigator.clipboard approach
// ---------------------------------------------------------------------------

/**
 * Try to read SVG text from the clipboard using the Clipboard API.
 * Returns null if permission is denied, clipboard is empty, or content is not SVG.
 */
export async function readSVGFromClipboard(): Promise<ClipboardSVGResult | null> {
  if (!navigator.clipboard) {
    console.warn('[clipboard] navigator.clipboard not available (requires HTTPS or localhost)');
    return null;
  }

  // Try readText first (most compatible)
  try {
    const text = await navigator.clipboard.readText();
    if (text && looksLikeSVG(text)) {
      return { svgString: text, source: 'clipboard-api' };
    }
  } catch (e) {
    console.warn('[clipboard] readText() failed:', (e as Error).message);
  }

  // Try read() for image/svg+xml MIME type
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('image/svg+xml')) {
        const blob = await item.getType('image/svg+xml');
        const text = await blob.text();
        if (looksLikeSVG(text)) {
          return { svgString: text, source: 'clipboard-api' };
        }
      }
      if (item.types.includes('text/plain')) {
        const blob = await item.getType('text/plain');
        const text = await blob.text();
        if (looksLikeSVG(text)) {
          return { svgString: text, source: 'clipboard-api' };
        }
      }
    }
  } catch (e) {
    console.warn('[clipboard] read() failed:', (e as Error).message);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Paste event approach (used when drop zone is focused)
// ---------------------------------------------------------------------------

/**
 * Extract SVG from a ClipboardEvent (paste event).
 * Returns null if no SVG content is found.
 */
export function readSVGFromPasteEvent(event: ClipboardEvent): ClipboardSVGResult | null {
  const dt = event.clipboardData;
  if (!dt) return null;

  // Check text/plain
  const text = dt.getData('text/plain');
  if (text && looksLikeSVG(text)) {
    return { svgString: text, source: 'paste-event' };
  }

  // Check image/svg+xml
  const svgText = dt.getData('image/svg+xml');
  if (svgText && looksLikeSVG(svgText)) {
    return { svgString: svgText, source: 'paste-event' };
  }

  // Check text/html (Adobe Illustrator sometimes wraps SVG in HTML)
  const htmlText = dt.getData('text/html');
  if (htmlText) {
    const svgMatch = htmlText.match(/<svg[\s\S]*<\/svg>/i);
    if (svgMatch) {
      return { svgString: svgMatch[0], source: 'paste-event' };
    }
  }

  return null;
}
