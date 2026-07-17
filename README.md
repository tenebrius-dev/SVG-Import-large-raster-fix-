# SVG Smart Import — Figma Plugin

Figma plugin for importing SVG files with correct handling of large embedded raster images (PNG/JPEG >4096 px).

## Problem

When Figma's standard SVG importer encounters embedded raster images larger than 4096 px, it applies aggressive power-of-two downsampling:

| Bitmap size | Standard SVG import result |
|-------------|---------------------------|
| ≤4096 px    | Preserved                 |
| 4097–8192   | Halved (~÷2)              |
| 8193–16384  | Quartered (~÷4)           |

**Example:** PNG 5387×3010 becomes ≈2694×1505 in standard SVG import.

**Expected (separate raster import):** ≈4096×2289 (standard proportional resize to 4096 max side).

## Solution

1. Parse SVG and find all embedded rasters
2. Extract rasters with >4096 px dimensions
3. Replace each with an invisible placeholder in the SVG
4. Import the clean SVG via `figma.createNodeFromSvg()` (vectors preserved)
5. Import each raster separately via `figma.createImage(bytes)` (avoids power-of-two downsampling)
6. Restore original SVG geometry (position, scale, transform) for each raster node
7. Restore correct stacking order
8. Restore layer names

## Architecture

```
svg-smart-import/
├── manifest.json               # Figma plugin manifest
├── package.json
├── tsconfig.json
├── esbuild.config.js           # Build script
├── vitest.config.ts            # Test runner config
│
├── src/
│   ├── plugin/                 # Figma sandbox code (no DOM APIs)
│   │   ├── code.ts             # Main entry point
│   │   ├── rasterImporter.ts   # figma.createImage() wrapper
│   │   ├── svgImporter.ts      # figma.createNodeFromSvg() wrapper
│   │   └── layerOrder.ts       # Stacking order restoration
│   │
│   ├── ui/                     # UI iframe code
│   │   ├── ui.html             # HTML template
│   │   ├── ui.ts               # UI controller
│   │   └── styles/main.css     # Dark theme CSS
│   │
│   └── shared/                 # Shared between UI and plugin
│       ├── types.ts            # All TypeScript types
│       ├── matrixUtils.ts      # Affine matrix math
│       ├── transformParser.ts  # SVG transform string parser
│       ├── pngDimensions.ts    # PNG IHDR dimension reader
│       ├── jpegDimensions.ts   # JPEG SOF dimension reader
│       ├── preserveAspectRatio.ts  # PAR → Figma ScaleMode
│       ├── svgParser.ts        # SVG document metadata (UI-only)
│       ├── rasterExtractor.ts  # Find & extract <image> elements (UI-only)
│       ├── geometryRestorer.ts # Compute Figma geometry from SVG data
│       ├── clipboardHandler.ts # Clipboard SVG reading (UI-only)
│       ├── security.ts         # SVG sanitization (UI-only)
│       └── importReport.ts     # Report formatting
│
├── poc/                        # Proof of Concept (separate plugin)
│   ├── poc-manifest.json
│   ├── poc-code.ts
│   └── poc-ui.html
│
├── tests/                      # Unit tests (Vitest)
│   ├── matrixUtils.test.ts
│   ├── transformParser.test.ts
│   ├── pngDimensions.test.ts
│   ├── jpegDimensions.test.ts
│   ├── geometryRestorer.test.ts
│   └── fixtures/
│       └── createTestSVGs.ts   # Generate test SVG files
│
└── dist/                       # Build output (gitignored)
    ├── code.js
    └── ui.html
```

## Setup

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Watch mode (rebuilds on file change)
npm run watch

# Run unit tests
npm test
```

## Loading in Figma Desktop

### Main Plugin

1. Open **Figma Desktop**
2. Go to **Plugins → Development → Import plugin from manifest...**
3. Select `manifest.json` from the project root
4. The plugin will appear under **Plugins → Development → SVG Smart Import**

### POC (Proof of Concept)

> ⚠️ **Run the POC first** to verify the core hypothesis before using the full plugin.

1. Build the POC code:
   ```bash
   npx esbuild poc/poc-code.ts --bundle --outfile=poc/poc-code.js --platform=browser --target=chrome112
   ```
2. Import from manifest: select `poc/poc-manifest.json`
3. Drag an SVG with embedded PNG >4096 px into the POC window
4. Click **Run POC Test**
5. Compare results:
   - **[A]** Standard SVG import (known: ~half resolution for >4096)
   - **[B]** Separate `figma.createImage()` at SVG geometry
   - **[C]** Rectangle sized to actual Figma internal image dimensions
6. Check the log: if `figmaImageSizeAfterImport` shows >4096 px → hypothesis confirmed ✓

## Usage

### 1. Drag & Drop
Drop one or more `.svg` files directly into the plugin's drop zone.

### 2. Select Files
Click **Select SVG Files** to open the system file picker.

### 3. Clipboard
- Click **Paste from Clipboard** (uses `navigator.clipboard`)
- Or focus the drop zone and press **Cmd+V** / **Ctrl+V**
- Works with: plain SVG text, `image/svg+xml` MIME, SVG in HTML (Adobe Illustrator)

### Settings
- **Optimize large embedded rasters** — master on/off switch
- **Process images over 4096 px only** (default) — only extract rasters exceeding the threshold
- **Process all embedded images** — extract all embedded rasters regardless of size

### Debug Mode
Click the debug icon (🐛) to enable detailed logging in the UI and browser console.

## Import Report

After import, the plugin shows:

```
✓ Import complete

testfile.svg
  AI_Image
  ├─ Original bitmap:        5387 × 3010 px
  ├─ Standard SVG import:    ≈2694 × 1505 px
  ├─ Figma internal size:    4096 × 2289 px  ← from getSizeAsync()
  ├─ Placed size:            1291.2 × 721.2 Figma units
  └─ Status:                 ✓ Restored
```

> If `figma.createImage()` does not expose internal size, the report shows "Not exposed by Figma API".

## Testing

### Unit Tests (pure utilities — no Figma needed)
```bash
npm test
```

Covers:
- PNG IHDR dimension parsing (all 6 size variants from requirements)
- JPEG SOF dimension parsing
- Affine matrix math (multiply, apply, rotate, skew, etc.)
- SVG transform string parsing (all 6 types + compounds)
- Geometry restoration (viewBox scaling, transform chains, visual size)

### Generate Test SVG Fixtures
```bash
npx tsx tests/fixtures/createTestSVGs.ts
```

This creates SVG files in `tests/fixtures/` for manual testing:
- `test1_png_4095.svg` through `test6_png_8193.svg` — boundary cases
- `test4_png_5387x3010.svg` — the key requirements test case
- `test7_multiple_rasters.svg` — 3 images of different sizes
- `test8_transformed_group.svg` — raster inside transformed `<g>`
- `test11_stacking_order.svg` — Background → Vector A → Raster → Vector B → Text

> Note: The PNG data in generated fixtures is structurally valid for IHDR parsing but not real images. Use your own SVG with real embedded PNGs for visual verification.

## Key Implementation Notes

### Why `figma.createImage()` should give better results
`figma.createImage(bytes)` uses Figma's standard image asset pipeline (same as importing PNG directly), which applies proportional resize to max 4096 px. The SVG importer uses a different (inferior) path that applies power-of-two halving.

### Geometry restoration
The plugin computes:
```
M_figma = viewBoxMapping × parentGroupTransforms × elementTransform × translate(x, y)
```
This matrix is applied as `node.relativeTransform`, while `node.resize(svgImageWidth, svgImageHeight)` sets the intrinsic size. The visual result exactly matches the original SVG layout.

### If the hypothesis fails (Canvas API fallback)
If `figma.createImage()` also uses power-of-two downsampling, the plugin would fall back to pre-scaling the image using the browser Canvas API (Lanczos-quality resize to ≤4096 px) before passing to Figma. This gives better quality than Figma's automatic power-of-two halving.

## Known Limitations

- **clip-path / mask**: If a raster has `clip-path` or `mask`, a warning is shown in the report. Figma does not have a direct API to apply SVG-style masks to raster nodes; clipping is not fully restored.
- **Nested SVG** (`<svg>` inside `<svg>`): Not supported; treated as unknown element.
- **External linked images** (`href="https://..."`): Skipped for security.
- **WebP**: Architecture supports it (MimeType includes `image/webp`) but dimension parsing is not yet implemented (PNG/JPEG only).
- **Percentage dimensions** (e.g., `width="50%"`): Resolved using viewBox fallback.

## Transform Math

All transforms follow SVG specification:
- `transform="translate(tx, ty) scale(sx)"` → matrix = T(tx,ty) × S(sx)
- Compound transforms are multiplied left-to-right
- Parent group transforms are accumulated outer → inner
- viewBox creates an additional scaling matrix applied last

## License

MIT
