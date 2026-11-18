/* Persisted print purchases. Production authority remains the canonical per-order Worker path. */
(() => {
  function setup() {
    const tools = document.querySelector('.order-workspace-tools'); if (!tools) return;
    const { make, pick } = window.materialBatchUi;
    const active = () => document.body.dataset.orderSource === 'shopify' && (!document.body.dataset.activeView || document.body.dataset.activeView === 'orders');
    const eligible = o => o?._candidate && o._provider === 'shopify' && !o._historyReadOnly && o._capabilities?.productionWrite !== false && o.productionStage !== 'completed' && o.displayFulfillmentStatus !== 'FULFILLED' && !Number(o.printsStatus);
    const snapshot = () => window.getOrderManagerBoardSnapshot?.() || [];
    const trigger = make('button', 'Print batches', 'saved-sheet-trigger'); trigger.id = 'saved-sheet-prints-open'; trigger.setAttribute('aria-haspopup','dialog'); tools.append(trigger);
    const dialog = make('dialog', undefined, 'saved-sheet-dialog material-batch-dialog'); dialog.id = 'saved-sheet-prints-dialog'; dialog.setAttribute('aria-labelledby','saved-sheet-prints-title');
    const heading = make('h2', 'Print batches'); heading.id = 'saved-sheet-prints-title'; const body = make('div');
    const status = make('p'); status.id = 'saved-sheet-prints-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    const footer = make('div', undefined, 'saved-sheet-actions'); const close = make('button', 'Done'); close.onclick = () => dialog.close(); footer.append(close); dialog.append(heading,body,status,footer); document.body.append(dialog);
    let busy = false, selected = null, entries = [], cursor = null, pending = null;
    function message(text) { status.textContent = text; }
    function button(text, fn, primary = false) { const b = make('button', text, primary ? 'saved-sheet-save' : ''); b.type='button'; b.onclick = () => task(fn); return b; }
    async function task(fn) { if (busy || !active()) return; busy=true; dialog.setAttribute('aria-busy','true'); const controls=[...dialog.querySelectorAll('button,input')].map(b=>[b,b.disabled]); controls.forEach(([b])=>b.disabled=true); try { await fn(); } catch(error) { message(error.message || 'The action could not finish. Refresh to review saved results.'); } finally { busy=false; dialog.removeAttribute('aria-busy'); controls.forEach(([b,disabled])=>{if(b.isConnected)b.disabled=disabled;}); sync(); } }
    function sync() { trigger.hidden = !active(); trigger.disabled = busy; if (!active() && dialog.open && !busy) dialog.close(); }
    async function refresh(append=false) { const r=await window.api.printBatches('GET',append && cursor ? {before:cursor} : {}); entries=append ? [...entries,...r.batches] : r.batches; cursor=r.cursor; selected=null; renderList(); }
    function renderList() {
      body.replaceChildren(); heading.textContent='Print batches'; const actions=make('div',undefined,'saved-sheet-actions');
      actions.append(button('Saved-sheet prints → Ordered',()=>create('saved-sheet'),true),button('Group already ordered prints',()=>create('ordered')),button('Refresh',()=>refresh())); body.append(actions);
      if(pending)body.append(button('Retry saving reviewed batch',savePending));
      if(!entries.length)body.append(make('p','No saved print batches yet. Save a batch when marking prints Ordered.'));
      for(const batch of entries){const b=button(batch.label,async()=>{selected=(await window.api.printBatches('GET',{id:batch.id})).batch; renderDetail();});b.className='material-batch-card'; const count=batch.members.filter(m=>m.inHand&&!m.removedAt).length; b.append(make('span',`${batch.orderedDate} · ${count}/${batch.members.length} orders’ prints In hand`));body.append(b);}
      if(cursor)body.append(button('Load older batches',()=>refresh(true)));
    }
    async function create(mode) {
      const orders=snapshot().filter(o=>eligible(o)&&(mode==='saved-sheet'?o.printsOnSavedSheet&&!Number(o.printsOrdered):Number(o.printsOrdered)));
      if(!orders.length){message(mode==='saved-sheet'?'No active orders have prints On saved sheet.':'No eligible ordered prints are available.');return;}
      dialog.close(); const choice=await pick({kind:'prints',orders,title:mode==='saved-sheet'?'Mark prints Ordered · save batch':'Group already ordered prints'}); if(!active())return;dialog.showModal();if(!choice)return;
      pending={id:`${Date.now()}-${crypto.randomUUID()}`,mode,label:choice.label,orderedDate:choice.orderedDate,orders:choice.orders.map(o=>({provider:o._provider,orderKey:o._orderKey||o._gid}))};await savePending();
    }
    async function savePending(){const result=await window.api.printBatches('POST',pending); selected=result.batch;pending=null; if(selected.mode==='saved-sheet')selected=(await window.api.printBatches('PATCH',{id:selected.id,action:'mark-ordered',expectedRevision:selected.revision})).batch; renderDetail();await refreshBoard();}
    async function refreshBoard(){try{await window.refreshOrderManagerNow?.();}catch{message('Batch saved. Board refresh is unavailable; refresh the board before further work.');}}
    function renderDetail(){
      body.replaceChildren(); heading.textContent=selected.label;
      body.append(make('p',`Ordered ${selected.orderedDate} · ${selected.members.length} customer orders`),make('p',`Recorded ${new Date(selected.createdAt).toLocaleString('en-US',{timeZone:'America/Chicago'})}`));
      const checks=[]; const allRow=make('label',undefined,'saved-sheet-row'); const all=make('input');all.type='checkbox';allRow.append(all,make('span','Select all remaining orders'));body.append(allRow);
      for(const m of selected.members){const row=make('label',undefined,'saved-sheet-row');const check=make('input');check.type='checkbox';check.disabled=m.inHand||Boolean(m.removedAt);const text=make('span');text.append(make('strong',m.name),make('span',m.removedAt?'Removed from batch':m.inHand?'In hand':m.ordered?'Ordered':'Ordering needs confirmation'));if(m.message)text.append(make('span',m.message));row.append(check,text);body.append(row);if(!m.inHand&&!m.removedAt)checks.push({check,m});}
      all.onchange=()=>checks.forEach(({check})=>{check.checked=all.checked;});
      const actions=make('div',undefined,'saved-sheet-actions');
      actions.append(button('All batches',()=>refresh()),button('Rename / ordered date',async()=>{dialog.close();const change=await pick({kind:'prints',orders:[],batch:selected,title:'Edit print batch'});if(!active())return;dialog.showModal();if(change){selected=(await window.api.printBatches('PATCH',{id:selected.id,action:'metadata',expectedRevision:selected.revision,...change,orders:undefined})).batch;renderDetail();}}),button('Refresh batch',async()=>{selected=(await window.api.printBatches('GET',{id:selected.id})).batch;renderDetail();}));
      if(selected.members.some(m=>!m.ordered&&!m.removedAt))actions.append(button('Finish marking Ordered',async()=>{if(!window.confirm('Retry unresolved ordering saves using the orders’ current print status?'))return;selected=(await window.api.printBatches('PATCH',{id:selected.id,action:'mark-ordered',expectedRevision:selected.revision,retryReviewed:true})).batch;renderDetail();await refreshBoard();}));
      if(checks.length)actions.append(button('Mark selected prints In hand',async()=>{const ids=checks.filter(x=>x.check.checked).map(x=>x.m.orderKey);if(!ids.length){message('Select the orders whose complete set of prints arrived.');return;}if(!window.confirm(`Mark the complete usable set of prints for ${ids.length} selected customer orders In hand?\n\n${selected.label}\n\nLeave orders with missing prints unchecked.`))return;selected=(await window.api.printBatches('PATCH',{id:selected.id,action:'receive',expectedRevision:selected.revision,orderKeys:ids,confirmComplete:true,retryReviewed:true})).batch;renderDetail();message(`${selected.members.filter(m=>m.inHand).length}/${selected.members.length} orders’ prints In hand. ${selected.members.some(m=>m.message)?'Review the unresolved orders above.':''}`);await refreshBoard();},true));
      if(checks.length)actions.append(button('Remove selected from batch',async()=>{const ids=checks.filter(x=>x.check.checked).map(x=>x.m.orderKey);if(!ids.length){message('Select the orders to remove.');return;}if(!window.confirm('Remove '+ids.length+' selected orders from this batch? Their print status stays unchanged. You can then group them into the correct purchase.'))return;selected=(await window.api.printBatches('PATCH',{id:selected.id,action:'remove',expectedRevision:selected.revision,orderKeys:ids})).batch;renderDetail();}));
      body.append(actions); message('Receiving changes print readiness only. Leave partially received print sets Ordered.');
    }
    trigger.onclick=()=>{if(!active()||busy)return;dialog.showModal();message('Loading saved batches…');task(()=>refresh());};
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>trigger.focus());
    document.addEventListener('printmo:board-updated',sync);new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-order-source','data-active-view']});sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
