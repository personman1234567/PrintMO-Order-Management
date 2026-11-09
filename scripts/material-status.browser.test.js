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

test('compact materials: saved statuses, shelf readiness, safe Undo and keyboard at desktop/phone sizes', { timeout: 60000 }, async () => {
  const html = await fs.readFile(path.join(root, 'order-manager-web/index.html'), 'utf8');
  const source = await fs.readFile(path.join(root, 'order-manager-web/detail-overlay-enhancements.js'), 'utf8');
  const component = source.slice(source.indexOf('  let materialMenu = null;'), source.indexOf('  function syncPrintPlacements('));
  const listSource = await fs.readFile(path.join(root, 'order-manager-web/order-list-foundation.js'), 'utf8');
  const listHelpers = listSource.slice(listSource.indexOf('  function text('), listSource.indexOf('  function detailOpen('));
  const listRows = listSource.slice(listSource.indexOf('  function makeRow('), listSource.indexOf('  function reconcileRows('));
  assert(component.includes('async function saveMaterialStatus'));
  const markup = html.slice(html.indexOf('<section id="detail-production-card"'), html.indexOf('</section>', html.indexOf('<section id="detail-production-card"')) + '</section>'.length);
  const order = { name: '#SYNTHETIC', _candidate: true, _provider: 'shopify', _orderKey: 'fixture-order', productionStage: 'received', blanksStatus: 0, blanksOrdered: 0, printsStatus: 0, printsOrdered: 0, printsOnSavedSheet: false, blanksPo: ['SYN-HISTORY'] };
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/desktop.css" media="(min-width:901px)"><link rel="stylesheet" href="/mobile.css" media="(max-width:900px)"><link rel="stylesheet" href="/accessibility-hardening.css"><link rel="stylesheet" href="/order-detail-split.css"><style>body{margin:0;font-family:system-ui;background:#f8fafc}#detail-overlay{opacity:1;pointer-events:auto}#detail-header{min-height:72px;padding:16px;display:flex;align-items:center;justify-content:space-between}#detail-header h2{margin:0;font-size:18px}#detail-production-card{overflow:hidden}#detail-right-pane{padding:24px}.fixture-label{font-size:12px;color:#64748b;margin:0 0 12px}.fixture-clip #detail-production-card{height:132px}#fixture-outside{padding:20px}.fixture-content{height:180px}#detail-close{min-height:44px}[hidden]{display:none!important}@media(max-width:900px){#detail-card{width:calc(100vw - 24px);height:calc(100dvh - 24px)}#detail-left-pane{flex:1;padding:12px}#detail-right-pane{display:none}#detail-main-stack{max-height:100%}}</style></head><body data-order-source="shopify"><main id="fixture-outside"><button id="outside-button">Outside detail</button></main><div id="detail-overlay" class="visible"><div id="detail-card" tabindex="-1"><header id="detail-header"><h2>Synthetic order · materials</h2><button id="detail-close" type="button">Close</button></header><div id="detail-content"><div id="detail-main-column"><div id="detail-split-canvas"><aside id="detail-left-pane"><div id="detail-main-stack"><p class="fixture-label">Synthetic fixture · no business records</p>${markup}<div class="fixture-content"></div></div></aside><section id="detail-right-pane"><p class="fixture-label">Order detail workspace fixture</p><button id="next-detail-control">Next detail control</button></section></div></div></div></div></div><script>
  let currentDetailOrder = ${JSON.stringify(order)};
  window.calls = []; window.failSave = false;
  window.api = { updateReady: async (reference, patch) => { window.calls.push({ reference, patch }); if(window.failSave) throw Error('Synthetic save unavailable'); } };
  window.closeCount=0; document.getElementById('detail-close').onclick=()=>{window.closeCount++;OrderDetailMaterialMenu.close();document.getElementById('detail-overlay').classList.add('hidden');};
  const patchLocalOrders = () => new Set(); const renderBoardFromLocalState = async () => window.renderOverview(); const syncCanonicalProductionControls = () => {};
  const model = window.OrderBoardModel, headings = ['Order / Customer','Stage','Due / Age','Quantities','Blanks','Print materials / Progress','Payment / Total','Attention'];
  const rowNodes = new Map(); let rowSequence=0, selected=[], busy=false, overviewRecord;
  const paymentKey = value => String(value || 'UNKNOWN'); const humanStatus = value => String(value || 'Unknown');
  ${listHelpers}
  ${listRows}
  window.renderOverview = () => {
    const host = document.getElementById('fixture-outside'); host.classList.add('order-list-foundation');
    let overview = document.getElementById('overview-fixture');
    if(!overview){overview=document.createElement('section');overview.id='overview-fixture';overview.innerHTML='<h2>Order overview</h2><div id="fixture-card" style="width:248px;max-width:100%"></div><div class="order-list-scroll"><table class="order-list-table"><thead><tr>'+headings.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody id="fixture-rows"></tbody></table></div>';host.append(overview);}
    const card=document.createElement('article');card.className='card pipeline-card';card.innerHTML='<div class="card-header"><span class="cust-name"></span></div><div class="card-body"><div class="counts"></div></div>';
    window.OrderCardPresentation.decorate(card,currentDetailOrder,{apparel:8,prints:8,other:0,style:'pipeline'});
    document.getElementById('fixture-card').replaceChildren(card);
    const row=model.summarize({...currentDetailOrder,items:[],canonical:{commerce:{}}},{accountingForOrder:()=>({accountedGarments:3,expectedGarments:8,missingGarments:5,lines:[{allocationPending:true}]})});
    overviewRecord ||= makeRow(row.key);renderRow(row,overviewRecord);document.getElementById('fixture-rows').append(overviewRecord.node);
  };
  ${component}
  window.materialFixture = { order: () => currentDetailOrder, sync: syncMaterialStatuses, select: saveMaterialStatus, reset: () => {currentDetailOrder = ${JSON.stringify(order)}; materialUndo=null; window.calls=[]; syncMaterialStatuses();} };
  wireMaterialStatuses(); syncMaterialStatuses(); window.renderOverview(); window.fixtureReady = true;
  </script><script src="/accessibility-hardening.js"></script></body></html>`;
  const server = http.createServer(async (req, res) => {
    if (/^\/Assets\/(ApparelCount|PrintCount)(Green)?\.svg$/.test(req.url)) { res.setHeader('Content-Type','image/svg+xml'); return res.end(await fs.readFile(path.join(root,'order-manager-web',req.url.slice(1)))); }
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(fixture.replace('<script>', '<script src="/order-board-model.js"></script><script src="/order-card-presentation.js"></script><link rel="stylesheet" href="/order-card-presentation.css"><link rel="stylesheet" href="/order-list-foundation.css"><script>')); }
    if (['/order-board-model.js','/order-card-presentation.js','/order-card-presentation.css','/order-list-foundation.css','/order-detail-split.css','/desktop.css','/mobile.css','/accessibility-hardening.css','/accessibility-hardening.js'].includes(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(await fs.readFile(path.join(root, 'order-manager-web',req.url.slice(1)))); }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'printmo-material-status-'));
  const browser = spawn(process.env.PRINTMO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => { let stderr = ''; const timer = setTimeout(() => reject(new Error('Browser unavailable: ' + stderr.slice(-500))), 12000); browser.once('error', reject); browser.stderr.on('data', data => { stderr += data; const found = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (found) { clearTimeout(timer); resolve(`http://127.0.0.1:${found[1]}`); } }); });
    const pages = await (await fetch(`${endpoint}/json/list`)).json(); cdp = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    const evaluate = async expression => { const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await new Promise(resolve => setTimeout(resolve, 100));
    await evaluate('new Promise(resolve=>{const check=()=>window.fixtureReady?resolve():setTimeout(check,20);check();})');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".material-status-value")].map(n=>n.textContent)'), ['Not recorded', 'Not recorded']);
    await evaluate('document.getElementById("material-prints-button").click();document.querySelector("[role=menuitemradio][aria-checked=true]").click()');
    assert.equal(await evaluate('calls.length'), 0, 'current choice must not write');
    await evaluate('materialFixture.select("prints","sheet")');
    assert.equal(await evaluate('document.querySelector("[data-quantity-kind=prints] .quantity-state").textContent'), 'On saved sheet');
    assert.equal(await evaluate('document.querySelector("#fixture-rows td:nth-child(6) .order-list-pill").textContent'), 'On saved sheet');
    assert.equal(await evaluate('calls[0].patch.printsOnSavedSheet'), true);
    assert.equal(await evaluate('document.getElementById("material-status-menu").hidden'), true);
    await evaluate('materialFixture.select("prints","ordered");');
    assert.equal(await evaluate('materialFixture.order().printsOnSavedSheet'), false);
    await evaluate('document.getElementById("material-status-undo").click();new Promise(resolve=>setTimeout(resolve,20))');
    assert.equal(await evaluate('materialFixture.order().printsOrdered'), 0);
    assert.equal(await evaluate('materialFixture.order().printsOnSavedSheet'), false, 'Undo ordering must not revive the retired saved-sheet mark');
    await evaluate('materialFixture.select("prints","hand")');
    assert.equal(await evaluate('materialFixture.order().printsStatus'), 1);
    assert.equal(await evaluate('materialFixture.order().printsOrdered'), 0, 'physical prints may be on hand without a purchase record');
    await evaluate('materialFixture.select("blanks","cart")');
    assert.equal(await evaluate('calls.at(-1).patch.stage'), 'blanks_cart');
    assert.equal(await evaluate('document.querySelector("[data-quantity-kind=garments] .quantity-state").textContent'), 'In S&S cart');
    assert.equal(await evaluate('document.querySelector("#fixture-rows td:nth-child(5) .order-list-pill").textContent'), 'In S&S cart');
    assert.match(await evaluate('document.getElementById("fixture-rows").textContent'), /3\/8 supplier garments received/);
    assert.match(await evaluate('document.getElementById("fixture-rows").textContent'), /Allocation needs review/);
    await evaluate('(async()=>{await materialFixture.select("blanks","none");await materialFixture.select("blanks","hand");})()');
    assert.equal(await evaluate('materialFixture.order().blanksStatus'), 1);
    assert.equal(await evaluate('materialFixture.order().blanksOrdered'), 0);
    assert.deepEqual(await evaluate('materialFixture.order().blanksPo'), ['SYN-HISTORY']);
    await evaluate('window.failSave=true;materialFixture.select("prints","ordered")');
    assert.equal(await evaluate('materialFixture.order().printsStatus'), 1, 'a failed save must preserve the displayed saved state');
    assert.match(await evaluate('document.getElementById("material-status-feedback").textContent'), /not saved/);
    await evaluate('window.failSave=false;document.getElementById("material-prints-button").click()');
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-checked")'), 'true');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate('document.activeElement.id'), 'material-prints-button');
    assert.equal(await evaluate('document.getElementById("material-status-menu").hidden'), true);
    assert.equal(await evaluate('closeCount'), 0, 'first Escape closes only the material menu');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate('closeCount'), 1, 'second Escape closes the detail modal');
    await evaluate('document.getElementById("detail-overlay").classList.remove("hidden")');
    for (const [name, width, height] of [['desktop', 1280, 900], ['phone', 393, 844]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await evaluate('materialFixture.reset();materialFixture.order().printsOnSavedSheet=true;materialFixture.order().productionStage="blanks_cart";materialFixture.sync();document.getElementById("material-prints-button").click()');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'no horizontal overflow');
      assert.equal(await evaluate('[...document.querySelectorAll(".material-status-button,[role=menuitemradio]")].every(n=>n.getBoundingClientRect().height>=44)'), true);
      assert.equal(await evaluate('document.getElementById("material-status-menu").matches(":popover-open")'), true, 'menu paints in the native top layer');
      assert.equal(await evaluate('document.getElementById("detail-card").contains(document.getElementById("material-status-menu"))'), true, 'popover DOM remains in the modal focus scope');
      assert.equal(await evaluate('[...document.querySelectorAll(".material-status-button")].every(n=>n.getBoundingClientRect().width>=180&&n.getBoundingClientRect().width<=220)'), true);
      assert.equal(await evaluate('document.querySelectorAll("#material-status-options svg").length'), 1, 'only selected option displays the official check icon');
      assert.equal(await evaluate('document.querySelectorAll(".material-status-change,.material-status-icon").length'), 0);
      if (process.env.PRINTMO_MATERIAL_SCREENSHOTS) {
        await fs.mkdir(process.env.PRINTMO_MATERIAL_SCREENSHOTS, { recursive: true });
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path.join(process.env.PRINTMO_MATERIAL_SCREENSHOTS, `material-status-${name}.png`), Buffer.from(screenshot.data, 'base64'));
      }
      await evaluate('document.getElementById("material-prints-button").click()');
      if (process.env.PRINTMO_MATERIAL_SCREENSHOTS) {
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path.join(process.env.PRINTMO_MATERIAL_SCREENSHOTS, `material-status-${name}-closed.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
    await evaluate('document.body.classList.add("fixture-clip");document.getElementById("material-prints-button").click()');
    assert.equal(await evaluate('getComputedStyle(document.getElementById("detail-card")).transform!=="none"'), true, 'fixture retains transformed modal containing block');
    assert.equal(await evaluate('(()=>{const option=document.querySelector("#material-status-options button:last-child"),r=option.getBoundingClientRect(),card=document.getElementById("detail-production-card").getBoundingClientRect();return r.bottom>card.bottom&&option.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()'), true, 'menu remains painted and hit-testable outside the clipped production card');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate('document.activeElement.id'), 'material-blanks-button', 'Tab closes menu and follows detail tab order');
    assert.equal(await evaluate('document.getElementById("material-status-menu").hidden'), true);
    await evaluate('document.body.classList.remove("fixture-clip");document.getElementById("material-prints-button").click();window.dispatchEvent(new Event("resize"))');
    assert.equal(await evaluate('document.getElementById("material-status-menu").hidden'), true, 'resize dismisses stale positioning');
    await evaluate('document.getElementById("material-prints-button").click();document.getElementById("detail-main-stack").dispatchEvent(new Event("scroll"))');
    assert.equal(await evaluate('document.getElementById("material-status-menu").hidden'), true, 'outer scroll dismisses the menu');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 310, deviceScaleFactor: 1, mobile: true });
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await evaluate('document.getElementById("material-prints-button").scrollIntoView({block:"center"});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await evaluate('document.getElementById("material-prints-button").click()');
    assert.equal(await evaluate('(()=>{const r=document.getElementById("material-status-menu").getBoundingClientRect(),v=visualViewport;return r.top>=v.offsetTop+11.5&&r.bottom<=v.offsetTop+v.height-11.5&&r.left>=v.offsetLeft+11.5&&r.right<=v.offsetLeft+v.width-11.5;})()'), true, 'constrained iframe viewport clamps menu to twelve-pixel margins');
    assert.equal(await evaluate('(()=>{const n=document.getElementById("material-status-menu");return n.scrollHeight>n.clientHeight&&getComputedStyle(n).overflowY==="auto";})()'), true, 'short viewport retains scrollable access to all choices');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
    assert.equal(await evaluate('document.activeElement.textContent'), 'In hand', 'End reaches the final option in the scroll fallback');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
    assert.equal(await evaluate('document.activeElement.textContent'), 'Not recorded');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
    assert.equal(await evaluate('document.activeElement.id'), 'detail-close', 'Shift-Tab closes menu and restores the preceding detail control');
    await evaluate('materialFixture.order()._historyReadOnly=true;materialFixture.sync()');
    assert.equal(await evaluate('document.getElementById("material-prints-button").disabled'), true);
    await evaluate('materialFixture.reset();renderOverview();document.getElementById("detail-overlay").hidden=true');
    for (const [name, width, height] of [['desktop',1280,900],['phone',393,844],['narrow',320,844]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:width<900 });
      for (const [blanks, prints, expectedBlanks, expectedPrints] of [
        ['none','none','Not recorded','Not recorded'],['cart','sheet','In S&S cart','On saved sheet'],
        ['ordered','ordered','Ordered','Ordered'],['hand','hand','In hand','In hand'],
        ['cart','sheet','In S&S cart','On saved sheet']
      ]) {
        await evaluate(`(async()=>{await materialFixture.select('blanks',${JSON.stringify(blanks)});await materialFixture.select('prints',${JSON.stringify(prints)});})()`);
        const facts = await evaluate(`({ card:[...document.querySelectorAll('#fixture-card .quantity-state')].map(n=>n.textContent),
          list:[5,6].map(i=>document.querySelector('#fixture-rows td:nth-child('+i+') .order-list-pill').textContent),
          detail:[document.getElementById('material-blanks-button'),document.getElementById('material-prints-button')].map(n=>n.querySelector('.material-status-value').textContent),
          green:[...document.querySelectorAll('#fixture-card .quantity-status-icon')].every(n=>n.src.includes('Green')===${blanks==='hand'}),
          labelsFit:[...document.querySelectorAll('#fixture-card .quantity-state')].every(n=>n.scrollWidth<=n.clientWidth+1) })`);
        assert.deepEqual(facts.card,[expectedBlanks,expectedPrints]);
        assert.deepEqual(facts.list,facts.card); assert.deepEqual(facts.detail,facts.card);
        assert.equal(facts.green,true,'only physical availability uses green icons');
        assert.equal(facts.labelsFit,true,'long material labels wrap within the existing card');
      }
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`${name} overview has no horizontal overflow`);
      if(process.env.PRINTMO_MATERIAL_SCREENSHOTS){
        const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'});
        await fs.writeFile(path.join(process.env.PRINTMO_MATERIAL_SCREENSHOTS,`material-overview-${name}.png`),Buffer.from(screenshot.data,'base64'));
      }
    }
  } finally {
    cdp?.close(); browser.kill(); await new Promise(resolve => server.close(resolve));
  }
});
