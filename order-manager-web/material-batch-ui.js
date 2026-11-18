/* Shared purchase review. Names/dates label the batch; selected membership is saved separately. */
(() => {
  const make = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function fields(parent, kind, batch = {}) {
    const nameLabel = make('label', 'Batch name (optional)', 'material-batch-field');
    const name = make('input'); name.type = 'text'; name.maxLength = 120; name.value = batch.label || '';
    name.placeholder = `${kind === 'prints' ? 'Prints' : 'Apparel'} · ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
    nameLabel.append(name);
    const dateLabel = make('label', 'Ordered date', 'material-batch-field'); const date = make('input'); date.type = 'date'; date.required = true; date.value = batch.orderedDate || today(); dateLabel.append(date);
    parent.append(nameLabel, dateLabel);
    return { name, date, values: () => ({ label: name.value.trim(), orderedDate: date.value }) };
  }
  function pick({ kind, orders, batch, requireSupplier = false, title }) {
    return new Promise(resolve => {
      const dialog = make('dialog', undefined, 'saved-sheet-dialog material-batch-dialog');
      const heading = make('h2', title || 'Save purchase batch'); heading.id = 'material-batch-pick-title'; dialog.setAttribute('aria-labelledby', heading.id);
      dialog.append(heading, make('p', 'Select only the customer orders included in this purchase. This records your purchase; it does not place an order.'));
      const f = fields(dialog, kind, batch);
      let supplier;
      if (requireSupplier) { const label = make('label', 'S&S order number(s)', 'material-batch-field'); supplier = make('input'); supplier.maxLength = 80; supplier.required = true; label.append(supplier); dialog.append(label); }
      const rows = []; const list = make('div', undefined, 'saved-sheet-list');
      const allRow = make('label', undefined, 'saved-sheet-row'); const all = make('input'); all.type = 'checkbox'; allRow.append(all, make('span', 'Select all listed orders')); list.append(allRow);
      for (const order of orders) { const label = make('label', undefined, 'saved-sheet-row'); const input = make('input'); input.type = 'checkbox'; label.append(input, make('span', order.name)); list.append(label); rows.push({ order, input }); }
      const status = make('p'); status.setAttribute('role', 'status'); const actions = make('div', undefined, 'saved-sheet-actions'); const cancel = make('button', 'Cancel'); const save = make('button', 'Save batch', 'saved-sheet-save');
      function sync() { const selected = rows.filter(r => r.input.checked).length; save.disabled = !selected && orders.length > 0; save.textContent = orders.length ? `Save batch · ${selected} orders` : 'Save changes'; all.checked = selected === rows.length && !!selected; all.indeterminate = selected > 0 && selected < rows.length; }
      all.onchange = () => { rows.forEach(r => { r.input.checked = all.checked; }); sync(); }; rows.forEach(r => { r.input.onchange = sync; });
      cancel.onclick = () => dialog.close(); save.onclick = () => { if (!f.date.reportValidity() || supplier && !supplier.reportValidity()) return; dialog.returnValue = 'save'; dialog.close(); };
      actions.append(cancel, save); dialog.append(list, status, actions); list.hidden = !orders.length;
      dialog.addEventListener('close', () => { const value = dialog.returnValue === 'save' ? { ...f.values(), orders: rows.filter(r => r.input.checked).map(r => r.order), ...(supplier ? { supplierOrderNumber: supplier.value.trim() } : {}) } : null; dialog.remove(); resolve(value); }, { once: true });
      document.body.append(dialog); sync(); dialog.showModal(); f.name.focus();
    });
  }
  window.materialBatchUi = { make, fields, pick, today };
})();
