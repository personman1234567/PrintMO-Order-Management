(() => {
  const desktopQuery = window.matchMedia('(min-width: 901px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const layoutAnimations = new WeakMap();
  const dropHandoffs = new Set();
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
    (orders || []).forEach((order, position) => {
      if (!order?.name) return;
      const sortTime = parseSortTime(order.receivedAt);
      next.set(`order:${order.name}`, {
        group: 1,
        sortTime,
        position,
        status: order.status || '',
        bundle: order.bundle || ''
      });

      if (order.bundle) {
        const bundleKey = String(order.bundle);
      const current = bundleTimes.get(bundleKey);
      bundleTimes.set(bundleKey, { sortTime: Math.min(current?.sortTime ?? Infinity, sortTime), position: current?.position ?? position });
      }
    });

    bundleTimes.forEach(({ sortTime, position }, name) => {
      next.set(`bundle:${name}`, {
        group: 0,
        sortTime,
        position,
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

  function captureLayout(containers = null) {
    const positions = new Map();
    const cards = containers ? [...new Set(containers.filter(Boolean).flatMap(childCards))] : allBoardCards();
    cards.forEach(card => {
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
    if (reducedMotion.matches) return;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const animation = card.animate([
      { transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }
    ], { duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    layoutAnimations.set(card, animation);
    const forgetAnimation = () => {
      if (layoutAnimations.get(card) === animation) layoutAnimations.delete(card);
    };
    animation.oncancel = forgetAnimation;
    animation.onfinish = () => {
      forgetAnimation();
      // Release the transform effect so the resting card is rasterized normally.
      animation.cancel();
    };
  }

  function animateSnapshot(snapshot) {
    if (reducedMotion.matches) return;
    const cards = allBoardCards().filter(card => snapshot.has(cardKey(card)));
    // Finish reads for the whole batch before starting any animations.
    cards.forEach(card => layoutAnimations.get(card)?.cancel());
    const targets = cards.map(card => ({ card, rect: card.getBoundingClientRect() }));
    targets.forEach(({ card, rect }) => animateLayoutShift(card, snapshot.get(cardKey(card)), rect));
  }

  function animateFromSnapshot(snapshot) {
    if (!isDesktop() || !snapshot?.size) return;
    if (layoutAnimationFrame) cancelAnimationFrame(layoutAnimationFrame);
    layoutAnimationFrame = requestAnimationFrame(() => {
      layoutAnimationFrame = 0;
      animateSnapshot(snapshot);
    });
  }

  function animateAfterRender() {
    if (!isDesktop()) return;
    // Hover/status mutations are not a completed drop. The explicit handoff
    // event owns its one layout animation after the real card has been painted.
    if (activeDragCard || dropHandoffs.size) return;
    const previous = layoutBeforeDrop;
    if (!previous.size && !recentDropKeys.size) return;

    animateSnapshot(previous);
    recentDropKeys.clear();
    layoutBeforeDrop = new Map();
  }

  function schedulePostRenderAnimation() {
    if (!isDesktop()) return;
    if (mutationFrame) cancelAnimationFrame(mutationFrame);
    mutationFrame = requestAnimationFrame(() => {
      mutationFrame = 0;
      animateAfterRender();
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
    return { key, group, sortTime, position: meta?.position ?? index,
      score: Number(card.dataset.dashboardAttentionScore || 0),
      received: Number(card.dataset.dashboardReceivedTime || 0),
      value: Number(card.dataset.dashboardValue || 0) };
  }

  function sortMetaForActiveCard() {
    if (!activeDragCard) return null;
    const key = cardKey(activeDragCard);
    if (!key) return null;
    return sortMetaForCard(activeDragCard, Number.POSITIVE_INFINITY);
  }

  function placeholderOrder(left, right, container) {
    const base = left.group - right.group
      || (left.group === 0 ? left.sortTime - right.sortTime : 0)
      || left.position - right.position;
    if (container.id === 'col-received' && document.body.dataset.orderSource === 'shopify') {
      const sort = document.getElementById('dashboard-sort-select')?.value;
      if (sort === 'oldest') return left.received - right.received || base;
      if (sort === 'newest') return right.received - left.received || base;
      if (sort === 'value') return right.value - left.value || left.received - right.received || base;
      return right.score - left.score || left.received - right.received || base;
    }
    // Shared columns render bundles first, then individual orders in snapshot
    // order. The preview must use that same order, including equal timestamps.
    return base;
  }

  function findPlaceholderAnchor(container) {
    const activeMeta = sortMetaForActiveCard();
    if (!activeMeta) return null;

    const cards = childCards(container).filter(card => card !== activeDragCard);
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const candidate = sortMetaForCard(card, index);
      if (!candidate.key || candidate.key === activeMeta.key) continue;
      if (placeholderOrder(activeMeta, candidate, container) < 0) return card;
    }

    return null;
  }

  function removeHoverPlaceholder({ animate = true, deferRemove = false } = {}) {
    if (!hoverPlaceholder) return;
    const snapshot = animate ? captureLayout([placeholderZone]) : null;
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

    const snapshot = captureLayout([container, placeholderZone]);
    if (!hoverPlaceholder) {
      hoverPlaceholder = createHoverPlaceholder(kind);
      requestAnimationFrame(() => hoverPlaceholder?.classList.add('desktop-drop-placeholder-active'));
    } else {
      updatePlaceholderKind(hoverPlaceholder, kind);
    }
    placeholderZone = container;
    placeholderAnchor = anchor;
    const exemplar = childCards(container).find(card => card !== activeDragCard
      && card.classList.contains('bundle-card') === activeDragCard.classList.contains('bundle-card'));
    const height = kind === 'picked' ? Math.min(124, container.clientWidth)
      : (exemplar || activeDragCard).getBoundingClientRect().height;
    hoverPlaceholder.style.height = `${height}px`;
    hoverPlaceholder.style.minHeight = `${height}px`;
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
    ghost.classList.remove('dragging', 'drag-polish-dragging');
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
      ? [dragGhost, ...document.querySelectorAll('.desktop-drag-ghost:not(.drag-handoff-ghost)')]
      : Array.from(document.querySelectorAll('.desktop-drag-ghost:not(.drag-handoff-ghost)'));
    dragGhost = null;
    Array.from(new Set(ghosts)).forEach(ghost => {
      if (returnToOrigin && activeDragCard?.isConnected && !reducedMotion.matches) {
        const rect = activeDragCard.getBoundingClientRect();
        ghost.classList.add('desktop-drag-ghost-release');
        ghost.style.transition = 'transform 230ms cubic-bezier(0.2, 0.8, 0.25, 1), opacity 230ms ease';
        requestAnimationFrame(() => {
          ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1)`;
          ghost.style.opacity = '0';
        });
        window.setTimeout(() => ghost.remove(), 260);
      } else if (activeDropAccepted || reducedMotion.matches) {
        ghost.remove();
      } else {
        ghost.classList.add('desktop-drag-ghost-release');
        window.setTimeout(() => ghost.remove(), 140);
      }
    });
  }

  function beginDropHandoff(card, zone) {
    if (document.body.dataset.orderSource !== 'shopify' || !dragGhost
      || card.classList.contains('drag-handoff-source')) return false;
    if (ghostFrame) cancelAnimationFrame(ghostFrame);
    ghostFrame = 0;
    updateDragGhost(0);
    const names = card.dataset.orderId ? [card.dataset.orderId]
      : [...orderMetaByKey].filter(([key, value]) => key.startsWith('order:')
        && value.bundle === card.dataset.bundleName && value.status === card.dataset.bundleStatus)
        .map(([key]) => key.slice(6));
    const handoff = {
      key: cardKey(card), names: new Set(names), source: card,
      ghost: dragGhost, placeholder: hoverPlaceholder,
      containers: [card.parentElement, placeholderContainerForZone(zone)],
      snapshot: captureLayout([card.parentElement, placeholderContainerForZone(zone)])
    };
    card.classList.add('drag-handoff-source');
    dragGhost.classList.add('drag-handoff-ghost');
    dropHandoffs.add(handoff);
    // If the batch check outlasts the hover animation, use its settled geometry
    // rather than replaying a partially completed hover shift at handoff.
    Promise.all(allBoardCards().map(node => layoutAnimations.get(node)?.finished?.catch(() => {}))).then(() => {
      if (dropHandoffs.has(handoff)) handoff.snapshot = captureLayout(handoff.containers);
    });
    dragGhost = null;
    hoverPlaceholder = null;
    placeholderZone = null;
    placeholderAnchor = null;
    layoutBeforeDrop = new Map();
    recentDropKeys.clear();
    return true;
  }

  function finishDropHandoffs(names, payload = '') {
    for (const handoff of [...dropHandoffs]) {
      const key = payload.startsWith('bundle:') ? payload : `order:${payload}`;
      if (!names.some(name => handoff.names.has(name)) && (!payload || key !== handoff.key)) continue;
      // Remove the temporary slot and reveal the actual card in the same turn.
      // Start FLIP synchronously so there is no painted frame at its old slot.
      handoff.snapshot.set(handoff.key, handoff.ghost.getBoundingClientRect());
      handoff.placeholder?.remove();
      handoff.source.classList.remove('drag-handoff-source');
      handoff.ghost.remove();
      dropHandoffs.delete(handoff);
      animateSnapshot(handoff.snapshot);
    }
    document.dispatchEvent(new CustomEvent('printmo:drag-settled'));
  }

  document.addEventListener('printmo:order-move-painted', event => finishDropHandoffs(event.detail?.orderNames || []));
  document.addEventListener('printmo:drop-finished', event => finishDropHandoffs(event.detail?.orderNames || [], event.detail?.dragId));

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
    document.dispatchEvent(new CustomEvent('printmo:drag-settled'));
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
    refreshOrderMetadata({ force: true });
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
      if (!beginDropHandoff(sourceCard, zone)) {
        layoutBeforeDrop = captureLayout();
        if (dragGhost) layoutBeforeDrop.set(cardKey(sourceCard), dragGhost.getBoundingClientRect());
        markDroppedKeys([cardKey(sourceCard)]);
        removeHoverPlaceholder({ animate: false, deferRemove: true });
      }
      if (!dispatchPointerDrop(zone, sourceCard, event)) {
        finishDropHandoffs([], dragPayloadForCard(sourceCard));
        finishDragSoon();
      }
    } else {
      layoutBeforeDrop = new Map();
      removeHoverPlaceholder({ animate: false });
      finishDragSoon();
    }

    clearPointerDrag();
    // The synthetic click caused by this release is suppressed in this turn;
    // a later intentional click must never inherit the drag's suppression flag.
    window.setTimeout(() => { suppressNextClick = false; }, 0);
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
    refreshOrderMetadata({ force: true });
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
      if (!activeDragCard.classList.contains('drag-handoff-source') && !beginDropHandoff(activeDragCard, zone)) {
        layoutBeforeDrop = captureLayout();
        if (dragGhost) layoutBeforeDrop.set(cardKey(activeDragCard), dragGhost.getBoundingClientRect());
        markDroppedKeys(parseDragKeys(event));
        removeHoverPlaceholder({ animate: false, deferRemove: true });
      }
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
