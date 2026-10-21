/* Recognition-first cards. Presentation consumes the existing order snapshot;
   it never fetches artwork, changes readiness, or writes production state. */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealedPreviews = new Set();
  const observedSlots = new WeakSet();
  const activeSlots = new Set();
  const acknowledgedProgress = new Map();
  const backingPaints = new WeakMap();
  // Three blur radii of overscan keep the frame edges opaque after filtering.
  const backingInset = 36;
  let iconInstance = 0;
  const visibility = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => entries.forEach(entry => {
      entry.target.dataset.previewInView = String(entry.isIntersecting);
      entry.target.classList.toggle('preview-in-view', entry.isIntersecting);
    })) : null;
  const enabled = () => document.body?.dataset.orderSource === 'shopify';
  const previewResize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(entries => entries.forEach(({ target }) => {
      const image = target.querySelector('img.preview-image:not([hidden])');
      if (target.classList.contains('mockup-slot-ready') && image?.naturalWidth) paintBacking(target, image);
    })) : null;
  document.addEventListener('printmo:board-updated', () => {
    for (const slot of activeSlots) {
      if (!slot.isConnected) {
        visibility?.unobserve(slot);
        previewResize?.unobserve(slot);
        activeSlots.delete(slot);
        observedSlots.delete(slot);
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('preview-page-hidden', document.hidden);
  });

  function summary(order) {
    const items = (order?.items || []).filter(item => Number(item.qty) > 0);
    const descriptions = [...new Set(items.map(item => String(item.title || item.name || '').trim()).filter(Boolean))];
    return descriptions.slice(0, 2).join(' · ') || 'Order details inside';
  }

  function observePreview(host) {
    if (observedSlots.has(host)) return;
    observedSlots.add(host);
    activeSlots.add(host);
    visibility?.observe(host);
  }

  function paintBacking(slot, image) {
    const width = slot.clientWidth;
    const height = slot.clientHeight;
    if (!width || !height) return;
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const fittedWidth = sourceWidth * scale;
    const fittedHeight = sourceHeight * scale;
    let backing = slot.querySelector('.preview-backing');
    if (width - fittedWidth < 1 && height - fittedHeight < 1) {
      backing?.remove();
      return;
    }
    if (!backing) {
      backing = document.createElement('canvas');
      backing.className = 'preview-backing';
      backing.setAttribute('aria-hidden', 'true');
      slot.prepend(backing);
    }
    const source = image.currentSrc || image.src;
    const previous = backingPaints.get(backing);
    if (previous?.source === source && previous.width === width && previous.height === height) return;
    backing.width = width + backingInset * 2;
    backing.height = height + backingInset * 2;
    const context = backing.getContext('2d');
    if (!context) { backing.remove(); return; }
    const left = (width - fittedWidth) / 2 + backingInset;
    const top = (height - fittedHeight) / 2 + backingInset;
    const right = backing.width - left - fittedWidth;
    const bottom = backing.height - top - fittedHeight;
    // Stretch only the outermost pixel strips into the gaps, preserving their
    // alignment with the contained foreground. No pixel readback or extra fetch.
    const columns = [[0, 1, 0, left], [0, sourceWidth, left, fittedWidth], [sourceWidth - 1, 1, left + fittedWidth, right]];
    const rows = [[0, 1, 0, top], [0, sourceHeight, top, fittedHeight], [sourceHeight - 1, 1, top + fittedHeight, bottom]];
    for (const [sx, sw, dx, dw] of columns) {
      for (const [sy, sh, dy, dh] of rows) {
        context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
      }
    }
    backingPaints.set(backing, { source, width, height });
  }

  function createStatus(state, description = '') {
    const loading = state === 'loading';
    const failed = state === 'failed';
    const content = document.createElement('div');
    content.className = 'preview-summary';
    content.dataset.state = state;
    const mark = document.createElement('span');
    mark.className = 'preview-print-mark';
    mark.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('img');
    icon.className = 'preview-approved-icon';
    icon.src = './Assets/order-preview-mark.svg';
    icon.alt = '';
    mark.append(icon);
    if (loading) {
      const clipId = `preview-list-clip-${++iconInstance}`;
      // Overlay coordinates follow the approved SVG's 964 × 835 viewBox.
      // The moving bar stays over the three list rows, clear of the shirt.
      mark.insertAdjacentHTML('beforeend', `<svg class="preview-list-scan" viewBox="0 0 964 835" aria-hidden="true"><defs><clipPath id="${clipId}"><rect x="620" y="478" width="292" height="255" rx="14"/></clipPath></defs><g clip-path="url(#${clipId})"><rect class="preview-print-pass" x="626" y="485" width="280" height="26" rx="13" fill="#1a73e8"/></g></svg>`);
    }
    const label = document.createElement('span');
    label.className = 'preview-summary-label';
    label.textContent = loading ? 'Loading preview' : failed ? 'Preview could not load' : 'No preview available';
    content.append(mark, label);
    if (description) {
      const context = document.createElement('span');
      context.className = 'preview-summary-description';
      context.textContent = description;
      content.append(context);
    }
    return content;
  }

  function renderStatus(host, state, { preserveImage = false } = {}) {
    host.classList.add('preview-status-host');
    observePreview(host);
    host.setAttribute('aria-busy', String(state === 'loading'));
    const existing = host.querySelector('.preview-summary');
    if (existing?.dataset.state === state) return;
    existing?.remove();
    const content = createStatus(state);
    content.setAttribute('role', 'status');
    if (preserveImage) host.append(content);
    else host.replaceChildren(content);
  }

  function renderGarments(host, order) {
    const garments = window.OrderGarmentSummary?.models(order) || [];
    if (!garments.length) return false;
    const key = JSON.stringify(garments.map(garment => garment.key));
    if (host.dataset.garmentKey === key && host.querySelector('.detail-garment-summary')) return true;
    host.dataset.garmentKey = key;
    host.classList.add('preview-status-host');
    host.setAttribute('aria-busy', 'false');
    const list = document.createElement('div');
    list.className = 'detail-garment-summary';
    for (const garment of garments) {
      const figure = document.createElement('figure');
      const diagrams = document.createElement('div');
      diagrams.className = 'garment-summary-diagrams';
      diagrams.innerHTML = window.OrderGarmentSummary.diagram(garment) + window.OrderGarmentSummary.diagram(garment, true);
      const caption = document.createElement('figcaption');
      const name = document.createElement('strong');
      name.textContent = `${garment.label} · ${garment.qty}`;
      const placements = document.createElement('span');
      placements.textContent = garment.placementText || 'Print locations not assigned';
      caption.append(name, placements);
      figure.append(diagrams, caption);
      list.append(figure);
    }
    const note = document.createElement('p');
    note.className = 'garment-preview-note';
    note.textContent = 'Garment summary · no mockup. Outlined areas indicate print locations, not artwork size.';
    list.append(note);
    host.replaceChildren(list);
    return true;
  }

  function placeholder(slot, order, { preserveImage = false } = {}) {
    const state = slot.classList.contains('mockup-slot-loading') ? 'loading'
      : slot.classList.contains('mockup-slot-failed') ? 'failed' : 'unavailable';
    const existing = slot.querySelector('.preview-summary');
    const garment = state !== 'loading' ? window.OrderGarmentSummary?.model(order) : null;
    const key = garment?.key || summary(order);
    if (existing?.dataset.state === state && existing.dataset.summaryKey === key) return;
    existing?.remove();
    const content = garment ? document.createElement('div') : createStatus(state, summary(order));
    if (garment) {
      content.className = 'preview-summary garment-summary';
      content.dataset.state = state;
      const diagrams = document.createElement('div');
      diagrams.className = 'garment-summary-diagrams';
      diagrams.innerHTML = window.OrderGarmentSummary.diagram(garment) + window.OrderGarmentSummary.diagram(garment, true);
      const label = document.createElement('span');
      label.className = 'garment-summary-label';
      label.textContent = garment.label;
      const caption = document.createElement('span');
      caption.className = 'garment-summary-caption';
      caption.textContent = state === 'failed' ? `Preview failed${garment.extra ? ` · +${garment.extra} combinations` : ''}` : garment.extra ? `+${garment.extra} other ${garment.extra === 1 ? 'combination' : 'combinations'}` : garment.placementText;
      content.title = `${garment.label}. ${garment.caption}.${garment.locations.length ? ` Print locations: ${garment.placementText}. Areas are schematic, not artwork dimensions.` : ''}`;
      content.setAttribute('aria-label', content.title);
      content.append(diagrams, label);
      if (caption.textContent) content.append(caption);
    }
    content.dataset.summaryKey = key;
    if (preserveImage) slot.append(content);
    else slot.replaceChildren(content);
  }

  function refreshPreview(slot, order) {
    if (!enabled() || !slot?.closest('.recognition-card')) return;
    slot.classList.add('recognition-preview');
    slot.classList.toggle('preview-in-view', slot.dataset.previewInView === 'true');
    if (!observedSlots.has(slot)) {
      observePreview(slot);
      previewResize?.observe(slot);
    }
    const image = slot.querySelector('img:not(.preview-approved-icon)');
    if (!image) { placeholder(slot, order); return; }
    image.classList.add('preview-image');
    const reveal = () => {
      if (!image.naturalWidth) return;
      image.hidden = false;
      slot.querySelector('.preview-summary')?.remove();
      slot.classList.remove('mockup-slot-loading', 'mockup-slot-unavailable', 'mockup-slot-failed');
      slot.classList.add('mockup-slot-ready');
      paintBacking(slot, image);
      const previewKey = `${slot.closest('.card')?.dataset.orderKey}:${slot.dataset.assetId || image.currentSrc || image.src}`;
      if (!revealedPreviews.has(previewKey)) {
        revealedPreviews.add(previewKey);
        if (!reduced.matches) image.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
      }
    };
    if (!image.dataset.recognitionTracked) {
      image.dataset.recognitionTracked = 'true';
      image.addEventListener('load', reveal);
      image.addEventListener('error', () => {
        slot.classList.remove('mockup-slot-ready', 'mockup-slot-loading');
        slot.classList.add('mockup-slot-failed');
        slot.querySelector('.preview-backing')?.remove();
        image.hidden = true;
        placeholder(slot, order);
      });
    }
    image.hidden = false;
    if (image.complete && image.naturalWidth) reveal();
    else if (!image.complete) {
      image.hidden = true;
      slot.querySelector('.preview-backing')?.remove();
      slot.classList.remove('mockup-slot-ready');
      slot.classList.add('mockup-slot-loading');
      placeholder(slot, order, { preserveImage: true });
    }
  }

  function decorate(card, order, { apparel, prints, other, style }) {
    if (!enabled() || !order?._candidate) return;
    card.querySelector('.delete-btn')?.remove();
    if (!['pipeline', 'printProgress'].includes(style)) return;
    card.classList.add('recognition-card');
    card.querySelector('.card-header')?.classList.remove('status-green', 'status-yellow');
    const name = card.querySelector('.cust-name');
    const identity = document.createElement('div');
    identity.className = 'recognition-identity';
    if (name) {
      name.textContent = String(order.name || '').split(' – ').slice(1).join(' – ') || 'Name unavailable';
      name.title = name.textContent;
      identity.append(name);
    }
    card.prepend(identity);
    const body = card.querySelector('.card-body');
    const counts = body.querySelector('.counts');
    if (counts) {
      counts.classList.add('recognition-facts');
      counts.replaceChildren();
      for (const [kind, value, label] of [['garments', apparel, apparel === 1 ? 'garment' : 'garments'], ['prints', prints, prints === 1 ? 'print' : 'prints'], ...(other ? [['other', other, 'other']] : [])]) {
        const fact = document.createElement('span');
        fact.className = kind === 'other' ? 'quantity-other' : 'quantity-material';
        fact.dataset.quantityKind = kind;
        const copy = document.createElement('span');
        copy.className = 'quantity-copy';
        const quantity = document.createElement('span');
        quantity.className = 'quantity-label';
        const number = document.createElement('strong');
        number.textContent = String(value);
        quantity.append(number, document.createTextNode(` ${label}`));
        copy.append(quantity);
        if (kind !== 'other') {
          const [orderedFlag, readyFlag] = kind === 'garments'
            ? [order.blanksOrdered, order.blanksStatus]
            : [order.printsOrdered, order.printsStatus];
          const ordered = Boolean(Number(orderedFlag || 0));
          const ready = Boolean(Number(readyFlag || 0));
          const material = window.OrderBoardModel?.materialState(orderedFlag, readyFlag)
            || { ordered, ready, label: ready ? 'Ready' : ordered ? 'Ordered' : 'Not ordered' };
          fact.dataset.materialState = material.ready ? 'ready' : material.ordered ? 'ordered' : 'pending';
          const icon = document.createElement('img');
          icon.className = 'quantity-status-icon';
          icon.alt = '';
          const asset = `${kind === 'garments' ? 'ApparelCount' : 'PrintCount'}${material.ordered || material.ready ? 'Green' : ''}.svg`;
          icon.src = typeof window.getAssetPath === 'function' ? window.getAssetPath(asset) : `./Assets/${asset}`;
          const status = document.createElement('span');
          status.className = 'quantity-state';
          status.textContent = material.label;
          copy.append(status);
          fact.append(icon);
        }
        fact.append(copy);
        counts.append(fact);
      }
      const slot = body.querySelector('.mockup-slot');
      if (slot) slot.after(counts);
    }
    card.querySelectorAll('.normal-view .cust-name').forEach(node => node.remove());
    const progress = card.querySelector('.progress-count');
    if (progress) {
      const [done, total] = progress.textContent.split('/').map(Number);
      progress.append(document.createTextNode(' garments printed'));
      if (total > 0) {
        const track = document.createElement('div');
        track.className = 'recognition-progress';
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', 'Garments printed');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', String(total));
        track.setAttribute('aria-valuenow', String(Math.max(0, Math.min(total, done))));
        const fill = document.createElement('span');
        const fraction = Math.max(0, Math.min(1, done / total));
        fill.style.transform = `scaleX(${fraction})`;
        track.append(fill);
        card.querySelector('.progress-view').append(track);
        const key = `${order._provider || 'shopify'}:${order._orderKey || order._gid || order.name}`;
        if (!window.dashboardMotion?.saving) {
          const previous = acknowledgedProgress.get(key);
          acknowledgedProgress.set(key, fraction);
          if (previous !== undefined && previous !== fraction && !reduced.matches) {
            fill.animate?.([{ transform: `scaleX(${previous})` }, { transform: `scaleX(${fraction})` }], { duration: 220, easing: 'ease-out' });
          }
        }
      }
    }
    const known = new Set();
    for (const asset of [...(order.assets || []), ...(order.items || []).flatMap(item => item.assets || [])]) {
      const identity = asset?.assetId || asset?.id || asset?.url;
      if (asset?.role === 'mockup' && identity) known.add(identity);
    }
    const slot = body.querySelector('.mockup-slot');
    if (slot && known.size > 1) {
      const count = document.createElement('span');
      count.className = 'preview-count';
      count.textContent = `${known.size} previews`;
      // Keep this outside the slot: private-image hydration may replace its children.
      body.append(count);
    }
    refreshPreview(slot, order);
  }

  window.OrderCardPresentation = { decorate, refreshPreview, renderStatus, renderGarments };
})();
