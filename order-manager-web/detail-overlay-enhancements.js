(function () {
  const checkboxIds = [
    'chk-blanks',
    'chk-prints',
    'chk-blanks-ordered',
    'chk-prints-ordered'
  ];

  function money(value) {
    return (Number(value) || 0).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function itemCounts(order) {
    return (order.items || []).reduce((totals, item) => {
      const qty = Number(item.qty) || 0;
      if (typeof isPrintItem === 'function' && isPrintItem(item)) totals.prints += qty;
      else totals.apparel += qty;
      totals.all += qty;
      return totals;
    }, { all: 0, apparel: 0, prints: 0 });
  }

  function readyStateFromInputs() {
    const checked = checkboxIds.filter(id => document.getElementById(id)?.checked).length;
    if (checked === checkboxIds.length) return { label: 'Ready', state: 'ready' };
    if (checked > 0) return { label: `${checked}/4 ready`, state: 'partial' };
    return { label: 'Not ready', state: 'missing' };
  }

  function syncReadySummary() {
    const summary = document.getElementById('detail-header-ready-summary');
    if (!summary) return;
    const state = readyStateFromInputs();
    summary.textContent = state.label;
    summary.dataset.state = state.state;
  }

  function syncDetailHeader(order) {
    if (!order) return;
    const [, customerName = ''] = typeof splitOrderName === 'function'
      ? splitOrderName(order.name)
      : String(order.name || '').split(' - ');
    const counts = itemCounts(order);
    const customer = document.getElementById('detail-header-customer');
    const pieces = document.getElementById('detail-header-pieces');
    const total = document.getElementById('detail-header-total');

    if (customer) customer.textContent = customerName || 'No customer name';
    if (pieces) {
      pieces.textContent = `${counts.apparel} apparel / ${counts.prints} prints`;
      pieces.title = `${counts.all} total line-item quantity`;
    }
    if (total) total.textContent = money(order.total);
    syncReadySummary();
  }

  function wireReadyInputs() {
    checkboxIds.forEach(id => {
      const input = document.getElementById(id);
      if (!input || input.dataset.detailSummaryWired) return;
      input.dataset.detailSummaryWired = 'true';
      input.addEventListener('change', syncReadySummary);
    });
  }

  function patchDetailOpen() {
    if (typeof openDetail !== 'function' || openDetail.__detailSummaryPatched) return;
    const originalOpenDetail = openDetail;
    openDetail = function enhancedOpenDetail(order, ...args) {
      const result = originalOpenDetail.call(this, order, ...args);
      syncDetailHeader(order);
      wireReadyInputs();
      return result;
    };
    openDetail.__detailSummaryPatched = true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    patchDetailOpen();
    wireReadyInputs();
  });

  patchDetailOpen();
})();
