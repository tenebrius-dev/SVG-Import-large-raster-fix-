/**
 * ui.ts — Plugin UI entry point (runs in the Figma UI iframe).
 *
 * Responsibilities:
 *  - Event listening (File picker, drag & drop, paste, toggles)
 *  - Orchestrating SVG parsing, raster extraction, downscaling
 *  - Communicating with plugin sandbox via postMessage
 */

import type {
  PluginMessage,
  ImportJobSVG,
  ProcessedRasterPayload,
} from '../shared/types.js';
import { parseSVGDocument } from '../shared/svgParser.js';
import { sanitizeSVGDocument } from '../shared/security.js';
import { extractRasters } from '../shared/rasterExtractor.js';
import { optimizeSVGDocument } from '../shared/svgOptimizer.js';
import { readSVGFromPasteEvent, looksLikeSVG } from '../shared/clipboardHandler.js';
import { sliceLargeImagesInDocument } from './slicer.js';
import { state } from './uiState.js';
import type { SVGFileEntry } from './uiState.js';
import {
  dropZone,
  fileInput,
  btnImport,
  btnSettings,
  btnAddMore,
  settingsPanel,
  toggleOptimize,
  toggleSliceImages,
  toggleOptimizeMasks,
  slicingSetting,
  reportContent,
  showView,
  renderFileList,
  setProgress,
  renderReport,
  showToast,
  debugAppend,
  sendToPlugin,
  updateSize,
} from './uiRenderer.js';
import { processAndDownscaleImage } from './imageProcessor.js';

// ---------------------------------------------------------------------------
// File analysis
// ---------------------------------------------------------------------------

function analyzeFile(fileName: string, svgText: string): SVGFileEntry | null {
  try {
    const { doc, info } = parseSVGDocument(svgText);
    const { rasters } = extractRasters(doc, info, state.settings, fileName);
    const largeRastersFound = rasters.filter((r) =>
      r.bitmapDimensions &&
      (r.bitmapDimensions.width > 4096 || r.bitmapDimensions.height > 4096),
    ).length;
    return {
      fileName,
      svgText,
      rastersFound: rasters.length,
      largeRastersFound,
    };
  } catch (e) {
    showToast(`Error parsing "${fileName}": ${(e as Error).message}`);
    debugAppend(`[parse error] ${fileName}: ${(e as Error).message}`);
    return null;
  }
}

async function readFileAsSVG(file: File): Promise<SVGFileEntry | null> {
  try {
    const text = await file.text();
    if (!looksLikeSVG(text)) {
      showToast(`"${file.name}" does not appear to be an SVG file`);
      return null;
    }
    return analyzeFile(file.name, text);
  } catch (e) {
    showToast(`Error reading "${file.name}": ${(e as Error).message}`);
    return null;
  }
}

async function addFiles(fileList_: FileList | File[]): Promise<void> {
  const files = Array.from(fileList_);
  const results = await Promise.all(files.map(readFileAsSVG));
  const valid = results.filter(Boolean) as SVGFileEntry[];

  for (const entry of valid) {
    if (!state.files.some((f) => f.fileName === entry.fileName)) {
      state.files.push(entry);
    }
  }

  renderFileList();
  if (state.files.length > 0) {
    showView('files');
  }
}

async function addSVGText(svgText: string, source = 'clipboard'): Promise<void> {
  const baseName = source === 'clipboard' ? 'clipboard' : 'pasted';
  let fileName = `${baseName}.svg`;
  let counter = 1;

  while (state.files.some((f) => f.fileName === fileName)) {
    fileName = `${baseName} (${counter}).svg`;
    counter++;
  }

  const entry = analyzeFile(fileName, svgText);
  if (!entry) return;

  state.files.push(entry);
  renderFileList();
  showView('files');
}

// ---------------------------------------------------------------------------
// Import Pipeline
// ---------------------------------------------------------------------------

async function runImport(): Promise<void> {
  if (state.files.length === 0 || state.isImporting) return;
  state.isImporting = true;
  showView('progress');
  setProgress('Parsing SVG', 'parse', 0, state.files.length);

  const jobs: ImportJobSVG[] = [];

  for (let i = 0; i < state.files.length; i++) {
    const entry = state.files[i]!;
    setProgress(`Parsing SVG (${i + 1}/${state.files.length})`, 'parse', i, state.files.length);

    try {
      // 1. Parse & Sanitize
      const { doc, info } = parseSVGDocument(entry.svgText);
      const { svgString: sanitized, warnings: secWarnings } = sanitizeSVGDocument(doc, entry.fileName);
      secWarnings.forEach((w) => debugAppend(`[security] ${w}`));

      const { doc: cleanDoc, info: cleanInfo } = parseSVGDocument(sanitized);

      if (state.settings.optimizeMasks) {
        const optWarnings = optimizeSVGDocument(cleanDoc, cleanInfo);
        optWarnings.forEach((w) => debugAppend(`[optimize] ${w}`));
      }

      if (state.settings.sliceLargeImages) {
        setProgress(`Slicing large images (${i + 1}/${state.files.length})`, 'extract', i, state.files.length);
        const sliceWarnings = await sliceLargeImagesInDocument(cleanDoc);
        sliceWarnings.forEach((w) => debugAppend(`[slice] ${w}`));
      }

      setProgress(`Extracting rasters (${i + 1}/${state.files.length})`, 'extract', i, state.files.length);

      // 2. Extract rasters
      const { rasters, cleanedSvgString, extractionWarnings } = extractRasters(
        cleanDoc,
        cleanInfo,
        state.settings,
        entry.fileName,
      );
      extractionWarnings.forEach((w) => debugAppend(`[extract] ${w}`));

      // 3. Process & downscale images
      const processedRasters: ProcessedRasterPayload[] = [];
      for (const rasterInfo of rasters) {
        if (!rasterInfo.willExtract) {
          debugAppend(`[extract] Skipping "${rasterInfo.name}" (within threshold)`);
          continue;
        }

        setProgress(`Processing image "${rasterInfo.name}"`, 'import-raster', i, state.files.length);

        let bytes: Uint8Array;
        try {
          const res = await processAndDownscaleImage(
            rasterInfo.base64Data,
            rasterInfo.mimeType,
            rasterInfo.bitmapDimensions,
          );
          bytes = res.bytes;

          if (res.downscaled) {
            debugAppend(`[downscale] Resized "${rasterInfo.name}" to ${res.dimensions.width}×${res.dimensions.height}`);
            rasterInfo.bitmapDimensions = res.dimensions;
          }
        } catch (e) {
          debugAppend(`[downscale] Failed to process "${rasterInfo.name}": ${(e as Error).message}`);
          continue;
        }

        const scaleMode = rasterInfo.preserveAspectRatio.includes('slice') ? 'FILL' : 'FIT';
        processedRasters.push({
          info: rasterInfo,
          bytes,
          geometry: { scaleMode: scaleMode as any },
        });
      }

      jobs.push({
        svgFileName: entry.fileName,
        cleanedSvgString,
        rasters: processedRasters,
        svgInfo: cleanInfo,
        settings: state.settings,
      });

    } catch (e) {
      debugAppend(`[error] "${entry.fileName}": ${(e as Error).message}`);
      jobs.push({
        svgFileName: entry.fileName,
        cleanedSvgString: entry.svgText,
        rasters: [],
        svgInfo: { width: 100, height: 100, viewBox: null, preserveAspectRatio: 'xMidYMid meet' },
        settings: state.settings,
      });
    }
  }

  setProgress('Importing vectors', 'import-svg', state.files.length, state.files.length);

  try {
    sendToPlugin({ type: 'import-svg-batch', jobs });
  } catch (e) {
    const err = (e as Error).message;
    debugAppend(`[error] Failed to send job to Figma plugin: ${err}`);
    showToast(`Failed to send data: ${err}`, 5000);
    state.isImporting = false;
    showView('files');
  }
}

// ---------------------------------------------------------------------------
// Settings Sync
// ---------------------------------------------------------------------------

function syncSettings(): void {
  state.settings.optimizeLargeRasters = toggleOptimize.checked;
  state.settings.sliceLargeImages = toggleSliceImages.checked;
  state.settings.debugMode = state.debugMode;
  state.settings.optimizeMasks = toggleOptimizeMasks.checked;
  slicingSetting.style.display = toggleOptimize.checked ? 'flex' : 'none';

  for (let i = 0; i < state.files.length; i++) {
    const entry = state.files[i]!;
    const updated = analyzeFile(entry.fileName, entry.svgText);
    if (updated) state.files[i] = updated;
  }
  renderFileList();
}

// ---------------------------------------------------------------------------
// Window Messaging & Event Listeners
// ---------------------------------------------------------------------------

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginMessage | undefined;
  if (!msg) return;

  switch (msg.type) {
    case 'pong':
      debugAppend('[plugin] Connected');
      break;
    case 'import-progress':
      setProgress(msg.stage, msg.stepId, msg.current, msg.total);
      break;
    case 'import-complete':
      state.isImporting = false;
      renderReport(msg.results);
      break;
    case 'import-error':
      state.isImporting = false;
      showToast(`Import error: ${msg.error}`, 5000);
      showView('files');
      break;
  }
};

// UI Events
fileInput.addEventListener('change', async () => {
  if (fileInput.files?.length) {
    await addFiles(fileInput.files);
    fileInput.value = '';
  }
});

dropZone.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer?.files.length) {
    await addFiles(e.dataTransfer.files);
  }
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

document.addEventListener('paste', async (e) => {
  const result = readSVGFromPasteEvent(e as ClipboardEvent);
  if (result) {
    e.preventDefault();
    await addSVGText(result.svgString, 'paste');
    showToast('SVG pasted from clipboard');
  }
});

btnAddMore.addEventListener('click', () => fileInput.click());

btnImport.addEventListener('click', () => {
  if (state.view === 'files' && state.files.length > 0) {
    runImport();
  }
});

btnSettings.addEventListener('click', () => {
  const isOpen = settingsPanel.style.display !== 'none';
  settingsPanel.style.display = isOpen ? 'none' : 'block';
  btnSettings.classList.toggle('active', !isOpen);
  updateSize();
});

toggleOptimize.addEventListener('change', syncSettings);
toggleSliceImages.addEventListener('change', syncSettings);
toggleOptimizeMasks.addEventListener('change', syncSettings);

reportContent.addEventListener('click', (e) => {
  const header = (e.target as HTMLElement).closest('.report-file-header') as HTMLElement;
  if (header) {
    const details = header.nextElementSibling as HTMLElement;
    const chevron = header.querySelector('.chevron') as HTMLElement;
    if (details) {
      const isHidden = details.style.display === 'none';
      details.style.display = isHidden ? 'block' : 'none';
      if (chevron) {
        chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      }
      updateSize();
    }
  }
});

// Initialize initial view and calculate window size
showView('idle');
