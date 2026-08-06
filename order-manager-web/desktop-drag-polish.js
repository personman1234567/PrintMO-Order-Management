(() => {
  const desktopQuery = window.matchMedia('(min-width: 901px)');
  const cardSelector = '.card[data-order-id], .bundle-card[data-bundle-name]';
  const dropZoneSelector = '#col-received, #col-toOrder, #col-blanks, #col-print, #blanks-view-cart, #blanks-view-ordered, #supplies-view-cart, #supplies-view-ordered';
  const boardSelector = '#col-received, #picked-cards, #col-blanks, #col-print';
  const recentDropKeys = new Set();
  const metadataRefreshMs = 12000;
  let layoutBeforeDrop = new Map();
  let activeDragCard = null;
  let dragGhost = null;
  let lastDragX = 0;
  let lastDragY = 0;
  let currentDragX = 0;
  let currentDragY = 0;
  let ghostOffsetX = 0;
  let ghostOffsetY = 0;
  let lastDropZone = null;
  let mutationFrame = 0;
  let ghostFrame = 0;
  let lastTilt = 0;
  let transparentDragNode = null;
  let hoverPlaceholder = null;
  let placeholderZone = null;
  let placeholderAnchor = null;
  let pendingDropZone = null;
  let dropZoneFrame = 0;
  let layoutAnimationFrame = 0;
  let activeDropAccepted = false;
  let orderMetaByKey = new Map();
  let orderMetaLastRefresh = 0;
  let pointerDrag = null;
  let suppressNextClick = false;

  const isDesktop = () => desktopQuery.matches;
  const isEmbeddedFrame = () => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  };

  function cardKey(card) {
    if (!card) return '';
    if (card.dataset.orderId) return `order:${card.dataset.orderId}`;
    if (card.dataset.bundleName) return `bundle:${card.dataset.bundleName}`;
    return '';
  }

  function customPointerDragEnabled() {
    return isDesktop() && isEmbeddedFrame() && 'PointerEvent' in window;
  }

  function isInteractiveDragTarget(target) {
    return Boolean(target instanceof Element && target.closest(
      'button, input, select, textarea, a, [role="button"], .delete-btn, .manual-mockup-delete'
    ));
  }

  function closestFrom(target, selector) {
    return target instanceof Element ? target.closest(selector) : null;
  }

  function allBoardCards() {
    return Array.from(document.querySelectorAll(cardSelector))
      .filter(card => !card.classList.contains('desktop-drag-ghost'));
  }

  function childCards(container) {
    if (!container) return [];
    return Array.from(container.children)
      .filter(child => child.matches?.(cardSelector) && !child.classList.contains('desktop-drag-ghost'));
  }

  function parseSortTime(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  }

  function refreshOrderMetadata({ force = false } = {}) {
    const now = Date.now();
    if (!force && orderMetaByKey.size && now - orderMetaLastRefresh < metadataRefreshMs) {
      return Promise.resolve(orderMetaByKey);
    }
    if (typeof window.getOrderManagerBoardSnapshot !== 'function') {
      return Promise.resolve(orderMetaByKey);
    }

    const orders = window.getOrderManagerBoardSnapshot();
    const next = new Map();
    const bundleTimes = new Map();
    (orders || []).forEach(order => {
      if (!order?.name) return;
      const sortTime = parseSortTime(order.receivedAt);
      next.set(`order:${order.name}`, {
        group: 1,
        sortTime,
        status: order.status || '',
        bundle: order.bundle || ''
      });

      if (order.bundle) {
        const bundleKey = String(order.bundle);
        const current = bundleTimes.get(bundleKey) ?? Number.POSITIVE_INFINITY;
        bundleTimes.set(bundleKey, Math.min(current, sortTime));
      }
    });

    bundleTimes.forEach((sortTime, name) => {
      next.set(`bundle:${name}`, {
        group: 0,
        sortTime,
        status: '',
        bundle: name
      });
    });

    orderMetaByKey = next;
    orderMetaLastRefresh = Date.now();
    window.orderManagerPerformanceDebug?.log?.('drag-metadata-refreshed', {
      orders: orders.length,
      bundles: bundleTimes.size
    });
    if (activeDragCard && lastDropZone) {
      setDropZone(lastDropZone, { forcePlaceholder: true });
    }
    return Promise.resolve(orderMetaByKey);
  }

  function captureLayout() {
    const positions = new Map();
    allBoardCards().forEach(card => {
      const key = cardKey(card);
      if (key) positions.set(key, card.getBoundingClientRect());
    });
    return positions;
  }

  function parseDragKeys(event) {
    const id = event?.dataTransfer?.getData('text/plain') || '';
    if (!id) return [];
    if (id.startsWith('bundle:')) return [`bundle:${id.slice(7)}`];
    return [`order:${id}`];
  }

  function dragPayloadForCard(card) {
    if (!card) return '';
    if (card.dataset.bundleName) return `bundle:${card.dataset.bundleName}`;
    return card.dataset.orderId || '';
  }

  function dropZoneFromPoint(x, y) {
    return closestFrom(document.elementFromPoint(x, y), dropZoneSelector);
  }

  function markDroppedKeys(keys) {
    keys.forEach(key => recentDropKeys.add(key));
    window.setTimeout(() => {
      keys.forEach(key => recentDropKeys.delete(key));
    }, 900);
  }

  function animateLayoutShift(card, from, to) {
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    card.classList.add('layout-shifting');
    card.style.transition = 'none';
    card.style.transform = `translate(${dx}px, ${dy}px)`;
    card.getBoundingClientRect();
    requestAnimationFrame(() => {
      card.style.transition = '';
      card.style.transform = '';
      window.setTimeout(() => {
        card.classList.remove('layout-shifting');
      }, 360);
    });
  }

  function animateFromSnapshot(snapshot) {
    if (!isDesktop() || !snapshot?.size) return;
    if (layoutAnimationFrame) cancelAnimationFrame(layoutAnimationFrame);
    layoutAnimationFrame = requestAnimationFrame(() => {
      layoutAnimationFrame = requestAnimationFrame(() => {
        layoutAnimationFrame = 0;
        allBoardCards().forEach(card => {
          const key = cardKey(card);
          const before = snapshot.get(key);
          if (before) animateLayoutShift(card, before, card.getBoundingClientRect());
        });
      });
    });
  }

  function animateNewDrop(card) {
    card.classList.add('drop-entering');
    requestAnimationFrame(() => {
      card.classList.add('drop-entering-active');
      window.setTimeout(() => {
        card.classList.remove('drop-entering', 'drop-entering-active');
      }, 380);
    });
  }

  function animateAfterRender() {
    if (!isDesktop()) return;
    const previous = layoutBeforeDrop;
    const cards = allBoardCards();
    if (!previous.size && !recentDropKeys.size) return;

    cards.forEach(card => {
      const key = cardKey(card);
      if (!key) return;
      const current = card.getBoundingClientRect();
      const before = previous.get(key);
      if (before) animateLayoutShift(card, before, current);
      if (recentDropKeys.has(key)) animateNewDrop(card);
    });

    layoutBeforeDrop = new Map();
  }

  function schedulePostRenderAnimation() {
    if (!isDesktop()) return;
    if (mutationFrame) cancelAnimationFrame(mutationFrame);
    mutationFrame = requestAnimationFrame(() => {
      mutationFrame = requestAnimationFrame(() => {
        mutationFrame = 0;
        animateAfterRender();
      });
    });
  }

  function setDropZone(zone, { forcePlaceholder = false } = {}) {
    if (zone !== lastDropZone) {
      if (lastDropZone) lastDropZone.classList.remove('desktop-drop-over');
      lastDropZone = zone;
      if (lastDropZone) lastDropZone.classList.add('desktop-drop-over');
      setHoverPlaceholder(zone);
      return;
    }

    if (forcePlaceholder) setHoverPlaceholder(zone);
  }

  function queueDropZone(zone) {
    pendingDropZone = zone;
    if (dropZoneFrame) return;
    dropZoneFrame = requestAnimationFrame(() => {
      dropZoneFrame = 0;
      setDropZone(pendingDropZone);
    });
  }

  function placeholderKindForZone(zone) {
    if (!zone) return '';
    if (zone.id === 'col-received') return 'pipeline';
    if (zone.id === 'col-toOrder') return 'picked';
    if (zone.id === 'col-blanks' || zone.id === 'col-print') return 'production';
    return '';
  }

  function placeholderContainerForZone(zone) {
    if (!zone) return null;
    if (zone.id === 'col-toOrder') return document.getElementById('picked-cards');
    return zone;
  }

  function createHoverPlaceholder(kind) {
    const placeholder = document.createElement('div');
    placeholder.className = `desktop-drop-placeholder ${kind ? `desktop-drop-placeholder-${kind}` : ''}`;
    placeholder.setAttribute('aria-hidden', 'true');
    return placeholder;
  }

  function updatePlaceholderKind(placeholder, kind) {
    placeholder.className = `desktop-drop-placeholder ${kind ? `desktop-drop-placeholder-${kind}` : ''}`;
  }

  function sortMetaForCard(card, index = 0) {
    const key = cardKey(card);
    const meta = orderMetaByKey.get(key);
    const isBundle = key.startsWith('bundle:');
    const group = isBundle ? 0 : 1;
    const sortTime = Number.isFinite(meta?.sortTime) ? meta.sortTime : index;
    return { key, group, sortTime };
  }

  function sortMetaForActiveCard() {
    if (!activeDragCard) return null;
    const key = cardKey(activeDragCard);
    if (!key) return null;
    const meta = orderMetaByKey.get(key);
    const isBundle = key.startsWith('bundle:');
    return {
      key,
      group: isBundle ? 0 : 1,
      sortTime: Number.isFinite(meta?.sortTime) ? meta.sortTime : Number.POSITIVE_INFINITY
    };
  }

  function findPlaceholderAnchor(container) {
    const activeMeta = sortMetaForActiveCard();
    if (!activeMeta) return null;

    const cards = childCards(container).filter(card => card !== activeDragCard);
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const candidate = sortMetaForCard(card, index);
      if (!candidate.key || candidate.key === activeMeta.key) continue;
      if (candidate.group > activeMeta.group) return card;
      if (candidate.group === activeMeta.group && candidate.sortTime > activeMeta.sortTime) {
        return card;
      }
    }

    return null;
  }

  function removeHoverPlaceholder({ animate = true, deferRemove = false } = {}) {
    if (!hoverPlaceholder) return;
    const snapshot = animate ? captureLayout() : null;
    const placeholder = hoverPlaceholder;
    hoverPlaceholder = null;
    placeholderZone = null;
    placeholderAnchor = null;
    placeholder.classList.add('desktop-drop-placeholder-leaving');
    if (deferRemove) {
      window.setTimeout(() => placeholder.remove(), 0);
      return;
    }
    placeholder.remove();
    if (animate) animateFromSnapshot(snapshot);
  }

  function setHoverPlaceholder(zone) {
    const container = placeholderContainerForZone(zone);
    const kind = placeholderKindForZone(zone);
    if (!container || !kind || !activeDragCard || activeDragCard.parentElement === container) {
      removeHoverPlaceholder();
      return;
    }

    const anchor = findPlaceholderAnchor(container);
    if (placeholderZone === container && placeholderAnchor === anchor && hoverPlaceholder?.isConnected) {
      updatePlaceholderKind(hoverPlaceholder, kind);
      return;
    }

    const snapshot = captureLayout();
    if (!hoverPlaceholder) {
      hoverPlaceholder = createHoverPlaceholder(kind);
      requestAnimationFrame(() => hoverPlaceholder?.classList.add('desktop-drop-placeholder-active'));
    } else {
      updatePlaceholderKind(hoverPlaceholder, kind);
    }
    placeholderZone = container;
    placeholderAnchor = anchor;
    container.insertBefore(hoverPlaceholder, anchor);
    animateFromSnapshot(snapshot);
  }

  function transparentDragImage(event) {
    if (!event.dataTransfer) return;
    if (!transparentDragNode) {
      transparentDragNode = document.createElement('div');
      transparentDragNode.className = 'desktop-transparent-drag-image';
      document.body.appendChild(transparentDragNode);
    }
    event.dataTransfer.setDragImage(transparentDragNode, 0, 0);
  }

  function disableImageDragging(root) {
    root.querySelectorAll('img').forEach(img => {
      img.draggable = false;
      img.setAttribute('draggable', 'false');
    });
  }

  function simplifyDragGhostForEmbeddedFrame(ghost) {
    ghost.classList.add('desktop-drag-ghost-performance');
    ghost.querySelectorAll('button, input, select, textarea, video, iframe, canvas').forEach(node => {
      node.remove();
    });
    ghost.querySelectorAll('[aria-live], [role="tooltip"]').forEach(node => {
      node.removeAttribute('aria-live');
      node.removeAttribute('role');
    });
  }

  function createDragGhost(card, event) {
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.removeAttribute('data-order-id');
    ghost.removeAttribute('data-bundle-name');
    ghost.draggable = false;
    ghost.setAttribute('aria-hidden', 'true');
    disableImageDragging(ghost);
    ghost.classList.remove('dragging', 'drag-polish-dragging', 'layout-shifting', 'drop-entering', 'drop-entering-active');
    ghost.classList.add('desktop-drag-ghost');
    if (isEmbeddedFrame()) simplifyDragGhostForEmbeddedFrame(ghost);
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);

    ghostOffsetX = (event.clientX || rect.left + rect.width / 2) - rect.left;
    ghostOffsetY = (event.clientY || rect.top + rect.height / 2) - rect.top;
    currentDragX = event.clientX || rect.left + ghostOffsetX;
    currentDragY = event.clientY || rect.top + ghostOffsetY;
    lastDragX = currentDragX;
    lastDragY = currentDragY;
    dragGhost = ghost;
    updateDragGhost(0);
  }

  function updateDragGhost(tilt = 0) {
    if (!dragGhost) return;
    lastTilt = tilt;
    const x = currentDragX - ghostOffsetX;
    const y = currentDragY - ghostOffsetY;
    if (dragGhost.classList.contains('desktop-drag-ghost-performance')) {
      dragGhost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.025)`;
      return;
    }
    dragGhost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.045) rotate(${tilt.toFixed(2)}deg)`;
  }

  function scheduleGhostMove(tilt) {
    lastTilt = tilt;
    if (ghostFrame) return;
    ghostFrame = requestAnimationFrame(() => {
      ghostFrame = 0;
      updateDragGhost(lastTilt);
    });
  }

  function removeDragGhost({ returnToOrigin = false } = {}) {
    if (ghostFrame) cancelAnimationFrame(ghostFrame);
    ghostFrame = 0;
    const ghosts = dragGhost
      ? [dragGhost, ...document.querySelectorAll('.desktop-drag-ghost')]
      : Array.from(document.querySelectorAll('.desktop-drag-ghost'));
    dragGhost = null;
    Array.from(new Set(ghosts)).forEach(ghost => {
      if (returnToOrigin && activeDragCard?.isConnected) {
        const rect = activeDragCard.getBoundingClientRect();
        ghost.classList.add('desktop-drag-ghost-release');
        ghost.style.transition = 'transform 230ms cubic-bezier(0.2, 0.8, 0.25, 1), opacity 230ms ease';
        requestAnimationFrame(() => {
          ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1)`;
          ghost.style.opacity = '0';
        });
        window.setTimeout(() => ghost.remove(), 260);
      } else {
        ghost.classList.add('desktop-drag-ghost-release');
        window.setTimeout(() => ghost.remove(), 140);
      }
    });
  }

  function resetDragState() {
    if (dropZoneFrame) cancelAnimationFrame(dropZoneFrame);
    if (layoutAnimationFrame) cancelAnimationFrame(layoutAnimationFrame);
    dropZoneFrame = 0;
    layoutAnimationFrame = 0;
    pendingDropZone = null;
    if (activeDragCard) {
      activeDragCard.classList.remove('drag-polish-dragging');
      activeDragCard.style.removeProperty('--drag-tilt');
    }
    removeDragGhost({ returnToOrigin: !activeDropAccepted });
    removeHoverPlaceholder({ animate: false });
    activeDragCard = null;
    activeDropAccepted = false;
    lastDragX = 0;
    lastDragY = 0;
    currentDragX = 0;
    currentDragY = 0;
    ghostOffsetX = 0;
    ghostOffsetY = 0;
    lastTilt = 0;
    clearPointerDrag();
    setDropZone(null);
    document.body.classList.remove('desktop-drag-active');
    document.body.classList.remove('desktop-drag-embedded');
    document.body.classList.remove('desktop-pointer-drag-active');
  }

  function finishDragSoon() {
    requestAnimationFrame(resetDragState);
  }

  function beginPointerDrag(event) {
    if (!pointerDrag || pointerDrag.started) return;
    const { card } = pointerDrag;
    activeDragCard = card;
    activeDropAccepted = false;
    lastDragX = event.clientX || 0;
    lastDragY = event.clientY || 0;
    layoutBeforeDrop = captureLayout();
    refreshOrderMetadata();
    document.body.classList.add('desktop-drag-active', 'desktop-drag-embedded', 'desktop-pointer-drag-active');
    card.classList.add('drag-polish-dragging');
    card.style.setProperty('--drag-tilt', '0deg');
    createDragGhost(card, event);
    pointerDrag.started = true;
    suppressNextClick = true;
  }

  function dispatchPointerDrop(zone, sourceCard, event) {
    const payload = dragPayloadForCard(sourceCard);
    if (!zone || !payload) return false;

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.effectAllowed = 'move';
      dataTransfer.dropEffect = 'move';
      dataTransfer.setData('text/plain', payload);
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        dataTransfer
      });
      zone.dispatchEvent(dropEvent);
      return true;
    } catch (error) {
      console.warn('Pointer drag drop could not dispatch through the existing drop handler.', error);
      return false;
    }
  }

  function clearPointerDrag() {
    if (!pointerDrag) return;
    const { card, originalDraggable } = pointerDrag;
    if (card?.isConnected) card.draggable = originalDraggable;
    pointerDrag = null;
  }

  document.addEventListener('pointerdown', event => {
    if (!customPointerDragEnabled() || event.button !== 0 || event.pointerType === 'touch') return;
    if (isInteractiveDragTarget(event.target)) return;
    const card = closestFrom(event.target, cardSelector);
    if (!card) return;

    pointerDrag = {
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      originalDraggable: card.draggable
    };
    card.draggable = false;
  }, true);

  document.addEventListener('pointermove', event => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const dx = event.clientX - pointerDrag.startX;
    const dy = event.clientY - pointerDrag.startY;

    if (!pointerDrag.started) {
      if (Math.hypot(dx, dy) < 6) return;
      beginPointerDrag(event);
      try {
        pointerDrag.card.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; document-level listeners still keep the drag alive.
      }
    }

    if (!pointerDrag.started) return;
    event.preventDefault();
    event.stopPropagation();
    currentDragX = event.clientX;
    currentDragY = event.clientY;
    lastDragX = event.clientX;
    lastDragY = event.clientY;
    scheduleGhostMove(0);
    queueDropZone(dropZoneFromPoint(event.clientX, event.clientY));
  }, true);

  function finishPointerDrag(event, { cancelled = false } = {}) {
    if (!pointerDrag) return;
    const wasStarted = pointerDrag.started;
    const sourceCard = pointerDrag.card;

    if (!wasStarted) {
      clearPointerDrag();
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();

    const zone = cancelled ? null : dropZoneFromPoint(event.clientX, event.clientY);
    if (zone) {
      activeDropAccepted = true;
      layoutBeforeDrop = captureLayout();
      markDroppedKeys([cardKey(sourceCard)]);
      removeHoverPlaceholder({ animate: false, deferRemove: true });
      if (!dispatchPointerDrop(zone, sourceCard, event)) finishDragSoon();
    } else {
      layoutBeforeDrop = new Map();
      removeHoverPlaceholder({ animate: false });
      finishDragSoon();
    }

    clearPointerDrag();
  }

  document.addEventListener('pointerup', event => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    finishPointerDrag(event);
  }, true);

  document.addEventListener('pointercancel', event => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    finishPointerDrag(event, { cancelled: true });
  }, true);

  document.addEventListener('click', event => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('dragstart', event => {
    if (!isDesktop()) return;
    const card = closestFrom(event.target, cardSelector);
    if (!card) return;
    if (customPointerDragEnabled()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    disableImageDragging(card);
    activeDragCard = card;
    activeDropAccepted = false;
    lastDragX = event.clientX || 0;
    layoutBeforeDrop = captureLayout();
    refreshOrderMetadata();
    document.body.classList.add('desktop-drag-active');
    document.body.classList.toggle('desktop-drag-embedded', isEmbeddedFrame());
    card.classList.add('drag-polish-dragging');
    card.style.setProperty('--drag-tilt', '0deg');
    transparentDragImage(event);
    createDragGhost(card, event);
  }, true);

  document.addEventListener('drag', event => {
    if (!isDesktop() || !activeDragCard || !event.clientX) return;
    const dx = event.clientX - lastDragX;
    const dy = event.clientY - lastDragY;
    lastDragX = event.clientX;
    lastDragY = event.clientY;
    currentDragX = event.clientX;
    currentDragY = event.clientY || currentDragY;
    const tilt = Math.max(-3, Math.min(3, dx * 0.18));
    const lift = Math.max(-1.5, Math.min(1.5, dy * -0.05));
    scheduleGhostMove(tilt + lift);
  }, true);

  document.addEventListener('dragover', event => {
    if (!isDesktop() || !activeDragCard) return;
    if (event.clientX) {
      const dx = event.clientX - lastDragX;
      const dy = event.clientY - lastDragY;
      currentDragX = event.clientX;
      currentDragY = event.clientY || currentDragY;
      lastDragX = event.clientX;
      lastDragY = event.clientY || lastDragY;
      const tilt = Math.max(-3, Math.min(3, (dx * 0.22) + (lastTilt * 0.72)));
      const lift = Math.max(-1.5, Math.min(1.5, dy * -0.05));
      scheduleGhostMove(tilt + lift);
    }
    queueDropZone(closestFrom(event.target, dropZoneSelector));
  }, true);

  document.addEventListener('drop', event => {
    if (!isDesktop() || !activeDragCard) return;
    const zone = closestFrom(event.target, dropZoneSelector);
    if (zone) {
      activeDropAccepted = true;
      layoutBeforeDrop = captureLayout();
      markDroppedKeys(parseDragKeys(event));
      removeHoverPlaceholder({ animate: false, deferRemove: true });
    } else {
      layoutBeforeDrop = new Map();
      removeHoverPlaceholder({ animate: false });
    }
    setDropZone(null);
    finishDragSoon();
  }, true);

  document.addEventListener('dragend', () => {
    if (!isDesktop()) return;
    resetDragState();
  }, true);

  document.addEventListener('dragleave', event => {
    if (!isDesktop() || !activeDragCard || event.relatedTarget) return;
    setDropZone(null);
  }, true);

  document.addEventListener('keyup', event => {
    if (event.key === 'Escape') resetDragState();
  });

  window.addEventListener('blur', resetDragState);

  desktopQuery.addEventListener('change', event => {
    if (!event.matches) resetDragState();
  });

  function isPolishNode(node) {
    if (!(node instanceof Element)) return true;
    return node.classList.contains('desktop-drop-placeholder')
      || node.classList.contains('desktop-drag-ghost')
      || node.classList.contains('desktop-transparent-drag-image');
  }

  function isPolishOnlyMutation(mutations) {
    const nodes = mutations.flatMap(mutation => [
      ...Array.from(mutation.addedNodes),
      ...Array.from(mutation.removedNodes)
    ]);
    return nodes.length > 0 && nodes.every(isPolishNode);
  }

  const observer = new MutationObserver(mutations => {
    if (!isDesktop()) return;
    if (isPolishOnlyMutation(mutations)) return;
    if (mutations.some(mutation => mutation.target.closest?.(boardSelector) || mutation.target.matches?.(boardSelector))) {
      schedulePostRenderAnimation();
      refreshOrderMetadata();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    refreshOrderMetadata({ force: true });
  });
})();
