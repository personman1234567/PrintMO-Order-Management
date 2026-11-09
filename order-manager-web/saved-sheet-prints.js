/* Record externally ordered sheets using the existing per-order production authority. */
(() => {
  const eligible = order => order?._candidate === true && order._provider === 'shopify'
    && Boolean(order._orderKey || order._gid) && !order._historyReadOnly
    && order._capabilities?.productionWrite !== false && order.printsOnSavedSheet === true
    && !Number(order.printsOrdered) && !Number(order.printsStatus)
    && order.productionStage !== 'completed' && order.displayFulfillmentStatus !== 'FULFILLED';
  function setup() {
    const tools = document.querySelector('.order-workspace-tools');
    if (!tools) return;
    const make = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const trigger = make('button', 'Saved-sheet prints', 'saved-sheet-trigger');
    trigger.type = 'button'; trigger.id = 'saved-sheet-prints-open'; trigger.hidden = true;
    trigger.setAttribute('aria-haspopup', 'dialog'); tools.append(trigger);
    const dialog = make('dialog', undefined, 'saved-sheet-dialog');
    dialog.id = 'saved-sheet-prints-dialog'; dialog.setAttribute('aria-labelledby', 'saved-sheet-prints-title');
    const heading = make('h2', 'Mark saved-sheet prints ordered'); heading.id = 'saved-sheet-prints-title';
    const help = make('p', 'Choose the orders included on the sheet you ordered. This updates print status only; it does not place an order.');
    const scope = make('p', 'These are all active Shopify orders marked On saved sheet, across board filters. Uncheck any orders on a different sheet.');
    scope.id = 'saved-sheet-prints-scope'; dialog.setAttribute('aria-describedby', scope.id);
    const allLabel = make('label', undefined, 'saved-sheet-row');
    const selectAll = make('input'); selectAll.type = 'checkbox'; allLabel.append(selectAll, make('span', 'Select all listed orders'));
    const list = make('div', undefined, 'saved-sheet-list');
    const status = make('p'); status.id = 'saved-sheet-prints-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = make('div', undefined, 'saved-sheet-actions');
    const cancel = make('button', 'Cancel'); cancel.type = 'button';
    const save = make('button', 'Mark ordered', 'saved-sheet-save'); save.type = 'button';
    actions.append(cancel, save); dialog.append(heading, help, scope, allLabel, list, status, actions); document.body.append(dialog);
    let rows = [], saving = false;
    const active = () => document.body.dataset.orderSource === 'shopify' && (!document.body.dataset.activeView || document.body.dataset.activeView === 'orders');
    const snapshot = () => window.getOrderManagerBoardSnapshot?.() || [];
    function sync() {
      const count = active() ? snapshot().filter(eligible).length : 0;
      trigger.hidden = !active(); trigger.disabled = saving || count === 0;
      trigger.textContent = `Saved-sheet prints (${count})`;
      if (!active() && dialog.open && !saving) dialog.close();
    }
    function syncSelection() {
      const pending = rows.filter(row => !row.saved);
      const checked = pending.filter(row => row.checkbox.checked).length;
      selectAll.checked = pending.length > 0 && checked === pending.length;
      selectAll.indeterminate = checked > 0 && checked < pending.length;
      selectAll.disabled = saving || !pending.length;
      save.disabled = saving || !checked || !active();
      save.textContent = saving ? 'Saving statuses…' : `Mark ${checked} ${checked === 1 ? 'order' : 'orders'} Ordered`;
    }
    function open() {
      if (!active() || saving) return;
      rows = snapshot().filter(eligible).map(order => {
        const row = make('label', undefined, 'saved-sheet-row');
        const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
        const copy = make('span'); copy.append(make('strong', order.name || order.orderNumber || 'Order'), make('span', 'On saved sheet'));
        row.append(checkbox, copy); checkbox.onchange = syncSelection;
        return { row, checkbox, copy, reference: { provider: order._provider, orderKey: order._orderKey || order._gid }, saved: false };
      });
      list.replaceChildren(...rows.map(row => row.row)); status.textContent = '';
      cancel.textContent = 'Cancel'; syncSelection(); dialog.showModal(); cancel.focus();
    }
    trigger.onclick = open;
    selectAll.onchange = () => { rows.filter(row => !row.saved).forEach(row => { row.checkbox.checked = selectAll.checked; }); syncSelection(); };
    cancel.onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => { if (trigger.getClientRects().length) trigger.focus(); });
    save.onclick = async () => {
      if (saving || !active()) return;
      const selected = rows.filter(row => !row.saved && row.checkbox.checked);
      if (!selected.length) return;
      saving = true; cancel.disabled = true; rows.forEach(row => { row.checkbox.disabled = true; }); syncSelection(); sync();
      status.textContent = `Updating ${selected.length} ${selected.length === 1 ? 'order' : 'orders'}…`;
      try {
        const result = await window.api.markSavedSheetPrintsOrdered(selected.map(row => row.reference));
        let saved = 0;
        result.results.forEach(item => {
          const row = selected.find(row => row.reference.provider === item.reference.provider && row.reference.orderKey === item.reference.orderKey);
          if (!row) return;
          row.saved = item.outcome === 'saved';
          if (row.saved) { saved++; row.checkbox.checked = false; }
          row.copy.lastChild.textContent = row.saved ? 'Ordered' : item.outcome === 'changed' ? item.message
            : `Save not confirmed. Refresh this order before retrying. ${item.message || ''}`;
        });
        const remaining = selected.length - saved;
        status.textContent = `${saved} ${saved === 1 ? 'order' : 'orders'} marked Ordered.${remaining ? ` ${remaining} not confirmed; review the messages below each order.` : ''}`;
      } catch (error) {
        status.textContent = `The update could not finish. Refresh orders to check their current status before retrying. ${error.message || ''}`;
      } finally {
        saving = false; cancel.disabled = false; cancel.textContent = 'Done';
        rows.forEach(row => { row.checkbox.disabled = row.saved; }); syncSelection(); sync(); cancel.focus();
      }
    };
    document.addEventListener('printmo:board-updated', sync);
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-order-source', 'data-active-view'] });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
