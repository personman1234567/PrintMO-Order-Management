(() => {
  const desktopQuery = window.matchMedia('(min-width: 901px)');
  const cardSelector = '.card[data-order-id], .bundle-card[data-bundle-name]';
  const dropZoneSelector = '#col-received, #col-toOrder, #picked-cards, #col-blanks, #col-print';
  const boardSelector = '#col-received, #picked-cards, #col-blanks, #col-print';
  const recentDropKeys = new Set();
  let layoutBeforeDrop = new Map();
  let activeDragCard = null;
  let lastDragX = 0;
  let lastDropZone = null;
  let mutationFrame = 0;

  const isDesktop = () => desktopQuery.matches;

  function cardKey(card) {
    if (!card) return '';
    if (card.dataset.orderId) return `order:${card.dataset.orderId}`;
    if (card.dataset.bundleName) return `bundle:${card.dataset.bundleName}`;
    return '';
  }

  function allBoardCards() {
    return Array.from(document.querySelectorAll(cardSelector));
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

  function setDropZone(zone) {
    if (zone === lastDropZone) return;
    if (lastDropZone) lastDropZone.classList.remove('desktop-drop-over');
    lastDropZone = zone;
    if (lastDropZone) lastDropZone.classList.add('desktop-drop-over');
  }

  function resetDragState() {
    if (activeDragCard) {
      activeDragCard.classList.remove('drag-polish-dragging');
      activeDragCard.style.removeProperty('--drag-tilt');
    }
    activeDragCard = null;
    lastDragX = 0;
    setDropZone(null);
    document.body.classList.remove('desktop-drag-active');
  }

  document.addEventListener('dragstart', event => {
    if (!isDesktop()) return;
    const card = event.target.closest(cardSelector);
    if (!card) return;
    activeDragCard = card;
    lastDragX = event.clientX || 0;
    layoutBeforeDrop = captureLayout();
    document.body.classList.add('desktop-drag-active');
    card.classList.add('drag-polish-dragging');
    card.style.setProperty('--drag-tilt', '0deg');
  }, true);

  document.addEventListener('drag', event => {
    if (!isDesktop() || !activeDragCard || !event.clientX) return;
    const dx = event.clientX - lastDragX;
    lastDragX = event.clientX;
    const tilt = Math.max(-3, Math.min(3, dx * 0.18));
    activeDragCard.style.setProperty('--drag-tilt', `${tilt.toFixed(2)}deg`);
  }, true);

  document.addEventListener('dragover', event => {
    if (!isDesktop() || !activeDragCard) return;
    setDropZone(event.target.closest(dropZoneSelector));
  }, true);

  document.addEventListener('drop', event => {
    if (!isDesktop()) return;
    layoutBeforeDrop = captureLayout();
    markDroppedKeys(parseDragKeys(event));
    setDropZone(null);
  }, true);

  document.addEventListener('dragend', () => {
    if (!isDesktop()) return;
    resetDragState();
  }, true);

  document.addEventListener('dragleave', event => {
    if (!isDesktop() || event.relatedTarget) return;
    setDropZone(null);
  }, true);

  const observer = new MutationObserver(mutations => {
    if (!isDesktop()) return;
    if (mutations.some(mutation => mutation.target.closest?.(boardSelector) || mutation.target.matches?.(boardSelector))) {
      schedulePostRenderAnimation();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
