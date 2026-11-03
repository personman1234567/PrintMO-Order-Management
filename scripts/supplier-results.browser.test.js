const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const assets = ['supplier-result-model.js', 'supplier-results.js', 'accessibility-hardening.css', 'accessibility-hardening.js'];
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => { const result = JSON.parse(event.data), task = pending.get(result.id); if (!task) return; pending.delete(result.id); clearTimeout(task.timer); result.error ? task.reject(new Error(JSON.stringify(result.error))) : task.resolve(result.result); });
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); }, close() { socket.close(); } };
}

test('browser: order references and item matching stay truthful; local correction reuses reviewed moves', { timeout: 60000 }, async t => {
  const html = await fs.readFile(path.join(root, 'order-manager-web/index.html'), 'utf8');
  const overlay = html.slice(html.indexOf('<div id="ss-submission-overlay"'), html.indexOf('<div id="bundle-name-overlay"'));
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/accessibility-hardening.css"><style>*{box-sizing:border-box}body{margin:16px;font:14px/1.4 system-ui;color:#0f172a}.hidden{display:none!important}button{font:inherit}.fixture-card{padding:16px;border:1px solid #cbd5e1;max-width:200px}.fixture-card p{margin:4px 0}</style></head><body data-order-source="shopify"><button id="ss-build-review">Select orders for a board move</button><button id="ss-last-result" class="hidden">Last result</button><p id="ss-build-attention" hidden></p><p id="ss-submit-status"></p><button data-order-layout="list" id="fixture-list">List</button><button data-list-stage="to_order" id="fixture-build-filter">Build Order</button><select id="order-list-action"><option value=""></option><option value="move:blanks_cart">Move to In S&amp;S Cart</option></select><div id="picked-cards"><article class="fixture-card card" data-order-key="fixture-a" data-provider="shopify"><strong>#1845 · fixture</strong><p>2 garments</p></article></div>${overlay}
  <script src="/supplier-result-model.js"></script><script src="/supplier-results.js"></script><script>
  window.orders=['a','b','unrelated'].map(id=>({_candidate:true,_provider:'shopify',_orderKey:'fixture-'+id,name:'#'+id,status:'toOrder',canonical:{supplierAttention:{batchId:'old-hold',outcome:'confirmed',submissionBlocked:true}}}));
  window.getOrderManagerBoardSnapshot=()=>orders;window.reviewCalls=[];window.supplierCalls=0;window.layoutCalls=0;window.filterCalls=0;
  window.api={getSupplierCartReview:()=>{supplierCalls++;throw new Error('Retired API called');},reconcileSupplierCart:()=>{supplierCalls++;throw new Error('Retired API called');},processBatch:()=>{supplierCalls++;throw new Error('Supplier call forbidden in fixture');}};
  window.OrderManagerViews={reviewOrders:async(keys,value)=>{reviewCalls.push({keys,value});return{results:keys.map((key,index)=>({key,outcome:index?'failed':'saved',message:index?'Order changed. Review again.':'Stage updated.'}))};}};
  document.getElementById('fixture-list').onclick=()=>{layoutCalls++;};document.getElementById('fixture-build-filter').onclick=()=>{filterCalls++;};
  window.report={batchId:'labelled-saved-response-fixture',outcome:'unknown',operation:'cart',acceptanceEvidence:'unconfirmed',supplierOrderNumbers:['77535278'],recordedAt:'2026-11-02T00:00:00Z',
    orderResults:[{orderId:'fixture-a',orderName:'#1845'}],acceptedLines:[{sku:'3362607',acceptedQty:2}],rejectedLines:[],
    lineResults:[{sku:'B10259214',itemNames:['Tultex Fine Jersey 202 / Military Green / Medium'],orderNames:['#1845'],requestedQty:2,reportedAcceptedQty:null,status:'unconfirmed'}],
    issues:[{code:'SUPPLIER_QUANTITY_MISMATCH',reason:'Item identifiers need review.'}],totals:{requestedUnits:2,reportedAcceptedUnits:0}};
  window.originalReport=JSON.stringify(report);SupplierResults.init();
  document.getElementById('ss-submission-done').onclick=()=>document.getElementById('ss-submission-overlay').classList.add('hidden');
  document.getElementById('ss-submission-close').onclick=document.getElementById('ss-submission-done').onclick;
  window.fixtureReady=true;
  </script><script src="/accessibility-hardening.js"></script></body></html>`;
  const server = http.createServer(async (req, res) => {
    try { if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(fixture); } const file = req.url.slice(1); if (!assets.includes(file)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(root, 'order-manager-web', file))); }
    catch (error) { res.statusCode = 500; res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, profile = await fs.mkdtemp(path.join(os.tmpdir(), 'printmo-supplier-order-ui-'));
  const browser = spawn(process.env.PRINTMO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, origin], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => { let stderr = ''; const timer = setTimeout(() => reject(new Error('Browser unavailable: ' + stderr.slice(-1000))), 12000); browser.once('error', reject); browser.stderr.on('data', data => { stderr += data; const found = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (found) { clearTimeout(timer); resolve(`http://127.0.0.1:${found[1]}`); } }); });
    const pages = await (await fetch(`${endpoint}/json/list`)).json(); cdp = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    const evaluate = async expression => { const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    const capture = async name => { if (!process.env.PRINTMO_SUPPLIER_SCREENSHOTS) return; await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await fs.mkdir(process.env.PRINTMO_SUPPLIER_SCREENSHOTS, { recursive: true }); const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(process.env.PRINTMO_SUPPLIER_SCREENSHOTS, name + '.png'), Buffer.from(screenshot.data, 'base64')); };
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: origin });
    await evaluate(`new Promise((resolve,reject)=>{let count=0;const check=()=>window.fixtureReady?resolve(true):++count>300?reject(new Error('Fixture not ready')):setTimeout(check,20);check();})`);
    assert.equal(await evaluate('SupplierResults.submissionBlocked(orders[0])'), false, 'historical lifetime hold marker cannot block the UI');
    await evaluate('SupplierResults.show(report)');
    assert.equal(await evaluate('document.getElementById("ss-submission-title").textContent'), 'S&S returned order 77535278');
    assert.equal(await evaluate('document.getElementById("ss-submission-summary").textContent'), 'S&S reported 2 units. Item matching needs review.');
    assert.match(await evaluate('document.getElementById("ss-submission-lines-body").textContent'), /B10259214/);
    assert.match(await evaluate('document.getElementById("ss-submission-lines-body").textContent'), /3362607/);
    assert.doesNotMatch(await evaluate('document.getElementById("ss-submission-overlay").textContent'), /not a placed purchase|unexpected purchase|No placed purchase/);
    assert.equal(await evaluate('document.querySelectorAll("#ss-cart-review, #ss-cart-attest, .ss-order-attention").length'), 0, 'no custom cart ledger/attestation/floating card block remains');
    assert.equal(await evaluate('document.getElementById("ss-submission-order-number").textContent'), '77535278');
    await capture('supplier-order-result-desktop');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'phone shell has no horizontal overflow');
    await capture('supplier-order-result-phone');
    await evaluate('report.orderResults.push({orderId:"fixture-b",orderName:"#b"});SupplierResults.show(report);document.getElementById("ss-submission-review").click()');
    await evaluate('new Promise(resolve=>setTimeout(resolve,30))');
    assert.deepEqual(await evaluate('reviewCalls[0]'), {keys:['["shopify","fixture-a"]','["shopify","fixture-b"]'],value:'move:blanks_cart'});
    assert.match(await evaluate('document.getElementById("ss-submit-status").textContent'), /1 of 2 board orders moved.*No S&S request was sent/);
    assert.equal(await evaluate('supplierCalls'), 0, 'stage correction and result display call no supplier or retired cart API');
    await evaluate('document.getElementById("ss-build-review").click()');
    assert.equal(await evaluate('layoutCalls'), 1);assert.equal(await evaluate('filterCalls'), 1);
    assert.equal(await evaluate('document.getElementById("order-list-action").value'), 'move:blanks_cart');
    assert.equal(await evaluate('reviewCalls.length'), 1, 'Build entry starts selection, never defaults all Build orders into a move');
    await evaluate(`SupplierResults.show({outcome:'unknown',submissionAction:'blocked',supplierRequestSent:false,batchId:'current-27',orderCount:7,totals:{requestedUnits:27},lineResults:[],
      actionMessage:'An earlier request has an unconfirmed outcome. No new request was sent.',previousResults:[{...report,batchId:'old-two-unit-fixture'}]});`);
    assert.equal(await evaluate('document.getElementById("ss-submission-title").textContent'), 'Submission blocked — nothing new sent');
    assert.match(await evaluate('document.getElementById("ss-submission-summary").textContent'), /Current selection: 27 garments across 7 orders/);
    assert.equal(await evaluate('document.getElementById("ss-submission-lines-body").textContent'), '');
    assert.equal(await evaluate('document.getElementById("ss-action-review").open'), false, 'older two-unit evidence stays collapsed');
    assert.equal(await evaluate('document.getElementById("ss-submission-review").hidden'), true, 'blocked action does not introduce a board-move workaround');
    assert.doesNotMatch(await evaluate('document.getElementById("ss-action-review").textContent'), /allow this selection|Authorize/);
    await capture('supplier-blocked-result-phone');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await capture('supplier-blocked-result-desktop');
    await evaluate('document.querySelector("#ss-action-review summary").click();document.querySelector("#ss-action-review button").click()');
    assert.match(await evaluate('document.getElementById("ss-submission-title").textContent'), /Saved result.*77535278/);
    await evaluate('document.getElementById("ss-review-back").click()');
    assert.match(await evaluate('document.getElementById("ss-submission-summary").textContent'), /Current selection: 27/);
    assert.equal(await evaluate('supplierCalls'), 0, 'opening previous evidence never sends a supplier request');
    await evaluate(`SupplierResults.show({outcome:'rejected',failureKind:'rate_limited',orderSubmissionAttempted:true,upstreamHttpStatus:503,
      batchId:'SYNTHETIC-THROTTLE',orderResults:[{orderId:'fixture-a'}],supplierMessage:'You are being throttled. Please wait 1 minute before your next request.',retryAt:new Date(Date.now()+60000).toISOString(),
      lineResults:[{sku:'SYNTHETIC',requestedQty:26,status:'not_accepted',issues:[]}]});`);
    assert.equal(await evaluate('document.getElementById("ss-submission-title").textContent'),'S&S asked you to wait');
    assert.match(await evaluate('document.getElementById("ss-submission-summary").textContent'),/being throttled/);
    assert.match(await evaluate('document.getElementById("ss-submission-next-step").textContent'),/Retry after.*Nothing will be retried automatically/);
    assert.equal(await evaluate('document.getElementById("ss-submission-exceptions").hidden'),true);
    assert.equal(await evaluate('document.getElementById("ss-submission-no-lines").hidden'),true);
    assert.equal(await evaluate('document.getElementById("ss-submission-review").hidden'),true);
    assert.equal(await evaluate('supplierCalls'),0);
    await capture('supplier-throttle-desktop');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:393,height:844,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await capture('supplier-throttle-phone');
    await evaluate('SupplierResults.show({outcome:"unknown",lineResults:[]})');
    assert.equal(await evaluate('document.getElementById("ss-submission-title").textContent'), 'S&S order result not confirmed');
    assert.match(await evaluate('document.getElementById("ss-submission-warning").textContent'), /Order History/);
    assert.equal(await evaluate('document.getElementById("ss-submission-next-step").hidden'), true);
    await evaluate('document.getElementById("ss-submission-done").click()');
    assert.equal(await evaluate('document.getElementById("ss-submission-overlay").classList.contains("hidden")'), true);
    t.diagnostic('Labelled saved-response and synthetic board fixtures only; no live order, cart, customer or supplier mutation.');
  } finally { cdp?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
});
