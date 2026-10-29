import {preparedCustomerUrl} from './prepared-customer-url.mjs';
const STATES = {
  ready: ['Link ready', 'success'], changes: ['Unpublished changes', 'warning'],
  none: ['No customer link', 'neutral'], expired: ['Expired', 'neutral'],
  disabled: ['Link disabled', 'neutral'], publishing: ['Updating link', 'neutral'],
  unknown: ['Link status unavailable', 'neutral'],
};
const el = (tag, text, className) => { const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element; };
const control = (label, action, className = '') => { const button = el('button', label, className); button.type = 'button'; button.addEventListener('click', action); return button; };
export function preparedOrderListState(key) { return STATES[key] || STATES.unknown; }
export function preparedListDate(value, now = new Date()) {
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return '';
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  return date.toDateString() === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export function createPreparedOrderBrowser({ root, api, openOrder, createOrder, icon }) {
  let rows = [], counts = { current: 0, archived: 0, all: 0 }, total = 0, cursor = null;
  let query = '', view = 'current', sort = 'recent', selecting = false, busy = false, loading = false;
  let version = 0, timer, scrollTop = 0, observer = null, menu = null, lastMessage = '', lastError = false;
  const selected = new Map(), urls = new Map(), thumbnailQueue = [];
  let thumbnailRunning = 0;
  const iconControl = (label, action, name) => { const button = control('', action, 'prepared-list-icon'); button.setAttribute('aria-label', label); button.title = label; button.append(icon(name)); return button; };
  function remember() { const scroll = root.querySelector('.prepared-browse-scroll'); if (scroll) scrollTop = scroll.scrollTop; }
  function notice(text, error = false) {
    lastMessage = text; lastError = error;
    const status = root.querySelector('.prepared-browse-feedback');
    if (status) { status.textContent = text; status.classList.toggle('prepared-error', error); status.setAttribute('role', error ? 'alert' : 'status'); }
  }
  function dismissMenu() { if (menu) { menu.remove(); menu = null; } }
  function releaseImages() { observer?.disconnect(); observer = null; thumbnailQueue.length = 0; for (const value of urls.values()) value.then(url => URL.revokeObjectURL(url)).catch(() => {}); urls.clear(); }
  function suspend() { remember(); clearTimeout(timer); ++version; loading = false; dismissMenu(); releaseImages(); }
  function seed(result) { rows = result.drafts; counts = result.counts || counts; total = result.total ?? rows.length; cursor = result.cursor; }
  async function load({ append = false, resetScroll = false } = {}) {
    if (busy) return;
    remember(); if (resetScroll) { scrollTop = 0; const scroll = root.querySelector('.prepared-browse-scroll'); if (scroll) scroll.scrollTop = 0; }
    const run = ++version; loading = true; dismissMenu();
    if (!append) releaseImages();
    render();
    try {
      const params = new URLSearchParams({ q: query, view, sort }); if (append && cursor) params.set('cursor', cursor);
      const result = await api('?' + params.toString().replace(/\+/g, '%20')); if (run !== version) return;
      rows = append ? [...rows, ...result.drafts.filter(row => !rows.some(existing => existing.id === row.id))] : result.drafts;
      counts = result.counts; total = result.total; cursor = result.cursor;
      // Refresh selection revisions without selecting any newly loaded orders.
      for (const row of rows) if (selected.has(row.id)) selected.set(row.id, row);
    } catch (error) { if (run === version) notice(error.message || 'Orders could not load. Use Refresh to retry.', true); }
    finally { if (run === version) { loading = false; render(); } }
  }
  function dialog(title, origin) {
    dismissMenu(); const box = el('dialog', null, 'prepared-list-dialog');
    const heading = el('h2', title); heading.id = 'prepared-list-dialog-' + crypto.randomUUID(); box.setAttribute('aria-labelledby', heading.id); box.append(heading);
    box.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    box.addEventListener('close', () => { box.remove(); if (origin?.isConnected) origin.focus(); else root.querySelector('.prepared-list-select')?.focus(); });
    document.body.append(box); return box;
  }
  function rename(row, origin) {
    const box = dialog('Rename prepared order', origin), label = el('label', 'Order name'), input = el('input');
    input.value = row.title; input.maxLength = 160; input.required = true; label.append(input);
    box.append(label, el('p', 'This name also appears on the customer order after you publish the update.', 'prepared-help'));
    const error = el('p', '', 'prepared-error'); error.setAttribute('role', 'alert'); box.append(error);
    const form = el('form'), actions = el('div', null, 'prepared-list-dialog-actions');
    const cancel = control('Cancel', () => box.close()), save = el('button', 'Save name', 'prepared-primary'); save.type = 'submit'; actions.append(cancel, save); form.append(label, actions); box.append(form);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || !input.value.trim()) return;
      busy = true; save.disabled = cancel.disabled = true; save.textContent = 'Saving…';
      try { await api('/' + row.id + '/manage', { method: 'POST', body: JSON.stringify({ action: 'rename', title: input.value.trim(), expectedRevision: row.revision, mutationId: crypto.randomUUID() }) }); busy = false; box.close(); notice('Order renamed.'); await load(); }
      catch (failure) { error.textContent = failure.message; }
      finally { busy = false; save.disabled = cancel.disabled = false; save.textContent = 'Save name'; }
    });
    box.showModal(); input.focus(); input.select();
  }
  async function mutate(action, targets, box) {
    if (busy || !targets.length) return;
    busy = true; dismissMenu();
    box?.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const failed = [], succeeded = []; let next = 0, completed = 0;
    const report = () => { const text = `${action === 'delete' ? 'Deleting' : action === 'restore' ? 'Restoring' : 'Archiving'} orders… ${completed} of ${targets.length}`; notice(text); const status = box?.querySelector('[role=status]'); if (status) status.textContent = text; };
    render(); report();
    await Promise.all(Array.from({ length: Math.min(2, targets.length) }, async () => {
      while (next < targets.length) {
        const row = targets[next++];
        try { await api('/' + row.id + '/manage', { method: 'POST', body: JSON.stringify({ action, expectedRevision: row.revision, mutationId: crypto.randomUUID() }) }); succeeded.push(row); selected.delete(row.id); }
        catch (error) { failed.push({ row, message: error.message }); }
        completed++; report();
      }
    }));
    busy = false; box?.close();
    selecting = failed.length > 0; for (const item of failed) selected.set(item.row.id, item.row);
    const verb = action === 'delete' ? 'deleted' : action === 'restore' ? 'restored' : 'archived';
    notice(failed.length ? `${succeeded.length} ${verb}; ${failed.length} could not finish. ${failed[0].message} Refresh and review before retrying.` : `${succeeded.length} order${succeeded.length === 1 ? '' : 's'} ${verb}.`, Boolean(failed.length));
    await load();
    // Archive has no effect on link state. A quick Undo restores the same work.
    if (action === 'archive' && !failed.length) {
      const status = root.querySelector('.prepared-browse-feedback');
      status?.append(' Customer links are unchanged. ', control('Undo', () => void mutate('restore', succeeded), 'prepared-list-undo'));
    }
  }
  function confirmDelete(targets, origin) {
    const box = dialog(targets.length === 1 ? 'Delete prepared order?' : `Delete ${targets.length} prepared orders?`, origin);
    box.append(el('p', targets.length === 1 ? `“${targets[0].title}” will be removed from this list.` : 'The selected preparations will be removed from this list.'));
    box.append(el('p', 'Their customer links will be disabled. Archiving keeps both the work and customer links available instead.'));
    box.append(el('p', 'Purchased orders and production files are kept. A Shopify checkout already opened may still be completed.', 'prepared-help'));
    const status = el('p', ''); status.setAttribute('role', 'status'); const actions = el('div', null, 'prepared-list-dialog-actions');
    actions.append(control('Cancel', () => box.close()), control('Delete', () => void mutate('delete', targets, box), 'prepared-delete-confirm'));
    box.append(status, actions); box.showModal(); actions.firstChild.focus();
  }
  async function customerLink(row, preview, button, testing = false) {
    if (busy) return; button.disabled = true;
    const target = preview ? window.open('about:blank', '_blank') : null;
    if (target) target.opener = null;
    try {
      const { link } = await api('/' + row.id + '/link');
      if (link?.status !== 'active' || Date.parse(link.expiresAt) <= Date.now()) throw new Error('This customer link is inactive. Open the order to create a new one.');
      const url = new URL(preparedCustomerUrl(link.url, testing)); if (url.protocol !== 'https:' || url.hostname !== 'print-mo.com' || url.pathname !== '/pages/designer-studio') throw new Error('The customer address could not be verified. Open the order and retry.');
      if (preview) { if (target) target.location.replace(url.href); else throw new Error('Allow pop-ups to preview this customer order.'); }
      else {
        try { await navigator.clipboard.writeText(url.href); notice(testing ? 'Testing link copied. Opens Designer Testing 2.' : 'Customer link copied.'); if (!testing) button.textContent = 'Copied'; }
        catch { const box = dialog(testing ? 'Copy testing link' : 'Copy customer link', button), input = el('input'); input.value = url.href; input.readOnly = true; input.setAttribute('aria-label', testing ? 'Testing link' : 'Customer link'); box.append(el('p', testing ? 'For internal testing. Opens Designer Testing 2.' : 'Select and copy this customer link.'), input, control('Done', () => box.close())); box.showModal(); input.focus(); input.select(); }
      }
    } catch (error) { target?.close(); notice(error.message, true); }
    finally { button.disabled = false; }
  }
  function openMenu(row, origin) {
    dismissMenu(); const panel = el('div', null, 'prepared-list-menu'); panel.setAttribute('popover', 'auto'); panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', `Actions for ${row.title}`);
    panel.append(control('Rename', () => rename(row, origin)));
    if (['ready', 'changes'].includes(row.linkState)) panel.append(control(row.linkState === 'changes' ? 'Preview published version' : 'Preview customer order', () => void customerLink(row, true, origin)));
    if (['ready', 'changes'].includes(row.linkState)) panel.append(control('Copy testing link', () => void customerLink(row, false, origin, true)));
    panel.append(control(row.archivedAt ? 'Restore' : 'Archive', () => void mutate(row.archivedAt ? 'restore' : 'archive', [row])));
    panel.append(control('Delete…', () => confirmDelete([row], origin), 'prepared-danger'));
    document.body.append(panel); menu = panel;
    if (panel.showPopover) panel.showPopover(); else { panel.removeAttribute('popover'); panel.addEventListener('keydown', event => { if (event.key === 'Escape') { dismissMenu(); origin.focus(); } }); }
    const rect = origin.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(rect.right - bounds.width, innerWidth - bounds.width - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - bounds.height - 8)) + 'px';
    panel.querySelector('button').focus();
    panel.addEventListener('toggle', event => { if (event.newState === 'closed') { panel.remove(); if (menu === panel) menu = null; origin.focus(); } });
  }
  function thumbnail(row) {
    const holder = el('span', null, 'prepared-thumbnail prepared-list-thumbnail'); holder.append(icon('shirt'));
    const data = row.thumbnail;
    if (data?.image && /^https:\/\/cdn\.shopify\.com\//.test(data.image)) {
      const image = el('img'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.src = data.image;
      image.addEventListener('load', () => holder.replaceChildren(image)); image.addEventListener('error', () => image.remove()); holder.append(image);
    } else if (data?.assetId && /^image\/(png|jpeg|webp)$/.test(data.mime)) {
      holder._preparedThumbnail = { row, data }; observer?.observe(holder);
    }
    return holder;
  }
  function pumpThumbnails() {
    while (thumbnailRunning < 3 && thumbnailQueue.length) {
      const holder = thumbnailQueue.shift(), { row, data } = holder._preparedThumbnail, key = row.id + ':' + data.assetId;
      if (!holder.isConnected) continue;
      thumbnailRunning++;
      if (!urls.has(key)) urls.set(key, api('/' + row.id + '/assets/' + data.assetId, { rawResponse: true }).then(async response => URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: data.mime }))).catch(error => { urls.delete(key); throw error; }));
      urls.get(key).then(url => { if (holder.isConnected) { const image = el('img'); image.alt = ''; image.decoding = 'async'; image.src = url; image.addEventListener('error', () => holder.replaceChildren(icon('shirt'))); holder.replaceChildren(image); } }).catch(() => {}).finally(() => { thumbnailRunning--; pumpThumbnails(); });
    }
  }
  function render() {
    const editingSearch = document.activeElement?.matches('.prepared-list-search input');
    const caret = editingSearch ? document.activeElement.selectionStart : null;
    remember(); dismissMenu(); observer?.disconnect(); root.replaceChildren(); root.classList.add('prepared-browsing');
    const scroll = el('div', null, 'prepared-scroll prepared-browse-scroll'), content = el('div', null, 'prepared-browse-content');
    const header = el('div', null, 'prepared-browse-header');
    const create = control('', () => { remember(); createOrder(); }, 'prepared-primary prepared-list-create');
    create.append(el('span', 'New prepared order', 'prepared-create-long'), el('span', 'New order', 'prepared-create-short')); create.disabled = busy;
    const host = root.parentElement?.querySelector('.prepared-workspace-heading');
    if (host) { host.querySelector('.prepared-list-create')?.remove(); host.insertBefore(create, host.querySelector('#dashboard-menu-toggle, .app-menu-button') || null); }
    else header.append(create);
    header.prepend(el('p', 'Pick up where you left off, or start something new.', 'prepared-help'));
    const card = el('section', null, 'prepared-browse-card'); card.setAttribute('aria-label', 'Saved prepared orders');
    const tabs = el('div', null, 'prepared-list-tabs'); tabs.setAttribute('aria-label', 'Order list');
    for (const [key, label] of [['current', 'Current'], ['archived', 'Archived'], ['all', 'All']]) {
      const tab = control('', () => { if (view !== key) { view = key; selected.clear(); selecting = false; void load({ resetScroll: true }); } });
      tab.append(el('span', label), el('span', String(counts[key]), 'prepared-list-count')); tab.setAttribute('aria-pressed', String(view === key)); tab.disabled = busy; tabs.append(tab);
    }
    const toolbar = el('div', null, 'prepared-list-toolbar'), searchWrap = el('label', null, 'prepared-list-search'), search = el('input');
    search.type = 'search'; search.placeholder = 'Search prepared orders'; search.value = query; search.setAttribute('aria-label', 'Search customers, order names, or garments'); search.disabled = busy;
    search.addEventListener('input', () => { query = search.value; selected.clear(); clearTimeout(timer); timer = setTimeout(() => void load({ resetScroll: true }), 300); });
    searchWrap.append(icon('search'), search);
    const select = control(selecting ? 'Done' : 'Select', () => { selecting = !selecting; if (!selecting) selected.clear(); render(); }, 'prepared-list-select'); select.disabled = busy;
    const sortWrap = el('label', null, 'prepared-list-sort'); sortWrap.append(el('span', 'Sort orders', 'prepared-visually-hidden'));
    const sortInput = el('select'); for (const [value, label] of [['recent', 'Recently edited'], ['name', 'Order name']]) { const option = el('option', label); option.value = value; sortInput.append(option); } sortInput.value = sort; sortInput.disabled = busy;
    sortInput.addEventListener('change', () => { sort = sortInput.value; void load({ resetScroll: true }); }); sortWrap.append(sortInput);
    const refresh = iconControl('Refresh orders', () => void load(), 'refresh'); refresh.disabled = busy || loading;
    toolbar.append(searchWrap, select, sortWrap, refresh); card.append(tabs, toolbar);
    if (selecting) {
      const bulk = el('div', null, 'prepared-list-bulk'), label = el('label'), all = el('input'); all.type = 'checkbox';
      all.checked = rows.length > 0 && rows.every(row => selected.has(row.id)); all.indeterminate = !all.checked && rows.some(row => selected.has(row.id)); all.disabled = busy || !rows.length;
      all.addEventListener('change', () => { for (const row of rows) all.checked ? selected.set(row.id, row) : selected.delete(row.id); render(); });
      label.append(all, el('span', selected.size ? `${selected.size} selected` : 'Select listed orders')); bulk.append(label);
      for (const [action, title] of [['archive', 'Archive'], ['restore', 'Restore'], ['delete', 'Delete']]) {
        const targets = [...selected.values()].filter(row => action === 'delete' || (action === 'restore' ? row.archivedAt : !row.archivedAt));
        if (action === 'restore' && view === 'current' || action === 'archive' && view === 'archived') continue;
        const button = control(title, event => action === 'delete' ? confirmDelete(targets, event.currentTarget) : void mutate(action, targets), action === 'delete' ? 'prepared-danger' : ''); button.disabled = busy || !targets.length; bulk.append(button);
      } card.append(bulk);
    }
    const feedback = el('div', lastMessage, 'prepared-browse-feedback' + (lastError ? ' prepared-error' : '')); feedback.setAttribute('role', lastError ? 'alert' : 'status'); feedback.setAttribute('aria-live', 'polite'); card.append(feedback);
    const list = el('div', null, 'prepared-order-list'); list.setAttribute('aria-busy', String(loading));
    observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { observer?.unobserve(entry.target); thumbnailQueue.push(entry.target); } pumpThumbnails(); }, { root: scroll, rootMargin: '160px' }) : null;
    if (loading && !rows.length) { const pending = el('p', 'Loading prepared orders…', 'prepared-list-empty'); pending.setAttribute('role', 'status'); list.append(pending); }
    for (const row of rows) {
      const line = el('article', null, 'prepared-order-list-row');
      if (selecting) { const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(row.id); checkbox.disabled = busy; checkbox.setAttribute('aria-label', 'Select ' + row.title); checkbox.addEventListener('change', () => { checkbox.checked ? selected.set(row.id, row) : selected.delete(row.id); render(); }); line.append(checkbox); }
      const identity = control('', () => { remember(); openOrder(row.id); }, 'prepared-list-identity'); identity.disabled = busy;
      const copy = el('span', null, 'prepared-list-identity-copy');
      copy.append(el('strong', row.title), el('span', [row.preparedFor, row.archivedAt ? 'Archived' : '', row.itemCount ? `${row.itemCount} garment style${row.itemCount === 1 ? '' : 's'}` : 'No garments', preparedListDate(row.updatedAt)].filter(Boolean).join(' · '), 'prepared-list-meta'));
      const thumb = thumbnail(row); identity.append(thumb, copy); line.append(identity);
      const [label, tone] = preparedOrderListState(row.linkState), status = el('span', label, 'prepared-list-status'); status.dataset.tone = tone; line.append(status);
      const action = row.linkState === 'ready' ? control('Copy link', event => void customerLink(row, false, event.currentTarget), 'prepared-list-action') : control(row.linkState === 'changes' ? 'Review changes' : row.linkState === 'none' ? 'Continue' : 'Open order', () => { remember(); openOrder(row.id); }, 'prepared-list-action'); action.disabled = busy; line.append(action);
      const more = iconControl('Actions for ' + row.title, () => openMenu(row, more), 'more'); more.disabled = busy; line.append(more); list.append(line);
      if (!observer && thumb._preparedThumbnail) thumbnailQueue.push(thumb);
    }
    if (!loading && !rows.length) {
      const empty = el('div', null, 'prepared-list-empty'); empty.append(icon('shirt'), el('h3', query ? 'No matching prepared orders' : view === 'archived' ? 'No archived orders' : 'Your next order starts here'), el('p', query ? 'Try a customer name, order name, or garment style.' : view === 'archived' ? 'Orders you archive will be kept here. Their customer links stay available.' : 'Choose garments, add artwork or mockups, then share a customer link.'));
      if (!query && view !== 'archived') empty.append(control('New prepared order', createOrder, 'prepared-primary')); list.append(empty);
    }
    card.append(list); const footer = el('div', null, 'prepared-list-footer'); footer.append(el('span', `${loading ? 'Updating… ' : ''}Showing ${rows.length} of ${total} ${view === 'all' ? '' : view + ' '}order${total === 1 ? '' : 's'}`));
    if (cursor) { const more = control('Load more', () => void load({ append: true })); more.disabled = busy || loading; footer.append(more); } card.append(footer);
    content.append(header, card); scroll.append(content); root.append(scroll); scroll.scrollTop = scrollTop; pumpThumbnails();
    if (editingSearch && !search.disabled) { search.focus({ preventScroll: true }); if (caret != null) search.setSelectionRange?.(caret, caret); }
  }
  return { load, seed, render, suspend, remember, canLeave: () => !busy };
}
