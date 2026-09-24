(() => {
  const root = document.getElementById('shelf-allocation');
  if (!root) return;
  const el = (tag, copy, className) => {
    const item = document.createElement(tag);
    if (copy !== undefined) item.textContent = copy;
    if (className) item.className = className;
    return item;
  };
  const mutationKey = () => `shelf:${crypto.randomUUID()}`;
  let serial = 0;

  function metric(label, value) {
    const item = el('div');
    item.append(el('dt', label), el('dd', String(value)));
    return item;
  }

  function show(order, snapshot, notice = '') {
    root.replaceChildren();
    root.hidden = false;
    const header = el('div', undefined, 'shelf-order-header');
    const title = el('div');
    title.append(el('h3', 'Blanks for this order'),
      el('p', 'Reserve shop stock for this order, then mark it pulled when it leaves the shelf.'));
    const inventory = el('button', 'Open inventory', 'shelf-quiet-button');
    inventory.type = 'button'; inventory.onclick = () => window.openShelfInventory?.();
    header.append(title, inventory); root.append(header);

    const totals = snapshot.lines.reduce((acc, line) => ({
      ordered: acc.ordered + line.quantity, reserved: acc.reserved + line.reserved,
      pulled: acc.pulled + line.pulled, supplier: acc.supplier + line.supplierNeeded
    }), { ordered: 0, reserved: 0, pulled: 0, supplier: 0 });
    const summary = el('dl', undefined, 'shelf-order-summary');
    summary.append(metric('Tultex 202 needed', totals.ordered), metric('Reserved to pull', totals.reserved),
      metric('Pulled', totals.pulled), metric('For S&S', totals.supplier));
    root.append(summary);
    const status = el('p', notice, 'shelf-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    root.append(status);
    if (snapshot.needsReview) status.textContent = 'A reservation no longer matches the Shopify order. Review it before purchasing or pulling.';
    else if (snapshot.cancelled) status.textContent = 'This order was canceled. Return and release blanks explicitly; stock does not return automatically.';
    else if (snapshot.locked) status.textContent = 'Supplier purchasing has started. Reservations are locked; reserved blanks can still be marked pulled.';

    const itemById = new Map((order.items || []).map(item => [item.id, item]));
    for (const line of snapshot.lines) {
      const item = itemById.get(line.lineItemId);
      const section = el('article', undefined, 'shelf-order-line');
      const identity = el('div', undefined, 'shelf-order-identity');
      identity.append(el('strong', item?.variantTitle || line.sku), el('span', line.sku));
      section.append(identity);
      const counts = el('dl', undefined, 'shelf-line-counts');
      counts.append(metric('Needed', line.quantity),
        metric('On shelf', line.onShelf === null ? 'Not counted' : line.onShelf),
        metric('Free', line.available === null ? '—' : line.available),
        metric('Reserved', line.reserved), metric('Pulled', line.pulled),
        metric('For S&S', line.supplierNeeded));
      section.append(counts);
      if (line.needsReview) section.append(el('p', 'This line changed in Shopify. Review it before changing its reservation.', 'shelf-line-warning'));

      const controls = el('div', undefined, 'shelf-line-controls');
      const canReserve = !snapshot.locked && !order._historyReadOnly &&
        (!line.needsReview || (snapshot.cancelled && line.claimed > line.pulled)) &&
        (!snapshot.cancelled || line.claimed > line.pulled);
      if (line.onShelf === null) {
        controls.append(el('p', 'Count this variant in Inventory before reserving it.', 'shelf-line-hint'));
      } else if (canReserve) {
        const label = el('label', 'Reserve for this order');
        const amount = el('input'); amount.type = 'number'; amount.min = String(line.pulled);
        amount.max = String(snapshot.cancelled ? line.claimed : line.quantity);
        amount.step = '1'; amount.value = String(line.claimed);
        label.append(amount);
        const save = el('button', snapshot.cancelled ? 'Release reservation' :
          line.claimed ? 'Update reservation' : 'Reserve blanks', 'shelf-primary-button');
        save.type = 'button';
        save.onclick = async () => {
          const qty = Number(amount.value);
          const maximum = snapshot.cancelled ? line.claimed : line.quantity;
          if (!Number.isSafeInteger(qty) || qty < line.pulled || qty > maximum) {
            status.textContent = `Choose between ${line.pulled} and ${maximum} units for ${item?.variantTitle || line.sku}.`;
            return;
          }
          if (qty === line.claimed) { status.textContent = 'Choose a different quantity before saving.'; return; }
          save.disabled = true;
          try {
            const result = await window.api.setShelfClaim(order._gid, {
              lineItemId: line.lineItemId, qty, expectedVersion: line.claimVersion, idempotencyKey: mutationKey()
            });
            if (root.dataset.orderId === order._gid) show(order, result,
              qty < line.claimed ? 'Reservation released. Units remain physically on the shelf.' : 'Blanks reserved for this order. Mark them pulled when removed from the shelf.');
          } catch (error) { status.textContent = error.message || 'Reservation not saved. Refresh and try again.'; save.disabled = false; }
        };
        controls.append(label, save);
      }

      if (line.reserved > 0 && !order._historyReadOnly && !snapshot.cancelled && !line.needsReview) {
        const pullLabel = el('label', 'Units physically pulled');
        const pullAmount = el('input'); pullAmount.type = 'number'; pullAmount.min = '1';
        pullAmount.max = String(line.reserved); pullAmount.step = '1'; pullAmount.value = String(line.reserved);
        pullLabel.append(pullAmount);
        const pull = el('button', 'Mark pulled', 'shelf-quiet-button'); pull.type = 'button';
        pull.onclick = async () => {
          const qty = Number(pullAmount.value);
          if (!Number.isSafeInteger(qty) || qty < 1 || qty > line.reserved) {
            status.textContent = 'Enter the number of reserved units physically removed from the shelf.'; return;
          }
          pull.disabled = true;
          try {
            const result = await window.api.setShelfPulled(order._gid, {
              lineItemId: line.lineItemId, pulledQty: line.pulled + qty, physicallyPulled: true,
              expectedVersion: line.claimVersion, idempotencyKey: mutationKey()
            });
            if (root.dataset.orderId === order._gid) show(order, result, `${qty} ${qty === 1 ? 'blank' : 'blanks'} marked pulled. Physical shelf stock was reduced.`);
          } catch (error) { status.textContent = error.message || 'Pull not saved. Refresh and try again.'; pull.disabled = false; }
        };
        controls.append(pullLabel, pull);
      }

      if (line.pulled > 0 && !order._historyReadOnly) {
        const returnLabel = el('label', 'Units physically returned');
        const returnAmount = el('input'); returnAmount.type = 'number'; returnAmount.min = '1';
        returnAmount.max = String(line.pulled); returnAmount.step = '1'; returnAmount.value = String(line.pulled);
        returnLabel.append(returnAmount);
        const returned = el('button', 'Return to shelf', 'shelf-quiet-button'); returned.type = 'button';
        returned.onclick = async () => {
          const qty = Number(returnAmount.value);
          if (!Number.isSafeInteger(qty) || qty < 1 || qty > line.pulled) {
            status.textContent = 'Enter the number of pulled units physically returned to the shelf.'; return;
          }
          if (!window.confirm(`Are ${qty} ${qty === 1 ? 'blank' : 'blanks'} physically back on the shelf? This keeps them reserved until you release the reservation.`)) return;
          returned.disabled = true;
          try {
            const result = await window.api.setShelfPulled(order._gid, {
              lineItemId: line.lineItemId, pulledQty: line.pulled - qty, returnedToShelf: true,
              expectedVersion: line.claimVersion, idempotencyKey: mutationKey()
            });
            if (root.dataset.orderId === order._gid) show(order, result,
              'Physical shelf count restored. These blanks remain reserved until the reservation is released.');
          } catch (error) { status.textContent = error.message || 'Return not saved. Refresh and try again.'; returned.disabled = false; }
        };
        controls.append(returnLabel, returned);
      }
      section.append(controls); root.append(section);
    }
  }

  window.renderShelfAllocationForOrder = async order => {
    const id = order?._gid;
    const turn = ++serial;
    root.dataset.orderId = id || '';
    root.hidden = true;
    if (!(order?.items || []).some(item => item?.title === 'Tultex - Fine Jersey T-Shirt - 202')) return;
    root.hidden = false;
    root.replaceChildren(el('p', 'Loading in-house blank inventory…', 'shelf-status'));
    if (!order?._candidate || order?._provider !== 'shopify' || !id || !window.api?.getShelfOrder) {
      root.replaceChildren(el('p', 'In-house inventory is unavailable for this order. Refresh Order Manager and try again.'));
      return;
    }
    try {
      const snapshot = await window.api.getShelfOrder(id);
      if (turn !== serial || root.dataset.orderId !== id) return;
      if (!snapshot?.lines?.length) {
        root.replaceChildren(el('p', 'This order could not be matched to current Tultex 202 variants. Reservations are unavailable.'));
        return;
      }
      show(order, snapshot);
    } catch (error) {
      if (turn !== serial || root.dataset.orderId !== id) return;
      root.replaceChildren(el('p', error.message || 'In-house inventory could not load.'));
    }
  };
})();
