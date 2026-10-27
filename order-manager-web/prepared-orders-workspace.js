/* Private preparation workspace. Editor code is requested only on explicit entry. */
(() => {
  const root = document.getElementById('prepared-orders-root');
  if (!root) return;
  const api = (path = '', options) => window.api.preparedDraftRequest(path, options);
  let record = null, dirty = false, saving = false, loaded = false, generation = 0;
  let drafts = [], cursor = null, picker = null, frame = null, editorSession = '', editorDirty = false, editorItem = null;
  let working = false, activeItemId = null, publishedLink = null;
  let saveTimer, savePromise = null, pendingSave = null, editVersion = 0, saveFailed = false, uploadItemId = null;
  let accessChecked = false;
  let pendingMockups = [];
  const productCache = new Map(), assetUrls = new Set();
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  const button = (label, action, primary = false) => { const element = node('button', label, primary ? 'prepared-primary' : ''); element.type = 'button'; element.dataset.focus = label; element.addEventListener('click', action); return element; };
  const field = (label, value, update, { multiline = false, max = 160 } = {}) => {
    const wrapper = node('label', label), input = node(multiline ? 'textarea' : 'input'); input.value = value || ''; input.maxLength = max;
    input.dataset.focus = label;
    input.addEventListener('input', () => { update(input.value); markDirty(); }); wrapper.append(input); return wrapper;
  };
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (record && dirty && !working && !frame) void saveRecord({ quiet: true }).catch(() => {}); }, 700);
  }
  function updateSaveStatus() {
    updateLinkStatus();
    const status = root.querySelector('.prepared-save-status');
    if (status) status.textContent = saving ? 'Saving…' : saveFailed ? 'Not saved · retry below' : dirty ? 'Waiting to save…' : record?.revision ? 'All changes saved' : 'Saves automatically';
  }
  function markDirty() { dirty = true; editVersion++; updateSaveStatus(); queueSave(); }
  function showError(container, error, retry, fallback = 'This action could not finish. Try again; your changes are still here.') {
    if (!container) return;
    const text = error.code === 'PREPARATION_UNAVAILABLE' ? fallback : String(error.message || fallback).replace(/^\d{3}\s*-\s*[A-Z_]+:\s*/, '').replace(/\s*\(Request [^)]+\)\s*$/, '');
    container.replaceChildren(node('p', text)); container.classList.add('prepared-error'); container.setAttribute('role', 'alert');
    if (retry) container.append(button('Retry', retry));
    const details = node('details'); details.append(node('summary', 'Error details'), node('p', error.message || fallback, 'prepared-help')); container.append(details);
  }
  function message(text, error = false) {
    const region = root.querySelector('.prepared-feedback'); if (!region) return;
    region.replaceChildren(); region.textContent = text; region.classList.toggle('prepared-error', error); region.setAttribute('role', error ? 'alert' : 'status');
  }
  function releaseUrls() { for (const url of assetUrls) URL.revokeObjectURL(url); assetUrls.clear(); }
  function canLeave() { return !saving && !working && !frame && (!(dirty || pendingMockups.length) || confirm('Leave with unsaved order changes or mockup uploads?')); }
  async function assetUrl(assetId, mime) {
    const response = await api(`/${record.id}/assets/${assetId}`, { rawResponse: true });
    const url = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mime || 'image/png' })); assetUrls.add(url); return url;
  }
  async function saveRecord({ quiet = false } = {}) {
    clearTimeout(saveTimer);
    if (savePromise) return savePromise;
    if (!record) throw new Error('Open an order first.');
    const request = pendingSave || { draft: structuredClone(record), expectedRevision: record.revision || null, mutationId: crypto.randomUUID(), version: editVersion };
    pendingSave = request; saving = true; updateSaveStatus();
    savePromise = persist();
    return savePromise;
    async function persist() {
    let succeeded = false;
    try {
      const saved = await api(`/${record.id}`, { method: 'PUT', body: JSON.stringify({ draft: request.draft, expectedRevision: request.expectedRevision, mutationId: request.mutationId }) });
      // Acknowledgment must not overwrite typing performed while saving.
      const editedDuringSave = editVersion !== request.version;
      if (editedDuringSave) Object.assign(record, { revision: saved.revision, updatedAt: saved.updatedAt });
      else {
        // Existing inputs/actions close over item objects. Keep those identities
        // when applying the server's canonical snapshot after an acknowledgment.
        const items = new Map(record.items.map(item => [item.id, item]));
        const mockups = new Map(record.mockups.map(item => [item.assetId, item]));
        Object.assign(record, saved, {
          items: saved.items.map(item => Object.assign(items.get(item.id) || {}, item)),
          mockups: saved.mockups.map(item => Object.assign(mockups.get(item.assetId) || {}, item)),
        });
      }
      dirty = editedDuringSave; pendingSave = null; saveFailed = false; succeeded = true;
      const summary = { id: saved.id, title: saved.title, preparedFor: saved.preparedFor, updatedAt: saved.updatedAt, itemCount: saved.items.length };
      drafts = [summary, ...drafts.filter(item => item.id !== saved.id)];
      if (!quiet) message('Changes saved.');
      return saved;
    } catch (error) { saveFailed = true; dirty = true; showError(root.querySelector('.prepared-feedback'), error, () => void flushSave().catch(() => {}), 'Changes could not save. Retry before leaving this order.'); throw error; }
    finally { saving = false; savePromise = null; updateSaveStatus(); if (succeeded && dirty) queueSave(); }
    }
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    if (!dirty && record?.revision && !savePromise && !pendingSave) return record;
    do { await saveRecord({ quiet: true }); } while (dirty);
  }
  async function list(append = false) {
    if (working || frame) return;
    if (pendingMockups.length) { message('Retry or discard the waiting image uploads before leaving this order.', true); return; }
    if (record && (dirty || saving)) { try { await flushSave(); } catch { return; } }
    const run = ++generation; record = null; dirty = false; pendingMockups = []; releaseUrls(); renderBrowse(true);
    try {
      const result = await api(append && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''); if (run !== generation) return;
      drafts = append ? [...drafts, ...result.drafts.filter(item => !drafts.some(existing => existing.id === item.id))] : result.drafts;
      cursor = result.cursor; loaded = true; renderBrowse();
    } catch (error) { if (run === generation) { renderBrowse(); message(error.message, true); } }
  }
  function renderBrowse(loading = false) {
    root.replaceChildren(); const bar = node('div', undefined, 'prepared-browse-actions');
    const create = button('New prepared order', createDraft, true); create.disabled = loading;
    const refresh = button('Refresh', () => void list()); refresh.disabled = loading; bar.append(create, refresh);
    const feedback = node('p', loading ? 'Loading saved prepared orders…' : '', 'prepared-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const scroll = node('div', undefined, 'prepared-scroll');
    scroll.append(node('p', 'Open a saved order to continue preparing it or manage its customer link.', 'prepared-help'));
    if (!loading && !drafts.length) { scroll.append(node('h3', 'No prepared orders saved here yet'), node('p', 'Start with the garments. Add artwork or mockups when you have them.', 'prepared-help')); }
    for (const draft of drafts) {
      const row = button('', () => void openDraft(draft.id)); row.className = 'prepared-draft-row';
      const identity = node('span'); identity.append(node('strong', draft.title), node('span', [draft.preparedFor, draft.updatedAt ? `Edited ${new Date(draft.updatedAt).toLocaleDateString()}` : ''].filter(Boolean).join(' · '), 'prepared-help'));
      row.append(identity, node('span', draft.itemCount ? `${draft.itemCount} garment${draft.itemCount === 1 ? '' : 's'} · In preparation` : 'Needs garments', 'prepared-help')); scroll.append(row);
    }
    if (cursor) scroll.append(button('Load more saved orders', () => void list(true)));
    root.append(bar, feedback, scroll);
  }
  async function createDraft() {
    if (!canLeave()) return;
    releaseUrls(); pendingMockups = []; record = { id: crypto.randomUUID(), title: '', preparedFor: '', note: '', items: [], mockups: [] }; dirty = false; pendingSave = null; editVersion = 0; saveFailed = false; publishedLink = null;
    renderDetail();
  }
  async function openDraft(id) {
    if (!canLeave()) return;
    const run = ++generation; message('Opening prepared order…');
    try { const [saved, link] = await Promise.all([api(`/${id}`), api(`/${id}/link`).catch(() => ({ link: null }))]); if (run !== generation) return; releaseUrls(); record = saved; dirty = false; pendingSave = null; editVersion = 0; saveFailed = false; publishedLink = link.link; renderDetail(); }
    catch (error) { message(error.message, true); }
  }
  function openDialog(title, className = '') {
    const origin = document.activeElement, dialog = node('dialog', undefined, 'prepared-product-picker ' + className);
    const heading = node('div', undefined, 'prepared-dialog-heading'), text = node('h2', title); text.id = 'prepared-dialog-' + crypto.randomUUID();
    dialog.setAttribute('aria-labelledby', text.id); heading.append(text, button('Close', () => dialog.close())); dialog.append(heading);
    dialog.addEventListener('close', () => { dialog.remove(); if (origin?.isConnected) origin.focus(); });
    document.body.append(dialog); dialog.showModal(); return dialog;
  }
  function loadImage(image, assetId, mime) {
    const target = record.id;
    void assetUrl(assetId, mime).then(url => { if (record?.id === target && image.isConnected) image.src = url; else { URL.revokeObjectURL(url); assetUrls.delete(url); } })
      .catch(() => { if (image.isConnected) image.replaceWith(node('p', 'Image unavailable. Your saved configuration is still here.', 'prepared-help')); });
  }
  function inspectImage(assetId, mime, name) {
    const dialog = openDialog(name || 'Mockup', 'prepared-image-dialog'), image = node('img'); image.alt = name || 'Mockup'; dialog.append(image); loadImage(image, assetId, mime);
  }
  function thumbnail(url) {
    const holder = node('span', undefined, 'prepared-thumbnail');
    if (!url) { holder.textContent = 'No image'; return holder; }
    const image = node('img'); image.alt = ''; image.src = url; image.loading = 'lazy'; image.decoding = 'async';
    image.addEventListener('error', () => { holder.textContent = 'No image'; }, { once: true }); holder.append(image); return holder;
  }
  function assignMockup(mockup) {
    const dialog = openDialog('Use this mockup on…'), selected = new Set(mockup.itemIds || []);
    dialog.append(node('p', 'Choose the garments this image represents. Leave all unchecked to keep it as an order reference.', 'prepared-help'));
    for (const item of record.items) {
      const label = node('label', undefined, 'prepared-checkbox'), input = node('input'); input.type = 'checkbox'; input.checked = selected.has(item.id);
      input.addEventListener('change', () => input.checked ? selected.add(item.id) : selected.delete(item.id)); label.append(input, node('span', item.title + (item.color ? ' · ' + item.color : ''))); dialog.append(label);
    }
    dialog.append(button('Apply', () => { mockup.itemIds = [...selected]; markDirty(); dialog.close(); renderDetail(); }, true));
  }
  function mockupGallery(mockups) {
    const gallery = node('div', undefined, 'prepared-mockups');
    for (const mockup of mockups) {
      const group = node('figure'), preview = button('', () => inspectImage(mockup.assetId, mockup.mime, mockup.name)); preview.className = 'prepared-image-button'; preview.setAttribute('aria-label', 'Enlarge ' + (mockup.name || 'mockup'));
      const image = node('img'); image.alt = mockup.name || 'Finished mockup'; preview.append(image); loadImage(image, mockup.assetId, mockup.mime);
      const actions = node('div', undefined, 'prepared-item-actions'); actions.append(button('Assign garments', () => assignMockup(mockup)), button('Remove image', () => { record.mockups = record.mockups.filter(value => value !== mockup); markDirty(); renderDetail(); }));
      group.append(preview, node('figcaption', mockup.name || 'Finished mockup'), actions); gallery.append(group);
    }
    return gallery;
  }
  function mockupControls(itemId = null) {
    const wrap = node('div', undefined, 'prepared-upload-controls'), input = node('input'); input.type = 'file'; input.multiple = true; input.hidden = true; input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', () => void uploadMockups([...input.files], itemId));
    const native = node('input'); native.hidden = true; native.placeholder = 'Paste your copied image here'; native.setAttribute('aria-label', 'Paste finished mockup');
    native.addEventListener('input', () => { native.value = ''; });
    native.addEventListener('paste', event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); event.preventDefault(); if (files.length) void uploadMockups(files, itemId); else message('No image was pasted. Use Upload mockup to choose the file.', true); });
    wrap.append(button('Upload mockup', () => input.click()), button('Paste mockup', () => void pasteMockup(itemId, native)), input, native); return wrap;
  }
  function reuseArtwork(target) {
    const sources = record.items.filter(item => item.id !== target.id && item.project?.prints?.length), dialog = openDialog('Use artwork from another garment');
    if (!sources.length) dialog.append(node('p', 'Add artwork to a garment first. You can then reuse it here without uploading it again.', 'prepared-help'));
    for (const source of sources) dialog.append(button(source.title + (source.color ? ' · ' + source.color : ''), () => {
      if (target.project?.prints?.length && !confirm('Replace the artwork on this garment?')) return;
      target.project = structuredClone(source.project); target.project.canvasCalibration = null; target.project.printSummary = []; if (source.productId !== target.productId) target.project.printClassOverrides = {}; target.proofAssetId = null; markDirty(); dialog.close(); renderDetail(); message('Artwork copied. Open Edit artwork to check its placement.');
    }));
  }
  function updateLinkStatus() {
    const active = publishedLink?.status === 'active' && Date.parse(publishedLink.expiresAt) > Date.now();
    const current = active && !dirty && publishedLink.sourceRevision === record?.revision;
    const status = root.querySelector('.prepared-link-status');
    if (status) status.textContent = current ? 'Ready to send · Expires ' + new Date(publishedLink.expiresAt).toLocaleDateString() : active ? 'Your latest changes need to be published to this link.' : publishedLink ? 'This link is inactive. Create a new link to send.' : 'Customers choose sizes and quantities before Shopify checkout.';
    const publish = root.querySelector('[data-publish]'); if (publish) { publish.textContent = active ? current ? 'Refresh customer link' : 'Update customer link' : 'Create customer link'; publish.disabled = working || !record?.items.length; }
    root.querySelectorAll('[data-link-action]').forEach(control => control.disabled = !current || working);
  }
  async function publishCustomerLink() {
    if (working || frame || !record.items.length) return;
    if (pendingMockups.length) { message('Finish or discard pending image uploads first.', true); return; }
    working = true; updateLinkStatus(); message('Preparing the customer link…');
    try { await flushSave(); publishedLink = (await api('/' + record.id + '/publish', { method: 'POST', body: JSON.stringify({ expectedRevision: record.revision, refresh: true }) })).link; renderDetail(); message('Customer link ready. Review it, then copy it to send.'); }
    catch (error) { showError(root.querySelector('.prepared-feedback'), error, () => void publishCustomerLink()); }
    finally { working = false; updateLinkStatus(); if (dirty && !saveFailed) queueSave(); }
  }
  function customerLinkPanel() {
    const panel = node('section', undefined, 'prepared-customer-link'), info = node('div'); info.append(node('h3', 'Customer link'), node('p', '', 'prepared-help prepared-link-status'));
    const publish = button('Create customer link', () => void publishCustomerLink(), true); publish.dataset.publish = 'true'; panel.append(info, publish);
    if (publishedLink?.url) {
      const label = node('label', 'Customer link'), input = node('input'); input.type = 'url'; input.readOnly = true; input.value = publishedLink.url; input.addEventListener('focus', () => input.select()); label.append(input);
      const actions = node('div', undefined, 'prepared-item-actions');
      const copy = button('Copy link', async () => { try { await navigator.clipboard.writeText(publishedLink.url); message('Customer link copied.'); } catch { input.focus(); input.select(); message('Select and copy the customer link above.'); } }); copy.dataset.linkAction = 'true';
      const preview = button('Preview customer order', () => window.open(publishedLink.url, '_blank', 'noopener,noreferrer')); preview.dataset.linkAction = 'true';
      actions.append(copy, preview); panel.append(label, actions);
      if (publishedLink.status === 'active') {
        const more = node('details'); more.append(node('summary', 'Link options'), button('Revoke link', async () => { if (working || !confirm('Disable this customer link? A Shopify checkout already opened from it may still be completed.')) return; working = true; updateLinkStatus(); try { await api('/' + record.id + '/revoke', { method: 'POST', body: '{}' }); publishedLink.status = 'revoked'; renderDetail(); } catch (error) { showError(root.querySelector('.prepared-feedback'), error); } finally { working = false; updateLinkStatus(); if (dirty && !saveFailed) queueSave(); } })); panel.append(more);
      }
    }
    return panel;
  }
  function printingControls(item) {
    const details = node('details', undefined, 'prepared-printing-controls'); details.dataset.key = 'printing-' + item.id; const hasArt = !!item.project?.prints?.length;
    details.append(node('summary', 'Printing · ' + (item.printMode === 'none' ? 'No printing' : item.printMode === 'manual' ? 'Manual setup' : hasArt ? 'From artwork' : 'Choose setup')));
    const label = node('label', 'Printing setup'), mode = node('select');
    for (const [value, title] of [['', 'Choose printing'], ['auto', 'Use artwork size & classification'], ['manual', 'Set print locations manually'], ['none', 'No printing']]) { const option = node('option', title); option.value = value; option.disabled = value === 'auto' && !hasArt; mode.append(option); }
    mode.value = item.printMode || (hasArt ? 'auto' : ''); label.append(mode); const body = node('div'); details.append(label, body);
    let choices;
    async function draw() {
      body.replaceChildren(); if (mode.value !== 'manual') { body.append(node('p', mode.value === 'none' ? 'No print charges will be added. Artwork remains reference only.' : mode.value === 'auto' ? 'Uses the saved artwork size and any admin classification overrides.' : 'Choose a setup before creating the customer link.', 'prepared-help')); return; }
      body.append(node('p', 'Loading print options…', 'prepared-help'));
      try {
        choices ||= (await api('/' + record.id + '/print-choices?productId=' + encodeURIComponent(item.productId))).choices;
        body.replaceChildren();
        for (const [side, title] of [['front', 'Front / chest'], ['back', 'Back'], ['left', 'Left sleeve'], ['right', 'Right sleeve']]) {
          const wrapper = node('label', title), select = node('select'), none = node('option', 'No print on this side'); none.value = ''; select.append(none);
          for (const choice of choices[side] || []) { const option = node('option', choice.label); option.value = String(choice.variantId); select.append(option); }
          select.value = String(item.manualPrints?.find(print => print.side === side)?.variantId || '');
          select.addEventListener('change', () => { item.manualPrints = (item.manualPrints || []).filter(print => print.side !== side); if (select.value) item.manualPrints.push({ side, variantId: Number(select.value) }); markDirty(); }); wrapper.append(select); body.append(wrapper);
        }
      } catch (error) { showError(body, error, () => void draw()); }
    }
    mode.addEventListener('change', () => { item.printMode = mode.value || null; item.manualPrints ||= []; markDirty(); void draw(); });
    details.addEventListener('toggle', () => { if (details.open) void draw(); }); return details;
  }
  function renderDetail() {
    const scrollTop = root.querySelector('.prepared-scroll')?.scrollTop || 0, focusKey = document.activeElement?.dataset.focus;
    const openDetails = [...root.querySelectorAll('details[data-key][open]')].map(element => element.dataset.key);
    const item = record.items.find(value => value.id === activeItemId) || record.items[0]; activeItemId = item?.id || null;
    releaseUrls(); root.replaceChildren();
    const top = node('div', undefined, 'prepared-detail-heading'), status = node('span', '', 'prepared-save-status'); status.setAttribute('role', 'status'); top.append(button('Saved orders', () => void list()), status);
    const scroll = node('div', undefined, 'prepared-scroll'), content = node('div', undefined, 'prepared-content');
    const orderHeader = node('header', undefined, 'prepared-order-header'), identity = node('div');
    const title = node('h2', record.title && record.title !== 'Untitled prepared order' ? record.title : 'New prepared order');
    identity.append(title, node('p', record.preparedFor || 'Build the garments, artwork and mockups for this order.', 'prepared-help'));
    const details = node('details', undefined, 'prepared-order-details'); details.dataset.key = 'order'; details.open = openDetails.includes('order'); details.append(node('summary', 'Order details'));
    const fields = node('div', undefined, 'prepared-identity'); fields.append(field('Order name', record.title, value => { record.title = value; title.textContent = value || 'New prepared order'; }), field('Prepared for (optional)', record.preparedFor, value => { record.preparedFor = value; }, { max: 120 }), field('Customer message (optional)', record.customerMessage, value => { record.customerMessage = value; }, { multiline: true, max: 240 }), field('Private order notes (optional)', record.note, value => { record.note = value; }, { multiline: true, max: 1000 })); details.append(fields);
    orderHeader.append(identity, details); content.append(orderHeader);
    const workbench = node('div', undefined, 'prepared-workbench'), rail = node('nav', undefined, 'prepared-garment-rail'); rail.setAttribute('aria-label', 'Garments in this order');
    const railHeading = node('div', undefined, 'prepared-section-heading'); railHeading.append(node('h3', 'Garments (' + record.items.length + ')')); rail.append(railHeading, button('Add garment', () => void openPicker(), true));
    const garmentList = node('div', undefined, 'prepared-garment-list');
    for (const garment of record.items) {
      const select = button('', () => { activeItemId = garment.id; renderDetail(); }); select.className = 'prepared-garment-choice'; select.dataset.focus = 'garment-' + garment.id; select.setAttribute('aria-pressed', String(garment.id === activeItemId));
      const name = node('span'); name.append(node('strong', garment.title), node('span', garment.optionLabel || garment.color || garment.variantTitle, 'prepared-help'));
      select.append(thumbnail(garment.image), name); garmentList.append(select);
    }
    rail.append(garmentList); workbench.append(rail);
    const panel = node('section', undefined, 'prepared-selected-garment');
    if (!item) {
      const empty = node('div', undefined, 'prepared-empty'); empty.append(node('h3', 'Start with a garment'), node('p', 'Choose one or several colors. Then place artwork or attach a finished mockup.', 'prepared-help'), button('Choose garments', () => void openPicker(), true)); panel.append(empty);
    } else {
      panel.classList.add('prepared-item'); panel.setAttribute('aria-label', item.title);
      const heading = node('header', undefined, 'prepared-selected-heading'); const label = node('div'); label.append(node('h3', item.title), node('p', item.optionLabel || item.color || item.variantTitle, 'prepared-help')); heading.append(label, button('Change garment / color', () => void openPicker(item))); panel.append(heading);
      const mockups = record.mockups.filter(mockup => mockup.itemIds?.includes(item.id)), prints = item.project?.prints?.length || 0;
      const composition = node('div', undefined, 'prepared-garment-composition'), visual = node('figure', undefined, 'prepared-garment-visual');
      const mockup = mockups[0], assetId = mockup?.assetId || item.proofAssetId, mime = mockup?.mime || 'image/png';
      if (assetId) {
        const preview = button('', () => inspectImage(assetId, mime, mockup ? 'Supplied mockup' : 'Saved mockup')); preview.className = 'prepared-image-button prepared-main-preview'; preview.setAttribute('aria-label', 'Enlarge garment mockup');
        const image = node('img'); image.alt = item.title + ' mockup'; preview.append(image); loadImage(image, assetId, mime); visual.append(preview);
        visual.append(node('figcaption', mockup ? 'Supplied mockup · Click to enlarge' : item.proofKind === 'garment' ? 'Saved mockup · Click to enlarge' : 'Placement reference · No matching garment image', 'prepared-help'));
      } else if (item.image) { const image = node('img'); image.src = item.image; image.alt = item.title; image.addEventListener('error', () => image.replaceWith(node('p', 'Product image unavailable', 'prepared-help')), { once: true }); visual.append(image, node('figcaption', 'Garment photo · Artwork not shown', 'prepared-help')); }
      else visual.append(node('p', 'No garment image available', 'prepared-help'), node('p', 'You can still add artwork or a finished mockup.', 'prepared-help'));
      const tools = node('div', undefined, 'prepared-garment-tools'); tools.append(node('h4', 'Artwork & mockup'));
      tools.append(node('p', prints ? prints + ' artwork layer' + (prints === 1 ? '' : 's') + (item.proofAssetId ? ' saved' : ' · Review placement') : 'Place a design on this garment, or use an image you already made.', 'prepared-help'));
      if (prints && item.project.printSummary?.length && !['manual', 'none'].includes(item.printMode)) {
        const classes = node('div', undefined, 'prepared-print-classes');
        for (const summary of item.project.printSummary) classes.append(node('span', summary.label + (summary.mode === 'manual' ? ' · Override' : ''), 'prepared-print-class')); tools.append(classes);
      }
      tools.append(printingControls(item));
      tools.append(button(prints ? 'Edit artwork' : 'Add artwork', () => void openEditor(item), true));
      if (record.items.some(other => other.id !== item.id && other.project?.prints?.length)) tools.append(button('Use artwork from…', () => reuseArtwork(item)));
      const supplied = node('details', undefined, 'prepared-finished-mockup'); supplied.dataset.key = 'mockup-' + item.id; supplied.open = openDetails.includes(supplied.dataset.key) || (!prints && !mockups.length); supplied.append(node('summary', 'Use a finished mockup'), node('p', 'Upload or paste the completed image. No design file needed.', 'prepared-help'), mockupControls(item.id)); tools.append(supplied);
      const options = node('details', undefined, 'prepared-garment-options'); options.dataset.key = item.id; options.open = openDetails.includes(item.id); options.append(node('summary', 'Garment options & notes'), button('Add another color', () => void openPicker(null, item.productId, item)), field('Printing notes (optional)', item.instructions, value => { item.instructions = value; }, { multiline: true, max: 1000 }), button('Remove garment', () => {
        if (!confirm('Remove ' + item.title + '? Its uploaded images will stay in this order.')) return;
        record.items = record.items.filter(value => value.id !== item.id); for (const mockup of record.mockups) mockup.itemIds = (mockup.itemIds || []).filter(id => id !== item.id); markDirty(); renderDetail();
      })); tools.append(options); composition.append(visual, tools); panel.append(composition);
      if (mockups.length) { const attachments = node('details', undefined, 'prepared-attachment-details'); attachments.dataset.key = 'images-' + item.id; attachments.open = openDetails.includes(attachments.dataset.key); attachments.append(node('summary', mockups.length + ' supplied mockup' + (mockups.length === 1 ? '' : 's') + ' · Assign or remove'), mockupGallery(mockups)); panel.append(attachments); }
      panel.querySelectorAll('button,input,textarea').forEach(element => { element.dataset.focus = (element.dataset.focus || element.textContent) + '-' + item.id; });
    }
    workbench.append(panel); content.append(workbench, customerLinkPanel());
    const references = record.mockups.filter(mockup => !mockup.itemIds?.length), refs = node('details', undefined, 'prepared-references'); refs.dataset.key = 'references'; refs.open = openDetails.includes('references') || references.length > 0 || !record.items.length;
    refs.append(node('summary', references.length ? 'Order references (' + references.length + ') · Assign mockups to garments' : 'Start from a finished mockup'), node('p', 'Keep an order reference here, or assign it to one or more garments.', 'prepared-help'), mockupControls(), mockupGallery(references)); content.append(refs);
    if (pendingMockups.length) content.append(node('p', pendingMockups.length + ' image upload(s) waiting. Completed uploads are kept.', 'prepared-help'), button('Retry image uploads', () => void uploadMockups([...pendingMockups], uploadItemId)), button('Discard pending uploads', () => { pendingMockups = []; renderDetail(); }));
    scroll.append(content);
    const feedback = node('div', '', 'prepared-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const footer = node('footer', undefined, 'prepared-footer'); footer.append(node('span', 'Changes save automatically. Publish updates before sending your customer link.', 'prepared-help'), button('Done for now', () => void list()));
    root.append(top, scroll, feedback, footer); scroll.scrollTop = scrollTop; updateSaveStatus();
    if (focusKey) [...root.querySelectorAll('[data-focus]')].find(element => element.dataset.focus === focusKey)?.focus({ preventScroll: true });
  }
  async function uploadAsset(file) { return api(`/${record.id}/assets`, { method: 'POST', body: file, headers: { 'Content-Type': file.type } }); }
  async function uploadMockups(files, itemId = null) {
    if (working || frame) return;
    const valid = files.filter(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type));
    if (!valid.length) { message('Use PNG, JPG or WebP mockups.', true); return; }
    if (record.mockups.length + valid.length > 20 || valid.some(file => file.size > 20 * 1024 * 1024)) { message('Use up to 20 mockups, each smaller than 20 MB.', true); return; }
    working = true;
    pendingMockups = valid; uploadItemId = itemId; clearTimeout(saveTimer);
    message('Uploading mockups…');
    try {
      await flushSave();
      while (pendingMockups.length) { const file = pendingMockups[0]; const saved = await uploadAsset(file); record.mockups.push({ ...saved, name: file.name, itemIds: itemId && record.items.some(item => item.id === itemId) ? [itemId] : [] }); pendingMockups.shift(); markDirty(); }
      if (!record.items.length && (!record.title || record.title === 'Untitled prepared order')) { record.title = valid[0].name.replace(/\.[^.]+$/, '') + ' order'; markDirty(); }
      await flushSave(); renderDetail(); message(itemId ? 'Mockup added to this garment.' : 'Mockup saved. Use Assign garments when you are ready.');
    } catch (error) { renderDetail(); showError(root.querySelector('.prepared-feedback'), error, () => pendingMockups.length ? void uploadMockups([...pendingMockups], uploadItemId) : void flushSave().catch(() => {})); }
    finally { working = false; if (dirty && !saveFailed) queueSave(); }
  }
  async function pasteMockup(itemId, native) {
    try { for (const item of await navigator.clipboard.read()) { const type = item.types.find(value => ['image/png', 'image/jpeg', 'image/webp'].includes(value)); if (type) { await uploadMockups([new File([await item.getType(type)], 'Pasted mockup.png', { type })], itemId); return; } } message('Copy an image, then paste it here or use Upload mockup.', true); }
    catch { native.hidden = false; native.focus(); message('Paste into the image field, or choose Upload mockup.'); }
  }
  async function getProduct(id) { if (!productCache.has(id)) productCache.set(id, await api(`/product/${encodeURIComponent(id)}`)); return productCache.get(id); }
  async function openPicker(replaceItem = null, productId = null, copyFrom = null) {
    if (working || frame || picker) return;
    if (!replaceItem && record.items.length >= 30) { message('Use up to 30 garments in one order.', true); return; }
    const dialog = openDialog(replaceItem ? 'Change garment or color' : 'Add garments'); picker = dialog;
    const form = node('form'), search = node('input'); search.type = 'search'; search.placeholder = 'Search garment names or styles'; search.setAttribute('aria-label', 'Search garment names or styles'); search.maxLength = 120;
    const submit = button('Search', () => {}); submit.type = 'submit'; form.append(search, submit);
    const status = node('div', '', 'prepared-feedback'); status.setAttribute('role', 'status');
    const results = node('div', undefined, 'prepared-catalog-results'); dialog.append(form, status, results);
    let requestVersion = 0, nextCursor = null;
    async function chooseProduct(id) {
      const version = ++requestVersion; status.replaceChildren(); status.textContent = 'Loading colors…'; results.replaceChildren();
      try {
        const detail = await getProduct(id); if (version !== requestVersion || picker !== dialog) return;
        status.replaceChildren(); const summary = node('div', undefined, 'prepared-item-summary'); summary.append(thumbnail(detail.image), node('h3', detail.title)); results.append(summary);
        const colorOf = variant => variant.selectedOptions.find(option => /colou?r/i.test(option.name))?.value || '';
        // Choose every non-size option (for example Color + Fit) without
        // presenting a long list of repeated size variants.
        const configurationOf = variant => variant.selectedOptions.filter(option => !/^size$/i.test(option.name)).map(option => option.value).join(' · ') || 'Default';
        const colors = [...new Set(detail.variants.map(configurationOf))];
        const currentVariant = detail.variants.find(variant => variant.id === replaceItem?.variantId);
        const selected = new Set(replaceItem ? [currentVariant ? configurationOf(currentVariant) : colors[0]] : []);
        const choices = node('div', undefined, 'prepared-color-options');
        results.append(node('p', replaceItem ? 'Choose a color or option.' : 'Choose colors or options. Each selection becomes a garment in this order.', 'prepared-help'));
        const apply = button(replaceItem ? 'Update garment' : 'Add selected garments', () => {
          const chosen = detail.variants.filter(variant => selected.has(configurationOf(variant))).filter((variant, index, all) => all.findIndex(other => configurationOf(other) === configurationOf(variant)) === index);
          if (!chosen.length) return;
          if (!replaceItem && record.items.length + chosen.length > 30) { status.textContent = 'Use up to 30 garments in one order.'; return; }
          for (const variant of chosen) {
            const color = colorOf(variant), previous = replaceItem || copyFrom;
            const next = { id: replaceItem?.id || crypto.randomUUID(), productId: detail.id, variantId: variant.id, handle: detail.handle, title: detail.title, variantTitle: variant.title, color, optionLabel: configurationOf(variant), image: variant.image?.url || detail.image, instructions: previous?.instructions || '', project: previous?.project ? structuredClone(previous.project) : null, proofAssetId: null };
            if (next.project) { next.project.canvasCalibration = null; next.project.printSummary = []; if (previous?.productId !== detail.id) next.project.printClassOverrides = {}; }
            if (replaceItem) {
              if (replaceItem.productId === next.productId && replaceItem.variantId === next.variantId) continue;
              Object.assign(replaceItem, next);
              for (const mockup of record.mockups) mockup.itemIds = (mockup.itemIds || []).filter(value => value !== replaceItem.id);
            } else { record.items.push(next); activeItemId = next.id; }
          }
          if (!record.title || record.title === 'Untitled prepared order') record.title = record.preparedFor ? 'Order for ' + record.preparedFor : detail.title;
          markDirty(); dialog.close(); renderDetail(); if (replaceItem?.project || copyFrom?.project) message('Artwork kept. Review its placement on the selected garment. Previous mockups remain as order references.');
        }, true);
        const sync = () => { apply.disabled = !selected.size || !detail.variants.length; };
        for (const color of colors) {
          const label = node('label', undefined, 'prepared-checkbox'), input = node('input'); input.type = replaceItem ? 'radio' : 'checkbox'; input.name = 'garment-color'; input.checked = selected.has(color);
          input.addEventListener('change', () => { if (replaceItem) selected.clear(); input.checked ? selected.add(color) : selected.delete(color); sync(); }); label.append(input, node('span', color || 'Default')); choices.append(label);
        }
        if (colors.length === 1) { selected.add(colors[0]); choices.querySelector('input').checked = true; }
        results.append(choices, node('p', 'Sizes and quantities are not needed for artwork preparation.', 'prepared-help'));
        if (replaceItem?.project?.prints?.length || record.mockups.some(mockup => mockup.itemIds?.includes(replaceItem?.id))) results.append(node('p', 'Artwork will be kept for review. Mockups of the previous garment will become order references.', 'prepared-help'));
        if (!detail.variants.length) status.textContent = 'This product has no variants to add.';
        results.append(apply, button('Choose another product', () => void browse())); sync();
      } catch (error) { if (version === requestVersion && picker === dialog) showError(status, error, () => void chooseProduct(id), 'Garment details could not load. Retry or choose another product.'); }
    }
    async function browse(append = false) {
      const version = ++requestVersion; status.replaceChildren(); status.textContent = 'Loading garments…'; submit.disabled = true; if (!append) results.replaceChildren();
      try {
        const response = await api('/catalog?q=' + encodeURIComponent(search.value) + (append && nextCursor ? '&after=' + encodeURIComponent(nextCursor) : '')); if (version !== requestVersion || picker !== dialog) return;
        results.querySelector('[data-more]')?.remove(); nextCursor = response.hasNextPage ? response.endCursor : null;
        status.textContent = response.products.length ? '' : 'No matching active or unlisted garments. Try another name or style.';
        for (const product of response.products) {
          const row = button('', () => void chooseProduct(product.id)); row.className = 'prepared-catalog-row'; const name = node('span');
          name.append(node('strong', product.title), node('span', product.status === 'UNLISTED' ? 'Unlisted · Available for preparation' : !product.image ? 'No image · Available for preparation' : '', 'prepared-help')); row.append(thumbnail(product.image), name); results.append(row);
        }
        if (nextCursor) { const more = button('Load more garments', () => void browse(true)); more.dataset.more = 'true'; results.append(more); }
      } catch (error) { if (version === requestVersion && picker === dialog) showError(status, error, () => void browse(append), 'Garments could not load. Try again; your order has not changed.'); }
      finally { submit.disabled = false; }
    }
    form.addEventListener('submit', event => { event.preventDefault(); void browse(); });
    dialog.addEventListener('close', () => { ++requestVersion; picker = null; root.querySelector('.prepared-garment-rail button')?.focus(); });
    search.focus(); if (productId || replaceItem) await chooseProduct(productId || replaceItem.productId); else await browse();
  }
  function closeEditor() {
    frame?.remove(); frame = null; editorItem = null; editorSession = ''; editorDirty = false;
    root.classList.remove('prepared-editor-open'); renderDetail(); if (dirty) queueSave();
  }
  async function openEditor(item) {
    if (working || frame) return;
    working = true;
    message('Loading placement editor…');
    try {
      await flushSave();
      const product = await getProduct(item.productId), assets = {};
      for (const print of item.project?.prints || []) {
        if (print.type !== 'image') throw new Error('This project requires the full Designer Studio. No artwork was changed.');
        assets[print.asset.assetId] = { url: await assetUrl(print.asset.assetId, print.asset.mime), mime: print.asset.mime };
      }
      editorItem = item.id; editorSession = crypto.randomUUID(); editorDirty = false;
      frame = node('iframe'); frame.title = `Place artwork — ${item.title}`; frame.className = 'prepared-editor-frame'; frame.src = './placement-editor/index.html';
      frame.dataset.context = ''; // Context stays in memory; never place credentials or project data in URLs/DOM attributes.
      frame._context = { session: editorSession, title: item.title, handle: item.handle, color: item.color, config: product.config, project: item.project, assets };
      root.classList.add('prepared-editor-open'); root.append(frame); frame.focus(); message('');
    } catch (error) { showError(root.querySelector('.prepared-feedback'), error, () => void openEditor(item)); }
    finally { working = false; }
  }
  window.addEventListener('message', async event => {
    if (!frame || event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.type === 'pm-placement:ready') { frame.contentWindow.postMessage({ type: 'pm-placement:init', context: frame._context }, location.origin); return; }
    if (data?.session !== editorSession) return;
    if (data.type === 'pm-placement:dirty') { editorDirty = data.dirty === true; return; }
    if (data.type !== 'pm-placement:request' || !/^[a-f0-9-]{36}$/i.test(data.requestId || '')) return;
    const source = event.source, session = editorSession;
    const reply = (value, error) => source.postMessage({ type: 'pm-placement:response', session, requestId: data.requestId, value, error }, location.origin);
    try {
      if (data.action === 'upload' && data.payload?.file instanceof Blob) { reply(await uploadAsset(data.payload.file)); return; }
      if (data.action === 'cancel') { reply({}); closeEditor(); return; }
      if (data.action === 'save') {
        const item = record.items.find(value => value.id === editorItem); if (!item) throw new Error('This garment is no longer in the order.');
        let proofAssetId = null;
        if (data.payload.proof instanceof Blob) { try { proofAssetId = (await uploadAsset(data.payload.proof)).assetId; } catch { /* A missing proof cannot prevent saving the editable project. */ } }
        Object.assign(item, { project: data.payload.project, proofAssetId, proofSide: data.payload.proofSide, proofKind: data.payload.proofKind }); markDirty();
        await flushSave();
        reply({ saved: true }); closeEditor(); message(proofAssetId ? 'Artwork placement and preview saved.' : 'Artwork placement saved. A preview could not be generated.'); return;
      }
      throw new Error('This editor action is unavailable.');
    } catch (error) { reply(null, error.message); }
  });
  window.addEventListener('beforeunload', event => { if (dirty || editorDirty || saving || working || pendingMockups.length) { event.preventDefault(); event.returnValue = ''; } });
  window.OrderManagerNavigation.register('prepared', { onEnter: async () => {
    if (!accessChecked) {
      const run = ++generation;
      root.replaceChildren(node('p', 'Checking admin access…', 'prepared-feedback'));
      try {
        const result = await api(''); if (run !== generation) return;
        drafts = result.drafts; cursor = result.cursor; accessChecked = true;
      } catch (error) {
        if (run !== generation) return;
        const reason = /401|403|sign-in|authentication|SHOPIFY_AUTH|SHOPIFY_CONTEXT/i.test(error.message)
          ? 'Admin access could not be verified. Open Order Manager from Shopify Admin with an authorized account, then retry.' : error.message;
        const alert = node('p', reason, 'prepared-feedback prepared-error'); alert.setAttribute('role', 'alert');
        root.replaceChildren(alert, button('Retry admin access', () => { window.OrderManagerNavigation.navigate('orders'); window.OrderManagerNavigation.navigate('prepared'); }));
        return;
      }
    }
    if (record) { renderDetail(); if (dirty) queueSave(); }
    else if (loaded) renderBrowse();
    else void createDraft();
  }, canLeave: () => {
    if (frame) { message('Return from artwork editing before leaving this order.', true); return false; }
    return canLeave();
  }, onLeave: () => { ++generation; clearTimeout(saveTimer); picker?.close(); releaseUrls(); root.replaceChildren(); productCache.clear(); } });
})();
