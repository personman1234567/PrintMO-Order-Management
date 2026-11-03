/* Read the supplier order response; reuse existing reviewed board moves. */
(() => {
  const model = window.SupplierResultModel;
  if (!model) return;
  let report, ready = false;
  const byId = id => document.getElementById(id);
  const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
  const snapshot = () => window.getOrderManagerBoardSnapshot?.() || [];
  const key = model.identity;
  // Submission eligibility is decided from current attempt evidence on the Worker.
  const blocked = () => false;
  function row(body, line) {
    const tr = document.createElement('tr'), item = node('td', undefined, 'ss-line-item');
    const labels = { accepted: 'Supplier reported', partial: 'Partly accepted', not_accepted: 'Not accepted', rejected: 'Not accepted', identifier_review: 'Item identifier needs review', unconfirmed: 'Item detail not confirmed', not_sent: 'Not sent', review: 'Needs review' };
    item.append(node('span', labels[line.status] || 'Needs review', `ss-line-status ${line.status === 'accepted' ? 'accepted' : 'unknown'}`));
    item.append(node('strong', line.itemNames.join(', ') || (line.mappingReview ? 'Returned S&S item' : 'Requested garment'), 'ss-line-item-name'));
    item.append(node('code', line.sku || 'No identifier returned', 'ss-line-sku'));
    if (line.orderNames.length) item.append(node('span', line.orderNames.join(', '), 'ss-line-orders'));
    const requested = node('td', line.requestedQty ?? 'Not matched'); requested.dataset.label = 'Requested units';
    const accepted = node('td', line.reportedAcceptedQty ?? 'Not reported'); accepted.dataset.label = 'S&S reported units';
    const detail = node('td', undefined, 'ss-line-feedback'); detail.dataset.label = 'Supplier message / item review';
    if (line.notAcceptedQty !== null && line.notAcceptedQty !== undefined) detail.append(node('span', `Not accepted: ${line.notAcceptedQty}`, 'ss-quantity-detail'));
    const feedback = line.issues.map(issue => issue.reason || issue.message).filter(Boolean).join(' ');
    detail.append(node('span', feedback || (line.status === 'accepted' ? 'Reported in the S&S response.' : 'Review this item against the S&S order.')));
    tr.append(item, requested, accepted, detail); body.append(tr);
  }
  function attemptOrders() {
    const ids = new Set(report?.reviewOrderIds || (report?.orderResults || []).map(value => String(value.orderId || value.orderKey || '')));
    return snapshot().filter(order => order.status === 'toOrder' && order._candidate !== false && ['shopify', 'etsy'].includes(order._provider)
      && ids.has(String(order._orderKey || order._gid)) && !order._historyReadOnly);
  }
  function show(value) {
    byId('ss-review-back')?.remove();
    report = model.normalize(value);
    const view = model.presentation(report), dialog = byId('ss-submission-dialog');
    if (!dialog) return false;
    dialog.dataset.outcome = report.placementOutcome;
    byId('ss-submission-title').textContent = view.title;
    byId('ss-submission-summary').textContent = view.summary;
    renderActionReview();
    byId('ss-submission-warning').textContent = view.warning;
    byId('ss-submission-warning').classList.toggle('hidden', !view.warning);
    byId('ss-submission-next-step').textContent = view.nextStep;
    byId('ss-submission-next-step').hidden = !view.nextStep;
    const exceptionBody = byId('ss-submission-lines-body'), acceptedBody = byId('ss-submission-accepted-body');
    exceptionBody.replaceChildren(); acceptedBody.replaceChildren();
    view.exceptions.forEach(line => row(exceptionBody, line)); view.accepted.forEach(line => row(acceptedBody, line));
    byId('ss-submission-exceptions').hidden = !view.exceptions.length;
    byId('ss-submission-accepted').hidden = !view.accepted.length;
    byId('ss-submission-accepted').open = !view.exceptions.length;
    byId('ss-submission-accepted-count').textContent = `Other reported items (${view.accepted.length})`;
    byId('ss-submission-no-lines').hidden = report.failureKind === 'rate_limited' || report.submissionAction === 'blocked' || Boolean(view.exceptions.length || view.accepted.length);
    const errors = byId('ss-submission-native-errors'); errors.replaceChildren();
    report.nativeErrors.filter(error => !view.summary.includes(error.reason)
      && !report.lineResults.some(line => line.sku === error.sku && line.issues.some(issue => (issue.reason || issue.message) === error.reason)))
      .forEach(error => errors.append(node('li', `${error.sku ? `${error.sku}: ` : ''}${error.reason}`)));
    errors.hidden = !errors.childElementCount;
    const exclusions = byId('ss-submission-excluded-list'); exclusions.replaceChildren();
    report.excludedLines.forEach(line => exclusions.append(node('li', `${line.title || line.sku || 'Service charge'} - ${line.reason || 'Not sent to S&S.'}`)));
    byId('ss-submission-excluded').hidden = !report.excludedLines.length;
    const extra = byId('ss-submission-extra'); extra.replaceChildren();
    if (report.priceWarnings?.length) extra.append(node('p', 'Verify the final total in S&S; estimated pricing was incomplete.'));
    if (report.gatewayEvidence) extra.append(node('p', `Gateway response: HTTP ${report.gatewayEvidence.httpStatus}; ${report.gatewayEvidence.bodyFormat}. Supplier message ${report.gatewayEvidence.hasSupplierMessage ? 'present' : 'unavailable'}; dispatch evidence ${report.gatewayEvidence.hasDispatchMarker ? 'present' : 'unavailable'}.`));
    byId('ss-submission-order-number').textContent = report.supplierOrderNumbers.join(', ') || 'No order number returned';
    byId('ss-submission-recorded').textContent = [report.attemptStartedAt ? `Request started ${report.attemptStartedAt}` : '',
      report.recordedAt ? `Response recorded ${report.recordedAt}` : 'Response time not recorded'].filter(Boolean).join(' · ');
    byId('ss-submission-reference').textContent = report.batchId || report.poNumber || 'Unavailable';
    byId('ss-submission-open-supplier').hidden = report.preflightFailed || (report.placementOutcome === 'rejected' && !report.supplierOrderNumbers.length);
    byId('ss-submission-copy').hidden = !(report.batchId || report.poNumber);
    const orders = attemptOrders(), move = byId('ss-submission-review');
    move.hidden = report.failureKind === 'rate_limited' || report.submissionAction === 'blocked' || !orders.length || !window.OrderManagerViews?.reviewOrders || document.body.dataset.orderSource !== 'shopify';
    move.textContent = `Move ${orders.length} listed ${orders.length === 1 ? 'order' : 'orders'} to In S&S Cart…`;
    byId('ss-submission-move-note').hidden = move.hidden;
    byId('ss-last-result')?.classList.remove('hidden');
    byId('ss-submission-overlay').classList.remove('hidden');
    syncAttention(); return true;
  }
  function renderActionReview() {
    byId('ss-action-review')?.remove();
    const saved = Array.isArray(report.previousResults) ? report.previousResults : [];
    if (!saved.length) return;
    const section = node('details', undefined, 'ss-action-review'); section.id = 'ss-action-review';
    section.append(node('summary', 'Earlier request evidence'));
    for (const previous of saved) {
      const numbers = previous.supplierOrderNumbers || [previous.supplierOrderNumber].filter(Boolean);
      const button = node('button', `View previous result${numbers.length ? ' · S&S ' + numbers.join(', ') : ''}`, 'btn');
      button.type = 'button'; button.addEventListener('click', () => {
        const blockedSelection = report;
        show({ ...previous, submissionAction: 'saved', supplierRequestSent: false });
        const back = node('button', 'Back to current selection', 'btn'); back.type = 'button'; back.id = 'ss-review-back';
        back.addEventListener('click', () => show(blockedSelection)); byId('ss-submission-summary').after(back);
      }); section.append(button);
    }
    byId('ss-submission-summary').after(section);
  }
  async function moveAttemptOrders(event) {
    const orders = attemptOrders();
    if (!orders.length || document.body.dataset.orderSource !== 'shopify') return;
    const control = event.currentTarget, keys = orders.map(key);
    byId('ss-submission-close')?.click();
    try {
      const result = await window.OrderManagerViews.reviewOrders(keys, 'move:blanks_cart', control);
      if (!result || result.cancelled) return;
      const rows = result.results || [], saved = rows.filter(value => value.outcome === 'saved').length;
      const status = byId('ss-submit-status');
      if (status) status.textContent = `${saved} of ${rows.length} board orders moved to In S&S Cart. No S&S request was sent.${saved < rows.length ? ' Review the remaining local updates in List.' : ''}`;
    } catch (error) { if (byId('ss-submit-status')) byId('ss-submit-status').textContent = error.message || 'The board move was not confirmed. Review the current orders.'; }
  }
  function openBuildSelection() {
    if (document.body.dataset.orderSource !== 'shopify') return;
    byId('ss-submission-close')?.click();
    if (document.body.dataset.mobileWorkspace === 'true') {
      window.OrderManagerNavigation?.navigateMobile('supplies', { subview: 'to_order' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const select = document.querySelector('#mobile-order-workspace .mw-select');
        if (select?.getAttribute('aria-pressed') !== 'true') select?.click();
      }));
      return;
    }
    document.querySelector('[data-order-layout="list"]')?.click();
    document.querySelector('[data-list-stage="to_order"]')?.click();
    const action = byId('order-list-action');
    if (action) { action.value = 'move:blanks_cart'; action.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelector('#order-list-foundation-rows input[data-select-order]')?.focus();
  }
  function syncAttention() {
    // The former card-wide block collided with existing movement controls.
    document.querySelectorAll('.ss-order-attention, .ss-mobile-review-entry').forEach(value => value.remove());
    const candidate = document.body.dataset.orderSource === 'shopify';
    const count = candidate ? snapshot().filter(order => order.status === 'toOrder' && blocked(order)).length : 0;
    const status = byId('ss-build-attention');
    if (status) { status.hidden = !count; status.textContent = `${count} ${count === 1 ? 'order needs its' : 'orders need their'} saved S&S result checked before another submission.`; }
    const entry = byId('ss-build-review');
    if (entry) { entry.hidden = !candidate; entry.textContent = 'Select orders for a board move…'; }
  }
  function init() {
    if (ready) return; ready = true;
    byId('ss-submission-review')?.addEventListener('click', moveAttemptOrders);
    byId('ss-build-review')?.addEventListener('click', openBuildSelection);
    document.addEventListener('printmo:board-updated', syncAttention);
    syncAttention();
  }
  window.SupplierResults = Object.freeze({ init, show, openBuildSelection, submissionBlocked: blocked, syncAttention });
})();
