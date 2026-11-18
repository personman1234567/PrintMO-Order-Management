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

test('saved print batches review, rename and receive selected orders at desktop and phone widths', { timeout: 60000 }, async()=>{
 const fixture=`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/saved-sheet-prints.css"><body data-order-source="shopify" data-active-view="orders"><div class="order-workspace-tools"></div><script>
 window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 window.orders=[1,2].map(n=>({_candidate:true,_provider:'shopify',_gid:'gid://shopify/Order/'+n,_orderKey:'gid://shopify/Order/'+n,name:'#'+n+' Sample customer',printsOnSavedSheet:true,printsOrdered:0,printsStatus:0,productionStage:'blanks_ordered'}));
 window.getOrderManagerBoardSnapshot=()=>orders;window.confirm=()=>true;window.refreshOrderManagerNow=async()=>{};window.batches=[];
 window.api={printBatches:async(method,p)=>{if(method==='GET')return p.id?{batch:structuredClone(batches.find(b=>b.id===p.id))}:{batches:structuredClone(batches)};if(method==='POST'){const b={id:p.id,label:p.label||'Prints auto label',orderedDate:p.orderedDate,createdAt:new Date().toISOString(),mode:p.mode,revision:0,members:p.orders.map(o=>({...o,name:orders.find(x=>x._gid===o.orderKey).name,ordered:false,inHand:false}))};batches.push(b);return{batch:structuredClone(b)}}const b=batches.find(b=>b.id===p.id);b.revision++;if(p.action==='mark-ordered')b.members.forEach(m=>m.ordered=true);if(p.action==='metadata'){b.label=p.label;b.orderedDate=p.orderedDate}if(p.action==='receive')b.members.filter(m=>p.orderKeys.includes(m.orderKey)).forEach(m=>m.inHand=true);return{batch:structuredClone(b)}}};
 </script><script src="/material-batch-ui.js"></script><script src="/saved-sheet-prints.js"></script></body></html>`;
 const allowed=['material-batch-ui.js','saved-sheet-prints.js','saved-sheet-prints.css'];const server=http.createServer(async(req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(fixture)}const file=req.url.slice(1);if(!allowed.includes(file)){res.statusCode=404;return res.end()}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await fs.readFile(path.join(root,'order-manager-web',file)))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'printmo-material-batches-'));const browser=spawn(process.env.PRINTMO_BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});let cdp;
 try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Browser unavailable')),12000);browser.once('error',reject);browser.stderr.on('data',data=>{log+=data;const m=log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1])}})});
 const pages=await(await fetch(endpoint+'/json/list')).json();cdp=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=expression=>evaluate(`new Promise((resolve,reject)=>{let n=0;const check=()=>(${expression})?resolve():++n>200?reject(Error('Wait failed')):setTimeout(check,15);check()})`);
 const clickText=text=>evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.startsWith(${JSON.stringify(text)})).click()`);
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await wait('Boolean(document.getElementById("saved-sheet-prints-open"))');
 await evaluate('document.getElementById("saved-sheet-prints-open").click()');await wait('document.querySelectorAll("dialog[open] button").length>2');await clickText('Saved-sheet prints');await wait('Boolean(document.getElementById("material-batch-pick-title"))');
 assert.equal(await evaluate('[...document.querySelectorAll("dialog[open] input[type=checkbox]")].some(n=>n.checked)'),false);
 await evaluate(`document.querySelector('dialog[open] input[type=text]').value='Friday gang sheets';document.querySelector('dialog[open] input[type=date]').value='2026-11-12';document.querySelector('dialog[open] input[type=checkbox]').click()`);await clickText('Save batch');await wait('document.getElementById("saved-sheet-prints-title").textContent==="Friday gang sheets"');
 assert.equal(await evaluate('batches[0].members.length'),2);assert.equal(await evaluate('batches[0].orderedDate'),'2026-11-12');
 for(const width of [1440,393,320]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<900});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);assert.equal(await evaluate('document.querySelector("dialog[open]").getBoundingClientRect().width<=innerWidth'),true);}
 await evaluate('document.querySelectorAll("#saved-sheet-prints-dialog input[type=checkbox]")[1].click()');await clickText('Mark selected prints');await wait('batches[0].members[0].inHand');assert.equal(await evaluate('batches[0].members[1].inHand'),false);
 assert.equal(await evaluate('document.querySelectorAll("#saved-sheet-prints-dialog input[type=checkbox]")[1].disabled'),true);
 await clickText('Rename / ordered date');await wait('Boolean(document.getElementById("material-batch-pick-title"))');await evaluate(`document.querySelector('dialog[open] input[type=text]').value='Renamed batch';document.querySelector('dialog[open] input[type=date]').value='2026-11-11'`);await clickText('Save changes');await wait('batches[0].label==="Renamed batch"');assert.equal(await evaluate('batches[0].members.length'),2);
 await evaluate(`document.body.dataset.orderSource='legacy'`);await wait('!document.getElementById("saved-sheet-prints-dialog").open');assert.deepEqual(await evaluate('errors'),[]);
 }finally{cdp?.close();browser.kill(); browser.stderr?.destroy(); browser.unref();await new Promise(r=>server.close(r));}
});
