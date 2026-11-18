const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const safeFilename = value => String(value).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'storefront';
const dateLabel = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const freezeSnapshot = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
};
const readableFailure = (error, stage) => {
  const code = String(error?.code || '').toUpperCase();
  if (error?.status === 401 || /AUTH|TOKEN|SESSION/.test(code)) return 'Your reporting session expired. Reopen Order Manager, then try again.';
  if (error?.status === 403 || /FORBIDDEN|ACCESS_DENIED|SCOPE/.test(code)) return 'This session cannot read the requested reports. Check reporting access, then try again.';
  if (error?.status === 429 || /THROTTL|BUSY|LIMIT/.test(code)) return 'Reporting is busy or this range is too large. Try a smaller date range or retry shortly.';
  if (/DISABLED|UNAVAILABLE|NOT_CONFIGURED/.test(code)) return 'Live reporting is unavailable. Refresh the app or try again later.';
  return stage === 'owners' ? 'Storefront owners could not be loaded. Check your connection, then retry.' : 'This report could not be prepared. Check your connection and date range, then generate previews to retry.';
};

// Mounted only when the Reports workspace is opened. All dynamic assets share its release.
export async function mountReports({ root, assetBase }) {
  if (!root) throw new Error('The Reports workspace needs a root element.');
  const base = new URL(assetBase || './', import.meta.url);
  const assetUrl = path => { const url = new URL(path, base); url.search = base.search; return url.href; };
  const { OWNERS, defaultPeriod, validatePeriod, createSampleSnapshot, createZip } = await import(assetUrl('./storefront-reports-model.mjs'));
  const doc = root.ownerDocument;
  // An existing app API means this is the real app. Missing methods/errors never enable samples.
  const liveMode = Boolean(doc.defaultView?.api);
  root.dataset.reportsMode = liveMode ? 'live' : 'sample';
  let owners = liveMode ? [] : [...OWNERS];
  let ownersLoading = false;
  let ownersError = false;
  let ownerGeneration = 0;
  let ownerController = null;
  let ownerPromise = null;
  let ownerPickerInitialized = false;
  let selectionInitialized = !liveMode;
  let requestedOwnerId = null;
  const firstPeriod = defaultPeriod('month-to-date');
  const preferences = { owners: new Set(owners[0] ? [owners[0].id] : []), preset: 'month-to-date', start: firstPeriod.start, end: firstPeriod.end, search: '' };
  let active = false;
  let busy = false;
  let generation = 0;
  let generationController = null;
  let results = [];
  let runKey = '';
  let rendererPromise;
  let viewerPromise;
  let previewGeneration = 0;
  let selectedPreview = null;
  let pdfDocument = null;
  let loadingTask = null;
  let renderTask = null;
  let pageRenderGeneration = 0;
  let pageRendering = false;
  let currentPage = 1;
  const blobUrls = new Set();

  root.innerHTML = `
    <div class="reports-scroll">
      ${liveMode ? '' : '<p class="reports-sample-notice"><strong>Sample data</strong> — fictional sales, not connected to Shopify.</p>'}
      <div class="reports-layout">
        <form class="reports-configuration" novalidate>
          <fieldset class="reports-selection-controls" aria-label="Report selection">
            <details class="reports-owner-picker" open>
            <summary><span>Storefront owners</span><span class="reports-owner-count"></span><small class="reports-owner-selected"></small></summary>
            <label class="reports-field reports-owner-search-field" hidden>Find an owner<input class="reports-owner-search" type="search" placeholder="Search owners" autocomplete="off"></label>
            <div class="reports-owner-tools"><button type="button" data-reports-action="select-all">Select all</button><button type="button" data-reports-action="clear-owners">Clear</button></div>
            <div class="reports-owner-list" role="group" aria-label="Storefront owners"></div>
            <p class="reports-owner-status" role="status" aria-live="polite"></p><button type="button" data-reports-action="retry-owners" class="reports-owner-retry" hidden>Retry owners</button>
            </details>
            <div class="reports-period-section"><h3>Orders placed</h3><label class="reports-field">Date range<select class="reports-period-preset"><option value="month-to-date">This month so far</option><option value="last-month">Last month</option><option value="all-time">All time</option><option value="custom">Custom dates</option></select></label>
              <div class="reports-dates"><label class="reports-field">Start date<input class="reports-start-date" type="date" required></label><label class="reports-field">End date<input class="reports-end-date" type="date" required></label></div>
              <p class="reports-help">Central time</p>
            </div>
          </fieldset>
          <p class="reports-form-error" role="alert" hidden></p>
          <div class="reports-generate-actions"><button type="submit" class="reports-primary reports-generate">Generate previews</button><button type="button" class="reports-cancel" data-reports-action="cancel" hidden>Cancel</button></div>
          <p class="reports-generation-status" role="status" aria-live="polite"></p>
          <details class="reports-method"><summary>How earnings are calculated</summary><p>Reports group orders by the date they were placed, using Central time. Fulfillment and refunds reflect current Shopify data. Earnings deduct the matching catalog price once. Unresolved inputs are marked Needs review. Earnings are not a payment balance.</p></details>
        </form>
        <section class="reports-output" aria-label="Report results" hidden>
          <div class="reports-output-heading"><h3>Reports</h3><button type="button" data-reports-action="download-selected" class="reports-download-selected" disabled>Download selected reports</button></div>
          <p class="reports-stale-notice" role="status" hidden>Selections changed. The PDFs below keep their original owners and dates. Generate previews to update them.</p>
          <div class="reports-results" role="group" aria-label="Generated reports"></div>
          <p class="reports-export-note" role="status" hidden></p>
          <div class="reports-preview-empty"><h3>No reports generated</h3><p></p></div>
          <section class="reports-preview" aria-label="PDF preview" hidden>
            <div class="reports-preview-header"><div><h4 class="reports-preview-title"></h4><p class="reports-preview-period"></p></div><button type="button" data-reports-action="download-current">Download PDF</button></div>
            <div class="reports-review-warning" role="status" hidden></div>
            <div class="reports-page-toolbar"><span class="reports-preview-kind">${liveMode ? 'PDF preview' : 'Sample PDF preview'}</span><div><button type="button" data-reports-action="previous-page" aria-label="Previous PDF page">Previous</button><span class="reports-page-label" aria-live="polite"></span><button type="button" data-reports-action="next-page" aria-label="Next PDF page">Next</button></div></div>
            <p class="reports-viewer-status" role="status"></p>
            <div class="reports-canvas-stage"><canvas class="reports-pdf-canvas" role="img" aria-label="Earnings report PDF page" hidden></canvas></div>
          </section>
        </section>
      </div>
    </div>`;

  const find = selector => root.querySelector(selector);
  const refs = Object.fromEntries(['output', 'owner-picker', 'owner-selected', 'owner-search-field', 'owner-search', 'owner-list', 'owner-count', 'owner-status', 'owner-retry', 'period-preset', 'start-date', 'end-date', 'selection-controls', 'form-error', 'generate', 'cancel', 'generation-status', 'results', 'download-selected', 'stale-notice', 'export-note', 'preview-empty', 'preview', 'preview-title', 'preview-period', 'preview-kind', 'review-warning', 'page-label', 'viewer-status', 'canvas-stage', 'pdf-canvas'].map(name => [name, find(`.reports-${name}`)]));
  const periodText = period => period.preset==='all-time'&&!period.start?'All time':`${period.preset==='all-time'?'All time · ':''}${dateLabel(period.start)} – ${dateLabel(period.end)}`;
  const requestKey = () => JSON.stringify({ preset: preferences.preset==='all-time'?'all-time':'dates', owners: [...preferences.owners].sort(), start: preferences.start, end: preferences.end });
  const completed = result => (result.status === 'ready' || result.status === 'no-activity') && result.bytes;
  const previewable = result => completed(result) || (result.status === 'needs-review' && result.bytes);
  const sourceText = result => result.mode === 'live' ? '' : ' · Sample data';

  function renderOwners() {
    const matching = owners.filter(owner => owner.name.toLowerCase().includes(preferences.search.toLowerCase()));
    refs['owner-list'].innerHTML = matching.length ? matching.map(owner => `<label class="reports-owner-option"><input type="checkbox" data-owner-id="${escapeHtml(owner.id)}" ${preferences.owners.has(owner.id) ? 'checked' : ''}><span><strong>${escapeHtml(owner.name)}</strong>${liveMode ? '' : `<small>${owner.id === 'sample-owner' ? 'Fictitious owner · sample data' : 'Sample data'}</small>`}</span></label>`).join('') : ownersLoading || ownersError ? '' : `<p class="reports-help reports-search-empty">${owners.length ? 'No owners match your search.' : 'No storefront owners are configured for reporting.'}</p>`;
    refs['owner-count'].textContent = `${preferences.owners.size} selected`;
    const chosen = owners.filter(owner => preferences.owners.has(owner.id));
    refs['owner-selected'].textContent = chosen.length === 1 ? chosen[0].name : chosen.length ? `${chosen.length} owners selected` : 'Choose owners';
    refs['owner-search-field'].hidden = owners.length <= 6 && !preferences.search;
    if (!ownersLoading && !ownersError && owners.length && !ownerPickerInitialized) { refs['owner-picker'].open = owners.length <= 6; ownerPickerInitialized = true; }
    if (ownersError || (!ownersLoading && !owners.length)) refs['owner-picker'].open = true;
    refs['owner-list'].setAttribute('aria-busy', String(ownersLoading));
  }

  async function loadOwners() {
    if (!liveMode || !active) return;
    if (ownerPromise) return ownerPromise;
    const thisOwnerGeneration = ++ownerGeneration;
    const controller = new AbortController();
    ownerController = controller;
    ownersLoading = true;
    ownersError = false;
    refs['owner-status'].textContent = 'Loading storefront owners…';
    refs['owner-status'].setAttribute('role', 'status');
    refs['owner-retry'].hidden = true;
    renderOwners();
    updateControls();
    ownerPromise = (async () => {
      await Promise.resolve();
      try {
        const api = doc.defaultView?.api;
        if (typeof api?.getStorefrontReportOwners !== 'function') throw Object.assign(new Error('Reports unavailable.'), { code: 'REPORTS_UNAVAILABLE' });
        const response = await api.getStorefrontReportOwners({ signal: controller.signal });
        if (!active || thisOwnerGeneration !== ownerGeneration || controller.signal.aborted) return;
        if (!Array.isArray(response?.owners) || response.owners.some(owner => !owner || typeof owner.id !== 'string' || !owner.id || typeof owner.name !== 'string' || !owner.name)) throw new Error('Owner response is incomplete.');
        if (response.timeZone && response.timeZone !== 'America/Chicago') throw Object.assign(new Error('Reporting timezone is unsupported.'), { code: 'REPORTS_UNAVAILABLE' });
        owners = response.owners.map(owner => ({ id: owner.id, name: owner.name, logoUrl: owner.logoUrl || null }));
        const availableIds = new Set(owners.map(owner => owner.id));
        preferences.owners = new Set([...preferences.owners].filter(id => availableIds.has(id)));
        if (requestedOwnerId) {
          preferences.owners = new Set(availableIds.has(requestedOwnerId) ? [requestedOwnerId] : []);
          requestedOwnerId = null; selectionInitialized = true;
        }
        if (!selectionInitialized && owners[0]) preferences.owners.add(owners[0].id);
        selectionInitialized = true;
        refs['owner-status'].textContent = owners.length ? '' : 'No storefront owners are configured for reporting.';
      } catch (error) {
        if (!active || thisOwnerGeneration !== ownerGeneration || controller.signal.aborted) return;
        ownersError = true;
        owners = [];
        refs['owner-status'].textContent = readableFailure(error, 'owners');
        refs['owner-status'].setAttribute('role', 'alert');
        refs['owner-retry'].hidden = false;
      } finally {
        if (thisOwnerGeneration === ownerGeneration) {
          ownerPromise = null;
          ownerController = null;
          ownersLoading = false;
          renderOwners();
          updateControls();
        }
      }
    })();
    return ownerPromise;
  }

  function updateControls() {
    refs['owner-count'].textContent = `${preferences.owners.size} selected`;
    const chosen = owners.filter(owner => preferences.owners.has(owner.id));
    refs['owner-selected'].textContent = chosen.length === 1 ? chosen[0].name : chosen.length ? `${chosen.length} owners selected` : 'Choose owners';
    refs.generate.disabled = busy || ownersLoading || ownersError || !owners.length || preferences.owners.size === 0;
    refs.generate.textContent = busy ? 'Preparing previews…' : 'Generate previews';
    refs.cancel.hidden = !busy;
    refs['selection-controls'].disabled = busy || ownersLoading;
    find('.reports-dates').hidden = preferences.preset === 'all-time';
    refs['start-date'].disabled = busy || preferences.preset !== 'custom';
    refs['end-date'].disabled = busy || preferences.preset !== 'custom';
    refs['stale-notice'].hidden = !results.length || runKey === requestKey();
    refs['download-selected'].disabled = !results.some(result => completed(result) && result.included);
    refs.results.setAttribute('aria-busy', String(busy));
  }

  function renderResults() {
    const focused = refs.results.contains(doc.activeElement) ? { preview: doc.activeElement.dataset.reportsPreview, include: doc.activeElement.dataset.reportInclude } : null;
    refs.results.innerHTML = results.map(result => {
      const ready = completed(result);
      const viewable = previewable(result);
      const status = { queued: 'Queued', reading: 'Reading Shopify…', generating: 'Preparing PDF…', ready: 'Ready', 'no-activity': 'No activity', 'needs-review': 'Needs review', error: 'Could not prepare', cancelled: 'Cancelled' }[result.status];
      return `<div class="reports-result-row${result.id === selectedPreview?.id ? ' reports-result-active' : ''}"><label class="reports-result-include"><input type="checkbox" data-report-include="${escapeHtml(result.id)}" ${result.included && ready ? 'checked' : ''} ${ready ? '' : 'disabled'} aria-label="Include ${escapeHtml(result.owner.name)} in download"></label><div class="reports-result-identity"><strong>${escapeHtml(result.owner.name)}</strong><span>${escapeHtml(periodText(result.period))}${sourceText(result)}</span>${result.status === 'needs-review' ? '<span class="reports-result-warning">Some inputs need review. Open the review PDF for details.</span>' : ''}${result.error ? `<span class="reports-result-error">${escapeHtml(result.error)}</span>` : ''}</div><span class="reports-result-status" data-status="${result.status}">${status}</span><button type="button" data-reports-preview="${escapeHtml(result.id)}" ${viewable ? '' : 'disabled'} aria-pressed="${result.id === selectedPreview?.id}">${result.status === 'needs-review' ? 'Review PDF' : 'Preview'}</button></div>`;
    }).join('');
    if (focused) [...refs.results.querySelectorAll('[data-reports-preview],[data-report-include]')].find(element => focused.preview ? element.dataset.reportsPreview === focused.preview : element.dataset.reportInclude === focused.include)?.focus({ preventScroll: true });
    const omitted = results.filter(result => !completed(result));
    refs.output.hidden = !results.length;
    root.classList.toggle('reports-has-results', Boolean(results.length));
    refs['export-note'].hidden = !omitted.length;
    refs['export-note'].textContent = omitted.length ? `The ZIP includes checked, complete PDFs only. ${omitted.length} ${omitted.length === 1 ? 'report needing review or unavailable will be' : 'reports needing review or unavailable will be'} omitted. Review copies can be downloaded individually.` : 'Choose the completed reports to include. Each owner keeps a separate PDF inside the ZIP.';
    updateControls();
  }

  function clearPreview() {
    previewGeneration += 1;
    pageRenderGeneration += 1;
    pageRendering = false;
    try { renderTask?.cancel(); } catch { /* A completed render needs no cancellation. */ }
    renderTask = null;
    const oldLoading = loadingTask;
    const oldDocument = pdfDocument;
    loadingTask = null;
    pdfDocument = null;
    if (oldLoading) Promise.resolve(oldLoading.destroy()).catch(() => {});
    else if (oldDocument) Promise.resolve(oldDocument.destroy()).catch(() => {});
    const canvas = refs['pdf-canvas'];
    canvas.width = 0;
    canvas.height = 0;
    canvas.hidden = true;
    refs['page-label'].textContent = '';
  }

  function updatePageControls() {
    const total = pdfDocument?.numPages || 0;
    refs['page-label'].textContent = total ? `${currentPage} / ${total}` : '';
    find('[data-reports-action="previous-page"]').disabled = pageRendering || !total || currentPage <= 1;
    find('[data-reports-action="next-page"]').disabled = pageRendering || !total || currentPage >= total;
  }

  async function renderPage(expectedPreview) {
    if (!pdfDocument || expectedPreview !== previewGeneration || !active) return;
    const pageNumber = currentPage;
    const expectedRender = ++pageRenderGeneration;
    const sourceDocument = pdfDocument;
    const priorRender = renderTask;
    const isCurrent = () => active && expectedPreview === previewGeneration && expectedRender === pageRenderGeneration && pageNumber === currentPage && sourceDocument === pdfDocument;
    pageRendering = true;
    updatePageControls();
    refs['pdf-canvas'].hidden = true;
    refs['viewer-status'].textContent = `Loading page ${pageNumber}…`;
    try {
      priorRender?.cancel();
      if (priorRender) await priorRender.promise.catch(() => {});
      if (!isCurrent()) return;
      const page = await sourceDocument.getPage(pageNumber);
      if (!isCurrent()) return;
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, Math.max(0.1, (refs['canvas-stage'].clientWidth - 32) / original.width));
      const viewport = page.getViewport({ scale });
      const density = Math.min(2, globalThis.devicePixelRatio || 1);
      const canvas = refs['pdf-canvas'];
      canvas.width = Math.ceil(viewport.width * density);
      canvas.height = Math.ceil(viewport.height * density);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.hidden = false;
      canvas.setAttribute('aria-label', `${selectedPreview.mode === 'sample' ? 'Sample earnings' : selectedPreview.status === 'needs-review' ? 'Earnings review' : 'Earnings'} report for ${selectedPreview.owner.name}, page ${pageNumber} of ${pdfDocument.numPages}`);
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0] });
      renderTask = task;
      await task.promise;
      if (isCurrent()) refs['viewer-status'].textContent = '';
      // Keep shared PDF font/image resources alive until document replacement or leave.
    } catch (error) {
      if (!isCurrent() || error?.name === 'RenderingCancelledException') return;
      refs['pdf-canvas'].hidden = true;
      refs['viewer-status'].textContent = 'This page could not be displayed. Download the PDF to view it, or select Preview to try again.';
    } finally {
      if (isCurrent()) {
        pageRendering = false;
        updatePageControls();
      }
    }
  }

  async function preview(result) {
    if (!active || !previewable(result)) return;
    clearPreview();
    const expectedPreview = previewGeneration;
    selectedPreview = result;
    currentPage = 1;
    refs['preview-empty'].hidden = true;
    refs.preview.hidden = false;
    refs['preview-title'].textContent = result.owner.name;
    refs['preview-period'].textContent = `${periodText(result.period)} · ${sourceText(result)}`;
    refs['preview-kind'].textContent = result.mode === 'sample' ? 'Sample PDF preview' : result.status === 'needs-review' ? 'Review PDF preview' : 'PDF preview';
    find('[data-reports-action="download-current"]').textContent = result.status === 'needs-review' ? 'Download review PDF' : 'Download PDF';
    refs['review-warning'].hidden = result.status !== 'needs-review';
    if (result.status === 'needs-review') {
      const exceptions = Array.isArray(result.snapshot?.exceptions) ? result.snapshot.exceptions : [];
      refs['review-warning'].innerHTML = `<strong>Needs review — this PDF is incomplete</strong><p>Some earnings or source details could not be verified. Unknown amounts remain unknown. Review this copy before relying on it; it is excluded from completed-report ZIP downloads.</p>${exceptions.length ? `<ul>${exceptions.slice(0, 8).map(exception => `<li>${escapeHtml(String(exception.message || exception.code || 'An input needs review.').slice(0, 500))}</li>`).join('')}</ul>${exceptions.length > 8 ? `<p>${exceptions.length - 8} more ${exceptions.length - 8 === 1 ? 'exception is' : 'exceptions are'} listed in the PDF.</p>` : ''}` : ''}`;
    } else refs['review-warning'].textContent = '';
    refs['viewer-status'].textContent = 'Opening PDF preview…';
    updatePageControls();
    renderResults();
    try {
      viewerPromise ||= import(assetUrl('./report-assets/vendor/pdf.mjs')).catch(error => { viewerPromise = null; throw error; });
      const pdfjs = await viewerPromise;
      if (!active || expectedPreview !== previewGeneration) return;
      pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('./report-assets/vendor/pdf.worker.mjs');
      loadingTask = pdfjs.getDocument({ data: result.bytes.slice(), isEvalSupported: false, useSystemFonts: true });
      const document = await loadingTask.promise;
      if (!active || expectedPreview !== previewGeneration) { await document.destroy(); return; }
      pdfDocument = document;
      await renderPage(expectedPreview);
    } catch {
      if (!active || expectedPreview !== previewGeneration) return;
      refs['viewer-status'].textContent = 'Inline preview is unavailable. Download PDF to open the same report in your PDF viewer.';
      updatePageControls();
    }
  }

  function download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    blobUrls.add(url);
    const link = doc.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    root.append(link);
    try { link.click(); } finally { link.remove(); queueMicrotask(() => { URL.revokeObjectURL(url); blobUrls.delete(url); }); }
  }

  function filename(result) { return `${result.mode === 'sample' ? 'SAMPLE-' : result.status === 'needs-review' ? 'REVIEW-' : ''}${safeFilename(result.owner.name)}-${result.period.start}-to-${result.period.end}.pdf`; }

  function cancelGeneration() {
    generation += 1;
    generationController?.abort();
    generationController = null;
    busy = false;
    results.forEach(result => { if (['reading', 'generating', 'queued'].includes(result.status)) result.status = 'cancelled'; });
    refs['generation-status'].textContent = 'Generation cancelled. Completed reports remain available.';
    if (!selectedPreview) {
      refs['preview-empty'].hidden = false;
      refs['preview-empty'].querySelector('h3').textContent = 'Generation cancelled';
      refs['preview-empty'].querySelector('p').textContent = results.some(previewable) ? 'Open an available PDF above, or generate previews to start again.' : 'Your selections are saved. Generate previews when you are ready to try again.';
    }
    renderResults();
  }

  async function generate() {
    if (busy || !active || ownersLoading || ownersError) return;
    const period = preferences.preset==='all-time'?{preset:'all-time',end:defaultPeriod('month-to-date').end}:{start:preferences.start,end:preferences.end};
    try {
      if(period.preset!=='all-time')validatePeriod(period);
      if (!preferences.owners.size) throw new Error('Choose at least one owner.');
    } catch (error) {
      refs['form-error'].textContent = error.message || 'Choose a valid date range.';
      refs['form-error'].hidden = false;
      return;
    }
    refs['form-error'].hidden = true;
    clearPreview();
    selectedPreview = null;
    refs.preview.hidden = true;
    refs['preview-empty'].hidden = true;
    const thisGeneration = ++generation;
    const controller = new AbortController();
    generationController = controller;
    busy = true;
    runKey = requestKey();
    results = owners.filter(owner => preferences.owners.has(owner.id)).map(owner => ({ id: owner.id, owner, period: { ...period }, mode: liveMode ? 'live' : 'sample', status: 'queued', included: true, bytes: null, snapshot: null }));
    renderResults();
    for (const result of results) {
      if (!active || generation !== thisGeneration || controller.signal.aborted) break;
      result.status = liveMode ? 'reading' : 'generating';
      refs['generation-status'].textContent = liveMode ? `Reading Shopify orders for ${result.owner.name}…` : `Preparing sample report for ${result.owner.name}…`;
      renderResults();
      try {
        let snapshot;
        if (liveMode) {
          const api = doc.defaultView?.api;
          if (typeof api?.generateStorefrontReport !== 'function') throw Object.assign(new Error('Reports unavailable.'), { code: 'REPORTS_UNAVAILABLE' });
          const response = await api.generateStorefrontReport(period.preset==='all-time'?{ownerId:result.owner.id,preset:'all-time'}:{ ownerId: result.owner.id, start: period.start, end: period.end }, { signal: controller.signal });
          if (!active || generation !== thisGeneration || controller.signal.aborted) break;
          snapshot = response?.snapshot;
          if (!snapshot || snapshot.mode !== 'live' || snapshot.owner?.id !== result.id || (period.preset==='all-time'?snapshot.period?.preset!=='all-time'||!snapshot.period?.start||!snapshot.period?.end:snapshot.period?.start !== period.start || snapshot.period?.end !== period.end)) throw Object.assign(new Error('Report response did not match its request.'), { code: 'REPORT_RESPONSE_MISMATCH' });
          validatePeriod(snapshot.period);
          freezeSnapshot(snapshot);
        } else snapshot = createSampleSnapshot(result.owner.id, { ...period });
        result.period = {...snapshot.period};
        result.snapshot = snapshot;
        result.status = 'generating';
        refs['generation-status'].textContent = `Preparing ${liveMode ? '' : 'sample '}PDF for ${result.owner.name}…`;
        renderResults();
        rendererPromise ||= import(assetUrl('./storefront-reports-pdf.mjs')).catch(error => { rendererPromise = null; throw error; });
        const renderer = await rendererPromise;
        if (!active || generation !== thisGeneration || controller.signal.aborted) break;
        const bytes = await renderer.renderReport(snapshot, { signal: controller.signal });
        if (!active || generation !== thisGeneration || controller.signal.aborted) break;
        if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error('The PDF renderer returned an empty report.');
        result.bytes = new Uint8Array(bytes);
        const needsReview = liveMode && (snapshot.status !== 'complete' || snapshot.completeness?.complete !== true || snapshot.completeness?.financialComplete !== true);
        result.status = needsReview ? 'needs-review' : snapshot.noActivity ? 'no-activity' : 'ready';
        if (needsReview) result.included = false;
      } catch (error) {
        if (!active || generation !== thisGeneration || controller.signal.aborted) break;
        result.status = 'error';
        result.included = false;
        result.error = liveMode ? readableFailure(error, 'report') : 'This sample PDF could not be prepared. Generate previews to try again.';
      }
      renderResults();
    }
    if (!active || generation !== thisGeneration) return;
    busy = false;
    generationController = null;
    const ready = results.filter(completed);
    const reviewCount = results.filter(result => result.status === 'needs-review').length;
    const available = results.filter(previewable);
    refs['generation-status'].textContent = liveMode ? `${ready.length} ready. ${reviewCount} need review. ${results.length - available.length} unavailable.` : `${ready.length} of ${results.length} sample ${results.length === 1 ? 'report' : 'reports'} ready.`;
    renderResults();
    if (!selectedPreview && available[0]) await preview(available[0]);
    if (!available.length) {
      refs['preview-empty'].hidden = false;
      refs['preview-empty'].querySelector('h3').textContent = 'No previews are ready';
      refs['preview-empty'].querySelector('p').textContent = 'Review the report status above, then generate previews to try again.';
    }
  }

  find('form').addEventListener('submit', event => { event.preventDefault(); void generate(); });
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button) || button.disabled) return;
    const resultId = button.dataset.reportsPreview;
    if (resultId) { const result = results.find(item => item.id === resultId); if (result) void preview(result); return; }
    switch (button.dataset.reportsAction) {
      case 'select-all': owners.forEach(owner => preferences.owners.add(owner.id)); renderOwners(); updateControls(); break;
      case 'clear-owners': preferences.owners.clear(); renderOwners(); updateControls(); break;
      case 'retry-owners': void loadOwners(); break;
      case 'cancel': cancelGeneration(); break;
      case 'download-current': if (previewable(selectedPreview || {})) download(selectedPreview.bytes, filename(selectedPreview), 'application/pdf'); break;
      case 'download-selected': {
        const selected = results.filter(result => completed(result) && result.included);
        if (!selected.length) return;
        refs['export-note'].hidden = false;
        try {
          const zip = createZip(selected.map(result => ({ name: filename(result), bytes: result.bytes })));
          download(zip, `${liveMode ? '' : 'SAMPLE-'}storefront-reports-${selected[0].period.start}-to-${selected[0].period.end}.zip`, 'application/zip');
          refs['export-note'].textContent = `${selected.length} selected ${liveMode ? 'complete' : 'sample'} ${selected.length === 1 ? 'PDF' : 'PDFs'} packaged. ${results.length - selected.length} ${results.length - selected.length === 1 ? 'report was' : 'reports were'} omitted.`;
        } catch { refs['export-note'].textContent = 'The archive could not be prepared. Download each PDF individually or try again.'; }
        break;
      }
      case 'previous-page': if (pdfDocument && currentPage > 1) { currentPage -= 1; updatePageControls(); void renderPage(previewGeneration); } break;
      case 'next-page': if (pdfDocument && currentPage < pdfDocument.numPages) { currentPage += 1; updatePageControls(); void renderPage(previewGeneration); } break;
    }
  });
  root.addEventListener('input', event => {
    const target = event.target;
    if (target === refs['owner-search']) { preferences.search = target.value; renderOwners(); }
    if (target === refs['start-date'] || target === refs['end-date']) {
      preferences[target === refs['start-date'] ? 'start' : 'end'] = target.value;
      refs['form-error'].hidden = true;
      updateControls();
    }
  });
  root.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset.ownerId) {
      if (target.checked) preferences.owners.add(target.dataset.ownerId); else preferences.owners.delete(target.dataset.ownerId);
      updateControls();
    } else if (target.dataset.reportInclude) {
      const result = results.find(item => item.id === target.dataset.reportInclude);
      if (result) result.included = target.checked;
      updateControls();
    } else if (target === refs['period-preset']) {
      preferences.preset = target.value;
      if (target.value !== 'custom' || !preferences.start) {
        const period = defaultPeriod(target.value);
        preferences.start = period.start;
        preferences.end = period.end;
        refs['start-date'].value = period.start;
        refs['end-date'].value = period.end;
      }
      refs['form-error'].hidden = true;
      updateControls();
    }
  });

  refs['start-date'].value = preferences.start;
  refs['end-date'].value = preferences.end;
  renderOwners();
  updateControls();
  return {
    selectOwner(id) {
      if (busy || typeof id !== 'string' || !id) return false;
      requestedOwnerId = id;
      if (owners.length && !ownersLoading) {
        preferences.owners = new Set(owners.some(owner => owner.id === id) ? [id] : []);
        requestedOwnerId = null; selectionInitialized = true; renderOwners(); updateControls();
      }
      return true;
    },
    onEnter() {
      if (active) return ownerPromise;
      active = true;
      updateControls();
      return loadOwners();
    },
    onLeave() {
      active = false;
      ownerGeneration += 1;
      ownerController?.abort();
      ownerController = null;
      ownerPromise = null;
      ownersLoading = false;
      refs['owner-status'].textContent = '';
      refs['owner-retry'].hidden = true;
      generation += 1;
      generationController?.abort();
      generationController = null;
      busy = false;
      clearPreview();
      selectedPreview = null;
      results = [];
      runKey = '';
      for (const url of blobUrls) URL.revokeObjectURL(url);
      blobUrls.clear();
      refs.preview.hidden = true;
      refs['preview-empty'].hidden = false;
      refs['preview-empty'].querySelector('h3').textContent = 'No reports generated';
      refs['preview-empty'].querySelector('p').textContent = ''; 
      refs['generation-status'].textContent = '';
      refs['form-error'].hidden = true;
      renderResults();
    }
  };
}
