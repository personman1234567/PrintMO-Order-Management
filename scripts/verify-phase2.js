const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DatabaseSync } = require('node:sqlite');

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

function createD1(schema) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  const wrap = (sql, values = []) => ({
    sql,
    values,
    bind(...next) { return wrap(sql, next); },
    async run() {
      const result = sqlite.prepare(sql).run(...values);
      return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
    },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
  });
  return {
    prepare(sql) { return wrap(sql); },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

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
    customer: null,
    shippingAddress: { name: 'Fixture Guest Checkout' },
    billingAddress: { name: 'Fixture Billing Name' },
    lineItems: {
      nodes: [{
        id: 'gid://shopify/LineItem/101', sku: 'B001', title: 'Fixture Shirt', variantTitle: 'Black / M',
        quantity: 2, currentQuantity: 2, variant: { id: 'gid://shopify/ProductVariant/201' },
        originalUnitPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } },
        customAttributes: [
          { key: '_designref', value: 'fixture-design-ref' },
          { key: 'design_preview_url', value: 'https://designer.example.test/previews/2026-07-20/fixture-design-ref/mockup_side.png' },
        ],
      }],
      pageInfo: { hasNextPage: false, endCursor: null }
    }
  };
}

function shopifyDetailNode() {
  return {
    ...shopifyNode(),
    processedAt: '2026-07-20T15:31:00Z', closedAt: null, cancelReason: null,
    note: 'Fixture note', tags: ['priority'], test: false, sourceName: 'web',
    email: 'fixture@example.com', phone: '555-0100', customerLocale: 'en-US',
    customer: { id: 'gid://shopify/Customer/301', displayName: 'Fixture Customer', email: 'fixture@example.com', phone: '555-0100' },
    shippingAddress: { name: 'Fixture Customer', address1: '123 Main St', city: 'Austin', provinceCode: 'TX', zip: '78701', country: 'United States', countryCodeV2: 'US' },
    billingAddress: null,
    fullyPaid: true, unpaid: false,
    currentShippingPriceSet: { shopMoney: { amount: '1.00', currencyCode: 'USD' } },
    currentTotalDiscountsSet: { shopMoney: { amount: '2.00', currencyCode: 'USD' } },
    currentTotalTaxSet: { shopMoney: { amount: '2.60', currencyCode: 'USD' } },
    totalReceivedSet: { shopMoney: { amount: '21.60', currencyCode: 'USD' } },
    totalRefundedSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
    totalOutstandingSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
    paymentGatewayNames: ['shopify_payments'],
    transactions: [{ id: 'gid://shopify/OrderTransaction/1', kind: 'SALE', status: 'SUCCESS', formattedGateway: 'Shopify Payments', createdAt: '2026-07-20T15:31:00Z', processedAt: '2026-07-20T15:31:01Z', test: false, errorCode: null, amountSet: { shopMoney: { amount: '21.60', currencyCode: 'USD' } } }],
    shippingLines: { nodes: [{ id: 'gid://shopify/ShippingLine/1', title: 'Standard', code: 'Standard', source: 'shopify', deliveryCategory: 'SHIPPING', custom: false, originalPriceSet: { shopMoney: { amount: '1.00', currencyCode: 'USD' } }, currentDiscountedPriceSet: { shopMoney: { amount: '1.00', currencyCode: 'USD' } }, discountAllocations: [] }] },
    fulfillmentOrders: { nodes: [{ id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN', requestStatus: 'UNSUBMITTED', fulfillAt: null, fulfillBy: null, deliveryMethod: { id: 'gid://shopify/DeliveryMethod/1', methodType: 'SHIPPING', presentedName: 'Standard', serviceCode: 'Standard', minDeliveryDateTime: null, maxDeliveryDateTime: null } }] },
    fulfillments: [],
    customerJourneySummary: { ready: true, customerOrderIndex: 2, daysToConversion: 1, firstVisit: { id: 'gid://shopify/CustomerVisit/1', occurredAt: '2026-07-19T12:00:00Z', source: 'Google', sourceDescription: 'Google', sourceType: 'SEARCH', landingPage: 'https://print-mo.com/products/fixture', referrerUrl: 'https://google.com', referralCode: null }, lastVisit: null },
    discountApplications: { nodes: [{ __typename: 'DiscountCodeApplication', allocationMethod: 'ACROSS', targetSelection: 'ALL', targetType: 'LINE_ITEM', code: 'FIXTURE', value: { __typename: 'MoneyV2', amount: '2.00', currencyCode: 'USD' } }] },
    events: { nodes: [{ __typename: 'BasicEvent', id: 'gid://shopify/BasicEvent/1', createdAt: '2026-07-20T15:31:00Z', criticalAlert: false, message: 'Order was created', action: 'create', appTitle: null, author: 'Fixture Customer', secondaryMessage: null }] },
    lineItems: {
      nodes: [{
        ...shopifyNode().lineItems.nodes[0], vendor: 'Fixture Vendor', unfulfilledQuantity: 2, requiresShipping: true,
        customAttributes: [{ key: 'Print Location', value: 'Front' }],
        originalTotalSet: { shopMoney: { amount: '20.00', currencyCode: 'USD' } },
        totalDiscountSet: { shopMoney: { amount: '2.00', currencyCode: 'USD' } },
        priceAfterAllDiscountsBeforeTaxesSet: { shopMoney: { amount: '18.00', currencyCode: 'USD' } },
        discountAllocations: [{ allocatedAmountSet: { shopMoney: { amount: '2.00', currencyCode: 'USD' } } }]
      }],
      pageInfo: { hasNextPage: true, endCursor: 'detail-page-1' }
    }
  };
}

async function run() {
  console.log('=== Running Phase 2 Shadow Data Plane Verification ===');
  await require('./verify-phase1.js').run();

  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'order-manager-proxy', 'worker.js'), 'utf8');
  const schema = ['0001_redis_free.sql', '0002_designer_asset_metadata.sql']
    .map(file => fs.readFileSync(path.join(root, 'order-manager-proxy', 'migrations', file), 'utf8'))
    .join('\n');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const worker = module.default;
  assert.equal(typeof module.OrderSyncCoordinator, 'function', 'Durable Object coordinator must be exported');

  const secret = 'phase2-test-secret';
  const now = Math.floor(Date.now() / 1000);
  const authToken = jwt(secret, {
    iss: 'https://printmo-test.myshopify.com/admin', dest: 'https://printmo-test.myshopify.com',
    aud: 'phase2-client', sub: 'partner-1', iat: now, nbf: now - 1, exp: now + 60
  });
  const designerSourceKey = 'orders/1001_fixture-customer/fixture-design-ref/mockup_side.png';
  const designerBytes = new TextEncoder().encode('designer-studio-preview');
  const privateObjects = new Map([
    ['orders/60129381/assets/asset-1/art.png', { bytes: new TextEncoder().encode('private-artwork'), contentType: 'image/png' }],
  ]);
  const r2Object = (record) => record ? {
    body: record.bytes,
    size: record.bytes.byteLength,
    httpEtag: 'fixture-etag',
    async arrayBuffer() {
      return record.bytes.buffer.slice(record.bytes.byteOffset, record.bytes.byteOffset + record.bytes.byteLength);
    },
    writeHttpMetadata(headers) { headers.set('Content-Type', record.contentType); },
  } : null;
  const env = {
    SHOPIFY_API_KEY: 'phase2-client', SHOPIFY_API_SECRET: secret,
    SHOPIFY_SHOP_DOMAIN: 'printmo-test.myshopify.com', PARTNER_USER_IDS: 'partner-1',
    UPSTREAM_BASE: 'https://render.example.test', ORDER_MANAGER_ADMIN_KEY: 'render-admin-key',
    MIGRATION_UPSTREAM_ENABLED: '1',
    ORDER_DB: createD1(schema),
    PREVIEWS: {
      async head(key) { return key === designerSourceKey ? { key, size: designerBytes.byteLength } : null; },
      async get(key) { return key === designerSourceKey ? r2Object({ bytes: designerBytes, contentType: 'image/png' }) : null; },
      async list({ prefix }) {
        return {
          objects: designerSourceKey.startsWith(prefix) ? [{ key: designerSourceKey, size: designerBytes.byteLength }] : [],
          truncated: false,
          cursor: null,
        };
      },
    },
    R2_BUCKET: {
      async put(key, bytes, options = {}) {
        privateObjects.set(key, {
          bytes: new Uint8Array(bytes),
          contentType: options.httpMetadata?.contentType || 'application/octet-stream',
        });
      },
      async get(key) { return r2Object(privateObjects.get(key)); },
    }
  };
  const headers = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
  let productionState = {
    schemaVersion: 1, revision: 1, lastMutationId: null, stage: 'received',
    readiness: { blanksReady: false, printsOrdered: false, printsReady: false },
    printedCount: 0, bundleId: null, batchRefs: [], internalNotes: '',
    attention: { required: false, reasons: [], acknowledgedAt: null },
    archivedAt: null, archivedBy: null, updatedAt: '2026-07-20T15:30:00Z', updatedBy: 'fixture'
  };
  let productionDigest = 'digest-1';
  let failBootstrap = false;
  let holdSummaryRefresh = false;
  let heldSummaryRefresh = Promise.resolve();
  const calls = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith('/admin/oauth/access_token')) {
      return Response.json({ access_token: 'runtime-token', expires_in: 86399 });
    }
    if (target.includes('/graphql.json')) {
      const request = JSON.parse(options.body);
      if (request.query.includes('PrintMOProductionState')) {
        return Response.json({
          data: {
            order: {
              id: shopifyNode().id,
              name: shopifyNode().name,
              createdAt: shopifyNode().createdAt,
              updatedAt: shopifyNode().updatedAt,
              metafield: {
                id: 'gid://shopify/Metafield/1',
                namespace: 'app--fixture--printmo',
                key: 'production_state_v1',
                value: JSON.stringify(productionState),
                compareDigest: productionDigest,
                updatedAt: productionState.updatedAt,
              },
            },
          },
        });
      }
      if (request.query.includes('PrintMOSetProductionState')) {
        productionState = JSON.parse(request.variables.metafields[0].value);
        productionDigest = `digest-${productionState.revision}`;
        return Response.json({
          data: {
            metafieldsSet: {
              metafields: [{
                id: 'gid://shopify/Metafield/1',
                namespace: 'app--fixture--printmo',
                key: 'production_state_v1',
                value: JSON.stringify(productionState),
                compareDigest: productionDigest,
                updatedAt: productionState.updatedAt,
              }],
              userErrors: [],
            },
          },
        });
      }
      if (request.query.includes('PrintMOShopifyPreviewOrderDetail')) {
        return new Response(JSON.stringify({ data: { order: shopifyDetailNode() } }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Shopify-API-Version': '2026-07' } });
      }
      if (request.query.includes('PrintMOShopifyPreviewOrderLineItems')) {
        return Response.json({ data: { order: { lineItems: { nodes: [{
          id: 'gid://shopify/LineItem/102', sku: 'B002', title: 'Second Fixture Shirt', variantTitle: 'White / L', vendor: 'Fixture Vendor', quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1, requiresShipping: true,
          customAttributes: [], variant: { id: 'gid://shopify/ProductVariant/202' },
          originalUnitPriceSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } }, originalTotalSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } },
          totalDiscountSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } }, priceAfterAllDiscountsBeforeTaxesSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } }, discountAllocations: []
        }], pageInfo: { hasNextPage: false, endCursor: null } } } } });
      }
      if (request.query.includes('PrintMOBootstrapOrders')) {
        if (failBootstrap) {
          return Response.json({
            data: null,
            errors: [{ message: 'Fixture bootstrap failure', extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
          });
        }
        return Response.json({
          data: {
            orders: {
              nodes: [{
                id: shopifyNode().id,
                name: shopifyNode().name,
                createdAt: shopifyNode().createdAt,
                updatedAt: shopifyNode().updatedAt,
                displayFinancialStatus: 'PAID',
                metafield: {
                  id: 'gid://shopify/Metafield/1',
                  namespace: 'app--fixture--printmo',
                  key: 'production_state_v1',
                  value: JSON.stringify(productionState),
                  compareDigest: productionDigest,
                  updatedAt: productionState.updatedAt,
                },
              }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
          extensions: { cost: { requestedQueryCost: 12, actualQueryCost: 7, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 981, restoreRate: 50 } } },
        });
      }
      if (request.query.includes('PrintMOShopifyPreviewOrders')) {
        return new Response(JSON.stringify({
          data: { orders: { nodes: [shopifyNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
          extensions: { cost: { requestedQueryCost: 12, actualQueryCost: 7, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 981, restoreRate: 50 } } }
        }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Shopify-API-Version': '2026-07' } });
      }
      if (request.query.includes('PrintMOOrderSummaries')) {
        if (holdSummaryRefresh) await heldSummaryRefresh;
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
    if (target.endsWith('/order-manager/v1/supplier/ss/commit')) {
      const request = JSON.parse(options.body);
      assert.deepEqual(request.lines, [{ sku: 'B001', qty: 2 }]);
      return Response.json({
        ok: true,
        orderNumber: 'SS-9001',
        count: 1,
        subtotal: 8.5,
        skuCount: 1,
        testOrder: true,
      });
    }
    if (target.includes('/order-manager/v1/data/legacy?')) return Response.json({ records: [], total: 0, nextOffset: null });
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    failBootstrap = true;
    const failedBootstrap = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders', { headers }),
      { ...env, ORDER_DB: createD1(schema) }
    );
    failBootstrap = false;
    assert.equal(failedBootstrap.status, 503, 'a failed initial Shopify read must not look like an empty board');
    assert.equal((await failedBootstrap.json()).error.code, 'BOARD_NOT_INITIALIZED');

    const bootstrappedBoard = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders', { headers }),
      env
    );
    assert.equal(bootstrappedBoard.status, 200, 'an empty projection must perform one bounded Shopify bootstrap');
    assert.equal((await bootstrappedBoard.json()).data[0].id, shopifyNode().id);
    const bootstrapCheckpoint = await env.ORDER_DB.prepare(
      `SELECT checkpoint FROM reconciliation_checkpoints WHERE name = 'bootstrap'`
    ).first();
    assert(bootstrapCheckpoint?.checkpoint, 'successful initial Shopify read must record a bootstrap checkpoint');

    await env.ORDER_DB.prepare(`
      UPDATE order_projection
      SET stale_at = ?
      WHERE order_gid = ?
    `).bind(new Date().toISOString(), shopifyNode().id).run();
    let releaseHeldSummaryRefresh;
    heldSummaryRefresh = new Promise(resolve => { releaseHeldSummaryRefresh = resolve; });
    holdSummaryRefresh = true;
    const staleRefreshTasks = [];
    const fastStaleBoard = await Promise.race([
      worker.fetch(
        new Request('https://worker.test/order-manager/v1/orders', { headers }),
        env,
        { waitUntil(promise) { staleRefreshTasks.push(promise); } }
      ),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('ordinary stale board read waited for Shopify instead of returning D1')),
        1000
      )),
    ]);
    assert.equal(fastStaleBoard.status, 200, 'an initialized stale board must return its D1 projection immediately');
    assert.equal((await fastStaleBoard.json()).data[0].sync.stale, true, 'the immediate projection must honestly report stale commerce');
    assert(staleRefreshTasks.length > 0, 'stale commerce refresh must be registered as background work');
    holdSummaryRefresh = false;
    releaseHeldSummaryRefresh();
    await Promise.all(staleRefreshTasks);

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
    assert(!calls.some(call => call.target.endsWith('/webhooks/orders/paid')), 'candidate webhooks must not write the legacy Redis queue');

    const invalidWebhook = await worker.fetch(new Request('https://worker.test/order-manager/v1/webhooks/shopify', {
      method: 'POST', headers: { 'X-Shopify-Hmac-Sha256': 'invalid', 'X-Shopify-Webhook-Id': 'delivery-2' }, body: webhookBody
    }), env);
    assert.equal(invalidWebhook.status, 401, 'invalid webhook HMAC must be rejected');

    let assetBackfill = null;
    const board = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders?stage=received', { headers }),
      env,
      { waitUntil(promise) { assetBackfill = promise; } }
    );
    assert.equal(board.status, 200, 'board endpoint must return a merged v1 DTO');
    const boardJson = await board.json();
    assert.equal(boardJson.data[0].id, shopifyNode().id);
    assert.equal(boardJson.data[0].commerce.lineItems[0].currentQuantity, 2);
    assert.equal(boardJson.data[0].commerce.lineItems[0].customAttributes[0].key, '_designref');
    assert.equal(boardJson.data[0].production.stage, 'received');
    assert.equal(boardJson.data[0].production.assets.length, 1, 'Designer Studio preview must be imported into the private asset manifest');
    assert.equal(boardJson.data[0].production.assets[0].role, 'mockup');
    assert.equal(boardJson.data[0].production.assets[0].lineItemId, 'gid://shopify/LineItem/101');
    assert(!JSON.stringify(boardJson.data[0].production.assets).includes('orders/60129381/assets/'), 'board DTO must not expose private R2 object keys');
    assert.equal(boardJson.data[0].sync.stale, false);
    assert.equal(boardJson.data[0].customer.displayName, 'Fixture Guest Checkout', 'guest checkout must fall back to the Shopify shipping name');
    if (assetBackfill) await assetBackfill;
    const assetCheckpoint = await env.ORDER_DB.prepare(
      `SELECT checkpoint FROM reconciliation_checkpoints WHERE name = 'designer-studio-assets-v1'`
    ).first();
    assert(assetCheckpoint?.checkpoint, 'active-order Designer Studio backfill must record its idempotent completion checkpoint');

    const renderCallsBeforePreview = calls.filter(call => call.target.startsWith('https://render.example.test')).length;
    const preview = await worker.fetch(new Request('https://worker.test/order-manager/v1/shopify-preview/orders?limit=50', { headers }), env);
    assert.equal(preview.status, 200, 'read-only Shopify preview endpoint must succeed');
    const previewJson = await preview.json();
    assert.equal(previewJson.source, 'shopify-admin-graphql');
    assert.equal(previewJson.readOnly, true);
    assert.equal(previewJson.data[0].displayName, '#1001');
    assert.equal(previewJson.data[0].commerce.total, '21.60');
    const renderCallsAfterPreview = calls.filter(call => call.target.startsWith('https://render.example.test')).length;
    assert.equal(renderCallsAfterPreview, renderCallsBeforePreview, 'Shopify-only preview must not read the Redis/Render adapter');

    const detail = await worker.fetch(new Request(`https://worker.test/order-manager/v1/shopify-preview/orders/${encodeURIComponent(shopifyNode().id)}`, { headers }), env);
    assert.equal(detail.status, 200, 'on-demand Shopify preview detail must succeed');
    const detailJson = await detail.json();
    assert.equal(detailJson.readOnly, true);
    assert.equal(detailJson.data.customer.email, 'fixture@example.com');
    assert.equal(detailJson.data.delivery.fulfillmentOrders[0].method.type, 'SHIPPING');
    assert.equal(detailJson.data.conversion.customerOrderIndex, 2);
    assert.equal(detailJson.data.discounts[0].code, 'FIXTURE');
    assert.equal(detailJson.data.timeline[0].action, 'create');
    assert.equal(detailJson.data.lineItems.length, 2, 'detail endpoint must paginate all Shopify line items');
    assert.equal(detailJson.data.lineItemsComplete, true);
    const renderCallsAfterDetail = calls.filter(call => call.target.startsWith('https://render.example.test')).length;
    assert.equal(renderCallsAfterDetail, renderCallsAfterPreview, 'Shopify detail preview must not read the Redis/Render adapter');

    const productionRead = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      headers: { ...headers, Origin: 'https://extensions.shopifycdn.com' }
    }), env);
    assert.equal(productionRead.status, 200, 'lightweight production metadata read must succeed');
    assert.equal((await productionRead.json()).production.stage, 'received');
    assert.equal(productionRead.headers.get('Access-Control-Allow-Origin'), 'https://extensions.shopifycdn.com', 'Shopify admin extensions must receive exact-origin CORS');

    const mutation = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: 1, patch: { stage: 'to_order' }, idempotencyKey: 'mutation-1' })
    }), env);
    assert.equal(mutation.status, 200, 'versioned production mutation must commit through Shopify and D1');
    const mutationJson = await mutation.json();
    assert.equal(mutationJson.canonicalSource, 'shopify-app-owned-metafield');
    assert.equal(mutationJson.production.stage, 'to_order');
    assert.equal(mutationJson.production.version, 2);
    assert(!calls.some(call => call.target.includes('/data/orders/60129381/production')), 'candidate mutations must not use the Redis CAS adapter');

    const conflict = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: 1, patch: { stage: 'received' }, idempotencyKey: 'mutation-conflict-1' })
    }), env);
    assert.equal(conflict.status, 409, 'stale production revision must be rejected');
    const conflictJson = await conflict.json();
    assert.equal(conflictJson.error.code, 'VERSION_CONFLICT');
    assert.equal(conflictJson.error.details.currentVersion, 2, 'conflict response must expose the current revision for safe client reconciliation');
    assert.equal(conflictJson.error.details.current.stage, 'to_order', 'conflict response must expose current canonical production state');

    const batchResponse = await worker.fetch(new Request('https://worker.test/order-manager/v1/batches/commit', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderIds: [shopifyNode().id], idempotencyKey: 'batch-fixture-1' }),
    }), env);
    assert.equal(batchResponse.status, 200, 'confirmed supplier batch must commit');
    const batchJson = await batchResponse.json();
    assert.equal(batchJson.supplierOrderNumber, 'SS-9001');
    assert.equal(batchJson.metadataRepairRequired.length, 0);
    assert.equal(
      productionState.stage,
      'blanks_cart',
      'confirmed supplier batches must enter In S&S Cart until the operator marks them Ordered'
    );
    assert(productionState.batchRefs.includes(batchJson.poNumber));
    const savedBatch = await env.ORDER_DB.prepare('SELECT state FROM batches WHERE id = ?')
      .bind(batchJson.batchId).first();
    assert.equal(savedBatch.state, 'confirmed');

    const shopRow = await env.ORDER_DB.prepare('SELECT id FROM shops WHERE shop_domain = ?')
      .bind('printmo-test.myshopify.com').first();
    const assetNow = new Date().toISOString();
    await env.ORDER_DB.prepare(`
      INSERT INTO asset_manifests (
        id, shop_id, order_gid, object_key, filename, content_type, byte_size,
        sha256, state, source_key, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).bind(
      'asset-1', shopRow.id, shopifyNode().id, 'orders/60129381/assets/asset-1/art.png',
      'art.png', 'image/png', 15, 'fixture-sha', 'legacy-art', 'fixture', assetNow, assetNow
    ).run();
    const ticketResponse = await worker.fetch(new Request('https://worker.test/order-manager/v1/assets/asset-1/read-ticket', { method: 'POST', headers }), env);
    assert.equal(ticketResponse.status, 200, 'asset read ticket must be issued');
    const ticket = await ticketResponse.json();
    assert.equal(ticket.expiresIn, 60);
    assert(!JSON.stringify(ticket).includes('orders/60129381'), 'R2 object key must not be exposed in the ticket response');
    const asset = await worker.fetch(new Request(`https://worker.test${ticket.url}`, { headers }), env);
    assert.equal(asset.status, 200, 'valid one-minute asset ticket must read private R2 content');

    const parity = await worker.fetch(new Request('https://worker.test/order-manager/v1/parity/check', { method: 'POST', headers }), env);
    assert.equal(parity.status, 200);
    const parityJson = await parity.json();
    assert.equal(parityJson.canonicalSource, 'shopify-app-owned-metafield');
    assert.equal(parityJson.projectionSource, 'cloudflare-d1');

    const migration = await worker.fetch(new Request('https://worker.test/order-manager/v1/migration/run', {
      method: 'POST', headers, body: JSON.stringify({ execute: false, offset: 0, limit: 10 })
    }), env);
    assert.equal(migration.status, 200, 'dry-run migration must be available');
    const migrationJson = await migration.json();
    assert.equal(migrationJson.execute, false);
    assert.equal(migrationJson.projectionMode, 'metadata_only');

    const unsafeMigration = await worker.fetch(new Request('https://worker.test/order-manager/v1/migration/run', {
      method: 'POST', headers, body: JSON.stringify({ execute: true, offset: 0, limit: 1 })
    }), env);
    assert.equal(unsafeMigration.status, 400, 'executing migration must require an exact shop confirmation');

    assert(calls.some(call => call.target.endsWith('/admin/oauth/access_token')), 'Worker must exchange client credentials for a runtime token');
    assert(calls.some(call => call.target.includes('/graphql.json')), 'Worker must query Shopify GraphQL');
    assert(calls.some(call => String(call.options?.body || '').includes('PrintMOShopifyPreviewOrders')), 'preview must use the cost-bounded Shopify list query');
    assert(!source.includes('SHOPIFY_ACCESS_TOKEN'), 'Worker must not depend on a static Shopify access token');
  } finally {
    globalThis.fetch = nativeFetch;
  }

  const migrationTool = require('./run-shadow-migration.js');
  const opts = migrationTool.parseArgs(['--dry-run', '--shop', 'printmo-test.myshopify.com', '--env', 'production']);
  assert.equal(opts.execute, false);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.includeAssets, false);
  assert(source.includes('https://extensions.shopifycdn.com'), 'Worker must allow the exact Shopify admin extension origin');
  const previewHtml = fs.readFileSync(path.join(root, 'order-manager-web', 'index.html'), 'utf8');
  assert(previewHtml.includes('data-order-source-target="shopify"'), 'web UI must expose the Shopify preview toggle');
  assert(previewHtml.includes('shopify-preview.js'), 'web UI must load the read-only preview controller');
  assert(previewHtml.includes('shopify-preview-detail'), 'web UI must include the Shopify-only order detail dialog');
  [
    'detail-header',
    'detail-content',
    'detail-split-canvas',
    'detail-mockup-feature',
    'detail-mockup-main',
    'detail-mockups-track',
    'detail-production-card',
    'detail-tabs-header',
    'detail-design-panel'
  ].forEach(id => {
    assert(previewHtml.includes(`id="${id}"`), `Shopify order detail must preserve the #${id} DOM/controller contract`);
  });
  assert.equal(
    (previewHtml.match(/class="production-step"/g) || []).length,
    4,
    'Shopify order detail must expose both ordered → ready readiness sequences'
  );
  assert(
    previewHtml.includes('role="tablist"')
      && previewHtml.includes('role="tab"')
      && previewHtml.includes('role="tabpanel"')
      && previewHtml.includes('aria-controls="tab-production"'),
    'Shopify order detail tabs must retain their accessible tab contract'
  );
  assert(
    previewHtml.indexOf('renderer.js') < previewHtml.indexOf('detail-overlay-enhancements.js'),
    'the detail controller must load after the shared renderer it enhances'
  );
  const detailEnhancements = fs.readFileSync(path.join(root, 'order-manager-web', 'detail-overlay-enhancements.js'), 'utf8');
  assert(
    detailEnhancements.includes('function wireDetailTabs()')
      && detailEnhancements.includes('function activateDetailTab('),
    'the Shopify detail controller must own functional tab navigation'
  );
  assert(
    detailEnhancements.includes("orderedId: 'chk-blanks-ordered'")
      && detailEnhancements.includes("readyId: 'chk-blanks'")
      && detailEnhancements.includes("orderedId: 'chk-prints-ordered'")
      && detailEnhancements.includes("readyId: 'chk-prints'"),
    'readiness must remain two independent ordered → ready sequences'
  );
  const detailCss = fs.readFileSync(path.join(root, 'order-manager-web', 'order-detail-split.css'), 'utf8');
  assert(
    /@media \(max-width: 900px\)[\s\S]*?#detail-content[\s\S]*?overflow-y:\s*auto/.test(detailCss),
    'mobile order detail must keep #detail-content as its explicit vertical scroll owner'
  );
  const previewController = fs.readFileSync(path.join(root, 'order-manager-web', 'shopify-preview.js'), 'utf8');
  assert(previewController.includes('getShopifyPreviewOrderDetail'), 'preview controller must load details only when an order is opened');
  assert(
    previewController.includes('setPreviewActive(false, { render: false })'),
    'source-controller initialization must not duplicate the renderer-owned initial queue request'
  );
  const webShim = fs.readFileSync(path.join(root, 'order-manager-web', 'web-shim.js'), 'utf8');
  assert(webShim.includes('apiErrorMessage'), 'web errors must render structured Worker errors instead of [object Object]');
  assert(webShim.includes('candidateAssetObjectUrl'), 'Shopify board must hydrate private Designer Studio manifests through authenticated asset tickets');
  assert(webShim.includes('candidateMutationChains'), 'Shopify production mutations must serialize per order');
  assert(webShim.includes('updateBoardMove'), 'Shopify board moves must persist stage and blanks state atomically');
  assert(webShim.includes('VERSION_CONFLICT'), 'Shopify board must reconcile and retry a genuine version conflict once');
  assert(
    /query PrintMOOrderSummaries[\s\S]*?shippingAddress \{ name \}[\s\S]*?billingAddress \{ name \}[\s\S]*?lineItems/.test(source),
    'Shopify board summaries must project guest checkout shipping and billing names'
  );
  assert(source.includes("const forceRefresh = url.searchParams.get('refresh') === '1'"), 'manual Shopify refresh must bypass the short summary TTL');
  assert(
    source.includes('if (forceRefresh || !ctx?.waitUntil)')
      && source.includes("ctx.waitUntil(refreshThroughCoordinator(env, staleGids).catch"),
    'ordinary Shopify board reads must return the D1 projection while stale summaries refresh in the background'
  );
  assert(source.includes('customAttributes { key value }'), 'Shopify board summaries must retain Designer Studio line-item properties');
  assert(source.includes('designer-studio-sync'), 'Shopify summary reconciliation must import Designer Studio assets into private R2');
  assert(source.includes('designer-studio-assets-v1'), 'active-order Designer Studio backfill must have an idempotent checkpoint');
  assert(
    source.includes('redis-position-catchup-2026-07-22T15-51-42-430Z')
      && source.includes('22f099ad077d6a66f2aabf0ccf08ff18aa97faa764787cdb79368e0b77c3aaea'),
    'the approved one-time position catch-up must be checksum-guarded'
  );
  const catchupSource = source.match(/const LEGACY_POSITION_CATCHUP_RECORDS[\s\S]*?\n\]\);/)?.[0] || '';
  assert.equal((catchupSource.match(/orderNumber:/g) || []).length, 19, 'position catch-up must contain exactly 19 approved records');
  assert(!catchupSource.includes("'1573'") && !catchupSource.includes("'1574'"), 'new orders must remain outside the position catch-up');
  const webRenderer = fs.readFileSync(path.join(root, 'order-manager-web', 'renderer.js'), 'utf8');
  assert(webRenderer.includes('assetId'), 'shared web renderer must recognize private manifest assets without public /orders/ URLs');
  const sharedRenderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  assert(
    sharedRenderer.includes('if (detailFilesBtn)'),
    'shared detail renderer must tolerate the Shopify layout omitting the legacy aggregate Files button'
  );
  assert(
    sharedRenderer.includes('boardFetchGeneration')
      && sharedRenderer.includes('changedCandidateBoardStatuses')
      && sharedRenderer.includes('fetchGeneration !== boardFetchGeneration'),
    'shared board rendering must discard superseded fetches and skip unchanged Shopify column repaints'
  );
  const previewCss = fs.readFileSync(path.join(root, 'order-manager-web', 'shopify-preview.css'), 'utf8');
  assert(
    !/body\\[data-order-source=["']shopify["']\\]\\s+#orders-view\\s*\\{[^}]*display:\\s*none/im.test(previewCss),
    'Shopify source must keep the shared operational board visible'
  );
  const blanksFoundation = fs.readFileSync(path.join(root, 'order-manager-web', 'blanks-batches.js'), 'utf8');
  assert(blanksFoundation.includes('setActiveBlanksView'), 'In-cart and Ordered controls must be functioning Shopify board tabs');
  assert(
    blanksFoundation.includes('blanksOrderedValueForActiveView'),
    'drops into the Shopify blanks column must persist the selected In S&S Cart or Ordered view'
  );
  assert(blanksFoundation.includes('applyOptimisticOrderUpdate'), 'Shopify moves must render optimistically and roll back on failure');
  const desktopCss = fs.readFileSync(path.join(root, 'order-manager-web', 'desktop.css'), 'utf8');
  assert(
    desktopCss.includes('repeat(auto-fill, minmax(190px, 1fr))'),
    'a single Shopify production card must retain the normal two-column card width'
  );
  const triageController = fs.readFileSync(path.join(root, 'order-manager-web', 'dashboard-triage-enhancements.js'), 'utf8');
  assert(triageController.includes("card.classList.add('production-card')"), 'fulfillment cards must receive the production layout contract');
  assert(triageController.includes("card.classList.add('pipeline-main-card')"), 'pipeline cards must receive the dashboard footer layout contract');
  assert(
    triageController.includes('sorted.every((card, index) => card === container.children[index])')
      && triageController.includes('if (result?.rendered !== false) applyDashboardTriage();'),
    'dashboard triage must not defer or repeat unchanged card reordering'
  );
  const embeddedMobile = fs.readFileSync(path.join(root, 'order-manager-web', 'shopify-embedded-mobile.js'), 'utf8');
  assert(embeddedMobile.includes("closest('#detail-overlay.mobile-fullscreen-detail')"), 'mobile detail touch containment must preserve its internal scroll owner');

  // Behavioral verification of web-shim adapter and worker normalization contract
  const webShimCode = fs.readFileSync(path.join(root, 'order-manager-web', 'web-shim.js'), 'utf8');
  assert(
    webShimCode.includes('candidateQueueLoadGeneration')
      && webShimCode.includes('applyCandidateCachedAssetUrls')
      && webShimCode.includes('window.api.invalidateQueueLoads')
      && webShimCode.includes('renderBoardFromLocalState(changedStatuses)'),
    'candidate polling and preview hydration must preserve cached assets and repaint only affected columns'
  );
  const shimContext = vm.createContext({
    document: { body: {} },
    window: {},
    console, Map, Set, Number, String, Array, Object, URL
  });
  vm.runInContext(webShimCode, shimContext);
  const { candidateLineItem, candidateOrderToBoard } = shimContext;

  // 1. Price mapping
  const testLineItem = candidateLineItem({ unitPrice: '12.50', currentQuantity: 3 });
  assert.equal(testLineItem.unitPrice, 12.5, 'candidateLineItem must map unitPrice to finite number 12.5');
  assert.equal(testLineItem.price, 12.5, 'candidateLineItem must preserve price compatibility alias 12.5');

  // 2. Totals mapping
  const testBoardOrder = candidateOrderToBoard({
    id: 'gid://shopify/Order/999',
    displayName: '#999',
    commerce: { subtotal: '50.00', discount: '5.00', total: '48.25' }
  });
  assert.equal(testBoardOrder.subtotal, 50, 'subtotal must map to 50');
  assert.equal(testBoardOrder.discount, 5, 'discount must map to 5');
  assert.equal(testBoardOrder.total, 48.25, 'total must map to 48.25');

  // 3. Email-derived display name rejection
  const fixture3Node = {
    customer: { firstName: null, lastName: null, displayName: 'zsasz naberrie' },
    shippingAddress: { name: 'Actual Recipient' }
  };
  assert.equal(module.selectOperationalCustomerName(fixture3Node), 'Actual Recipient');
  const board3 = candidateOrderToBoard(fixture3Node);
  assert.equal(board3.name, 'Shopify order – Actual Recipient');
  assert(!board3.name.includes('zsasz naberrie'), 'must reject email-derived display name fallback');

  // 4. Fulfillment recipient precedence over email-derived customer fields
  const fixture4Node = {
    customer: { firstName: 'Jane', lastName: 'Doe' },
    shippingAddress: { name: 'Warehouse Recipient' }
  };
  assert.equal(module.selectOperationalCustomerName(fixture4Node), 'Warehouse Recipient');
  const board4 = candidateOrderToBoard(fixture4Node);
  assert.equal(board4.name, 'Shopify order – Warehouse Recipient');

  // 5. Guest checkout
  const fixture5Node = {
    customer: null,
    shippingAddress: { name: 'Guest Recipient' }
  };
  assert.equal(module.selectOperationalCustomerName(fixture5Node), 'Guest Recipient');
  const board5 = candidateOrderToBoard(fixture5Node);
  assert.equal(board5.name, 'Shopify order – Guest Recipient');

  // 6. Final fallback
  const fixture6Node = {
    customer: null,
    shippingAddress: null,
    billingAddress: null
  };
  assert.equal(module.selectOperationalCustomerName(fixture6Node), null);
  const board6 = candidateOrderToBoard(fixture6Node);
  assert.equal(board6.name, 'Shopify order – Name unavailable');

  // 7. Discount source in worker contract
  assert(source.includes('currentTotalDiscountsSet'), 'Worker query must fetch currentTotalDiscountsSet');
  assert(source.includes('discount: moneyValue(node.currentTotalDiscountsSet'), 'Worker summary normalization must map commerce.discount from currentTotalDiscountsSet');

  console.log('Phase 2 shadow data plane verification passed.');
}

if (require.main === module) run().catch(error => { console.error(error); process.exit(1); });
module.exports = { run };
