(() => {
  const mobileQuery = window.matchMedia('(max-width: 900px)');
  const BLANKS_TARGETS = new Set(['to-order', 'in-cart', 'ordered', 'batches']);
  let lastBlanksTarget = 'to-order';
  let touchStartX = 0;
  let touchStartY = 0;
  let verticalTouchOwner = null;
  let horizontalTouchOwner = null;

  function isMobile() {
    return mobileQuery.matches;
  }

  function scrollOwnerFor(target, axis) {
    let element = target instanceof Element ? target : null;
    while (element && element !== document.body && element !== document.documentElement) {
      const style = window.getComputedStyle(element);
      const overflow = axis === 'x' ? style.overflowX : style.overflowY;
      const scrollSize = axis === 'x' ? element.scrollWidth : element.scrollHeight;
      const clientSize = axis === 'x' ? element.clientWidth : element.clientHeight;
      if ((overflow === 'auto' || overflow === 'scroll') && scrollSize > clientSize + 1) {
        return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  function normalizeMobileCardInteractions(root = document) {
    if (!isMobile()) return;
    const cards = root instanceof Element && root.matches('.card')
      ? [root]
      : Array.from(root.querySelectorAll?.('.card') || []);
    cards.forEach(card => {
      card.draggable = false;
      card.removeAttribute('draggable');
      card.dataset.mobileTapReady = 'true';
    });
  }

  function touchAxisAtBoundary(owner, delta, axis) {
    if (!owner) return true;
    const position = axis === 'x' ? owner.scrollLeft : owner.scrollTop;
    const scrollSize = axis === 'x' ? owner.scrollWidth : owner.scrollHeight;
    const clientSize = axis === 'x' ? owner.clientWidth : owner.clientHeight;
    const atStart = position <= 0;
    const atEnd = position + clientSize >= scrollSize - 1;
    return (delta > 0 && atStart) || (delta < 0 && atEnd);
  }

  function installEmbeddedTouchContainment() {
    document.addEventListener('touchstart', event => {
      if (!isMobile() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      const detailContent = event.target instanceof Element
        ? event.target.closest('#detail-overlay.mobile-fullscreen-detail')?.querySelector('#detail-content')
        : null;
      verticalTouchOwner = detailContent instanceof Element
        && detailContent.scrollHeight > detailContent.clientHeight + 1
        ? detailContent
        : scrollOwnerFor(event.target, 'y');
      horizontalTouchOwner = scrollOwnerFor(event.target, 'x');
    }, { passive: true, capture: true });

    document.addEventListener('touchmove', event => {
      if (!isMobile() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return;

      const horizontalGesture = Math.abs(deltaX) > Math.abs(deltaY);
      const owner = horizontalGesture ? horizontalTouchOwner : verticalTouchOwner;
      const delta = horizontalGesture ? deltaX : deltaY;
      if (!owner || touchAxisAtBoundary(owner, delta, horizontalGesture ? 'x' : 'y')) {
        event.preventDefault();
      }
    }, { passive: false, capture: true });

    document.addEventListener('touchend', () => {
      verticalTouchOwner = null;
      horizontalTouchOwner = null;
    }, { passive: true, capture: true });

    document.addEventListener('dragstart', event => {
      if (isMobile() && event.target instanceof Element && event.target.closest('.card')) {
        event.preventDefault();
      }
    }, true);
  }

  function setActiveTab(tab, options = { scrollTop: false }) {
    if (typeof window.setActiveMobileTab === 'function') {
      window.setActiveMobileTab(tab, options);
    } else {
      document.body.dataset.activeTab = tab;
      document.body.dataset.activeView = tab === 'storage' ? 'storage' : 'orders';
    }
  }

  function selectedBlanksTarget() {
    const overlay = document.getElementById('blanks-receive-overlay');
    if (overlay && !overlay.classList.contains('hidden')) return 'batches';
    if (document.body.dataset.activeTab === 'blanksCart') return 'to-order';
    if (document.body.dataset.activeTab !== 'blanksOrdered') return lastBlanksTarget;
    return document.getElementById('blanks-view-ordered')?.classList.contains('active')
      ? 'ordered'
      : 'in-cart';
  }

  function currentStage() {
    if (document.body.dataset.activeView === 'storage' || document.body.dataset.activeTab === 'storage') {
      return 'storage';
    }
    const activeTab = document.body.dataset.activeTab || 'pipeline';
    if (activeTab.startsWith('blanks')) return 'blanks';
    if (activeTab === 'readyToPrint') return 'print';
    return 'orders';
  }

  function syncNavigationState() {
    if (!isMobile()) return;
    const stage = currentStage();
    document.querySelectorAll('.mobile-stage-tab').forEach(button => {
      const active = button.dataset.mobileStage === stage;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const blanksSubnav = document.getElementById('mobile-blanks-subnav');
    if (blanksSubnav) blanksSubnav.hidden = stage !== 'blanks';
    if (stage !== 'blanks') return;

    const target = selectedBlanksTarget();
    if (target !== 'batches') lastBlanksTarget = target;
    blanksSubnav?.querySelectorAll('[data-mobile-blanks-target]').forEach(button => {
      const active = button.dataset.mobileBlanksTarget === target;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function openBatches() {
    setActiveTab('blanksOrdered');
    requestAnimationFrame(() => {
      const button = document.getElementById('blanks-receive-batches-btn');
      if (button) button.click();
      else window.setTimeout(() => document.getElementById('blanks-receive-batches-btn')?.click(), 80);
    });
  }

  function activateBlanksTarget(target) {
    if (!BLANKS_TARGETS.has(target)) return;
    if (target === 'batches') {
      openBatches();
      return;
    }

    lastBlanksTarget = target;
    if (target === 'to-order') {
      setActiveTab('blanksCart');
      syncNavigationState();
      return;
    }

    setActiveTab('blanksOrdered');
    const segment = document.getElementById(target === 'ordered' ? 'blanks-view-ordered' : 'blanks-view-cart');
    segment?.click();
    syncNavigationState();
  }

  function syncRefreshState() {
    const source = document.getElementById('order-manager-refresh-btn');
    const mobile = document.getElementById('mobile-refresh-btn');
    if (!source || !mobile) return;
    mobile.disabled = source.disabled;
    mobile.setAttribute('aria-busy', source.disabled ? 'true' : 'false');
    const label = mobile.querySelector('.mobile-refresh-label');
    if (label) label.textContent = source.disabled ? 'Syncing' : 'Sync';
  }

  function syncViewportMetrics() {
    const height = Math.round(window.visualViewport?.height || window.innerHeight);
    document.documentElement.style.setProperty('--embedded-viewport-height', `${height}px`);
    document.body.classList.toggle('shopify-embedded-mobile', isMobile());
    document.body.classList.toggle('embedded-short-viewport', isMobile() && height < 700);
    if (isMobile() && document.body.classList.contains('detail-open')) {
      normalizeDetailPresentation();
    }
  }

  function syncProductionSteps() {
    const controls = document.getElementById('ready-controls');
    if (!controls) return;
    const steps = Array.from(controls.querySelectorAll('.production-step'));
    if (!steps.length) return;

    const isComplete = step => (
      step.classList.contains('is-complete')
      || step.dataset.state === 'done'
      || Boolean(step.querySelector('input')?.checked)
    );
    const nextIndex = steps.findIndex(step => (
      step.classList.contains('is-next')
      || step.dataset.state === 'next'
      || !isComplete(step)
    ));

    const currentIndex = nextIndex > 0 && isComplete(steps[nextIndex - 1])
      ? nextIndex - 1
      : nextIndex < 0 ? steps.length - 1 : -1;

    steps.forEach((step, index) => {
      step.classList.toggle('mobile-current-step', index === currentIndex);
      step.classList.toggle('mobile-next-step', index === nextIndex);
    });
  }

  function normalizeDetailPresentation() {
    if (!isMobile()) return;
    try {
      if (typeof mobileDetailDragCleanup === 'function') mobileDetailDragCleanup();
      mobileDetailDragCleanup = null;
    } catch (error) {
      console.warn('Unable to disable mobile detail drag behavior', error);
    }

    const overlay = document.getElementById('detail-overlay');
    const card = document.getElementById('detail-card');
    overlay?.classList.remove('mobile-bottomsheet');
    overlay?.classList.add('mobile-fullscreen-detail');
    document.body.classList.remove('mobile-detail-open');
    card?.style.removeProperty('transition');
    card?.style.removeProperty('transform');
    syncProductionSteps();
    document.getElementById('detail-content')?.scrollTo({ top: 0, behavior: 'auto' });
  }

  function patchDetailPresentation() {
    try {
      if (typeof openDetail !== 'function' || openDetail.__shopifyEmbeddedMobile) return;
      const originalOpenDetail = openDetail;
      openDetail = function embeddedMobileOpenDetail(...args) {
        const result = originalOpenDetail.apply(this, args);
        if (isMobile()) requestAnimationFrame(normalizeDetailPresentation);
        return result;
      };
      openDetail.__shopifyEmbeddedMobile = true;
    } catch (error) {
      console.warn('Unable to patch embedded mobile order detail', error);
    }
  }

  function previewOrders() {
    const asset = (name, classification) => (
      `${window.location.origin}/Assets/${name}?file=/orders/${classification}`
    );
    const receivedAt = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString();
    const items = (apparel, prints, mockup = true) => [
      {
        title: 'Comfort Colors Tee',
        variantTitle: 'Brick / Large',
        qty: apparel,
        price: 18,
        assets: mockup
          ? [
              { url: asset('PipelineIcon.svg', 'customer-mockup-side.png') },
              { url: asset('Ready To Print Icon.svg', 'front.svg') },
              { url: asset('Storage Browser Icon.svg', 'back.svg') }
            ]
          : []
      },
      {
        title: 'T-shirt Full Print',
        variantTitle: 'Front',
        qty: prints,
        price: 4,
        assets: []
      }
    ];

    return [
      {
        name: '#1558 – Travis Brown',
        status: 'received',
        receivedAt: receivedAt(7),
        subtotal: 41.66,
        discount: 0,
        total: 41.66,
        notes: 'Center the front print 3 inches below the collar.',
        blanksOrdered: 0,
        blanksStatus: 0,
        printsStatus: 0,
        progress: 0,
        items: items(2, 6)
      },
      {
        name: '#1571 – Emery Noeman',
        status: 'received',
        receivedAt: receivedAt(1),
        subtotal: 30,
        discount: 0,
        total: 30,
        notes: '',
        blanksOrdered: 0,
        blanksStatus: 0,
        printsStatus: 0,
        progress: 0,
        items: items(1, 2)
      },
      {
        name: '#1555 – Nancy Holzer',
        status: 'print',
        receivedAt: receivedAt(11),
        subtotal: 46.63,
        total: 46.63,
        blanksOrdered: 1,
        blanksStatus: 1,
        printsStatus: 1,
        progress: 5,
        items: items(5, 5, false)
      },
      {
        name: '#1557 – Lakiea Sidney',
        status: 'print',
        receivedAt: receivedAt(9),
        subtotal: 326.4,
        total: 326.4,
        blanksOrdered: 1,
        blanksStatus: 1,
        printsStatus: 1,
        progress: 24,
        items: items(24, 24, false)
      },
      {
        name: '#1562 – Morgan Rivera',
        status: 'blanks',
        receivedAt: receivedAt(4),
        subtotal: 88.12,
        total: 88.12,
        blanksOrdered: 0,
        blanksStatus: 0,
        printsStatus: 0,
        progress: 0,
        items: items(6, 7, false)
      },
      {
        name: '#1563 – Jordan Williams',
        status: 'blanks',
        receivedAt: receivedAt(3),
        subtotal: 72.5,
        total: 72.5,
        blanksOrdered: 1,
        blanksStatus: 1,
        printsStatus: 0,
        progress: 0,
        items: items(4, 4, false)
      }
    ];
  }

  function maybeLoadPreviewFixtures() {
    const isLocal = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    const requested = new URLSearchParams(window.location.search).get('fixture') === '1';
    if (!isLocal || !requested) return;

    requestAnimationFrame(async () => {
      try {
        allOrders = previewOrders();
        await renderBoardFromLocalState();
        document.body.dataset.previewFixture = 'true';
        window.__printmoPreviewOpenDetail = (index = 0) => {
          const order = allOrders[index];
          if (order) openDetail(order);
        };
        syncNavigationState();
      } catch (error) {
        console.error('Unable to render embedded mobile preview fixtures', error);
      }
    });
  }

  function init() {
    patchDetailPresentation();
    syncViewportMetrics();
    syncNavigationState();
    syncProductionSteps();
    normalizeMobileCardInteractions();
    installEmbeddedTouchContainment();

    document.getElementById('mobile-refresh-btn')?.addEventListener('click', () => {
      document.getElementById('order-manager-refresh-btn')?.click();
    });

    document.querySelectorAll('[data-mobile-blanks-target]').forEach(button => {
      button.addEventListener('click', () => activateBlanksTarget(button.dataset.mobileBlanksTarget));
    });

    const productionToggle = document.getElementById('mobile-production-toggle');
    productionToggle?.addEventListener('click', () => {
      const expanded = document.body.classList.toggle('mobile-production-expanded');
      productionToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      productionToggle.textContent = expanded ? 'Show current only' : 'Show all steps';
    });

    const bodyObserver = new MutationObserver(syncNavigationState);
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-active-tab', 'data-active-view']
    });

    const appContent = document.querySelector('.app-content');
    if (appContent) {
      new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node instanceof Element) normalizeMobileCardInteractions(node);
          });
        });
      }).observe(appContent, { childList: true, subtree: true });
    }

    const blanksSection = document.getElementById('blanks-section');
    if (blanksSection) {
      new MutationObserver(syncNavigationState).observe(blanksSection, {
        attributes: true,
        attributeFilter: ['data-blanks-view']
      });
    }

    const receiveOverlay = document.getElementById('blanks-receive-overlay');
    if (receiveOverlay) {
      new MutationObserver(syncNavigationState).observe(receiveOverlay, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    const refreshSource = document.getElementById('order-manager-refresh-btn');
    if (refreshSource) {
      new MutationObserver(syncRefreshState).observe(refreshSource, {
        attributes: true,
        childList: true,
        subtree: true
      });
      syncRefreshState();
    }

    const readyControls = document.getElementById('ready-controls');
    if (readyControls) {
      new MutationObserver(syncProductionSteps).observe(readyControls, {
        childList: true,
        subtree: true
      });
      readyControls.addEventListener('change', () => requestAnimationFrame(syncProductionSteps));
    }

    mobileQuery.addEventListener('change', () => {
      syncViewportMetrics();
      syncNavigationState();
      normalizeMobileCardInteractions();
    });
    window.addEventListener('resize', syncViewportMetrics, { passive: true });
    window.visualViewport?.addEventListener('resize', syncViewportMetrics, { passive: true });
    maybeLoadPreviewFixtures();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
