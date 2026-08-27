(() => {
  const desktopQuery = window.matchMedia('(min-width: 901px)');
  const FILTERS = ['all', 'attention', 'stale', 'missing-mockup', 'ready'];
  const SORTS = new Set(['attention', 'oldest', 'newest', 'value']);
  const state = {
    filter: 'all',
    sort: 'attention'
  };

  function getOrders() {
    try {
      return Array.isArray(allOrders) ? allOrders : [];
    } catch (error) {
      return [];
    }
  }

  function orderParts(orderName) {
    const source = String(orderName || '');
    const parts = source.includes(' - ') ? source.split(' - ') : source.split(' \u2013 ');
    return {
      number: parts[0] || source,
      customer: parts.slice(1).join(' - ')
    };
  }

  function bool(value) {
    return Boolean(Number(value || 0));
  }

  function receivedTime(order) {
    const time = Date.parse(order?.receivedAt || '');
    return Number.isFinite(time) ? time : 0;
  }

  function ageHours(order) {
    const time = receivedTime(order);
    return time ? Math.max(0, (Date.now() - time) / 36e5) : 0;
  }

  function itemTotals(order) {
    return (order?.items || []).reduce((totals, item) => {
      const qty = Number(item?.qty) || 0;
      let isPrint = false;
      try {
        isPrint = typeof isPrintItem === 'function' && isPrintItem(item);
      } catch (error) {
        isPrint = false;
      }
      if (isPrint) totals.prints += qty;
      else totals.apparel += qty;
      totals.pieces += qty;
      totals.lines += 1;
      return totals;
    }, { apparel: 0, prints: 0, pieces: 0, lines: 0 });
  }

  function assetBuckets(order) {
    try {
      if (typeof splitOrderAssets === 'function') return splitOrderAssets(order);
    } catch (error) {
      // Fall back to a lightweight local scan below.
    }

    const buckets = { mockups: [], front: [], back: [], extras: [] };
    const seen = new Set();
    (order?.items || []).forEach(item => {
      (item?.assets || []).forEach(asset => {
        const url = typeof asset === 'string' ? asset : asset?.url;
        if (!url || seen.has(url)) return;
        seen.add(url);
        const normalized = String(url).toLowerCase();
        if (/side\.png(\?|$)/i.test(normalized)) buckets.mockups.push(asset);
        else if (/(front\.(svg|png|jpe?g)|_front(?:\.[a-z0-9]+)?)(\?|$)/i.test(normalized)) buckets.front.push(asset);
        else if (/(back\.(svg|png|jpe?g)|_back(?:\.[a-z0-9]+)?)(\?|$)/i.test(normalized)) buckets.back.push(asset);
        else buckets.extras.push(asset);
      });
    });
    return buckets;
  }

  function hasMockup(order, buckets) {
    if (buckets.mockups.length) return true;
    try {
      return typeof getFirstMockupUrl === 'function' && Boolean(getFirstMockupUrl(order));
    } catch (error) {
      return false;
    }
  }

  function evaluateOrder(order) {
    const totals = itemTotals(order);
    const buckets = assetBuckets(order);
    const designCount = buckets.front.length + buckets.back.length + buckets.extras.length;
    const ready = bool(order?.blanksStatus) && bool(order?.printsStatus);
    const stale = ageHours(order) >= 48;
    const aging = ageHours(order) >= 24;
    const missingMockup = !hasMockup(order, buckets);
    const missingFiles = totals.prints > 0 && designCount === 0;
    const needsBlanks = totals.apparel > 0 && !bool(order?.blanksOrdered);
    const needsPrints = totals.prints > 0 && !bool(order?.printsOrdered);
    const partialReady = !ready && (bool(order?.blanksStatus) || bool(order?.printsStatus));
    let score = 0;

    if (stale) score += 45;
    else if (aging) score += 20;
    if (missingFiles) score += 32;
    if (missingMockup) score += 18;
    if (needsBlanks) score += 18;
    if (needsPrints) score += 14;
    if (partialReady) score += 10;
    if (ready) score -= 40;

    const tags = ['all'];
    if (!ready && score >= 30) tags.push('attention');
    if (stale) tags.push('stale');
    if (missingMockup) tags.push('missing-mockup');
    if (missingFiles) tags.push('missing-files');
    if (ready) tags.push('ready');

    let label = 'Queued';
    let tone = 'neutral';
    if (ready) {
      label = 'Ready';
      tone = 'ready';
    } else if (missingFiles) {
      label = 'Missing files';
      tone = 'danger';
    } else if (stale) {
      label = 'Stale';
      tone = 'danger';
    } else if (missingMockup) {
      label = 'No mockup';
      tone = 'warning';
    } else if (needsBlanks) {
      label = 'Needs blanks';
      tone = 'warning';
    } else if (needsPrints) {
      label = 'Needs prints';
      tone = 'warning';
    } else if (partialReady) {
      label = 'Partly ready';
      tone = 'progress';
    }

    return {
      age: ageHours(order),
      designCount,
      label,
      missingFiles,
      missingMockup,
      needsBlanks,
      needsPrints,
      score: Math.max(0, score),
      stale,
      tags,
      tone,
      totals,
      ready
    };
  }

  function cardAlert(triage) {
    if (triage.missingFiles) return ['Missing files', 'danger'];
    if (triage.missingMockup) return ['No mockup', 'warning'];
    return null;
  }

  function setCardDatasets(card, order, triage) {
    const parts = orderParts(order?.name);
    card.dataset.dashboardOrderNumber = parts.number;
    card.dataset.dashboardCustomer = parts.customer;
    card.dataset.dashboardFilterTags = triage.tags.join(' ');
    card.dataset.dashboardAttentionScore = String(Math.round(triage.score));
    card.dataset.dashboardReceivedTime = String(receivedTime(order));
    card.dataset.dashboardValue = String(Number(order?.total ?? order?.subtotal ?? 0) || 0);
  }

  function decorateCard(card, order, style) {
    if (!card || !order) return card;
    const triage = evaluateOrder(order);
    const shopifyBoard = document.body?.dataset.orderSource === 'shopify';
    const status = order.status || 'received';
    if (shopifyBoard) {
      card.classList.add('shopify-board-card');
      if (status === 'received') card.classList.add('pipeline-main-card');
      if (status === 'blanks' || status === 'print') card.classList.add('production-card');
    }
    setCardDatasets(card, order, triage);
    card.classList.add('dashboard-triaged', `dashboard-tone-${triage.tone}`);
    card.classList.toggle('dashboard-needs-attention', triage.tags.includes('attention'));
    card.classList.toggle('dashboard-ready', triage.ready);
    card.classList.toggle('dashboard-stale', triage.stale);
    card.classList.toggle('dashboard-missing-mockup', triage.missingMockup);
    card.classList.toggle('dashboard-missing-files', triage.missingFiles);

    // Keep filtering and sorting data available everywhere. The denser card
    // decoration remains desktop-only so mobile cards retain their compact anatomy.
    if (!desktopQuery.matches || style !== 'pipeline' || (shopifyBoard && status !== 'received')) return card;

    const body = card.querySelector('.card-body');
    const footer = card.querySelector('.card-footer');
    if (!body || !footer || card.classList.contains('bundle-card')) return card;

    const counts = body.querySelector(':scope > .counts');
    if (counts && !footer.querySelector('.dashboard-footer-counts')) {
      counts.classList.add('dashboard-footer-counts');
      footer.insertBefore(counts, footer.querySelector('.footer-value'));
      card.classList.add('dashboard-counts-in-footer');
    }

    const customerName = body.querySelector(':scope > .cust-name');
    let infoRow = body.querySelector(':scope > .dashboard-card-info');
    if (customerName && !infoRow) {
      infoRow = document.createElement('div');
      infoRow.className = 'dashboard-card-info';
      body.insertBefore(infoRow, customerName);
      infoRow.appendChild(customerName);
    }

    if (body.querySelector('.dashboard-card-signals')) return card;

    const alert = cardAlert(triage);
    if (!alert) return card;

    let mockupSlot = body.querySelector('.mockup-slot');
    if (!mockupSlot && triage.missingMockup) {
      mockupSlot = document.createElement('div');
      mockupSlot.className = 'mockup-slot mockup-slot-unavailable dashboard-mockup-placeholder';
      mockupSlot.setAttribute('aria-label', 'No preview image is available');
      const placeholder = document.createElement('span');
      placeholder.className = 'mockup-placeholder-label';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = 'No preview';
      mockupSlot.appendChild(placeholder);
      body.insertBefore(mockupSlot, body.firstChild);
      body.classList.remove('no-mockup');
      body.classList.add('has-mockup', 'dashboard-generated-mockup-slot');
    }

    const signals = document.createElement('div');
    signals.className = 'dashboard-card-signals';
    card.classList.add('dashboard-has-alert');
    signals.innerHTML = `
      <span class="dashboard-alert-pill dashboard-alert-${alert[1]}">${alert[0]}</span>
    `;
    (infoRow || body).appendChild(signals);
    if (footer) footer.setAttribute('title', `Attention score: ${Math.round(triage.score)}`);
    return card;
  }

  function aggregateBundleTriage(orders) {
    const evaluations = (orders || []).map(evaluateOrder);
    const score = evaluations.reduce((max, item) => Math.max(max, item.score), 0);
    const received = Math.min(...(orders || []).map(receivedTime).filter(Boolean));
    const value = (orders || []).reduce((sum, order) => sum + (Number(order?.total ?? order?.subtotal ?? 0) || 0), 0);
    const tags = new Set(['all']);
    evaluations.forEach(item => item.tags.forEach(tag => tags.add(tag)));
    return { score, received: Number.isFinite(received) ? received : 0, tags: Array.from(tags), value };
  }

  function decorateBundle(card, orders) {
    if (!card) return card;
    const triage = aggregateBundleTriage(orders);
    if (document.body?.dataset.orderSource === 'shopify') {
      const status = orders?.[0]?.status || 'received';
      card.classList.add('shopify-board-card');
      if (status === 'received') card.classList.add('pipeline-main-card');
      if (status === 'blanks' || status === 'print') card.classList.add('production-card');
    }
    card.classList.add('dashboard-triaged', 'dashboard-bundle-card');
    card.classList.toggle('dashboard-needs-attention', triage.tags.includes('attention'));
    card.classList.toggle('dashboard-ready', triage.tags.includes('ready') && !triage.tags.includes('attention'));
    card.dataset.dashboardFilterTags = triage.tags.join(' ');
    card.dataset.dashboardAttentionScore = String(Math.round(triage.score));
    card.dataset.dashboardReceivedTime = String(triage.received);
    card.dataset.dashboardValue = String(triage.value);
    return card;
  }

  function sortCards(container) {
    if (!container) return;
    const empty = container.querySelector('.dashboard-triage-empty');
    if (empty) empty.remove();
    const cards = Array.from(container.querySelectorAll(':scope > .pipeline-card'));
    const sorted = cards.sort((left, right) => {
      const leftScore = Number(left.dataset.dashboardAttentionScore || 0);
      const rightScore = Number(right.dataset.dashboardAttentionScore || 0);
      const leftTime = Number(left.dataset.dashboardReceivedTime || 0);
      const rightTime = Number(right.dataset.dashboardReceivedTime || 0);
      const leftValue = Number(left.dataset.dashboardValue || 0);
      const rightValue = Number(right.dataset.dashboardValue || 0);

      if (state.sort === 'oldest') return leftTime - rightTime;
      if (state.sort === 'newest') return rightTime - leftTime;
      if (state.sort === 'value') return rightValue - leftValue || leftTime - rightTime;
      return rightScore - leftScore || leftTime - rightTime;
    });
    if (sorted.every((card, index) => card === container.children[index])) return;
    sorted.forEach(card => container.appendChild(card));
  }

  function ensureEmptyState(container) {
    let empty = container.querySelector('.dashboard-triage-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'dashboard-triage-empty';
      empty.textContent = 'No pipeline orders match this view.';
      container.appendChild(empty);
    }
    return empty;
  }

  function updateFilterCounts(cards) {
    const counts = FILTERS.reduce((acc, filter) => ({ ...acc, [filter]: 0 }), {});
    cards.forEach(card => {
      const tags = String(card.dataset.dashboardFilterTags || 'all').split(/\s+/);
      FILTERS.forEach(filter => {
        if (filter === 'all' || tags.includes(filter)) counts[filter] += 1;
      });
    });
    Object.entries(counts).forEach(([filter, count]) => {
      document.querySelectorAll(`[data-dashboard-filter-count="${filter}"]`).forEach(el => {
        el.textContent = String(count);
      });
    });
  }

  function applyDashboardTriage() {
    const container = document.getElementById('col-received');
    if (!container) return;
    sortCards(container);
    const cards = Array.from(container.querySelectorAll(':scope > .pipeline-card'));
    let visible = 0;
    cards.forEach(card => {
      const tags = String(card.dataset.dashboardFilterTags || 'all').split(/\s+/);
      const show = state.filter === 'all' || tags.includes(state.filter);
      card.classList.toggle('dashboard-filtered-out', !show);
      if (show) visible += 1;
    });
    updateFilterCounts(cards);
    const count = document.getElementById('pipeline-count');
    if (count) count.textContent = state.filter === 'all' ? String(cards.length) : `${visible}/${cards.length}`;
    const empty = ensureEmptyState(container);
    const boardState = document.body?.dataset.boardLoadState || 'ready';
    empty.hidden = boardState !== 'ready' || visible > 0;
  }

  function wireControls() {
    document.querySelectorAll('[data-dashboard-filter]').forEach(button => {
      if (button.dataset.dashboardFilterWired) return;
      button.dataset.dashboardFilterWired = 'true';
      button.addEventListener('click', () => {
        const next = button.dataset.dashboardFilter || 'all';
        state.filter = FILTERS.includes(next) ? next : 'all';
        document.querySelectorAll('[data-dashboard-filter]').forEach(item => {
          const active = item.dataset.dashboardFilter === state.filter;
          item.classList.toggle('active', active);
          item.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        applyDashboardTriage();
      });
    });

    const select = document.getElementById('dashboard-sort-select');
    if (select && !select.dataset.dashboardSortWired) {
      select.dataset.dashboardSortWired = 'true';
      select.value = state.sort;
      select.addEventListener('change', () => {
        state.sort = SORTS.has(select.value) ? select.value : 'attention';
        applyDashboardTriage();
      });
    }
  }

  function patchCardFactories() {
    if (typeof makeCard === 'function' && !makeCard.__dashboardTriagePatched) {
      const originalMakeCard = makeCard;
      makeCard = function dashboardTriageMakeCard(order, style = 'default', ...args) {
        const card = originalMakeCard.call(this, order, style, ...args);
        return decorateCard(card, order, style);
      };
      makeCard.__dashboardTriagePatched = true;
    }

    if (typeof makeBundleCard === 'function' && !makeBundleCard.__dashboardTriagePatched) {
      const originalMakeBundleCard = makeBundleCard;
      makeBundleCard = function dashboardTriageMakeBundleCard(name, orders, style = 'pipeline', ...args) {
        const card = originalMakeBundleCard.call(this, name, orders, style, ...args);
        return decorateBundle(card, orders);
      };
      makeBundleCard.__dashboardTriagePatched = true;
    }

    if (typeof renderBoard === 'function' && !renderBoard.__dashboardTriagePatched) {
      const originalRenderBoard = renderBoard;
      renderBoard = async function dashboardTriageRenderBoard(...args) {
        const result = await originalRenderBoard.apply(this, args);
        if (result?.rendered !== false) applyDashboardTriage();
        return result;
      };
      renderBoard.__dashboardTriagePatched = true;
    }
  }

  patchCardFactories();
  document.addEventListener('DOMContentLoaded', () => {
    wireControls();
    patchCardFactories();
    requestAnimationFrame(applyDashboardTriage);
  });
  desktopQuery.addEventListener('change', () => {
    patchCardFactories();
    requestAnimationFrame(applyDashboardTriage);
  });
})();
