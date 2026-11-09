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
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => reject(Error(method + ' timed out')), 8000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); }, close() { socket.close(); for (const task of pending.values()) clearTimeout(task.timer); } };
}

test('date and instructions Actions enter the real editors, preserving hydration, drafts and mobile routes', { timeout: 60000 }, async () => {
  const [html, source, renderer] = await Promise.all(['order-manager-web/index.html', 'order-manager-web/detail-overlay-enhancements.js', 'renderer.js'].map(file => fs.readFile(path.join(root, file), 'utf8')));
  const section = (text, start, end) => {
    const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
    assert(a >= 0 && b > a, 'Missing executable fixture section: ' + start);
    return text.slice(a, b);
  };
  const components = section(source, '  function renderTargetDate(', '  function normalizedStatusClass(')
    + section(source, '  function cleanNoteValue(', '  function syncCustomerContext(')
    + section(source, '  function autoGrowNotesInput(', '  function readyStateFromInputs(')
    + section(source, '  function activateDetailTab(', '  function wireDetailTabs(')
    + section(renderer, 'function openNotesModal(', 'function openNameModal(');
  const notes = section(html, '<section id="detail-notes-wrapper"', '<details id="detail-order-actions"');
  const date = section(html, '<section id="target-date-section"', '<section class="overview-workflow"');
  const modal = section(html, '<div id="notes-overlay"', '<div id="name-overlay"');
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/order-actions.css"><style>
    *{box-sizing:border-box}body{margin:16px;color:#17212f;font:14px/1.5 system-ui}[hidden],.hidden{display:none!important}.card{position:relative;padding:20px;margin:12px 0;border:1px solid #cbd5e1}.detail-tab-panel{padding:16px}button,input,textarea{font:inherit;min-height:44px}button{padding:8px 12px}textarea{width:100%;min-height:120px}#detail-overlay{position:fixed;inset:0;z-index:1000;background:white;overflow:auto}#detail-tabs-header{padding:12px;display:flex;gap:8px;border-bottom:1px solid #cbd5e1}.detail-instructions-card,.target-date-section{max-width:650px;padding:12px;border:1px solid #cbd5e1;border-radius:8px}.detail-notes-editor{display:none}.is-editing-notes .detail-notes-editor{display:block}#notes-overlay{position:fixed;inset:0;z-index:1200;background:#17212f99;display:flex;align-items:center;justify-content:center}#notes-modal{padding:16px;background:white;border-radius:8px;width:min(600px,calc(100% - 24px))}.detail-notes-actions,.target-date-actions{display:flex;gap:8px;flex-wrap:wrap}.detail-notes-header{display:flex;gap:12px;justify-content:space-between}.detail-notes-header h4{margin:0}.detail-notes-summary,#target-date-hint{font-size:12px;color:#475569}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    </style></head><body data-order-source="shopify" data-active-view="orders"><article class="card" id="a">Synthetic Shopify order</article><article class="card" id="b">Synthetic Etsy order</article><section id="detail-overlay" hidden><nav id="detail-tabs-header"><button class="detail-tab-item active" data-tab="tab-overview">Overview</button><button class="detail-tab-item" data-tab="tab-production">Production</button></nav><div id="detail-tab-panels"><section id="tab-overview" class="detail-tab-panel active">${date}${notes}</section><section id="tab-production" class="detail-tab-panel" hidden></section></div></section>${modal}
    <script src="/order-board-model.js"></script><script src="/order-action-model.js"></script><script src="/order-detail-state.js"></script><script>
    let currentDetailOrder=null, savedNotesText='', activeNotesOrderKey='', targetDateContext=null, notesSavedFlashTimer;
    const noteDraftStore=OrderDetailState.createNoteDraftStore();
    window.orders=[{_candidate:true,_provider:'shopify',_orderKey:'shopify:a',_gid:'shopify:a',name:'#100 – Synthetic A',notes:'Original A',_capabilities:{productionWrite:true},productionStage:'received'},{_candidate:true,_provider:'etsy',_orderKey:'etsy:b',_gid:'etsy:b',name:'200 – Synthetic B',notes:'Original B',_capabilities:{productionWrite:true},productionStage:'print'}];window.allOrders=orders;window.detailOrder=null;
    window.getOrderManagerBoardSnapshot=()=>orders;window.orderIsVisibleOnOperationalBoard=()=>true;window.printablePieceTotal=()=>2;
    window.OrderManagerViews={workflowState:()=>({busy:false}),actions:()=>[{value:'move:received',label:'Pipeline',enabled:true}]};window.calls=[];window.hydrationReads=0;window.failSave=false;window.waitHydration=false;window.hydrationOk=true;window.blockOpen=false;
    window.api={updateReady:async()=>{},updateTargetDate:async(name,value,baseline)=>{calls.push({kind:'date',name,value,baseline});if(failSave)throw Error('Synthetic save unavailable');return{production:{targetDate:value,revision:2}};},updateNotes:async(name,value)=>{calls.push({kind:'notes',name,value});if(failSave)throw Error('Synthetic save unavailable');}};
    ${components}
    window.openOrderManagerDetail=order=>{if(blockOpen)return false;window.detailOrder=currentDetailOrder=order;const overlay=document.getElementById('detail-overlay');overlay.hidden=false;overlay.classList.add('visible');targetDateContext=null;renderTargetDate(order);wireCustomerNotesControls();document.getElementById('detail-edit-notes-btn').onclick=()=>openNotesModal(order);syncNotesContext(order);activateDetailTab('tab-overview');hydrationReads++;const promise=waitHydration?new Promise(resolve=>window.hydrationResolve=resolve):Promise.resolve({ok:hydrationOk});window.OrderActionsDetailReady=requested=>requested===order?promise:Promise.resolve({ok:false});return true;};
    window.closeFixtureDetail=()=>{document.getElementById('detail-overlay').classList.remove('visible');document.getElementById('detail-overlay').hidden=true;window.detailOrder=currentDetailOrder=null;};
    document.getElementById('detail-tabs-header').onclick=event=>{if(event.target.dataset.tab)activateDetailTab(event.target.dataset.tab);};
    window.fixtureWidth=mobile=>{const panel=document.getElementById(mobile?'tab-production':'tab-overview');panel.append(document.getElementById('target-date-section'),document.getElementById('detail-notes-wrapper'));};
    window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    </script><script src="/order-actions.js"></script><script>orders.forEach((order,i)=>OrderActions.attach(document.getElementById(i?'b':'a'),OrderBoardModel.orderKey(order)));window.fixtureReady=true;</script></body></html>`;
  const allowed = ['order-actions.css', 'order-actions.js', 'order-action-model.js', 'order-board-model.js', 'order-detail-state.js'];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fixture); }
    const file = req.url.slice(1); if (!allowed.includes(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css'); res.end(await fs.readFile(path.join(root, 'order-manager-web', file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'printmo-editor-shortcuts-'));
  const browser = spawn(process.env.PRINTMO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => { let log = ''; const timer = setTimeout(() => reject(Error('Browser unavailable')), 12000); browser.once('error', reject); browser.stderr.on('data', data => { log += data; const found = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (found) { clearTimeout(timer); resolve('http://127.0.0.1:' + found[1]); } }); });
    const pages = await (await fetch(endpoint + '/json/list')).json(); cdp = await connect(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    const evaluate = async expression => { const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const open = async (index = 0) => { await evaluate(`OrderActions.open(OrderBoardModel.orderKey(orders[${index}]),document.getElementById(${JSON.stringify(index ? 'b' : 'a')}))`); await flush(); };
    const item = async label => { await evaluate(`(()=>{const item=[...document.querySelectorAll('#order-action-menu [role=menuitem]')].find(node=>node.querySelector('.order-action-label')?.textContent.startsWith(${JSON.stringify(label)}));if(!item)throw Error('Missing action');item.click();})()`); await flush(); };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const capture = async name => { if (process.env.PRINTMO_EDITOR_SCREENSHOTS) { await fs.mkdir(process.env.PRINTMO_EDITOR_SCREENSHOTS, { recursive: true }); const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(process.env.PRINTMO_EDITOR_SCREENSHOTS, name + '.png'), Buffer.from(shot.data, 'base64')); } };
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    await evaluate('new Promise((resolve,reject)=>{let count=0;const check=()=>window.fixtureReady?resolve():++count>200?reject(Error("Fixture unavailable")):setTimeout(check,15);check();})');
    await open(); assert.equal(await evaluate('hydrationReads'), 0, 'opening menu does not fetch detail'); await capture('menu-desktop');
    await item('Set target date'); assert.equal(await evaluate('document.activeElement.id'), 'target-date-input');
    assert.equal(await evaluate('calls.length'), 0, 'entering the date editor does not save');
    await evaluate('document.getElementById("target-date-input").value="2026-11-15";document.getElementById("target-date-form").requestSubmit()'); await flush();
    assert.deepEqual(await evaluate('calls.at(-1)'), { kind: 'date', name: '#100 – Synthetic A', value: '2026-11-15', baseline: null });
    await evaluate('closeFixtureDetail()'); await open(); await item('Edit target date');
    assert.equal(await evaluate('document.getElementById("target-date-input").value'), '2026-11-15');
    await click('#target-date-cancel'); assert.equal(await evaluate('orders[0].targetDate'), '2026-11-15');
    await evaluate('closeFixtureDetail()'); await open(); await item('Edit target date');
    await evaluate('failSave=true;document.getElementById("target-date-input").value="2026-11-16";document.getElementById("target-date-form").requestSubmit()'); await flush();
    assert.equal(await evaluate('document.getElementById("target-date-input").value'), '2026-11-16', 'failed date save retains input');
    assert.match(await evaluate('document.getElementById("target-date-status").textContent'), /Synthetic save unavailable/);
    await evaluate('failSave=false'); await click('#target-date-clear'); await flush();
    assert.deepEqual(await evaluate('calls.at(-1)'), { kind: 'date', name: '#100 – Synthetic A', value: null, baseline: '2026-11-15' });
    await evaluate('closeFixtureDetail()'); await open(); await item('Edit shop instructions');
    assert.equal(await evaluate('document.activeElement.id'), 'detail-notes-input');
    await evaluate('document.getElementById("detail-notes-input").value="Draft for A";document.getElementById("detail-notes-input").dispatchEvent(new Event("input",{bubbles:true}))');
    await evaluate('openOrderManagerDetail(orders[1])'); await open(); await item('Edit shop instructions');
    assert.equal(await evaluate('document.getElementById("detail-notes-input").value'), 'Draft for A', 'per-order draft survives other detail opens');
    await evaluate('failSave=true'); await click('#detail-notes-save-btn'); await flush();
    assert.match(await evaluate('document.getElementById("detail-notes-edit-status").textContent'), /Could not save/);
    assert.equal(await evaluate('document.getElementById("detail-notes-input").value'), 'Draft for A');
    await evaluate('failSave=false'); await click('#detail-notes-save-btn'); await flush();
    assert.equal(await evaluate('orders[0].notes'), 'Draft for A');
    assert.equal(await evaluate('orders[1].notes'), 'Original B');
    await evaluate('closeFixtureDetail();waitHydration=true'); await open(); await item('Set target date');
    await evaluate('openOrderManagerDetail(orders[1]);hydrationResolve({ok:true})'); await flush();
    assert.equal(await evaluate('document.getElementById("target-date-form").hidden'), true, 'late hydration cannot edit another order');
    await evaluate('closeFixtureDetail()'); await open(); await item('Edit shop instructions');
    await evaluate('closeFixtureDetail();hydrationResolve({ok:true})'); await flush();
    assert.equal(await evaluate('document.getElementById("notes-overlay").classList.contains("hidden")'), true, 'closing during hydration cannot reopen an editor');
    await evaluate('closeFixtureDetail()'); await open(); await item('Edit shop instructions');
    await evaluate('document.body.dataset.orderSource="legacy";hydrationResolve({ok:true})'); await flush();
    assert.equal(await evaluate('document.getElementById("detail-notes-wrapper").classList.contains("is-editing-notes")'), false);
    await evaluate('document.body.dataset.orderSource="shopify";waitHydration=false;hydrationOk=false;closeFixtureDetail()'); await open(); await item('Set target date');
    assert.equal(await evaluate('document.getElementById("target-date-form").hidden'), true);
    assert.match(await evaluate('document.querySelector(".order-action-status").textContent'), /could not load/);
    const reads = await evaluate('hydrationReads');
    await evaluate('blockOpen=true'); await open(); await item('Set target date');
    assert.equal(await evaluate('hydrationReads'), reads, 'unsaved-work navigation veto is respected');
    await evaluate('blockOpen=false');
    await evaluate('hydrationOk=true;orders[0]._historyReadOnly=true;closeFixtureDetail()'); await open();
    assert.equal(await evaluate('[...document.querySelectorAll(".order-action-panel [role=menuitem]")].filter(n=>/target date|shop instructions/.test(n.textContent)).every(n=>n.getAttribute("aria-disabled")==="true")'), true);
    await evaluate('OrderActions.close();orders[0]._historyReadOnly=false');
    for (const width of [393, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await flush();
      await evaluate('fixtureWidth(true);closeFixtureDetail()'); await open(1); await capture('menu-' + width); await item('Set target date');
      assert.equal(await evaluate('document.getElementById("tab-production").hidden'), false, 'relocated date routes to mobile Production');
      assert.equal(await evaluate('document.activeElement.id'), 'target-date-input'); await capture('date-' + width);
      await evaluate('closeFixtureDetail()'); await open(1); await item('Edit shop instructions');
      assert.equal(await evaluate('document.getElementById("notes-overlay").classList.contains("hidden")'), false);
      assert.equal(await evaluate('document.activeElement.id'), 'notes-input'); await capture('instructions-' + width);
      const saved = await evaluate('orders[1].notes');
      await evaluate('document.getElementById("notes-input").value="Canceled mobile edit"'); await click('#notes-cancel');
      assert.equal(await evaluate('orders[1].notes'), saved);
      await evaluate('closeFixtureDetail()'); await open(1); await item('Edit shop instructions');
      await evaluate('document.getElementById("notes-input").value="Mobile instructions";failSave=true'); await click('#notes-confirm'); await flush();
      assert.match(await evaluate('document.getElementById("notes-modal-status").textContent'), /not saved/);
      assert.equal(await evaluate('document.getElementById("notes-input").value'), 'Mobile instructions');
      await evaluate('failSave=false'); await click('#notes-confirm'); await flush();
      assert.equal(await evaluate('calls.at(-1).name'), '200 – Synthetic B');
      assert.equal(await evaluate('orders[1].notes'), 'Mobile instructions');
      await evaluate('closeFixtureDetail()');
    }
    assert.deepEqual(await evaluate('errors'), []);
  } finally { cdp?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
});
