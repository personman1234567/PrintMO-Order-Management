import { colorOf, configurationOf, colorVariants } from './prepared-color-model.mjs';
import { colorFamilies } from './prepared-catalog-model.mjs';
const el = (tag, text, className) => { const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element; };
const button = (text, action, className = '') => { const control = el('button', text, className); control.type = 'button'; control.addEventListener('click', action); return control; };
const recent = new Map();
const queryCache = new Map();
export function rememberFinderProduct(product) { recent.delete(product.id); recent.set(product.id, product); if (recent.size > 8) recent.delete(recent.keys().next().value); }
export function finderQuery(query, filters, after) {
  const params = new URLSearchParams({ q: query });
  for (const [key, values] of Object.entries(filters)) if (values.size) params.set(key, [...values].sort().join('|'));
  if (after) params.set('after', after);
  return '/catalog/finder?' + params.toString().replace(/\+/g, '%20');
}
export function openPreparedGarmentFinder({ api, getProduct, openDialog, thumbnail, swatchChip, icon, replaceItem, existingItems, onApply, onClose }) {
  const dialog = openDialog(replaceItem ? 'Change garment' : 'Add garments', 'prepared-garment-finder');
  const origin = document.activeElement;
  let closed = false, query = '', results = [], facets = { type: [], brand: [], family: [] }, after = null, total = 0;
  let current = null, selectedDetail = null, requestVersion = 0, detailVersion = 0, timer, filterKey = null, showFilters = false, filterBackup = null, browseRecent = false, applying = false;
  const filters = { status: new Set(), type: new Set(), brand: new Set(), family: new Set() }, selections = new Map(), detailCache = new Map(), indexed = new Map();
  const top = el('div', null, 'prepared-finder-search'), inputWrap = el('label'), input = el('input'); input.type = 'search'; input.placeholder = matchMedia('(max-width:760px)').matches ? 'Search garments' : 'Search name, brand, style or SKU'; input.maxLength = 120; input.setAttribute('aria-label', 'Search garments by name, brand, style or SKU'); inputWrap.append(icon('search'), input);
  const filterToggle = button('Filters', openMobileFilters, 'prepared-finder-filter-toggle'); filterToggle.setAttribute('aria-expanded', 'false');
  const refresh = button('', () => { queryCache.clear(); void search(false, true); }, 'prepared-finder-refresh'); refresh.append(icon('refresh')); refresh.setAttribute('aria-label', 'Refresh garment catalog'); refresh.title = 'Refresh garment catalog'; top.append(inputWrap, filterToggle, refresh);
  const filterBar = el('div', null, 'prepared-finder-filterbar'), filterPanel = el('div', null, 'prepared-finder-filterpanel'), chips = el('div', null, 'prepared-finder-chips');
  const mobileFilters = el('section', null, 'prepared-finder-mobile-filters'); mobileFilters.setAttribute('aria-label', 'Garment filters');
  const body = el('div', null, 'prepared-finder-body'), browse = el('section', null, 'prepared-finder-browse'), detail = el('section', null, 'prepared-finder-detail'); browse.setAttribute('aria-label', 'Garment results'); detail.setAttribute('aria-label', 'Selected garment');
  const resultStatus = el('p', '', 'prepared-help prepared-finder-result-count'), resultList = el('div', null, 'prepared-finder-results'); browse.append(resultStatus, resultList); body.append(browse, detail);
  const feedback = el('p', '', 'prepared-finder-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  const footer = el('div', null, 'prepared-finder-footer'), selectionInfo = el('div'), apply = button('', async () => {
    if (applying || !selections.size) return;
    applying = true; apply.disabled = true;
    try { await onApply([...selections.values()]); for (const value of selections.values()) rememberFinderProduct(value.detail); dialog.close(); }
    catch (error) { feedback.textContent = error.message; feedback.setAttribute('role', 'alert'); }
    finally { applying = false; updateSelection(); }
  }, 'prepared-primary'); footer.append(selectionInfo, apply);
  dialog.append(top, filterBar, filterPanel, chips, mobileFilters, body, feedback, footer);
  const headingClose = dialog.querySelector('.prepared-dialog-heading button');
  if (headingClose) headingClose.addEventListener('click', event => { if (applying || showFilters) event.stopImmediatePropagation(); if (showFilters) finishMobileFilters(false); }, true);
  dialog.addEventListener('cancel', event => { if (applying || showFilters) event.preventDefault(); if (showFilters) finishMobileFilters(false); });
  dialog.addEventListener('close', () => { closed = true; clearTimeout(timer); ++requestVersion; ++detailVersion; onClose(); if (origin?.isConnected) origin.focus(); });
  function key(detail, variant) { return detail.id + ':' + configurationOf(variant); }
  function openMobileFilters() {
    filterBackup = Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, new Set(values)]));
    showFilters = true; dialog.dataset.filters = 'true'; filterToggle.setAttribute('aria-expanded', 'true');
    dialog.querySelector('.prepared-dialog-heading h2').textContent = 'Filter garments'; if (headingClose) headingClose.textContent = 'Back';
    renderMobileFilters(); mobileFilters.querySelector('summary')?.focus();
  }
  function finishMobileFilters(commit, force = false) {
    if (!commit && filterBackup) for (const [key, values] of Object.entries(filterBackup)) filters[key] = values;
    filterBackup = null; showFilters = false; dialog.dataset.filters = 'false'; filterToggle.setAttribute('aria-expanded', 'false');
    dialog.querySelector('.prepared-dialog-heading h2').textContent = replaceItem ? 'Change garment' : 'Add garments'; if (headingClose) headingClose.textContent = 'Close';
    filterControls(); filterToggle.focus(); if (commit) void search(false, force);
  }
  function renderMobileFilters() {
    mobileFilters.replaceChildren(); const scroll = el('div', null, 'prepared-finder-mobile-filter-scroll');
    for (const [key, title] of [['status', 'Status'], ['type', 'Garment type'], ['brand', 'Brand'], ['family', 'Color family']]) {
      const section = el('details'), summary = el('summary'), label = el('span', title), count = el('span', filters[key].size ? `${filters[key].size} selected` : 'Any', 'prepared-help'); summary.append(label, count); section.append(summary);
      section.name = 'prepared-garment-facets';
      const values = key === 'status' ? ['ACTIVE', 'UNLISTED'] : facets[key] || [], options = el('div', null, 'prepared-finder-mobile-filter-options');
      if (key === 'brand') { const search = el('input'); search.type = 'search'; search.placeholder = 'Find a brand'; search.setAttribute('aria-label', 'Find a brand'); search.addEventListener('input', () => { for (const row of options.children) row.hidden = !row.textContent.toLowerCase().includes(search.value.toLowerCase()); }); section.append(search); }
      for (const value of values) {
        const row = el('label'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = filters[key].has(value);
        checkbox.addEventListener('change', () => { checkbox.checked ? filters[key].add(value) : filters[key].delete(value); count.textContent = filters[key].size ? `${filters[key].size} selected` : 'Any'; });
        row.append(checkbox, el('span', value === 'ACTIVE' ? 'Active' : value === 'UNLISTED' ? 'Unlisted' : value)); options.append(row);
      }
      section.append(options); scroll.append(section);
    }
    scroll.append(button('Refresh catalog', () => { queryCache.clear(); finishMobileFilters(true, true); }, 'prepared-finder-clear'));
    const actions = el('div', null, 'prepared-finder-mobile-filter-actions');
    actions.append(button('Clear filters', () => { Object.values(filters).forEach(values => values.clear()); renderMobileFilters(); }), button('Show garments', () => finishMobileFilters(true), 'prepared-primary'));
    mobileFilters.append(scroll, actions);
  }
  function updateSelection() {
    const mobile = matchMedia('(max-width:760px)').matches;
    selectionInfo.replaceChildren(el('strong', selections.size ? mobile ? `${selections.size} selected` : `${selections.size} garment option${selections.size === 1 ? '' : 's'} selected` : mobile ? 'Select garments' : 'Choose a garment and its colors'), el('span', 'Customer chooses sizes and quantities later.', 'prepared-help'));
    if (selections.size) selectionInfo.append(button('Clear selection', () => { selections.clear(); renderResults(); if (selectedDetail) renderDetail(selectedDetail); updateSelection(); }, 'prepared-finder-clear'));
    const unchanged = replaceItem && selections.size === 1 && [...selections.values()].some(v => v.detail.id === replaceItem.productId && v.variant.id === replaceItem.variantId);
    apply.textContent = replaceItem ? 'Update garment' : `Add ${selections.size || ''} garment${selections.size === 1 ? '' : 's'}`.replace('  ', ' ');
    apply.disabled = applying || !selections.size || Boolean(unchanged);
    filterToggle.textContent = `Filters${Object.values(filters).some(v => v.size) ? ' · ' + Object.values(filters).reduce((n, v) => n + v.size, 0) : ''}`;
  }
  function filterControls() {
    const position = filterPanel.scrollTop, activeFilter = document.activeElement?.dataset?.finderFilter;
    filterBar.replaceChildren(); chips.replaceChildren();
    for (const [key, label] of [['status', 'Status'], ['type', 'Garment type'], ['brand', 'Brand'], ['family', 'Color family']]) {
      const control = button(label + (filters[key].size ? ' · ' + filters[key].size : ''), () => { filterKey = filterKey === key ? null : key; filterControls(); });
      control.dataset.finderFilter = key; control.setAttribute('aria-expanded', String(filterKey === key)); filterBar.append(control);
      for (const value of filters[key]) {
        const chip = button(key === 'status' ? value === 'ACTIVE' ? 'Active' : 'Unlisted' : value, () => { filters[key].delete(value); filterControls(); void search(); }, 'prepared-finder-chip'); chip.append(icon('close')); chip.setAttribute('aria-label', 'Remove filter ' + value); chips.append(chip);
      }
    }
    if (recent.size) { const control = button('Recently used', () => { browseRecent = !browseRecent; void search(); }); control.setAttribute('aria-pressed', String(browseRecent)); filterBar.append(control); }
    filterBar.append(button('Refresh catalog', () => { queryCache.clear(); void search(false, true); }, 'prepared-finder-mobile-refresh'));
    if (Object.values(filters).some(v => v.size) || browseRecent) chips.append(button('Clear filters', () => { Object.values(filters).forEach(v => v.clear()); browseRecent = false; filterKey = null; filterControls(); void search(); }, 'prepared-finder-clear'));
    filterPanel.replaceChildren(); filterPanel.hidden = !filterKey;
    if (filterKey) {
      const values = filterKey === 'status' ? ['ACTIVE', 'UNLISTED'] : facets[filterKey] || [];
      if (filterKey === 'family') filterPanel.append(el('p', 'Matches offered colors, not stock levels. Unmapped colors remain available without a color filter.', 'prepared-help'));
      for (const value of values) {
        const label = el('label'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = filters[filterKey].has(value); checkbox.dataset.finderFilter = filterKey + ':' + value;
        const facet = filterKey; checkbox.addEventListener('change', () => { checkbox.checked ? filters[facet].add(value) : filters[facet].delete(value); filterControls(); void search(); });
        label.append(checkbox, el('span', value === 'ACTIVE' ? 'Active' : value === 'UNLISTED' ? 'Unlisted' : value)); filterPanel.append(label);
      }
    }
    if (activeFilter) [...dialog.querySelectorAll('[data-finder-filter]')].find(element => element.dataset.finderFilter === activeFilter)?.focus({ preventScroll: true });
    filterPanel.scrollTop = position;
    updateSelection();
  }
  function renderResults() {
    const top = resultList.scrollTop; resultList.replaceChildren();
    for (const product of results) {
      const row = button('', () => void choose(product.id), 'prepared-finder-result'); row.dataset.productId = product.id; row.setAttribute('aria-pressed', String(current === product.id));
      const copy = el('span'), title = el('strong', product.title), meta = el('span', [product.status === 'UNLISTED' ? 'Unlisted' : '', product.garmentType].filter(Boolean).join(' · '), 'prepared-help'); copy.append(title, meta);
      const colorRow = el('span', null, 'prepared-finder-mini-swatches');
      const colors = [...(product.colors || [])].sort((a, b) => Number(b.families?.some(f => filters.family.has(f))) - Number(a.families?.some(f => filters.family.has(f))));
      for (const color of colors.slice(0, 6)) { const swatch = swatchChip(color); swatch.title = color.name; colorRow.append(swatch); }
      if (colors.length > 6) colorRow.append(el('span', '+' + (colors.length - 6), 'prepared-help')); copy.append(colorRow);
      const count = [...selections.values()].filter(v => v.detail.id === product.id).length;
      if (count) copy.append(el('span', `${count} selected`, 'prepared-finder-selected-count'));
      row.append(thumbnail(product.image), copy); resultList.append(row);
    }
    if (!results.length) {
      const empty = el('div', null, 'prepared-finder-empty'); empty.append(el('h3', browseRecent ? 'No matching recent garments' : 'No garments match'), el('p', 'Try a different name or remove one of the active filters.', 'prepared-help'), button('Clear search and filters', () => { input.value = ''; query = ''; Object.values(filters).forEach(v => v.clear()); browseRecent = false; filterControls(); void search(); })); resultList.append(empty);
    }
    if (after) resultList.append(button('Load more garments', () => void search(true)));
    resultList.scrollTop = top;
  }
  async function search(append = false, force = false) {
    const version = ++requestVersion; query = input.value; clearTimeout(timer);
    const path = finderQuery(query, filters, append ? after : null) + (force ? '&refresh=1' : ''); feedback.replaceChildren(); feedback.setAttribute('role', 'status'); resultStatus.textContent = force ? 'Refreshing catalog from Shopify…' : 'Updating garments…'; resultList.setAttribute('aria-busy', 'true'); refresh.disabled = true;
    try {
      const cached = queryCache.get(path);
      let pending = cached?.until > Date.now() ? cached.promise : null;
      if (!pending) { pending = api(path); queryCache.set(path, { promise: pending, until: Date.now() + 60000 }); if (queryCache.size > 40) queryCache.delete(queryCache.keys().next().value); }
      let response;
      try { response = await pending; } catch (error) { queryCache.delete(path); throw error; }
      if (closed || version !== requestVersion) return;
      facets = response.facets; after = response.hasNextPage ? response.endCursor : null; total = response.total;
      let products = response.products;
      if (browseRecent) {
        // Ask the same server-side search for each recent ID across all pages;
        // the API can scope its compact index without loading variant details.
        const recentPath = path + '&recent=' + encodeURIComponent([...recent.keys()].join('|'));
        response = await api(recentPath); if (closed || version !== requestVersion) return;
        products = response.products; after = response.hasNextPage ? response.endCursor : null; total = response.total;
      }
      for (const product of products) indexed.set(product.id, product);
      results = append ? [...results, ...products.filter(p => !results.some(value => value.id === p.id))] : products;
      resultStatus.textContent = `${total} garment${total === 1 ? '' : 's'}${browseRecent ? ' · Recently used' : ''}`;
      if (!append) resultList.scrollTop = 0;
      renderResults(); filterControls(); if (showFilters) renderMobileFilters();
    } catch (error) { if (!closed && version === requestVersion) { resultStatus.textContent = 'Garments could not update.'; feedback.textContent = error.message; feedback.setAttribute('role', 'alert'); feedback.append(button('Retry search', () => void search())); } }
    finally { if (!closed && version === requestVersion) { resultList.setAttribute('aria-busy', 'false'); refresh.disabled = false; } }
  }
  async function choose(id) {
    if (replaceItem && current !== id) { selections.clear(); updateSelection(); }
    const version = ++detailVersion; current = id; dialog.dataset.detail = 'true'; renderResults();
    resultList.querySelector(`[data-product-id="${id}"]`)?.focus({ preventScroll: true });
    detail.replaceChildren(button('Back to results', back, 'prepared-finder-back'), el('p', 'Loading garment colors…', 'prepared-help'));
    try {
      if (!detailCache.has(id)) detailCache.set(id, getProduct(id).catch(error => { detailCache.delete(id); throw error; }));
      const product = await detailCache.get(id); if (closed || version !== detailVersion) return;
      selectedDetail = product;
      const options = colorVariants(product, null, false);
      if (!replaceItem && options.length === 1) selections.set(key(product, options[0]), { detail: product, variant: options[0] });
      renderDetail(product);
      if (matchMedia('(max-width: 760px)').matches) detail.querySelector('button')?.focus();
    } catch (error) { if (!closed && version === detailVersion) { detail.replaceChildren(button('Back to results', back, 'prepared-finder-back'), el('p', error.message, 'prepared-error'), button('Retry colors', () => void choose(id))); } }
  }
  function back() { dialog.dataset.detail = 'false'; resultList.querySelector(`[data-product-id="${current}"]`)?.focus({ preventScroll: true }); }
  function renderDetail(product) {
    const scroll = detail.scrollTop; detail.replaceChildren(button('Back to results', back, 'prepared-finder-back'));
    const identity = el('div', null, 'prepared-finder-product'); identity.append(thumbnail(product.image), el('h3', product.title)); detail.append(identity);
    if (product.status === 'UNLISTED') detail.append(el('p', 'Unlisted · Available for prepared orders', 'prepared-help'));
    const colorSearch = el('input'); colorSearch.type = 'search'; colorSearch.placeholder = 'Find a color'; colorSearch.setAttribute('aria-label', 'Find a color in this garment');
    const options = el('div', null, 'prepared-finder-colors'), reference = product.variants.find(v => v.id === replaceItem?.variantId);
    const variants = colorVariants(product, reference, false), showAll = button('Show all colors', () => { matchingOnly = false; renderColors(); });
    let matchingOnly = filters.family.size > 0;
    const familyOf = variant => {
      const color = colorOf(variant), indexColor = indexed.get(product.id)?.colors.find(c => c.name === color);
      return indexColor?.families || colorFamilies(color, product.swatches?.[color]?.color);
    };
    function renderColors() {
      options.replaceChildren();
      const sorted = [...variants].sort((a, b) => Number(familyOf(b).some(f => filters.family.has(f))) - Number(familyOf(a).some(f => filters.family.has(f))));
      const visible = sorted.filter(variant => (!matchingOnly || familyOf(variant).some(f => filters.family.has(f))) && configurationOf(variant).toLowerCase().includes(colorSearch.value.toLowerCase()));
      for (const variant of visible) {
        const label = el('label'), input = el('input'); input.type = replaceItem ? 'radio' : 'checkbox'; input.name = 'finder-color'; input.dataset.variant = variant.id; input.checked = selections.has(key(product, variant));
        const color = colorOf(variant), copy = el('span', configurationOf(variant));
        if (existingItems.some(item => item.productId === product.id && (item.optionLabel || item.color) === configurationOf(variant))) copy.append(el('small', 'In this order', 'prepared-help'));
        input.addEventListener('change', () => { if (replaceItem) selections.clear(); input.checked ? selections.set(key(product, variant), { detail: product, variant }) : selections.delete(key(product, variant)); const position = detail.scrollTop; renderColors(); renderResults(); updateSelection(); [...options.querySelectorAll('input')].find(element => element.dataset.variant === variant.id)?.focus({ preventScroll: true }); detail.scrollTop = position; });
        label.append(input, swatchChip(product.swatches?.[color]), copy); options.append(label);
      }
      if (!visible.length) options.append(el('p', 'No matching colors. Clear the color search or show all colors.', 'prepared-help'));
      showAll.hidden = !matchingOnly;
    }
    colorSearch.addEventListener('input', renderColors);
    if (replaceItem && reference && product.id === replaceItem.productId && !selections.size) selections.set(key(product, reference), { detail: product, variant: reference });
    detail.append(el('h4', replaceItem ? 'Choose a color or option' : 'Choose colors or options'), colorSearch, showAll, options);
    if (!product.variants.length) detail.append(el('p', 'This product has no variants to add.', 'prepared-help'));
    renderColors(); updateSelection(); detail.scrollTop = scroll;
  }
  input.addEventListener('input', () => { clearTimeout(timer); ++requestVersion; timer = setTimeout(() => void search(), 300); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } });
  filterControls(); updateSelection(); detail.append(el('h3', 'Find the right garment'), el('p', 'Select a result to see its colors. Your selections stay here while you browse.', 'prepared-help'));
  void search(); if (replaceItem) void choose(replaceItem.productId); else input.focus();
  return dialog;
}
