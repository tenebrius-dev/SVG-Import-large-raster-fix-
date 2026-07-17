/**
 * ui.ts — Plugin UI entry point (runs in the Figma UI iframe).
 *
 * Responsibilities:
 *  - File input (Select Files button + drag & drop)
 *  - Clipboard reading (Paste button + Cmd/Ctrl+V)
 *  - SVG parsing and raster extraction (using DOMParser)
 *  - Sending import jobs to the plugin sandbox via postMessage
 *  - Rendering progress and import report
 */

import type {
  PluginMessage,
  UIMessage,
  ImportJobSVG,
  ProcessedRasterPayload,
  PluginSettings,
  SVGImportResult,
} from '../shared/types.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import { parseSVGDocument } from '../shared/svgParser.js';
import { sanitizeSVGDocument } from '../shared/security.js';
import { extractRasters } from '../shared/rasterExtractor.js';
import { optimizeSVGDocument } from '../shared/svgOptimizer.js';
import { sliceLargeImagesInDocument } from './slicer.js';
import { readSVGFromClipboard, readSVGFromPasteEvent, looksLikeSVG } from '../shared/clipboardHandler.js';
import { buildSVGSummary } from '../shared/importReport.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface SVGFileEntry {
  fileName: string;
  svgText: string;
  rastersFound: number;
  largeRastersFound: number;
}

type AppView = 'idle' | 'files' | 'progress' | 'report';

const state = {
  files: [] as SVGFileEntry[],
  settings: { ...DEFAULT_SETTINGS } as PluginSettings,
  view: 'idle' as AppView,
  debugMode: false,
  isImporting: false,
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (id: string) => document.getElementById(id)!;

const dropZone      = $('drop-zone') as HTMLDivElement;
const fileInput     = $('file-input') as HTMLInputElement;
const fileList      = $('file-list');
const btnImport     = $('btn-import') as HTMLButtonElement;
const btnSettings   = $('btn-settings') as HTMLButtonElement;
const btnDebug      = $('btn-debug') as HTMLButtonElement;
const btnAddMore    = $('btn-add-more') as HTMLButtonElement;
const settingsPanel = $('settings-panel');
const toggleOptimize = $('toggle-optimize') as HTMLInputElement;
const toggleSliceImages = $('toggle-slice-images') as HTMLInputElement;
const slicingSetting = $('slicing-setting');
const progressStage = $('progress-stage');
const progressSub   = $('progress-sub');
const progressBar   = $('progress-bar') as HTMLDivElement;
const reportHeaderWrap = $('report-header-wrap');
const reportContent = $('report-content');
const debugSection  = $('debug-section');
const debugLog      = $('debug-log');
const toast         = $('toast');

// ---------------------------------------------------------------------------
// View management
// ---------------------------------------------------------------------------

function updateSize(immediate = false): void {
  const resize = () => {
    const header = document.querySelector('.header') as HTMLElement;
    const content = document.querySelector('.content') as HTMLElement;
    const actionBar = document.querySelector('.action-bar') as HTMLElement;

    if (!header || !content || !actionBar) return;

    // Temporarily disable flex to measure true intrinsic height
    const oldFlex = content.style.flex;
    const oldHeight = content.style.height;
    content.style.flex = 'none';
    content.style.height = 'auto';

    let height = header.offsetHeight + content.offsetHeight;
    if (actionBar.style.display !== 'none') {
      height += actionBar.offsetHeight;
    }

    // Restore styles
    content.style.flex = oldFlex;
    content.style.height = oldHeight;

    if (height > 600) height = 600;
    // adding a tiny 4px buffer to ensure no cutoff at the very bottom
    height += 4;
    sendToPlugin({ type: 'resize-window', width: 400, height } as any);
  };
  if (immediate) resize();
  else setTimeout(resize, 50);
}

function showView(view: AppView): void {
  state.view = view;
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  $(`view-${view}`).classList.add('active');

  const actionBar = $('action-bar');
  if (view === 'idle' || view === 'files') {
    actionBar.style.display = 'flex';
    btnImport.disabled = view === 'idle' || state.files.length === 0;
  } else if (view === 'progress') {
    actionBar.style.display = 'none';
  } else if (view === 'report') {
    actionBar.style.display = 'flex';
    btnImport.textContent = '';
    btnImport.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M8 1v10M4 7l4 4 4-4M2 14h12"/>
      </svg>
      Reset Plugin`;
    btnImport.disabled = false;
    btnImport.onclick = () => {
      state.files = [];
      renderFileList();
      showView('idle');
      resetImportButton();
    };
  }
  updateSize();
}

function resetImportButton(): void {
  btnImport.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M8 1v10M4 7l4 4 4-4M2 14h12"/>
    </svg>
    Import to Figma`;
  btnImport.onclick = null;
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

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
    debugLog.textContent += `\n[parse error] ${fileName}: ${(e as Error).message}`;
    return null;
  }
}

async function addFiles(fileList_: FileList | File[]): Promise<void> {
  const files = Array.from(fileList_);
  const results = await Promise.all(files.map(readFileAsSVG));
  const valid = results.filter(Boolean) as SVGFileEntry[];

  // De-duplicate by fileName
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
  let baseName = source === 'clipboard' ? 'clipboard' : 'pasted';
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
// File list rendering
// ---------------------------------------------------------------------------

function renderFileList(): void {
  fileList.innerHTML = '';
  btnImport.disabled = state.files.length === 0;

  for (let i = 0; i < state.files.length; i++) {
    const entry = state.files[i]!;
    const div = document.createElement('div');
    div.className = 'file-item';

    const hasLarge = entry.largeRastersFound > 0;

    div.innerHTML = `
      <div class="file-icon">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M13 6H9V2L13 6z"/>
          <path d="M9 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V6L9 2z"/>
        </svg>
      </div>
      <div class="file-info">
        <div class="file-name" title="${escapeHtml(entry.fileName)}">${escapeHtml(entry.fileName)}</div>
        <div class="file-meta">
          ${entry.rastersFound > 0
            ? `${entry.rastersFound} embedded image${entry.rastersFound > 1 ? 's' : ''}`
            : 'No embedded rasters'}
        </div>
      </div>
      ${hasLarge
        ? `<div class="file-badge">${entry.largeRastersFound} large raster${entry.largeRastersFound > 1 ? 's' : ''}</div>`
        : entry.rastersFound > 0
          ? '<div class="file-badge warn">Small rasters</div>'
          : ''}
      <button class="file-remove" data-index="${i}" aria-label="Remove ${escapeHtml(entry.fileName)}">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M1 1l10 10M11 1L1 11"/>
        </svg>
      </button>
    `;

    fileList.appendChild(div);
  }

  // Remove buttons
  fileList.querySelectorAll('.file-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt((e.currentTarget as HTMLElement).dataset['index'] ?? '0');
      state.files.splice(idx, 1);
      renderFileList();
      if (state.files.length === 0) showView('idle');
    });
  });
}

// ---------------------------------------------------------------------------
// Progress rendering
// ---------------------------------------------------------------------------

const STAGES = ['parse', 'extract', 'import-svg', 'import-raster', 'restore', 'done'];

function setProgress(stage: string, stepId: string, current: number, total: number): void {
  progressStage.textContent = stage;
  progressSub.textContent = total > 0 ? `${current} / ${total}` : '';
  progressBar.style.width = total > 0 ? `${Math.round((current / total) * 100)}%` : '0%';

  const stageItems = document.querySelectorAll('.stage-item');
  let found = false;
  stageItems.forEach((el) => {
    const s = (el as HTMLElement).dataset['stage'];
    if (!found) {
      if (s === stepId) {
        el.className = 'stage-item active';
        found = true;
      } else {
        el.className = 'stage-item done';
      }
    } else {
      el.className = 'stage-item';
    }
  });

  updateSize();
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderReport(results: SVGImportResult[]): void {
  const hasErrors = results.some((r) => !r.success);
  const totalExtracted = results.reduce((s, r) => s + r.rastersExtracted, 0);

  reportHeaderWrap.innerHTML = `
    <div class="report-header ${hasErrors ? 'has-errors' : ''}">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        ${hasErrors
          ? '<circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 11v.5"/>'
          : '<circle cx="8" cy="8" r="6"/><path d="M5 8l2.5 2.5L11 5.5"/>'}
      </svg>
      <div class="report-header-text">
        <strong>${hasErrors ? 'Import completed with errors' : 'Import complete'}</strong>
        <span>${results.length} file${results.length > 1 ? 's' : ''} • ${totalExtracted} raster${totalExtracted !== 1 ? 's' : ''} extracted</span>
      </div>
    </div>
  `;

  reportContent.innerHTML = '';

  for (const result of results) {
    const summary = buildSVGSummary(result);
    const fileDiv = document.createElement('div');
    fileDiv.className = 'report-file';

    let inner = `
      <div class="report-file-header" style="cursor:pointer;" data-toggle-details>
        <span class="report-file-name">${escapeHtml(summary.fileName)}</span>
        <span class="status-badge ${summary.success ? 'success' : 'error'}">
          ${summary.success ? '✓ OK' : '✗ Error'}
        </span>
        <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="width:12px; height:12px; color:var(--text-muted); transition:transform 0.2s; margin-left: 4px;">
          <path d="M4 6l4 4 4-4"/>
        </svg>
      </div>
      <div class="report-file-details" style="display: none;">
    `;

    if (summary.error) {
      inner += `<div class="report-raster"><span class="error-text" style="font-size:11px;">${escapeHtml(summary.error)}</span></div>`;
    }

    for (const entry of summary.rasterEntries) {
      inner += `
        <div class="report-raster">
          <table class="report-table">
            <tr>
              <td>Original bitmap</td>
              <td class="highlight">${escapeHtml(entry.bitmapOriginal)}</td>
            </tr>
            <tr>
              <td>Standard SVG import est.</td>
              <td class="warning-text">${escapeHtml(entry.stdSvgImportEstimate)}</td>
            </tr>
            <tr>
              <td>Figma internal size</td>
              <td class="${entry.figmaInternalSize.startsWith('Not') ? 'warning-text' : 'success-text'}">
                ${escapeHtml(entry.figmaInternalSize)}
              </td>
            </tr>
            <tr>
              <td>Placed size</td>
              <td>${escapeHtml(entry.placedSize)}</td>
            </tr>
            ${entry.error ? `<tr><td>Status</td><td class="error-text">${escapeHtml(entry.error)}</td></tr>` : `<tr><td>Status</td><td class="success-text">✓ Restored</td></tr>`}
          </table>
        </div>
      `;
    }

    if (summary.warnings.length > 0) {
      inner += `<div class="warnings-list">`;
      summary.warnings.forEach((w) => {
        inner += `<div class="warning-item">${escapeHtml(w)}</div>`;
      });
      inner += `</div>`;
    }

    if (summary.rasterEntries.length === 0 && summary.warnings.length === 0 && !summary.error) {
      inner += `
        <div class="report-raster">
          <span style="color:var(--text-secondary); font-size:10px;">No large rasters found. Import completed natively.</span>
        </div>
      `;
    }

    inner += `</div>`; // close .report-file-details

    fileDiv.innerHTML = inner;
    reportContent.appendChild(fileDiv);
  }

  showView('report');
}

// Add event delegation for the report accordion
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

// ---------------------------------------------------------------------------
// Image processing & downscaling helper
// ---------------------------------------------------------------------------

/**
 * Ensures the raster image fits within Figma's 4096px limit.
 * If it exceeds 4096px on either side, it is downscaled using HTML5 Canvas.
 */
async function processAndDownscaleImage(
  base64Data: string,
  mimeType: string,
  bitmapDimensions: { width: number; height: number } | null
): Promise<{ bytes: Uint8Array; dimensions: { width: number; height: number }; downscaled: boolean }> {
  // If we already know the dimensions and they are within limits, skip canvas entirely
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

  // High quality resizing configurations
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

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

async function runImport(): Promise<void> {
  if (state.files.length === 0 || state.isImporting) return;
  state.isImporting = true;
  showView('progress');
  setProgress('Parsing SVG', 0, state.files.length);

  const jobs: ImportJobSVG[] = [];

  for (let i = 0; i < state.files.length; i++) {
    const entry = state.files[i]!;

    setProgress(`Parsing SVG (${i + 1}/${state.files.length})`, i, state.files.length);

    try {
      // 1. Parse
      const { doc, info } = parseSVGDocument(entry.svgText);

      // 2. Sanitize
      const { svgString: sanitized, warnings: secWarnings } = sanitizeSVGDocument(doc, entry.fileName);
      secWarnings.forEach((w) => debugAppend(`[security] ${w}`));

      // Re-parse after sanitization
      const { doc: cleanDoc, info: cleanInfo } = parseSVGDocument(sanitized);

      if (state.settings.optimizeMasks) {
        const optWarnings = optimizeSVGDocument(cleanDoc, cleanInfo);
        optWarnings.forEach((w) => debugAppend(`[optimize] ${w}`));
      }

      if (state.settings.sliceLargeImages) {
        setProgress(`Slicing large images (${i + 1}/${state.files.length})`, i, state.files.length);
        const sliceWarnings = await sliceLargeImagesInDocument(cleanDoc);
        sliceWarnings.forEach((w) => debugAppend(`[slice] ${w}`));
      }

      setProgress(`Extracting rasters (${i + 1}/${state.files.length})`, i, state.files.length);

      // 3. Extract rasters
      const { rasters, cleanedSvgString, extractionWarnings } = extractRasters(
        cleanDoc,
        cleanInfo,
        state.settings,
        entry.fileName,
      );
      extractionWarnings.forEach((w) => debugAppend(`[extract] ${w}`));

      // 4. Compute geometry + prepare payloads
      const processedRasters: ProcessedRasterPayload[] = [];

      for (const rasterInfo of rasters) {
        if (!rasterInfo.willExtract) {
          debugAppend(`[extract] Skipping "${rasterInfo.name}" (within threshold)`);
          continue;
        }

        setProgress(`Processing image "${rasterInfo.name}"`, i, state.files.length);

        // Process / downscale if necessary
        let bytes: Uint8Array;
        try {
          const res = await processAndDownscaleImage(
            rasterInfo.base64Data,
            rasterInfo.mimeType,
            rasterInfo.bitmapDimensions
          );
          bytes = res.bytes;
          
          if (res.downscaled) {
            debugAppend(`[downscale] Resized "${rasterInfo.name}" to ${res.dimensions.width}×${res.dimensions.height} to fit 4096px limit`);
            // Update rasterInfo so the report reflects the imported size
            rasterInfo.bitmapDimensions = res.dimensions;
          }
        } catch (e) {
          debugAppend(`[downscale] Failed to process/downscale "${rasterInfo.name}": ${(e as Error).message}`);
          continue;
        }

        // Compute geometry
        const scaleMode = rasterInfo.preserveAspectRatio.includes('slice') ? 'FILL' : 'FIT';
        const geometry = { scaleMode: scaleMode as any };

        debugAppend(
          `[geometry] "${rasterInfo.name}": scaleMode=${geometry.scaleMode}`,
        );

        processedRasters.push({
          info: rasterInfo,
          bytes,
          geometry,
        });
      }

      jobs.push({
        svgFileName: entry.fileName,
        cleanedSvgString,
        rasters: processedRasters,
        svgInfo: cleanInfo,
        settings: state.settings,
      });

      debugAppend(
        `[job] "${entry.fileName}": ${processedRasters.length} rasters to extract, ` +
        `SVG ${cleanInfo.width}×${cleanInfo.height}, ` +
        `viewBox=${JSON.stringify(cleanInfo.viewBox)}`,
      );
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

  setProgress('Importing vectors', state.files.length, state.files.length);

  // Send to plugin
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
// Plugin communication
// ---------------------------------------------------------------------------

function sendToPlugin(msg: UIMessage): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const toggleOptimizeMasks = $('toggle-optimize-masks') as HTMLInputElement;

function syncSettings(): void {
  state.settings.optimizeLargeRasters = toggleOptimize.checked;
  state.settings.sliceLargeImages = toggleSliceImages.checked;
  state.settings.debugMode = state.debugMode;
  state.settings.optimizeMasks = toggleOptimizeMasks.checked;
  slicingSetting.style.display = toggleOptimize.checked ? 'flex' : 'none';

  // Re-analyze files with new settings
  for (let i = 0; i < state.files.length; i++) {
    const entry = state.files[i]!;
    const updated = analyzeFile(entry.fileName, entry.svgText);
    if (updated) state.files[i] = updated;
  }
  renderFileList();
}

toggleOptimizeMasks.addEventListener('change', syncSettings);

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------

function debugAppend(msg: string): void {
  if (!state.debugMode) return;
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}`;
  debugLog.textContent = (debugLog.textContent ?? '') + '\n' + line;
  debugLog.scrollTop = debugLog.scrollHeight;
  console.log('[SVGImport UI]', msg);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string, duration = 3000): void {
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---------------------------------------------------------------------------
// Escape HTML
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
fileInput.addEventListener('change', async () => {
  if (fileInput.files?.length) {
    await addFiles(fileInput.files);
    fileInput.value = '';
  }
});

// Drag & drop
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

// Click on drop zone = open file picker
dropZone.addEventListener('click', () => fileInput.click());

// Keyboard: Enter on drop zone
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

// Paste (Cmd+V / Ctrl+V) when drop zone is focused or document-level
document.addEventListener('paste', async (e) => {
  const result = readSVGFromPasteEvent(e as ClipboardEvent);
  if (result) {
    e.preventDefault();
    await addSVGText(result.svgString, 'paste');
    showToast('SVG pasted from clipboard');
  }
});

// Paste button
// Add more files (from files view)
btnAddMore.addEventListener('click', () => fileInput.click());

// Import button
btnImport.addEventListener('click', () => {
  if (state.view === 'files' && state.files.length > 0) {
    runImport();
  }
});

// Settings toggle
btnSettings.addEventListener('click', () => {
  const isOpen = settingsPanel.style.display !== 'none';
  settingsPanel.style.display = isOpen ? 'none' : 'block';
  btnSettings.classList.toggle('active', !isOpen);
  updateSize();
});

// Debug toggle
btnDebug.addEventListener('click', () => {
  state.debugMode = !state.debugMode;
  state.settings.debugMode = state.debugMode;
  btnDebug.classList.toggle('active', state.debugMode);
  debugSection.style.display = state.debugMode ? 'block' : 'none';
  if (state.debugMode) debugAppend('[debug] Debug mode enabled');
  syncSettings();
  updateSize();
});

// Copy debug log
const btnCopyDebug = $('btn-copy-debug') as HTMLButtonElement;
btnCopyDebug.addEventListener('click', () => {
  const text = debugLog.textContent?.trim() || '';
  
  if (!text) {
    showToast('Log is empty');
    return;
  }
  
  // Fallback approach using textarea for restrictive iframe environments
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Prevent scrolling and ensure it is offscreen
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  
  textarea.focus();
  textarea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showToast('Debug log copied to clipboard');
    } else {
      throw new Error('execCommand failed');
    }
  } catch (err) {
    console.error('Fallback clipboard copy failed', err);
    // Try modern API if fallback fails (unlikely, but just in case)
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('Debug log copied to clipboard'))
        .catch(() => showToast('Failed to copy debug log'));
    } else {
      showToast('Failed to copy debug log');
    }
  } finally {
    document.body.removeChild(textarea);
  }
});

// Settings inputs
toggleOptimize.addEventListener('change', syncSettings);
toggleSliceImages.addEventListener('change', syncSettings);
toggleOptimizeMasks.addEventListener('change', syncSettings);

// Initialize
syncSettings();
showView('idle');
setTimeout(() => updateSize(true), 50);

// Announce ready to plugin
sendToPlugin({ type: 'ping' });
