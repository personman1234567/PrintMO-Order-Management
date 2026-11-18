const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'order-manager-web');
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* Optional installed browser harness. */ }
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
test('sample workspace generates, previews, exports exact bytes, rejects dates and releases resources', { timeout: 60000 }, async t => {
  if (!chromium) return t.skip('Use an installed Playwright via NODE_PATH for the browser check.');
  const output = process.env.PRINTMO_REPORT_UI_OUTPUT || path.join(root, 'tmp/storefront-reports-ui');
  await fs.mkdir(output, { recursive: true });
  const requests = [], failures = [];
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://localhost');
      if(url.pathname==='/reports-host.html'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui}body{display:flex;flex-direction:column}header{height:72px;flex:none;background:#111;color:white;display:flex;align-items:center;padding:0 16px;box-sizing:border-box}iframe{border:0;width:100%;flex:1;min-height:0}footer{height:76px;flex:none;display:flex;align-items:center;justify-content:space-around;background:#f6f7f8;border-top:1px solid #ddd}</style></head><body><header>Print-MO Order Manager · Shopify</header><iframe title="Order Manager" src="/index.html?shop=fixture.myshopify.com"></iframe><footer><span>Home</span><span>Search</span><span>Inbox</span><span>Menu</span></footer></body></html>');}
      const file=path.resolve(web,'.'+decodeURIComponent(url.pathname));
      if(req.method!=='GET'||!file.startsWith(web+path.sep)) {res.writeHead(403);return res.end();}
      const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[ext]||'application/octet-stream');
      res.end(await fs.readFile(file));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({executablePath:process.env.PRINTMO_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-gpu','--disable-background-networking']});
  try {
    for(const viewport of [{width:1280,height:900},{width:393,height:650}]){
      const context=await browser.newContext({viewport,acceptDownloads:true});
      await context.route('**/*',route=>{const url=route.request().url();requests.push(url);if(!url.startsWith(origin+'/')&&!url.startsWith('blob:')){failures.push(url);return route.abort();}return route.continue();});
      await context.addInitScript(()=>{
        const NativeDate=Date;window.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:['2026-11-11T20:30:00Z']));}static now(){return new NativeDate('2026-11-11T20:30:00Z').valueOf();}};
        window.reportWorkerEvidence=[];const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);const item={url:String(args[0]),terminated:false,bytes:null};window.reportWorkerEvidence.push(item);this.addEventListener('message',event=>{if(event.data?.bytes instanceof Uint8Array)item.bytes=event.data.bytes.slice();});const terminate=this.terminate.bind(this);this.terminate=()=>{item.terminated=true;return terminate();};}};
      });
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`${origin}/storefront-reports-preview.html?reports=sample`);
      await page.locator('.reports-generate').waitFor();
      assert.match(await page.locator('.reports-sample-notice').textContent(),/fictional/);
      const before=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));assert(!before.some(u=>/pdf-lib.min|fontkit|vendor\/pdf|Manrope.*ttf/.test(u)));
      if(viewport.width===1280) await page.locator('[data-reports-action="select-all"]').click();
      await page.locator('.reports-generate').click();
      await page.waitForFunction(()=>document.querySelector('.reports-generation-status')?.textContent.includes('ready.')&&document.querySelector('.reports-pdf-canvas')?.width>0&&document.querySelector('.reports-viewer-status')?.textContent==='');
      assert.equal(await page.locator('.reports-result-row').count(),viewport.width===1280?2:1);
      assert.match(await page.locator('.reports-page-label').textContent(),/1 \/ 2/);
      const downloadPromise=page.waitForEvent('download');await page.locator('[data-reports-action="download-current"]').click();const download=await downloadPromise;
      const pdf=await fs.readFile(await download.path());const workerBytes=await page.evaluate(()=>Array.from(window.reportWorkerEvidence.find(w=>w.bytes)?.bytes||[]));assert.equal(digest(pdf),digest(Buffer.from(workerBytes)));
      if(viewport.width===1280) await fs.writeFile(path.join(output,'Dr-Dallas-SAMPLE.pdf'),pdf);
      const zipPromise=page.waitForEvent('download');await page.locator('[data-reports-action="download-selected"]').click();const zipDownload=await zipPromise;const zip=await fs.readFile(await zipDownload.path());
      assert.equal(zip.readUInt32LE(0),0x04034b50);const fileStart=30+zip.readUInt16LE(26);assert.equal(digest(zip.subarray(fileStart,fileStart+zip.readUInt32LE(18))),digest(pdf));
      await page.locator('[data-reports-action="next-page"]').click();await page.waitForFunction(()=>document.querySelector('.reports-page-label').textContent.startsWith('2 /'));
      await page.locator('[data-reports-action="previous-page"]').click();
      await page.waitForFunction(()=>{const c=document.querySelector('.reports-pdf-canvas');return document.querySelector('.reports-viewer-status').textContent===''&&c.width>0&&c.getContext('2d').getImageData(0,0,1,1).data[3]===255;});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.evaluate(()=>{document.scrollingElement.scrollTop=0;document.querySelector('.reports-scroll').scrollTop=0;});
      assert(await page.evaluate(()=>document.querySelector('.reports-scroll').clientHeight>0&&document.querySelector('#storefront-reports-view').getBoundingClientRect().bottom<=innerHeight+1));
      await page.screenshot({path:path.join(output,viewport.width===1280?'workspace-desktop.png':'workspace-mobile.png'),fullPage:true});
      await page.locator('.reports-period-preset').selectOption('custom');await page.locator('.reports-start-date').fill('2026-11-10');await page.locator('.reports-end-date').fill('2026-11-01');await page.locator('.reports-generate').click();assert.match(await page.locator('.reports-form-error').textContent(),/Start date/);
      assert.equal(await page.locator('.reports-stale-notice').isVisible(),true);assert.match(await page.locator('.reports-preview-period').textContent(),/Nov 1.*Nov 11/);
      await page.locator('.reports-start-date').fill('2026-10-01');await page.locator('.reports-end-date').fill('2026-10-31');await page.locator('.reports-generate').click();
      await page.waitForFunction(()=>document.querySelector('.reports-result-status')?.textContent==='No activity'&&document.querySelector('.reports-page-label')?.textContent==='1 / 1');
      await page.evaluate(()=>window.reportPreviewHooks.onLeave());assert.equal(await page.locator('.reports-result-row').count(),0);assert.equal(await page.locator('.reports-pdf-canvas').getAttribute('width'),'0');
      await page.evaluate(()=>window.reportPreviewHooks.onEnter());await page.locator('.reports-generate').click();await page.locator('[data-reports-action="cancel"]').click();assert.match(await page.locator('.reports-generation-status').textContent(),/cancelled/);
      await page.waitForTimeout(150);assert.equal(await page.locator('.reports-result-status[data-status="ready"]').count(),0);
      await page.evaluate(()=>window.reportPreviewHooks.onLeave());const workers=await page.evaluate(()=>window.reportWorkerEvidence.filter(w=>w.url.includes('storefront-reports-pdf-worker')).map(({url,terminated})=>({url,terminated})));assert(workers.every(w=>w.terminated));assert.deepEqual(errors,[]);
      await context.close();
    }
    // Exercise the real Order Manager navigation with all operational traffic intercepted.
    const integration=await browser.newContext({viewport:{width:1280,height:900}}), blockedOperational=[];
    const {createSampleSnapshot}=await import(require('node:url').pathToFileURL(path.join(web,'storefront-reports-model.mjs')).href);
    let liveFixtureState='complete';
    let liveOwners=[{id:'dr-dallas',name:'The Dr. Dallas Show',logoUrl:'./report-assets/dr-dallas-logo.png'}];
    const generatedRequests=[];
    await integration.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin===origin)return route.continue();
      if(url.hostname==='cdn.shopify.com'&&url.pathname.endsWith('/app-bridge.js'))return route.fulfill({contentType:'text/javascript',body:'window.shopify={idToken:async()=>"synthetic-test-token"};'});
      if(request.method()==='GET'&&url.hostname==='order-manager-proxy.printmobusiness.workers.dev'&&url.pathname==='/order-manager/v1/orders')return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[],pageInfo:{nextCursor:'',total:0}})});
      if(url.hostname==='order-manager-proxy.printmobusiness.workers.dev'&&url.pathname==='/order-manager/v1/storefront-reports/owners')return route.fulfill({status:liveFixtureState==='owner-error'?503:200,contentType:'application/json',body:JSON.stringify(liveFixtureState==='owner-error'?{error:{code:'REPORT_UPSTREAM_FAILED'}}:{owners:liveOwners})});
      if(url.hostname==='order-manager-proxy.printmobusiness.workers.dev'&&url.pathname==='/order-manager/v1/storefront-reports/generate'){
        if(liveFixtureState==='error')return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:{code:'REPORT_UPSTREAM_FAILED'}})});
        const input=request.postDataJSON();generatedRequests.push(input);const snapshot=JSON.parse(JSON.stringify(createSampleSnapshot(input.ownerId,{start:input.start,end:input.end,...(input.preset?{preset:input.preset}:{})})));
        snapshot.mode='live';snapshot.status=liveFixtureState==='review'?'needs-review':'complete';snapshot.completeness={complete:liveFixtureState!=='review',financialComplete:liveFixtureState!=='review'};snapshot.exceptions=[];
        if(liveFixtureState==='review'){snapshot.totals.baseCents=null;snapshot.totals.earningsCents=null;snapshot.totals.fulfilledEarningsCents=null;snapshot.totals.pendingEarningsCents=null;snapshot.exceptions=[{code:'RATE_MISSING',message:'An approved rate is missing for this synthetic fixture.'}];}
        return route.fulfill({contentType:'application/json',body:JSON.stringify({snapshot})});
      }
      blockedOperational.push({method:request.method(),host:url.hostname,path:url.pathname});return route.abort();
    });
    const integrated=await integration.newPage();
    await integrated.goto(origin+'/index.html?shop=fixture.myshopify.com');
    assert.equal(await integrated.locator('[data-view="reports"]').isVisible(),false); // Navigation lives in the closed Menu.
    assert.equal(await integrated.locator('[data-view="reports"]').getAttribute('hidden'),null);
    assert(!await integrated.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('storefront-reports-workspace'))));
    await integrated.goto(origin+'/index.html?shop=fixture.myshopify.com&reports=sample');
    assert.equal(await integrated.evaluate(()=>OrderManagerNavigation.navigate('reports')),true);
    await integrated.locator('.reports-generate').waitFor();
    assert.equal(await integrated.locator('#storefront-reports-view').getAttribute('aria-hidden'),'false');
    assert.equal(await integrated.locator('.storefront-reports-heading #dashboard-menu-toggle').count(),1);
    await integrated.locator('.reports-generate').click();
    await integrated.waitForFunction(()=>document.querySelector('.reports-result-status')?.textContent==='Ready'&&document.querySelector('.reports-page-label')?.textContent==='1 / 2'&&document.querySelector('.reports-viewer-status')?.textContent==='');
    assert.equal(await integrated.locator('.reports-sample-label,.reports-intro,.reports-sample-notice').count(),0);
    assert.match(await integrated.locator('.reports-result-identity').textContent(),/The Dr. Dallas Show/);
    await integrated.locator('.reports-period-preset').selectOption('all-time');assert.equal(await integrated.locator('.reports-dates').isHidden(),true);await integrated.locator('.reports-generate').click();await integrated.waitForFunction(()=>document.querySelector('.reports-generation-status')?.textContent.includes('ready.')&&document.querySelector('.reports-preview-period')?.textContent.includes('All time'));assert.deepEqual(generatedRequests.at(-1),{ownerId:'dr-dallas',preset:'all-time'});assert.match(await integrated.locator('.reports-preview-period').textContent(),/Nov 2/);
    liveFixtureState='review';await integrated.locator('.reports-generate').click();
    await integrated.waitForFunction(()=>document.querySelector('.reports-result-status')?.textContent==='Needs review'&&document.querySelector('.reports-review-warning')?.hidden===false&&document.querySelector('.reports-viewer-status')?.textContent==='');
    assert.equal(await integrated.locator('[data-reports-action="download-selected"]').isDisabled(),true);
    const reviewDownload=integrated.waitForEvent('download');await integrated.locator('[data-reports-action="download-current"]').click();assert.match((await reviewDownload).suggestedFilename(),/^REVIEW-/);
    liveFixtureState='error';await integrated.locator('.reports-generate').click();await integrated.waitForFunction(()=>document.querySelector('.reports-result-status')?.textContent==='Could not prepare');
    assert.equal(await integrated.locator('.reports-sample-label,.reports-intro,.reports-sample-notice').count(),0);assert.equal(await integrated.locator('.reports-pdf-canvas').isHidden(),true);
    liveFixtureState='owner-error';await integrated.evaluate(()=>{OrderManagerNavigation.navigate('orders');OrderManagerNavigation.navigate('reports');});await integrated.locator('.reports-owner-retry').waitFor({state:'visible'});assert.equal(await integrated.locator('.reports-generate').isDisabled(),true);
    liveFixtureState='complete';await integrated.locator('.reports-owner-retry').click();await integrated.waitForFunction(()=>!document.querySelector('.reports-generate').disabled);
    await integrated.evaluate(()=>OrderManagerNavigation.navigate('orders'));
    assert.equal(await integrated.locator('#storefront-reports-view').getAttribute('aria-hidden'),'true');
    await integrated.evaluate(()=>{OrderManagerNavigation.navigate('reports');document.body.dataset.orderSource='redis';});
    await integrated.waitForFunction(()=>document.body.dataset.activeView==='orders');
    assert.equal(await integrated.locator('[data-view="reports"]').isHidden(),true);
    // Actual app CSS and navigation inside an iframe with host chrome; no live data writes.
    liveFixtureState='complete';
    liveOwners=[{id:'dr-dallas',name:'The Dr. Dallas Show'},{id:'sample-owner',name:'Partner Two'},...Array.from({length:6},(_,i)=>({id:'owner-'+(i+3),name:'Other owner '+(i+3)}))];
    const host=await integration.newPage();await host.setViewportSize({width:393,height:844});await host.goto(origin+'/reports-host.html');const mobile=host.frames().find(f=>f.url().includes('/index.html'));assert(mobile);await mobile.evaluate(()=>OrderManagerNavigation.navigate('reports'));await mobile.waitForFunction(()=>document.querySelectorAll('.reports-owner-option').length===8);
    assert.equal(await mobile.locator('.reports-intro,.reports-sample-label,.reports-sample-notice').count(),0);assert.equal(await mobile.locator('.reports-method').getAttribute('open'),null);assert.equal(await mobile.locator('.reports-output').isHidden(),true);assert.equal(await mobile.locator('.reports-owner-picker').getAttribute('open'),null);
    const geometry=await mobile.evaluate(()=>{const s=document.querySelector('.reports-scroll').getBoundingClientRect(),owner=document.querySelector('.reports-owner-picker').getBoundingClientRect(),date=document.querySelector('.reports-period-preset').getBoundingClientRect(),generate=document.querySelector('.reports-generate').getBoundingClientRect();return{ownerFirst:owner.top>=s.top&&owner.top-s.top<16,dateVisible:date.top>=s.top&&date.bottom<=s.bottom,generateVisible:generate.bottom<=s.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});assert(geometry.ownerFirst);assert(geometry.dateVisible);assert(geometry.generateVisible);assert.equal(geometry.overflow,false);await host.screenshot({path:path.join(output,'controls-first-mobile.png')});
    await mobile.locator('.reports-owner-picker>summary').click();await mobile.locator('.reports-owner-search').fill('Partner Two');await mobile.locator('[data-owner-id="sample-owner"]').check();await mobile.locator('.reports-owner-picker>summary').click();assert.match(await mobile.locator('.reports-owner-selected').textContent(),/2 owners selected/);await mobile.locator('.reports-method>summary').click();assert.match(await mobile.locator('.reports-method').textContent(),/not a payment balance/);await mobile.locator('.reports-method>summary').click();const firstRequest=generatedRequests.length;await mobile.locator('.reports-generate').click();await mobile.waitForFunction(()=>document.querySelector('.reports-generation-status')?.textContent.includes('ready.'));assert.deepEqual(generatedRequests.slice(firstRequest).map(r=>r.ownerId).sort(),['dr-dallas','sample-owner']);
    await mobile.evaluate(()=>{OrderManagerNavigation.navigate('orders');OrderManagerNavigation.navigate('reports');});await mobile.waitForFunction(()=>document.querySelectorAll('.reports-owner-option').length===1);assert.equal(await mobile.locator('.reports-owner-search').inputValue(),'Partner Two');assert.equal(await mobile.locator('.reports-output').isHidden(),true);assert.equal(await mobile.locator('.reports-intro,.reports-sample-label,.reports-sample-notice').count(),0);
    // Small owner lists stay directly visible without a redundant search field.
    liveOwners=liveOwners.slice(0,2);const smallHost=await integration.newPage();await smallHost.setViewportSize({width:393,height:844});await smallHost.goto(origin+'/reports-host.html');const small=smallHost.frames().find(f=>f.url().includes('/index.html'));await small.evaluate(()=>OrderManagerNavigation.navigate('reports'));await small.waitForFunction(()=>document.querySelectorAll('.reports-owner-option').length===2);assert.notEqual(await small.locator('.reports-owner-picker').getAttribute('open'),null);assert.equal(await small.locator('.reports-owner-search-field').isHidden(),true);assert.equal(await small.locator('.reports-owner-option small').count(),0);await smallHost.screenshot({path:path.join(output,'controls-first-two-owners.png')});
    await integration.close();
    await fs.writeFile(path.join(output,'integration-verification.json'),JSON.stringify({checks:['available in normal Menu','actual navigation entry/leave','correct Menu header','legacy-source rejection'],liveRequestsExecuted:false,blockedOperational},null,2));
    assert.deepEqual(failures,[]);
    await fs.writeFile(path.join(output,'browser-verification.json'),JSON.stringify({viewports:['1280x900','393x650'],checks:['lazy libraries','multi-owner generation','two-page Dallas PDF','preview/download worker-byte identity','ZIP byte identity','date validation','immutable result period','zero activity','cancel/late-result rejection','leave cleanup','no horizontal overflow','no external requests','no page errors'],requests},null,2));
    t.diagnostic(`Output: ${output}`);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
