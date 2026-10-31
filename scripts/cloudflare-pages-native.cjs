#!/usr/bin/env node
// Native Windows implementation behind the registered Pages build/deploy commands.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const within = (parent, target) => { const relative = path.relative(parent, target); return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };
function usage() {
  return `Native Cloudflare Pages packaging and publishing (Windows)
Usage:
  npm run repo -- build cloudflare
  npm run repo -- deploy cloudflare -- --production
  npm run repo -- deploy cloudflare -- --preview [branch]
  node scripts/cloudflare-pages-native.cjs --help

No arguments show help. Build writes a new dist artifact without publishing.
Deployment requires an explicit mode and installed/authenticated Wrangler; it never installs tools.
Production targets main and verifies its served release marker. Preview cannot target main.
Requires SHOPIFY_API_KEY from the environment or ignored .env and canonical Designer build dependencies.
Exit codes: 0 help/build/verified release, 2 invalid arguments, 1 build/deploy/verification failure.
`;
}
function invalid(message) { throw Object.assign(new Error(message), { exitCode: 2 }); }
function parseArgs(args) {
  if (!args.length || args.some(value => ['--help', '-h'].includes(value))) return { help: true };
  if (args[0] === 'build' && args.length === 1) return { action: 'build' };
  if (args[0] !== 'deploy' || !['--production', '--preview'].includes(args[1])) invalid('Choose build, or deploy with explicit --production or --preview.');
  if (args[1] === '--production' && args.length === 2) return { action: 'deploy', mode: 'production', branch: 'main' };
  if (args[1] === '--preview' && args.length <= 3) return { action: 'deploy', mode: 'preview', branch: args[2] || '' };
  invalid('Unexpected deployment arguments. Use --help.');
}
function deploymentTarget(mode, project, branch, release) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(project)) invalid('Cloudflare Pages project name is invalid.');
  if (!/^\d{1,32}$/.test(release)) invalid('PRINTMO_RELEASE_ID must contain only digits.');
  if (mode === 'production') branch = 'main';
  else if (mode !== 'preview' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(branch) || branch.toLowerCase() === 'main')
    invalid('Choose a preview branch other than main.');
  return { mode, project, branch, release,
    url: mode === 'production' ? `https://${project}.pages.dev/?printmo_release=${release}` : null };
}
function assertArtifactPath(root, artifact) {
  const dist = path.resolve(root, 'dist'), resolved = path.resolve(artifact);
  if (!within(dist, resolved)) throw new Error('Pages artifact must be a child directory inside repository dist.');
  if (fs.existsSync(dist) && !within(fs.realpathSync(root), fs.realpathSync(dist))) throw new Error('Repository dist resolves outside the workspace.');
  if (fs.existsSync(resolved)) throw new Error('Fresh artifact path already exists; no files were removed.');
  return resolved;
}
function packagingContract(root) {
  const script = fs.readFileSync(path.join(root, 'scripts/prepare-cloudflare-pages-upload.sh'), 'utf8');
  const required = /for required in ([^;]+); do/.exec(script)?.[1]?.trim().split(/\s+/);
  const exclusions = [...script.matchAll(/--exclude '([^']+)'/g)].map(match => match[1]);
  if (!required?.length || !exclusions.length || !required.includes('mobile-order-recognition.js')) throw new Error('Pages packaging contract is incomplete.');
  return { required, exclusions };
}
function runNode(root, file, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error || result.status !== 0) throw new Error(`Pages step failed: ${path.basename(file)}`);
}
function buildArtifact({ root = ROOT, env = process.env, release = env.PRINTMO_RELEASE_ID || String(Date.now()), run = runNode } = {}) {
  if (!/^\d{1,32}$/.test(release)) invalid('PRINTMO_RELEASE_ID must contain only digits.');
  const source = path.join(root, 'order-manager-web');
  const sourceHash = sha256(path.join(source, 'renderer.js'));
  const output = assertArtifactPath(root, path.join(root, 'dist', `cloudflare-order-manager-web-${release}-${crypto.randomBytes(4).toString('hex')}`));
  const { required, exclusions } = packagingContract(root);
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  // Recheck resolved confinement after creating the parent; never delete/reuse a build.
  assertArtifactPath(root, output);
  fs.mkdirSync(output);
  const excluded = relative => exclusions.some(pattern => pattern.includes('/') ? relative === pattern : relative.split('/').includes(pattern));
  fs.cpSync(source, output, { recursive: true, filter: entry => {
    const relative = path.relative(source, entry).replace(/\\/g, '/');
    if (excluded(relative)) return false;
    if (fs.lstatSync(entry).isSymbolicLink()) throw new Error('Pages source must not include symbolic links.');
    return true;
  } });
  fs.copyFileSync(path.join(root, 'renderer.js'), path.join(output, 'renderer.js'));
  const config = require('dotenv').config({ path: path.join(root, '.env'), quiet: true, processEnv: env });
  const apiKey = env.SHOPIFY_API_KEY || config.parsed?.SHOPIFY_API_KEY;
  if (!apiKey) throw new Error('SHOPIFY_API_KEY is required to prepare the embedded web app.');
  const index = path.join(output, 'index.html'), html = fs.readFileSync(index, 'utf8');
  if (!html.includes('__SHOPIFY_API_KEY__')) throw new Error('Shopify API key placeholder missing.');
  fs.writeFileSync(index, html.replace('__SHOPIFY_API_KEY__', apiKey));
  const buildEnv = { ...env, PRINTMO_RELEASE_ID: release };
  for (const file of ['index.html', 'customer-order.html']) run(root, path.join(root, 'scripts/cache-bust-html.js'), [path.join(output, file)], buildEnv);
  run(root, path.join(root, 'scripts/build-placement-editor.js'), ['--output', path.join(output, 'placement-editor')], buildEnv);
  if (sha256(path.join(source, 'renderer.js')) !== sourceHash) throw new Error('Packaging changed tracked web renderer source.');
  if (sha256(path.join(output, 'renderer.js')) !== sha256(path.join(root, 'renderer.js'))) throw new Error('Packaged renderer does not match root source.');
  for (const file of required) if (!fs.existsSync(path.join(output, file)) || !fs.statSync(path.join(output, file)).isFile()) throw new Error(`Missing required deploy file: ${file}`);
  const marker = `<meta name="printmo-release" content="${release}">`;
  for (const file of ['index.html', 'customer-order.html']) if (!fs.readFileSync(path.join(output, file), 'utf8').includes(marker)) throw new Error(`Missing release marker in ${file}.`);
  if (fs.readFileSync(index, 'utf8').includes('__SHOPIFY_API_KEY__')) throw new Error('API key placeholder unresolved.');
  if (!fs.existsSync(path.join(output, 'placement-editor/index.html'))) throw new Error('Placement editor is missing.');
  console.log(`Prepared Pages release ${release}: ${output}`);
  return { output, release, marker };
}
function resolveWrangler(root = ROOT, env = process.env) {
  const bases = [root, ...(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean), ...(env.APPDATA ? [path.join(env.APPDATA, 'npm')] : [])];
  for (const base of bases) {
    const cli = path.resolve(base, 'node_modules/wrangler/bin/wrangler.js');
    if (fs.existsSync(cli) && fs.statSync(cli).isFile()) return cli;
  }
  throw new Error('Installed Wrangler Node CLI was not found. No tool installation was attempted.');
}
function deploymentArgs(target, artifact) {
  return ['pages', 'deploy', artifact, '--project-name', target.project, '--branch', target.branch];
}
function previewVerificationUrl(output, target) {
  const urls = [...String(output).matchAll(/https:\/\/[A-Za-z0-9.-]+\.pages\.dev/g)].map(match => match[0]);
  const candidate = urls.filter(value => new URL(value).hostname.endsWith(`.${target.project}.pages.dev`)).at(-1);
  if (!candidate) throw new Error('Preview deployment returned no URL for the selected Pages project.');
  return `${candidate}/?printmo_release=${target.release}`;
}
async function verifyRelease(url, marker, { fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 15 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(5000), headers: { 'Cache-Control': 'no-cache' } });
      if (response.ok && (await response.text()).includes(marker)) return;
    } catch (_) { /* A failed observation is retried within the bounded verification window. */ }
    if (attempt + 1 < attempts) await pause(2000);
  }
  throw new Error('Deployment completed but its selected URL did not serve the expected release marker.');
}
async function deploy(parsed, { root = ROOT, env = process.env, spawn = spawnSync, build = buildArtifact, verify = verifyRelease } = {}) {
  let branch = parsed.branch;
  if (parsed.mode === 'preview' && !branch) {
    const result = spawn('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error('Could not resolve the preview branch. Pass an explicit branch.');
    branch = result.stdout.trim();
  }
  const target = deploymentTarget(parsed.mode, env.CLOUDFLARE_PAGES_PROJECT || 'print-mo-order-manager', branch, env.PRINTMO_RELEASE_ID || String(Date.now()));
  const cli = resolveWrangler(root, env);
  const diff = spawn('git', ['diff', '--check'], { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
  if (diff.error || diff.status !== 0) throw new Error('git diff --check failed; review whitespace errors before publishing.');
  const artifact = build({ root, env, release: target.release });
  assertArtifactDeployedPath(root, artifact.output);
  const result = spawn(process.execPath, [cli, ...deploymentArgs(target, artifact.output)], { cwd: root, env, encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw new Error('Wrangler deployment failed.');
  const url = target.url || previewVerificationUrl(`${result.stdout}\n${result.stderr}`, target);
  await verify(url, artifact.marker);
  console.log(`Verified ${target.mode} release ${target.release} at ${url}`);
  return { ...artifact, url, target };
}
function assertArtifactDeployedPath(root, output) {
  const dist = path.resolve(root, 'dist');
  if (!within(dist, path.resolve(output)) || !within(fs.realpathSync(root), fs.realpathSync(dist))
    || !within(fs.realpathSync(dist), fs.realpathSync(output))) throw new Error('Deploy artifact escaped repository dist.');
}
async function main(args) {
  const parsed = parseArgs(args);
  if (parsed.help) { console.log(usage()); return; }
  if (parsed.action === 'build') return buildArtifact();
  return deploy(parsed);
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = error.exitCode || 1; });
module.exports = { usage, parseArgs, deploymentTarget, assertArtifactPath, packagingContract, buildArtifact, resolveWrangler, deploymentArgs, previewVerificationUrl, verifyRelease, deploy };
