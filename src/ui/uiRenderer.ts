/**
 * uiRenderer.ts — UI Rendering, DOM management, and View transitions.
 */

import type { SVGImportResult, UIMessage } from '../shared/types.js';
import { buildSVGSummary } from '../shared/importReport.js';
import type { AppView, SVGFileEntry } from './uiState.js';
import { state } from './uiState.js';

export const $ = (id: string) => document.getElementById(id)!;

// DOM Element references
export const dropZone        = $('drop-zone') as HTMLDivElement;
export const fileInput       = $('file-input') as HTMLInputElement;
export const fileList        = $('file-list');
export const btnImport       = $('btn-import') as HTMLButtonElement;
export const btnSettings     = $('btn-settings') as HTMLButtonElement;
export const btnDebug        = $('btn-debug') as HTMLButtonElement;
export const btnAddMore      = $('btn-add-more') as HTMLButtonElement;
export const settingsPanel   = $('settings-panel');
export const toggleOptimize  = $('toggle-optimize') as HTMLInputElement;
export const toggleSliceImages = $('toggle-slice-images') as HTMLInputElement;
export const toggleOptimizeMasks = $('toggle-optimize-masks') as HTMLInputElement;
export const slicingSetting  = $('slicing-setting');
export const progressStage   = $('progress-stage');
export const progressSub     = $('progress-sub');
export const progressBar     = $('progress-bar') as HTMLDivElement;
export const reportHeaderWrap = $('report-header-wrap');
export const reportContent   = $('report-content');
export const debugSection    = $('debug-section');
export const debugLog        = $('debug-log');
export const toast           = $('toast');

export function sendToPlugin(msg: UIMessage): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function updateSize(immediate = false): void {
  const resize = () => {
    const header = document.querySelector('.header') as HTMLElement;
    const content = document.querySelector('.content') as HTMLElement;
    const actionBar = document.querySelector('.action-bar') as HTMLElement;

    if (!header || !content || !actionBar) return;

    const oldFlex = content.style.flex;
    const oldHeight = content.style.height;
    content.style.flex = 'none';
    content.style.height = 'auto';

    let height = header.offsetHeight + content.offsetHeight;
    if (actionBar.style.display !== 'none') {
      height += actionBar.offsetHeight;
    }

    content.style.flex = oldFlex;
    content.style.height = oldHeight;

    if (height > 600) height = 600;
    sendToPlugin({ type: 'resize-window', width: 400, height } as any);
  };

  if (immediate) resize();
  else setTimeout(resize, 50);
}

export function resetImportButton(): void {
  btnImport.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M8 1v10M4 7l4 4 4-4M2 14h12"/>
    </svg>
    Import to Figma`;
  btnImport.onclick = null;
}

export function showView(view: AppView): void {
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

export function renderFileList(): void {
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

  fileList.querySelectorAll('.file-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt((e.currentTarget as HTMLElement).dataset['index'] ?? '0');
      state.files.splice(idx, 1);
      renderFileList();
      if (state.files.length === 0) showView('idle');
    });
  });
}

export function setProgress(stage: string, stepId: string, current: number, total: number): void {
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

export function renderReport(results: SVGImportResult[]): void {
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

    inner += `</div>`;
    fileDiv.innerHTML = inner;
    reportContent.appendChild(fileDiv);
  }

  showView('report');
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string, duration = 3000): void {
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
}

export function debugAppend(msg: string): void {
  if (!state.debugMode) return;
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}`;
  debugLog.textContent = (debugLog.textContent ?? '') + '\n' + line;
  debugLog.scrollTop = debugLog.scrollHeight;
  console.log('[SVGImport UI]', msg);
}
