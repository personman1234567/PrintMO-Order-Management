const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const clone = value => JSON.parse(JSON.stringify(value));
const gid = value => /^gid:\/\/shopify\/[A-Za-z]+\/\d+$/.test(value || '');
const imageUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'cdn.shopify.com' && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const blank = () => ({ version: 1, title: '', owner: { name: '', approver: '', email: '' }, appearance: { logoUrl: '', desktopBannerUrl: '', mobileBannerUrl: '', background: '#ffffff', text: '#172033', primary: '#1765c1', secondary: '#dbeafe' }, product: { title: '', designName: '', sourceProductId: '', selectedVariantIds: [], retailPrices: {}, photos: [], notes: '' }, launch: { approvalNote: '', checkNotes: '' } });
const failure = error => {
  if (error?.status === 401 || /AUTH|TOKEN|SESSION/.test(error?.code || '')) return 'Your session expired. Reopen Order Manager, then try again. Your unsaved entries remain here.';
  if (error?.code?.startsWith('SETUP_') && error?.message) return error.message;
  if (error?.status === 403) return 'This session cannot access storefront setup.';
  if (error?.status === 409 || /CONFLICT|REVISION/.test(error?.code || '')) return 'Another session changed this setup plan. Your entries are kept. Copy them before loading the saved version.';
  return error?.status === 400 ? 'Check the setup fields and image links, then save again.' : 'The request could not finish. Check your connection, then retry. Your entries are kept.';
};
export async function mountStorefrontSetup({ root, mode = "legacy", initialDraftId = null, apiOverride = null, onClose = null, onCreated = null }) {
  const win = root.ownerDocument.defaultView, doc = root.ownerDocument;
  let active = false, generation = 0, controller, page = 'list', tab = 'overview', current = null, saved = null, dirty = false, saving = false, pendingSave = null;
  let collections = [], drafts = [], selectedCollection = null, existingProducts = [], collectionCursor = '', collectionsMore = false, productCursor = '', productsMore = false;
  let catalogResults = [], catalog = null, catalogCursor = '', catalogMore = false, searchCursor = '', searchMore = false, searchQuery = '', catalogGeneration = 0;
  let status = '', error = '', conflict = false, busy = false, leaveAction = null, preview = false;
  let draftListMore = false;
  let recordGeneration = 0;
  let setupAccess = null, execution = null, working = false, pendingUpload = null;
  const api = () => apiOverride || win.api;
  const field = (label, name, value, type = 'text', extra = '') => `<label class="setup-field">${escapeHtml(label)}<input type="${type}" data-field="${name}" value="${escapeHtml(value)}" ${extra}></label>`;
  const area = (label, name, value) => `<label class="setup-field">${escapeHtml(label)}<textarea rows="4" data-field="${name}">${escapeHtml(value)}</textarea></label>`;
  const button = (label, action, primary = false, extra = '') => `<button type="button" data-action="${action}" class="${primary ? 'setup-primary' : ''}" ${extra}>${label}</button>`;
  const uploadInput = (label, target) => `<label class="setup-field">${label}<input type="file" data-upload="${target}" accept="image/png,image/jpeg,image/webp" ${working ? 'disabled' : ''}></label>`;
  const safeImage = (url, alt, cls = '') => imageUrl(url) ? `<img class="${cls}" src="${escapeHtml(imageUrl(url))}" alt="${escapeHtml(alt)}" loading="lazy">` : '';
  const source = () => document.body.dataset.orderSource === 'shopify';
  function requestOptions() { return { signal: controller?.signal }; }
  async function run(work, update, { quiet = false } = {}) {
    const token = generation;
    if (!quiet) { busy = true; error = ''; render(); }
    try { const response = await work(); if (active && token === generation) { update(response); return response; } }
    catch (cause) { if (active && token === generation && cause?.name !== 'AbortError') { error = failure(cause); status = ''; } }
    finally { if (active && token === generation) { if (!quiet) busy = false; render(); } }
  }
  function changed() { dirty = true; pendingSave = null; status = ''; error = ''; conflict = false; updateSaveState(); }
  function updateSaveState() {
    root.querySelectorAll('[data-save-status]').forEach(node => { node.textContent = saving ? 'Saving…' : dirty ? 'Unsaved changes' : current?.updatedAt ? `Saved ${new Date(current.updatedAt).toLocaleString()}` : 'Not saved yet'; });
    root.querySelectorAll('[data-action="save"]').forEach(node => { node.disabled = saving || working || !dirty; });
  }
  function summary() {
    const draft = current.draft;
    return `<aside class="setup-summary"><div class="setup-panel setup-preview"><p class="setup-eyebrow">Setup plan preview</p>${safeImage(draft.appearance.logoUrl, 'Planned partner logo', 'setup-logo')}<h3>${escapeHtml(draft.owner.name || draft.title || 'Your storefront')}</h3><p>${escapeHtml(draft.product.title || 'Your first product')}</p>${safeImage(draft.product.photos[0]?.url, 'Planned product photo', 'setup-product-image')}<p class="setup-muted">Planning only. The live storefront has not changed.</p></div><div class="setup-note">Save a plan at any point. Create unpublished Shopify drafts when the saved plan is ready. Live branding and publication stay separate.</div></aside>`;
  }
  function listPage() {
    return `<div class="setup-title-row"><div><p class="setup-eyebrow">Your storefront workspace</p><h2>Storefronts</h2><p class="setup-muted">Review existing merchandise or save a plan for your next storefront.</p></div>${button('+ Set up storefront', 'new', true)}</div>
      <section aria-labelledby="setup-existing"><div class="setup-section-head"><h3 id="setup-existing">Existing storefronts</h3>${button('Refresh', 'refresh')}</div><div class="setup-list">${collections.map((store, index) => `<div class="setup-store setup-panel"><div><span class="setup-pill">Shopify collection</span><h3>${escapeHtml(store.title)}</h3><p class="setup-muted">Read from Shopify · ${escapeHtml(store.handle || '')}</p></div>${button('Open storefront →', 'open-collection', false, `data-index="${index}"`)}</div>`).join('') || `<p class="setup-empty">${busy ? 'Loading storefronts…' : 'No existing storefronts were returned.'}</p>`}</div>${collectionsMore ? button('Load more storefronts', 'more-collections') : ''}</section>
      <section aria-labelledby="setup-saved"><div class="setup-section-head"><h3 id="setup-saved">Saved setup plans</h3><span class="setup-muted">Private to staff</span></div><div class="setup-list">${drafts.map((draft, index) => `<div class="setup-store setup-panel"><div><span class="setup-pill setup-pill-blue">Setup plan</span><h3>${escapeHtml(draft.title || 'Untitled setup')}</h3><p class="setup-muted">${draft.updatedAt ? escapeHtml(new Date(draft.updatedAt).toLocaleString()) : 'Saved'}</p></div>${button('Continue setup →', 'open-draft', false, `data-index="${index}"`)}</div>`).join('') || '<p class="setup-empty">No saved plans yet. Start with a storefront name, then save your progress.</p>'}</div>${draftListMore ? '<p class="setup-note">Only the most recent setup plans are shown.</p>' : ''}</section>`;
  }
  function existingPage() {
    const configured = selectedCollection.configuredOwner?.id || (/\/(481089487096)$/.test(selectedCollection.id) ? 'dr-dallas' : '');
    return `${button('← All storefronts', 'back')}<div class="setup-title-row"><div><span class="setup-pill">Shopify collection</span><h2>${escapeHtml(selectedCollection.title)}</h2><p class="setup-muted">Current Shopify merchandise. Setup plans are saved separately.</p></div>${button('Plan changes', 'plan-existing', true)}</div><div class="setup-panel setup-panel-pad"><div class="setup-section-head"><h3>Products in this storefront</h3><span>${existingProducts.length} loaded</span></div><div class="setup-product-list">${existingProducts.map(product => `<article class="setup-live-product">${safeImage(product.image?.url || product.image || product.featuredImage?.url, product.title)}<div><h3>${escapeHtml(product.title)}</h3><p class="setup-muted">${escapeHtml(product.status || 'Status unavailable')}</p></div>${product.handle ? `<a href="https://print-mo.com/products/${encodeURIComponent(product.handle)}" target="_blank" rel="noopener noreferrer">View product ↗</a>` : ''}</article>`).join('') || `<p>${busy ? 'Loading products…' : 'No merchandise returned for this collection.'}</p>`}</div>${productsMore ? button('Load more products', 'more-products') : ''}</div><div class="setup-readiness"><section class="setup-panel setup-panel-pad"><h3>Storefront Reports</h3><p>${configured ? 'This owner is configured for the existing reports workspace.' : 'Reporting configuration has not been verified for this storefront.'}</p>${configured ? button('Open Storefront Reports ↗', 'reports', false, `data-owner="${escapeHtml(configured)}"`) : ''}</section><section class="setup-panel setup-panel-pad"><h3>Payment setup</h3><p>Review the exact vendor and payment status in QuickBooks. Setup plans do not verify or initiate payments.</p></section></div>`;
  }
  function overviewPage() {
    const draft = current.draft;
    const missing = !draft.owner.name ? 'Add the owner and appearance details.' : !draft.product.title ? 'Plan the first product.' : !draft.product.sourceProductId ? 'Choose the catalog garment.' : !draft.product.selectedVariantIds.length ? 'Choose the offered options.' : 'Review your launch notes and save your progress.';
    return `<div class="setup-next"><p class="setup-eyebrow">Your next task</p><h3>${escapeHtml(missing)}</h3><p>Keep the decisions, source garment and prepared image links together.</p>${button('Continue setup →', !draft.owner.name ? 'tab-appearance' : !draft.product.sourceProductId || !draft.product.selectedVariantIds.length ? 'tab-products' : 'tab-checks', true)}</div><div class="setup-panel setup-task-list">${[['Owner & appearance', draft.owner.name ? 'Owner name recorded · review appearance and approver' : 'Add the public name and final approver', 'appearance'], ['First product', draft.product.title || 'Choose a design and source garment', 'products'], ['Launch checks', 'Save specific approval and verification notes', 'checks']].map(([title, text, target]) => `<button type="button" class="setup-task" data-action="tab-${target}"><span><strong>${title}</strong><small>${escapeHtml(text)}</small></span><span aria-hidden="true">→</span></button>`).join('')}</div><div class="setup-note">Reporting and payment readiness stay separate. A saved setup plan does not configure a reporting owner, create merchandise or approve publication.</div>`;
  }
  function appearancePage() {
    const d = current.draft;
    return `<section class="setup-panel setup-panel-pad"><h3>Owner & appearance</h3>${button('Load current Shopify branding', 'load-branding', false, !current.id || !current.draft.partnerId ? 'disabled' : '')}<p class="setup-muted">Record the proposed presentation. These fields save to your setup plan.</p>${field('Setup plan name', 'title', d.title, 'text', 'maxlength="160" required')}${field('Public storefront name', 'owner.name', d.owner.name, 'text', 'maxlength="160"')}${field('Final approver', 'owner.approver', d.owner.approver, 'text', 'maxlength="160"')}${field('Approver email (optional)', 'owner.email', d.owner.email, 'email')}
      <div class="setup-divider"></div><h3>Prepared images</h3><p class="setup-muted">Paste existing HTTPS image links from cdn.shopify.com. Or upload PNG, JPEG and WebP images below (up to 20 MB).</p>${field('Logo image URL', 'appearance.logoUrl', d.appearance.logoUrl, 'url')}${field('Desktop banner URL', 'appearance.desktopBannerUrl', d.appearance.desktopBannerUrl, 'url')}${field('Mobile banner URL (optional)', 'appearance.mobileBannerUrl', d.appearance.mobileBannerUrl, 'url')}<div class="setup-colors">${[['background', 'Background'], ['text', 'Text'], ['primary', 'Primary accent'], ['secondary', 'Secondary accent']].map(([key, label]) => field(label, `appearance.${key}`, d.appearance[key], 'color')).join('')}</div>${uploadInput('Upload logo', 'appearance.logoUrl')}${uploadInput('Upload desktop banner', 'appearance.desktopBannerUrl')}${uploadInput('Upload mobile banner', 'appearance.mobileBannerUrl')}</section>`;
  }
  function variantTitle(variant) { return variant.title || variant.selectedOptions?.map(option => option.value).join(' / ') || variant.id; }
  function productsPage() {
    const p = current.draft.product;
    return `<section class="setup-panel setup-panel-pad"><p class="setup-muted">Choose a garment, set prices and add photos. Create the product as an unpublished draft when ready.</p>${field('Product name', 'product.title', p.title, 'text', 'maxlength="200"')}${field('Design name or version', 'product.designName', p.designName, 'text', 'maxlength="200"')}<div class="setup-source"><div><strong>Catalog garment</strong><p>${escapeHtml(catalog?.title || (p.sourceProductId ? 'Saved garment reference' : 'No garment selected'))}</p>${p.sourceProductId ? `<small>Saved catalog source reference</small>` : ''}</div></div>
      <div class="setup-search"><label class="setup-field">Find a catalog garment<input type="search" name="catalog-query" value="${escapeHtml(searchQuery)}" placeholder="Name, brand or style"></label>${button('Search catalog', 'search-catalog')}</div><div class="setup-catalog-results">${catalogResults.map((product, index) => `<div class="setup-catalog-result"><span><strong>${escapeHtml(product.title)}</strong><small>${escapeHtml(product.status || '')}</small></span>${button('Choose garment', 'choose-catalog', false, `data-index="${index}"`)}</div>`).join('')}${searchMore ? button('Load more catalog results', 'more-catalog-search') : ''}</div>
      ${catalog ? `<div class="setup-divider"></div><label class="setup-field">Printing<select data-field="product.printType"><option value="">Choose printing</option>${[['chest','Chest print'],['full-front','Full front print'],['hat','Front hat print']].map(([value,label])=>`<option value="${value}" ${p.printType===value?'selected':''}>${label}</option>`).join('')}</select></label><h3>Offered options & retail prices</h3><p class="setup-muted">Choose actual catalog variants. Retail prices are your proposed selling prices, in USD. They are not reporting deductions.</p><div class="setup-variants">${(catalog.variants || []).map(variant => `<div class="setup-variant"><label><input type="checkbox" data-variant="${escapeHtml(variant.id)}" ${p.selectedVariantIds.includes(variant.id) ? 'checked' : ''}><span>${escapeHtml(variantTitle(variant))}<small>Catalog price: ${variant.price == null ? 'Unavailable' : escapeHtml(typeof variant.price === 'object' ? variant.price.amount : variant.price)}</small></span></label><label>Proposed retail (USD)<input type="number" min="0" step="0.01" data-price="${escapeHtml(variant.id)}" value="${p.retailPrices[variant.id] == null ? '' : (p.retailPrices[variant.id] / 100).toFixed(2)}" aria-label="Proposed retail for ${escapeHtml(variantTitle(variant))}"></label></div>`).join('')}</div>${catalogMore ? `<p class="setup-note">More garment variants remain. Load them before you finish choosing options.</p>${button('Load more garment options', 'more-variants')}` : ''}${p.selectedVariantIds.some(value => !catalog.variants.some(variant => variant.id === value)) ? '<p class="setup-note">Some saved options are not in the loaded catalog page. They remain saved; load more to review them.</p>' : ''}` : p.sourceProductId ? '<p class="setup-note">Catalog details are not loaded. Retry opening the saved garment to review its options.</p>' + button('Load saved garment', 'load-source') : ''}
      <div class="setup-divider"></div><h3>Prepared product photos</h3>${uploadInput('Upload product photo (PNG, JPEG or WebP)', 'product')}<p class="setup-muted">Save existing Shopify image links with their color and view assignment.</p>${p.photos.map((photo, index) => `<div class="setup-photo">${safeImage(photo.url, `${photo.color || 'Product'} ${photo.view || 'photo'}`)}<div>${field('Image URL', `product.photos.${index}.url`, photo.url, 'url')}${field('Color', `product.photos.${index}.color`, photo.color)}${field('View', `product.photos.${index}.view`, photo.view)}</div>${button('Remove photo', 'remove-photo', false, `data-index="${index}"`)}</div>`).join('')}${p.photos.length < 20 ? button('+ Add image link', 'add-photo') : ''}${area('Product and source notes', 'product.notes', p.notes)}</section>`;
  }
  function checksPage() { return `<section class="setup-panel setup-panel-pad"><h3>Launch checks</h3><p>Keep approval and verification evidence with the setup plan. Notes do not automatically verify a live storefront.</p>${area('Owner approval: who, when and exactly what was approved', 'launch.approvalNote', current.draft.launch.approvalNote)}${area('Storefront, product, cart and mobile checks: evidence and remaining work', 'launch.checkNotes', current.draft.launch.checkNotes)}<div class="setup-note">Before publication, review the actual artwork, offered options, prices, arrangement, product visibility, cart and mobile behavior. Create Shopify drafts below for review. Publication remains a separate action in Shopify.</div></section>`; }
  function executionPanel() {
    const ready = setupAccess?.ready;
    const link = (label, value) => value?.adminUrl ? `<a href="${escapeHtml(value.adminUrl)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : '';
    return `<section class="setup-panel setup-panel-pad setup-execution"><h3>Shopify drafts</h3><p>Creates a separate draft branding record and an unpublished product. Your current storefront stays unchanged.</p>
      ${!ready ? '<p>Enable product, branding and image access for this workspace.</p>' + button('Enable Shopify setup access', 'enable-access') + button('Check access', 'check-access') : '<p class="setup-muted">Shopify setup access is connected.</p>'}
      ${execution?.product ? `<p><strong>Product draft:</strong> ${escapeHtml(execution.product.title)} · ${escapeHtml(execution.product.status)}</p>${link('Review product in Shopify', execution.product)}` : ''}
      ${execution?.branding ? `<p><strong>Branding draft:</strong> ${escapeHtml(execution.branding.status)}</p>${link('Review branding in Shopify', execution.branding)}` : ''}
      ${execution?.revision && execution.revision !== current.revision ? '<p class="setup-note">The Shopify result belongs to an earlier saved revision. Review your changes before updating the drafts.</p>' : ''}
      ${execution?.message ? `<p role="status">${escapeHtml(execution.message)}</p>` : ''}
      ${button(working ? 'Working…' : execution?.product ? 'Update Shopify drafts' : 'Create Shopify drafts', 'review-execution', true, !ready || working ? 'disabled' : '')}
      ${pendingUpload ? button('Retry image upload', 'retry-upload', false, working ? 'disabled' : '') : ''}
      <p class="setup-muted">Saving a plan and creating Shopify drafts are separate. Reports and payments are unchanged.</p></section>`;
  }
  function editorPage() {
    const d = current.draft;
    if(mode==='product')return `<header class="manage-header">${button('← Products','close-product')}<div><h2>Add product</h2><p>${escapeHtml(d.owner.name)}</p></div></header>${productsPage()}<footer class="setup-footer"><span data-save-status></span>${button('Save for later','save',false,saving||working?'disabled':'')}${button(working?'Creating…':'Create product draft','review-execution',true,saving||working?'disabled':'')}</footer>`;

    return `${button('← All storefronts', 'back')}<div class="setup-title-row"><div><div class="setup-title-line"><h2>${escapeHtml(d.title || 'New storefront setup')}</h2><span class="setup-pill setup-pill-blue">Setup plan</span></div><p class="setup-muted" data-save-status></p></div>${button('Preview plan', 'preview')}</div><nav class="setup-tabs" aria-label="This setup plan">${[['overview', 'Overview'], ['products', 'Products'], ['appearance', 'Appearance'], ['checks', 'Launch checks']].map(([key, label]) => `<button type="button" data-action="tab-${key}" ${tab === key ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav><div class="setup-edit-layout"><main>${({ overview: overviewPage, products: productsPage, appearance: appearancePage, checks: checksPage })[tab]()}${executionPanel()}</main>${summary()}</div><footer class="setup-footer"><span data-save-status></span>${button(saving ? 'Saving…' : 'Save setup plan', 'save', true, saving || !dirty ? 'disabled' : '')}</footer>`;
  }
  function render() {
    if (!active) return;
    const oldScroll = root.querySelector('.setup-scroll')?.scrollTop || 0;
    root.innerHTML = `<div class="setup-scroll"><div class="setup-content">${error ? `<div class="setup-error" role="alert"><p>${escapeHtml(error)}</p>${conflict ? `${button('Copy my entries', 'copy')}${button('Load saved version', 'reload-conflict')}` : button(page === 'editor' && dirty ? 'Retry save' : 'Retry', page === 'editor' && dirty ? 'save' : 'retry')}</div>` : ''}${status ? `<p class="setup-status" role="status">${escapeHtml(status)}</p>` : ''}${busy ? '<p class="setup-loading" role="status">Loading…</p>' : ''}${page === 'list' ? listPage() : page === 'existing' ? existingPage() : editorPage()}</div></div><dialog class="setup-dialog" data-dialog="leave" aria-labelledby="setup-leave-title"><h2 id="setup-leave-title">${mode==='product'?'Save this product for later?':'Save your setup plan?'}</h2><p>You have unsaved changes. Save before leaving or discard the edits.</p><p class="setup-dialog-error" role="alert"></p><div>${button('Stay here', 'stay')}${button('Discard edits', 'discard')}${button('Save and leave', 'save-leave', true)}</div></dialog><dialog class="setup-dialog" data-dialog="preview" aria-labelledby="setup-preview-title"><div class="setup-section-head"><h2 id="setup-preview-title">Setup plan preview</h2>${button('Close preview', 'close-preview')}</div>${current ? summary() : ''}</dialog><dialog class="setup-dialog" data-dialog="copy" aria-labelledby="setup-copy-title"><h2 id="setup-copy-title">Keep your unsaved entries</h2><p>Copy this setup plan before loading the saved version.</p><textarea rows="10" readonly aria-label="Unsaved setup plan">${escapeHtml(current ? JSON.stringify(current.draft, null, 2) : '')}</textarea>${button('Close', 'close-copy')}</dialog>`;
    if(mode==='product'){root.classList.add('manage-product-mode');const header=root.querySelector('.manage-header'),footer=root.querySelector('.setup-footer');if(header)root.prepend(header);if(footer)root.append(footer);}
    root.querySelector('.setup-scroll').scrollTop = oldScroll;
    updateSaveState();
    if(working) root.querySelectorAll('input,textarea').forEach(node=>{node.disabled=true;});
  }
  async function loadLists() {
    await run(async () => {
      const results = await Promise.allSettled([api().getStorefrontSetupCollections(requestOptions()), api().getStorefrontSetupDrafts(requestOptions())]);
      return results;
    }, results => {
      if (results[0].status === 'fulfilled') { const data = results[0].value; collections = (data.collections || []).filter(store => store.partnerId); collectionsMore = Boolean(data.hasNextPage); collectionCursor = data.endCursor || ''; }
      if (results[1].status === 'fulfilled') { drafts = results[1].value.drafts || []; draftListMore = Boolean(results[1].value.hasMore); }
      const failed = results.find(result => result.status === 'rejected'); if (failed) error = failure(failed.reason);
    });
  }
  function setCurrent(response) {
    execution = null; pendingUpload = null;
    const base = blank(), value = response.draft || {};
    const draft = { ...base, ...value, owner: { ...base.owner, ...value.owner }, appearance: { ...base.appearance, ...value.appearance }, product: { ...base.product, ...value.product }, launch: { ...base.launch, ...value.launch } };
    current = { ...response, draft }; saved = clone(current); dirty = false; pendingSave = null; conflict = false; catalog = null; catalogResults = []; page = 'editor'; tab = 'overview'; error = '';
  }
  function guarded(action) {
    if (!dirty && !saving) { action(); return; }
    leaveAction = action; root.querySelector('[data-dialog="leave"]').showModal();
  }
  async function save() {
    if (saving || !current) return false;
    const d = current.draft;
    if (!d.title.trim()) { error = 'Give this setup plan a name before saving.'; render(); return false; }
    const urls = [d.appearance.logoUrl, d.appearance.desktopBannerUrl, d.appearance.mobileBannerUrl, ...d.product.photos.map(photo => photo.url)];
    if (urls.some(value => value && !imageUrl(value))) { error = 'Use HTTPS image links from cdn.shopify.com for every image.'; render(); return false; }
    if (d.product.photos.some(photo => !photo.url)) { error = 'Add an image URL or remove the empty photo before saving.'; render(); return false; }
    if (d.owner.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.owner.email)) { error = 'Enter a valid approver email or leave it empty.'; render(); return false; }
    if (!pendingSave) pendingSave = { id: current.id || undefined, expectedRevision: current.revision ?? 0, idempotencyKey: id(), draft: clone(d) };
    const payload = pendingSave, token = generation, editingDraft = current;
    saving = true; error = ''; status = ''; render();
    try {
      const response = await api().saveStorefrontSetupDraft(payload, requestOptions());
      if (!active || token !== generation || current !== editingDraft) return false;
      const unchanged = JSON.stringify(current.draft) === JSON.stringify(payload.draft);
      current.id = response.id; current.revision = response.revision; current.updatedAt = response.updatedAt; current.createdAt = response.createdAt;
      saved = { ...response, draft: clone(response.draft || payload.draft) }; dirty = !unchanged; pendingSave = null; conflict = false; status = mode==='product'?'Product entries saved for later. No Shopify product has been created by this save.':'Setup plan saved. No Shopify changes were made.';
      const item = { id: response.id, revision: response.revision, title: payload.draft.title, collectionId: payload.draft.collectionId, updatedAt: response.updatedAt, createdAt: response.createdAt };
      drafts = [item, ...drafts.filter(draft => draft.id !== item.id)]; if(!setupAccess && api().getStorefrontSetupAccess) void loadExecution(); return !dirty;
    } catch (cause) {
      if (active && token === generation && cause?.name !== 'AbortError') { error = failure(cause); conflict = cause?.status === 409 || /CONFLICT|REVISION/.test(cause?.code || ''); }
      return false;
    } finally { saving = false; if (active && token === generation) render(); }
  }
  async function loadSource(after = '') {
    const productId = current?.draft.product.sourceProductId; if (!productId) return;
    const local = ++catalogGeneration;
    await run(() => api().getStorefrontSetupCatalogProduct(productId, { after, ...requestOptions() }), data => {
      if (local !== catalogGeneration || productId !== current?.draft.product.sourceProductId) return;
      catalog = after && catalog?.id === data.product.id ? { ...data.product, variants: [...catalog.variants, ...(data.product.variants || []).filter(variant => !catalog.variants.some(old => old.id === variant.id))] } : data.product;
      catalogMore = Boolean(data.hasNextPage); catalogCursor = data.endCursor || '';
    });
  }
  async function openDraft(draftId) { const record = ++recordGeneration; await run(() => api().getStorefrontSetupDraft(draftId, requestOptions()), data => { if (record === recordGeneration) setCurrent(data); }); if (record === recordGeneration && current?.draft.product.sourceProductId) await loadSource(); if(record === recordGeneration) await loadExecution(); }
  async function loadProducts(after = '') { const storeId = selectedCollection.id; await run(() => api().getStorefrontSetupProducts(storeId, { after, ...requestOptions() }), data => { if (storeId !== selectedCollection?.id) return; selectedCollection = { ...selectedCollection, ...data.collection }; existingProducts = after ? [...existingProducts, ...(data.products || [])] : data.products || []; productsMore = Boolean(data.hasNextPage); productCursor = data.endCursor || ''; }); }
  async function loadExecution() {
    if (!current?.id || !api().getStorefrontSetupAccess) return;
    const token = recordGeneration, planId = current.id;
    try { const results = await Promise.all([api().getStorefrontSetupAccess(requestOptions()), api().getStorefrontSetupExecution(planId, requestOptions())]);
      if (active && token === recordGeneration && current?.id === planId) { [setupAccess, execution] = results; render(); }
    } catch (cause) { if(active && token === recordGeneration) { error = failure(cause); render(); } }
  }
  async function uploadImage() {
    if (working || !pendingUpload) return;
    if (dirty && !await save()) return;
    if (!current?.id) { error = 'Save this setup plan before uploading an image.'; render(); return; }
    const upload = pendingUpload, plan = current;
    working = true; error = ''; status = 'Uploading image to Shopify…'; render();
    try {
      if (!upload.uploaded) {
        const staged = await api().stageStorefrontSetupUpload(current.id, { id:upload.id, mimeType:upload.file.type, size:upload.file.size }, requestOptions());
        const form = new win.FormData(); for(const parameter of staged.target.parameters) form.append(parameter.name, parameter.value); form.append('file', upload.file);
        const response = await win.fetch(staged.target.url, {method:'POST', body:form, signal:controller?.signal}); if(!response.ok) throw new Error('Image transfer failed'); upload.uploaded = true;
      }
      for(let i=0;i<12;i++) {
        const response = await api().finishStorefrontSetupUpload(current.id, upload.id, requestOptions());
        if(response.url) {
          if(current !== plan) return;
          if(upload.field === 'product') current.draft.product.photos.push({id:upload.id,url:response.url,color:'',view:'Front'});
          else { const key = upload.field.split('.').pop(); current.draft.appearance[key] = response.url; }
          pendingUpload = null; changed(); status = 'Image uploaded. Save the plan to keep this assignment.'; return;
        }
        await new Promise(resolve=>win.setTimeout(resolve,1500));
      }
      status = 'Shopify is still processing this image. Use Retry image upload to check it again.';
    } catch(cause) { error = failure(cause); } finally {working=false;if(active) render();}
  }
  root.addEventListener('change', async event => {
    if(!event.target.dataset.upload || !event.target.files?.[0] || working) return;
    const file = event.target.files[0];
    if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 20*1024*1024 || !file.size) {error='Choose a PNG, JPEG or WebP image up to 20 MB.';render();return;}
    if(event.target.dataset.upload==='product' && current.draft.product.photos.length>=20) {error='Use up to 20 product photos.';render();return;}
    pendingUpload = {id:id(),file,field:event.target.dataset.upload,uploaded:false};await uploadImage();
  });
  root.addEventListener('input', event => {
    const target = event.target;
    if (target.name === 'catalog-query') { searchQuery = target.value; return; }
    if (target.dataset.field && current) {
      const keys = target.dataset.field.split('.'); let object = current.draft; keys.slice(0, -1).forEach(key => { object = object[key]; }); object[keys.at(-1)] = target.value; changed();
    }
    if (target.dataset.price && current) { const value = target.value; if (value === '') delete current.draft.product.retailPrices[target.dataset.price]; else if (Number.isFinite(Number(value)) && Number(value) >= 0) current.draft.product.retailPrices[target.dataset.price] = Math.round(Number(value) * 100); changed(); }
  });
  root.addEventListener('change', event => {
    if (!event.target.dataset.variant || !current) return;
    if(event.target.checked && current.draft.product.selectedVariantIds.length>=100){event.target.checked=false;error='Choose up to 100 offered variants for one Shopify draft.';render();return;}
    const values = new Set(current.draft.product.selectedVariantIds); event.target.checked ? values.add(event.target.dataset.variant) : values.delete(event.target.dataset.variant); current.draft.product.selectedVariantIds = [...values]; changed();
  });
  root.addEventListener('click', async event => {
    const target = event.target.closest('[data-action]'); if (!target || !root.contains(target)) return;
    const action = target.dataset.action, index = Number(target.dataset.index);
    if (working) return;
    if (action === 'close-product') {guarded(()=>onClose?.());return;}
    if (action === 'check-access') {await loadExecution(); return;}
    if (action === 'enable-access') {
      try {if(!win.shopify?.scopes?.request) throw new Error('Open Order Manager inside Shopify Admin to enable this access.');
        await win.shopify.scopes.request(['write_products','write_metaobjects','read_metaobject_definitions','write_files']); await loadExecution();
      }catch(cause){error=cause.message || failure(cause);render();} return;
    }
    if (action === 'load-branding') {
      if(dirty && !await save()) return;
      await run(()=>api().getStorefrontSetupBranding(current.id,requestOptions()), data=>{if(data.appearance){Object.assign(current.draft.appearance,data.appearance);if(data.name)current.draft.owner.name=data.name;changed();status='Current Shopify branding loaded into the plan. Review and save your changes.';}});return;
    }
    if (action === 'retry-upload') {await uploadImage();return;}
    if (action === 'review-execution') {
      if(dirty && !await save()) return;
      if(!current.id) {error='Save the plan before creating Shopify drafts.';render();return;}
      if(mode!=='product' && !win.confirm('Create or update the unpublished Shopify product and separate draft branding for this saved plan? The live storefront will stay unchanged.')) return;
      working=true;error='';status='Creating unpublished Shopify drafts…';render();
      try {execution=await api().executeStorefrontSetup(current.id,{expectedRevision:current.revision,confirmDraftOnly:true},requestOptions());status=mode==='product'?'Product created as an unpublished Shopify draft.':execution.message;if(mode==='product'){dirty=false;onCreated?.(execution);}}
      catch(cause){error=failure(cause);try{execution=await api().getStorefrontSetupExecution(current.id,requestOptions());}catch{} }
      finally{working=false;if(active)render();}return;
    }
    if (action === 'stay') { leaveAction = null; root.querySelector('[data-dialog="leave"]').close(); return; }
    if (action === 'discard' && saving || action === 'save-leave' && saving) return;
    if (action === 'discard') { const next = leaveAction; leaveAction = null; if (saved) current = clone(saved); dirty = false; pendingSave = null; root.querySelector('[data-dialog="leave"]').close(); next?.(); return; }
    if (action === 'save-leave') { const next = leaveAction; if (await save()) { leaveAction = null; next?.(); } else { const dialog = root.querySelector('[data-dialog="leave"]'); dialog.querySelector('.setup-dialog-error').textContent = error || 'The plan was not saved.'; dialog.showModal(); } return; }
    if (action === 'save') { await save(); return; }
    if (action === 'copy') { root.querySelector('[data-dialog="copy"]').showModal(); return; }
    if (action === 'close-copy') { root.querySelector('[data-dialog="copy"]').close(); return; }
    if (action === 'reload-conflict') { guarded(() => void openDraft(current.id)); return; }
    if (action === 'preview') { root.querySelector('[data-dialog="preview"]').showModal(); return; }
    if (action === 'close-preview') { root.querySelector('[data-dialog="preview"]').close(); return; }
    if (action.startsWith('tab-')) { tab = action.slice(4); render(); root.querySelector('.setup-scroll').scrollTop = 0; return; }
    if (action === 'back') { guarded(() => { page = 'list'; error = ''; status = ''; render(); }); return; }
    if (action === 'new' || action === 'plan-existing') {
      guarded(() => { setCurrent({ id: null, revision: 0, draft: blank() }); if (action === 'plan-existing' && selectedCollection) { current.draft.title = `${selectedCollection.title} setup`; current.draft.owner.name = selectedCollection.title; current.draft.collectionId = selectedCollection.id; if (selectedCollection.partnerId) current.draft.partnerId = selectedCollection.partnerId; } saved = clone(current); tab = 'appearance'; dirty = true; render(); }); return;
    }
    if (action === 'open-draft') { guarded(() => void openDraft(drafts[index].id)); return; }
    if (action === 'open-collection') { guarded(() => { selectedCollection = collections[index]; existingProducts = []; page = 'existing'; render(); void loadProducts(); }); return; }
    if (action === 'reports') { win.StorefrontReports?.selectOwner(target.dataset.owner); win.OrderManagerNavigation.navigate('reports'); return; }
    if (action === 'more-products') { await loadProducts(productCursor); return; }
    if (action === 'more-collections') { await run(() => api().getStorefrontSetupCollections({ after: collectionCursor, ...requestOptions() }), data => { collections.push(...(data.collections || []).filter(store => store.partnerId)); collectionsMore = Boolean(data.hasNextPage); collectionCursor = data.endCursor || ''; }); return; }
    if (action === 'refresh' || action === 'retry') { if (page === 'existing') await loadProducts(); else if (page === 'editor') await loadSource(); else await loadLists(); return; }
    if (action === 'search-catalog' || action === 'more-catalog-search') {
      if (!searchQuery.trim()) { error = 'Enter a garment name, brand or style to search.'; render(); return; }
      const query = searchQuery, local = ++catalogGeneration, after = action === 'more-catalog-search' ? searchCursor : '';
      await run(() => api().searchStorefrontSetupCatalog(query, { after, ...requestOptions() }), data => { if (local !== catalogGeneration || query !== searchQuery) return; catalogResults = after ? [...catalogResults, ...(data.products || [])] : data.products || []; searchMore = Boolean(data.hasNextPage); searchCursor = data.endCursor || ''; status = catalogResults.length ? '' : 'No catalog garments matched your search.'; }); return;
    }
    if (action === 'choose-catalog') { const product = catalogResults[index]; if (!gid(product?.id)) return; if (current.draft.product.sourceProductId !== product.id) { if (current.draft.product.selectedVariantIds.length && !win.confirm('Changing the source garment clears the offered variants and proposed prices. Keep the photo links for review?')) return; current.draft.product.sourceProductId = product.id; current.draft.product.selectedVariantIds = []; current.draft.product.retailPrices = {}; catalog = null; changed(); } await loadSource(); return; }
    if (action === 'more-variants' || action === 'load-source') { await loadSource(action === 'more-variants' ? catalogCursor : ''); return; }
    if (action === 'add-photo') { current.draft.product.photos.push({ id: id(), url: '', color: '', view: 'Front' }); changed(); render(); return; }
    if (action === 'remove-photo') { current.draft.product.photos.splice(index, 1); changed(); render(); }
  });
  const beforeUnload = event => { if (dirty || saving || working) { event.preventDefault(); event.returnValue = ''; } };
  win.addEventListener('beforeunload', beforeUnload);
  return {
    dispose() { win.removeEventListener('beforeunload', beforeUnload); this.onLeave(); },
    async onEnter() { if (!source()) return; if (active) return; active = true; ++generation; controller = new AbortController(); if (!api()) { error = 'Storefront setup is unavailable in this session.'; render(); return; } render(); if(mode==='product' && initialDraftId){await openDraft(initialDraftId);tab='products';render();}else if (page === 'list') await loadLists(); },
    onLeave() { active = false; ++generation; ++catalogGeneration; controller?.abort(); controller = null; ++recordGeneration; root.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); },
    canLeave(context = {}) { if(working){error='Wait for the Shopify action to finish before leaving.';render();return false;} if (!dirty && !saving) return true; guarded(typeof context.resume === 'function' ? context.resume : () => render()); return false; }
  };
}


