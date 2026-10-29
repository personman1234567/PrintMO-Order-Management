import {preparedCustomerUrl} from './prepared-customer-url.mjs';
import { openPreparedGarmentFinder } from './prepared-garment-finder.mjs';
import { createPreparedOrderBrowser } from './prepared-order-browser.mjs';
/* Private preparation workspace. Editor code is requested only on explicit entry. */
import { colorOf, configurationOf, colorVariants, copiedArtwork, previewSignature } from './prepared-color-model.mjs';
import { createPreparedPreviewRenderer } from './prepared-preview-renderer.mjs';
(() => {
  const root = document.getElementById('prepared-orders-root');
  if (!root) return;
  const api = (path = '', options) => window.api.preparedDraftRequest(path, options);
  let record = null, dirty = false, saving = false, loaded = false, generation = 0;
  let picker = null, frame = null, editorSession = '', editorDirty = false, editorItem = null;
  let working = false, activeItemId = null, publishedLink = null;
  let publishing = false, detailView = 'build';
  let saveTimer, savePromise = null, pendingSave = null, editVersion = 0, saveFailed = false, uploadItemId = null;
  let accessChecked = false, workspaceActive = false;
  let pendingMockups = [];
  const productCache = new Map(), printChoiceCache = new Map(), assetUrls = new Set();
  const assetUrlCache = new Map(), previewJobs = new Map();
  let previewWork = Promise.resolve();
  let previewCancel = null;
  let previewRenderer = null;
  const previewResume = [];
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  const button = (label, action, primary = false) => { const element = node('button', label, primary ? 'prepared-primary' : ''); element.type = 'button'; element.dataset.focus = label; element.addEventListener('click', action); return element; };
  const browser = createPreparedOrderBrowser({ root, api, openOrder: id => void openDraft(id), createOrder: createDraft, icon });
  const sides = [['front', 'Front'], ['back', 'Back'], ['left', 'Left sleeve'], ['right', 'Right sleeve']];
  const sideLabel = side => side === 'breast' ? 'Front' : sides.find(([key]) => key === side)?.[1] || side;
  const hasArtwork = item => !!item.project?.prints?.length;
  const printingMissing = item => item.printMode === 'none' ? false : item.printMode === 'manual' ? !item.manualPrints?.length : !hasArtwork(item);
  function icon(name) {
    const paths = { close: 'M6 6l12 12 M6 18 18 6', back: 'm14 6-6 6 6 6', search: 'm21 21-6-6 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14', more: 'M5 12h.01 M12 12h.01 M19 12h.01', refresh: 'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 13-1l1 6 M18 17a7 7 0 0 1-13 1l-1-6', image: 'M3 3h18v18H3z M3 16l5-5 4 4 3-3 6 6 M8 7h.01', copy: 'M9 3h12v14H9z M5 7H3v14h14v-2', upload: 'M12 16V3m-5 5 5-5 5 5 M4 16v5h16v-5', chevron: 'm9 5 7 7-7 7', check: 'm5 12 4 4L19 6', link: 'm10 13 4-4 M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M14 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0', note: 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5', edit: 'm16 3 5 5-12 12-6 1 1-6z M13 6l5 5', shirt: 'm8 3-6 4 3 5 2-1v10h10V11l2 1 3-5-6-4a4 4 0 0 1-8 0', none: 'M4 4l16 16 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', arrow: 'M4 12h16m-6-6 6 6-6 6' };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('prepared-icon'); path.setAttribute('d', paths[name] || paths.image); svg.append(path); return svg;
  }
  function textButton(label, action, name) { const control = button(label, action); control.classList.add('prepared-text-button'); if (name) control.prepend(icon(name)); return control; }
  function actionRow(label, help, name, action) {
    const control = button('', action), copy = node('span'); control.className = 'prepared-action-row'; control.dataset.focus = label;
    copy.append(node('strong', label), node('span', help, 'prepared-help')); control.append(icon(name), copy, icon('chevron')); return control;
  }
  function garmentName(item) {
    const parts = item.title.split(' - '); return parts.length > 2 ? parts[0] + ' ' + parts[parts.length - 1] : item.title;
  }
  function garmentState(item) {
    if (printingMissing(item)) return 'Choose printing';
    if (item.printMode === 'none') return 'No printing';
    if (hasArtwork(item)) return 'Artwork placed';
    if (record.mockups.some(mockup => mockup.itemIds?.includes(item.id))) return 'Supplied mockup';
    return 'Printing configured';
  }
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
    const region = document.querySelector('dialog[open] .prepared-dialog-feedback') || root.querySelector('.prepared-feedback, .prepared-browse-feedback'); if (!region) return;
    region.replaceChildren(); region.textContent = text; region.classList.toggle('prepared-error', error); region.setAttribute('role', error ? 'alert' : 'status');
  }
  function releaseUrls() { previewCancel?.cancel(); previewRenderer?.destroy(); previewRenderer = null; for (const url of assetUrls) URL.revokeObjectURL(url); assetUrls.clear(); assetUrlCache.clear(); }
  function canLeave() { return browser.canLeave?.() !== false && !saving && !working && !frame && (!(dirty || pendingMockups.length) || confirm('Leave with unsaved order changes or mockup uploads?')); }
  async function assetUrl(assetId, mime) {
    const key = record.id + ':' + assetId, current = generation;
    if (!assetUrlCache.has(key)) assetUrlCache.set(key, (async () => {
      const response = await api(`/${record.id}/assets/${assetId}`, { rawResponse: true });
      const url = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mime || 'image/png' }));
      if (generation !== current) { URL.revokeObjectURL(url); throw new Error('The order changed while its image was loading.'); }
      assetUrls.add(url); return url;
    })().catch(error => { assetUrlCache.delete(key); throw error; }));
    return assetUrlCache.get(key);
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
    ++generation; record = null; dirty = false; pendingMockups = []; releaseUrls(); loaded = true;
    await browser.load({ append });
  }
  function renderBrowse() { browser.render(); }
  async function createDraft() {
    if (!canLeave()) return;
    browser.suspend(); root.classList.remove('prepared-browsing');
    releaseUrls(); pendingMockups = []; detailView = 'build'; activeItemId = null; record = { id: crypto.randomUUID(), title: '', preparedFor: '', note: '', items: [], mockups: [] }; dirty = false; pendingSave = null; editVersion = 0; saveFailed = false; publishedLink = null;
    renderDetail();
  }
  async function openDraft(id) {
    if (!canLeave()) return;
    browser.suspend();
    const run = ++generation, loading = orderOpeningIndicator();
    for (const child of root.children) child.inert = true;
    root.setAttribute('aria-busy', 'true'); root.append(loading);
    try { const [saved, link] = await Promise.all([api(`/${id}`), api(`/${id}/link`).catch(() => ({ link: null }))]); if (run !== generation) return; releaseUrls(); detailView = 'build'; activeItemId = null; record = saved; dirty = false; pendingSave = null; editVersion = 0; saveFailed = false; publishedLink = link.link; renderDetail(); void hydrateSwatches(); }
    catch (error) { if (run === generation) { browser.render(); message(error.message, true); } }
    finally {
      loading.remove();
      if (!root.querySelector('.prepared-opening')) { root.removeAttribute('aria-busy'); for (const child of root.children) child.inert = false; }
    }
  }
  function orderOpeningIndicator() {
    const loading = node('div', undefined, 'prepared-opening'); loading.setAttribute('role', 'status'); loading.setAttribute('aria-live', 'polite');
    const picture = node('picture'), still = node('source'), robot = node('img'); picture.setAttribute('aria-hidden', 'true');
    still.media = '(prefers-reduced-motion: reduce)'; still.srcset = './Assets/prepared-order-robot-still.svg';
    robot.src = './Assets/prepared-order-robot.svg'; robot.alt = ''; robot.width = 176; robot.height = 176;
    picture.append(still, robot); loading.append(picture, node('h3', 'Opening prepared order'), node('p', 'Loading garments and artwork…', 'prepared-help')); return loading;
  }
  function openDialog(title, className = '') {
    const origin = document.activeElement, dialog = node('dialog', undefined, 'prepared-product-picker ' + className);
    const heading = node('div', undefined, 'prepared-dialog-heading'), text = node('h2', title); text.id = 'prepared-dialog-' + crypto.randomUUID();
    dialog.setAttribute('aria-labelledby', text.id); heading.append(text, button('Close', () => dialog.close())); dialog.append(heading);
    dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); if (origin?.isConnected) origin.focus(); });
    document.body.append(dialog); dialog.showModal(); return dialog;
  }
  function loadImage(image, assetId, mime) {
    const target = record.id;
    void assetUrl(assetId, mime).then(url => { if (record?.id === target && image.isConnected) image.src = url; })
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
  function paintSwatch(element, swatch) {
    element.replaceChildren(); element.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(swatch?.color || '') ? swatch.color : '';
    element.dataset.unknown = !swatch?.color && !swatch?.image ? 'true' : 'false';
    if (swatch?.image) { const image = node('img'); image.alt = ''; image.src = swatch.image; image.loading = 'lazy'; image.addEventListener('error', () => { image.remove(); if (!swatch.color) element.dataset.unknown = 'true'; }, { once: true }); element.append(image); }
  }
  function swatchChip(swatch, itemId) {
    const chip = node('span', undefined, 'prepared-swatch'); chip.setAttribute('aria-hidden', 'true'); if (itemId) chip.dataset.swatchItem = itemId; paintSwatch(chip, swatch); return chip;
  }
  async function hydrateSwatches() {
    const orderId = record?.id;
    for (const productId of new Set((record?.items || []).map(item => item.productId))) {
      try {
        const product = await getProduct(productId); if (record?.id !== orderId) return;
        for (const item of record.items.filter(item => item.productId === productId)) {
          item.swatch = product.swatches?.[item.color] || item.swatch;
          root.querySelectorAll('[data-swatch-item]').forEach(element => { if (element.dataset.swatchItem === item.id) paintSwatch(element, item.swatch); });
        }
      } catch { /* Color names remain usable when swatch metadata is unavailable. */ }
    }
  }
  function assignMockup(mockup) {
    const dialog = openDialog('Use this mockup on…'), selected = new Set(mockup.itemIds || []);
    dialog.append(node('p', 'Choose the garments this image represents. Leave all unchecked to keep it as an order reference.', 'prepared-help'));
    for (const item of record.items) {
      const label = node('label', undefined, 'prepared-checkbox'), input = node('input'); input.type = 'checkbox'; input.checked = selected.has(item.id);
      input.addEventListener('change', () => input.checked ? selected.add(item.id) : selected.delete(item.id)); label.append(input, node('span', item.title + (item.color ? ' · ' + item.color : ''))); dialog.append(label);
    }
    dialog.append(button('Apply', () => { mockup.itemIds = [...selected]; for (const item of record.items) if (selected.has(item.id)) item.mockupNeedsUpdate = false; markDirty(); dialog.close(); renderDetail(); }, true));
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
      target.project = copiedArtwork(source, target); target.printMode = 'auto'; target.proofAssetId = null; target.mockupNeedsUpdate = false;
      for (const mockup of record.mockups) mockup.itemIds = (mockup.itemIds || []).filter(id => id !== target.id);
      markDirty(); dialog.close(); queuePreview(target); renderDetail(); message('Artwork copied. Updating this garment’s mockup…');
    }));
  }
  function linkCurrent() { return publishedLink?.status === 'active' && Date.parse(publishedLink.expiresAt) > Date.now() && !dirty && !saving && !previewJobs.size && publishedLink.sourceRevision === record?.revision; }
  async function copyCustomerLink(testing = false) {
    if (!linkCurrent()) return;
    try { await navigator.clipboard.writeText(preparedCustomerUrl(publishedLink.url, testing)); message(testing ? 'Testing link copied. Opens Designer Testing 2.' : 'Customer link copied.'); }
    catch { if (testing) { const box = openDialog('Copy testing link'), input = node('input'); input.type = 'url'; input.readOnly = true; input.value = preparedCustomerUrl(publishedLink.url, true); input.setAttribute('aria-label', 'Testing link'); box.append(node('p', 'For internal testing. Opens Designer Testing 2.', 'prepared-help'), input, button('Done', () => box.close())); input.focus(); input.select(); } else { const input = root.querySelector('.prepared-customer-link input'); input?.focus(); input?.select(); message('Select and copy the customer link above.'); } }
  }
  function updateLinkStatus() {
    const active = publishedLink?.status === 'active' && Date.parse(publishedLink.expiresAt) > Date.now();
    const current = linkCurrent();
    const status = root.querySelector('.prepared-link-status');
    if (status) status.textContent = current ? 'Ready to send · Expires ' + new Date(publishedLink.expiresAt).toLocaleDateString() : active ? 'Your latest changes need to be published to this link.' : publishedLink ? 'This link is inactive. Create a new link to send.' : 'Customers choose sizes and quantities before Shopify checkout.';
    const missing = record?.items.filter(printingMissing).length || 0;
    const shortcut = root.querySelector('.prepared-link-state'); if (shortcut) shortcut.textContent = current ? 'Customer link up to date' : active ? 'Customer link needs updating' : publishedLink ? 'Customer link inactive' : 'Customer link not created';
    const publish = root.querySelector('[data-publish]'); if (publish) { publish.textContent = publishing ? 'Publishing…' : current ? 'Copy customer link' : active ? 'Update customer link' : 'Create customer link'; publish.disabled = working || !record?.items.length || missing > 0 || pendingMockups.length > 0; }
    root.querySelectorAll('[data-link-action],[data-link-refresh]').forEach(control => control.disabled = !current || working);
  }
  async function publishCustomerLink(refresh = false) {
    if (working || frame || !record.items.length) return;
    if (pendingMockups.length) { message('Finish or discard pending image uploads first.', true); return; }
    working = true; publishing = true; updateLinkStatus(); message('Saving order changes…');
    try {
      const { consumePreparedPublishResponse, preparedPublishMessage } = await import('./prepared-publish-progress.mjs');
      await flushSave();
      if (previewJobs.size) { message('Updating garment previews…'); await previewWork; await flushSave(); }
      message('Checking the customer link…');
      const response = await api('/' + record.id + '/publish', { method: 'POST', headers: { Accept: 'application/x-ndjson' }, rawResponse: true, body: JSON.stringify({ expectedRevision: record.revision, refresh }) });
      const result = await consumePreparedPublishResponse(response, progress => { const text = preparedPublishMessage(progress); if (text) message(text); });
      publishedLink = result.link; renderDetail();
      message(result.publication?.unchanged ? 'Customer link is up to date. The same link is ready to send.' : 'Customer link ready. Review it, then copy it to send.');
    }
    catch (error) { showError(root.querySelector('.prepared-feedback'), error, () => void publishCustomerLink(refresh)); }
    finally { working = false; publishing = false; updateLinkStatus(); if (dirty && !saveFailed) queueSave(); }
  }
  function customerLinkPanel() {
    const panel = node('section', undefined, 'prepared-customer-link'), info = node('div'); info.append(node('h3', 'Customer link'), node('p', '', 'prepared-help prepared-link-status'));
    panel.append(info);
    const missing = record.items.filter(printingMissing).length;
    if (missing) panel.append(node('p', 'Choose printing for ' + missing + ' item' + (missing === 1 ? '' : 's') + ' above before publishing. Missing images do not prevent checkout.', 'prepared-print-missing'));
    if (publishedLink?.url) {
      const label = node('label', 'Customer link'), input = node('input'); input.type = 'url'; input.readOnly = true; input.value = publishedLink.url; input.addEventListener('focus', () => input.select()); label.append(input);
      const actions = node('div', undefined, 'prepared-item-actions');
      const preview = button('Preview customer order', () => window.open(publishedLink.url, '_blank', 'noopener,noreferrer')); preview.dataset.linkAction = 'true';
      actions.append(preview); panel.append(label, actions);
      if (publishedLink.status === 'active') {
        const refresh = button('Refresh products and prices', () => void publishCustomerLink(true)); refresh.dataset.linkRefresh = 'true';
        const more = node('details'); const testing = button('Copy testing link', () => void copyCustomerLink(true)); testing.dataset.linkAction = 'true'; more.append(node('summary', 'Link options'), testing, node('p', 'Testing links open Designer Testing 2. Customer links use the normal website.', 'prepared-help'), refresh, button('Revoke link', async () => { if (working || !confirm('Disable this customer link? A Shopify checkout already opened from it may still be completed.')) return; working = true; updateLinkStatus(); try { await api('/' + record.id + '/revoke', { method: 'POST', body: '{}' }); publishedLink.status = 'revoked'; renderDetail(); } catch (error) { showError(root.querySelector('.prepared-feedback'), error); } finally { working = false; updateLinkStatus(); if (dirty && !saveFailed) queueSave(); } })); panel.append(more);
      }
    }
    return panel;
  }
  function editOrderDetails(notesOnly = false) {
    const dialog = openDialog(notesOnly ? 'Internal notes' : 'Order details', 'prepared-details-dialog');
    if (notesOnly) dialog.append(node('p', 'Only your team can see these notes.', 'prepared-help'), field('Internal notes', record.note, value => { record.note = value; }, { multiline: true, max: 1000 }));
    else {
      const fields = node('div', undefined, 'prepared-dialog-fields'); fields.append(field('Prepared for', record.preparedFor, value => { record.preparedFor = value; }, { max: 120 }), field('Order name (optional)', record.title, value => { record.title = value; }));
      dialog.append(node('p', 'These names appear on the customer order. You can leave them blank while assembling it.', 'prepared-help'), fields);
    }
    dialog.append(button('Done', () => dialog.close(), true)); dialog.addEventListener('close', redrawWhenActive);
  }
  function mockupDialog(itemId = null) {
    const dialog = openDialog(itemId ? 'Add a finished mockup' : 'Order reference images');
    dialog.dataset.mockupItem = itemId || '';
    dialog.append(node('p', itemId ? 'Upload or paste a finished image. It will appear on this garment for the customer; it does not create an editable design.' : 'Upload an image first, then assign it to garments. Unassigned images stay with the order and its production files.', 'prepared-help'), mockupControls(itemId));
    const feedback = node('div', '', 'prepared-feedback prepared-dialog-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    dialog.append(feedback, node('div', undefined, 'prepared-dialog-gallery')); refreshMockupDialogs(); dialog.addEventListener('close', redrawWhenActive);
  }
  function refreshMockupDialogs() {
    for (const dialog of document.querySelectorAll('dialog[data-mockup-item]')) {
      const images = record.mockups.filter(mockup => dialog.dataset.mockupItem ? mockup.itemIds?.includes(dialog.dataset.mockupItem) : !mockup.itemIds?.length);
      dialog.querySelector('.prepared-dialog-gallery').replaceChildren(mockupGallery(images));
    }
  }
  function removeGarment(item) {
      if (working || frame || !record.items.includes(item)) return false;
      const removed = new Set([item.id, ...record.items.filter(value => value.alternativeForItemId === item.id).map(value => value.id)]);
      if (!confirm('Remove ' + item.title + (removed.size > 1 ? ' and its ' + (removed.size - 1) + ' alternative(s)' : '') + '? Uploaded images will stay in this order.')) return false;
      const index = record.items.indexOf(item);
      for (const id of removed) { const job = previewJobs.get(id); previewJobs.delete(id); if (job && previewCancel?.job === job) previewCancel.cancel(); }
      record.items = record.items.filter(value => !removed.has(value.id));
      for (const mockup of record.mockups) mockup.itemIds = (mockup.itemIds || []).filter(id => !removed.has(id));
      if (removed.has(activeItemId)) activeItemId = record.items[Math.min(index, record.items.length - 1)]?.id || null;
      markDirty(); redrawWhenActive(); return true;
  }
  function garmentOptions(item) {
    const dialog = openDialog('Garment instructions', 'prepared-details-dialog');
    dialog.append(node('p', 'Visible to the customer and included with this garment in production.', 'prepared-help'), field('Instructions for this garment', item.instructions, value => { item.instructions = value; }, { multiline: true, max: 1000 }), button('Done', () => dialog.close(), true));
    dialog.addEventListener('close', redrawWhenActive);
  }
  async function garmentQuantities(item) {
    const dialog = openDialog('Sizes & quantities', 'prepared-details-dialog'), status = node('p', 'Loading sizes…', 'prepared-help');
    dialog.append(node('p', 'Optional. Enter known quantities, or leave them for your customer to choose.', 'prepared-help'), status);
    try {
      const detail = await getProduct(item.productId); if (!dialog.isConnected || !dialog.open) return;
      const reference = detail.variants.find(variant => variant.id === item.variantId);
      const variants = detail.variants.filter(variant => configurationOf(variant) === (reference ? configurationOf(reference) : item.optionLabel));
      const offered = [...new Set(variants.map(variant => variant.selectedOptions.find(option => /^size$/i.test(option.name))?.value || ''))];
      const values = { ...(item.sizeQty || {}) }, inputs = new Map(), form = node('form'), grid = node('div', undefined, 'prepared-color-options'); status.remove();
      for (const size of [...new Set([...offered, ...Object.keys(values).filter(size => values[size] > 0)])]) {
        const label = node('label', undefined, 'prepared-field'), input = node('input'); input.type = 'number'; input.min = '0'; input.max = '9999'; input.step = '1'; input.inputMode = 'numeric'; input.value = String(values[size] || 0); input.required = true;
        input.setAttribute('aria-label', (size || 'One size') + ' quantity'); label.append(node('span', size || 'One size'), input); inputs.set(size, input);
        if (!offered.includes(size)) label.append(node('span', 'Not offered on this garment. Clear this quantity or choose another garment.', 'prepared-help'));
        grid.append(label);
      }
      const feedback = node('p', '', 'prepared-help'); feedback.setAttribute('role', 'alert');
      const apply = button('Apply quantities', () => {} , true); apply.type = 'submit';
      form.append(grid, feedback, apply, textButton('Let customer choose sizes', () => { item.sizeQty = {}; markDirty(); dialog.close(); renderDetail(); }));
      form.addEventListener('submit', event => {
        event.preventDefault(); if (!form.reportValidity()) return;
        const next = Object.fromEntries([...inputs].map(([size, input]) => [size, Number(input.value)]).filter(([, quantity]) => quantity > 0));
        if (Object.keys(next).some(size => !offered.includes(size))) { feedback.textContent = 'Clear quantities for sizes this garment does not offer before applying.'; return; }
        item.sizeQty = next; markDirty(); dialog.close(); renderDetail();
      });
      dialog.append(form);
    } catch (error) { showError(status, error, () => { dialog.close(); void garmentQuantities(item); }, 'Sizes could not load. Your saved quantities have not changed.'); }
  }
  function redrawWhenActive() { if (workspaceActive && record) renderDetail(); }
  function printDescription(item) {
    if (item.printMode === 'none') return 'No printing';
    if (item.printMode === 'manual') return item.manualPrints?.length ? item.manualPrints.map(print => sideLabel(print.side) + ' · ' + (printChoiceCache.get(item.productId)?.[print.side]?.find(choice => choice.variantId === print.variantId)?.label || 'Manually configured')).join(' / ') : 'Choose at least one print location';
    if (!hasArtwork(item)) return 'Printing not chosen';
    return item.project.printSummary?.length ? item.project.printSummary.map(print => sideLabel(print.side) + ' · ' + print.label).join(' / ') : [...new Set(item.project.prints.map(print => sideLabel(print.side)))].join(' · ') + ' · From artwork';
  }
  function printSummary(item) {
    const summary = node('p', printDescription(item), printingMissing(item) ? 'prepared-print-missing' : 'prepared-print-summary');
    summary.dataset.printItem = item.id; return summary;
  }
  async function hydratePrintSummaries() {
    const orderId = record.id;
    for (const productId of new Set(record.items.filter(item => item.printMode === 'manual').map(item => item.productId))) {
      if (printChoiceCache.has(productId)) continue;
      try {
        const { choices } = await api('/' + orderId + '/print-choices?productId=' + encodeURIComponent(productId));
        if (record?.id !== orderId) return;
        printChoiceCache.set(productId, choices);
        root.querySelectorAll('[data-print-item]').forEach(summary => { const item = record.items.find(value => value.id === summary.dataset.printItem); if (item) summary.textContent = printDescription(item); });
      } catch { /* The saved locations remain readable; editing offers an explicit retry. */ }
    }
  }
  function editPrinting(item) {
    const dialog = openDialog('Print locations', 'prepared-print-dialog'), body = node('div'), feedback = node('div', '', 'prepared-feedback'), selected = new Map((item.manualPrints || []).map(print => [print.side, print.variantId]));
    dialog.append(node('p', 'Choose the printing included in the price. An image alone does not set print charges.', 'prepared-help'), body, feedback);
    const apply = button('Apply printing', () => {
      if ([...body.querySelectorAll('.prepared-print-location')].some(group => group.querySelector('input').checked && !group.querySelector('select').value)) { showError(feedback, new Error('Choose a print type for each selected location.')); return; }
      if (!selected.size) { showError(feedback, new Error('Choose a print location, or close this window and select No printing.')); return; }
      item.manualPrints = [...selected].map(([side, variantId]) => ({ side, variantId })); item.printMode = 'manual'; markDirty(); dialog.close(); renderDetail();
    }, true); apply.disabled = true; dialog.append(apply); const orderId = record.id;
    async function draw() {
      body.replaceChildren(node('p', 'Loading print options…', 'prepared-help'));
      try {
        const { choices } = await api('/' + orderId + '/print-choices?productId=' + encodeURIComponent(item.productId)); if (!dialog.isConnected || record?.id !== orderId) return;
        printChoiceCache.set(item.productId, choices); body.replaceChildren(); apply.disabled = false;
        for (const [side, title] of sides) {
          const group = node('div', undefined, 'prepared-print-location'), label = node('label', undefined, 'prepared-checkbox'), input = node('input'); input.type = 'checkbox'; input.checked = selected.has(side); label.append(input, node('strong', title)); group.append(label);
          const options = choices[side] || [], classLabel = node('label', title + ' print type'), select = node('select'), placeholder = node('option', 'Choose print type'); placeholder.value = ''; select.append(placeholder);
          for (const choice of options) { const option = node('option', choice.label); option.value = String(choice.variantId); select.append(option); }
          select.value = String(selected.get(side) || ''); classLabel.hidden = !input.checked; classLabel.append(select); group.append(classLabel);
          if (!options.length) { input.disabled = true; group.append(node('p', 'No print options configured for this side.', 'prepared-help')); }
          input.addEventListener('change', () => { classLabel.hidden = !input.checked; if (!input.checked) { selected.delete(side); select.value = ''; } else select.focus(); });
          select.addEventListener('change', () => { select.value ? selected.set(side, Number(select.value)) : selected.delete(side); }); body.append(group);
        }
      } catch (error) { showError(body, error, () => void draw()); }
    }
    void draw();
  }
  function printingControls(item) {
    const section = node('section', undefined, 'prepared-printing-controls'); section.append(node('h4', 'Printing'));
    if (printingMissing(item)) {
      section.append(node('p', 'Set the printing included in the price.', 'prepared-help'));
      const choices = node('div', undefined, 'prepared-print-actions'), manual = button('Choose print locations', () => editPrinting(item)), none = button('No printing', () => { item.printMode = 'none'; markDirty(); renderDetail(); });
      manual.prepend(icon('shirt')); none.prepend(icon('none')); choices.append(manual, none); section.append(choices, node('p', 'Artwork placement can set this automatically.', 'prepared-help'));
    } else {
      section.append(printSummary(item), textButton('Change printing', () => {
        const dialog = openDialog('Change printing'), selectMode = mode => { item.printMode = mode; markDirty(); dialog.close(); renderDetail(); };
        if (hasArtwork(item)) dialog.append(actionRow('Use artwork classification', 'Use artwork size and saved classification overrides.', 'image', () => selectMode('auto')));
        dialog.append(actionRow('Set print locations manually', 'Choose the print type on each side.', 'shirt', () => { dialog.close(); editPrinting(item); }), actionRow('No printing', 'No print charges. Artwork stays as a reference.', 'none', () => selectMode('none')));
      }));
    }
    return section;
  }
  function garmentVisual(item, compact = false) {
    const visual = node('figure', undefined, compact ? 'prepared-garment-visual prepared-review-visual' : 'prepared-garment-visual'), mockup = record.mockups.find(value => value.itemIds?.includes(item.id)), assetId = mockup?.assetId || item.proofAssetId, mime = mockup?.mime || 'image/png';
    if (previewJobs.has(item.id)) { visual.append(node('p', 'Updating mockup…', 'prepared-preview-status')); visual.setAttribute('aria-busy', 'true'); }
    else if (assetId) {
      const preview = button('', () => inspectImage(assetId, mime, mockup ? 'Supplied mockup' : 'Saved mockup')); preview.className = 'prepared-image-button prepared-main-preview'; preview.setAttribute('aria-label', 'Enlarge garment mockup');
      const image = node('img'); image.alt = item.title + ' mockup'; preview.append(image); loadImage(image, assetId, mime); visual.append(preview);
      if (!compact) visual.append(node('figcaption', mockup ? 'Supplied mockup · Click to enlarge' : item.proofKind === 'garment' ? 'Saved mockup · Click to enlarge' : 'Placement reference · No matching garment image', 'prepared-help'));
    } else if (item.image) {
      const image = node('img'); image.src = item.image; image.alt = item.title; image.addEventListener('error', () => image.replaceWith(node('p', 'Garment image unavailable. You can still prepare and sell this item.', 'prepared-help')), { once: true }); visual.append(image);
      if (!compact) visual.append(node('figcaption', 'Garment photo · No mockup added', 'prepared-help'));
    } else visual.append(node('p', 'No garment image available. You can still prepare and sell this item.', 'prepared-image-placeholder'));
    if (!compact) {
      if (!assetId) visual.append(node('p', 'A mockup is optional.', 'prepared-help'));
      if (hasArtwork(item) && !assetId && !previewJobs.has(item.id) && !item._previewError) visual.append(textButton('Generate mockup', () => { queuePreview(item); renderDetail(); }));
      if (item.mockupNeedsUpdate) visual.append(node('p', 'The previous mockup is now an order reference. Add an image for this garment or continue without one.', 'prepared-mockup-warning'));
      if (item._previewError) visual.append(node('p', item._previewError, 'prepared-help'), button('Retry preview', () => { queuePreview(item); renderDetail(); }));
      if (item.placementNeedsReview) visual.append(node('p', 'Artwork was adjusted to fit this garment. Review its placement before sending.', 'prepared-mockup-warning'));
    }
    return visual;
  }
  function showDetailView(view, itemId) {
    detailView = view; if (itemId) activeItemId = itemId; renderDetail(); root.querySelector('.prepared-scroll').scrollTop = 0;
    root.querySelector(view === 'review' ? '.prepared-review-title' : '.prepared-selected-heading h3, .prepared-order-title')?.focus({ preventScroll: true });
  }
  function renderReview(content) {
    const intro = node('div', undefined, 'prepared-review-intro'), title = node('h3', 'Review customer order', 'prepared-review-title'); title.tabIndex = -1;
    intro.append(title, node('p', 'Check every garment and its printing before publishing. Customers review prefilled quantities or choose sizes on your website.', 'prepared-help')); content.append(intro);
    if (!record.items.length) content.append(node('p', 'Add at least one garment before creating a customer link.', 'prepared-mockup-warning'));
    const list = node('div', undefined, 'prepared-review-list');
    for (const item of record.items) {
      const row = node('section', undefined, 'prepared-review-item'), info = node('div'), color = node('p', undefined, 'prepared-color-name'); color.append(swatchChip(item.swatch, item.id), node('span', item.optionLabel || item.color || item.variantTitle));
      info.append(node('h4', item.title), color, printSummary(item));
      const quantities = Object.entries(item.sizeQty || {}).filter(([, count]) => count > 0).map(([size, count]) => (size || 'One size') + ' × ' + count).join(' · ');
      info.append(node('p', quantities || 'Customer chooses sizes and quantities', 'prepared-help'));
      if (item.alternativeForItemId) info.append(node('p', 'Optional alternative to ' + garmentName(record.items.find(value => value.id === item.alternativeForItemId)), 'prepared-help'));
      if (item.instructions) info.append(node('p', 'Instructions: ' + item.instructions, 'prepared-help'));
      if (item.mockupNeedsUpdate || item.placementNeedsReview) info.append(node('p', item.placementNeedsReview ? 'Placement adjusted to fit — review artwork.' : 'Previous image kept as an order reference. A new mockup is optional.', 'prepared-mockup-warning'));
      row.append(garmentVisual(item, true), info, button(printingMissing(item) ? 'Choose printing' : 'Edit garment', () => { showDetailView('build', item.id); if (printingMissing(item)) root.querySelector('.prepared-printing-controls button')?.focus(); })); list.append(row);
    }
    content.append(list);
    const note = node('section', undefined, 'prepared-review-message'); note.append(field('Message for the customer (optional)', record.customerMessage, value => { record.customerMessage = value; }, { multiline: true, max: 240 }), node('p', 'Appears on the prepared order. Internal notes stay private.', 'prepared-help')); content.append(note);
    const references = record.mockups.filter(mockup => !mockup.itemIds?.length);
    if (references.length) { const images = node('details', undefined, 'prepared-references'); images.dataset.key = 'review-references'; images.append(node('summary', 'Order reference images · ' + references.length), node('p', 'Kept with this order and its production files. Assign images to garments to use them as garment previews.', 'prepared-help'), mockupGallery(references)); content.append(images); }
    content.append(customerLinkPanel());
  }
  function renderDetail() {
    root.classList.remove('prepared-browsing');
    const scrollTop = root.querySelector('.prepared-scroll')?.scrollTop || 0, railScrollLeft = root.querySelector('.prepared-garment-list')?.scrollLeft || 0, focusKey = document.activeElement?.dataset.focus, selection = typeof document.activeElement?.selectionStart === 'number' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const openDetails = [...root.querySelectorAll('details[data-key][open]')].map(element => element.dataset.key), item = record.items.find(value => value.id === activeItemId) || record.items[0]; activeItemId = item?.id || null;
    root.replaceChildren(); root.dataset.detailView = detailView;
    const top = node('div', undefined, 'prepared-detail-heading'), breadcrumbs = node('nav', undefined, 'prepared-breadcrumbs'); breadcrumbs.setAttribute('aria-label', 'Prepared order navigation');
    breadcrumbs.append(textButton('Prepared orders', () => void list()), node('span', '/', 'prepared-breadcrumb-divider'), node('span', record.title && record.title !== 'Untitled prepared order' ? record.title : record.preparedFor ? record.preparedFor + '’s order' : 'New order'));
    const status = node('span', '', 'prepared-save-status'); status.setAttribute('role', 'status'); top.append(breadcrumbs, status);
    const scroll = node('div', undefined, 'prepared-scroll'), content = node('div', undefined, 'prepared-content'), orderHeader = node('header', undefined, 'prepared-order-header'), identity = node('div'), title = node('h2', record.preparedFor ? 'Order for ' + record.preparedFor : record.title && record.title !== 'Untitled prepared order' ? record.title : 'New prepared order', 'prepared-order-title'); title.tabIndex = -1;
    identity.append(title, node('p', 'Customers review quantities or choose their sizes before checkout.', 'prepared-help'));
    const linkState = textButton('', () => showDetailView('review'), 'link'); linkState.classList.add('prepared-link-shortcut'); linkState.append(node('span', '', 'prepared-link-state')); identity.append(linkState);
    const headerActions = node('div', undefined, 'prepared-order-actions'); headerActions.append(textButton('Edit order details', () => editOrderDetails(), 'edit'), textButton('Internal notes' + (record.note ? ' · Added' : ''), () => editOrderDetails(true), 'note')); orderHeader.append(identity, headerActions); content.append(orderHeader);
    if (detailView === 'review') renderReview(content);
    else {
      const workbench = node('div', undefined, 'prepared-workbench'), rail = node('nav', undefined, 'prepared-garment-rail'); rail.setAttribute('aria-label', 'Garments in this order');
      const railHeading = node('div', undefined, 'prepared-section-heading'); railHeading.append(node('h3', 'Garments · ' + record.items.length), textButton('Add garments', () => void openPicker())); rail.append(railHeading);
      const garmentList = node('div', undefined, 'prepared-garment-list');
      for (const garment of record.items) {
        const select = button('', () => { activeItemId = garment.id; renderDetail(); }); select.className = 'prepared-garment-choice'; select.dataset.focus = 'garment-' + garment.id; select.setAttribute('aria-pressed', String(garment.id === activeItemId)); select.title = garment.title;
        const name = node('span'), color = node('span', undefined, 'prepared-color-name'), state = node('span', undefined, 'prepared-garment-state'); color.append(swatchChip(garment.swatch, garment.id), node('span', garment.optionLabel || garment.color || garment.variantTitle)); state.append(icon(printingMissing(garment) ? 'shirt' : hasArtwork(garment) ? 'check' : 'image'), node('span', garmentState(garment))); name.append(node('strong', garmentName(garment)), color, state);
        const mockup = record.mockups.find(value => value.itemIds?.includes(garment.id)), assetId = mockup?.assetId || garment.proofAssetId, thumb = thumbnail(assetId ? null : garment.image);
        if (assetId) { thumb.replaceChildren(); const image = node('img'); image.alt = ''; thumb.append(image); loadImage(image, assetId, mockup?.mime); }
        if (garment.alternativeForItemId) { select.classList.add('prepared-alternative-choice'); name.append(node('small', 'Alternative to ' + garmentName(record.items.find(value => value.id === garment.alternativeForItemId)), 'prepared-help')); }
        select.append(thumb, name); garmentList.append(select);
      }
      rail.append(garmentList); workbench.append(rail);
      const panel = node('section', undefined, 'prepared-selected-garment');
      if (!item) {
        const empty = node('div', undefined, 'prepared-empty'); empty.append(icon('shirt'), node('h3', 'What are we preparing?'), node('p', 'Choose garments and colors, or start with a mockup you already have.', 'prepared-help'), button('Add garments', () => void openPicker(), true), textButton('Upload or paste a mockup', () => mockupDialog(), 'upload')); panel.append(empty);
      } else {
        panel.classList.add('prepared-item'); panel.setAttribute('aria-label', item.title);
        const heading = node('header', undefined, 'prepared-selected-heading'), label = node('div'), shortName = garmentName(item), garmentTitle = node('h3', shortName); garmentTitle.tabIndex = -1; label.append(garmentTitle);
        const garmentActions = node('div', undefined, 'prepared-garment-actions'), remove = textButton('Remove garment', () => removeGarment(item)); remove.classList.add('prepared-danger');
        garmentActions.append(textButton('Change garment', () => void openPicker(item)), remove);
        if (shortName !== item.title) label.append(node('p', item.title.split(' - ').slice(1, -1).join(' · '), 'prepared-help')); heading.append(label, garmentActions); panel.append(heading);
        if (!item.alternativeForItemId) panel.append(textButton('Add alternative', () => void openPicker(null, null, item, false, item.id)));
        else panel.append(node('p', 'Optional alternative to ' + garmentName(record.items.find(value => value.id === item.alternativeForItemId)) + '. Prepare its actual color, artwork and printing before publishing.', 'prepared-help'));
        const colorBar = node('div', undefined, 'prepared-color-bar'), colorControl = button('', () => void openPicker(item, item.productId, null, true)); colorControl.className = 'prepared-color-trigger'; colorControl.dataset.focus = 'Change color'; colorControl.append(swatchChip(item.swatch, item.id), node('strong', item.color || item.optionLabel || 'Default'), node('span', item.color ? 'Change color' : 'Change options', 'prepared-color-change')); colorBar.append(colorControl, textButton('Add another color', () => void openPicker(null, item.productId, item, true))); panel.append(colorBar);
        const mockups = record.mockups.filter(mockup => mockup.itemIds?.includes(item.id)), prints = item.project?.prints?.length || 0, composition = node('div', undefined, 'prepared-garment-composition'), tools = node('div', undefined, 'prepared-garment-tools'), artwork = node('section', undefined, 'prepared-artwork-setup'); artwork.append(node('h4', 'Artwork & mockup'));
        if (!prints && !mockups.length) artwork.append(node('p', 'How would you like to prepare this garment?', 'prepared-help'), actionRow('Place artwork', 'Upload a design and position it on the garment', 'image', () => void openEditor(item)), actionRow('Copy artwork from another item', 'Reuse a design already in this order', 'copy', () => reuseArtwork(item)), actionRow('Upload or paste a mockup', 'Use a finished image you already have', 'upload', () => mockupDialog(item.id)));
        else {
          artwork.append(node('p', prints ? prints + ' artwork layer' + (prints === 1 ? '' : 's') + ' · Editable design' : 'Supplied image · No editable design', 'prepared-help'));
          if (prints) artwork.append(actionRow('Edit artwork', 'Adjust placement, size or rotation', 'edit', () => void openEditor(item)));
          if (mockups.length) artwork.append(actionRow('Manage supplied mockups', mockups.length + ' image' + (mockups.length === 1 ? '' : 's') + ' · Add, assign or remove', 'image', () => mockupDialog(item.id)));
          const alternatives = node('details', undefined, 'prepared-artwork-alternatives'); alternatives.dataset.key = 'artwork-' + item.id; alternatives.append(node('summary', 'Other artwork options'));
          if (!prints) alternatives.append(textButton('Place artwork', () => void openEditor(item), 'image')); alternatives.append(textButton('Copy artwork from another item', () => reuseArtwork(item), 'copy')); if (!mockups.length) alternatives.append(textButton('Add a supplied mockup', () => mockupDialog(item.id), 'upload')); artwork.append(alternatives);
        }
        const quantity = Object.values(item.sizeQty || {}).reduce((sum, value) => sum + value, 0);
        tools.append(artwork, printingControls(item), textButton('Sizes & quantities' + (quantity ? ' · ' + quantity + ' garments' : ' · Customer chooses'), () => void garmentQuantities(item)), textButton(item.instructions ? 'Garment instructions · Added' : 'Garment instructions', () => garmentOptions(item), 'note')); composition.append(garmentVisual(item), tools); panel.append(composition);
        panel.querySelectorAll('button,input,textarea,select').forEach(element => { element.dataset.focus = (element.dataset.focus || element.textContent) + '-' + item.id; });
      }
      workbench.append(panel); content.append(workbench);
      const references = record.mockups.filter(mockup => !mockup.itemIds?.length), refs = node('section', undefined, 'prepared-references prepared-order-references'), refsHeading = node('div', undefined, 'prepared-section-heading'); refsHeading.append(node('h3', 'Order reference images' + (references.length ? ' · ' + references.length : '')), textButton('Add reference images', () => mockupDialog(), 'upload')); refs.append(refsHeading, node('p', 'Images for the whole order. Assign them to garments to use as customer mockups.', 'prepared-help')); if (references.length) refs.append(mockupGallery(references)); content.append(refs);
    }
    if (pendingMockups.length) content.append(node('p', pendingMockups.length + ' image upload(s) waiting. Completed uploads are kept.', 'prepared-help'), button('Retry image uploads', () => void uploadMockups([...pendingMockups], uploadItemId)), button('Discard pending uploads', () => { pendingMockups = []; renderDetail(); })); scroll.append(content);
    const feedback = node('div', '', 'prepared-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const footer = node('footer', undefined, 'prepared-footer'), progress = node('div'), missing = record.items.filter(printingMissing).length; progress.append(node('strong', record.items.length + ' garment' + (record.items.length === 1 ? '' : 's') + (missing ? ' · Printing needed on ' + missing + ' item' + (missing === 1 ? '' : 's') : '')), node('p', 'Your work saves automatically.', 'prepared-help'));
    const actions = node('div', undefined, 'prepared-footer-actions');
    if (detailView === 'review') { const publish = button('Create customer link', () => linkCurrent() ? void copyCustomerLink() : void publishCustomerLink(), true); publish.dataset.publish = 'true'; actions.append(textButton('Back to garments', () => showDetailView('build')), publish); }
    else { const review = button('Review customer order', () => showDetailView('review'), true); review.append(icon('arrow')); actions.append(textButton('Save & close', () => void list()), review); }
    footer.append(progress, actions); root.append(top, scroll, feedback, footer); scroll.scrollTop = scrollTop; updateSaveStatus(); refreshMockupDialogs(); void hydratePrintSummaries();
    const garmentList = root.querySelector('.prepared-garment-list'), selected = garmentList?.querySelector('[aria-pressed=true]');
    if (garmentList && selected && getComputedStyle(garmentList).flexDirection === 'row') {
      garmentList.scrollLeft = railScrollLeft;
      const listBounds = garmentList.getBoundingClientRect(), selectedBounds = selected.getBoundingClientRect();
      if (selectedBounds.left < listBounds.left) garmentList.scrollLeft += selectedBounds.left - listBounds.left;
      else if (selectedBounds.right > listBounds.right) garmentList.scrollLeft += selectedBounds.right - listBounds.right;
    }
    for (const key of openDetails) root.querySelectorAll('details[data-key]').forEach(details => { if (details.dataset.key === key) details.open = true; });
    if (focusKey) { const focused = [...root.querySelectorAll('[data-focus]')].find(element => element.dataset.focus === focusKey); focused?.focus({ preventScroll: true }); if (selection && focused?.setSelectionRange) focused.setSelectionRange(...selection); }
  }
  async function uploadAsset(file) {
    const orderId = record.id, run = generation;
    const saved = await api(`/${orderId}/assets`, { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
    // Raster uploads are already in memory. Reuse those bytes instead of downloading them again.
    // SVG must still be read back after the server sanitizes it.
    const key = orderId + ':' + saved.assetId;
    if (record?.id === orderId && generation === run && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && !assetUrlCache.has(key)) {
      const url = URL.createObjectURL(file); assetUrls.add(url); assetUrlCache.set(key, Promise.resolve(url));
    }
    return saved;
  }
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
      while (pendingMockups.length) { const file = pendingMockups[0]; const saved = await uploadAsset(file); record.mockups.push({ ...saved, name: file.name, itemIds: itemId && record.items.some(item => item.id === itemId) ? [itemId] : [] }); const item = record.items.find(item => item.id === itemId); if (item) item.mockupNeedsUpdate = false; pendingMockups.shift(); markDirty(); }
      if (!record.items.length && (!record.title || record.title === 'Untitled prepared order')) { record.title = valid[0].name.replace(/\.[^.]+$/, '') + ' order'; markDirty(); }
      await flushSave(); renderDetail(); message(itemId ? 'Mockup added to this garment.' : 'Mockup saved. Use Assign garments when you are ready.');
    } catch (error) { renderDetail(); showError(root.querySelector('.prepared-feedback'), error, () => pendingMockups.length ? void uploadMockups([...pendingMockups], uploadItemId) : void flushSave().catch(() => {})); }
    finally { working = false; if (dirty && !saveFailed) queueSave(); }
  }
  async function pasteMockup(itemId, native) {
    try { for (const item of await navigator.clipboard.read()) { const type = item.types.find(value => ['image/png', 'image/jpeg', 'image/webp'].includes(value)); if (type) { await uploadMockups([new File([await item.getType(type)], 'Pasted mockup.png', { type })], itemId); return; } } message('Copy an image, then paste it here or use Upload mockup.', true); }
    catch { native.hidden = false; native.focus(); message('Paste into the image field, or choose Upload mockup.'); }
  }
  function queuePreview(item) {
    const job = { itemId: item.id, orderId: record.id, signature: previewSignature(item) };
    previewJobs.set(item.id, job); delete item._previewError;
    previewWork = previewWork.catch(() => {}).then(async () => {
      const current = () => record?.id === job.orderId && previewJobs.get(item.id) === job && record.items.includes(item) && previewSignature(item) === job.signature;
      try {
        if (!current()) return;
        if (frame) await new Promise(resolve => previewResume.push(resolve));
        if (!current()) return;
        const assets = {};
        const assetReads = [...new Map((item.project?.prints || []).map(print => [print.asset.assetId, print])).values()].map(async print => {
          if (print.type !== 'image') throw new Error('Open Edit artwork to review this project.');
          assets[print.asset.assetId] = { url: await assetUrl(print.asset.assetId, print.asset.mime), mime: print.asset.mime };
        });
        const [, product] = await Promise.all([flushSave(), getProduct(item.productId), ...assetReads]);
        if (!current()) return;
        previewRenderer ||= createPreparedPreviewRenderer({ window, document });
        const renderer = previewRenderer;
        previewCancel = { job, cancel: () => renderer.cancel() };
        const payload = await renderer.render({ session: crypto.randomUUID(), title: item.title, handle: item.handle, color: item.color, config: product.config, project: item.project, assets });
        if (!current()) return;
        let proofAssetId = null;
        if (payload.proof instanceof Blob) proofAssetId = (await uploadAsset(payload.proof)).assetId;
        if (!current()) return;
        Object.assign(item, { project: payload.project, proofAssetId, proofSide: payload.proofSide, proofKind: payload.proofKind, placementNeedsReview: payload.placementAdjusted === true });
        if (!proofAssetId) item._previewError = 'Artwork is saved. A mockup could not be generated; retry the preview.';
        markDirty();
      } catch (error) { if (current()) item._previewError = error.message; }
      finally { if (previewCancel?.job === job) previewCancel = null; if (previewJobs.get(item.id) === job) previewJobs.delete(item.id); if (record?.id === job.orderId && !frame) renderDetail(); }
    });
  }
  async function getProduct(id) { if (!productCache.has(id)) productCache.set(id, api(`/product/${encodeURIComponent(id)}`).catch(error => { productCache.delete(id); throw error; })); return productCache.get(id); }
  function applyGarmentPicks(picks, replaceItem = null, copyFrom = null, alternativeForItemId = null) {
    if (!picks.length || (replaceItem && picks.length !== 1)) throw new Error('Choose a garment and color.');
    if (!replaceItem && record.items.length + picks.length > 30) throw new Error('Use up to 30 garments in one order.');
    const changed = [];
    for (const { detail, variant } of picks) {
      const color = colorOf(variant), previous = replaceItem || copyFrom;
      const previousMockups = record.mockups.some(mockup => mockup.itemIds?.includes(previous?.id));
      const next = { id: replaceItem?.id || crypto.randomUUID(), productId: detail.id, variantId: variant.id, handle: detail.handle, title: detail.title, variantTitle: variant.title, color, optionLabel: configurationOf(variant), swatch: detail.swatches?.[color] || {}, image: variant.image?.url || detail.image, instructions: previous?.instructions || '', project: previous?.project ? copiedArtwork(previous, { productId: detail.id }) : null, proofAssetId: null, printMode: previous?.printMode || null, sizeQty: replaceItem?.sizeQty ? { ...replaceItem.sizeQty } : {}, manualPrints: previous?.manualPrints ? structuredClone(previous.manualPrints) : [], mockupNeedsUpdate: previousMockups };
      const alternativeRoot = replaceItem?.alternativeForItemId || alternativeForItemId || copyFrom?.alternativeForItemId;
      if (alternativeRoot) next.alternativeForItemId = alternativeRoot;
      if (replaceItem) {
        if (replaceItem.productId === next.productId && replaceItem.variantId === next.variantId) continue;
        Object.assign(replaceItem, next);
        for (const mockup of record.mockups) mockup.itemIds = (mockup.itemIds || []).filter(value => value !== replaceItem.id);
      } else { record.items.push(next); activeItemId = next.id; }
      changed.push(replaceItem || next);
    }
    if (!record.title || record.title === 'Untitled prepared order') record.title = record.preparedFor ? 'Order for ' + record.preparedFor : picks[0].detail.title;
    markDirty(); for (const item of changed) if (item.project?.prints?.length) queuePreview(item); renderDetail();
    if (changed.some(item => item.project?.prints?.length)) message('Artwork kept. Updating the garment mockups…');
    else if (changed.some(item => item.mockupNeedsUpdate)) message('Previous mockups remain as order references. Paste or upload an updated mockup for the new color.');
  }
  async function openPicker(replaceItem = null, productId = null, copyFrom = null, colorOnly = false, alternativeForItemId = null) {
    if (working || frame || picker) return;
    if (!replaceItem && record.items.length >= 30) { message('Use up to 30 garments in one order.', true); return; }
    if (!colorOnly) {
      picker = openPreparedGarmentFinder({ api, getProduct, openDialog, thumbnail, swatchChip, icon, replaceItem, existingItems: record.items,
        onApply: picks => applyGarmentPicks(picks, replaceItem, copyFrom, alternativeForItemId),
        onClose: () => { picker = null; root.querySelector('.prepared-garment-rail button')?.focus(); } });
      return;
    }
    const dialog = openDialog(colorOnly ? replaceItem ? replaceItem.color ? 'Change color' : 'Change options' : copyFrom?.color ? 'Add another color' : 'Add another option' : replaceItem ? 'Change garment' : 'Add garments'); picker = dialog;
    const form = node('form'), search = node('input'); search.type = 'search'; search.placeholder = 'Search garment names or styles'; search.setAttribute('aria-label', 'Search garment names or styles'); search.maxLength = 120;
    const submit = button('Search', () => {}); submit.type = 'submit'; form.append(search, submit);
    form.hidden = colorOnly;
    const status = node('div', '', 'prepared-feedback'); status.setAttribute('role', 'status');
    const results = node('div', undefined, 'prepared-catalog-results'); dialog.append(form, status, results);
    let requestVersion = 0, nextCursor = null;
    async function chooseProduct(id) {
      const version = ++requestVersion; status.replaceChildren(); status.textContent = 'Loading colors…'; results.replaceChildren();
      try {
        const detail = await getProduct(id); if (version !== requestVersion || picker !== dialog) return;
        status.replaceChildren(); const summary = node('div', undefined, 'prepared-item-summary'); summary.append(thumbnail(detail.image), node('h3', detail.title)); results.append(summary);
        const currentVariant = detail.variants.find(variant => variant.id === (replaceItem || copyFrom)?.variantId);
        summary.firstElementChild.replaceWith(thumbnail(currentVariant?.image?.url || detail.image));
        const variants = colorVariants(detail, currentVariant, colorOnly), colors = variants.map(configurationOf);
        const selected = new Set(replaceItem ? [currentVariant ? configurationOf(currentVariant) : colors[0]] : []);
        const choices = node('div', undefined, 'prepared-color-options');
        results.append(node('p', replaceItem ? 'Choose a color or option.' : 'Choose colors or options. Each selection becomes a garment in this order.', 'prepared-help'));
        const apply = button(replaceItem ? 'Update garment' : 'Add selected garments', () => {
          const chosen = variants.filter(variant => selected.has(configurationOf(variant)));
          if (!chosen.length) return;
          if (!replaceItem && record.items.length + chosen.length > 30) { status.textContent = 'Use up to 30 garments in one order.'; return; }
          applyGarmentPicks(chosen.map(variant => ({ detail, variant })), replaceItem, copyFrom); dialog.close();
        }, true);
        const sync = () => { const unchanged = replaceItem && detail.id === replaceItem.productId && currentVariant && selected.size === 1 && selected.has(configurationOf(currentVariant)); apply.disabled = !selected.size || !detail.variants.length || !!unchanged; };
        for (const color of colors) {
          const label = node('label', undefined, 'prepared-checkbox'), input = node('input'); input.type = replaceItem ? 'radio' : 'checkbox'; input.name = 'garment-color'; input.checked = selected.has(color);
          const variant = variants.find(variant => configurationOf(variant) === color), alreadyAdded = !replaceItem && copyFrom && record.items.some(item => item.productId === detail.id && item.optionLabel === color);
          input.disabled = !!alreadyAdded;
          input.addEventListener('change', () => { if (replaceItem) selected.clear(); input.checked ? selected.add(color) : selected.delete(color); if (input.checked) summary.firstElementChild.replaceWith(thumbnail(variant.image?.url || detail.image)); sync(); }); label.append(input, swatchChip(detail.swatches?.[colorOf(variant)]), node('span', colorOnly ? colorOf(variant) || color || 'Default' : color || 'Default')); if (alreadyAdded) label.append(node('span', 'In this order', 'prepared-help')); choices.append(label);
        }
        if (colors.length === 1 && !choices.querySelector('input').disabled) { selected.add(colors[0]); choices.querySelector('input').checked = true; }
        results.append(choices, node('p', 'Sizes and quantities are not needed for artwork preparation.', 'prepared-help'));
        if (replaceItem?.project?.prints?.length || record.mockups.some(mockup => mockup.itemIds?.includes(replaceItem?.id))) results.append(node('p', 'Artwork will be kept for review. Mockups of the previous garment will become order references.', 'prepared-help'));
        if (!detail.variants.length) status.textContent = 'This product has no variants to add.';
        results.append(apply); if (!colorOnly) results.append(button('Choose another product', () => void browse())); sync();
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
    if (!colorOnly) search.focus(); if (productId || replaceItem) await chooseProduct(productId || replaceItem.productId); else await browse();
  }
  function closeEditor() {
    frame?.remove(); frame = null; editorItem = null; editorSession = ''; editorDirty = false;
    root.classList.remove('prepared-editor-open'); renderDetail(); for (const resume of previewResume.splice(0)) resume(); if (dirty) queueSave();
  }
  async function openEditor(item) {
    if (working || frame) return;
    working = true;
    try {
      const pendingPreview = previewJobs.get(item.id);
      previewJobs.delete(item.id);
      // With no job, both values can be undefined. That is not a preview to cancel.
      if (pendingPreview && previewCancel?.job === pendingPreview) previewCancel.cancel();
      message('Loading placement editor…');
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
        Object.assign(item, { project: data.payload.project, proofAssetId, proofSide: data.payload.proofSide, proofKind: data.payload.proofKind, placementNeedsReview: false }); markDirty();
        await flushSave();
        reply({ saved: true }); closeEditor(); message(proofAssetId ? 'Artwork placement and preview saved.' : 'Artwork placement saved. A preview could not be generated.'); return;
      }
      throw new Error('This editor action is unavailable.');
    } catch (error) { reply(null, error.message); }
  });
  window.addEventListener('beforeunload', event => { if (dirty || editorDirty || saving || working || pendingMockups.length) { event.preventDefault(); event.returnValue = ''; } });
  window.OrderManagerNavigation.register('prepared', { onEnter: async () => {
    workspaceActive = true;
    if (!accessChecked) {
      const run = ++generation;
      root.replaceChildren(node('p', 'Checking admin access…', 'prepared-feedback'));
      try {
        const result = await api(''); if (run !== generation) return;
        browser.seed(result); loaded = true; accessChecked = true;
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
    else void list();
  }, canLeave: () => {
    if (frame) { message('Return from artwork editing before leaving this order.', true); return false; }
    return canLeave();
  }, onLeave: () => { browser.suspend(); workspaceActive = false; ++generation; clearTimeout(saveTimer); document.querySelectorAll('dialog.prepared-product-picker').forEach(dialog => dialog.close()); releaseUrls(); root.replaceChildren(); productCache.clear(); printChoiceCache.clear(); } });
})();
