const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => { const result = JSON.parse(event.data), task = pending.get(result.id); if (!task) return; pending.delete(result.id); clearTimeout(task.timer); result.error ? task.reject(new Error(JSON.stringify(result.error))) : task.resolve(result.result); });
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); }, close() { socket.close(); } };
}
test('production reference recovery and reviewed saved-sheet updates work at desktop and phone widths', { timeout: 60000 }, async t => {
  const html = await fs.readFile(path.join(root, 'order-manager-web/index.html'), 'utf8');
  const panel = html.slice(html.indexOf('<section id="detail-design-panel"'), html.indexOf('<div id="production-blanks-summary"'));
  const shim = await fs.readFile(path.join(root, 'order-manager-web/web-shim.js'), 'utf8');
  const between = (start, end) => shim.slice(shim.indexOf(start), shim.indexOf(end, shim.indexOf(start)));
  const adapter = between('function applyCandidateProduction(', '// 1) Populate dashboard')
    + between('window.api.markSavedSheetPrintsOrdered =', 'window.api.updateProgress =');
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/production-artwork-workspace.css"><link rel="stylesheet" href="/saved-sheet-prints.css"><style>
  *{box-sizing:border-box}body{margin:0;padding:24px;font:14px/1.5 system-ui;background:#F8FAFC;color:#334155;--detail-surface:#FFF;--detail-border:#CBD5E1;--detail-action:#1765C1;--detail-action-hover:#1456A3;--detail-ink:#0F172A;--detail-text:#334155;--detail-muted:#475569;--detail-canvas:#F8FAFC}
  .hidden,[hidden]{display:none!important}.order-workspace-tools{margin-bottom:20px}#detail-design-panel{max-width:1100px;margin:auto;padding:20px}.design-panel-header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.manual-design-file-input{display:none}h3{margin:0}button{font:inherit}.design-group-title{border:0;color:#334155;font:inherit;width:100%;text-align:left;display:flex;justify-content:space-between}#production-manage-blanks{display:none}@media(max-width:900px){body{padding:12px}#detail-design-panel{padding:12px}}
  </style></head><body data-order-source="shopify" data-active-view="orders"><div class="order-workspace-tools"></div>${panel}<button id="production-manage-blanks"></button>
  <script>
  const makeOrder=(id,extra={})=>({_candidate:true,_provider:'shopify',_gid:id,_orderKey:id,name:'#SYNTHETIC-'+id,_version:1,productionStage:'received',printsOnSavedSheet:true,printsStatus:0,printsOrdered:0,canonical:{production:{}},...extra});
  window.artOrder=makeOrder('art',{printsOnSavedSheet:false,assets:[{assetId:'original',name:'Customer-original.png',role:'design',side:'front'},
    {assetId:'replacement',name:'Production-high-resolution.svg',role:'design',side:'front',removable:true},{assetId:'back',name:'Back-print.svg',role:'design',side:'back'}],
    artworkReferences:JSON.parse(localStorage.getItem('referenceFixture')||'{}')});
  window.orders=[artOrder,makeOrder('a'),makeOrder('b'),makeOrder('c'),makeOrder('ordered',{printsOrdered:1}),makeOrder('hand',{printsStatus:1}),makeOrder('none',{printsOnSavedSheet:false}),makeOrder('etsy',{_provider:'etsy'}),makeOrder('history',{_historyReadOnly:true})];
  window.writeCalls=[];window.downloads=[];window.failReference=false;window.failBulk=false;
  const candidateMutationChains=new Map();const candidateIdentity=order=>order._gid;const candidateStageToBoard=stage=>stage;
  const candidateByName=ref=>{const order=orders.find(o=>o._gid===(typeof ref==='string'?ref:ref.orderKey));if(!order)throw Error('Order unavailable');return order;};
  const isShopifyCandidateView=()=>document.body.dataset.orderSource==='shopify';const newIdempotencyKey=()=>crypto.randomUUID();
  window.getOrderManagerBoardSnapshot=()=>orders;window.mergeOrderManagerProduction=()=>document.dispatchEvent(new Event('printmo:board-updated'));
  window.api={getOrderArtworkUrl:async id=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240"><rect width="420" height="240" fill="#dbeafe"/><text x="30" y="130" font-size="26">'+id+'</text></svg>'),
    downloadAsset:async(url,name,id)=>downloads.push(id),deleteOrderDesignAsset:async()=>{throw Error('Deletion forbidden in fixture');},
    updateProductionMetadata:async(id,payload)=>{writeCalls.push({id,payload});const order=candidateByName(id),patch=payload.patch;
      if(patch.artwork_references){if(failReference)throw Error('Synthetic interrupted save');const refs={...order.artworkReferences};for(const [key,value]of Object.entries(patch.artwork_references)){if(value===null)delete refs[key];else refs[key]=value;}
        localStorage.setItem('referenceFixture',JSON.stringify(refs));return{production:{version:order._version+1,artworkReferences:refs}};}
      if(failBulk&&id==='b')throw Error('Synthetic interrupted status save');return{production:{version:order._version+1,printsOrdered:1,printsOnSavedSheet:false}};}};
  ${adapter}
  window.renderFixture=()=>ProductionArtworkWorkspace.render(artOrder,{front:[],back:[],extras:[]});
  window.refreshCanonicalOrderDetail=async()=>({ok:true});
  </script><script src="/production-artwork-workspace.js"></script><script src="/saved-sheet-prints.js"></script><script>renderFixture();window.fixtureReady=true;</script></body></html>`;
  const allowed = ['production-artwork-workspace.css', 'saved-sheet-prints.css', 'production-artwork-workspace.js', 'saved-sheet-prints.js'];
  const server = http.createServer(async (req, res) => {
    try { if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(fixture); }
      const file = req.url.slice(1); if (!allowed.includes(file)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(root, 'order-manager-web', file)));
    } catch (error) { res.statusCode = 500; res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'printmo-production-controls-'));
  const browser = spawn(process.env.PRINTMO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => { let stderr = ''; const timer = setTimeout(() => reject(new Error('Browser unavailable: ' + stderr.slice(-500))), 12000); browser.once('error', reject); browser.stderr.on('data', data => { stderr += data; const found = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (found) { clearTimeout(timer); resolve(`http://127.0.0.1:${found[1]}`); } }); });
    const pages = await (await fetch(`${endpoint}/json/list`)).json(); cdp = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    const evaluate = async expression => { const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    const ready = () => evaluate('new Promise((resolve,reject)=>{let n=0;const check=()=>window.fixtureReady?resolve(true):++n>200?reject(Error("Fixture not ready")):setTimeout(check,20);check();})');
    const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,40))');
    const capture = async name => { if (!process.env.PRINTMO_PRODUCTION_SCREENSHOTS) return; await fs.mkdir(process.env.PRINTMO_PRODUCTION_SCREENSHOTS, { recursive: true }); const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(process.env.PRINTMO_PRODUCTION_SCREENSHOTS, name + '.png'), Buffer.from(shot.data, 'base64')); };
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await new Promise(resolve => setTimeout(resolve, 150));
    await ready();
    await evaluate('document.querySelector(".production-use-action").click()'); await settle();
    assert.equal(await evaluate('document.querySelectorAll("#design-front-list .production-file-row").length'), 1);
    assert.equal(await evaluate('document.getElementById("production-references").open'), false);
    assert.equal(await evaluate('document.getElementById("production-selected-title").textContent'), 'Production-high-resolution.svg');
    assert.equal(await evaluate('document.activeElement.id'), 'production-selected-title');
    await cdp.send('Page.reload'); await new Promise(resolve => setTimeout(resolve, 150)); await ready();
    assert.equal(await evaluate('document.getElementById("production-references").open'), false, 'references collapse after reloading');
    assert.equal(await evaluate('document.querySelectorAll("#design-front-list .production-file-row").length'), 1, 'reference use persists after reload');
    await evaluate('document.getElementById("production-references-summary").click();document.querySelector("#production-reference-list button").click();document.querySelector("#production-file-inspector .production-primary").click()'); await settle();
    assert.deepEqual(await evaluate('downloads'), ['original'], 'retained original is still downloadable');
    assert.match(await evaluate('document.getElementById("production-file-inspector").textContent'), /Reference only/);
    await evaluate('document.getElementById("production-references-summary").click()'); await settle();
    assert.equal(await evaluate('document.getElementById("production-selected-title").textContent'), 'Production-high-resolution.svg', 'collapsing references returns the inspector to production');
    await evaluate('document.getElementById("production-references-summary").click();document.querySelector("#production-reference-list button").click();document.querySelector(".production-use-action").click()'); await settle();
    assert.equal(await evaluate('document.querySelectorAll("#design-front-list button").length'), 2);
    assert.equal(await evaluate('document.getElementById("production-references").hidden'), true);
    await evaluate('window.failReference=true;document.querySelector(".production-use-action").click()'); await settle();
    assert.equal(await evaluate('document.querySelectorAll("#design-front-list button").length'), 2);
    assert.match(await evaluate('document.getElementById("production-artwork-status").textContent'), /not confirmed/);
    await evaluate('window.failReference=false;document.querySelector(".production-use-action").click()'); await settle();
    for (const width of [1280, 393, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width < 900 }); await settle();
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'artwork contains narrow viewports');
      await capture('production-references-' + width);
      await evaluate('document.getElementById("saved-sheet-prints-open").click()');
      assert.equal(await evaluate('document.querySelectorAll(".saved-sheet-list input").length'), 3, 'mixed statuses, history and other providers are excluded');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'bulk dialog contains narrow viewports');
      assert.equal(await evaluate('[...document.querySelectorAll(".saved-sheet-actions button,.saved-sheet-row")].every(n=>n.getBoundingClientRect().height>=44)'), true);
      await capture('saved-sheet-review-' + width);
      await evaluate('document.querySelector(".saved-sheet-actions button").click()');
    }
    await evaluate('document.getElementById("saved-sheet-prints-open").click();document.querySelectorAll(".saved-sheet-list input")[2].click();window.failBulk=true;document.querySelector(".saved-sheet-save").click()'); await settle();
    assert.match(await evaluate('document.getElementById("saved-sheet-prints-status").textContent'), /1 order marked Ordered.*1 not confirmed/);
    assert.equal(await evaluate('orders.find(o=>o._gid==="a").printsOnSavedSheet'), false);
    assert.equal(await evaluate('orders.find(o=>o._gid==="b").printsOnSavedSheet'), true);
    assert.equal(await evaluate('orders.find(o=>o._gid==="c").printsOnSavedSheet'), true, 'unchecked order is untouched');
    await evaluate('window.failBulk=false;document.querySelector(".saved-sheet-save").click()'); await settle();
    assert.equal(await evaluate('orders.find(o=>o._gid==="b").printsOrdered'), 1);
    assert.equal(await evaluate('writeCalls.filter(c=>c.id==="a").length'), 1, 'retry excludes the already acknowledged success');
    await evaluate('document.querySelector(".saved-sheet-actions button").click();document.body.dataset.orderSource="redis"'); await settle();
    assert.equal(await evaluate('document.getElementById("saved-sheet-prints-open").hidden'), true);
    t.diagnostic('Synthetic persisted-use fixture and real UI/adapter code only; no live artwork, customer or supplier mutation.');
  } finally { cdp?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
});
