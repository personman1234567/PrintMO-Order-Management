(function () {
  const checkboxIds = [
    'chk-blanks',
    'chk-prints',
    'chk-blanks-ordered',
    'chk-prints-ordered'
  ];
  let mockupObserver = null;
  let itemTableObserver = null;
  let selectedMockupIndex = 0;
  let assetViewerCloseTimer = null;

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

  function readyStateFromInputs() {
    const checked = checkboxIds.filter(id => document.getElementById(id)?.checked).length;
    if (checked === checkboxIds.length) return { label: 'Ready', state: 'ready' };
    if (checked > 0) return { label: `${checked}/4 ready`, state: 'partial' };
    return { label: 'Not ready', state: 'missing' };
  }

  function syncReadySummary() {
    const summary = document.getElementById('detail-header-ready-summary');
    if (!summary) return;
    const state = readyStateFromInputs();
    summary.textContent = state.label;
    summary.dataset.state = state.state;
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
    syncReadySummary();
  }

  function wireReadyInputs() {
    checkboxIds.forEach(id => {
      const input = document.getElementById(id);
      if (!input || input.dataset.detailSummaryWired) return;
      input.dataset.detailSummaryWired = 'true';
      input.addEventListener('change', syncReadySummary);
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
    const designRow = target?.closest?.('.design-file-row');
    if (designRow) {
      return designRow.querySelector('.design-label')?.textContent?.trim() || 'Design file preview';
    }
    return '';
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
    if (hint) hint.textContent = 'Click to enlarge';

    thumbs.forEach((thumb, thumbIndex) => {
      const selected = thumbIndex === selectedMockupIndex;
      thumb.classList.toggle('is-selected', selected);
      thumb.tabIndex = 0;
      thumb.setAttribute('aria-selected', String(selected));
      thumb.setAttribute('role', 'button');
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
      if (currentThumb) {
        setAssetViewerCaption(assetLabelFromTarget(currentThumb));
        currentThumb.click();
      }
    };
  }

  function wireMockupBrowser() {
    const track = document.getElementById('detail-mockups-track');
    if (!track) return;

    if (!track.dataset.detailBrowserCaptureWired) {
      track.dataset.detailBrowserCaptureWired = 'true';
      track.addEventListener('click', event => {
        if (event.target?.closest?.('.manual-mockup-delete')) return;
        const thumb = event.target?.closest?.('.mockup-thumb');
        if (!thumb || !track.contains(thumb)) return;
        const index = mockupThumbs().indexOf(thumb);
        if (index < 0 || index === selectedMockupIndex) return;
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
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          selectedMockupIndex = index;
          syncSelectedMockup(index);
          thumb.click();
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
      syncDetailHeader(order);
      wireReadyInputs();
      wireAssetViewerCaptions();
      patchAssetViewerClose();
      wireItemsTable(order);
      requestAnimationFrame(wireMockupBrowser);
      requestAnimationFrame(() => enhanceItemsTable(order));
      return result;
    };
    enhancedOpenDetail.__detailSummaryPatched = true;
    openDetail = enhancedOpenDetail;
    window.openDetail = enhancedOpenDetail;
  }

  document.addEventListener('DOMContentLoaded', () => {
    patchDetailOpen();
    wireReadyInputs();
    wireAssetViewerCaptions();
    patchAssetViewerClose();
    wireMockupBrowser();
    wireItemsTable();
  });

  patchDetailOpen();
  wireAssetViewerCaptions();
  patchAssetViewerClose();
  wireItemsTable();
})();
