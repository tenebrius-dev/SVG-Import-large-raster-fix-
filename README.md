# SVG Smart Import (for Figma)

A Figma plugin that solves the notorious 4096×4096 pixel limit for raster images embedded inside SVGs. It intelligently extracts large base64 images, imports the vector shapes natively, and then accurately slices and reconstructs the oversized bitmaps without any loss of quality.

## ⚠️ The Problem

Figma has a strict internal restriction: **any imported raster image cannot exceed 4096×4096 pixels**. 
When you drag and drop an SVG containing a large embedded base64 image (e.g., from Illustrator or Photoshop) into Figma, it automatically downscales the image to fit within the 4096px limit. This completely destroys the quality of high-resolution textures, renders, or photo assets embedded inside your SVGs.

## ✨ Features

- **Bypasses Figma's 4096px Limit**: Automatically detects oversized base64 raster images embedded in SVGs.
- **Smart Slicing Algorithm**: Slices large images into seamless tiles (e.g., 4096×4096 blocks) and perfectly reconstructs them on the canvas.
- **Hybrid Import**: Preserves all native vector paths, groups, and SVGs elements while only hijacking and fixing the problematic large rasters.
- **Multiple Files & Paste Support**: Drag and drop multiple SVGs at once, or use `Cmd+V` / `Ctrl+V` to paste SVGs directly from your clipboard.
- **Detailed Reporting**: Get a clear breakdown of what was imported natively and what was sliced.
- **Figma Native UI**: Beautiful, lightweight UI built to seamlessly blend with Figma's native design system.

## 🛠 How it Works (Under the hood)

1. **Parsing**: The plugin parses the SVG using the browser's native `DOMParser`.
2. **Extraction**: It looks for `<image>` tags containing `data:image/...` base64 payloads.
3. **Evaluation**: If an image exceeds the 4096px threshold (on either axis), it extracts the image and replaces it in the SVG with a temporary placeholder vector rectangle.
4. **Native Import**: The cleaned-up SVG (with placeholders) is converted into a string and imported into Figma using `figma.createNodeFromSvg()`.
5. **Slicing & Placement**: The plugin processes the extracted large images using a hidden `<canvas>`, slices them into smaller chunks, imports them into Figma using `figma.createImageAsync()`, and seamlessly replaces the placeholder rectangles with the reconstructed high-res tiles.

## 🚀 Installation & Usage

To run this plugin locally for development or personal use:

1. Clone this repository:
   ```bash
   git clone https://github.com/tenebrius-dev/SVG-Import-large-raster-fix-.git
   cd SVG-Import-large-raster-fix-
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```
   *(You can also use `npm run dev` to watch for changes during development)*

4. Load into Figma:
   - Open the Figma desktop app.
   - Go to **Plugins** > **Development** > **Import plugin from manifest...**
   - Select the `manifest.json` file in the root of this repository.

5. Usage:
   - Run the plugin.
   - Drag and drop your `.svg` files into the plugin window.
   - Click **Import to Figma**.

## 💻 Tech Stack

- **TypeScript**
- **ESBuild** (for blazing fast bundling)
- **Vanilla HTML/CSS** (no bulky frameworks, styled to match Figma UI)
- **Figma Plugin API**

## 📄 License

This project is open-source and available under the MIT License.
