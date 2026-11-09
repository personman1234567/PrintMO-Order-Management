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
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => reject(Error(method+' timed out')), 8000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); }, close() { socket.close(); for(const task of pending.values())clearTimeout(task.timer); } };
}

test('delivery filters affect only their grid, compose with production filters, and work on mobile', { timeout: 60000 }, async () => {
  const html = await fs.readFile(path.join(root,'order-manager-web/index.html'),'utf8');
  const renderer = (await fs.readFile(path.join(root,'renderer.js'),'utf8')).replace(/\r\n/g,'\n');
  const runtime = renderer.slice(renderer.indexOf('function printViewForOrder('),renderer.indexOf('\nfunction timeAgo('));
  const column = renderer.slice(renderer.indexOf('function renderStatusColumn('),renderer.indexOf('\n/**\n * Refresh only the visible bundle modal'));
  const header = html.slice(html.indexOf('<div class="panel-header production-panel-header">'),html.indexOf('<div class="panel-body fulfillment-board">'));
  const grid = html.match(/<div class="production-stage" id="print-section">[\s\S]*?<div class="cards workflow-card-grid" id="col-print"[^>]*><\/div>\s*<\/div>/)[0];
  const filters = html.match(/<div id="order-list-filters"[\s\S]*?<\/div>/)[0];
  const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/desktop.css" media="(min-width:901px)"><link rel="stylesheet" href="/mobile.css" media="(max-width:900px)"><link rel="stylesheet" href="/dashboard-controls.css"><link rel="stylesheet" href="/mobile-order-workspace.css"><style>body{margin:0;font:14px system-ui;height:100dvh;display:flex;flex-direction:column}#orders-view{flex:1;min-height:0;display:flex;flex-direction:column}.panel.fulfillment{width:min(540px,100%);height:650px;margin:12px}.fixture-desktop{display:flex;flex:1;min-height:0}.fixture-desktop .card{padding:16px;background:white;border:1px solid #cbd5e1}.fixture-other{padding:20px}body[data-mobile-workspace=true] .fixture-desktop{display:none}.mw-more:empty{display:none}#fixture-filter-source{display:none}</style></head><body data-order-source="shopify" data-active-view="orders" data-board-load-state="ready"><main id="orders-view"><div class="fixture-desktop"><div class="panel fulfillment">${header}${grid}</div><div class="fixture-other" id="col-received">Pipeline stays visible</div></div></main><div id="mobile-command-surface"></div><div id="fixture-filter-source">${filters}</div><script src="/order-board-model.js"></script><script src="/mobile-order-model.js"></script><script>
  const model=OrderBoardModel;const allOrders=[];const candidateBoardCards=new Map();let activePrintView='printed',activePrintDelivery='all';const PRINT_VIEWS=['toPrint','printed'];
  for(const [id,kind,stage,bundle,complete] of [['p','pickup','completed'],['s','shipping','completed'],['m','mixed','completed'],['u',null,'completed'],['x','shipping','completed','',false],['bp','pickup','completed','Team'],['bs','shipping','completed','Team'],['tp','pickup','print'],['ts','shipping','print'],['pipeline','pickup','received']]) allOrders.push({_candidate:true,_provider:'shopify',_orderKey:id,name:'#'+id+' – Synthetic order',status:stage==='received'?'received':'print',productionStage:stage,bundle:bundle||'',items:[{id:'shirt',qty:2,sku:'B102'}],canonical:{commerce:{deliveryMethod:kind?{kind,complete:complete!==false}:null}}});
  const isShopifyBoardView=()=>document.body.dataset.orderSource==='shopify';const isGarmentItem=()=>true;
  const STATUS_COLUMN_CONFIG={print:{containerId:'col-print',cardStyle:'pipeline',bundleStyle:'pipeline'}};
  const boardOrderIdentity=model.orderKey,candidateOrderRenderFingerprint=JSON.stringify,sortBundlesByOldest=entries=>entries;
  const makeCard=order=>{const card=document.createElement('article');card.className='card';card.textContent=order.name;card.dataset.ids=JSON.stringify([order._orderKey]);return card;};
  const makeBundleCard=(name,orders)=>{const card=makeCard(orders[0]);card.textContent=name+': '+orders.map(o=>o._orderKey).join(', ');card.dataset.ids=JSON.stringify(orders.map(o=>o._orderKey));return card;};
  const orderIsVisibleOnOperationalBoard=order=>order.displayFulfillmentStatus!=='FULFILLED';const syncBoardMoveFeedback=()=>{},publishOrderManagerBoardSnapshot=()=>{};
  window.productionPlanner={matchesOrder:()=>true};
  ${runtime}
  ${column}
  initPrintTabs();renderStatusColumn('print');
  window.getOrderManagerBoardSnapshot=()=>allOrders;
  window.OrderManagerViews={getSnapshot:()=>model.snapshot(allOrders,{isGarmentItem}),workflowState:()=>({busy:false,reviewing:false,remaining:[]})};
  window.OrderManagerNavigation={setMobileGuard(){},navigateMobile(area,options={}){document.body.dataset.mobileArea=area;document.body.dataset.mobileSubview=options.subview||({print:'print',supplies:'to_order',orders:'all'}[area]||'');document.dispatchEvent(new Event('printmo:mobile-area-changed'));}};
  window.fixture={ids:()=>[...document.querySelectorAll('#col-print .card')].flatMap(n=>JSON.parse(n.dataset.ids)),orders:allOrders};
  </script><script src="/mobile-order-workspace.js"></script></body></html>`;
  const allowed=['desktop.css','mobile.css','dashboard-controls.css','mobile-order-workspace.css','order-board-model.js','mobile-order-model.js','mobile-order-workspace.js'];
  const server=http.createServer(async(req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(fixture);}const file=req.url.slice(1);if(!allowed.includes(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await fs.readFile(path.join(root,'order-manager-web',file)));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'printmo-delivery-'));
  const browser=spawn(process.env.PRINTMO_BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let cdp;
  try{
    const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Browser unavailable')),12000);browser.once('error',reject);browser.stderr.on('data',data=>{log+=data;const found=log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(found){clearTimeout(timer);resolve('http://127.0.0.1:'+found[1]);}});});
    const pages=await(await fetch(endpoint+'/json/list')).json();cdp=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    const evaluate=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
    const flush=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
    await evaluate('new Promise((resolve,reject)=>{let tries=0;const check=()=>window.fixture&&window.MobileOrderWorkspace?resolve():++tries>200?reject(Error("Fixture failed")):setTimeout(check,20);check();})');
    const original=await evaluate('JSON.stringify(fixture.orders)');
    const choose=async(selector,value)=>{await evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(selector)});select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await flush();};
    assert.equal((await evaluate('fixture.ids()')).length,7);
    await choose('#production-delivery-filter','pickup');assert.deepEqual(await evaluate('fixture.ids()'),['bp','p']);
    assert.equal(await evaluate('document.getElementById("print-printed-count").textContent'),'2');
    assert.equal(await evaluate('document.getElementById("col-received").textContent'),'Pipeline stays visible');
    assert.equal(await evaluate('document.getElementById("production-workload-count").textContent'),'4','planning workload stays unfiltered');
    await choose('#production-delivery-filter','shipping');assert.deepEqual(await evaluate('fixture.ids()'),['bs','s']);
    await choose('#production-delivery-filter','other');assert.deepEqual(await evaluate('fixture.ids()'),['m','u','x']);
    await choose('#production-delivery-filter','pickup');await evaluate('setActivePrintView("toPrint")');assert.deepEqual(await evaluate('fixture.ids()'),['tp']);
    await evaluate('productionPlanner.matchesOrder=()=>false;renderStatusColumn("print")');assert.deepEqual(await evaluate('fixture.ids()'),[]);
    assert.match(await evaluate('document.getElementById("col-print").dataset.emptyMessage'),/delivery filter/);
    await evaluate('productionPlanner.matchesOrder=()=>true;setActivePrintView("printed")');
    if(process.env.PRINTMO_DELIVERY_SCREENSHOTS){await fs.mkdir(process.env.PRINTMO_DELIVERY_SCREENSHOTS,{recursive:true});const shot=await cdp.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.PRINTMO_DELIVERY_SCREENSHOTS,'delivery-desktop.png'),Buffer.from(shot.data,'base64'));}
    for(const width of [393,320]){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await flush();
      await evaluate('OrderManagerNavigation.navigateMobile("print",{subview:"completed"})');await flush();
      await choose('.mw-delivery select','pickup');
      assert.equal(await evaluate('document.querySelectorAll(".mw-rows .mw-row").length'),2);
      assert.equal(await evaluate('MobileOrderWorkspace.getState().filters.delivery'),'pickup');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      assert.equal(await evaluate('document.querySelector(".mw-delivery select").getBoundingClientRect().height>=44'),true);
      if(process.env.PRINTMO_DELIVERY_SCREENSHOTS){const shot=await cdp.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.PRINTMO_DELIVERY_SCREENSHOTS,'delivery-mobile-'+width+'.png'),Buffer.from(shot.data,'base64'));}
      await choose('.mw-delivery select','shipping');assert.equal(await evaluate('document.querySelectorAll(".mw-rows .mw-row").length'),2);
      await evaluate('OrderManagerNavigation.navigateMobile("orders")');await flush();
      assert.equal(await evaluate('MobileOrderWorkspace.getState().filters.delivery'),'all');
      await evaluate('OrderManagerNavigation.navigateMobile("print",{subview:"completed"})');await flush();
      assert.equal(await evaluate('MobileOrderWorkspace.getState().filters.delivery'),'shipping');
      await choose('.mw-delivery select','all');assert.equal(await evaluate('document.querySelectorAll(".mw-rows .mw-row").length'),7);
    }
    assert.equal(await evaluate('JSON.stringify(fixture.orders)'),original);
  }finally{cdp?.close();browser.kill();await new Promise(resolve=>server.close(resolve));}
});
