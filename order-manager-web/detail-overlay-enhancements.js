(function () {
  const checkboxIds = [
    'chk-blanks',
    'chk-prints',
    'chk-blanks-ordered',
    'chk-prints-ordered'
  ];
  const readinessSequences = [
    {
      key: 'blanks',
      orderedId: 'chk-blanks-ordered',
      readyId: 'chk-blanks',
      orderedLabel: 'Blanks ordered',
      readyLabel: 'Blanks ready'
    },
    {
      key: 'prints',
      orderedId: 'chk-prints-ordered',
      readyId: 'chk-prints',
      orderedLabel: 'Prints ordered',
      readyLabel: 'Prints ready'
    }
  ];
  let mockupObserver = null;
  let itemTableObserver = null;
  let designFilesObserver = null;
  let readyApplyObserver = null;
  let designFilesEnhanceScheduled = false;
  let currentDetailOrder = null;
  let savedNotesText = '';
  let notesSavedFlashTimer = null;
  let selectedMockupIndex = 0;
  let assetViewerCloseTimer = null;
  let detailTabControllerWired = false;

  function normalizedStatusClass(value) {
    return `is-${String(value || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`;
  }

  function setStatusBadge(element, value, fallback) {
    if (!element) return;
    const label = String(value || fallback || 'Unknown').trim();
    element.textContent = label;
    element.className = `status-badge ${normalizedStatusClass(label)}`;
  }

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

  function orderContextParts(name) {
    const rawName = String(name || '').trim();
    if (typeof splitOrderName === 'function') {
      const [number = '', customer = ''] = splitOrderName(rawName);
      return {
        number: number || rawName || '-',
        customer: customer || ''
      };
    }
    const match = rawName.match(/^(.+?)\s+[–-]\s+(.+)$/);
    return {
      number: match ? match[1] : rawName || '-',
      customer: match ? match[2] : ''
    };
  }

  function formatContextDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function cleanNoteValue(value) {
    const text = String(value || '').replace(/\r\n/g, '\n').trim();
    return text === 'No special instructions' ? '' : text;
  }

  function noteLineCount(text) {
    if (!text) return 0;
    return text.split('\n').filter(line => line.trim()).length || 1;
  }

  function syncCustomerContext(order) {
    if (!order) return;
    currentDetailOrder = order;
    const parts = orderContextParts(order.name);
    const counts = itemCounts(order);
    const orderNumber = document.getElementById('detail-context-order');
    const received = document.getElementById('detail-context-received');
    const items = document.getElementById('detail-context-items');

    if (orderNumber) {
      orderNumber.textContent = parts.number;
      orderNumber.title = String(order.name || parts.number);
    }
    if (received) {
      received.textContent = formatContextDate(order.receivedAt);
      received.title = order.receivedAt ? new Date(order.receivedAt).toLocaleString() : '';
    }
    if (items) {
      items.textContent = `${counts.apparel} apparel / ${counts.prints} prints`;
      items.title = `${counts.all} total line-item quantity`;
    }
  }

  function autoGrowNotesInput() {
    const input = document.getElementById('detail-notes-input');
    if (!input || input.classList.contains('hidden')) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }

  function updateNotesPreview(text) {
    const preview = document.getElementById('detail-notes');
    if (!preview) return;
    preview.textContent = text || 'No special instructions';
    preview.classList.toggle('is-empty-note', !text);
    preview.title = text || '';
  }

  function syncNotesSummary(text) {
    const card = document.getElementById('detail-notes-wrapper');
    const summary = document.getElementById('detail-notes-summary');
    const hasNotes = Boolean(text);
    const lines = noteLineCount(text);

    if (card) {
      card.classList.toggle('has-notes', hasNotes);
      card.classList.toggle('is-empty-note-card', !hasNotes);
    }
    if (summary) {
      summary.textContent = hasNotes
        ? `${lines} ${lines === 1 ? 'line' : 'lines'} of instructions`
        : 'No notes';
    }
  }

  function syncNotesEditState() {
    const card = document.getElementById('detail-notes-wrapper');
    const input = document.getElementById('detail-notes-input');
    const status = document.getElementById('detail-notes-edit-status');
    const save = document.getElementById('detail-notes-save-btn');
    if (!card || !input) return;

    const currentText = cleanNoteValue(input.value);
    const hasUnsaved = currentText !== savedNotesText;
    card.classList.toggle('has-unsaved-notes', hasUnsaved);
    if (save) save.disabled = !hasUnsaved;
    if (status) {
      if (hasUnsaved) status.textContent = 'Unsaved changes';
      else if (currentText) status.textContent = `${noteLineCount(currentText)} ${noteLineCount(currentText) === 1 ? 'line' : 'lines'}`;
      else status.textContent = 'No changes';
    }
    autoGrowNotesInput();
  }

  function setNotesEditing(editing) {
    const card = document.getElementById('detail-notes-wrapper');
    const preview = document.querySelector('.detail-notes-preview');
    const input = document.getElementById('detail-notes-input');
    const edit = document.getElementById('detail-edit-notes-btn');
    if (!card || !preview || !input) return;

    card.classList.toggle('is-editing-notes', editing);
    preview.classList.toggle('hidden', editing);
    input.classList.toggle('hidden', !editing);
    if (edit) {
      edit.textContent = editing ? 'Editing' : 'Edit';
      edit.setAttribute('aria-pressed', editing ? 'true' : 'false');
    }

    if (editing) {
      input.value = savedNotesText;
      requestAnimationFrame(() => {
        autoGrowNotesInput();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    } else {
      card.classList.remove('has-unsaved-notes', 'is-saving-notes');
      input.classList.add('hidden');
      preview.classList.remove('hidden');
    }
    syncNotesEditState();
  }

  function syncNotesContext(order) {
    if (order) currentDetailOrder = order;
    const activeOrder = order || currentDetailOrder || (typeof detailOrder !== 'undefined' ? detailOrder : null);
    const text = cleanNoteValue(activeOrder?.notes);
    const card = document.getElementById('detail-notes-wrapper');
    const input = document.getElementById('detail-notes-input');

    if (!card?.classList.contains('is-editing-notes')) {
      savedNotesText = text;
      updateNotesPreview(text);
      if (input) input.value = text;
    }
    syncNotesSummary(text);
    syncNotesEditState();
  }

  function updateStoredOrderNotes(order, notes) {
    if (!order) return;
    order.notes = notes;
    if (typeof detailOrder !== 'undefined' && detailOrder) detailOrder.notes = notes;
    if (typeof allOrders !== 'undefined' && Array.isArray(allOrders)) {
      const stored = allOrders.find(item => item.name === order.name);
      if (stored) stored.notes = notes;
    }
  }

  async function saveInlineNotes() {
    const card = document.getElementById('detail-notes-wrapper');
    const input = document.getElementById('detail-notes-input');
    const save = document.getElementById('detail-notes-save-btn');
    const order = currentDetailOrder || (typeof detailOrder !== 'undefined' ? detailOrder : null);
    if (!card || !input || !order) return;

    const nextNotes = cleanNoteValue(input.value);
    card.classList.add('is-saving-notes');
    if (save) save.disabled = true;
    try {
      await window.api.updateNotes(order.name, nextNotes);
      updateStoredOrderNotes(order, nextNotes);
      savedNotesText = nextNotes;
      updateNotesPreview(nextNotes);
      syncNotesSummary(nextNotes);
      setNotesEditing(false);
      card.classList.add('is-saved-notes');
      clearTimeout(notesSavedFlashTimer);
      notesSavedFlashTimer = setTimeout(() => card.classList.remove('is-saved-notes'), 900);
    } catch (error) {
      const status = document.getElementById('detail-notes-edit-status');
      card.classList.add('has-unsaved-notes');
      syncNotesEditState();
      if (status) status.textContent = `Could not save: ${error?.message || error}`;
    } finally {
      card.classList.remove('is-saving-notes');
    }
  }

  function wireCustomerNotesControls() {
    const edit = document.getElementById('detail-edit-notes-btn');
    const cancel = document.getElementById('detail-notes-cancel-btn');
    const save = document.getElementById('detail-notes-save-btn');
    const input = document.getElementById('detail-notes-input');

    if (edit && !edit.dataset.detailInlineNotesWired) {
      edit.dataset.detailInlineNotesWired = 'true';
      edit.addEventListener('click', event => {
        if (window.matchMedia('(max-width: 900px)').matches) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        syncNotesContext();
        setNotesEditing(true);
      }, true);
    }
    if (cancel && !cancel.dataset.detailInlineNotesWired) {
      cancel.dataset.detailInlineNotesWired = 'true';
      cancel.addEventListener('click', event => {
        event.preventDefault();
        setNotesEditing(false);
        syncNotesContext();
      });
    }
    if (save && !save.dataset.detailInlineNotesWired) {
      save.dataset.detailInlineNotesWired = 'true';
      save.addEventListener('click', event => {
        event.preventDefault();
        saveInlineNotes();
      });
    }
    if (input && !input.dataset.detailInlineNotesWired) {
      input.dataset.detailInlineNotesWired = 'true';
      input.addEventListener('input', syncNotesEditState);
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setNotesEditing(false);
          syncNotesContext();
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          saveInlineNotes();
        }
      });
    }
  }

  function readyStateFromInputs() {
    const checked = checkboxIds.filter(id => document.getElementById(id)?.checked).length;
    if (checked === checkboxIds.length) return { label: 'Ready', state: 'ready' };
    if (checked > 0) return { label: `${checked}/4 milestones`, state: 'partial' };
    return { label: 'Not ready', state: 'missing' };
  }

  function syncReadySummary() {
    const summary = document.getElementById('detail-header-ready-summary');
    const state = readyStateFromInputs();
    if (summary) {
      summary.textContent = state.label;
      summary.dataset.state = state.state;
    }
    syncProductionTimeline(state);
  }

  function syncProductionTimeline(readyState = readyStateFromInputs()) {
    if (!readyState || typeof readyState.label !== 'string') readyState = readyStateFromInputs();
    const card = document.getElementById('detail-production-card');
    const pill = document.getElementById('production-status-pill');
    const apply = document.getElementById('ready-apply');
    const completed = checkboxIds.filter(id => document.getElementById(id)?.checked).length;

    if (card) {
      card.dataset.readyState = readyState.state;
      card.classList.toggle('has-pending-ready', Boolean(apply && !apply.classList.contains('hidden')));
    }
    if (pill) {
      pill.textContent = readyState.label;
      pill.dataset.state = readyState.state;
      pill.title = `${completed} of ${checkboxIds.length} production milestones complete`;
    }

    readinessSequences.forEach(sequence => {
      const orderedInput = document.getElementById(sequence.orderedId);
      const readyInput = document.getElementById(sequence.readyId);
      if (!orderedInput || !readyInput) return;

      const orderedStep = orderedInput.closest('.production-step');
      const readyStep = readyInput.closest('.production-step');
      const orderedComplete = orderedInput.checked;
      const readyComplete = readyInput.checked;
      const readyBlocked = !orderedComplete && !readyComplete;

      readyInput.disabled = readyBlocked;
      readyStep?.setAttribute('aria-disabled', String(readyBlocked));

      [
        {
          input: orderedInput,
          step: orderedStep,
          complete: orderedComplete,
          next: !orderedComplete,
          blocked: false,
          label: sequence.orderedLabel,
          stateText: orderedComplete ? 'Done' : 'Next'
        },
        {
          input: readyInput,
          step: readyStep,
          complete: readyComplete,
          next: orderedComplete && !readyComplete,
          blocked: readyBlocked,
          label: sequence.readyLabel,
          stateText: readyComplete ? 'Done' : readyBlocked ? 'Order first' : 'Next'
        }
      ].forEach(stepState => {
        if (!stepState.step) return;
        stepState.step.classList.remove('is-complete', 'is-next', 'is-waiting', 'is-blocked');
        stepState.step.classList.add(
          stepState.complete
            ? 'is-complete'
            : stepState.blocked
              ? 'is-blocked'
              : stepState.next
                ? 'is-next'
                : 'is-waiting'
        );
        stepState.step.dataset.state = stepState.complete
          ? 'done'
          : stepState.blocked
            ? 'blocked'
            : stepState.next
              ? 'next'
              : 'waiting';
        stepState.step.title = `${stepState.label}: ${stepState.stateText}`;
        stepState.input.setAttribute('aria-label', `${stepState.label}, ${stepState.stateText}`);
        const stateLabel = stepState.step.querySelector('.production-step-state');
        if (stateLabel) stateLabel.textContent = stepState.stateText;
      });
    });
  }

  function setReadyBaselines() {
    checkboxIds.forEach(id => {
      const input = document.getElementById(id);
      if (input) input.dataset.persistedChecked = String(input.checked);
    });
  }

  function pendingReadyCount() {
    return checkboxIds.filter(id => {
      const input = document.getElementById(id);
      return input && String(input.checked) !== input.dataset.persistedChecked;
    }).length;
  }

  function syncReadyPendingState() {
    const apply = document.getElementById('ready-apply');
    const status = document.getElementById('detail-save-status');
    const pending = pendingReadyCount();
    if (apply && !apply.dataset.saving) {
      apply.classList.toggle('hidden', pending === 0);
      apply.textContent = apply.dataset.retry === 'true'
        ? 'Retry saving statuses'
        : pending
          ? `Save ${pending} status ${pending === 1 ? 'change' : 'changes'}`
        : 'Save status changes';
    }
    if (status && !status.classList.contains('is-success') && !status.classList.contains('is-error')) {
      status.textContent = pending ? `${pending} unsaved ${pending === 1 ? 'change' : 'changes'}` : '';
    }
    syncReadySummary();
  }

  function enforceReadinessSequence(changedInput) {
    const sequence = readinessSequences.find(candidate =>
      candidate.orderedId === changedInput?.id || candidate.readyId === changedInput?.id
    );
    if (!sequence) return;
    const orderedInput = document.getElementById(sequence.orderedId);
    const readyInput = document.getElementById(sequence.readyId);
    if (!orderedInput || !readyInput) return;
    if (changedInput.id === sequence.orderedId && !orderedInput.checked && readyInput.checked) {
      readyInput.checked = false;
      const status = document.getElementById('detail-save-status');
      if (status) status.textContent = `${sequence.readyLabel} was cleared because ordering is required first.`;
    }
  }

  function wireReadyApplyFeedback() {
    const apply = document.getElementById('ready-apply');
    const status = document.getElementById('detail-save-status');
    if (!apply || typeof apply.onclick !== 'function' || apply.onclick.__detailFeedbackWrapped) return;
    const originalApply = apply.onclick;
    const wrappedApply = async function wrappedReadyApply(event) {
      if (apply.dataset.saving === 'true') return;
      apply.dataset.saving = 'true';
      apply.disabled = true;
      apply.textContent = 'Saving statuses...';
      status?.classList.remove('is-success', 'is-error');
      if (status) status.textContent = 'Saving production statuses...';
      try {
        await originalApply.call(this, event);
        delete apply.dataset.retry;
        setReadyBaselines();
        status?.classList.add('is-success');
        if (status) status.textContent = 'Production statuses saved.';
      } catch (error) {
        apply.dataset.retry = 'true';
        status?.classList.add('is-error');
        if (status) status.textContent = `Could not save statuses: ${error?.message || error}`;
      } finally {
        delete apply.dataset.saving;
        apply.disabled = false;
        syncReadyPendingState();
      }
    };
    wrappedApply.__detailFeedbackWrapped = true;
    apply.onclick = wrappedApply;
  }

  function wireProgressFeedback() {
    const button = document.getElementById('progress-plus1');
    const status = document.getElementById('progress-save-status');
    if (!button || typeof button.onclick !== 'function' || button.onclick.__detailFeedbackWrapped) return;
    const originalClick = button.onclick;
    const wrappedClick = async function wrappedProgressClick(event) {
      if (button.dataset.saving === 'true') return;
      const order = currentDetailOrder || (typeof detailOrder !== 'undefined' ? detailOrder : null);
      const previousProgress = Number(order?.progress) || 0;
      button.dataset.saving = 'true';
      button.disabled = true;
      status?.classList.remove('is-success', 'is-error');
      if (status) status.textContent = 'Saving print count...';
      try {
        await originalClick.call(this, event);
        status?.classList.add('is-success');
        if (status) status.textContent = 'Print count saved.';
      } catch (error) {
        if (order) {
          order.progress = previousProgress;
          const apparel = itemCounts(order).apparel;
          const progressText = document.getElementById('progress-text');
          const progressBar = document.getElementById('progress-bar');
          if (progressText) progressText.textContent = `${previousProgress} / ${apparel} pieces printed`;
          if (progressBar) progressBar.style.width = `${apparel ? Math.min(100, (previousProgress / apparel) * 100) : 0}%`;
        }
        status?.classList.add('is-error');
        if (status) status.textContent = `Could not save print count: ${error?.message || error}`;
      } finally {
        delete button.dataset.saving;
        button.disabled = false;
      }
    };
    wrappedClick.__detailFeedbackWrapped = true;
    button.onclick = wrappedClick;
  }

  function wireReadyApplyObserver() {
    const apply = document.getElementById('ready-apply');
    if (!apply || readyApplyObserver) return;

    readyApplyObserver = new MutationObserver(syncProductionTimeline);
    readyApplyObserver.observe(apply, {
      attributes: true,
      attributeFilter: ['class']
    });
    apply.addEventListener('click', () => {
      requestAnimationFrame(syncProductionTimeline);
      setTimeout(syncProductionTimeline, 300);
      setTimeout(syncProductionTimeline, 1000);
    });
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
    setStatusBadge(
      document.getElementById('badge-financial'),
      order.displayFinancialStatus || order.financialStatus,
      'Payment pending'
    );
    setStatusBadge(
      document.getElementById('badge-fulfillment'),
      order.displayFulfillmentStatus || order.fulfillmentStatus,
      'Unfulfilled'
    );
    syncCustomerContext(order);
    syncNotesContext(order);
    syncCommerceDetail(order);
    syncReadySummary();
  }

  function addressLines(address, fallbackName) {
    if (!address) return [];
    return [
      address.name || fallbackName,
      [address.address1, address.address2].filter(Boolean).join(' '),
      [address.city, address.provinceCode || address.province, address.zip].filter(Boolean).join(', '),
      address.country || address.countryCode
    ].filter(Boolean);
  }

  function syncCommerceDetail(order) {
    const noteBanner = document.getElementById('customer-checkout-note-banner');
    const noteText = document.getElementById('customer-checkout-note-text');
    const checkoutNote = String(order?.shopifyNote || '').trim();
    if (noteText) noteText.textContent = checkoutNote;
    noteBanner?.classList.toggle('hidden', !checkoutNote);

    const itemCount = Array.isArray(order?.items) ? order.items.length : 0;
    const itemsBadge = document.getElementById('tab-badge-items');
    if (itemsBadge) {
      itemsBadge.textContent = String(itemCount);
      itemsBadge.setAttribute('aria-label', `${itemCount} ${itemCount === 1 ? 'line item' : 'line items'}`);
    }

    const customerName = document.getElementById('detail-cust-name')?.textContent?.trim() || '';
    const address = document.getElementById('logistics-address-text');
    if (address) {
      address.replaceChildren();
      const lines = addressLines(order?.shippingAddress, customerName);
      if (lines.length) {
        lines.forEach((line, index) => {
          const lineElement = document.createElement(index === 0 ? 'strong' : 'span');
          lineElement.textContent = line;
          address.appendChild(lineElement);
        });
      } else {
        const unavailable = document.createElement('span');
        unavailable.className = 'redacted-info-badge';
        unavailable.textContent = 'Customer data unavailable or redacted by Shopify';
        address.appendChild(unavailable);
      }
    }

    const tracking = document.getElementById('logistics-tracking-link');
    if (tracking) {
      tracking.replaceChildren();
      const trackingNumber = String(order?.trackingNumber || order?.tracking?.number || '').trim();
      const trackingUrl = String(order?.trackingUrl || order?.tracking?.url || '').trim();
      if (trackingUrl && /^https?:\/\//i.test(trackingUrl)) {
        const link = document.createElement('a');
        link.href = trackingUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = trackingNumber || 'Open tracking';
        tracking.appendChild(link);
      } else {
        tracking.textContent = trackingNumber || 'No tracking number';
      }
    }

    const email = document.getElementById('customer-email-val');
    const phone = document.getElementById('customer-phone-val');
    if (email) email.textContent = order?.email || 'Redacted or unavailable';
    if (phone) phone.textContent = order?.phone || 'Redacted or unavailable';
  }

  function wireReadyInputs() {
    checkboxIds.forEach(id => {
      const input = document.getElementById(id);
      if (!input || input.dataset.detailSummaryWired) return;
      input.dataset.detailSummaryWired = 'true';
      input.addEventListener('change', () => {
        const status = document.getElementById('detail-save-status');
        const apply = document.getElementById('ready-apply');
        if (apply) delete apply.dataset.retry;
        status?.classList.remove('is-success', 'is-error');
        enforceReadinessSequence(input);
        syncReadyPendingState();
      });
    });
    wireReadyApplyObserver();
    syncProductionTimeline();
  }

  function activateDetailTab(panelId, options = {}) {
    const tabs = Array.from(document.querySelectorAll('#detail-tabs-header .detail-tab-item'));
    const panels = Array.from(document.querySelectorAll('#detail-tab-panels .detail-tab-panel'));
    const targetTab = tabs.find(tab => tab.dataset.tab === panelId) || tabs[0];
    if (!targetTab) return;

    tabs.forEach(tab => {
      const active = tab === targetTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => {
      const active = panel.id === targetTab.dataset.tab;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', String(!active));
    });
    if (options.focus) targetTab.focus();
  }

  function wireDetailTabs() {
    const tablist = document.getElementById('detail-tabs-header');
    if (!tablist || detailTabControllerWired) return;
    detailTabControllerWired = true;
    tablist.addEventListener('click', event => {
      const tab = event.target.closest('.detail-tab-item');
      if (!tab || !tablist.contains(tab)) return;
      event.preventDefault();
      activateDetailTab(tab.dataset.tab);
    });
    tablist.addEventListener('keydown', event => {
      const tabs = Array.from(tablist.querySelectorAll('.detail-tab-item'));
      const current = event.target.closest('.detail-tab-item');
      const index = tabs.indexOf(current);
      if (index < 0) return;
      let nextIndex = index;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      activateDetailTab(tabs[nextIndex].dataset.tab, { focus: true });
    });
  }

  function mockupThumbs() {
    return Array.from(document.querySelectorAll('#detail-mockups-track .mockup-thumb'));
  }

  function setMainMockupMessage(message) {
    const content = document.getElementById('detail-mockup-main-content');
    if (!content) return;
    content.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    content.appendChild(text);
  }

  function setAssetViewerCaption(text) {
    const caption = document.getElementById('asset-viewer-caption');
    if (!caption) return;
    caption.textContent = text || '';
  }

  function assetLabelFromTarget(target) {
    const thumb = target?.closest?.('.mockup-thumb');
    if (thumb) {
      const thumbs = mockupThumbs();
      const index = thumbs.indexOf(thumb);
      return index >= 0 ? `Mockup ${index + 1} of ${thumbs.length}` : 'Mockup preview';
    }
    const designRow = target?.closest?.('.design-file-row, .design-tile');
    if (designRow) {
      return designRow.querySelector('.design-label')?.textContent?.trim() || 'Design file preview';
    }
    return '';
  }

  function fileNameParts(name) {
    const clean = String(name || '').trim();
    const match = clean.match(/\.([a-z0-9]{2,6})(?:$|\?)/i);
    return {
      name: clean,
      extension: match ? match[1].toUpperCase() : 'FILE'
    };
  }

  function designRows() {
    return Array.from(document.querySelectorAll('#detail-design-panel .design-file-row, #detail-design-panel .design-tile'));
  }

  function setDesignEmptyState() {
    const placeholder = document.getElementById('detail-designs-placeholder');
    if (!placeholder || placeholder.dataset.detailPolished) return;
    placeholder.dataset.detailPolished = 'true';
    placeholder.innerHTML = `
      <span class="design-empty-icon" aria-hidden="true"></span>
      <span class="design-empty-copy">
        <strong>No design files found</strong>
        <span>Files will appear here when synced or attached.</span>
      </span>
    `;
  }

  function ensurePreviewButton(row, labelButton, thumb, previewUrl, filename) {
    const actions = row.querySelector('.design-actions');
    if (!actions) return;
    const existing = actions.querySelector('.detail-asset-preview');
    if (existing) {
      existing.setAttribute('aria-label', `Preview ${filename}`);
      existing.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        setAssetViewerCaption(filename);
        if (typeof openAssetViewer === 'function') openAssetViewer(previewUrl);
      };
      return;
    }

    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'detail-asset-preview';
    previewButton.textContent = 'Preview';
    previewButton.setAttribute('aria-label', `Preview ${filename}`);
    previewButton.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      setAssetViewerCaption(filename);
      if (typeof openAssetViewer === 'function') openAssetViewer(previewUrl);
    };
    actions.prepend(previewButton);

    [labelButton, thumb].filter(Boolean).forEach(target => {
      target.setAttribute('aria-label', `Preview ${filename}`);
    });
  }

  function enhanceDesignFileRow(row) {
    if (!row) return;
    const firstPass = !row.dataset.detailDesignPolished;
    row.dataset.detailDesignPolished = 'true';

    const labelButton = row.querySelector('.design-label');
    const thumb = row.querySelector('.design-thumb');
    const image = thumb?.querySelector('img');
    const meta = row.querySelector('.design-file-meta');
    const type = row.querySelector('.design-print-type');
    const download = row.querySelector('.detail-asset-download');
    const status = row.querySelector('.detail-asset-status');
    const filename = labelButton?.textContent?.trim() || image?.alt || 'Design file';
    const parts = fileNameParts(filename);

    row.title = filename;
    row.dataset.fileExtension = parts.extension;
    row.classList.toggle('has-preview', Boolean(image?.src));

    if (labelButton && firstPass) {
      labelButton.title = filename;
      labelButton.addEventListener('click', () => setAssetViewerCaption(filename), true);
    }
    if (thumb && firstPass) {
      thumb.setAttribute('title', `Preview ${filename}`);
      thumb.addEventListener('click', () => setAssetViewerCaption(filename), true);
    }
    if (image) image.alt = `${filename} preview`;
    if (meta) meta.title = meta.textContent.trim();
    if (type) type.title = type.textContent.trim();
    if (download) {
      download.setAttribute('aria-label', `Download ${filename}`);
      download.title = `Download ${filename}`;
    }
    if (status) status.setAttribute('role', 'status');

    let extBadge = row.querySelector('.design-file-extension');
    if (!extBadge) {
      extBadge = document.createElement('span');
      extBadge.className = 'design-file-extension';
      row.querySelector('.design-file-info')?.appendChild(extBadge);
    }
    extBadge.textContent = parts.extension;
    extBadge.title = `${parts.extension} file`;

    const previewUrl = image?.src || image?.getAttribute('src') || '';
    if (previewUrl) ensurePreviewButton(row, labelButton, thumb, previewUrl, filename);
  }

  function enhanceDesignGroups() {
    const groups = [
      ['design-group-front', 'Front Prints'],
      ['design-group-back', 'Back Prints'],
      ['design-group-extras', 'Extras']
    ];

    groups.forEach(([id, label]) => {
      const group = document.getElementById(id);
      if (!group) return;
      const title = group.querySelector('.design-group-title');
      const rows = Array.from(group.querySelectorAll('.design-file-row, .design-tile'));
      const count = rows.length;
      const countLabel = group.querySelector('.design-group-count');
      group.dataset.fileCount = String(count);
      group.classList.toggle('has-files', count > 0);
      group.classList.toggle('is-empty', count === 0);
      if (countLabel) countLabel.textContent = String(count);
      if (title) {
        title.setAttribute('aria-label', `${label}, ${count} ${count === 1 ? 'file' : 'files'}`);
        title.title = `${label}: ${count} ${count === 1 ? 'file' : 'files'}`;
        if (title instanceof HTMLButtonElement && !title.dataset.detailGroupWired) {
          title.dataset.detailGroupWired = 'true';
          title.addEventListener('click', () => {
            const collapsed = group.classList.toggle('is-collapsed');
            title.setAttribute('aria-expanded', String(!collapsed));
          });
        }
      }
    });
  }

  function enhanceDesignFilesPanel() {
    setDesignEmptyState();
    const panel = document.getElementById('detail-design-panel');
    const rows = designRows();
    const count = document.getElementById('design-files-count');
    if (!panel) return;

    panel.classList.toggle('has-design-files', rows.length > 0);
    panel.classList.toggle('has-many-design-files', rows.length > 8);
    document.getElementById('detail-main-column')?.classList.toggle('has-many-design-files', rows.length > 8);
    if (count) {
      count.textContent = `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`;
      count.title = `${rows.length} design ${rows.length === 1 ? 'file' : 'files'}`;
    }

    rows.forEach(enhanceDesignFileRow);
    enhanceDesignGroups();
  }

  function scheduleDesignFilesEnhancement() {
    if (designFilesEnhanceScheduled) return;
    designFilesEnhanceScheduled = true;
    requestAnimationFrame(() => {
      designFilesEnhanceScheduled = false;
      enhanceDesignFilesPanel();
    });
  }

  function wireDesignFilesPanel() {
    enhanceDesignFilesPanel();
    const panel = document.getElementById('detail-design-panel');
    if (!panel || designFilesObserver) return;

    designFilesObserver = new MutationObserver(scheduleDesignFilesEnhancement);
    designFilesObserver.observe(panel, {
      childList: true,
      subtree: true
    });
    setTimeout(scheduleDesignFilesEnhancement, 250);
    setTimeout(scheduleDesignFilesEnhancement, 1000);
  }

  function syncSelectedMockup(index = selectedMockupIndex) {
    const strip = document.getElementById('detail-mockups-strip');
    const feature = document.getElementById('detail-mockup-feature');
    const mainButton = document.getElementById('detail-mockup-main');
    const content = document.getElementById('detail-mockup-main-content');
    const count = document.getElementById('detail-mockup-count');
    const hint = document.getElementById('detail-mockup-hint');
    const thumbs = mockupThumbs();
    if (!feature || !mainButton || !content || !count) return;

    if (!thumbs.length) {
      selectedMockupIndex = 0;
      strip?.classList.add('no-mockups');
      strip?.classList.remove('has-mockups');
      feature.classList.add('hidden');
      count.textContent = '0 mockups';
      setMainMockupMessage('No mockup previews available');
      return;
    }

    selectedMockupIndex = Math.max(0, Math.min(index, thumbs.length - 1));
    strip?.classList.add('has-mockups');
    strip?.classList.remove('no-mockups');
    feature.classList.remove('hidden');
    count.textContent = `${selectedMockupIndex + 1} of ${thumbs.length} mockup${thumbs.length === 1 ? '' : 's'}`;
    if (hint) hint.textContent = 'Open full-size preview';

    thumbs.forEach((thumb, thumbIndex) => {
      const selected = thumbIndex === selectedMockupIndex;
      thumb.classList.toggle('is-selected', selected);
      thumb.tabIndex = selected ? 0 : -1;
      thumb.setAttribute('aria-selected', String(selected));
      thumb.setAttribute('role', 'option');
      thumb.setAttribute('aria-label', `Select mockup ${thumbIndex + 1}`);
    });

    const activeThumb = thumbs[selectedMockupIndex];
    const activeImg = activeThumb.querySelector('img');
    const activeStatus = activeThumb.querySelector('.detail-asset-status');
    content.innerHTML = '';

    if (activeImg?.src) {
      const img = activeImg.cloneNode(false);
      img.alt = activeImg.alt || `Mockup ${selectedMockupIndex + 1}`;
      content.appendChild(img);
    } else if (activeStatus) {
      setMainMockupMessage(activeStatus.textContent || 'Preview unavailable');
    } else {
      setMainMockupMessage('Loading preview...');
    }

    mainButton.onclick = () => {
      const currentThumb = mockupThumbs()[selectedMockupIndex];
      const currentImage = currentThumb?.querySelector('img');
      if (currentThumb && currentImage?.src) {
        setAssetViewerCaption(assetLabelFromTarget(currentThumb));
        if (typeof openAssetViewer === 'function') openAssetViewer(currentImage.src);
      }
    };
  }

  function wireMockupBrowser() {
    const track = document.getElementById('detail-mockups-track');
    if (!track) return;
    track.setAttribute('role', 'listbox');
    track.setAttribute('aria-label', 'Available order mockups');

    if (!track.dataset.detailBrowserCaptureWired) {
      track.dataset.detailBrowserCaptureWired = 'true';
      track.addEventListener('click', event => {
        if (event.target?.closest?.('.manual-mockup-delete')) return;
        const thumb = event.target?.closest?.('.mockup-thumb');
        if (!thumb || !track.contains(thumb)) return;
        const index = mockupThumbs().indexOf(thumb);
        if (index < 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        selectedMockupIndex = index;
        syncSelectedMockup(index);
      }, true);
    }

    track.querySelectorAll('.mockup-thumb').forEach((thumb, index) => {
      thumb.querySelectorAll('.manual-mockup-delete').forEach(button => {
        button.setAttribute('aria-label', 'Remove mockup');
        button.setAttribute('title', 'Remove mockup');
      });
      if (!thumb.dataset.detailBrowserWired) {
        thumb.dataset.detailBrowserWired = 'true';
        thumb.addEventListener('keydown', event => {
          const thumbs = mockupThumbs();
          const currentIndex = thumbs.indexOf(thumb);
          let nextIndex = currentIndex;
          if (event.key === 'ArrowRight') nextIndex = Math.min(thumbs.length - 1, currentIndex + 1);
          else if (event.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = thumbs.length - 1;
          else if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          selectedMockupIndex = nextIndex;
          syncSelectedMockup(nextIndex);
          if (nextIndex !== currentIndex) thumbs[nextIndex]?.focus();
        });
      }
    });

    if (!mockupObserver) {
      mockupObserver = new MutationObserver(() => {
        wireMockupBrowser();
        syncSelectedMockup();
      });
      mockupObserver.observe(track, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'class']
      });
    }

    syncSelectedMockup();
  }

  function cellText(cell) {
    return cell?.textContent?.replace(/\s+/g, ' ').trim() || '';
  }

  function wrapCellText(cell, className) {
    if (!cell) return;
    cell.classList.add(className);
    const text = cellText(cell);
    if (text) cell.title = text;
    if (cell.querySelector('.detail-cell-copy') || cell.querySelector('.inline-accounting-pill')) return;

    cell.textContent = '';
    const copy = document.createElement('span');
    copy.className = 'detail-cell-copy';
    copy.textContent = text;
    cell.appendChild(copy);
  }

  function enhanceItemsTable(order) {
    const table = document.getElementById('detail-items');
    const wrapper = document.getElementById('detail-items-wrapper');
    const count = document.getElementById('detail-items-count');
    const body = table?.querySelector('tbody');
    if (!table || !body) return;

    const rows = Array.from(body.rows);
    const quantity = order?.items
      ? order.items.reduce((total, item) => total + (Number(item.qty) || 0), 0)
      : rows.reduce((total, row) => total + (Number(cellText(row.cells[0])) || 0), 0);

    if (count) {
      const lineLabel = rows.length === 1 ? 'line' : 'lines';
      const pieceLabel = quantity === 1 ? 'piece' : 'pieces';
      count.textContent = `${rows.length} ${lineLabel} / ${quantity} ${pieceLabel}`;
      count.title = 'Line items and total quantity in this order';
    }

    wrapper?.classList.toggle('has-many-items', rows.length > 12);
    table.dataset.lineCount = String(rows.length);

    rows.forEach((row, index) => {
      const cells = row.cells;
      row.classList.add('detail-item-row');
      row.dataset.rowNumber = String(index + 1);
      wrapCellText(cells[1], 'detail-item-description-cell');
      wrapCellText(cells[2], 'detail-item-variant-cell');

      const description = cellText(cells[1]);
      const isPrint = typeof isPrintItem === 'function'
        ? isPrintItem({ title: description })
        : /print/i.test(description);
      row.classList.toggle('is-print-item', isPrint);
      row.classList.toggle('is-apparel-item', !isPrint);

      if (cells[0]) cells[0].title = `Quantity ${cellText(cells[0]) || '0'}`;
      if (cells[3]) cells[3].title = cellText(cells[3]);
    });
  }

  function wireItemsTable(order) {
    enhanceItemsTable(order);
    const body = document.querySelector('#detail-items tbody');
    if (!body || itemTableObserver) return;

    itemTableObserver = new MutationObserver(() => {
      const activeOrder = typeof detailOrder !== 'undefined' && detailOrder ? detailOrder : order;
      enhanceItemsTable(activeOrder);
    });
    itemTableObserver.observe(body, {
      childList: true,
      subtree: true
    });
  }

  function wireAssetViewerCaptions() {
    if (document.body?.dataset.detailCaptionWired) return;
    document.body.dataset.detailCaptionWired = 'true';
    document.addEventListener('click', event => {
      const label = assetLabelFromTarget(event.target);
      if (label) setAssetViewerCaption(label);
    }, true);
  }

  function patchAssetViewerClose() {
    const currentOpenAssetViewer = typeof openAssetViewer === 'function' ? openAssetViewer : window.openAssetViewer;
    if (typeof currentOpenAssetViewer === 'function' && !currentOpenAssetViewer.__detailOpenPatched) {
      const originalOpenAssetViewer = currentOpenAssetViewer;
      const enhancedOpenAssetViewer = function enhancedOpenAssetViewer(...args) {
        clearTimeout(assetViewerCloseTimer);
        const overlay = document.getElementById('asset-viewer');
        overlay?.classList.remove('asset-viewer-closing');
        return originalOpenAssetViewer.apply(this, args);
      };
      enhancedOpenAssetViewer.__detailOpenPatched = true;
      openAssetViewer = enhancedOpenAssetViewer;
      window.openAssetViewer = enhancedOpenAssetViewer;
    }

    const currentCloseAssetViewer = typeof closeAssetViewer === 'function' ? closeAssetViewer : window.closeAssetViewer;
    if (typeof currentCloseAssetViewer !== 'function' || currentCloseAssetViewer.__detailAnimatedClosePatched) return;
    const originalCloseAssetViewer = currentCloseAssetViewer;
    const animatedCloseAssetViewer = function animatedCloseAssetViewer(...args) {
      const overlay = document.getElementById('asset-viewer');
      if (!overlay || overlay.classList.contains('hidden')) {
        return originalCloseAssetViewer.apply(this, args);
      }

      clearTimeout(assetViewerCloseTimer);
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (reducedMotion) {
        return originalCloseAssetViewer.apply(this, args);
      }

      overlay.classList.add('asset-viewer-closing');
      assetViewerCloseTimer = setTimeout(() => {
        overlay.classList.remove('asset-viewer-closing');
        originalCloseAssetViewer.apply(this, args);
      }, 180);
      return undefined;
    };
    animatedCloseAssetViewer.__detailAnimatedClosePatched = true;
    closeAssetViewer = animatedCloseAssetViewer;
    window.closeAssetViewer = animatedCloseAssetViewer;
  }

  function patchDetailOpen() {
    const currentOpenDetail = typeof openDetail === 'function' ? openDetail : window.openDetail;
    if (typeof currentOpenDetail !== 'function' || currentOpenDetail.__detailSummaryPatched) return;
    const originalOpenDetail = currentOpenDetail;
    const enhancedOpenDetail = function enhancedOpenDetail(order, ...args) {
      const result = originalOpenDetail.call(this, order, ...args);
      const overlay = document.getElementById('detail-overlay');
      overlay?.setAttribute('aria-hidden', 'false');
      activateDetailTab('tab-production');
      syncDetailHeader(order);
      wireCustomerNotesControls();
      wireReadyInputs();
      setReadyBaselines();
      syncReadyPendingState();
      wireReadyApplyFeedback();
      wireProgressFeedback();
      wireDetailTabs();
      wireAssetViewerCaptions();
      patchAssetViewerClose();
      wireItemsTable(order);
      wireDesignFilesPanel();
      requestAnimationFrame(wireMockupBrowser);
      requestAnimationFrame(() => enhanceItemsTable(order));
      requestAnimationFrame(scheduleDesignFilesEnhancement);
      setTimeout(scheduleDesignFilesEnhancement, 250);
      setTimeout(scheduleDesignFilesEnhancement, 1000);
      return result;
    };
    enhancedOpenDetail.__detailSummaryPatched = true;
    openDetail = enhancedOpenDetail;
    window.openDetail = enhancedOpenDetail;
  }

  document.addEventListener('DOMContentLoaded', () => {
    patchDetailOpen();
    wireDetailTabs();
    wireCustomerNotesControls();
    wireReadyInputs();
    wireAssetViewerCaptions();
    patchAssetViewerClose();
    wireMockupBrowser();
    wireItemsTable();
    wireDesignFilesPanel();
  });

  patchDetailOpen();
  wireDetailTabs();
  wireCustomerNotesControls();
  wireAssetViewerCaptions();
  patchAssetViewerClose();
  wireItemsTable();
  wireDesignFilesPanel();
})();
