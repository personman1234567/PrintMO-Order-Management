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
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data), task = pending.get(value.id); if (!task) return;
    pending.delete(value.id); clearTimeout(task.timer); value.error ? task.reject(Error(JSON.stringify(value.error))) : task.resolve(value.result);
  });
  return { send(method, params = {}) { return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => reject(Error(method + ' timed out')), 8000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); }, close() { socket.close(); for (const task of pending.values()) clearTimeout(task.timer); } };
}

test('mobile image/status rail stays bounded, truthful and usable at phone widths', { timeout: 60000 }, async () => {
  const sprite = (await fs.readFile(path.join(root, 'order-manager-web/Assets/garments/garment-icons.svg'), 'utf8')).replace(/<\?xml[^>]*>/, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/mobile-order-workspace.css"><link rel="stylesheet" href="/order-actions.css"><link rel="stylesheet" href="/mobile-order-actions.css"><style>
  *{box-sizing:border-box}body{margin:0;height:100dvh;display:flex;flex-direction:column;font:14px system-ui}
  .fixture-host{height:56px;flex-shrink:0;background:#080808;color:white;padding:16px;font-weight:600}
  .app-content{display:flex;flex:1;min-height:0}#orders-view{display:flex;flex:1;min-height:0;flex-direction:column}
  .mw-more:empty{display:none}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  #detail-overlay{display:none}body.detail-open #detail-overlay{display:block;position:fixed;inset:56px 0 64px;background:white;z-index:1200;padding:16px}
  </style></head><body data-order-source="shopify" data-active-view="orders" data-board-load-state="ready">
  <header class="fixture-host">Print-MO Order Manager</header><main class="app-content"><section id="orders-view"><div class="container">Desktop board</div></section></main>
  <div id="mobile-command-surface"></div><div id="detail-overlay" aria-hidden="true"><button id="fixture-back">Back</button></div>
  <script src="/order-board-model.js"></script><script src="/order-action-model.js"></script><script src="/mobile-order-model.js"></script><script src="/order-garment-summary.js"></script><script src="/order-detail-state.js"></script>
  <script>
  const sample=OrderGarmentSummary.models({items:[{id:'proof',title:'Crewneck Sweatshirt',variantTitle:'Black / L',qty:1}]})[0];
  const proof='data:image/svg+xml,'+encodeURIComponent(('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="330" viewBox="0 0 600 330"><defs>'+${JSON.stringify(sprite)}+'</defs><rect width="600" height="330" fill="#f8fafc"/><svg x="40" y="15" width="240" height="300">'+OrderGarmentSummary.diagram({...sample,locations:[]},false)+'</svg><svg x="320" y="15" width="240" height="300">'+OrderGarmentSummary.diagram({...sample,locations:[]},true)+'</svg></svg>').replace(/href="[^"#]*#([^"]+)"/g,'href="#$1"'));
  const squareProof='data:image/svg+xml,'+encodeURIComponent(('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs>'+${JSON.stringify(sprite)}+'</defs><rect width="600" height="600" fill="#f8fafc"/><svg x="90" y="10" width="420" height="580">'+OrderGarmentSummary.diagram({...sample,locations:[]},false)+'</svg></svg>').replace(/href="[^"#]*#([^"]+)"/g,'href="#$1"'));
  const created=days=>new Date(Date.now()-days*86400000).toISOString();
  const orders=[['1863','Teri Prose','blanks_cart','pickup',4],['1862','Lisa McDowell','blanks_cart','shipping',1],['demo','A very long customer name that must wrap without taking width from the proof','print','shipping',9]].map(([id,name,stage,delivery,days])=>({
    _candidate:true,_provider:'shopify',_orderKey:id,name:'#'+id+' – '+name,productionStage:stage,receivedAt:created(days),
    items:[{id:'shirt',title:'Crewneck Sweatshirt',variantTitle:'Black / L',qty:2}],assets:[{assetId:'proof-'+id,role:'mockup',url:proof}],
    canonical:{displayName:'#'+id,source:{provider:'shopify',displayNumber:'#'+id},customer:{displayName:name},commerce:{lineItems:[{id:'shirt',title:'Crewneck',quantity:2}],lineItemsComplete:true,deliveryMethod:{kind:delivery,complete:true}},sync:{stale:id==='1863'}}
  }));
  orders[1].targetDate='2026-11-12'; orders[2].blanksStatus=1; orders[2].printsStatus=1;
  window.fixture={orders,proof,squareProof,opened:[],actions:[]};window.getOrderManagerBoardSnapshot=()=>orders;
  window.OrderManagerViews={getSnapshot:()=>OrderBoardModel.snapshot(orders,{isGarmentItem:()=>true,targetDatePresentation:OrderDetailState.targetDatePresentation}),workflowState:()=>({busy:false,reviewing:false,remaining:[]}),actions:()=>[{value:'move:received',label:'Move to Pipeline',enabled:true}],reviewOrders:async(keys,value)=>{fixture.moves.push({keys,value});const order=orders.find(o=>OrderBoardModel.orderKey(o)===keys[0]);order.productionStage=value.split(':')[1];document.dispatchEvent(new Event('printmo:board-updated'));return {results:[{key:keys[0],outcome:'saved'}]}}};
  window.OrderManagerNavigation={setMobileGuard(){},navigateMobile(area,options={}){document.body.dataset.mobileArea=area;document.body.dataset.mobileSubview=options.subview||({orders:'all',supplies:'blanks_cart',print:'print'}[area]||'');document.dispatchEvent(new Event('printmo:mobile-area-changed'));}};
  fixture.materials=[];fixture.moves=[];fixture.edits=[];fixture.copies=[];fixture.fail=false;fixture.wait=false;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>fixture.copies.push(text)}});
  window.OrderDetailEditors={edit:kind=>{fixture.edits.push(kind);return true;}};window.OrderActionsDetailReady=async()=>({ok:true});
  window.api={updateTargetDate:async()=>{},updateNotes:async()=>{},updateReady:async(reference,patch)=>{fixture.materials.push({reference,patch});if(fixture.wait)await new Promise(resolve=>fixture.finish=resolve);if(fixture.fail)throw Error('Synthetic connection failure');const order=orders.find(o=>o._orderKey===reference.orderKey&&o._provider===reference.provider);const local={...patch};if(local.stage){local.productionStage=local.stage;delete local.stage;}Object.assign(order,local);document.dispatchEvent(new Event('printmo:board-updated'));}};

  window.openDetail=order=>{fixture.opened.push(order._orderKey);document.body.classList.add('detail-open');document.getElementById('detail-overlay').classList.add('visible');document.getElementById('detail-overlay').setAttribute('aria-hidden','false');};
  document.getElementById('fixture-back').onclick=()=>{document.body.classList.remove('detail-open');document.getElementById('detail-overlay').classList.remove('visible');document.getElementById('detail-overlay').setAttribute('aria-hidden','true');document.dispatchEvent(new Event('printmo:detail-closed'));};
  </script><script src="/mobile-order-actions.js"></script><script src="/order-actions.js"></script><script src="/mobile-order-recognition.js"></script><script src="/mobile-order-workspace.js"></script></body></html>`;
  const allowed = new Set(['order-actions.js', 'order-actions.css', 'mobile-order-actions.js', 'mobile-order-actions.css', 'order-action-model.js', 'mobile-order-workspace.css', 'order-board-model.js', 'mobile-order-model.js', 'order-garment-summary.js', 'order-detail-state.js', 'mobile-order-recognition.js', 'mobile-order-workspace.js', 'Assets/garments/garment-icons.svg']);
  const server = http.createServer(async (req, res) => {
    if (req.url.split('?')[0] === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fixture); }
    const file = req.url.slice(1).split('?')[0]; if (!allowed.has(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', (file.endsWith('.js') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/css') + '; charset=utf-8');
    res.end(await fs.readFile(path.join(root, 'order-manager-web', file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'printmo-mobile-rail-'));
  const browser = spawn(process.env.PRINTMO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let log = ''; const timer = setTimeout(() => reject(Error('Browser unavailable')), 12000); browser.once('error', reject);
      browser.stderr.on('data', data => { log += data; const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); } });
    });
    const pages = await (await fetch(endpoint + '/json/list')).json(); cdp = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    const evaluate = async expression => { const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    await evaluate('new Promise((resolve,reject)=>{let tries=0;const check=()=>window.MobileOrderWorkspace&&document.querySelectorAll(".mw-row").length===3?resolve():++tries>200?reject(Error("Rail fixture failed")):setTimeout(check,20);check()})'); await flush();
    const first = '[...document.querySelectorAll(".mw-row")].find(row=>row.dataset.orderKey===JSON.stringify(["shopify","1863"]))';
    for (const width of [393, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 852, deviceScaleFactor: 1, mobile: true }); await flush();
      const geometry = await evaluate(`(()=>{const row=${first},p=row.querySelector('.mw-preview-open'),r=row.querySelector('.mw-row-rail'),i=row.querySelector('.mw-preview-media>img');return {height:row.getBoundingClientRect().height,previewHeight:p.getBoundingClientRect().height,row:row.getBoundingClientRect().width,proof:p.getBoundingClientRect().width,rail:r.getBoundingClientRect().width,fit:getComputedStyle(i).objectFit,overflow:document.documentElement.scrollWidth>innerWidth,stageColor:getComputedStyle(row.querySelector('.mw-row-stage')).color,touch:row.querySelector('.mw-row-actions').getBoundingClientRect().height}})()`);
      assert.equal(geometry.overflow, false); assert(geometry.proof >= 180 && geometry.proof > geometry.row * .64, 'mockup stays dominant at ' + width);
      assert(geometry.rail >= 88); assert.equal(geometry.previewHeight, 128); assert(geometry.height < 252, 'ordinary rows stay compact'); assert.equal(geometry.fit, 'contain'); assert.equal(geometry.stageColor, 'rgb(15, 23, 42)'); assert(geometry.touch >= 44);
      assert.equal(await evaluate(`${first}.querySelector('.mw-row-detail').textContent`), '');
      assert.equal(await evaluate(first+".querySelector('.mw-print-value').textContent"), 'Not recorded');
      assert.equal(await evaluate(first+".querySelector('.mw-row-number').contains("+first+".querySelector('.mw-row-delivery'))"), true);
      assert.equal(await evaluate(first+".querySelector('.mw-row-status').hidden"), true);
      assert.equal(await evaluate(`${first}.textContent.includes('Cached data')`), false);
      assert.equal(await evaluate(`${first}.querySelector('.mw-row-target').hidden`), true);
      assert.equal(await evaluate(`${first}.querySelector('.mw-row-age strong').textContent`), '4d');
      assert.equal(await evaluate('document.querySelectorAll(".mw-row-garments").length'), 0);
      assert.equal(await evaluate('document.querySelectorAll(".mw-row")[2].querySelector(".mw-row-detail").textContent'), 'Blanks: In hand');
      assert.match(await evaluate('document.querySelector(".mw-refresh-status").textContent'), /Some order data/);
      if (process.env.PRINTMO_RAIL_CAPTURE === '1') { const dir = path.join(root, 'tmp/mobile-order-rail-qa'); await fs.mkdir(dir, { recursive: true }); const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(dir, 'mobile-' + width + '.png'), Buffer.from(shot.data, 'base64')); }
      await evaluate('fixture.orders[0].assets[0].url=fixture.squareProof;document.dispatchEvent(new Event("printmo:board-updated"))'); await flush();
      await evaluate(`new Promise((resolve,reject)=>{const until=Date.now()+3000;const check=()=>{const img=${first}.querySelector('.mw-preview-media>img');if(img.complete&&img.naturalWidth===600&&img.naturalHeight===600)return resolve();if(Date.now()>until)return reject(Error('Square proof did not load'));setTimeout(check,20)};check()})`);
      assert.equal(await evaluate(`${first}.querySelector('.mw-preview-open').getBoundingClientRect().height`), geometry.previewHeight, 'square mockups do not inflate the row');
      assert.equal(await evaluate(`getComputedStyle(${first}.querySelector('.mw-preview-media>img')).objectFit`), 'contain', 'the complete square remains visible');
      if (process.env.PRINTMO_RAIL_CAPTURE === '1') { const shot=await cdp.send('Page.captureScreenshot',{format:'png'}); await fs.writeFile(path.join(root,'tmp/mobile-order-rail-qa','square-'+width+'.png'),Buffer.from(shot.data,'base64')); }
      await evaluate('fixture.orders[0].assets[0].url=fixture.proof;document.dispatchEvent(new Event("printmo:board-updated"))'); await flush();
    }
    const before = await evaluate(`${first}.getBoundingClientRect().height`);
    await evaluate('fixture.orders[0].items=Array.from({length:300},(_,i)=>({id:"shirt-"+i,title:"Crewneck Sweatshirt",variantTitle:"Black / L",qty:2}));document.dispatchEvent(new Event("printmo:board-updated"))'); await flush();
    assert.equal(await evaluate(`${first}.getBoundingClientRect().height`), before, 'hundreds of lines do not grow the entry');
    // Exercise the real mobile presenter and shared commands rather than a stub.
    const sheetOpen = () => evaluate('document.getElementById("mobile-order-actions")?.open===true');
    const sheetClick = async id => { await evaluate('document.querySelector('+JSON.stringify('[data-moa-id="'+id+'"]')+').click()'); await flush(); };
    for (const [width,height] of [[393,852],[320,568],[600,700],[900,700],[393,380]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await flush();
      await evaluate(first+".querySelector('.mw-row-actions').click()");await flush();
      assert.equal(await sheetOpen(),true);
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".moa-row")].slice(0,3).map(n=>n.dataset.moaId)'),['move','blanks','prints']);
      assert.equal(await evaluate('document.getElementById("order-action-menu").hidden'),true,'desktop menu stays hidden on mobile');
      assert.equal(await evaluate('document.querySelector(".moa-row").getBoundingClientRect().height>=52'),true);
      assert.equal(await evaluate('(()=>{const r=document.querySelector(".mobile-order-actions").getBoundingClientRect(),v=visualViewport;return r.left>=0&&r.right<=v.width+1&&r.bottom<=v.height+v.offsetTop+1&&r.top>=v.offsetTop;})()'),true);
      const headerTop=await evaluate('document.querySelector(".moa-header").getBoundingClientRect().top');
      await evaluate('document.querySelector(".moa-body").scrollTop=10000;window.dispatchEvent(new Event("blur"));window.dispatchEvent(new Event("resize"));document.dispatchEvent(new Event("printmo:board-updated"))');await flush();
      assert.equal(await sheetOpen(),true,'scroll, resize, blur and ordinary refresh retain the sheet');
      assert.equal(await evaluate('document.querySelector(".moa-header").getBoundingClientRect().top'),headerTop,'header stays fixed while body scrolls');
      assert.equal(await evaluate('(()=>{const last=document.querySelector("[data-moa-id=copy]"),r=last.getBoundingClientRect(),b=document.querySelector(".moa-body").getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom+1;})()'),true,'lower actions are reachable');
      if(process.env.PRINTMO_RAIL_CAPTURE==='1'){const shot=await cdp.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'tmp/mobile-order-rail-qa','actions-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));}
      await sheetClick('prints');
      assert.equal(await evaluate('document.querySelector(".moa-row[aria-pressed=true]").textContent'),'Not recorded');
      if(process.env.PRINTMO_RAIL_CAPTURE==='1'&&width===393&&height===852){const shot=await cdp.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'tmp/mobile-order-rail-qa','prints-393.png'),Buffer.from(shot.data,'base64'));}
      await sheetClick('prints:none');assert.equal(await sheetOpen(),true);
      await evaluate('OrderActions.close()');await flush();assert.equal(await sheetOpen(),false);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});await flush();
    await evaluate(first+".querySelector('.mw-row-actions').click()");await flush();
    await sheetClick('prints');await sheetClick('prints:sheet');
    assert.equal(await evaluate('fixture.materials.length'),1);
    assert.equal(await evaluate('fixture.materials[0].reference.orderKey'),'1863');
    assert.equal(await evaluate(first+".querySelector('.mw-print-value').textContent"),'On saved sheet');
    assert.equal(await evaluate('document.querySelector("[data-moa-id=prints] .moa-value").textContent'),'On saved sheet');
    await sheetClick('prints');await evaluate('fixture.fail=true');await sheetClick('prints:ordered');
    assert.match(await evaluate('document.querySelector(".moa-feedback").textContent'),/not saved/);
    assert.equal(await evaluate('document.querySelector(".moa-row[aria-pressed=true]").textContent'),'On saved sheet','failed save retains checked state and retry');
    await evaluate('fixture.fail=false;fixture.wait=true');await sheetClick('prints:ordered');
    assert.equal(await evaluate('document.querySelector(".moa-body").getAttribute("aria-busy")'),'true');
    assert.equal(await evaluate('[...document.querySelectorAll(".moa-row")].every(n=>n.disabled)'),true);
    await evaluate('fixture.finish();fixture.wait=false');await flush();await flush();
    assert.equal(await evaluate('document.querySelector("[data-moa-id=prints] .moa-value").textContent'),'Ordered');
    await sheetClick('blanks');await sheetClick('blanks:hand');
    assert.equal(await evaluate('document.querySelector("[data-moa-id=blanks] .moa-value").textContent'),'In hand');
    await sheetClick('copy');await sheetClick('copy:orderNumber');
    assert.deepEqual(await evaluate('fixture.copies'),['#1863']);
    await evaluate('fixture.orders[0]._historyReadOnly=true;document.dispatchEvent(new Event("printmo:board-updated"))');await flush();
    assert.equal(await evaluate('["move","blanks","prints"].every(id=>document.querySelector("[data-moa-id="+id+"]").disabled)'),true,'read-only refresh disables mutations in the open sheet');
    await evaluate('fixture.orders[0]._historyReadOnly=false;document.dispatchEvent(new Event("printmo:board-updated"))');await flush();
    await sheetClick('move');await sheetClick('move:received');await flush();assert.equal(await sheetOpen(),true,'stage review returns to sheet');
    assert.equal(await evaluate('fixture.moves[0].keys[0]'),await evaluate('OrderBoardModel.orderKey(fixture.orders[0])'));
    await evaluate('OrderActions.close()');await flush();
    assert.equal(await evaluate('document.activeElement.className'),'mw-row-actions');
    await evaluate(first+".querySelector('.mw-row-actions').click()");await flush();
    await evaluate('document.body.dataset.orderSource="legacy"');await flush();assert.equal(await sheetOpen(),false,'source switch closes without crossing providers');
    await evaluate('document.body.dataset.orderSource="shopify";fixture.orders[0].productionStage="blanks_cart";fixture.orders[0].printsOrdered=false;fixture.orders[0].printsOnSavedSheet=false;fixture.orders[0].blanksStatus=false;document.dispatchEvent(new Event("printmo:board-updated"))');await flush();
    assert.equal(await evaluate('fixture.opened.length'),0);
    for (const [action,kind] of [['targetDate','targetDate'],['notes','notes']]) {
      await evaluate(first+".querySelector('.mw-row-actions').click()");await flush();await sheetClick(action);await flush();
      assert.equal(await sheetOpen(),false,'detail editors take over the mobile sheet');
      assert.equal(await evaluate('fixture.edits.at(-1)'),kind);
      await evaluate('document.getElementById("fixture-back").click()');await flush();
    }
    await evaluate('fixture.opened=[]');

    await evaluate(`${first}.querySelector('.mw-preview-open').click()`); assert.equal(await evaluate('fixture.opened[0]'), '1863');
    await evaluate('document.getElementById("fixture-back").click()'); await flush(); await flush();
    assert.equal(await evaluate('document.activeElement.className'), 'mw-row-open');
    await evaluate('document.querySelector(".mw-select").click()'); await flush();
    assert.equal(await evaluate(`${first}.querySelector('.mw-row-actions').hidden`), true);
    assert.equal(await evaluate(`${first}.querySelector('.mw-row-selection').getBoundingClientRect().height>=44`), true);
    await evaluate('document.querySelector(".mw-select").click();fixture.orders.forEach(o=>o.canonical.sync={stale:false});document.dispatchEvent(new Event("printmo:board-updated"))'); await flush();
    assert.equal(await evaluate('document.querySelector(".mw-refresh-status").textContent'), '');
    await evaluate('OrderManagerNavigation.navigateMobile("supplies")'); await flush();
    assert.equal(await evaluate(`${first}.querySelector('.mw-row-rail').hidden`), true);
    assert.match(await evaluate(`${first}.querySelector('.mw-row-detail').textContent`), /Blanks: In S&S cart/);
    await evaluate('OrderManagerNavigation.navigateMobile("orders")'); await flush();
    assert.equal(await evaluate(`${first}.querySelector('.mw-row-rail').hidden`), false);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 852, deviceScaleFactor: 1, mobile: false }); await flush();
    assert.equal(await evaluate('document.body.dataset.mobileWorkspace'), 'false');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true }); await flush();
    await evaluate('document.body.dataset.orderSource="legacy"'); await flush(); assert.equal(await evaluate('document.body.dataset.mobileWorkspace'), 'false');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/?printmo_list_preview=0' });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if (await evaluate('location.search.includes("printmo_list_preview=0")&&Boolean(window.MobileOrderWorkspace)')) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.notEqual(await evaluate('document.body.dataset.mobileWorkspace'), 'true');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".mobile-workspace")).display'), 'none');
  } finally { try { await cdp?.send('Browser.close'); } catch {} cdp?.close(); browser.kill(); browser.stderr?.destroy(); browser.unref(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
