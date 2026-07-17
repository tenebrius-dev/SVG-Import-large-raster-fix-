// esbuild.config.js — Build script for SVG Smart Import Figma Plugin
// Outputs:
//   dist/code.js   — Figma plugin sandbox code
//   dist/ui.html   — Plugin UI (CSS + JS inlined)

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isProd = !isWatch;
const BASE = __dirname;

async function buildPluginCode() {
  const opts = {
    entryPoints: [path.join(BASE, 'src/plugin/code.ts')],
    bundle: true,
    outfile: path.join(BASE, 'dist/code.js'),
    platform: 'browser',
    target: ['chrome112'],
    format: 'iife',
    minify: isProd,
    sourcemap: !isProd,
    // @figma/plugin-typings are global — no external
    define: {
      'process.env.NODE_ENV': isProd ? '"production"' : '"development"',
    },
  };

  if (isWatch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log('[plugin/code] Watching...');
  } else {
    await esbuild.build(opts);
    console.log('[plugin/code] Built → dist/code.js');
  }
}

async function buildUI() {
  // Bundle UI TypeScript
  const uiResult = await esbuild.build({
    entryPoints: [path.join(BASE, 'src/ui/ui.ts')],
    bundle: true,
    write: false,
    platform: 'browser',
    target: ['chrome112'],
    format: 'iife',
    minify: isProd,
    define: {
      'process.env.NODE_ENV': isProd ? '"production"' : '"development"',
    },
  });

  const jsCode = Buffer.from(uiResult.outputFiles[0].contents).toString('utf8');

  // Read CSS
  const cssPath = path.join(BASE, 'src/ui/styles/main.css');
  const cssCode = fs.readFileSync(cssPath, 'utf8');

  // Read HTML template
  const htmlPath = path.join(BASE, 'src/ui/ui.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Inject CSS and JS into placeholders
  html = html.replace('/* INJECT_CSS */', cssCode);
  html = html.replace('/* INJECT_JS */', jsCode);

  fs.mkdirSync(path.join(BASE, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(BASE, 'dist/ui.html'), html, 'utf8');
  console.log('[ui] Built → dist/ui.html');
}

async function main() {
  fs.mkdirSync(path.join(BASE, 'dist'), { recursive: true });

  if (isWatch) {
    // In watch mode, build UI once and then watch plugin code
    await buildUI();
    await buildPluginCode();

    // For UI watch: use a simple file watcher
    const uiSrcFiles = [
      path.join(BASE, 'src/ui/ui.ts'),
      path.join(BASE, 'src/ui/ui.html'),
      path.join(BASE, 'src/ui/styles/main.css'),
    ];

    let uiRebuildTimeout = null;
    for (const file of uiSrcFiles) {
      fs.watch(file, () => {
        clearTimeout(uiRebuildTimeout);
        uiRebuildTimeout = setTimeout(async () => {
          try {
            await buildUI();
          } catch (e) {
            console.error('[ui] Build error:', e.message);
          }
        }, 100);
      });
    }

    // Also watch shared files
    const sharedDir = path.join(BASE, 'src/shared');
    if (fs.existsSync(sharedDir)) {
      fs.watch(sharedDir, { recursive: true }, () => {
        clearTimeout(uiRebuildTimeout);
        uiRebuildTimeout = setTimeout(async () => {
          try {
            await buildUI();
          } catch (e) {
            console.error('[ui/shared] Build error:', e.message);
          }
        }, 100);
      });
    }

    console.log('Watching for changes... (Ctrl+C to stop)');
  } else {
    await Promise.all([buildPluginCode(), buildUI()]);
    console.log('\nBuild complete! Load the plugin from the dist/ directory.');
  }
}

main().catch((e) => {
  console.error('Build failed:', e);
  process.exit(1);
});
