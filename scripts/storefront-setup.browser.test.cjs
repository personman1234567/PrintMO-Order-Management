const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
let chromium; try { ({ chromium } = require('playwright')); } catch {}
const web = path.resolve(__dirname, '../order-manager-web');
const gid = (kind, value) => `gid://shopify/${kind}/${value}`;
test('storefront planning saves across reloads, preserves failed/conflicting edits, guards leaving and handles real catalog pages', { timeout: 90000 }, async t => {
  if (!chromium) return t.skip('Provide installed Playwright via NODE_PATH.');
  const output = process.env.PRINTMO_SETUP_UI_OUTPUT || path.resolve(__dirname, '../tmp/storefront-setup-ui'); await fs.mkdir(output, { recursive: true });
  const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}#storefront-setup-view{height:100dvh}</style><link rel="stylesheet" href="/storefront-setup.css"></head><body data-order-source="shopify" data-active-view="storefronts"><section id="storefront-setup-view"><header class="storefront-setup-heading"><h2>Storefronts</h2></header><div id="storefront-setup-root"></div></section><script>
    window.calls=[];window.mode='ok';window.navigateCalls=[];window.saved=JSON.parse(localStorage.getItem('fixture-draft')||'null');
    const store={id:'gid://shopify/Collection/481089487096',title:'Dallas fixture',handle:'dallas-fixture',partnerId:'gid://shopify/Metaobject/11',configuredOwner:{id:'dr-dallas'}};
    window.api={
      getStorefrontSetupAccess:async()=>({ready:true,missing:[]}),
      getStorefrontSetupExecution:async()=>window.execution||({state:'not-created'}),
      executeStorefrontSetup:async(id,input)=>{window.executionInput=input;if(window.mode==='execute-fail')throw Object.assign(new Error('Shopify did not confirm this action. Retry the same draft.'),{status:503,code:'SETUP_SHOPIFY_UNAVAILABLE'});window.execution={state:'complete',revision:window.saved.revision,product:{title:'Fixture first shirt',status:'DRAFT',adminUrl:'https://admin.shopify.com/store/fixture/products/90'},branding:{status:'DRAFT'},message:'Nothing was published.'};return window.execution;},
      stageStorefrontSetupUpload:async(id,input)=>{window.uploadInput=input;return{id:input.id,target:{url:location.origin+'/fixture-upload',parameters:[{name:'key',value:'fixture'}]}};},
      finishStorefrontSetupUpload:async()=>({state:'READY',url:'https://cdn.shopify.com/fixture-upload.png'}),
      getStorefrontSetupCollections:async()=>({collections:[store,{id:'gid://shopify/Collection/99',title:'Unrelated catalog',partnerId:null}],hasNextPage:false}),
      getStorefrontSetupProducts:async()=>({collection:store,products:[{id:'gid://shopify/Product/12',title:'Existing merchandise',status:'ACTIVE',handle:'existing-fixture'}],hasNextPage:false}),
      getStorefrontSetupDrafts:async()=>({drafts:window.saved?[{...window.saved,title:window.saved.draft.title}]:[]}),
      getStorefrontSetupDraft:async()=>structuredClone(window.saved),
      saveStorefrontSetupDraft:async payload=>{window.calls.push(structuredClone(payload));if(window.mode==='fail')throw new Error('Network');if(window.mode==='conflict')throw Object.assign(new Error('Conflict'),{status:409,code:'REVISION_CONFLICT'});window.saved={id:'draft-fixture',revision:(window.saved?.revision||0)+1,draft:structuredClone(payload.draft),createdAt:'2026-11-12T10:00:00Z',updatedAt:'2026-11-12T10:01:00Z'};localStorage.setItem('fixture-draft',JSON.stringify(window.saved));return structuredClone(window.saved);},
      searchStorefrontSetupCatalog:async()=>({products:[{id:'gid://shopify/Product/22',title:'Verified garment fixture',status:'ACTIVE'}],hasNextPage:false}),
      getStorefrontSetupCatalogProduct:async(productId,options)=>({product:{id:productId,title:'Verified garment fixture',variants:options.after?[{id:'gid://shopify/ProductVariant/32',title:'Black / XL',price:'8.00'}]:[{id:'gid://shopify/ProductVariant/31',title:'White / M',price:'7.00'}]},hasNextPage:!options.after,endCursor:options.after?'':'second'})
    };
    window.StorefrontReports={selectOwner:id=>{window.reportOwner=id;}};window.OrderManagerNavigation={navigate:view=>window.navigateCalls.push(view)};
    </script><script type="module">import{mountStorefrontSetup}from'/storefront-setup-workspace.mjs';window.hooks=await mountStorefrontSetup({root:document.getElementById('storefront-setup-root')});await window.hooks.onEnter();window.ready=true;</script></body></html>`;
  const server = http.createServer(async (req,res) => {
    try { if(req.url==='/fixture-upload'){req.resume();res.writeHead(204);return res.end();} if (req.url === '/fixture') { res.setHeader('Content-Type','text/html'); return res.end(fixture); }
      const file=path.resolve(web, '.' + new URL(req.url,'http://localhost').pathname); if (!file.startsWith(web+path.sep)) {res.writeHead(403);return res.end();}
      res.setHeader('Content-Type',path.extname(file)==='.css'?'text/css':'text/javascript');res.end(await fs.readFile(file));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({executablePath:process.env.PRINTMO_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-gpu','--disable-background-networking']});
  try {
    for(const viewport of [{width:1280,height:900},{width:390,height:660}]) {
      const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
      await page.goto(origin+'/fixture');await page.waitForFunction(()=>window.ready);
      await page.getByRole('button',{name:'Open storefront →'}).click();await page.getByText('Existing merchandise',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Open Storefront Reports ↗'}).click();assert.equal(await page.evaluate(()=>window.reportOwner),'dr-dallas');assert.deepEqual(await page.evaluate(()=>window.navigateCalls),['reports']);
      await page.getByRole('button',{name:'← All storefronts'}).click();
      await page.getByRole('button',{name:'+ Set up storefront'}).click();
      await page.locator('[data-field="title"]').fill('New partner fixture');await page.locator('[data-field="owner.name"]').fill('Fixture partner');await page.locator('[data-field="owner.approver"]').fill('Fixture approver');
      await page.getByRole('button',{name:'Save setup plan',exact:true}).click();await page.getByText('Setup plan saved. No Shopify changes were made.').waitFor();
      await page.getByRole('button',{name:'Products',exact:true}).click();await page.locator('[data-field="product.title"]').fill('Fixture first shirt');await page.locator('[name="catalog-query"]').fill('garment');await page.getByRole('button',{name:'Search catalog',exact:true}).click();await page.getByRole('button',{name:'Choose garment'}).click();
      await page.locator('[data-variant="gid://shopify/ProductVariant/31"]').check();await page.locator('[data-price="gid://shopify/ProductVariant/31"]').fill('19.97');await page.getByRole('button',{name:'Load more garment options'}).click();await page.locator('[data-variant="gid://shopify/ProductVariant/32"]').waitFor();assert(await page.locator('[data-variant="gid://shopify/ProductVariant/31"]').isChecked());
      await page.getByRole('button',{name:'+ Add image link'}).click();await page.locator('[data-field="product.photos.0.url"]').fill('https://example.com/unsafe.png');await page.getByRole('button',{name:'Save setup plan',exact:true}).click();await page.getByText('Use HTTPS image links from cdn.shopify.com for every image.').waitFor();await page.getByRole('button',{name:'Remove photo'}).click();
      await page.evaluate(()=>window.mode='fail');await page.getByRole('button',{name:'Save setup plan',exact:true}).click();await page.getByRole('button',{name:'Retry save'}).waitFor();assert.equal(await page.locator('[data-field="product.title"]').inputValue(),'Fixture first shirt');
      await page.evaluate(()=>window.mode='ok');await page.getByRole('button',{name:'Retry save'}).click();await page.getByText('Setup plan saved. No Shopify changes were made.').waitFor();
      const retries=await page.evaluate(()=>window.calls.slice(-2));assert.equal(retries[0].idempotencyKey,retries[1].idempotencyKey);assert.equal(retries[1].draft.product.retailPrices['gid://shopify/ProductVariant/31'],1997);
      await page.reload();await page.waitForFunction(()=>window.ready);await page.getByRole('button',{name:'Continue setup →'}).click();await page.getByRole('button',{name:'Products',exact:true}).click();assert.equal(await page.locator('[data-field="product.title"]').inputValue(),'Fixture first shirt');
      // Exercise the new Shopify-draft action through the actual controller: failed execution retains the plan,
      // and a retry sends only the reviewed revision plus the explicit draft-only acknowledgement.
      await page.evaluate(()=>window.mode='execute-fail');page.once('dialog',dialog=>dialog.accept());
      await page.getByRole('button',{name:'Create Shopify drafts',exact:true}).click();await page.getByText('Shopify did not confirm this action. Retry the same draft.').waitFor();
      assert.equal(await page.locator('[data-field="product.title"]').inputValue(),'Fixture first shirt');
      await page.evaluate(()=>window.mode='ok');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Create Shopify drafts',exact:true}).click();
      await page.getByRole('link',{name:'Review product in Shopify ↗'}).waitFor();assert.equal(await page.evaluate(()=>window.executionInput.confirmDraftOnly),true);assert.equal(await page.evaluate(()=>window.executionInput.expectedRevision===window.saved.revision),true);
      await page.locator('[data-upload="product"]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hAAAAABJRU5ErkJggg==','base64')});
      await page.getByText('Image uploaded. Save the plan to keep this assignment.').waitFor();assert.equal(await page.locator('[data-field="product.photos.0.url"]').inputValue(),'https://cdn.shopify.com/fixture-upload.png');
      await page.locator('[data-field="product.title"]').fill('Unsaved conflict title');await page.evaluate(()=>window.mode='conflict');await page.getByRole('button',{name:'Save setup plan',exact:true}).click();await page.getByRole('button',{name:'Copy my entries'}).waitFor();assert.equal(await page.locator('[data-field="product.title"]').inputValue(),'Unsaved conflict title');
      await page.getByRole('button',{name:'Copy my entries'}).click();assert.match(await page.getByLabel('Unsaved setup plan').inputValue(),/Unsaved conflict title/);await page.getByRole('button',{name:'Close',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.hooks.canLeave({resume:()=>window.navigateCalls.push('orders')})),false);await page.getByRole('button',{name:'Stay here'}).click();assert.equal(await page.locator('[data-field="product.title"]').inputValue(),'Unsaved conflict title');
      await page.getByRole('button',{name:'← All storefronts'}).click();await page.getByRole('button',{name:'Discard edits'}).click();await page.getByRole('button',{name:'Continue setup →'}).waitFor();
      await page.getByRole('button',{name:'Continue setup →'}).click();await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.locator('[data-field="owner.approver"]').fill('Changed approver');await page.evaluate(()=>window.mode='ok');await page.getByRole('button',{name:'← All storefronts'}).click();await page.getByRole('button',{name:'Save and leave'}).click();await page.getByRole('button',{name:'Continue setup →'}).waitFor();
      await page.getByRole('button',{name:'Continue setup →'}).click();await page.getByRole('button',{name:'Products',exact:true}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert(await page.evaluate(()=>document.querySelector('.setup-scroll').clientHeight>0));
      await page.screenshot({path:path.join(output,viewport.width===1280?'desktop.png':'mobile.png'),fullPage:true});
      await page.evaluate(()=>{window.hooks.onLeave();document.body.dataset.orderSource='legacy';window.ready=false;window.api.getStorefrontSetupCollections=()=>{throw new Error('source gate failed')};return window.hooks.onEnter();});assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
