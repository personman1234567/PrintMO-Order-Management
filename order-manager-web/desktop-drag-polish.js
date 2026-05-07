(() => {
  const desktopQuery = window.matchMedia('(min-width: 901px)');
  const cardSelector = '.card[data-order-id], .bundle-card[data-bundle-name]';
  const dropZoneSelector = '#col-received, #col-toOrder, #col-blanks, #col-print';
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
  let orderMetaByKey = new Map();
  let orderMetaPromise = null;
  let orderMetaLastRefresh = 0;

  const isDesktop = () => desktopQuery.matches;

  function cardKey(card) {
    if (!card) return '';
    if (card.dataset.orderId) return `order:${card.dataset.orderId}`;
    if (card.dataset.bundleName) return `bundle:${card.dataset.bundleName}`;
    return '';
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
      return orderMetaPromise || Promise.resolve(orderMetaByKey);
    }
    if (orderMetaPromise) return orderMetaPromise;
    if (!window.api || typeof window.api.getQueue !== 'function') {
      return Promise.resolve(orderMetaByKey);
    }

    orderMetaPromise = window.api.getQueue()
      .then(orders => {
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
        if (activeDragCard && lastDropZone) {
          setDropZone(lastDropZone, { forcePlaceholder: true });
        }
        return orderMetaByKey;
      })
      .catch(error => {
        console.warn('Unable to refresh drag sort metadata', error);
        return orderMetaByKey;
      })
      .finally(() => {
        orderMetaPromise = null;
      });

    return orderMetaPromise;
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
    dragGhost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.045) rotate(${tilt.toFixed(2)}deg)`;
  }

  function scheduleGhostMove(tilt) {
    if (ghostFrame) cancelAnimationFrame(ghostFrame);
    ghostFrame = requestAnimationFrame(() => {
      ghostFrame = 0;
      updateDragGhost(tilt);
    });
  }

  function removeDragGhost() {
    if (ghostFrame) cancelAnimationFrame(ghostFrame);
    ghostFrame = 0;
    const ghosts = dragGhost
      ? [dragGhost, ...document.querySelectorAll('.desktop-drag-ghost')]
      : Array.from(document.querySelectorAll('.desktop-drag-ghost'));
    dragGhost = null;
    Array.from(new Set(ghosts)).forEach(ghost => {
      ghost.classList.add('desktop-drag-ghost-release');
      window.setTimeout(() => ghost.remove(), 140);
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
    removeDragGhost();
    removeHoverPlaceholder({ animate: false });
    activeDragCard = null;
    lastDragX = 0;
    lastDragY = 0;
    currentDragX = 0;
    currentDragY = 0;
    ghostOffsetX = 0;
    ghostOffsetY = 0;
    lastTilt = 0;
    setDropZone(null);
    document.body.classList.remove('desktop-drag-active');
  }

  function finishDragSoon() {
    requestAnimationFrame(resetDragState);
  }

  document.addEventListener('dragstart', event => {
    if (!isDesktop()) return;
    const card = closestFrom(event.target, cardSelector);
    if (!card) return;
    disableImageDragging(card);
    activeDragCard = card;
    lastDragX = event.clientX || 0;
    layoutBeforeDrop = captureLayout();
    refreshOrderMetadata();
    document.body.classList.add('desktop-drag-active');
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
