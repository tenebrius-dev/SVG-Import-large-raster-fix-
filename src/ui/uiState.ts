/**
 * uiState.ts — UI State management and type definitions.
 */

import type { PluginSettings } from '../shared/types.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';

export interface SVGFileEntry {
  fileName: string;
  svgText: string;
  rastersFound: number;
  largeRastersFound: number;
}

export type AppView = 'idle' | 'files' | 'progress' | 'report';

export interface UIState {
  files: SVGFileEntry[];
  settings: PluginSettings;
  view: AppView;
  debugMode: boolean;
  isImporting: boolean;
}

export const state: UIState = {
  files: [],
  settings: { ...DEFAULT_SETTINGS },
  view: 'idle',
  debugMode: false,
  isImporting: false,
};
