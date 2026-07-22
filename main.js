// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

let envPath;
if (app.isPackaged) {
  // after dist, .env lives in resources/
  envPath = path.join(process.resourcesPath, '.env');
} else {
  // during dev, your .env is in the project root
  envPath = path.join(__dirname, '.env');
}

console.log(`Loading environment from ${envPath}`);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn(`No .env found at ${envPath}, skipping dotenv.`);
}

const { createClient } = require('redis');
const fetch = require('node-fetch');

function safeDownloadName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

// ─── Worker API & Redis Transport Configuration ──────────────────────────────
const WORKER_API_URL = (process.env.WORKER_API_URL || '').replace(/\/+$/, '');
const REDIS_URL = process.env.REDIS_URL;

let redis = null;
if (REDIS_URL && !WORKER_API_URL) {
  const { createClient } = require('redis');
  redis = createClient({ url: REDIS_URL });
  redis.on('error', e => console.error('❌ Redis error', e));
  redis.connect().catch(console.error);
} else if (WORKER_API_URL) {
  console.log(`[Main] Worker API transport active: ${WORKER_API_URL}`);
}

async function workerFetch(endpoint, options = {}) {
  const url = `${WORKER_API_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Worker API (${endpoint}) failed (${res.status}): ${errText}`);
  }
  return res.json();
}

const QUEUE_KEY = 'shopifyOrdersQueue';
const {
  SS_ACCOUNT_NUMBER,
  SS_API_KEY,
  SS_PAYMENT_PROFILE_ID,
  SS_PAYMENT_PROFILE_EMAIL
} = process.env;

const queueIndexByOrderName = new Map();
const queueBundleIndex = new Map();
let queueIndexReady = false;
let queueMutationChain = Promise.resolve();

/**
 * Keep older queue records compatible in one place so every read and indexed
 * mutation works against the same shape.
 * @param {Record<string, any>} order - Parsed Redis order record.
 * @returns {boolean} Whether defaults were added and the record should be written back.
 */
function normalizeQueueOrder(order) {
  let updated = false;
  if (!order.status) { order.status = 'received'; updated = true; }
  if (typeof order.blanksStatus !== 'number') { order.blanksStatus = 0; updated = true; }
  if (typeof order.printsStatus !== 'number') { order.printsStatus = 0; updated = true; }
  if (typeof order.blanksOrdered !== 'number') { order.blanksOrdered = 0; updated = true; }
  if (typeof order.printsOrdered !== 'number') { order.printsOrdered = 0; updated = true; }
  if (typeof order.bundle !== 'string') { order.bundle = ''; updated = true; }
  if (!Array.isArray(order.attachments)) { order.attachments = []; updated = true; }
  if (typeof order.notes !== 'string') { order.notes = ''; updated = true; }
  if (typeof order.progress !== 'number') { order.progress = 0; updated = true; }
  return updated;
}

function addOrderToBundleIndex(orderName, bundleName) {
  if (!bundleName) return;
  if (!queueBundleIndex.has(bundleName)) {
    queueBundleIndex.set(bundleName, new Set());
  }
  queueBundleIndex.get(bundleName).add(orderName);
}

function removeOrderFromBundleIndex(orderName, bundleName) {
  if (!bundleName || !queueBundleIndex.has(bundleName)) return;
  const names = queueBundleIndex.get(bundleName);
  names.delete(orderName);
  if (!names.size) {
    queueBundleIndex.delete(bundleName);
  }
}

function indexQueueOrder(order, index) {
  if (!order || typeof order.name !== 'string') return;
  queueIndexByOrderName.set(order.name, index);
  addOrderToBundleIndex(order.name, order.bundle);
}

function updateIndexedOrderMetadata(previous, next, index) {
  if (!previous || !next) return;
  if (previous.name !== next.name) {
    queueIndexByOrderName.delete(previous.name);
    queueIndexByOrderName.set(next.name, index);
    removeOrderFromBundleIndex(previous.name, previous.bundle);
    addOrderToBundleIndex(next.name, next.bundle);
    return;
  }
  queueIndexByOrderName.set(next.name, index);
  if (previous.bundle !== next.bundle) {
    removeOrderFromBundleIndex(next.name, previous.bundle);
    addOrderToBundleIndex(next.name, next.bundle);
  }
}

function shiftQueueIndexAfterDelete(deletedIndex, deletedOrder) {
  if (deletedOrder) {
    queueIndexByOrderName.delete(deletedOrder.name);
    removeOrderFromBundleIndex(deletedOrder.name, deletedOrder.bundle);
  }
  for (const [name, index] of queueIndexByOrderName.entries()) {
    if (index > deletedIndex) {
      queueIndexByOrderName.set(name, index - 1);
    }
  }
}

/**
 * Rebuild the Redis list index from a single LRANGE. Indexed mutations avoid a
 * full scan unless this cache is missing or a verified list position no longer
 * contains the expected order.
 * @param {{normalizeRecords?: boolean}} [options]
 * @returns {Promise<Array<Record<string, any>>>} Parsed orders in queue order.
 */
async function rebuildQueueIndex(options = {}) {
  const { normalizeRecords = false } = options;
  const raw = await redis.lRange(QUEUE_KEY, 0, -1);
  const results = [];
  queueIndexByOrderName.clear();
  queueBundleIndex.clear();

  for (let i = 0; i < raw.length; i++) {
    const order = JSON.parse(raw[i]);
    if (normalizeRecords && normalizeQueueOrder(order)) {
      await redis.lSet(QUEUE_KEY, i, JSON.stringify(order));
    }
    indexQueueOrder(order, i);
    results.push(order);
  }

  queueIndexReady = true;
  return results;
}

async function ensureQueueIndex() {
  if (!queueIndexReady) {
    await rebuildQueueIndex();
  }
}

/**
 * Read one order by indexed list position and verify the cached index before a
 * write. If Redis shifted under us, the index is rebuilt once and retried.
 * @param {string} orderName - Stable order identifier stored in the queue record.
 * @param {boolean} [forceRebuild=false] - Whether to rebuild before this lookup.
 * @returns {Promise<{index: number, raw: string, order: Record<string, any>}|null>}
 */
async function readIndexedQueueOrder(orderName, forceRebuild = false) {
  if (forceRebuild) {
    await rebuildQueueIndex();
  } else {
    await ensureQueueIndex();
  }

  let index = queueIndexByOrderName.get(orderName);
  if (typeof index !== 'number') {
    if (forceRebuild) return null;
    return readIndexedQueueOrder(orderName, true);
  }

  const raw = await redis.lIndex(QUEUE_KEY, index);
  if (raw === null) {
    if (forceRebuild) return null;
    return readIndexedQueueOrder(orderName, true);
  }

  const order = JSON.parse(raw);
  if (order.name !== orderName) {
    if (forceRebuild) return null;
    return readIndexedQueueOrder(orderName, true);
  }

  normalizeQueueOrder(order);
  return { index, raw, order };
}

/**
 * Mutate a single queue record using the cached Redis list index.
 * @param {string} orderName - Order name to resolve through the index.
 * @param {(order: Record<string, any>) => void} mutator - In-place order mutation.
 * @returns {Promise<Record<string, any>>} The updated order record.
 */
async function mutateIndexedQueueOrder(orderName, mutator) {
  const record = await readIndexedQueueOrder(orderName);
  if (!record) {
    throw new Error(`Order "${orderName}" not found`);
  }

  const previous = { name: record.order.name, bundle: record.order.bundle };
  mutator(record.order);
  await redis.lSet(QUEUE_KEY, record.index, JSON.stringify(record.order));
  updateIndexedOrderMetadata(previous, record.order, record.index);
  return record.order;
}

/**
 * Apply the same indexed mutation pattern to a de-duplicated order set.
 * @param {string[]} orderNames - Order names to update.
 * @param {(order: Record<string, any>) => void} mutator - In-place order mutation.
 * @returns {Promise<Array<Record<string, any>>>} Updated records in request order.
 */
async function mutateIndexedQueueOrders(orderNames, mutator) {
  const uniqueNames = Array.from(new Set((orderNames || []).filter(Boolean)));
  const updated = [];
  for (const orderName of uniqueNames) {
    updated.push(await mutateIndexedQueueOrder(orderName, mutator));
  }
  return updated;
}

/**
 * Read a selected set of orders without scanning the whole queue.
 * @param {string[]} orderNames - Order names requested by the renderer.
 * @returns {Promise<Array<Record<string, any>>>} Matching orders that still exist.
 */
async function findIndexedQueueOrders(orderNames) {
  const uniqueNames = Array.from(new Set((orderNames || []).filter(Boolean)));
  const orders = [];
  for (const orderName of uniqueNames) {
    const record = await readIndexedQueueOrder(orderName);
    if (record) {
      orders.push(record.order);
    }
  }
  return orders;
}

/**
 * Serialize queue writes so the in-memory Redis list index cannot be updated by
 * two IPC handlers at the same time.
 * @template T
 * @param {() => Promise<T>} task - Mutation work to run after prior queue writes.
 * @returns {Promise<T>}
 */
function withQueueMutation(task) {
  const run = queueMutationChain.then(task, task);
  queueMutationChain = run.catch(() => {});
  return run;
}

// ─── IPC: resolve an asset path for the renderer ────────────────────────
ipcMain.on('get-asset-path', (event, file) => {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'Assets')
    : path.join(__dirname, 'Assets');
  event.returnValue = path.join(base, file);
});

// ─── IPC: delete order ───────────────────────────────────────────────────
ipcMain.handle('delete-order', async (event, orderName) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/item', {
      method: 'DELETE',
      body: JSON.stringify({ orderName })
    });
  }
  return withQueueMutation(async () => {
    const record = await readIndexedQueueOrder(orderName);
    if (!record) return;

    const tombstone = `__printmo_deleted__:${Date.now()}:${Math.random()}`;
    await redis.lSet(QUEUE_KEY, record.index, tombstone);
    await redis.lRem(QUEUE_KEY, 1, tombstone);
    shiftQueueIndexAfterDelete(record.index, record.order);
  });
});

// ─── IPC: fetch all orders ───────────────────────────────────────────────────
ipcMain.handle('get-queue', async () => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue');
  }
  return withQueueMutation(() => rebuildQueueIndex({ normalizeRecords: true }));
});

// ─── IPC: update an order’s status ───────────────────────────────────────────
ipcMain.handle('update-status', async (_e, orderId, status) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ orderName: orderId, patch: { status } })
    });
  }
  return withQueueMutation(() =>
    mutateIndexedQueueOrder(orderId, order => {
      order.status = status;
    })
  );
});

// ─── IPC: update many order statuses in one indexed write batch ──────────────
ipcMain.handle('update-statuses', async (_e, orderIds, status) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ orderNames: orderIds, patch: { status } })
    });
  }
  return withQueueMutation(async () => {
    const updated = await mutateIndexedQueueOrders(orderIds, order => {
      order.status = status;
    });
    return { count: updated.length };
  });
});

// ─── IPC: update status for all orders in a bundle ──────────────────────────
ipcMain.handle('update-bundle-status', async (_e, bundleName, status) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ bundleName, patch: { status } })
    });
  }
  return withQueueMutation(async () => {
    await ensureQueueIndex();
    let orderNames = Array.from(queueBundleIndex.get(bundleName) || []);
    if (!orderNames.length) {
      await rebuildQueueIndex();
      orderNames = Array.from(queueBundleIndex.get(bundleName) || []);
    }
    const updated = await mutateIndexedQueueOrders(orderNames, order => {
      order.status = status;
    });
    return { count: updated.length };
  });
});

// ─── IPC: update blanks/prints readiness ─────────────────────────────────────
ipcMain.handle('update-ready', async (_e, orderId, blanksStatus, printsStatus, blanksOrdered, printsOrdered) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({
        orderName: orderId,
        patch: { blanksStatus, printsStatus, blanksOrdered, printsOrdered }
      })
    });
  }
  return withQueueMutation(() =>
    mutateIndexedQueueOrder(orderId, order => {
      order.blanksStatus = blanksStatus;
      order.printsStatus = printsStatus;
      if (typeof blanksOrdered === 'number') order.blanksOrdered = blanksOrdered;
      if (typeof printsOrdered === 'number') order.printsOrdered = printsOrdered;
    })
  );
});

// ─── IPC: assign bundle to orders ─────────────────────────────────────────────
ipcMain.handle('set-bundle', async (_e, orderIds, bundleName) => {
  if (!Array.isArray(orderIds)) return;
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ orderNames: orderIds, patch: { bundle: bundleName } })
    });
  }
  return withQueueMutation(async () => {
    const updated = await mutateIndexedQueueOrders(orderIds, order => {
      order.bundle = bundleName;
    });
    return { count: updated.length };
  });
});

// ─── IPC: add attachment to an order ─────────────────────────────────────────
ipcMain.handle('add-file', async (_e, orderId, file) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ orderName: orderId, patch: { addAttachment: file } })
    });
  }
  return withQueueMutation(() =>
    mutateIndexedQueueOrder(orderId, order => {
      if (!Array.isArray(order.attachments)) order.attachments = [];
      order.attachments.push(file);
    })
  );
});

// ─── IPC: remove attachments from an order ───────────────────────────────────
ipcMain.handle('remove-files', async (_e, orderId, names) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ orderName: orderId, patch: { removeAttachmentNames: names } })
    });
  }
  return withQueueMutation(() =>
    mutateIndexedQueueOrder(orderId, order => {
      if (!Array.isArray(order.attachments)) order.attachments = [];
      order.attachments = order.attachments.filter(f => !names.includes(f.name));
    })
  );
});

// ─── IPC: update notes for an order ───────────────────────────────────────────
ipcMain.handle('update-notes', async (_e, orderId, notes) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ orderName: orderId, patch: { notes } })
    });
  }
  return withQueueMutation(() =>
    mutateIndexedQueueOrder(orderId, order => {
      order.notes = notes;
    })
  );
});

// ─── IPC: update customer name for an order ─────────────────────────────────
ipcMain.handle('update-name', async (_e, orderId, newCust) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ orderName: orderId, patch: { custName: newCust } })
    });
  }
  return withQueueMutation(() =>
    mutateIndexedQueueOrder(orderId, order => {
      const [orderNum] = order.name.split(' – ');
      order.name = `${orderNum} – ${newCust}`;
    })
  );
});

// ─── IPC: update progress for an order ───────────────────────────────────────
ipcMain.handle('update-progress', async (_e, orderId, progress) => {
  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/queue/mutate', {
      method: 'POST',
      body: JSON.stringify({ orderName: orderId, patch: { progress } })
    });
  }
  return withQueueMutation(() =>
    mutateIndexedQueueOrder(orderId, order => {
      order.progress = progress;
    })
  );
});

// ─── IPC: process only the orders in “To Order” ──────────────────────────────
ipcMain.handle('process-batch', async (_e, orderIds) => {
  if (!Array.isArray(orderIds) || !orderIds.length) {
    throw new Error('No orders to submit');
  }

  if (WORKER_API_URL) {
    return workerFetch('/order-manager/v1/legacy/ss/batch', {
      method: 'POST',
      body: JSON.stringify({ orderIds })
    });
  }

  // Batch reads should see the queue after any pending indexed writes settle.
  await queueMutationChain.catch(() => {});

  // 1) Pull just the selected orders by indexed Redis list position.
  const toProcess = await findIndexedQueueOrders(orderIds);
  if (!toProcess.length) throw new Error('No matching orders found');

  // 2) aggregate SKUs
  const agg = {};
  toProcess.forEach(o =>
    o.items.forEach(({ sku, qty }) => {
      agg[sku] = (agg[sku] || 0) + qty;
    })
  );

  // 3) fetch prices & compute subtotal
  const auth = 'Basic ' + Buffer
    .from(`${SS_ACCOUNT_NUMBER}:${SS_API_KEY}`)
    .toString('base64');
  let subtotal = 0;
  for (const [sku, qty] of Object.entries(agg)) {
    const res = await fetch(
      `https://api.ssactivewear.com/v2/products/${encodeURIComponent(sku)}?mediatype=json`,
      { headers: { Authorization: auth, Accept: 'application/json' } }
    );
    const js = await res.json();
    subtotal += (js.Price ?? js.price) * qty;
  }
  console.log(`💰 Subtotal: $${subtotal.toFixed(2)}`);

  // 4) build payload
  const payload = {
    customer:            `Batch of ${toProcess.length} orders`,
    testOrder:           true,
    autoSelectWarehouse: true,
    rejectLineErrors:    false,
    shippingAddress: {
      Name:    'LoGo Fishin Attn: TJ Reid',
      Address: '328 Bristlecone Ct S',
      City:    'Saint Charles',
      State:   'MO',
      Zip:     '63304',
      Country: 'USA'
    },
    Lines: Object.entries(agg).map(([Identifier, Qty]) => ({ Identifier, Qty })),
    PaymentProfile: {
      ProfileID: parseInt(SS_PAYMENT_PROFILE_ID, 10),
      Email:     SS_PAYMENT_PROFILE_EMAIL
    }
  };

  // 5) send to S&S
  const resp = await fetch('https://api.ssactivewear.com/v2/orders/', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': auth
    },
    body: JSON.stringify(payload)
  });
  const json = await resp.json();
  const created = json.orders?.[0];
  if (!created?.orderNumber) {
    throw new Error(`Batch failed: ${JSON.stringify(json)}`);
  }

  console.log(`✅ Batch #${created.orderNumber} created for ${toProcess.length} orders`);
  // **NOTE**: we do **not** remove them from Redis here.
  return { orderNumber: created.orderNumber, count: toProcess.length };
});


ipcMain.handle('download-asset', async (_event, url, suggestedName) => {
  const safeName = safeDownloadName((suggestedName || 'order-asset').trim() || 'order-asset');
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: safeName
  });
  if (canceled || !filePath) {
    return { canceled: true };
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch asset (${resp.status})`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  await fs.promises.writeFile(filePath, buffer);
  return { canceled: false, filePath };
});
// ─── Create the window ────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1500,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
