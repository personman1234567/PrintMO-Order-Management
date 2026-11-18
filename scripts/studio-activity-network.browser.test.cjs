const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch{}
const root=path.resolve(__dirname,'..'),web=path.resolve(process.env.STUDIO_NETWORK_WEB_ROOT||path.join(root,'order-manager-web'));
async function fixture(t,viewport={width:393,height:852}){
  const log=[],state={delay:15,cancelled:0,checkout:null};
  const now=new Date(),date=now.toISOString().slice(0,10),at=new Date(Date.now()-60000).toISOString();
  const identityPrefixes=Array.from({length:20},(_,i)=>'prompts/guest-'+i+'/');
  const art={key:identityPrefixes[0]+date+'/art.png',uploadedAt:at,customMetadata:{createdat:at,promptshort:'Test artwork',style:'vector'}};
  const json=(res,value)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  const api=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');log.push({method:req.method,path:url.pathname,prefix:url.searchParams.get('prefix'),delimiter:url.searchParams.get('delimiter'),at:Date.now()});
    res.setHeader('Access-Control-Allow-Origin',req.headers.origin||'*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','authorization,content-type');res.setHeader('Access-Control-Max-Age','86400');
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    res.on('close',()=>{if(!res.writableEnded)state.cancelled++;});
    await new Promise(resolve=>setTimeout(resolve,state.delay));
    if(url.pathname.endsWith('/storage/list')){
      const prefix=url.searchParams.get('prefix'),delimiter=url.searchParams.get('delimiter'),cursor=url.searchParams.get('cursor');
      if(prefix==='prompts/'&&delimiter)return json(res,{items:[],commonPrefixes:identityPrefixes,truncated:false});
      if(identityPrefixes.includes(prefix)&&delimiter){
        if(prefix===identityPrefixes[0]&&!cursor)return json(res,{items:[],commonPrefixes:[prefix+'1999-01-01/'],truncated:true,cursor:'folders-2'});
        return json(res,{items:[],commonPrefixes:prefix===identityPrefixes[0]?[prefix+date+'/']:[prefix+'1999-01-01/'],truncated:false});
      }
      return json(res,{items:art.key.startsWith(prefix)?[art]:[],truncated:false});
    }
    if(url.pathname.endsWith('/storage/uploads'))return json(res,{items:[],hasMore:false});
    if(url.pathname.endsWith('/storage/checkout-exports')){
      const meta={source:'studio-checkout',designref:'draft-42',workspaceid:'first-design',producttitle:'Checkout test tee',
        ...(state.checkout==='purchased'?{ordergid:'gid://shopify/Order/84',ordername:'#1084'}:{})};
      const items=state.checkout?[['mockup','proof.svg',''],['design','front.svg','front'],['design','back.svg','back']]
        .map(([role,filename,side],i)=>({id:'draft_'+String(i).padStart(32,'0'),filename,uploadedAt:at,contentType:'image/svg+xml',metadata:{...meta,role,side}})):[];
      return json(res,{items,hasMore:false,cursor:null});
    }
    if(url.pathname.endsWith('/read-ticket')){
      const id=url.pathname.split('/').at(-2);
      return json(res,{url:apiOrigin+'/checkout-file/'+id,expiresIn:60});
    }
    if(url.pathname.startsWith('/checkout-file/')){
      res.setHeader('Content-Type','image/svg+xml');
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#1765c1"/></svg>');
    }
    if(url.pathname.endsWith('/storage/object')){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');}
    if(url.pathname.endsWith('/studio-usage'))return json(res,{after:url.searchParams.get('after'),before:url.searchParams.get('before'),generatedAt:new Date().toISOString(),totals:{opens:1,localUploads:0,aiGenerations:0},artwork:{local:0,ai:0,library:0},cart:{starts:0,successes:0,failures:0,reasons:[],failureBuckets:[]},opensBuckets:[]});
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));const apiOrigin='http://127.0.0.1:'+api.address().port;
  const html=await fs.readFile(path.join(web,'index.html'),'utf8'),start=html.indexOf('  <section id="storage-view"'),end=html.indexOf('  <!-- Desktop retains',start);assert(start>=0&&end>start);
  const fragment=html.slice(start,end).replace('aria-hidden="true"','aria-hidden="false"');
  const boot="window.setActiveMobileTab=()=>{};window.shopify={idToken:async()=>'synthetic-test-token'};window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};";
  const document='<!doctype html><html><head><meta charset="UTF-8"><style>[hidden]{display:none!important}</style></head><body data-active-view="storage" data-order-source="shopify"><main>'+fragment+'</main><script>'+boot+'</script>'+['web-shim.js','workspace-navigation.js','studio-activity-model.js','storage-browser.js','studio-usage-model.js','studio-usage.js','accessibility-hardening.js'].map(file=>'<script src="/'+file+'"></script>').join('')+'</body></html>';
  const app=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(document);}const file=path.basename(new URL(req.url,'http://local').pathname);let source=await fs.readFile(path.join(web,file),'utf8');if(file==='web-shim.js')source=source.replace('https://order-manager-proxy.printmobusiness.workers.dev',apiOrigin);res.setHeader('Content-Type','text/javascript');res.end(source);}catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-gpu','--disable-background-networking']});
  const page=await browser.newPage({viewport,timezoneId:'America/Chicago'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin='http://127.0.0.1:'+app.address().port;
  const count=()=>log.filter(r=>r.method==='GET'&&r.path.endsWith('/storage/list')).length;
  t.after(async()=>{await browser.close();await Promise.all([new Promise(resolve=>app.close(resolve)),new Promise(resolve=>api.close(resolve))]);});
  return {page,origin,log,state,count,errors};
}
test('Studio listings discover existing dates instead of probing empty identity/date combinations',{timeout:45000},async t=>{
  if(!chromium)return t.skip('Provide installed Playwright via NODE_PATH.');const f=await fixture(t);await f.page.goto(f.origin);await f.page.locator('#storage-results[aria-busy="false"] .studio-entry').waitFor();
  const list=f.log.filter(r=>r.method==='GET'&&r.path.endsWith('/storage/list')),ai=list.filter(r=>r.prefix?.startsWith('prompts/')),dateProbes=ai.filter(r=>/^prompts\/guest-\d+\/\d{4}-\d{2}-\d{2}\/$/.test(r.prefix)&&!r.delimiter);
  const report={identities:20,listGets:list.length,aiListGets:ai.length,aiDateProbes:dateProbes.length,preflights:f.log.filter(r=>r.method==='OPTIONS').length,errors:f.errors};console.log('Studio network trace '+JSON.stringify(report));
  if(process.env.STUDIO_NETWORK_BASELINE==='1')return;
  assert.equal(dateProbes.length,1,'only the existing selected date folder is read');assert.equal(ai.length,23,'root + paginated identity folders + one selected date');assert.equal(await f.page.locator('.studio-entry').count(),1,'folder pagination preserves the artwork');
  const idle=f.count();await f.page.waitForTimeout(300);assert.equal(f.count(),idle,'settled gallery does not poll');assert.deepEqual(f.errors,[]);
});
test('Opening Usage or leaving Studio aborts gallery reads and stops queued work',{timeout:45000},async t=>{
  if(!chromium)return t.skip('Provide installed Playwright via NODE_PATH.');const f=await fixture(t);f.state.delay=250;await f.page.goto(f.origin);await f.page.waitForFunction(()=>window.StudioUsage&&document.getElementById('storage-results').getAttribute('aria-busy')==='true');
  await f.page.getByRole('button',{name:'Usage',exact:true}).click();await f.page.locator('#studio-usage[aria-busy="false"] .usage-metrics').first().waitFor();await f.page.waitForTimeout(100);const paused=f.count();await f.page.waitForTimeout(350);const continued=f.count()-paused;console.log('Studio Usage background listing trace '+JSON.stringify({continuedListingGets:continued}));
  if(process.env.STUDIO_NETWORK_BASELINE==='1')return;
  assert.equal(continued,0,'Usage must not continue fetching hidden gallery folders');assert(f.state.cancelled>0,'active gallery responses are cancelled, not just ignored');
  await f.page.getByRole('button',{name:'Creations',exact:true}).click();await f.page.waitForTimeout(35);await f.page.evaluate(()=>window.OrderManagerNavigation.navigate('orders'));await f.page.waitForTimeout(100);const left=f.count();await f.page.waitForTimeout(350);assert.equal(f.count(),left,'leaving Studio cancels queued gallery work');
  f.state.delay=1;await f.page.evaluate(()=>window.OrderManagerNavigation.navigate('storage'));await f.page.locator('#storage-results[aria-busy="false"] .studio-entry').waitFor();assert.equal(await f.page.locator('.studio-source-error').count(),0,'cancellation is not a source error');assert.equal(await f.page.locator('.studio-entry').count(),1,'reentry completes the interrupted listing');assert.deepEqual(f.errors,[]);
});

for (const viewport of [{width:393,height:852},{width:1440,height:900}]) {
  test('Studio Activity opens and downloads checkout artwork at '+viewport.width+'px',{timeout:30000},async t=>{
    if(!chromium)return t.skip('Provide installed Playwright via NODE_PATH.');
    const f=await fixture(t,viewport);f.page.setDefaultTimeout(6500);f.state.checkout='created';
    await f.page.goto(f.origin);
    await f.page.getByRole('button',{name:/^Checkout created: Checkout test tee/}).click();
    await f.page.locator('#storage-detail-image:not([hidden])').waitFor();
    await f.page.getByRole('button',{name:'Print artwork · back',exact:true}).click();
    await f.page.locator('#storage-detail-image:not([hidden])').waitFor();
    await f.page.locator('#storage-file-details > summary').click();
    const event=f.page.waitForEvent('download');
    await f.page.getByRole('button',{name:'Download file',exact:true}).click();
    assert.equal((await event).suggestedFilename(),'back.svg');
    const post=f.log.filter(entry=>entry.method==='POST'&&entry.path.endsWith('/read-ticket'));
    assert(post.some(entry=>entry.path.includes('draft_'+String(2).padStart(32,'0'))));
    await f.page.getByRole('button',{name:'Close creation detail',exact:true}).click();
    f.state.checkout='purchased';
    await f.page.getByRole('button',{name:'Refresh Studio activity',exact:true}).click();
    await f.page.getByRole('button',{name:/^Purchased: Checkout test tee/}).click();
    await f.page.waitForFunction(()=>document.getElementById('storage-detail-subtitle').textContent.includes('#1084'));
    assert.deepEqual(f.errors,[]);
  });
}
