const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { PDFDocument, PDFDict, PDFName } = require('pdf-lib');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'order-manager-web');
const moduleUrl = pathToFileURL(path.join(web, 'storefront-reports-pdf.mjs')).href + '?v=renderer-test';

test('PDF adapter forwards release identity and terminates on success, error and abort', async () => {
  const original = global.Worker, workers = [];
  class FakeWorker {
    constructor(url) { this.url = String(url); workers.push(this); }
    postMessage(data) { this.data = data; }
    terminate() { this.terminated = true; }
  }
  global.Worker = FakeWorker;
  try {
    const { renderReport } = await import(moduleUrl);
    const success = renderReport({ id: 'test' });
    assert.match(workers[0].url, /storefront-reports-pdf-worker\.js\?v=renderer-test$/);
    workers[0].onmessage({ data: { bytes: new Uint8Array([37, 80, 68, 70, 45]) } });
    assert.equal((await success).length, 5); assert(workers[0].terminated);
    const failed = renderReport({}); workers[1].onmessage({ data: { error: 'Incomplete snapshot' } });
    await assert.rejects(failed, /Incomplete snapshot/); assert(workers[1].terminated);
    const control = new AbortController(), pending = renderReport({}, { signal: control.signal });
    control.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert(workers[2].terminated);
    const already = new AbortController(); already.abort();
    await assert.rejects(renderReport({}, { signal: already.signal }), { name: 'AbortError' });
    assert.equal(workers.length, 3, 'pre-aborted work does not create a worker');
  } finally { global.Worker = original; }
});

function fixture(count = 4, missingLogo = false) {
  const orders = Array.from({ length: count }, (_, i) => ({ id: `order-${i}`, label: `#SYN-${i + 1}`, date: '2026-11-06T14:00:00Z', product: i % 2 ? 'Café cotton shirt / Forest green / Adult medium' : 'Premium embroidered fleece with a deliberately long product name and detailed size configuration / Midnight blue / Extra large', quantity: 2, salesCents: 4000, baseCents: 2200, earningsCents: 1800, status: i % 2 ? 'pending' : 'fulfilled' }));
  const fulfilled = orders.filter(r => r.status === 'fulfilled').length, pending = count - fulfilled;
  return { id: 'synthetic-pdf-test', owner: { id: 'dallas', name: 'The Dr. Dallas Show', logoUrl: missingLogo ? './report-assets/missing-logo.png' : './report-assets/dr-dallas-logo.png' }, period: { start: '2026-11-01', end: '2026-11-11', timeZone: 'America/Chicago', cutoffISO: '2026-11-11T20:30:00Z' }, generatedAt: '2026-11-11T20:30:00Z', mode: 'sample', currency: 'USD', orders, products: orders.map((r, i) => ({ name: `${r.product} / product ${i + 1}`, quantity: r.quantity, salesCents: r.salesCents, baseCents: r.baseCents, earningsCents: r.earningsCents })), totals: { salesCents: count * 4000, baseCents: count * 2200, earningsCents: count * 1800, fulfilledEarningsCents: fulfilled * 1800, pendingEarningsCents: pending * 1800, fulfilledItems: fulfilled * 2, pendingItems: pending * 2, itemCount: count * 2, orderCount: count, fulfilledOrders: fulfilled, pendingOrders: pending }, templateVersion: '1' };
}
function liveFixture(incomplete = false) {
  const snapshot = fixture(3);
  snapshot.id = 'live-report-test'; snapshot.mode = 'live'; snapshot.status = incomplete ? 'needs-review' : 'complete';
  snapshot.completeness = { complete: true, financialComplete: !incomplete };
  snapshot.orders.forEach((row, i) => { row.label = i < 2 ? '#1841' : '#1842'; row.id = i < 2 ? 'gid://shopify/Order/1841' : 'gid://shopify/Order/1842'; row.product = ['Classic tee', 'Premium tee', 'Refund adjustment'][i]; });
  Object.assign(snapshot.orders[2], { quantity: 0, salesCents: -500, baseCents: 0, earningsCents: -500 });
  snapshot.products = snapshot.orders.map(row => ({ name: row.product, quantity: row.quantity, salesCents: row.salesCents, baseCents: row.baseCents, earningsCents: row.earningsCents }));
  Object.assign(snapshot.totals, { salesCents: 7500, baseCents: 4400, earningsCents: 3100, fulfilledEarningsCents: 1300, pendingEarningsCents: 1800, fulfilledItems: 2, pendingItems: 2, itemCount: 4, orderCount: 2, fulfilledOrders: 2, pendingOrders: 1 });
  snapshot.fulfillmentRateBasisNote = "INTERNAL_PRICING_HISTORY_DO_NOT_EXPORT New orders use saved fulfillment prices; earlier orders retain previous deductions; November 5 pilot exceptions.";
  snapshot.fulfillmentRateBasis = "current-catalog-price";
  snapshot.exceptions = [];
  if (incomplete) {
    snapshot.orders[1].baseCents = null; snapshot.orders[1].earningsCents = null;
    snapshot.products[1].baseCents = null; snapshot.products[1].earningsCents = null;
    for (const key of ['baseCents', 'earningsCents', 'fulfilledEarningsCents', 'pendingEarningsCents']) snapshot.totals[key] = null;
    snapshot.totals.knownEarningsCents = 1300;
    snapshot.exceptions = [{ code: 'MISSING_FULFILLMENT_PRICE', message: 'Configure an approved effective-dated fulfillment price for Premium tee and generate this report again.', product: 'Premium tee', orderLabel: '#1841', customerEmail: 'not-for-export@example.test' }];
  }
  return snapshot;
}
async function connect(url) {
  const socket = new WebSocket(url), tasks = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  socket.addEventListener('message', ({ data }) => { const result = JSON.parse(data), task = tasks.get(result.id); if (!task) return; tasks.delete(result.id); clearTimeout(task.timer); result.error ? task.reject(Error(JSON.stringify(result.error))) : task.resolve(result.result); });
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { tasks.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000); tasks.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); }, close() { socket.close(); } };
}

test('real worker embeds fonts, paginates, previews actual bytes and cleans up', { timeout: 60000 }, async t => {
  const browserPath = process.env.PRINTMO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  try { await fs.access(browserPath); } catch (_) { return t.skip('Set PRINTMO_BROWSER_PATH to an installed Chromium browser.'); }
  const output = process.env.PRINTMO_REPORT_PDF_OUTPUT || path.join(root, 'tmp', 'storefront-reports-pdf');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'profile-')), requests = [];
  const csp = (await fs.readFile(path.join(web, 'index.html'), 'utf8')).match(/http-equiv="Content-Security-Policy" content="([\s\S]*?)"/)[1];
  const server = http.createServer(async (req, res) => {
    requests.push(req.url);
    try {
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp.replace(/\s+/g, ' ')}"><style>body{margin:0;background:#edf4ff}canvas{display:block;max-width:100%;height:auto}</style><main></main>`); }
      const file = path.resolve(web, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(web + path.sep)) throw Error('Invalid local path');
      res.setHeader('Content-Type', file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => { let stderr = ''; const timer = setTimeout(() => reject(Error('Browser startup timeout')), 12000); browser.once('error', reject); browser.stderr.on('data', chunk => { stderr += chunk; const found = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (found) { clearTimeout(timer); resolve(`http://127.0.0.1:${found[1]}`); } }); });
    const pages = await (await fetch(endpoint + '/json/list')).json(); cdp = await connect(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Network.enable');
    // DNS resolution is disabled except loopback; HTTPS is additionally blocked.
    await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 900, deviceScaleFactor: 1, mobile: false });
    const evaluate = async expression => { const result = await cdp.send('Runtime.evaluate', { expression: `(async()=>{${expression}})()`, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    await cdp.send('Page.navigate', { url: origin });
    for (let i = 0; i < 100 && !await evaluate('return Boolean(document.querySelector("main"))'); i++) await new Promise(r => setTimeout(r, 20));
    await evaluate(`window.violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push(e.effectiveDirective));window.reportRenderer=await import('/storefront-reports-pdf.mjs?v=renderer-test');window.nativeWorker=Worker;window.workerRecords=[];window.Worker=class extends nativeWorker{constructor(...args){super(...args);this.record={url:String(args[0]),terminated:false};workerRecords.push(this.record)}terminate(){this.record.terminated=true;super.terminate()}};`);
    const results = [];
    const dallas = fixture(6); dallas.orders.forEach((row, i) => { row.product = ['Classic tee', 'Premium tee', 'Embroidered cap', 'Pullover hoodie'][i % 4]; });
    dallas.products = Array.from({ length: 4 }, (_, i) => { const rows = dallas.orders.filter((_, n) => n % 4 === i); return { name: rows[0].product, quantity: rows.length * 2, salesCents: rows.length * 4000, baseCents: rows.length * 2200, earningsCents: rows.length * 1800 }; });
    const unknownMoney = liveFixture(true);
    for (const row of [...unknownMoney.orders, ...unknownMoney.products]) for (const key of ['salesCents', 'baseCents', 'earningsCents']) row[key] = null;
    for (const key of ['salesCents', 'baseCents', 'earningsCents', 'fulfilledEarningsCents', 'pendingEarningsCents']) unknownMoney.totals[key] = null;
    unknownMoney.totals.knownSalesCents = 4000;
    unknownMoney.exceptions = [{ code: 'UNRESOLVED_ORDER_MONEY', message: 'Resolve payment and verified line money for this order before calculating earnings.', orderLabel: '#1841' }];
    for (const [name, snapshot] of [['dallas', dallas], ['sample', fixture()], ['long', fixture(22)], ['zero', fixture(0, true)], ['live-complete', liveFixture()], ['live-incomplete', liveFixture(true)], ['live-unknown-money', unknownMoney]]) {
      const bytes = await evaluate(`window.reportBytes=await reportRenderer.renderReport(${JSON.stringify(snapshot)});return Array.from(reportBytes)`);
      await fs.writeFile(path.join(output, name + '.pdf'), Buffer.from(bytes));
      const document = await PDFDocument.load(Uint8Array.from(bytes));
      assert(document.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFDict && value.has(PDFName.of('FontFile2'))).length >= 2, 'both Manrope font files are embedded');
      const summary = await evaluate(`window.pdfjs=window.pdfjs||await import('/report-assets/vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/report-assets/vendor/pdf.worker.mjs?v=renderer-test';window.pdfTask=pdfjs.getDocument({data:reportBytes.slice()});window.pdfDoc=await pdfTask.promise;window.allText='';for(let n=1;n<=pdfDoc.numPages;n++){const page=await pdfDoc.getPage(n);allText+=(await page.getTextContent()).items.map(x=>x.str||'').join(' ')+' '}return ({pages:pdfDoc.numPages,text:allText,bytes:reportBytes.length})`);
      assert.match(summary.text, /Storefront earnings/);
      if (snapshot.mode === 'sample') assert.match(summary.text, /FICTIONAL DESIGN SAMPLE/);
      else { assert.doesNotMatch(summary.text, /FICTIONAL|#SYN|DEMO/); assert.match(summary.text, /Orders placed/); assert.match(summary.text, /Placed-date cutoff/); assert.match(summary.text, /Fulfillment current as of/); assert.match(summary.text, /Central/); assert.match(summary.text, /#1841/); if (name !== 'live-unknown-money') assert.match(summary.text, /-\$5\.00/); }
      assert.doesNotMatch(summary.text, /INTERNAL_PRICING_HISTORY_DO_NOT_EXPORT|New orders use|earlier orders retain|November 5 pilot exceptions|unlinked items are excluded|current normal catalog prices|logo unavailable/i);
      assert(summary.bytes > 5000, 'embedded fonts increase document beyond a standard-font placeholder');
      if (name === 'long') { assert(summary.pages > 2); assert.match(summary.text, /#SYN-22/); }
      if (name === 'dallas') { assert.equal(summary.pages, 2); assert.match(summary.text, /#SYN-6/); assert.match(summary.text, /\$108\.00/); }
      if (name === 'zero') { assert.equal(summary.pages, 1); assert.match(summary.text, /No activity/); assert.doesNotMatch(summary.text, /Owner logo unavailable/); }
      if (name === 'live-complete') { assert.match(summary.text, /\$75\.00 sales - \$44\.00 approved base = \$31\.00/); assert.doesNotMatch(summary.text, /NEEDS REVIEW|Not calculated/); }
      if (name === 'live-incomplete') { assert.match(summary.text, /NEEDS REVIEW/); assert.match(summary.text, /Not calculated/); assert.match(summary.text, /MISSING_FULFILLMENT_PRICE/); assert.match(summary.text, /effective-dated fulfillment price/); assert.match(summary.text, /Calculated items only \/ earnings \(partial, not a total\): \$13\.00/); assert.doesNotMatch(summary.text, /not-for-export@example\.test/); }
      if (name === 'live-unknown-money') { assert.match(summary.text, /NEEDS REVIEW/); assert.match(summary.text, /Not calculated/); assert.match(summary.text, /UNRESOLVED_ORDER_MONEY/); assert.match(summary.text, /Verified linked sales \(partial, not a grand total\): \$40\.00/); assert.doesNotMatch(summary.text, /\$0\.00/); }
      if (name === 'sample' || name === 'dallas' || name === 'live-incomplete' || name === 'live-complete' || name === 'live-unknown-money') {
        for (let n = 1; n <= summary.pages; n++) {
          await evaluate(`window.previewPage=await pdfDoc.getPage(${n});window.viewport=previewPage.getViewport({scale:1});window.canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;document.querySelector('main').replaceChildren(canvas);await previewPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise;scrollTo(0,0);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          await fs.writeFile(path.join(output, `${name}-page-${n}.png`), Buffer.from(shot.data, 'base64'));
        }
      }
      await evaluate('await pdfDoc.destroy();await pdfTask.destroy();document.querySelector("main").replaceChildren();'); results.push({ name, ...summary });
    }
    await assert.rejects(evaluate(`await reportRenderer.renderReport(${JSON.stringify({ ...fixture(), currency: 'EUR' })})`), /USD/);
    const mismatched = fixture(); mismatched.totals.salesCents++;
    await assert.rejects(evaluate(`await reportRenderer.renderReport(${JSON.stringify(mismatched)})`), /reconcile/);
    const malformed = liveFixture(true); malformed.orders[1].earningsCents = 'unknown';
    await assert.rejects(evaluate(`await reportRenderer.renderReport(${JSON.stringify(malformed)})`), /invalid earningsCents/);
    const records = await evaluate('return workerRecords');
    assert(records.filter(w => w.url.includes('storefront-reports-pdf-worker')).every(w => w.terminated));
    assert.equal(await evaluate('return violations.length'), 0);
    assert(requests.includes('/storefront-reports-pdf-worker.js?v=renderer-test'));
    assert(requests.includes('/report-assets/vendor/fontkit.umd.min.js?v=renderer-test'));
    assert(requests.includes('/report-assets/Manrope-Regular.ttf?v=renderer-test'));
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, requests, workerRecords: records }, null, 2));
    t.diagnostic(`Actual same-origin Worker/PDFjs; fixtures only. Output: ${output}`);
  } finally { cdp?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
});
