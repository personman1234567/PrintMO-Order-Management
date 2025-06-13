// renderer.js

let allOrders = [];
let bundleMode = null; // {status, selected:Set<string>}
let detailOrder = null;
let fileRemoveMode = false;
const selectedFiles = new Set();

// utility to detect “print” items by SKU or title
function isPrintItem(li) {
  return PRINT_TITLES.has(li.title);
}

const PRINT_TITLES = new Set([
  'T-shirt Breast Print',
  'T-shirt Chest Print',
  'T-shirt Full Print',
  'T-shirt Full Back Print',
  'T-shirt Half Back Print',
  'T-shirt Back Tag Print',
  'T-shirt Neck Tag Print',
  'T-shirt Sleeve Print',
  'Full Sleeve Print',
  'Half Sleeve Print',
  'Hood Print',
  'Sweatpants Small Logo Print',
  'Sweatpants Half Leg Print',
  'Sweatpants Full Leg Print',
  'Hat Front Print',
  'Hat Side Print',
  'Hat Back Print',
  'Drawstring Bag Full Print',
  'Drawstring Bag Small Print',
  'Tote Bag Small Print',
  'Tote Bag Half Print',
  'Tote Bag Full Print'
]);


function timeAgo(isoDate) {
  const then = new Date(isoDate);
  const now  = new Date();
  const diff = now - then;               // ms
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// shrink the font size of `el` until its text fits on one line
function shrinkTextToFit(el, min = 8) {
  if (!el) return;
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.offsetWidth && size > min) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
  }
}

// build a card from the record’s `items` array
function makeCard(o, style = 'default') {
  const card = document.createElement('div');
  card.className   = 'card';
  card.draggable   = true;
  card.dataset.orderId = o.name;

  // split “#1234 – John Smith”
  const [orderNum, custNameRaw] = o.name.split(' – ');
  const custName = custNameRaw || '';

  // count apparel vs prints
  let apparel = 0, prints = 0;
  (o.items || []).forEach(it => {
    if (isPrintItem(it)) prints += it.qty;
    else apparel += it.qty;
  });

  if (style === 'pipeline') {
    // PIPELINE style
    card.classList.add('pipeline-card');
    card.innerHTML = `
      <div class="card-header">
        <span class="order-number">${orderNum}</span>
        <span class="time-ago-pill">${timeAgo(o.receivedAt)}</span>
      </div>
      <div class="card-body">
        <div class="cust-name">${custName}</div>
        <div class="counts">
          <span class="apparel-count">${apparel} pcs</span>
          <span class="prints-count">${prints} prints</span>
        </div>
      </div>
      <div class="card-footer">
        <span class="footer-label">Subtotal</span>
        <span class="footer-value">$${(o.subtotal||0).toFixed(2)}</span>
      </div>
    `;
    const hdr = card.querySelector('.card-header');
    const ftr = card.querySelector('.card-footer');
    let cls = '';
    if (o.blanksStatus && o.printsStatus) cls = 'status-green';
    else if (o.blanksStatus || o.printsStatus) cls = 'status-yellow';
    if (cls) {
      hdr.classList.add(cls);
      if (ftr) ftr.classList.add(cls);
    }
  } else if (style === 'picked') {
    // picked card style for middle section
    card.classList.add('pipeline-card');
    card.innerHTML = `
      <div class="card-header"><span class="cust-name">${custName}</span></div>
      <div class="card-body picked-body">
        <div class="counts"><strong>${apparel}</strong></div>
      </div>
    `;
    requestAnimationFrame(() => {
      shrinkTextToFit(card.querySelector('.cust-name'));
      shrinkTextToFit(card.querySelector('.counts strong'), 10);
    });
    const hdr = card.querySelector('.card-header');
    let cls = '';
    if (o.blanksStatus && o.printsStatus) cls = 'status-green';
    else if (o.blanksStatus || o.printsStatus) cls = 'status-yellow';
    if (cls) hdr.classList.add(cls);
  } else {
    // DEFAULT style (your existing square card)
    card.innerHTML = `
      <div class="order-number">${orderNum}</div>
      <div class="order-cust">${custName}</div>
      <div class="counts">Apparel: ${apparel}, Prints: ${prints}</div>
    `;
  }

  card.style.position = 'relative';

  const del = document.createElement('button');
  del.className   = 'delete-btn';
  del.textContent = '×';
  del.title       = 'Delete this order';
  del.addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm(`Delete ${o.name}?`)) {
      await window.api.deleteOrder(o.name);
      await renderBoard();
    }
  });
  card.appendChild(del);

  // drag handlers
  card.addEventListener('dragstart', e => {
    document.body.classList.add('dragging-cursor');
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', o.name);
  });

  card.addEventListener('dragend', () => {
    document.body.classList.remove('dragging-cursor');
    card.classList.remove('dragging');
  });

  if (card.classList.contains('pipeline-card')) {
    const delay = (Math.random() * 3).toFixed(2) + 's';
    card.style.setProperty('--shimmer-delay', delay);
  }

  card.addEventListener('click', () => openDetail(o));

  return card;
}

function makeBundleCard(name, orders, style = 'pipeline') {
  const card = document.createElement('div');
  card.className = 'card bundle-card pipeline-card';
  card.dataset.bundleName = name;
  card.draggable = true;

  let allReady = true,
      anyReady = false;
  orders.forEach(o => {
    if (!(o.blanksStatus && o.printsStatus)) allReady = false;
    if (o.blanksStatus || o.printsStatus) anyReady = true;
  });

  let bodyHtml = `<div class="counts"><strong>${orders.length} Orders</strong></div>`;
  if (style === 'picked') {
    let apparel = 0;
    orders.forEach(o => (o.items || []).forEach(it => {
      if (!isPrintItem(it)) apparel += it.qty;
    }));
    bodyHtml = `<div class="counts"><strong>${apparel}</strong></div>`;
  }
  card.innerHTML = `
    <div class="card-header"><span class="cust-name">${name}</span></div>
    <div class="card-body">${bodyHtml}</div>
  `;

  if (allReady) card.classList.add('status-green');
  else if (anyReady) card.classList.add('status-yellow');

  card.addEventListener('click', () => openBundleModal(name, orders));

  card.addEventListener('dragstart', e => {
    document.body.classList.add('dragging-cursor');
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', `bundle:${name}`);
  });

  card.addEventListener('dragend', () => {
    document.body.classList.remove('dragging-cursor');
    card.classList.remove('dragging');
  });

  return card;
}

function openBundleModal(name, orders) {
  const overlay = document.getElementById('bundle-overlay');
  document.getElementById('bundle-title').textContent = name;
  const container = document.getElementById('bundle-cards');
  container.innerHTML = '';
  orders.forEach(o => container.appendChild(makeCard(o, 'pipeline')));
  const destroyBtn = document.getElementById('bundle-destroy');
  destroyBtn.onclick = async () => {
    if (!confirm(`Destroy bundle "${name}"?`)) return;
    const ids = orders.map(o => o.name);
    await window.api.setBundle(ids, '');
    closeBundleModal();
    await renderBoard();
  };
  const onOverlayClick = e => {
    if (e.target.id === 'bundle-overlay') closeBundleModal();
  };
  overlay.classList.remove('hidden');
  overlay.onclick = onOverlayClick;
}

function closeBundleModal() {
  const overlay = document.getElementById('bundle-overlay');
  overlay.classList.add('hidden');
  overlay.onclick = null;
}

function openDetail(o) {
  detailOrder = o;
  // fill header
  document.getElementById('detail-timestamp').textContent = new Date(o.receivedAt).toLocaleString();

  // customer & notes
  const [orderNum, custName = ''] = (o.name || '').split(' – ');
  document.getElementById('detail-order-id').textContent   = `Order ${orderNum}`;
  document.getElementById('detail-cust-name').textContent = custName;
  document.getElementById('detail-notes').textContent = o.notes || 'No special instructions';

  // line items
  const tbody = document.querySelector('#detail-items tbody');
  tbody.innerHTML = (o.items || []).map(i => {
    const p = Number(i.unitPrice) || 0;
    const lineTotal = (p * i.qty).toFixed(2) || 0;
    return `
      <tr>
        <td style="padding:4px 8px;">${i.qty}</td>
        <td style="padding:4px 8px;">${i.title}</td>
        <td style="padding:4px 8px;">${i.variantTitle || '–'}</td>  <!-- new -->
        <td style="padding:4px 8px; text-align:right;">$${lineTotal}</td>
      </tr>`;
  }).join('');

  // discount & total
  const disc = Number(o.discount) || 0;
  const tot  = Number(o.total)    || 0;
  
  document.getElementById('detail-discount').textContent = `-$${disc.toFixed(2)}`;
  document.getElementById('detail-total').textContent    = `$${tot.toFixed(2)}`;

  const chkBlanks = document.getElementById('chk-blanks');
  const chkPrints = document.getElementById('chk-prints');
  const applyBtn  = document.getElementById('ready-apply');
  chkBlanks.checked = !!o.blanksStatus;
  chkPrints.checked = !!o.printsStatus;
  applyBtn.classList.add('hidden');

  const updateApply = () => {
    const b = chkBlanks.checked ? 1 : 0;
    const p = chkPrints.checked ? 1 : 0;
    if (b !== (o.blanksStatus || 0) || p !== (o.printsStatus || 0)) {
      applyBtn.classList.remove('hidden');
    } else {
      applyBtn.classList.add('hidden');
    }
  };
  chkBlanks.onchange = chkPrints.onchange = updateApply;
  applyBtn.onclick = async () => {
    const blanks = chkBlanks.checked ? 1 : 0;
    const prints = chkPrints.checked ? 1 : 0;
    await window.api.updateReady(o.name, blanks, prints);
    await renderBoard();
    applyBtn.classList.add('hidden');
    const bundleOverlay = document.getElementById('bundle-overlay');
    if (!bundleOverlay.classList.contains('hidden')) {
      const bundleName = document.getElementById('bundle-title').textContent;
      const bundleOrders = allOrders.filter(x => x.bundle === bundleName);
      const container = document.getElementById('bundle-cards');
      container.innerHTML = '';
      bundleOrders.forEach(ord => container.appendChild(makeCard(ord, 'pipeline')));
    }
  };

  document.getElementById('detail-files-btn').onclick = () => openFilesModal(o);

  // show overlay
  document.getElementById('detail-overlay')
    .classList.replace('hidden', 'visible');

  document.getElementById('detail-overlay').classList.add('visible');
  document.body.classList.add('detail-open');

  document.querySelector('.pipeline').classList.add('no-delete');
}

function closeDetail() {
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').classList.remove('visible');
  document.body.classList.remove('detail-open');
  document.querySelector('.pipeline').classList.remove('no-delete');
}

function renderFileList(order) {
  const container = document.getElementById('file-list');
  const files = order.attachments || [];
  container.innerHTML = files.map(f => {
    let thumb = '';
    if (/png|jpe?g/i.test(f.mime)) {
      thumb = `<img src="data:${f.mime};base64,${f.data}" />`;
    } else {
      thumb = '<div class="svg-placeholder"></div>';
    }
    const sel = selectedFiles.has(f.name) ? ' file-selected' : '';
    return `<div class="file-item${sel}" data-name="${f.name}">${thumb}<div>${f.name}</div></div>`;
  }).join('');
  container.querySelectorAll('.file-item').forEach(el => {
    el.onclick = () => {
      const name = el.dataset.name;
      if (fileRemoveMode) {
        if (selectedFiles.has(name)) {
          selectedFiles.delete(name);
          el.classList.remove('file-selected');
        } else {
          selectedFiles.add(name);
          el.classList.add('file-selected');
        }
        return;
      }
      const f = files.find(x => x.name === name);
      if (!f) return;
      const a = document.createElement('a');
      a.href = `data:${f.mime};base64,${f.data}`;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  });
}

function openFilesModal(order) {
  cancelFileRemoval();
  renderFileList(order);
  const overlay = document.getElementById('files-overlay');
  overlay.classList.remove('hidden');

  const drop = document.getElementById('file-drop');
  drop.classList.remove('over');
  const onDragOver = e => { e.preventDefault(); drop.classList.add('over'); };
  const onDragLeave = () => drop.classList.remove('over');
  const onDrop = async e => {
    e.preventDefault();
    drop.classList.remove('over');
    for (const file of e.dataTransfer.files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const obj = { name: file.name, mime: file.type || 'application/octet-stream', data: base64 };
        await window.api.addFile(order.name, obj);
        if (!Array.isArray(order.attachments)) order.attachments = [];
        order.attachments.push(obj);
        renderFileList(order);
      };
      reader.readAsDataURL(file);
    }
  };
  drop.addEventListener('dragover', onDragOver);
  drop.addEventListener('dragleave', onDragLeave);
  drop.addEventListener('drop', onDrop);

  document.getElementById('files-remove-btn').onclick = () => startFileRemoval(order);
  document.getElementById('files-cancel-btn').onclick = cancelFileRemoval;
  document.getElementById('files-delete-btn').onclick = () => confirmFileRemoval(order);

  overlay.onclick = e => { if (e.target.id === 'files-overlay') { closeFilesModal(onDragOver,onDragLeave,onDrop); } };
}

function closeFilesModal(ov, lv, dp) {
  cancelFileRemoval();
  const overlay = document.getElementById('files-overlay');
  overlay.classList.add('hidden');
  const drop = document.getElementById('file-drop');
  drop.removeEventListener('dragover', ov);
  drop.removeEventListener('dragleave', lv);
  drop.removeEventListener('drop', dp);
  overlay.onclick = null;
}

function startFileRemoval(order) {
  fileRemoveMode = true;
  selectedFiles.clear();
  document.getElementById('files-remove-btn').classList.add('hidden');
  document.getElementById('files-delete-btn').classList.remove('hidden');
  document.getElementById('files-cancel-btn').classList.remove('hidden');
  renderFileList(order);
}

function cancelFileRemoval() {
  fileRemoveMode = false;
  selectedFiles.clear();
  document.getElementById('files-remove-btn').classList.remove('hidden');
  document.getElementById('files-delete-btn').classList.add('hidden');
  document.getElementById('files-cancel-btn').classList.add('hidden');
  if (detailOrder) renderFileList(detailOrder);
}

async function confirmFileRemoval(order) {
  const names = Array.from(selectedFiles);
  if (!names.length) { cancelFileRemoval(); return; }
  await window.api.removeFiles(order.name, names);
  order.attachments = order.attachments.filter(f => !selectedFiles.has(f.name));
  cancelFileRemoval();
  renderFileList(order);
}

// close handlers
document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('detail-overlay')
    .classList.replace('visible','hidden');
});
document.getElementById('detail-overlay')
  .addEventListener('click', e => {
    if (e.target.id === 'detail-overlay') {
      e.currentTarget.classList.replace('visible','hidden');
    }
  });

// fetch & render every zone
async function renderBoard() {
  allOrders = await window.api.getQueue();

  // Pipeline
  const recs = allOrders.filter(x => x.status === 'received');
  const recEl = document.getElementById('col-received');
  recEl.innerHTML = '';
  const recGroups = {};
  recs.forEach(o => {
    if (o.bundle) {
      if (!recGroups[o.bundle]) recGroups[o.bundle] = [];
      recGroups[o.bundle].push(o);
    } else {
      recEl.appendChild(makeCard(o, 'pipeline'));
    }
  });
  Object.entries(recGroups).forEach(([n, arr]) => {
    recEl.appendChild(makeBundleCard(n, arr));
  });
  document.getElementById('pipeline-count').textContent = recs.length;

  // ToOrder picks
  const picks = allOrders.filter(o => o.status === 'toOrder');
  const pickedEl = document.getElementById('picked-cards');
  pickedEl.innerHTML = '';
  const pickGroups = {};
  picks.forEach(o => {
    if (o.bundle) {
      if (!pickGroups[o.bundle]) pickGroups[o.bundle] = [];
      pickGroups[o.bundle].push(o);
    } else {
      pickedEl.appendChild(makeCard(o, 'picked'));
    }
  });
  Object.entries(pickGroups).forEach(([n, arr]) => {
    pickedEl.appendChild(makeBundleCard(n, arr, 'picked'));
  });
  updateSummary();

  // Blanks Ordered
  const blanksEl = document.getElementById('col-blanks');
  blanksEl.innerHTML = '';
  const blankOrders = allOrders.filter(x => x.status === 'blanks');
  const blankGroups = {};
  blankOrders.forEach(o => {
    if (o.bundle) {
      if (!blankGroups[o.bundle]) blankGroups[o.bundle] = [];
      blankGroups[o.bundle].push(o);
    } else {
      blanksEl.appendChild(makeCard(o, 'pipeline'));
    }
  });
  Object.entries(blankGroups).forEach(([n, arr]) => {
    blanksEl.appendChild(makeBundleCard(n, arr));
  });

  // Ready To Print
  const printEl = document.getElementById('col-print');
  printEl.innerHTML = '';
  const printOrders = allOrders.filter(x => x.status === 'print');
  const printGroups = {};
  printOrders.forEach(o => {
    if (o.bundle) {
      if (!printGroups[o.bundle]) printGroups[o.bundle] = [];
      printGroups[o.bundle].push(o);
    } else {
      printEl.appendChild(makeCard(o, 'pipeline'));
    }
  });
  Object.entries(printGroups).forEach(([n, arr]) => {
    printEl.appendChild(makeBundleCard(n, arr));
  });
}

// recalc summary from “toOrder” items
function updateSummary() {
  const picks = allOrders.filter(x => x.status === 'toOrder');
  const summary = { Apparel: 0, Prints: 0 };
  picks.forEach(o =>
    (o.items || []).forEach(it => {
      if (isPrintItem(it)) summary.Prints += it.qty;
      else summary.Apparel += it.qty;
    })
  );
  const ul = document.getElementById('summary-list');
  ul.innerHTML = Object.entries(summary)
    .map(([k, v]) => `<li>${k}: ${v}</li>`)
    .join('');
  document.getElementById('cart-total').textContent =
    `Total items: ${summary.Apparel}`;
}

function startBundle(status) {
  if (bundleMode) return;
  const colId = status === 'received' ? 'col-received'
               : status === 'blanks' ? 'col-blanks'
               : 'col-print';
  const container = document.getElementById(colId);
  bundleMode = { status, container, selected: new Set() };
  container.querySelectorAll('.pipeline-card:not(.bundle-card)').forEach(c => {
    c.addEventListener('click', toggleBundleSelect, true);
  });
}

function toggleBundleSelect(e) {
  e.stopPropagation();
  e.stopImmediatePropagation();
  const card = e.currentTarget;
  const id = card.dataset.orderId;
  if (bundleMode.selected.has(id)) {
    bundleMode.selected.delete(id);
    card.classList.remove('bundle-selected');
  } else {
    bundleMode.selected.add(id);
    card.classList.add('bundle-selected');
  }
}

function cancelBundle() {
  if (!bundleMode) return;
  bundleMode.container.querySelectorAll('.pipeline-card:not(.bundle-card)').forEach(c => {
    c.removeEventListener('click', toggleBundleSelect, true);
    c.classList.remove('bundle-selected');
  });
  bundleMode = null;
}

async function confirmBundle(name) {
  if (!bundleMode) return;
  const ids = Array.from(bundleMode.selected);
  await window.api.setBundle(ids, name);
  cancelBundle();
  await renderBoard();
}

function promptBundleName() {
  return new Promise(resolve => {
    const overlay = document.getElementById('bundle-name-overlay');
    const input = document.getElementById('bundle-name-input');
    const confirmBtn = document.getElementById('bundle-name-confirm');
    const cancelBtn = document.getElementById('bundle-name-cancel');

    function cleanup() {
      overlay.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }

    function onConfirm() {
      const val = input.value.trim();
      cleanup();
      resolve(val);
    }

    function onCancel() {
      cleanup();
      resolve('');
    }

    function onKey(e) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    }

    overlay.classList.remove('hidden');
    input.value = '';
    input.focus();

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function makeDropZone(el, status) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    // highlight only the drag‐area if desired:
    e.dataTransfer.dropEffect = 'move';  // show move cursor instead of “no‐drop”
    if (el.classList.contains('drag-area')) {
      el.classList.add('over');
    }
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('over');
  });

  el.addEventListener('drop', async e => {
    e.preventDefault();
    el.classList.remove('over');

    // 1) Grab the ID that was set on dragstart
    const id = e.dataTransfer.getData('text/plain');
    console.log(`→ drop: id="${id}" status="${status}"`);

    if (!id) {
      console.warn('Drop ignored: no order ID present');
      return;
    }

    try {
      if (id.startsWith('bundle:')) {
        const name = id.slice(7);
        await window.api.updateBundleStatus(name, status);
      } else {
        await window.api.updateStatus(id, status);
      }
      await renderBoard();
    } catch (err) {
      console.error('Error updating status on drop:', err);
    }
  });
}

function setupDropZones() {
  // Order Pipeline → you can drop back as ‘received’
  makeDropZone(document.getElementById('col-received'), 'received');
  // Drag area itself ⇒ toOrder
  const dragArea = document.getElementById('col-toOrder');
  makeDropZone(dragArea, 'toOrder');
  // Blanks Ordered
  makeDropZone(document.getElementById('col-blanks'), 'blanks');
  // Ready To Print
  makeDropZone(document.getElementById('col-print'), 'print');
}

document.addEventListener('DOMContentLoaded', () => {
  // wire up the four zones

  // Submit button
  document.getElementById('order-submit').addEventListener('click', async () => {
    const toOrder = allOrders.filter(x => x.status === 'toOrder').map(x => x.name);
    if (!toOrder.length) {
      return alert('Drag some cards into “Drag cards here” first.');
    }

    const btn = document.getElementById('order-submit');
    btn.textContent = 'Submitting…';
    btn.disabled = true;

    try {
      await window.api.processBatch(toOrder);
      // auto‑move into Blanks Ordered
      for (const id of toOrder) {
        await window.api.updateStatus(id, 'blanks');
      }
      await renderBoard();
      btn.textContent = '✅ Submitted';

      setTimeout(() => {
        btn.textContent = 'Submit To S&S';
      }, 3000);

    } catch (err) {
      btn.textContent = `❌ ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  const clearBtn = document.getElementById('clear-picked');
  if (!clearBtn) {
    console.warn('⚠️ #clear-picked button not found');
  } else {
    clearBtn.addEventListener('click', async () => {
      // grab all currently “toOrder”
      const toOrder = allOrders
        .filter(o => o.status === 'toOrder')
        .map(o => o.name);
      if (!toOrder.length) return;           // nothing to clear

      clearBtn.disabled = true;
      // move each back to “received”
      for (const id of toOrder) {
        await window.api.updateStatus(id, 'received');
      }
      await renderBoard();
      clearBtn.disabled = false;
    });
  }

  const fsBtn = document.getElementById('blanks-fullscreen-btn');
  const blanksSection = document.getElementById('blanks-section');
  const blanksOverlay = document.getElementById('blanks-overlay');
  if (fsBtn && blanksSection && blanksOverlay) {
    fsBtn.addEventListener('click', () => {
      blanksOverlay.classList.remove('hidden');
      blanksSection.classList.add('fullscreen');
    });
    blanksOverlay.addEventListener('click', (e) => {
      if (e.target === blanksOverlay) {
        blanksOverlay.classList.add('hidden');
        blanksSection.classList.remove('fullscreen');
      }
    });
  }

  const printFsBtn = document.getElementById('print-fullscreen-btn');
  const printSection = document.getElementById('print-section');
  const printOverlay = document.getElementById('print-overlay');
  if (printFsBtn && printSection && printOverlay) {
    printFsBtn.addEventListener('click', () => {
      printOverlay.classList.remove('hidden');
      printSection.classList.add('fullscreen');
    });
    printOverlay.addEventListener('click', (e) => {
      if (e.target === printOverlay) {
        printOverlay.classList.add('hidden');
        printSection.classList.remove('fullscreen');
      }
    });
  }

  // Bundle buttons
  const bundleConfigs = [
    { start: 'received-bundle-start', confirm: 'received-bundle-confirm', cancel: 'received-bundle-cancel', status: 'received' },
    { start: 'blanks-bundle-start', confirm: 'blanks-bundle-confirm', cancel: 'blanks-bundle-cancel', status: 'blanks' },
    { start: 'print-bundle-start', confirm: 'print-bundle-confirm', cancel: 'print-bundle-cancel', status: 'print' }
  ];
  bundleConfigs.forEach(cfg => {
    const s = document.getElementById(cfg.start);
    const c = document.getElementById(cfg.confirm);
    const x = document.getElementById(cfg.cancel);
    if (!s || !c || !x) return;
    s.addEventListener('click', () => {
      startBundle(cfg.status);
      s.classList.add('hidden');
      c.classList.remove('hidden');
      x.classList.remove('hidden');
    });
    x.addEventListener('click', () => {
      cancelBundle();
      s.classList.remove('hidden');
      c.classList.add('hidden');
      x.classList.add('hidden');
    });
    c.addEventListener('click', async () => {
      const name = await promptBundleName();
      if (name) {
        await confirmBundle(name);
      } else {
        cancelBundle();
      }
      s.classList.remove('hidden');
      c.classList.add('hidden');
      x.classList.add('hidden');
    });
  });

  setupDropZones();
  renderBoard();
});
