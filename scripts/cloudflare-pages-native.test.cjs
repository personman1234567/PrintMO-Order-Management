const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const native = require('./cloudflare-pages-native.cjs');
const { cloudflareCommand } = require('./repo-tool.js');
const root = path.resolve(__dirname, '..');

test('registered dispatch uses native Node only on Windows and retains Bash elsewhere', () => {
  const windows = cloudflareCommand('deploy', ['--production'], 'win32');
  assert.equal(windows[0], process.execPath); assert.equal(path.basename(windows[1][0]), 'cloudflare-pages-native.cjs');
  assert.deepEqual(windows[1].slice(1), ['deploy', '--production']);
  assert.deepEqual(cloudflareCommand('build', [], 'linux'), ['bash', ['scripts/prepare-cloudflare-pages-upload.sh']]);
  assert.deepEqual(cloudflareCommand('deploy', ['--preview', 'review'], 'darwin'), ['bash', ['scripts/deploy-cloudflare-pages.sh', '--preview', 'review']]);
});
test('default invocation cannot publish, production is explicit and preview cannot publish to main', () => {
  assert.deepEqual(native.parseArgs([]), { help: true });
  assert.deepEqual(native.parseArgs(['deploy', '--help']), { help: true });
  for (const args of [['deploy'], ['deploy', '--production', 'other'], ['deploy', '--preview', 'x', 'extra'], ['build', '--production']])
    assert.throws(() => native.parseArgs(args), error => error.exitCode === 2);
  assert.equal(native.deploymentTarget('production', 'test-project', 'other', '123').branch, 'main');
  for (const branch of ['', 'main', 'MAIN', '--production', 'x\nmain']) assert.throws(() => native.deploymentTarget('preview', 'test-project', branch, '123'));
  assert.throws(() => native.deploymentTarget('production', 'evil.example/path', 'main', '123'));
  assert.throws(() => native.deploymentTarget('production', 'test-project', 'main', '../escape'));
});
function fixture() {
  const parent = path.join(root, 'tmp/native-pages-tests'); fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'fixture-'));
  const web = path.join(dir, 'order-manager-web'); fs.mkdirSync(web); fs.mkdirSync(path.join(dir, 'scripts'));
  const contract = native.packagingContract(root);
  fs.copyFileSync(path.join(root, 'scripts/prepare-cloudflare-pages-upload.sh'), path.join(dir, 'scripts/prepare-cloudflare-pages-upload.sh'));
  fs.copyFileSync(path.join(root, 'scripts/cache-bust-html.js'), path.join(dir, 'scripts/cache-bust-html.js'));
  for (const file of [...contract.required, 'customer-order.html', ...contract.exclusions]) {
    fs.mkdirSync(path.dirname(path.join(web, file)), { recursive: true }); fs.writeFileSync(path.join(web, file), 'fixture');
  }
  for (const file of ['index.html', 'customer-order.html']) fs.writeFileSync(path.join(web, file), '<html><head></head><body><script src="./mobile-order-recognition.js"></script>__SHOPIFY_API_KEY__</body></html>');
  fs.writeFileSync(path.join(dir, 'renderer.js'), 'root-renderer');
  fs.writeFileSync(path.join(web, 'renderer.js'), 'source-web-renderer');
  const run = (cwd, file, args, env) => {
    if (path.basename(file) === 'build-placement-editor.js') {
      fs.mkdirSync(args[1], { recursive: true }); fs.writeFileSync(path.join(args[1], 'index.html'), 'isolated-editor');
    } else {
      const result = spawnSync(process.execPath, [file, ...args], { cwd, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
  };
  return { dir, web, run, contract };
}
test('fresh artifacts mirror the existing required/exclusion contract, preserve sources and share one release', () => {
  const f = fixture();
  for (const outside of [f.dir, path.join(f.dir, 'dist'), path.join(f.dir, '../escape'), path.join(f.dir, 'dist/../escape')])
    assert.throws(() => native.assertArtifactPath(f.dir, outside));
  const first = native.buildArtifact({ root: f.dir, env: { SHOPIFY_API_KEY: 'public-fixture-key' }, release: '123', run: f.run });
  const second = native.buildArtifact({ root: f.dir, env: { SHOPIFY_API_KEY: 'public-fixture-key' }, release: '123', run: f.run });
  assert.notEqual(first.output, second.output); assert(fs.existsSync(first.output));
  assert.throws(() => native.assertArtifactPath(f.dir, first.output));
  assert.equal(fs.readFileSync(path.join(first.output, 'renderer.js'), 'utf8'), 'root-renderer');
  assert.equal(fs.readFileSync(path.join(f.web, 'renderer.js'), 'utf8'), 'source-web-renderer');
  for (const excluded of f.contract.exclusions) assert.equal(fs.existsSync(path.join(first.output, excluded)), false);
  for (const file of f.contract.required) assert(fs.existsSync(path.join(first.output, file)));
  for (const file of ['index.html', 'customer-order.html']) {
    const html = fs.readFileSync(path.join(first.output, file), 'utf8'); assert(html.includes(first.marker)); assert(html.includes('mobile-order-recognition.js?v=123'));
  }
  const index = fs.readFileSync(path.join(first.output, 'index.html'), 'utf8'); assert(index.includes('public-fixture-key')); assert(!index.includes('__SHOPIFY_API_KEY__'));
});
test('deployment constructs shell-free installed-Wrangler arguments and verifies the production hostname', async () => {
  const f = fixture(), cli = path.join(f.dir, 'node_modules/wrangler/bin/wrangler.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true }); fs.writeFileSync(cli, 'fixture-never-executed');
  const output = path.join(f.dir, 'dist/fresh'); fs.mkdirSync(output, { recursive: true });
  const calls = []; let verified;
  const result = await native.deploy(native.parseArgs(['deploy', '--production']), { root: f.dir,
    env: { PRINTMO_RELEASE_ID: '456', CLOUDFLARE_PAGES_PROJECT: 'test-project' },
    spawn(command, args, options) { calls.push({ command, args, options }); return { status: 0, stdout: '', stderr: '' }; },
    build() { return { output, release: '456', marker: 'expected-marker' }; },
    async verify(url, marker) { verified = { url, marker }; }
  });
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].args, ['diff', '--check']);
  assert.equal(calls[1].command, process.execPath); assert.equal(calls[1].args[0], cli);
  assert.deepEqual(calls[1].args.slice(1), ['pages', 'deploy', output, '--project-name', 'test-project', '--branch', 'main']);
  assert.equal(calls[1].options.shell, false);
  assert.deepEqual(verified, { url: 'https://test-project.pages.dev/?printmo_release=456', marker: 'expected-marker' });
  assert.equal(result.target.mode, 'production');
});
test('preview readback only accepts a URL for the selected project', () => {
  const target = native.deploymentTarget('preview', 'test-project', 'review', '789');
  assert.equal(native.previewVerificationUrl('https://hash.other-project.pages.dev https://abcd.test-project.pages.dev', target), 'https://abcd.test-project.pages.dev/?printmo_release=789');
  assert.throws(() => native.previewVerificationUrl('https://test-project.pages.dev https://other.pages.dev', target));
});
test('release verification retries are bounded, with pauses no longer than two seconds', async () => {
  const pauses = []; let requests = 0;
  await native.verifyRelease('https://fixture.invalid', 'marker', { attempts: 3,
    fetcher: async () => ({ ok: true, text: async () => ++requests === 2 ? 'marker' : 'old' }), pause: async ms => pauses.push(ms) });
  assert.equal(requests, 2); assert.deepEqual(pauses, [2000]);
  requests = 0; pauses.length = 0;
  await assert.rejects(native.verifyRelease('https://fixture.invalid', 'marker', { attempts: 3,
    fetcher: async () => { ++requests; throw Error('offline'); }, pause: async ms => pauses.push(ms) }), /did not serve/);
  assert.equal(requests, 3); assert.deepEqual(pauses, [2000, 2000]);
});
