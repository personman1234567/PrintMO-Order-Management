(() => {
  const view = document.getElementById('inventory-view');
  if (!view) return;
  const list = document.getElementById('shelf-inventory-list');
  const queue = document.getElementById('shelf-to-pull-list');
  const status = document.getElementById('shelf-inventory-status');
  const search = document.getElementById('shelf-inventory-search');
  const refresh = document.getElementById('shelf-inventory-refresh');
  const el = (tag, copy, className) => {
    const item = document.createElement(tag);
    if (copy !== undefined) item.textContent = copy;
    if (className) item.className = className;
    return item;
  };
  const mutationKey = () => `shelf:${crypto.randomUUID()}`;
  let snapshot = null;
  let loading = null;

  function variantLabel(item) {
    return item.title || item.selectedOptions?.map(option => option.value).join(' / ') || item.sku;
  }

  function visibleVariants() {
    const term = search.value.trim().toLocaleLowerCase();
    return (snapshot?.variants || []).filter(item => !term ||
      `${variantLabel(item)} ${item.sku}`.toLocaleLowerCase().includes(term));
  }

  async function saveCount(item, form, amount, reason, button) {
    const onShelf = Number(amount.value);
    if (amount.value === '' || !Number.isSafeInteger(onShelf) || onShelf < 0 || !reason.value.trim()) {
      form.querySelector('.shelf-form-message').textContent = 'Enter the physical on-shelf count and a reason.';
      return;
    }
    button.disabled = true;
    try {
      await window.api.setShelfCount(item.variantId, {
        onShelf, expectedVersion: item.stockVersion, reason: reason.value.trim(), idempotencyKey: mutationKey()
      });
      await load(`${variantLabel(item)} count saved: ${onShelf} physically on shelf.`);
    } catch (error) {
      form.querySelector('.shelf-form-message').textContent = error.message || 'Count not saved. Refresh and try again.';
      button.disabled = false;
    }
  }

  async function saveReceipt(item, form, amount, button) {
    const qty = Number(amount.value);
    if (!Number.isSafeInteger(qty) || qty < 1) {
      form.querySelector('.shelf-form-message').textContent = 'Enter the number of blanks physically added to the shelf.';
      return;
    }
    button.disabled = true;
    try {
      await window.api.receiveShelfStock(item.variantId, {
        qty, expectedVersion: item.stockVersion, idempotencyKey: mutationKey()
      });
      await load(`${qty} ${variantLabel(item)} ${qty === 1 ? 'blank' : 'blanks'} added to the shelf.`);
    } catch (error) {
      form.querySelector('.shelf-form-message').textContent = error.message || 'Receipt not saved. Refresh and try again.';
      button.disabled = false;
    }
  }

  function stockForm(item, kind) {
    const form = el('div', undefined, 'shelf-stock-form');
    const amountLabel = el('label', kind === 'count' ? 'Physical count' : 'Units received');
    const amount = el('input');
    amount.type = 'number'; amount.min = kind === 'count' ? '0' : '1'; amount.step = '1';
    amount.value = kind === 'count' && item.onShelf !== null ? String(item.onShelf) : '';
    amountLabel.append(amount);
    form.append(amountLabel);
    let reason;
    if (kind === 'count') {
      const reasonLabel = el('label', 'Reason');
      reason = el('input'); reason.type = 'text'; reason.maxLength = 240;
      reason.placeholder = item.onShelf === null ? 'Opening count' : 'Count correction';
      reasonLabel.append(reason); form.append(reasonLabel);
    }
    const save = el('button', kind === 'count' ? 'Save physical count' : 'Add received stock', 'shelf-primary-button');
    save.type = 'button';
    save.onclick = () => kind === 'count' ? saveCount(item, form, amount, reason, save) : saveReceipt(item, form, amount, save);
    const cancel = el('button', 'Cancel', 'shelf-quiet-button');
    cancel.type = 'button'; cancel.onclick = () => form.remove();
    form.append(save, cancel, el('span', '', 'shelf-form-message'));
    return form;
  }

  function renderStock() {
    list.replaceChildren();
    const variants = visibleVariants();
    for (const item of variants) {
      const row = el('article', undefined, 'shelf-stock-row');
      const identity = el('div', undefined, 'shelf-stock-identity');
      identity.append(el('strong', variantLabel(item)), el('span', item.sku));
      row.append(identity);
      const counts = el('dl', undefined, 'shelf-stock-counts');
      const reserved = item.onShelf === null ? null : item.onShelf - item.available;
      for (const [label, value, emphasis] of [
        ['On shelf', item.onShelf], ['Reserved', reserved], ['Free to reserve', item.available]
      ]) {
        const pair = el('div', undefined, emphasis === undefined && label === 'Free to reserve' ? 'shelf-count-emphasis' : '');
        pair.append(el('dt', label), el('dd', value === null ? 'Not counted' : String(value)));
        counts.append(pair);
      }
      row.append(counts);
      const actions = el('div', undefined, 'shelf-stock-actions');
      const count = el('button', item.onShelf === null ? 'Set opening count' : 'Correct count', 'shelf-quiet-button');
      count.type = 'button'; count.onclick = () => {
        row.querySelector('.shelf-stock-form')?.remove();
        row.append(stockForm(item, 'count'));
      };
      actions.append(count);
      if (item.onShelf !== null) {
        const receive = el('button', 'Add received', 'shelf-quiet-button');
        receive.type = 'button'; receive.onclick = () => {
          row.querySelector('.shelf-stock-form')?.remove();
          row.append(stockForm(item, 'receive'));
        };
        actions.append(receive);
      }
      row.append(actions);
      list.append(row);
    }
    if (!variants.length) list.append(el('p', snapshot?.variants?.length ? 'No variants match this search.' : 'No Tultex 202 variants were returned.', 'shelf-empty'));
    const counted = (snapshot?.variants || []).filter(item => item.onShelf !== null).length;
    document.getElementById('shelf-counted-summary').textContent = `${counted} of ${snapshot?.variants?.length || 0} counted`;
  }

  function renderQueue() {
    queue.replaceChildren();
    const rows = snapshot?.toPull || [];
    document.getElementById('shelf-to-pull-count').textContent = String(rows.reduce((total, item) => total + item.reserved, 0));
    if (!rows.length) {
      queue.append(el('p', 'No blanks are waiting to be pulled for orders.', 'shelf-empty'));
      return;
    }
    const catalog = new Map(snapshot.variants.map(item => [item.variantId, item]));
    for (const item of rows) {
      const row = el('article', undefined, 'shelf-pull-row');
      const text = el('div', undefined, 'shelf-pull-identity');
      text.append(el('strong', item.orderName), el('span', `${variantLabel(catalog.get(item.variantId) || item)} · ${item.sku}`));
      row.append(text, el('span', `${item.reserved} to pull`, 'shelf-pull-count'));
      if (item.active) {
        const control = el('div', undefined, 'shelf-pull-action');
        const amount = el('input'); amount.type = 'number'; amount.min = '1'; amount.max = String(item.reserved);
        amount.step = '1'; amount.value = String(item.reserved); amount.setAttribute('aria-label', `Units pulled for ${item.orderName}`);
        const button = el('button', 'Mark pulled', 'shelf-primary-button'); button.type = 'button';
        const message = el('span', '', 'shelf-form-message');
        button.onclick = async () => {
          const qty = Number(amount.value);
          if (!Number.isSafeInteger(qty) || qty < 1 || qty > item.reserved) {
            message.textContent = 'Enter a valid quantity to pull.'; return;
          }
          button.disabled = true;
          try {
            await window.api.setShelfPulled(item.orderId, { lineItemId: item.lineItemId,
              pulledQty: item.pulled + qty, physicallyPulled: true,
              expectedVersion: item.claimVersion, idempotencyKey: mutationKey() });
            await load(`${qty} ${item.sku} ${qty === 1 ? 'blank' : 'blanks'} marked pulled for ${item.orderName}.`);
          } catch (error) { message.textContent = error.message || 'Pull not saved. Refresh and try again.'; button.disabled = false; }
        };
        control.append(amount, button, message); row.append(control);
      } else row.append(el('span', 'Order is no longer active. Review before pulling.', 'shelf-queue-warning'));
      queue.append(row);
    }
  }

  async function load(successMessage) {
    if (loading) return loading;
    status.textContent = successMessage || 'Loading in-house inventory…';
    loading = (async () => {
      try {
        snapshot = await window.api.getShelfInventory();
        renderQueue(); renderStock();
        status.textContent = successMessage || 'Physical shelf stock is separate from S&S supplier inventory.';
      } catch (error) {
        status.textContent = error.message || 'Inventory could not load. Try again.';
      } finally { loading = null; }
    })();
    return loading;
  }

  search.addEventListener('input', renderStock);
  refresh.addEventListener('click', () => load());
  window.loadShelfInventory = load;
  window.openShelfInventory = () => document.querySelector('.app-nav-tab[data-view="inventory"]')?.click();
})();
