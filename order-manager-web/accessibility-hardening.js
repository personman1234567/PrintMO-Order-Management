(() => {
  const FLOW = ['received', 'toOrder', 'blanks', 'print'];
  const FLOW_LABELS = {
    received: 'Pipeline',
    toOrder: 'Blanks Cart',
    blanks: 'Blanks',
    print: 'Ready to Print'
  };

  function ensureLiveRegion() {
    let region = document.getElementById('order-manager-a11y-status');
    if (region) return region;
    region = document.createElement('div');
    region.id = 'order-manager-a11y-status';
    region.className = 'visually-hidden';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
    return region;
  }

  function announce(message) {
    const region = ensureLiveRegion();
    region.textContent = '';
    requestAnimationFrame(() => {
      region.textContent = message;
    });
  }

  async function persistMove(names, orders, bundleName, nextStatus) {
    const targetNames = Array.from(new Set((names || []).filter(Boolean)));
    if (!targetNames.length) return false;

    const updateRemote = async () => {
      if (bundleName && typeof window.api?.updateBundleStatus === 'function') {
        await window.api.updateBundleStatus(bundleName, nextStatus);
      } else {
        await Promise.all(targetNames.map(name => window.api.updateStatus(name, nextStatus)));
      }

      if (nextStatus === 'blanks' && typeof updateBlanksOrderedForOrders === 'function') {
        const ordered = typeof blanksOrderedValueForActiveView === 'function'
          ? Boolean(blanksOrderedValueForActiveView())
          : false;
        await updateBlanksOrderedForOrders(targetNames, ordered);
      }
    };

    const patch = typeof movePatchForStatus === 'function'
      ? movePatchForStatus(nextStatus)
      : { status: nextStatus };

    if (typeof applyOptimisticOrderUpdate === 'function') {
      return applyOptimisticOrderUpdate(
        targetNames,
        patch,
        updateRemote,
        `Could not move ${bundleName ? 'bundle' : 'order'}`
      );
    }

    await updateRemote();
    (orders || []).forEach(order => {
      order.status = nextStatus;
    });
    if (typeof renderBoard === 'function') await renderBoard();
    return true;
  }

  function addMoveButton(container, direction, currentIndex, names, orders, bundleName, label) {
    const nextIndex = currentIndex + direction;
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = nextIndex < 0 || nextIndex >= FLOW.length;
    if (button.disabled) return;

    const nextStatus = FLOW[nextIndex];
    const directionLabel = direction < 0 ? 'Move back' : 'Move forward';
    button.textContent = direction < 0 ? 'Move back' : 'Move forward';
    button.setAttribute('aria-label', `${directionLabel}: ${label} to ${FLOW_LABELS[nextStatus]}`);
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      const succeeded = await persistMove(names, orders, bundleName, nextStatus);
      if (succeeded) announce(`${label} moved to ${FLOW_LABELS[nextStatus]}.`);
      else button.disabled = false;
    });
    container.appendChild(button);
  }

  function hardenCard(card, orders, bundleName = '') {
    if (!card || card.dataset.a11yHardened === 'true') return card;
    const normalizedOrders = Array.isArray(orders) ? orders.filter(Boolean) : [orders].filter(Boolean);
    const firstOrder = normalizedOrders[0];
    if (!firstOrder) return card;

    card.dataset.a11yHardened = 'true';
    card.setAttribute('role', 'group');
    const label = bundleName ? `Bundle ${bundleName}` : `Order ${firstOrder.name}`;
    card.setAttribute('aria-label', label);

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'card-a11y-open';
    openButton.textContent = `Open ${label} details`;
    openButton.setAttribute('aria-label', `Open ${label} details`);
    card.insertBefore(openButton, card.firstChild);

    const deleteButton = card.querySelector('.delete-btn');
    if (deleteButton) {
      deleteButton.type = 'button';
      deleteButton.setAttribute('aria-label', `Delete ${label}`);
    }

    const currentIndex = FLOW.indexOf(firstOrder.status);
    if (currentIndex >= 0) {
      const controls = document.createElement('div');
      controls.className = 'card-a11y-move-controls';
      controls.setAttribute('aria-label', `Move ${label} between workflow stages`);
      const names = normalizedOrders.map(order => order.name);
      addMoveButton(controls, -1, currentIndex, names, normalizedOrders, bundleName, label);
      addMoveButton(controls, 1, currentIndex, names, normalizedOrders, bundleName, label);
      if (controls.childElementCount) card.appendChild(controls);
    }

    return card;
  }

  function patchCardFactories() {
    if (typeof makeCard === 'function' && !makeCard.__a11yHardened) {
      const originalMakeCard = makeCard;
      makeCard = function accessibleMakeCard(order, style = 'default', ...args) {
        return hardenCard(originalMakeCard.call(this, order, style, ...args), order);
      };
      makeCard.__a11yHardened = true;
    }

    if (typeof makeBundleCard === 'function' && !makeBundleCard.__a11yHardened) {
      const originalMakeBundleCard = makeBundleCard;
      makeBundleCard = function accessibleMakeBundleCard(name, orders, style = 'pipeline', ...args) {
        return hardenCard(originalMakeBundleCard.call(this, name, orders, style, ...args), orders, name);
      };
      makeBundleCard.__a11yHardened = true;
    }

    document.documentElement.dataset.a11yCardFactories = [
      typeof makeCard === 'function' && makeCard.__a11yHardened ? 'orders' : '',
      typeof makeBundleCard === 'function' && makeBundleCard.__a11yHardened ? 'bundles' : ''
    ].filter(Boolean).join(' ');
  }

  const dialogConfigs = [
    { root: '#detail-overlay', content: '#detail-card', close: '#detail-close' },
    { root: '#bundle-overlay', content: '#bundle-modal' },
    { root: '#bundle-name-overlay', content: '#bundle-name-modal', close: '#bundle-name-cancel', initial: '#bundle-name-input' },
    { root: '#notes-overlay', content: '#notes-modal', close: '#notes-cancel', initial: '#notes-input' },
    { root: '#name-overlay', content: '#name-modal', close: '#name-cancel', initial: '#name-input' },
    { root: '#progress-overlay', content: '#progress-modal', close: '#progress-cancel', initial: '#progress-input' },
    { root: '#view-notes-overlay', content: '#view-notes-modal', close: '#view-notes-close' },
    { root: '#asset-viewer', content: '.viewer-content', close: '#asset-viewer-close' },
    { root: '#storage-detail-overlay', content: '.storage-detail-card', close: '#storage-detail-close' },
    { root: '#ss-submission-overlay', content: '#ss-submission-dialog', close: '#ss-submission-close' },
    { root: '#blanks-receive-overlay', content: '.blanks-receive-dialog', close: '#blanks-receive-close' },
    { root: '#batch-correction-overlay', content: '.batch-correction-dialog', initial: '[data-batch-choice="remove"]' }
  ];
  let lastExternalFocus = null;

  function focusableElements(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter(element => {
      if (element.tabIndex < 0) return false;
      if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
        && element.getClientRects().length > 0;
    });
  }

  function isDialogOpen(config) {
    return Boolean(config.rootElement && !config.rootElement.classList.contains('hidden'));
  }

  function isFocusableNow(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function focusRestorationTarget(opener) {
    if (isFocusableNow(opener)) return opener;
    const fallbackId = opener?.id?.replace(/-(confirm|cancel)$/, '-start');
    const fallback = fallbackId ? document.getElementById(fallbackId) : null;
    if (isFocusableNow(fallback)) return fallback;
    return document.querySelector('.app-nav-tab.active, .order-manager-refresh-btn, .mobile-tab.active');
  }

  function isolateDialog(config) {
    config.inertChanges = new Map();
    const rememberAndSet = (element, value) => {
      if (!(element instanceof HTMLElement)) return;
      if (!config.inertChanges.has(element)) config.inertChanges.set(element, element.inert);
      element.inert = value;
    };

    let current = config.rootElement;
    while (current && current !== document.body) {
      rememberAndSet(current, false);
      const parent = current.parentElement;
      if (!parent) break;
      if (config.mobileDrillIn && current.classList.contains('app-content')) break;
      Array.from(parent.children).forEach(sibling => {
        if (sibling !== current) rememberAndSet(sibling, true);
      });
      current = parent;
    }
  }

  function restoreDialogIsolation(config) {
    Array.from(config.inertChanges?.entries() || []).reverse().forEach(([element, previous]) => {
      element.inert = previous;
    });
    config.inertChanges = null;
  }

  function syncDialog(config) {
    const open = isDialogOpen(config);
    const mobileDrillIn = config.root === '#detail-overlay'
      && document.body.classList.contains('mobile-mode')
      && config.rootElement.classList.contains('mobile-fullscreen-detail');
    config.rootElement.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (config.root === '#detail-overlay') {
      config.rootElement.setAttribute('aria-modal', mobileDrillIn ? 'false' : 'true');
    }
    const modeChangedWhileOpen = open && config.wasOpen && mobileDrillIn !== config.mobileDrillIn;
    if (open === config.wasOpen && !modeChangedWhileOpen) return;
    if (modeChangedWhileOpen) restoreDialogIsolation(config);
    config.wasOpen = open;
    config.mobileDrillIn = mobileDrillIn;

    if (open) {
      if (!modeChangedWhileOpen) {
        config.opener = lastExternalFocus?.isConnected ? lastExternalFocus : null;
      }
      isolateDialog(config);
      if (modeChangedWhileOpen) return;
      requestAnimationFrame(() => {
        const initial = config.initial ? config.rootElement.querySelector(config.initial) : null;
        (initial || config.contentElement)?.focus({ preventScroll: true });
      });
      return;
    }

    restoreDialogIsolation(config);
    const anotherDialogIsOpen = dialogConfigs.some(item => item !== config && isDialogOpen(item));
    if (!anotherDialogIsOpen) {
      const opener = config.opener;
      requestAnimationFrame(() => {
        focusRestorationTarget(opener)?.focus({ preventScroll: true });
      });
    }
    config.opener = null;
  }

  function closeDialog(config) {
    const closeControl = config.close ? config.rootElement.querySelector(config.close) : null;
    if (closeControl) closeControl.click();
    else config.rootElement.click();
  }

  function initDialogs() {
    lastExternalFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const registerDialog = config => {
      if (config.rootElement?.isConnected) return;
      config.rootElement = document.querySelector(config.root);
      if (!config.rootElement) return;
      config.contentElement = config.rootElement.querySelector(config.content);
      if (config.contentElement && !config.contentElement.hasAttribute('tabindex')) {
        config.contentElement.tabIndex = -1;
      }
      config.wasOpen = false;
      syncDialog(config);
      const observer = new MutationObserver(() => syncDialog(config));
      observer.observe(config.rootElement, { attributes: true, attributeFilter: ['class'] });
      config.observer = observer;
    };
    dialogConfigs.forEach(registerDialog);

    const dynamicDialogObserver = new MutationObserver(() => dialogConfigs.forEach(registerDialog));
    dynamicDialogObserver.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('focusin', event => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      const focusIsInsideOpenDialog = dialogConfigs.some(config =>
        isDialogOpen(config) && config.rootElement.contains(target)
      );
      if (!focusIsInsideOpenDialog) lastExternalFocus = target;
    }, true);

    const viewNotesClose = document.getElementById('view-notes-close');
    viewNotesClose?.addEventListener('click', () => {
      const overlay = document.getElementById('view-notes-overlay');
      overlay?.classList.add('hidden');
      if (overlay) overlay.onclick = null;
    });

    document.addEventListener('keydown', event => {
      const activeConfig = dialogConfigs.filter(isDialogOpen).at(-1);
      if (!activeConfig) return;

      if (event.key === 'Escape') {
        const inlineNotesOwnsEscape = activeConfig.root === '#detail-overlay'
          && event.target instanceof HTMLElement
          && Boolean(event.target.closest('#detail-notes-wrapper.is-editing-notes'));
        if (inlineNotesOwnsEscape) return;
        event.preventDefault();
        event.stopPropagation();
        closeDialog(activeConfig);
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = activeConfig.mobileDrillIn
        ? [
            ...focusableElements(document.getElementById('mobile-command-surface')),
            ...focusableElements(activeConfig.contentElement)
          ]
        : focusableElements(activeConfig.contentElement);
      if (!focusable.length) {
        event.preventDefault();
        activeConfig.contentElement?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }, true);
  }

  patchCardFactories();
  document.addEventListener('DOMContentLoaded', () => {
    patchCardFactories();
    ensureLiveRegion();
    initDialogs();
  });
})();
