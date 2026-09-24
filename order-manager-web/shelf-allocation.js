(() => {
  const root = document.getElementById('shelf-allocation');
  if (!root) return;
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const key = () => `shelf:${crypto.randomUUID()}`;
  let serial = 0;

  function show(order, snapshot) {
    root.replaceChildren();
    root.hidden = false;
    root.append(node('h4', 'In-house shelf stock · Tultex 202'));
    root.append(node('p', 'Staff claims only. Shelf stock never changes Shopify checkout availability.'));
    const status = node('p', '', 'shelf-status');
    root.append(status);
    if (snapshot.needsReview && !snapshot.lines.some(line => line.needsReview))
      status.textContent = 'A previous shelf claim no longer matches this order. Review it before purchasing or receiving.';
    const itemById = new Map((order.items || []).map(item => [item.id, item]));
    for (const line of snapshot.lines) {
      const section = node('div', undefined, 'shelf-line');
      const item = itemById.get(line.lineItemId);
      section.append(node('strong', `${item?.variantTitle || line.sku} · ${line.sku}`));
      section.append(node('p', `${line.quantity} ordered · ${line.claimed} claimed · ${line.supplierNeeded} for S&S · ${line.available === null ? 'Shelf uncounted' : `${line.available} free on shelf`}`));
      if (line.needsReview) section.append(node('p', 'Claim no longer matches this order. Review before purchasing.'));
      const disabled = snapshot.locked || order._historyReadOnly;
      if (line.available === null || !disabled) {
        const claimLabel = node('label', 'Use shelf stock:');
        const claimInput = node('input');
        claimInput.type = 'number'; claimInput.min = '0'; claimInput.max = String(snapshot.cancelled ? line.claimed : line.quantity);
        claimInput.step = '1'; claimInput.value = String(line.claimed);
        claimInput.disabled = disabled || line.available === null || (snapshot.cancelled && line.claimed === 0);
        claimLabel.append(claimInput);
        section.append(claimLabel);
        const save = node('button', 'Save shelf claim');
        save.type = 'button'; save.disabled = claimInput.disabled;
        save.onclick = async () => {
          const qty = Number(claimInput.value);
          if (!Number.isSafeInteger(qty) || qty < 0 || qty > (snapshot.cancelled ? line.claimed : line.quantity)) {
            status.textContent = 'Enter a whole number within the order quantity.'; return;
          }
          if (qty < line.claimed && !window.confirm('Return these units to free shelf stock only if they are physically back on the shelf. Continue?')) return;
          save.disabled = true;
          try {
            const result = await window.api.setShelfClaim(order._gid, {
              lineItemId: line.lineItemId, qty, expectedVersion: line.claimVersion, idempotencyKey: key()
            });
            if (root.dataset.orderId === order._gid) show(order, result);
          } catch (error) { status.textContent = error.message || 'Could not save shelf claim. Refresh and retry.'; save.disabled = false; }
        };
        section.append(save);
      }
      if (!disabled) {
        const countLabel = node('label', 'Free units physically counted:');
        const countInput = node('input');
        countInput.type = 'number'; countInput.min = '0'; countInput.step = '1';
        countInput.value = line.available === null ? '' : String(line.available);
        countLabel.append(countInput);
        const reason = node('input', undefined, 'shelf-reason');
        reason.type = 'text'; reason.maxLength = 240; reason.placeholder = 'Reason for count or correction';
        reason.setAttribute('aria-label', 'Reason for shelf count');
        const count = node('button', line.available === null ? 'Record physical count' : 'Correct free count');
        count.type = 'button';
        count.onclick = async () => {
          const available = Number(countInput.value);
          if (countInput.value === '' || !Number.isSafeInteger(available) || available < 0 || !reason.value.trim()) {
            status.textContent = 'Enter a free shelf count and a reason.'; return;
          }
          count.disabled = true;
          try {
            await window.api.setShelfCount(line.variantId, {
              available, expectedVersion: line.stockVersion, reason: reason.value.trim(), idempotencyKey: key()
            });
            if (root.dataset.orderId === order._gid) await window.renderShelfAllocationForOrder(order);
          } catch (error) { status.textContent = error.message || 'Could not save shelf count. Refresh and retry.'; count.disabled = false; }
        };
        section.append(countLabel, reason, count);
      }
      root.append(section);
    }
    if (snapshot.locked) status.textContent = 'Supplier purchasing or production has started. Shelf claims are locked.';
    else if (snapshot.cancelled) status.textContent = 'This order was canceled. Shelf units are never returned automatically.';
    else if (snapshot.lines.length && snapshot.lines.every(line => line.supplierNeeded === 0))
      status.textContent = 'All Tultex 202 units are claimed. Verify the blanks, then mark them ready in the order controls.';
  }

  window.renderShelfAllocationForOrder = async (order) => {
    const id = order?._gid;
    const turn = ++serial;
    root.dataset.orderId = id || '';
    root.hidden = true;
    if (!order?._candidate || order?._provider !== 'shopify' || !id || !window.api?.getShelfOrder) return;
    try {
      const snapshot = await window.api.getShelfOrder(id);
      if (turn !== serial || root.dataset.orderId !== id || !snapshot?.lines?.length) return;
      show(order, snapshot);
    } catch (error) {
      if (turn !== serial || root.dataset.orderId !== id || error?.status === 404) return;
      root.hidden = false;
      root.replaceChildren(node('p', error.message || 'Shelf stock is unavailable.'));
    }
  };
})();
