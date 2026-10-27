#!/usr/bin/env node
// Builds a separate browser document from the canonical Designer source. Does
// not deploy or modify either application's tracked generated assets.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  const args = process.argv.slice(2);
  // Pages packaging runs under WSL on the Windows host, whereas the canonical
  // Designer dependencies are installed for Windows. Use that existing runtime
  // instead of installing a second dependency tree or invoking the wrong binary.
  if (process.platform === 'linux' && process.env.WSL_DISTRO_NAME) {
    const winPath = value => {
      const result = spawnSync('wslpath', ['-w', value], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error('Could not translate the editor build path for Windows.');
      return result.stdout.trim();
    };
    const forwarded = args.map((value, index) => args[index - 1] === '--output' ? winPath(path.resolve(value)) : value);
    const env = { ...process.env };
    if (env.PRINTMO_DESIGNER_ROOT?.startsWith('/')) env.PRINTMO_DESIGNER_ROOT = winPath(env.PRINTMO_DESIGNER_ROOT);
    const result = spawnSync('node.exe', [winPath(__filename), ...forwarded], { stdio: 'inherit', env, windowsHide: true });
    if (result.error) throw new Error('Windows Node is required to use the canonical Windows Designer dependencies from WSL. Run the build with Windows Node.');
    if (result.status !== 0) throw new Error('Windows placement-editor build failed.');
    return;
  }
  if (args.includes('--help')) {
    console.log('Build the isolated placement editor.\nUsage: node scripts/build-placement-editor.js [--check] [--output <path under dist>]\nSet PRINTMO_DESIGNER_ROOT to the canonical website designer directory. Defaults to the neighboring Print-MO Website/Shopify Website/designer checkout.\n--check builds in memory and validates the dependency boundary. No deployment is performed.'); return;
  }
  if (args.some((value, index) => !['--check', '--output'].includes(value) && args[index - 1] !== '--output')) throw new Error('Unknown option. Use --help.');
  const source = path.resolve(process.env.PRINTMO_DESIGNER_ROOT || path.join(root, '../Print-MO Website/Shopify Website/designer'));
  const entry = path.join(source, 'src/adminPlacementEditor/main.tsx');
  if (!fs.existsSync(entry)) throw new Error('Canonical placement-editor source not found. Set PRINTMO_DESIGNER_ROOT to the website designer checkout.');
  const outputIndex = args.indexOf('--output');
  if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error('--output requires a directory inside this repository’s dist directory.');
  const output = path.resolve(outputIndex >= 0 ? args[outputIndex + 1] : path.join(root, 'dist/cloudflare-order-manager-web/placement-editor'));
  const relative = path.relative(path.join(root, 'dist'), output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Placement-editor output must stay inside this repository’s dist directory.');
  const esbuild = require(path.join(source, 'node_modules/esbuild'));
  const result = await esbuild.build({ absWorkingDir: source, entryPoints: [entry], outdir: output,
    bundle: true, splitting: true, format: 'esm', jsx: 'automatic', target: 'es2020', minify: true,
    metafile: true, write: false, entryNames: 'editor-[hash]', chunkNames: 'shared-[hash]', assetNames: '[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.MODE': '"production"' }, logLevel: 'warning' });
  const forbidden = Object.keys(result.metafile.inputs).filter(file => /(?:^|\/)src\/(?:App\.tsx|main\.tsx|hooks\/useAi|components\/(?:CatalogModal|CustomerLibraryModal|AiPromo|AiGeneration))/.test(file.replace(/\\/g, '/')));
  if (forbidden.length) throw new Error(`Placement editor pulled in full Studio code: ${forbidden.join(', ')}`);
  const entryOutput = Object.entries(result.metafile.outputs).find(([, info]) => info.entryPoint && path.resolve(source, info.entryPoint) === entry);
  if (!entryOutput) throw new Error('Placement-editor entry was not emitted.');
  const script = path.basename(entryOutput[0]);
  const css = entryOutput[1].cssBundle && path.basename(entryOutput[1].cssBundle);
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; connect-src 'self' blob: https:; object-src 'none'; base-uri 'none'"><title>Artwork placement</title>${css ? `<link rel="stylesheet" href="./${css}">` : ''}</head><body><div id="placement-root"></div><script type="module" src="./${script}"></script></body></html>`;
  const js = result.outputFiles.filter(file => file.path.endsWith('.js'));
  const commerce = await esbuild.build({ stdin: { contents: `export { derivePrintPricingForDesign, printClassChoices, resolvePrintClasses } from './src/adminPlacementEditor/printClassification.ts'; export { placementInkBounds } from './src/adminPlacementEditor/placementModel.ts';`, resolveDir: source },
    bundle: true, platform: 'neutral', format: 'esm', target: 'es2022', minify: false, write: false, logLevel: 'warning' });
  if (!args.includes('--check')) {
    fs.writeFileSync(path.join(root, 'order-manager-proxy/prepared-commerce-pricing.mjs'), '// Generated from canonical Designer pricing by scripts/build-placement-editor.js.\n' + commerce.outputFiles[0].text);
    fs.mkdirSync(output, { recursive: true });
    for (const file of result.outputFiles) fs.writeFileSync(file.path, file.contents);
    fs.writeFileSync(path.join(output, 'index.html'), html);
    for (const name of ['mockups.json', 'canvas-bounds-overrides.json']) fs.copyFileSync(path.join(source, '../assets', name), path.join(output, name));
    fs.writeFileSync(path.join(output, 'build-contract.json'), JSON.stringify({ sourceEntry: 'src/adminPlacementEditor/main.tsx', script, css, isolated: true }, null, 2));
  }
  console.log(JSON.stringify({ mode: args.includes('--check') ? 'in-memory-check' : 'local-build', isolated: true, jsChunks: js.length,
    allJsGzipKiB: +(js.reduce((sum, file) => sum + zlib.gzipSync(file.contents).length, 0) / 1024).toFixed(1) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
