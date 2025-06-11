// renderer.js

let allOrders = [];

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

function openDetail(o) {
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
  recs.forEach(o => recEl.appendChild(makeCard(o, 'pipeline')));
  document.getElementById('pipeline-count').textContent = recs.length;

  // ToOrder picks
  const picks = allOrders.filter(o => o.status === 'toOrder');
  const pickedEl = document.getElementById('picked-cards');
  pickedEl.innerHTML = '';
  picks.forEach(o => pickedEl.appendChild(makeCard(o, 'picked')));
  updateSummary();

  // Blanks Ordered
  const blanksEl = document.getElementById('col-blanks');
  blanksEl.innerHTML = '';
  allOrders.filter(x => x.status === 'blanks')
           .forEach(o => blanksEl.appendChild(makeCard(o, 'pipeline')));

  // Ready To Print
  const printEl = document.getElementById('col-print');
  printEl.innerHTML = '';
  allOrders.filter(x => x.status === 'print')
           .forEach(o => printEl.appendChild(makeCard(o, 'pipeline')));
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

    // 2) Bail if it's empty (no point in calling updateStatus)
    if (!id) {
      console.warn('Drop ignored: no order ID present');
      return;
    }

    // 3) Proceed with your normal update + re-render
    try {
      await window.api.updateStatus(id, status);
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

  setupDropZones();
  renderBoard();
});
