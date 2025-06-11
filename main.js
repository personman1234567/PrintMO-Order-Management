// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
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

// ─── Redis & Env Setup ───────────────────────────────────────────────────────
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', e => console.error('❌ Redis error', e));
redis.connect().catch(console.error);

const QUEUE_KEY = 'shopifyOrdersQueue';
const {
  SS_ACCOUNT_NUMBER,
  SS_API_KEY,
  SS_PAYMENT_PROFILE_ID,
  SS_PAYMENT_PROFILE_EMAIL
} = process.env;

// ─── IPC: delete order ───────────────────────────────────────────────────
ipcMain.handle('delete-order', async (event, orderName) => {
  // Pull the raw queue
  const raw = await redis.lRange(QUEUE_KEY, 0, -1);
  // Remove each matching entry
  for (const entry of raw) {
    try {
      const rec = JSON.parse(entry);
      if (rec.name === orderName) {
        await redis.lRem(QUEUE_KEY, 1, entry);
      }
    } catch (_) {
      // ignore parse errors
    }
  }
  // no return value needed
});

// ─── IPC: fetch all orders ───────────────────────────────────────────────────
ipcMain.handle('get-queue', async () => {
  const raw = await redis.lRange(QUEUE_KEY, 0, -1);
  const results = [];
  for (let i = 0; i < raw.length; i++) {
    const o = JSON.parse(raw[i]);
    let updated = false;
    if (!o.status) { o.status = 'received'; updated = true; }
    if (typeof o.blanksStatus !== 'number') { o.blanksStatus = 0; updated = true; }
    if (typeof o.printsStatus !== 'number') { o.printsStatus = 0; updated = true; }
    if (updated) {
      await redis.lSet(QUEUE_KEY, i, JSON.stringify(o));
    }
    results.push(o);
  }
  return results;
});

// ─── IPC: update an order’s status ───────────────────────────────────────────
ipcMain.handle('update-status', async (_e, orderId, status) => {
  const raw = await redis.lRange(QUEUE_KEY, 0, -1);
  for (let i = 0; i < raw.length; i++) {
    const o = JSON.parse(raw[i]);
    if (o.name === orderId) {
      o.status = status;
      await redis.lSet(QUEUE_KEY, i, JSON.stringify(o));
      return;
    }
  }
  throw new Error(`Order "${orderId}" not found`);
});

// ─── IPC: update blanks/prints readiness ─────────────────────────────────────
ipcMain.handle('update-ready', async (_e, orderId, blanksStatus, printsStatus) => {
  const raw = await redis.lRange(QUEUE_KEY, 0, -1);
  for (let i = 0; i < raw.length; i++) {
    const o = JSON.parse(raw[i]);
    if (o.name === orderId) {
      o.blanksStatus = blanksStatus;
      o.printsStatus = printsStatus;
      await redis.lSet(QUEUE_KEY, i, JSON.stringify(o));
      return;
    }
  }
  throw new Error(`Order "${orderId}" not found`);
});


// ─── IPC: process only the orders in “To Order” ──────────────────────────────
ipcMain.handle('process-batch', async (_e, orderIds) => {
  if (!Array.isArray(orderIds) || !orderIds.length) {
    throw new Error('No orders to submit');
  }

  // 1) pull queue & parse
  const rawQueue = await redis.lRange(QUEUE_KEY, 0, -1);
  const orders   = rawQueue.map(s => JSON.parse(s));

  // 2) filter to only the selected ones
  const toProcess = orders.filter(o => orderIds.includes(o.name));
  if (!toProcess.length) throw new Error('No matching orders found');

  // 3) aggregate SKUs
  const agg = {};
  toProcess.forEach(o =>
    o.items.forEach(({ sku, qty }) => {
      agg[sku] = (agg[sku] || 0) + qty;
    })
  );

  // 4) fetch prices & compute subtotal
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

  // 5) build payload
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

  // 6) send to S&S
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
