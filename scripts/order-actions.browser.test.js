const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const edge = process.env.PRINTMO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const assets = ['order-board-model.js', 'order-action-model.js', 'order-actions.js', 'order-actions.css', 'accessibility-hardening.css'];
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/order-actions.css"><link rel="stylesheet" href="/accessibility-hardening.css">
<style>*{box-sizing:border-box}body{margin:20px;font:16px system-ui}article{position:relative;padding:20px;margin:12px;border:1px solid #cbd5e1;max-width:580px}.native a,.native input,.native button{margin:4px}.native{display:flex;flex-wrap:wrap;gap:8px}</style></head>
<body data-order-source="shopify"><h1>Synthetic order actions fixture</h1>
<a id="global-link" href="#global">Global native link</a>
<article id="first" class="card" tabindex="0"><span>First synthetic order</span><div class="native"><input value="Editable synthetic text"><textarea rows="1">Synthetic editor</textarea><select><option>Synthetic choice</option></select><a href="#example">Example link</a><div id="image-container" class="mockup-slot"><img width="24" height="24" alt="Synthetic image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath fill='blue' d='M0 0h24v24H0z'/%3E%3C/svg%3E"></div><button>Native button</button><span contenteditable="true">Editable synthetic content</span><span id="selection">Selectable synthetic text</span></div></article>
<article id="second" class="card" tabindex="0"><span>Second synthetic order</span></article><article id="history" class="card" tabindex="0"><span>Read-only synthetic order</span></article><article id="etsy" class="card" tabindex="0"><span>Etsy synthetic order</span></article>
<article id="move-fixture" class="card"><span>Synthetic directional controls</span><div class="card-a11y-move-controls"><button id="move-back" type="button" data-move-direction="back">Move back</button><button id="move-forward" type="button" data-move-direction="forward">Move forward</button></div></article>
<section id="detail-overlay" hidden><button id="progress-custom">Custom amount</button><input id="progress-input" aria-label="Printed count"></section>
<script src="/order-board-model.js"></script><script src="/order-action-model.js"></script>
<script>
window.orders = ['a','b','history'].map((id,index)=>({_candidate:true,_provider:'shopify',_orderKey:'shopify:'+id,
 name:'#'+(100+index)+' – Synthetic person',productionStage:'print',_historyReadOnly:id==='history',_capabilities:{productionWrite:true},
 canonical:{id:'shopify:'+id,displayName:'#'+(100+index),source:{provider:'shopify',displayNumber:'#'+(100+index)},
 customer:{displayName:'Synthetic person '+id},commerce:{lineItemsComplete:true,lineItems:[{id:id+'-line',title:'Synthetic shirt',quantity:2,variantTitle:'Black / M'}]}}}));
orders.push({...orders[1],_provider:'etsy',_orderKey:'etsy:fixture:1',canonical:{...orders[1].canonical,source:{provider:'etsy',displayNumber:'ETSY-1'}}});
window.selectedKeys = [OrderBoardModel.orderKey(orders[0])]; window.reviewCalls=[];window.removeCalls=[];window.archivedKeys=[];
window.fixturePrintableTotal=2;window.getOrderManagerBoardSnapshot=()=>orders;window.printablePieceTotal=()=>fixturePrintableTotal;window.orderIsVisibleOnOperationalBoard=()=>true;
window.OrderManagerViews={workflowState:()=>({busy:false}),actions:()=>[{value:'move:received',label:'Move to Pipeline',enabled:true}],
 reviewOrders:async(keys,value)=>{reviewCalls.push({keys,value});return {results:keys.map(key=>({key,outcome:'saved'}))};}};
window.removeOrderFromBoard=async order=>{removeCalls.push(OrderBoardModel.orderKey(order));if(confirm('Remove '+order.name+' from the board?'))archivedKeys.push(OrderBoardModel.orderKey(order));};
window.confirmResult=false;window.confirm=()=>confirmResult;
window.detailOrder=null;window.countClicks=0;window.hydrationResult=undefined;window.waitHydration=false;
window.openOrderManagerDetail=order=>{window.detailOrder=order;const overlay=document.getElementById('detail-overlay');overlay.hidden=false;overlay.classList.add('visible');return true;};
window.OrderActionsDetailReady=()=>waitHydration?new Promise(resolve=>window.hydrationResolve=resolve):hydrationResult;
document.getElementById('progress-custom').addEventListener('click',()=>{countClicks++;});
window.clipboardCalls=[];window.clipboardMode='pending';
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>{clipboardCalls.push(text);return new Promise((resolve,reject)=>{window.clipboardResolve=resolve;window.clipboardReject=()=>reject(new Error('Synthetic denial'));});}}});
</script><script src="/order-actions.js"></script><script>
['first','second','history','etsy'].forEach((id,index)=>OrderActions.attach(document.getElementById(id),OrderBoardModel.orderKey(orders[index])));
window.fixtureReady=true;
</script></body></html>`;

async function connection(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (!value.id) return;
    const item = pending.get(value.id); if (!item) return;
    pending.delete(value.id); clearTimeout(item.timer);
    value.error ? item.reject(new Error(JSON.stringify(value.error))) : item.resolve(value.result);
  });
  return {
    send(method, params = {}) { return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 8000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    }); },
    close() { socket.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser closed')); } pending.clear(); }
  };
}

test('actual browser: shared order actions preserve native behavior, target identity and clipboard truth', { timeout: 60000 }, async t => {
  const accessibilitySource = await fs.readFile(path.join(root, 'order-manager-web', 'accessibility-hardening.js'), 'utf8');
  assert.match(accessibilitySource, /button\.dataset\.moveDirection\s*=\s*direction\s*<\s*0\s*\?\s*'back'\s*:\s*'forward'/,
    'actual accessibility factory tags back/forward controls for the responsive CSS');
  await fs.access(edge);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'printmo-order-actions-edge-'));
  const screenshots = process.env.PRINTMO_ACTION_SCREENSHOTS;
  if (screenshots) await fs.mkdir(screenshots, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(fixture); }
      const file = String(req.url).slice(1);
      if (!assets.includes(file)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await fs.readFile(path.join(root, 'order-manager-web', file)));
    } catch (error) { res.statusCode = 500; res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, origin], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error(`Edge did not expose DevTools: ${stderr.slice(-1800)}`)), 12000);
      browser.once('error', error => { clearTimeout(timer); reject(error); });
      browser.once('exit', code => { clearTimeout(timer); reject(new Error(`Edge exited before DevTools: ${code}; ${stderr.slice(-1800)}`)); });
      browser.stderr.on('data', data => { stderr += data; const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
    });
    const pages = await (await fetch(`${endpoint}/json/list`)).json();
    cdp = await connection(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    t.diagnostic(`Browser: ${(await cdp.send('Browser.getVersion')).product}`);
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
      return result.result.value;
    };
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: origin });
    await evaluate(`new Promise((resolve,reject)=>{let tries=0;const check=()=>window.fixtureReady?resolve(true):++tries>300?reject(new Error('Fixture not ready')):setTimeout(check,20);check();})`);
    const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const open = async id => {
      await evaluate(`(()=>{const card=document.getElementById('${id}');if(innerWidth<=600)card.querySelector('.order-action-trigger').click();else card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:80,clientY:200}));})()`); await flush();
    };
    const clickItem = async label => { await evaluate(`(()=>{const item=[...document.querySelectorAll('#order-action-menu [role="menuitem"]')].find(node=>!node.closest('[hidden]')&&node.querySelector('span').textContent.startsWith(${JSON.stringify(label)}));if(!item)throw new Error('Missing item '+${JSON.stringify(label)});item.click();})()`); await flush(); };
    const key = async (value, modifiers = 0) => {
      const code = { Enter: 13, F10: 121, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 }[value] || 0;
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value, modifiers, windowsVirtualKeyCode: code, ...(value === 'Enter' ? { text: '\r' } : {}) });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value, modifiers, windowsVirtualKeyCode: code }); await flush();
    };
    const isOpen = () => evaluate('OrderActions.isOpen()');
    const primaryItemState = label => evaluate(`(()=>{const item=[...document.querySelector('.order-action-panel').querySelectorAll('[role="menuitem"]')].find(node=>node.querySelector('span')?.textContent.startsWith(${JSON.stringify(label)}));return item?{disabled:item.getAttribute('aria-disabled')==='true',reason:item.querySelector('small')?.textContent.trim()||''}:null;})()`);

    await open('first'); await clickItem('Copy'); await clickItem('Order number');
    assert.equal(await evaluate('clipboardCalls.at(-1)'), '#100');
    assert.equal(await isOpen(), true, 'copy stays open until clipboard resolves');
    assert.notEqual(await evaluate('document.querySelector(".order-action-status")?.textContent'), 'Copied.');
    await evaluate('clipboardResolve()'); await flush();
    assert.equal(await isOpen(), false); assert.equal(await evaluate('document.querySelector(".order-action-status").textContent'), 'Copied.');

    await open('first'); await clickItem('Copy');
    const beforeUnavailable = await evaluate('clipboardCalls.length');
    await clickItem('Email');
    assert.equal(await evaluate('clipboardCalls.length'), beforeUnavailable, 'unloaded email never reaches clipboard');
    assert.match(await evaluate('[...document.querySelectorAll(".order-action-submenu [role=menuitem]")].find(node=>node.querySelector("span").textContent==="Email").textContent'), /not loaded/);
    await key('Escape'); await key('Escape');

    await open('first'); await clickItem('Copy'); await clickItem('Customer name');
    await evaluate('clipboardReject()'); await flush();
    assert.equal(await isOpen(), true, 'denial keeps a retry route');
    assert.match(await evaluate('document.querySelector(".order-action-status").textContent'), /^Could not copy/);
    assert.equal(await evaluate('document.querySelector(".order-action-status").classList.contains("is-error")'), true);
    await key('Escape'); assert.equal(await isOpen(), true, 'first Escape closes submenu only');
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), true);
    await key('Escape'); assert.equal(await isOpen(), false);

    await evaluate('document.getElementById("first").focus()');
    await key('F10', 8); assert.equal(await isOpen(), true, 'Shift+F10 opens shared menu');
    await key('ArrowRight');
    assert.equal(await evaluate('document.activeElement.querySelector("span")?.textContent'), 'Order number', 'arrow navigation reaches order number');
    await key('Enter');
    assert.equal(await evaluate('clipboardCalls.at(-1)'), '#100', 'keyboard Copy activates order-number command');
    await evaluate('clipboardResolve()'); await flush();
    assert.equal(await evaluate('document.activeElement.id'), 'first', 'keyboard close restores visible card focus');

    await evaluate(`OrderActions.rememberDetail(orders[0],{detail:{data:{customer:{email:'first@synthetic.test'}}}})`);
    await open('first'); await clickItem('Copy'); await clickItem('Email');
    assert.equal(await evaluate('clipboardCalls.at(-1)'), 'first@synthetic.test');
    await evaluate('clipboardResolve()'); await flush();
    await evaluate(`orders[0].canonical.shopifyUpdatedAt='2026-11-02T13:00:00Z';orders[0].email='stale@synthetic.test';orders[0].canonicalDetail={detail:{data:{customer:{email:'unstamped@synthetic.test'}}}}`);
    await open('first'); await clickItem('Copy');
    const beforeInvalidated = await evaluate('clipboardCalls.length');
    await clickItem('Email');
    assert.equal(await evaluate('clipboardCalls.length'), beforeInvalidated, 'contact-only summary update invalidates cached email and unstamped detail');
    await key('Escape'); await key('Escape');
    await evaluate(`OrderActions.rememberDetail(orders[0],{detail:{data:{customer:{email:'latest@synthetic.test'}}}})`);
    await open('first'); await clickItem('Copy'); await clickItem('Email');
    assert.equal(await evaluate('clipboardCalls.at(-1)'), 'latest@synthetic.test', 'fresh remembered detail restores latest contact copy');
    await evaluate('clipboardResolve()'); await flush();
    await evaluate(`OrderActions.rememberDetail(orders[0],{detail:{data:{customer:{email:null}}}})`);
    await open('first'); await clickItem('Copy');
    const beforeNull = await evaluate('clipboardCalls.length');
    await clickItem('Email');
    assert.equal(await evaluate('clipboardCalls.length'), beforeNull, 'latest explicit null never resurrects a previous contact value');
    await key('Escape'); await key('Escape');

    await open('first'); await clickItem('Edit printed count');
    assert.equal(await evaluate('countClicks'), 0, 'undefined hydration cannot open count editor');
    await evaluate('waitHydration=true'); await open('first'); await clickItem('Edit printed count');
    await evaluate(`document.getElementById('detail-overlay').classList.remove('visible');document.getElementById('detail-overlay').hidden=true;hydrationResolve({ok:true})`); await flush();
    assert.equal(await evaluate('countClicks'), 0, 'closing detail during hydration cannot reopen count editor');
    await evaluate('waitHydration=false;hydrationResult={ok:true}'); await open('first'); await clickItem('Edit printed count');
    assert.equal(await evaluate('countClicks'), 1, 'successful current visible hydration enters count editor');
    assert.equal(await evaluate('document.activeElement.id'), 'progress-input');
    await evaluate(`document.getElementById('detail-overlay').classList.remove('visible');document.getElementById('detail-overlay').hidden=true;detailOrder=null`);

    await evaluate('fixturePrintableTotal=0'); await open('first');
    const zeroCount = await primaryItemState('Edit printed count');
    assert.ok(zeroCount?.disabled && zeroCount.reason, 'print stage with zero printable pieces retains disabled count action and reason');
    await clickItem('Edit printed count');
    assert.equal(await evaluate('countClicks'), 1, 'disabled zero-piece action does not enter count editor');
    await key('Escape');
    await evaluate('fixturePrintableTotal=2;orders[0]._eligibilityMutationPending=true'); await open('first');
    const pendingCount = await primaryItemState('Edit printed count');
    assert.ok(pendingCount?.disabled && pendingCount.reason, 'pending print eligibility retains disabled count action and reason');
    await clickItem('Edit printed count');
    assert.equal(await evaluate('countClicks'), 1, 'pending eligibility cannot enter count editor');
    await key('Escape');
    await evaluate('orders[0]._eligibilityMutationPending=false'); await open('first');
    assert.equal((await primaryItemState('Edit printed count'))?.disabled, false, 'normal printable print stage enables count editor');
    await key('Escape');
    await evaluate('savedActions=OrderManagerViews.actions;OrderManagerViews.actions=()=>[]'); await open('first');
    const unavailableMove = await primaryItemState('Move production stage');
    assert.ok(unavailableMove?.disabled && unavailableMove.reason, 'empty stage choices retain disabled Move action with reason');
    await key('Escape'); await evaluate('OrderManagerViews.actions=savedActions');

    for (const selector of ['input', 'textarea', 'select', '[contenteditable]']) {
      const prevented = await evaluate(`(()=>{const target=document.querySelector('#first ${selector}');const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});target.dispatchEvent(event);return event.defaultPrevented;})()`);
      assert.equal(prevented, false, `native ${selector} context preserved`); assert.equal(await isOpen(), false);
      assert.equal(await evaluate(`(()=>{const event=new KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true,cancelable:true});document.querySelector('#first ${selector}').dispatchEvent(event);return event.defaultPrevented;})()`), false, `native ${selector} keyboard context preserved`);
      assert.equal(await isOpen(), false);
    }
    assert.equal(await evaluate(`(()=>{const range=document.createRange();range.selectNodeContents(document.getElementById('selection'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:80,clientY:200});document.getElementById('selection').dispatchEvent(event);const prevented=event.defaultPrevented;selection.removeAllRanges();return prevented;})()`), true, 'ordinary selected card text opens custom context');
    assert.equal(await isOpen(), true); await key('Escape');
    assert.equal(await evaluate(`(()=>{const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.getElementById('global-link').dispatchEvent(event);return event.defaultPrevented;})()`), false, 'global link retains native context');
    for (const selector of ['img', '#image-container', 'a', '.native button']) {
      assert.equal(await evaluate(`(()=>{const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:80,clientY:200});document.querySelector('#first ${selector}').dispatchEvent(event);return event.defaultPrevented;})()`), true, `card ${selector} opens custom context`);
      assert.equal(await isOpen(), true); await key('Escape');
    }

    await evaluate(`orders[1].productionStage='received'`); await open('second');
    assert.equal(await evaluate('[...document.querySelectorAll("#order-action-menu [role=menuitem] span")].some(node=>node.textContent.startsWith("Edit printed count"))'), false, 'received stage offers no printed count edit');
    await key('Escape'); await evaluate(`orders[1].productionStage='print'`);

    const selected = await evaluate('JSON.stringify(selectedKeys)');
    await evaluate(`document.querySelector('#second > span').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:1590,clientY:890}))`); await flush();
    assert.equal(await evaluate('document.querySelector(".order-action-heading").textContent'), 'Shopify #101');
    assert.equal(await evaluate('(()=>{const r=document.getElementById("order-action-menu").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()'), true, 'context menu clamps near bottom-right edge');
    await clickItem('Move production stage'); await clickItem('Move to Pipeline');
    assert.deepEqual(await evaluate('reviewCalls.at(-1).keys'), [await evaluate('OrderBoardModel.orderKey(orders[1])')]);
    assert.equal(await evaluate('JSON.stringify(selectedKeys)'), selected, 'clicked target does not alter checkbox selection');

    await open('second');
    assert.equal(await evaluate('[...document.querySelectorAll("#order-action-menu [role=menuitem] span")].some(node=>node.textContent.startsWith("Remove from board"))'), false, 'Shopify order never offers removal');
    await key('Escape');
    await open('etsy'); await clickItem('Remove from board');
    assert.equal(await evaluate('removeCalls.length'), 1); assert.equal(await evaluate('archivedKeys.length'), 0, 'existing handler cancellation respected');
    await evaluate('confirmResult=true'); await open('etsy'); await clickItem('Remove from board');
    assert.deepEqual(await evaluate('archivedKeys'), [await evaluate('OrderBoardModel.orderKey(orders[3])')]);
    await evaluate("orders[3]._provider='unknown'");
    await evaluate('OrderActions.open(OrderBoardModel.orderKey(orders[3]))');
    assert.equal(await evaluate('[...document.querySelectorAll("#order-action-menu [role=menuitem] span")].some(node=>node.textContent.startsWith("Remove from board"))'), false, 'unknown provider never offers removal');
    await key('Escape'); await evaluate("orders[3]._provider='etsy'");
    await open('history');
    assert.equal(await evaluate('[...document.querySelectorAll("#order-action-menu [role=menuitem] span")].some(node=>node.textContent.startsWith("Remove from board"))'), false, 'read-only order offers no removal');
    assert.equal(await evaluate('[...document.querySelectorAll("#order-action-menu [role=menuitem] span")].some(node=>node.textContent.startsWith("Edit printed count"))'), false, 'read-only order offers no printed-count mutation');
    await key('Escape');

    const pointer = async (x, y) => { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await flush(); };
    const waitHover = () => evaluate('new Promise(resolve=>setTimeout(()=>resolve(true),280))');
    await pointer(1500, 850); await open('first');
    const copyPoint = await evaluate('(()=>{const r=document.querySelector("[data-copy-trigger]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
    assert.ok(await evaluate('document.querySelector("[data-copy-trigger]").querySelector("svg, .order-action-chevron") || /[›▶→]/.test(document.querySelector("[data-copy-trigger]").textContent)'), 'Copy exposes a visual flyout chevron');
    await pointer(copyPoint.x, copyPoint.y); await waitHover();
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), false, 'mouse hover opens Copy flyout');
    const flyout = await evaluate('(()=>{const a=document.querySelector(".order-action-panel").getBoundingClientRect(),b=document.querySelector(".order-action-submenu").getBoundingClientRect();return {primary:{left:a.left,right:a.right,top:a.top,bottom:a.bottom},child:{left:b.left,right:b.right,top:b.top,bottom:b.bottom}};})()');
    const gapX = flyout.child.left >= flyout.primary.right ? (flyout.primary.right + flyout.child.left) / 2 : (flyout.child.right + flyout.primary.left) / 2;
    assert.ok(flyout.child.left >= flyout.primary.right - 1 || flyout.child.right <= flyout.primary.left + 1, 'desktop child is a real adjacent flyout');
    assert.ok(Math.abs(flyout.child.top - copyPoint.y) < 50, 'flyout aligns to Copy row');
    await pointer(gapX, copyPoint.y); await waitHover();
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), false, 'flyout remains available while crossing hover gap');
    await pointer((flyout.child.left + flyout.child.right) / 2, Math.max(flyout.child.top + 15, copyPoint.y)); await waitHover();
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), false, 'flyout remains available while pointer is inside');
    await pointer(1500, 850); await waitHover();
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), true, 'leaving Copy and flyout closes child after grace period');
    assert.equal(await isOpen(), true, 'hover exit retains primary context menu');
    await evaluate('document.querySelector("[data-copy-trigger]").focus()'); await key('ArrowRight');
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), false, 'keyboard Right opens immediately');
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").getAnimations().some(animation=>animation.playState==="running")'), false, 'keyboard flyout has no running entrance motion');
    await key('ArrowLeft');
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), true, 'keyboard Left immediately returns to Copy');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await pointer(copyPoint.x, copyPoint.y);
    assert.equal(await evaluate('document.querySelector(".order-action-submenu").getAnimations().some(animation=>animation.playState==="running")'), false, 'reduced-motion hover avoids entrance motion');
    await key('ArrowLeft');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await key('Escape');

    for (const width of [1600, 393]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await flush();
      assert.equal(await evaluate('getComputedStyle(document.querySelector("#first .order-action-trigger")).display === "none"'), width > 600, 'desktop Actions hidden; mobile Actions retained');
      await open('first'); await clickItem('Copy');
      const bounds = await evaluate('(()=>{const r=document.getElementById("order-action-menu").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()');
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.top >= 0 && bounds.bottom <= bounds.height + 1, `menu contained at ${width}px: ${JSON.stringify(bounds)}`);
      assert.equal(await evaluate('[...document.querySelectorAll(".order-action-panel")].filter(panel=>!panel.hidden).every(panel=>{const r=panel.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;})'), true, `all visible panels contained at ${width}px`);
      assert.equal(await evaluate('[...document.querySelectorAll(".order-action-panel")].filter(panel=>!panel.hidden).every(panel=>panel.scrollWidth<=panel.clientWidth+1)'), true, `no horizontal panel scrollbar at ${width}px`);
      assert.equal(await evaluate('document.querySelector(".order-action-panel").hidden'), width < 600, 'mobile Copy uses one panel');
      assert.equal(await evaluate('[...document.querySelectorAll(".order-action-submenu [role=menuitem] span")].some(node=>node.textContent==="Back")'), width < 600, 'Back is mobile-only');
      if (width < 600) {
        await clickItem('Back');
        assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), true, 'mobile Back restores primary actions');
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
        const point = await evaluate('(()=>{const r=document.querySelector("[data-copy-trigger]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await flush();
        assert.equal(await evaluate('document.querySelector(".order-action-submenu").hidden'), false, 'mobile tap enters Copy without hover');
      }
      if (screenshots) {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const target = path.join(screenshots, `order-actions-${width}.png`); await fs.writeFile(target, Buffer.from(shot.data, 'base64')); t.diagnostic(`Screenshot: ${target}`);
      }
      await key('Escape'); assert.equal(await isOpen(), true); await key('Escape'); assert.equal(await isOpen(), false);
    }
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    for (const width of [1600, 901, 900, 393]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await evaluate('document.getElementById("move-forward").focus()'); await flush();
      const controls = await evaluate('(()=>{const back=document.getElementById("move-back"),forward=document.getElementById("move-forward");return {backWidth:back.getBoundingClientRect().width,forwardEnabled:!forward.disabled,forwardFocused:document.activeElement===forward,forwardWidth:forward.getBoundingClientRect().width};})()');
      assert.equal(controls.backWidth === 0, width >= 901, `Move back is hidden only on desktop at ${width}px`);
      assert.equal(controls.forwardWidth === 0, width >= 901, `Move forward is hidden only on desktop at ${width}px`);
      if (width <= 900) assert.equal(controls.forwardEnabled && controls.forwardFocused, true, `Mobile move forward stays operable at ${width}px`);
    }
  } finally {
    cdp?.close(); browser.kill();
    await new Promise(resolve => server.close(resolve));
    // This is the exact mkdtemp-created profile, confined to the OS temp directory.
    if (path.dirname(profile) === path.resolve(os.tmpdir())) await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
