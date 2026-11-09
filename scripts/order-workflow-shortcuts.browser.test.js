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
  socket.addEventListener('message', event => { const value = JSON.parse(event.data), task = pending.get(value.id); if (!task) return; pending.delete(value.id); clearTimeout(task.timer); value.error ? task.reject(Error(JSON.stringify(value.error))) : task.resolve(value.result); });
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => reject(Error(method + ' timed out')), 10000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); }, close() { socket.close(); for (const task of pending.values()) clearTimeout(task.timer); } };
}

test('receiving shortcuts and saved-run printing work in a real browser at desktop and mobile sizes', { timeout: 90000 }, async () => {
  const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/desktop.css" media="(min-width:901px)"><link rel="stylesheet" href="/mobile.css" media="(max-width:900px)"><link rel="stylesheet" href="/dashboard-controls.css"><link rel="stylesheet" href="/production-planner.css"><style>body{margin:0;font:14px system-ui}#fixture{padding:16px}.hidden{display:none!important}</style></head><body data-order-source="shopify" data-active-view="orders"><div id="fixture"><section id="blanks-section"><div class="section-actions"></div></section><section id="print-section"><div id="col-print"></div></section></div><script>
  window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  const allOrders=[1,2].map(id=>({_candidate:true,_provider:'shopify',_gid:'g'+id,_orderKey:'g'+id,name:'#'+id+' – Synthetic customer',status:'print',productionStage:'print',printsStatus:1,blanksStatus:1,notes:'Handle carefully',items:[{id:'line'+id,title:'Synthetic Tee',qty:id*2,sku:'SKU'+id,color:'Blue',size:id===1?'M':'L',customAttributes:[{key:'_designer_item_instructions',value:'Keep centered'}]}]}));
  window.getOrderManagerBoardSnapshot=()=>allOrders;window.getOrderManagerProductionWorkload=()=>({available:true});window.isGarmentItem=()=>true;window.OrderGarmentSummary={garmentType:()=>({id:'tee'}),models:()=>[],placementLabels:{}};window.CartGarmentModel={variant:item=>({color:item.color,size:item.size})};
  const shared=(id,received=5)=>({itemKey:id,title:'Synthetic '+id,sku:id,expectedQty:5,receivedQty:received,accountedQty:received,allocationConfirmed:false,orderLines:[{orderName:'A',expectedQty:2,accountedQty:2},{orderName:'B',expectedQty:3,accountedQty:Math.min(3,received-2)}]});
  window.fixture={calls:[],failAt:0,printCalls:0,serverBatch:{id:'batch',label:'Synthetic shipment',supplierOrderNumber:'12345',manifest:[shared('one'),shared('two'),shared('three'),shared('short',3)],orders:[],orderNames:[],totals:{expectedGarments:20,receivedGarments:18,missingGarments:2}},run:{revision:1,orders:allOrders.map(order=>({provider:'shopify',id:order._gid}))}};
  const clone=value=>JSON.parse(JSON.stringify(value));
  window.api={listBlanksBatches:async()=>({batches:[{id:'batch',supplierOrderNumber:'12345',orderNames:[],expectedGarments:20,receivedGarments:18,missingGarments:2,pendingAllocationLines:fixture.serverBatch.manifest.filter(l=>!l.allocationConfirmed).length,supplierStatus:{state:'delivered'}},{id:'clean',supplierOrderNumber:'999',expectedGarments:2,receivedGarments:2,missingGarments:0,pendingAllocationLines:0},{id:'allocation',supplierOrderNumber:'888',expectedGarments:4,receivedGarments:4,missingGarments:0,pendingAllocationLines:1}]}),getBlanksBatch:async()=>({batch:clone(fixture.serverBatch)}),confirmBlanksBatchAllocation:async(id,key,allocations)=>{fixture.calls.push({id,key,allocations});if(fixture.failAt===fixture.calls.length)throw Error('Synthetic save interruption');fixture.serverBatch.manifest.find(l=>l.itemKey===key).allocationConfirmed=true;return{batch:clone(fixture.serverBatch)};},getProductionRun:async()=>clone(fixture.run)};
  </script><script src="/receiving-review-model.js"></script><script src="/blanks-batches.js"></script><script src="/production-planner-model.js"></script><script src="/production-run-checklist.js"></script><script src="/production-planner.js"></script></body></html>`;
  const allowed = ['desktop.css', 'mobile.css', 'dashboard-controls.css', 'production-planner.css', 'receiving-review-model.js', 'blanks-batches.js', 'production-planner-model.js', 'production-run-checklist.js', 'production-planner.js'];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fixture); }
    const file = req.url.slice(1); if (!allowed.includes(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'); res.end(await fs.readFile(path.join(root, 'order-manager-web', file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'printmo-shortcuts-'));
  const browser = spawn(process.env.PRINTMO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => { let log = ''; const timer = setTimeout(() => reject(Error('Browser unavailable')), 12000); browser.once('error', reject); browser.stderr.on('data', data => { log += data; const found = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (found) { clearTimeout(timer); resolve('http://127.0.0.1:' + found[1]); } }); });
    const pages = await (await fetch(endpoint + '/json/list')).json(); cdp = await connect(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    const evaluate = async expression => { const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    const wait = expression => evaluate(`new Promise((resolve,reject)=>{let tries=0;const check=()=>(${expression})?resolve():++tries>200?reject(Error('Condition timed out: '+${JSON.stringify(expression)})):setTimeout(check,15);check();})`);
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const capture = async name => {
      if (!process.env.PRINTMO_CAPTURE_DIR) return;
      await fs.mkdir(process.env.PRINTMO_CAPTURE_DIR, { recursive: true });
      const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(process.env.PRINTMO_CAPTURE_DIR, name + '.png'), Buffer.from(result.data, 'base64'));
    };
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    await wait('window.productionPlanner && window.blanksBatchFoundation');
    await evaluate('blanksBatchFoundation.openReceiveOverlay()'); await wait('document.querySelectorAll(".blanks-receive-batch-card").length===3');
    await click('#blanks-receive-attention-only');
    assert.equal(await evaluate('document.querySelectorAll(".blanks-receive-batch-card").length'), 2);
    assert.match(await evaluate('document.getElementById("blanks-receive-list").textContent'), /Delivered · 2 still to check in/);
    await evaluate(`document.getElementById('blanks-receive-search').value='999';document.getElementById('blanks-receive-search').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await evaluate('document.querySelectorAll(".blanks-receive-batch-card").length'), 0);
    assert.equal(await evaluate('document.getElementById("blanks-receive-clear-filters").hidden'), false);
    await click('#blanks-receive-clear-filters'); await click('[data-batch-id="batch"]');
    await wait('document.getElementById("blanks-receive-confirm-full").textContent.includes("3 full")');
    await capture('receiving-desktop');
    for (const width of [393, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate('document.querySelector("[data-allocation-order]").getBoundingClientRect().height>=44'), true);
      await capture('receiving-full-' + width);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    // A manual allocation edit is left for individual review.
    await evaluate(`const edited=document.querySelector('[data-item-key="three"] [data-allocation-order]');edited.value=1;edited.dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.match(await evaluate('document.getElementById("blanks-receive-confirm-full").textContent'), /2 full/);
    await click('#blanks-receive-refresh'); await wait('document.getElementById("blanks-receive-confirm-full").textContent.includes("3 full")');
    await evaluate(`fixture.failAt=2;const shortInput=document.querySelector('[data-item-key="short"] [data-allocation-order]');shortInput.value=1;shortInput.dispatchEvent(new Event('input',{bubbles:true}));`); await click('#blanks-receive-confirm-full');
    await wait('document.getElementById("blanks-receive-allocation-feedback").textContent.includes("Refresh before retrying")');
    assert.deepEqual(await evaluate('fixture.calls.map(c=>c.key)'), ['one', 'two']);
    assert.equal(await evaluate('document.getElementById("blanks-receive-confirm-full").disabled'), true);
    assert.equal(await evaluate('document.querySelector("[data-item-key=short] [data-allocation-order]").value'), '1', 'unsaved individual allocations survive the bulk result');
    await click('#blanks-receive-refresh'); await wait('!document.getElementById("blanks-receive-confirm-full").disabled');
    // Receipt changes on another device must be caught before a bulk write.
    await evaluate('fixture.serverBatch.manifest[1].receivedQty=4'); await click('#blanks-receive-confirm-full');
    await wait('document.getElementById("blanks-receive-allocation-feedback").textContent.includes("shipment changed")');
    assert.equal(await evaluate('fixture.calls.length'), 2);
    await evaluate('fixture.serverBatch.manifest[1].receivedQty=5;fixture.failAt=0'); await click('#blanks-receive-refresh');
    await wait('!document.getElementById("blanks-receive-confirm-full").disabled'); await click('#blanks-receive-confirm-full');
    await wait('document.getElementById("blanks-receive-allocation-feedback").textContent.startsWith("2 lines confirmed")');
    assert.deepEqual(await evaluate('fixture.calls.slice(2).map(c=>c.key)'), ['two', 'three']);
    assert.equal(await evaluate('fixture.serverBatch.manifest[3].allocationConfirmed'), false);
    await click('#blanks-receive-close');
    await evaluate('productionPlanner.open("run")'); await wait('!document.querySelector(".production-planner-print").disabled');
    await evaluate(`document.querySelector('#production-planner [data-query]').value='#1';document.querySelector('#production-planner [data-query]').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await evaluate('document.querySelectorAll(".production-planner-order").length'), 1);
    await click('.production-planner-print'); await wait('document.getElementById("production-run-checklist").open && !document.querySelector("#production-run-checklist [data-print]").disabled');
    assert.match(await evaluate('document.querySelector("#production-run-checklist iframe").contentDocument.body.textContent'), /2 orders · 6 garments/);
    assert.equal(await evaluate('document.querySelector("#production-run-checklist iframe").contentDocument.querySelectorAll("tbody tr").length'), 2);
    await capture('checklist-desktop');
    await evaluate('document.querySelector("#production-run-checklist iframe").contentWindow.print=()=>fixture.printCalls++');
    await click('#production-run-checklist [data-print]'); assert.equal(await evaluate('fixture.printCalls'), 1);
    await evaluate('allOrders[0]._previewTicket="hydrated";document.dispatchEvent(new Event("printmo:board-updated"));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.querySelector("#production-run-checklist [data-print]").disabled'), false, 'unrelated asset hydration does not invalidate paper facts');
    await evaluate('allOrders[0].items[0].qty=9;document.dispatchEvent(new Event("printmo:board-updated"))');
    await wait('document.querySelector("#production-run-checklist [data-print]").disabled');
    assert.match(await evaluate('document.querySelector("#production-run-checklist [data-checklist-status]").textContent'), /changed/);
    await click('#production-run-checklist [data-back]');
    await evaluate('document.querySelector("#production-planner [data-query]").value="";document.querySelector("#production-planner [data-query]").dispatchEvent(new Event("input",{bubbles:true}))');
    for (const width of [393, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await click('.production-planner-print'); await wait('document.getElementById("production-run-checklist").open && !document.querySelector("#production-run-checklist [data-print]").disabled');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await evaluate('document.querySelector("#production-run-checklist iframe").contentDocument.documentElement.scrollWidth<=document.querySelector("#production-run-checklist iframe").clientWidth'), true);
      assert.equal(await evaluate('document.querySelector("#production-run-checklist [data-print]").getBoundingClientRect().height>=44'), true);
      await capture('checklist-' + width);
      await click('#production-run-checklist [data-back]'); await click('#production-planner [data-close]');
      await evaluate('blanksBatchFoundation.openReceiveOverlay()'); await wait('document.querySelectorAll(".blanks-receive-batch-card").length===3');
      assert.equal(await evaluate('document.querySelector(".blanks-receive-attention-toggle").getBoundingClientRect().height>=44'), true);
      assert.equal(await evaluate('document.querySelector(".blanks-receive-dialog").scrollWidth<=innerWidth'), true);
      await capture('receiving-' + width);
      await click('[data-batch-id="batch"]'); await wait('document.getElementById("blanks-receive-back").classList.contains("hidden")===false');
      assert.equal(await evaluate('document.querySelector(".blanks-receive-dialog .manual-add-body").getBoundingClientRect().height>250'), true);
      await capture('receiving-detail-' + width);
      await click('#blanks-receive-close'); await evaluate('productionPlanner.open("run")');
    }
    assert.deepEqual(await evaluate('errors'), []);
    // Exercise the actual print stylesheet and browser PDF output, separate from the app shell.
    const printHtml = await evaluate('document.querySelector("#production-run-checklist iframe").srcdoc');
    await cdp.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(printHtml) });
    await wait('document.title === "Today’s run checklist"');
    const pdf = await cdp.send('Page.printToPDF', { preferCSSPageSize: true });
    const bytes = Buffer.from(pdf.data, 'base64');
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    assert.ok(bytes.length > 1000);
    if (process.env.PRINTMO_CAPTURE_DIR) {
      await fs.writeFile(path.join(process.env.PRINTMO_CAPTURE_DIR, 'run-checklist.pdf'), bytes);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
      await capture('checklist-paper');
    }
  } finally { cdp?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
});
