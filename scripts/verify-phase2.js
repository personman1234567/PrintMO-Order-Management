const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

function jwt(secret, payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function shopifyNode() {
  return {
    id: 'gid://shopify/Order/60129381',
    name: '#1001',
    createdAt: '2026-07-20T15:30:00Z',
    updatedAt: '2026-07-22T14:05:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    cancelledAt: null,
    currencyCode: 'USD',
    currentSubtotalLineItemsQuantity: 2,
    currentSubtotalPriceSet: { shopMoney: { amount: '20.00', currencyCode: 'USD' } },
    currentTotalPriceSet: { shopMoney: { amount: '21.60', currencyCode: 'USD' } },
    customer: { displayName: 'Fixture Customer' },
    lineItems: {
      nodes: [{
        id: 'gid://shopify/LineItem/101', sku: 'B001', title: 'Fixture Shirt', variantTitle: 'Black / M',
        quantity: 2, currentQuantity: 2, variant: { id: 'gid://shopify/ProductVariant/201' },
        originalUnitPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } }
      }],
      pageInfo: { hasNextPage: false, endCursor: null }
    }
  };
}

async function run() {
  console.log('=== Running Phase 2 Shadow Data Plane Verification ===');
  await require('./verify-phase1.js').run();

  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'order-manager-proxy', 'worker.js'), 'utf8');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const worker = module.default;
  assert.equal(typeof module.OrderSyncCoordinator, 'function', 'Durable Object coordinator must be exported');

  const secret = 'phase2-test-secret';
  const now = Math.floor(Date.now() / 1000);
  const authToken = jwt(secret, {
    iss: 'https://printmo-test.myshopify.com/admin', dest: 'https://printmo-test.myshopify.com',
    aud: 'phase2-client', sub: 'partner-1', iat: now, nbf: now - 1, exp: now + 60
  });
  const env = {
    SHOPIFY_API_KEY: 'phase2-client', SHOPIFY_API_SECRET: secret,
    SHOPIFY_SHOP_DOMAIN: 'printmo-test.myshopify.com', PARTNER_USER_IDS: 'partner-1',
    UPSTREAM_BASE: 'https://render.example.test', ORDER_MANAGER_ADMIN_KEY: 'render-admin-key',
    R2_BUCKET: {
      async get(key) {
        if (key !== 'orders/60129381/assets/asset-1/art.png') return null;
        return {
          body: 'private-artwork', httpEtag: 'etag-1',
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png'); }
        };
      }
    }
  };
  const headers = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
  const production = {
    id: 'gid://shopify/Order/60129381', stage: 'received', version: 1,
    createdAt: '2026-07-20T15:30:00Z', bundleId: null, blanksPo: [], printedCount: 0,
    blanksStatus: 0, printsStatus: 0, printsOrdered: 0, internalNotes: '', assets: []
  };
  let storedSummary = null;
  const calls = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith('/admin/oauth/access_token')) {
      return Response.json({ access_token: 'runtime-token', expires_in: 86399 });
    }
    if (target.endsWith('/webhooks/orders/paid')) return new Response('Queued', { status: 200 });
    if (target.includes('/graphql.json')) {
      const request = JSON.parse(options.body);
      if (request.query.includes('PrintMOOrderSummaries')) {
        return new Response(JSON.stringify({
          data: { nodes: [shopifyNode()] },
          extensions: { cost: { requestedQueryCost: 21, actualQueryCost: 12, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 988, restoreRate: 50 } } }
        }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Shopify-API-Version': '2026-07' } });
      }
      if (request.query.includes('PrintMOOrderSearch')) {
        return Response.json({ data: { orders: { nodes: [{ id: shopifyNode().id, name: '#1001' }] } } });
      }
      throw new Error(`Unexpected GraphQL operation: ${request.operationName}`);
    }
    if (target.includes('/order-manager/v1/data/orders?')) {
      return Response.json({ records: [{ gid: shopifyNode().id, production, summary: storedSummary }], total: 1, nextOffset: null });
    }
    if (target.endsWith('/order-manager/v1/data/cache/summaries')) {
      storedSummary = JSON.parse(options.body).summaries[0];
      return Response.json({ ok: true, count: 1 });
    }
    if (target.endsWith('/order-manager/v1/data/webhooks/dedupe')) return Response.json({ accepted: true });
    if (target.endsWith('/order-manager/v1/data/project') || target.endsWith('/order-manager/v1/data/mappings') || target.endsWith('/order-manager/v1/data/cache/dirty')) return Response.json({ ok: true });
    if (target.includes('/order-manager/v1/data/orders/60129381/production')) return Response.json({ ok: true, version: 2, production: { ...production, version: 2, stage: 'to_order' } });
    if (target.includes('/order-manager/v1/data/assets/asset-1')) return Response.json({ assetId: 'asset-1', objectKey: 'orders/60129381/assets/asset-1/art.png' });
    if (target.endsWith('/order-manager/v1/data/parity')) return Response.json({ checkedAt: new Date().toISOString(), unexplainedMismatchCount: 0, parityStatus: 'PASSED' });
    if (target.includes('/order-manager/v1/data/legacy?')) return Response.json({ records: [], total: 0, nextOffset: null });
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const webhookBody = JSON.stringify({ id: '60129381', admin_graphql_api_id: shopifyNode().id, name: '#1001', order_number: 1001 });
    const hmac = crypto.createHmac('sha256', secret).update(webhookBody).digest('base64');
    let background = null;
    const webhook = await worker.fetch(new Request('https://worker.test/order-manager/v1/webhooks/shopify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': hmac,
        'X-Shopify-Webhook-Id': 'delivery-1', 'X-Shopify-Topic': 'orders/paid',
        'X-Shopify-Shop-Domain': 'printmo-test.myshopify.com'
      },
      body: webhookBody
    }), env, { waitUntil(promise) { background = promise; } });
    assert.equal(webhook.status, 200, 'valid webhook HMAC must be accepted without bearer auth');
    if (background) await background;
    assert(calls.some(call => call.target.endsWith('/webhooks/orders/paid')), 'paid webhooks must preserve legacy queue ingestion during shadow mode');

    const invalidWebhook = await worker.fetch(new Request('https://worker.test/order-manager/v1/webhooks/shopify', {
      method: 'POST', headers: { 'X-Shopify-Hmac-Sha256': 'invalid', 'X-Shopify-Webhook-Id': 'delivery-2' }, body: webhookBody
    }), env);
    assert.equal(invalidWebhook.status, 401, 'invalid webhook HMAC must be rejected');

    const board = await worker.fetch(new Request('https://worker.test/order-manager/v1/orders?stage=received', { headers }), env);
    assert.equal(board.status, 200, 'board endpoint must return a merged v1 DTO');
    const boardJson = await board.json();
    assert.equal(boardJson.data[0].id, shopifyNode().id);
    assert.equal(boardJson.data[0].commerce.lineItems[0].currentQuantity, 2);
    assert.equal(boardJson.data[0].production.stage, 'received');
    assert.equal(boardJson.data[0].sync.stale, false);

    const mutation = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: 1, patch: { stage: 'to_order' }, idempotencyKey: 'mutation-1' })
    }), env);
    assert.equal(mutation.status, 200, 'versioned production mutation must use the Render CAS adapter');

    const ticketResponse = await worker.fetch(new Request('https://worker.test/order-manager/v1/assets/asset-1/read-ticket', { method: 'POST', headers }), env);
    assert.equal(ticketResponse.status, 200, 'asset read ticket must be issued');
    const ticket = await ticketResponse.json();
    assert.equal(ticket.expiresIn, 60);
    assert(!JSON.stringify(ticket).includes('orders/60129381'), 'R2 object key must not be exposed in the ticket response');
    const asset = await worker.fetch(new Request(`https://worker.test${ticket.url}`, { headers }), env);
    assert.equal(asset.status, 200, 'valid one-minute asset ticket must read private R2 content');

    const parity = await worker.fetch(new Request('https://worker.test/order-manager/v1/parity/check', { method: 'POST', headers }), env);
    assert.equal(parity.status, 200);
    assert.equal((await parity.json()).parityStatus, 'PASSED');

    const migration = await worker.fetch(new Request('https://worker.test/order-manager/v1/migration/run', {
      method: 'POST', headers, body: JSON.stringify({ execute: false, offset: 0, limit: 10 })
    }), env);
    assert.equal(migration.status, 200, 'dry-run migration must be available');
    assert.equal((await migration.json()).execute, false);

    const unsafeMigration = await worker.fetch(new Request('https://worker.test/order-manager/v1/migration/run', {
      method: 'POST', headers, body: JSON.stringify({ execute: true, offset: 0, limit: 1 })
    }), env);
    assert.equal(unsafeMigration.status, 400, 'executing migration must require an exact shop confirmation');

    assert(calls.some(call => call.target.endsWith('/admin/oauth/access_token')), 'Worker must exchange client credentials for a runtime token');
    assert(calls.some(call => call.target.includes('/graphql.json')), 'Worker must query Shopify GraphQL');
    assert(!source.includes('SHOPIFY_ACCESS_TOKEN'), 'Worker must not depend on a static Shopify access token');
  } finally {
    globalThis.fetch = nativeFetch;
  }

  const migrationTool = require('./run-shadow-migration.js');
  const opts = migrationTool.parseArgs(['--dry-run', '--shop', 'printmo-test.myshopify.com', '--env', 'production']);
  assert.equal(opts.execute, false);
  assert.equal(opts.dryRun, true);
  console.log('Phase 2 shadow data plane verification passed.');
}

if (require.main === module) run().catch(error => { console.error(error); process.exit(1); });
module.exports = { run };
