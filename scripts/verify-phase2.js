const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DatabaseSync } = require('node:sqlite');
const {
  completionCandidate,
  garmentCount: repairGarmentCount,
  parseArgs: parseCompletionRepairArgs
} = require('./repair-production-completion');

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
          { key: 'batch_role', value: 'garment' },
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
    billingAddress: { name: 'Fixture Billing', address1: '456 Billing Ave', city: 'Austin', provinceCode: 'TX', zip: '78702', country: 'United States', countryCodeV2: 'US' },
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
  const schema = ['0001_redis_free.sql', '0002_designer_asset_metadata.sql', '0003_asset_blob_links.sql']
    .map(file => fs.readFileSync(path.join(root, 'order-manager-proxy', 'migrations', file), 'utf8'))
    .join('\n');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const worker = module.default;
  assert.equal(typeof module.OrderSyncCoordinator, 'function', 'Durable Object coordinator must be exported');
  assert.equal(module.webhookConfirmsPayment('orders/updated', { financial_status: 'paid' }), true);
  assert.equal(module.webhookConfirmsPayment('orders/updated', { financial_status: 'pending' }), false);
  assert.equal(
    module.webhookConfirmsPayment('orders/updated', { financial_status: 'paid', fulfillment_status: 'fulfilled' }),
    false,
    'fulfilled order updates must not enroll historical orders into the active board'
  );
  assert.equal(
    module.webhookConfirmsPayment('orders/paid', { financial_status: 'paid', cancelled_at: '2024-01-01T00:00:00Z' }),
    false,
    'cancelled orders must not enter the active board even when a paid webhook is replayed'
  );

  const secret = 'phase2-test-secret';
  const now = Math.floor(Date.now() / 1000);
  const authToken = jwt(secret, {
    iss: 'https://printmo-test.myshopify.com/admin', dest: 'https://printmo-test.myshopify.com',
    aud: 'phase2-client', sub: 'partner-1', iat: now, nbf: now - 1, exp: now + 60
  });
  const designerSourceKey = 'orders/1001_fixture-customer/fixture-design-ref/mockup_side.png';
  const designerBytes = new TextEncoder().encode('designer-studio-preview');
  const previewObjects = new Map([[
    designerSourceKey,
    { bytes: designerBytes, contentType: 'image/png' }
  ]]);
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
    async text() { return new TextDecoder().decode(record.bytes); },
    writeHttpMetadata(headers) { headers.set('Content-Type', record.contentType); },
  } : null;
  const env = {
    SHOPIFY_API_KEY: 'phase2-client', SHOPIFY_API_SECRET: secret,
    SHOPIFY_SHOP_DOMAIN: 'printmo-test.myshopify.com', PARTNER_USER_IDS: 'partner-1',
    UPSTREAM_BASE: 'https://render.example.test', ORDER_MANAGER_ADMIN_KEY: 'render-admin-key',
    MIGRATION_UPSTREAM_ENABLED: '1',
    ORDER_DB: createD1(schema),
    PREVIEWS: {
      async head(key) {
        const record = previewObjects.get(key);
        return record ? { key, size: record.bytes.byteLength } : null;
      },
      async get(key) { return r2Object(previewObjects.get(key)); },
      async put(key, value, options = {}) {
        const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
        previewObjects.set(key, {
          bytes,
          contentType: options.httpMetadata?.contentType || 'application/octet-stream'
        });
      },
      async delete(key) { previewObjects.delete(key); },
      async list({ prefix }) {
        return {
          objects: Array.from(previewObjects.entries())
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, record]) => ({ key, size: record.bytes.byteLength })),
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
        assert(request.query.includes('sku'), 'production validation must request SKU before counting garments');
        return Response.json({
          data: {
            order: {
              id: shopifyNode().id,
              name: shopifyNode().name,
              createdAt: shopifyNode().createdAt,
              updatedAt: shopifyNode().updatedAt,
              lineItems: {
                nodes: [
                  shopifyNode().lineItems.nodes[0],
                  {
                    id: 'gid://shopify/LineItem/print-1',
                    title: 'T-shirt Chest Print',
                    quantity: 1,
                    currentQuantity: 1,
                  },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'production-page-1' },
              },
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
      if (request.query.includes('PrintMOOrderDetailLineItems')) {
        assert(!request.query.includes('variant {'), 'canonical detail pagination must not read the product variant relation');
        return Response.json({ data: { order: { lineItems: { nodes: [{
          id: 'gid://shopify/LineItem/102', sku: 'B002', title: 'Second Fixture Shirt', variantTitle: 'White / L',
          quantity: 1, currentQuantity: 1, customAttributes: [],
          originalUnitPriceSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } },
          originalTotalSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } },
          totalDiscountSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
          priceAfterAllDiscountsBeforeTaxesSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } },
          discountAllocations: [], taxLines: []
        }], pageInfo: { hasNextPage: false, endCursor: null } } } } });
      }
      if (request.query.includes('PrintMOOrderDetail')) {
        assert(!request.query.includes('customer {'), 'canonical detail must not read the customer relation');
        assert(!request.query.includes('variant {'), 'canonical detail must not read the product variant relation');
        assert(request.query.includes('customerJourneySummary'), 'canonical detail must include conversion data');
        assert(request.query.includes('shippingLines'), 'canonical detail must include checkout shipping data');
        assert(request.query.includes('events(first: 25'), 'canonical detail must include the Shopify timeline');
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
      if (request.query.includes('PrintMOOrderLineItems')) {
        assert(!request.query.includes('variant {'), 'canonical detail pagination must not read the product variant relation');
        return Response.json({ data: { order: { lineItems: { nodes: [{
          id: 'gid://shopify/LineItem/102', sku: 'B002', title: 'Second Fixture Shirt', variantTitle: 'White / L',
          quantity: 1, currentQuantity: 1, customAttributes: [], variant: { id: 'gid://shopify/ProductVariant/202' },
          originalUnitPriceSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } },
          discountAllocations: []
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
      assert.deepEqual(request.lines, [{ sku: 'B001', qty: 2 }, { sku: 'B002', qty: 1 }]);
      return Response.json({
        ok: true,
        orderNumber: 'SS-9001',
        count: 2,
        subtotal: 8.5,
        skuCount: 2,
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
    const quantityFiveCandidates = module.designerAssetCandidates({
      displayName: '#1001',
      commerce: {
        lineItems: [{
          ...shopifyNode().lineItems.nodes[0],
          id: 'gid://shopify/LineItem/quantity-five',
          quantity: 5,
          currentQuantity: 5,
        }],
      },
    });
    assert.equal(quantityFiveCandidates.length, 1, 'line-item quantity must not multiply Designer asset candidates');
    assert.equal(quantityFiveCandidates[0].role, 'mockup', 'explicit Designer garment role must win over SKU heuristics');
    const linkedDuplicate = await module.copyDesignerAsset(env, 1, shopifyNode().id, {
      ...quantityFiveCandidates[0],
      lineItemId: 'gid://shopify/LineItem/duplicate-mockup',
    });
    assert.equal(linkedDuplicate.state, 'existing', 'identical Designer bytes must reuse the private blob');
    assert.equal(
      (await env.ORDER_DB.prepare(`SELECT COUNT(*) AS count FROM asset_manifests WHERE state = 'active'`).first()).count,
      1,
      'identical Designer bytes must create only one active manifest'
    );
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM asset_manifest_links').first()).count,
      2,
      'deduplicated Designer bytes must retain both line-item associations'
    );
    const batchTicketsResponse = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/assets/read-tickets',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ assetIds: [boardJson.data[0].production.assets[0].assetId] }),
      }
    ), env);
    assert.equal(batchTicketsResponse.status, 200, 'board assets must support one authenticated batch ticket request');
    const batchTickets = await batchTicketsResponse.json();
    assert.equal(batchTickets.tickets.length, 1);
    assert(!JSON.stringify(batchTickets).includes('orders/60129381/assets/'), 'batch tickets must not expose private R2 keys');
    const signedAssetUrl = new URL(batchTickets.tickets[0].url, 'https://worker.test');
    const signedPayload = signedAssetUrl.searchParams.get('ticket').split('.')[0];
    assert(!Buffer.from(signedPayload, 'base64url').toString('utf8').includes('object_key'));
    assert(!Buffer.from(signedPayload, 'base64url').toString('utf8').includes('orders/'));
    const signedAssetRead = await worker.fetch(new Request(signedAssetUrl), env);
    assert.equal(signedAssetRead.status, 200, 'a valid short-lived ticket must authorize a direct image-tag read');
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

    const renderCallsBeforeCanonicalDetail = calls.filter(call => call.target.startsWith('https://render.example.test')).length;
    const canonicalDetail = await worker.fetch(
      new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}`, { headers }),
      env
    );
    assert.equal(canonicalDetail.status, 200, 'canonical operational order detail must succeed');
    const canonicalDetailJson = await canonicalDetail.json();
    assert.equal(canonicalDetailJson.detail.orderNote, 'Fixture note');
    assert.equal(canonicalDetailJson.detail.customer.email, 'fixture@example.com');
    assert.equal(canonicalDetailJson.detail.customer.phone, '555-0100');
    assert.equal(canonicalDetailJson.detail.customer.locale, 'en-US');
    assert.equal(canonicalDetailJson.detail.shippingAddress.address1, '123 Main St');
    assert.equal(canonicalDetailJson.detail.billingAddress.address1, '456 Billing Ave');
    assert.equal(canonicalDetailJson.detail.lineItems.length, 2, 'canonical detail must paginate all line items');
    assert.equal(canonicalDetailJson.commerce.financialStatus, 'PAID');
    assert.equal(canonicalDetailJson.production.stage, 'received');
    assert.equal(canonicalDetailJson.production.assets.length, 2, 'detail must return every line-item link for the deduplicated blob');
    assert.equal(
      new Set(canonicalDetailJson.production.assets.map(asset => asset.assetId)).size,
      1,
      'detail links for identical Designer bytes must share one private asset ID'
    );
    assert.equal(canonicalDetailJson.attention.required, false);
    assert.equal(canonicalDetailJson.detail.customer.id, undefined, 'canonical detail must use direct Order contact fields');
    assert.equal(canonicalDetailJson.detail.data.delivery.shippingLines[0].title, 'Standard');
    assert.equal(canonicalDetailJson.detail.data.conversion.customerOrderIndex, 2);
    assert.equal(canonicalDetailJson.detail.data.discounts[0].code, 'FIXTURE');
    assert.equal(canonicalDetailJson.detail.data.timeline[0].action, 'create');
    assert.equal(canonicalDetailJson.detail.data.commerce.shipping.amount, '1.00');
    assert.equal(canonicalDetailJson.detail.data.commerce.tax.amount, '2.60');
    const renderCallsAfterCanonicalDetail = calls.filter(call => call.target.startsWith('https://render.example.test')).length;
    assert.equal(renderCallsAfterCanonicalDetail, renderCallsBeforeCanonicalDetail, 'canonical detail must remain Redis-free');

    const productionRead = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      headers: { ...headers, Origin: 'https://extensions.shopifycdn.com' }
    }), env);
    assert.equal(productionRead.status, 200, 'lightweight production metadata read must succeed');
    const productionReadJson = await productionRead.json();
    assert.equal(productionReadJson.production.stage, 'received');
    assert.equal(productionReadJson.production.garmentCount, 3, 'production DTO must count all paginated non-print garments');
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
    assert.equal(conflictJson.error.details.current.garmentCount, 3, 'conflict recovery must retain the current garment cap');

    const invalidPrintedCount = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: 2, patch: { printed_count: 4 }, idempotencyKey: 'mutation-invalid-count-1' })
    }), env);
    assert.equal(invalidPrintedCount.status, 400, 'printed count above the paginated garment total must be rejected');
    assert.equal((await invalidPrintedCount.json()).error.code, 'INVALID_PRINTED_COUNT');

    const blanksOrder = (orderId, name, receivedAt, qty) => ({
      orderId,
      name,
      orderNumber: name.replace(/\D/g, ''),
      customer: `Customer ${name}`,
      receivedAt,
      items: [{
        id: `line-${orderId}`,
        title: 'Fixture Shirt',
        variantTitle: 'Black / M',
        sku: 'FIXTURE-A',
        qty,
      }],
    });
    const firstBatchOrder = blanksOrder('gid://shopify/Order/2001', '#2001', '2026-07-20T10:00:00Z', 2);
    const missedBatchOrder = blanksOrder('gid://shopify/Order/2002', '#2002', '2026-07-20T11:00:00Z', 1);
    const createBatch = async order => worker.fetch(new Request('https://worker.test/order-manager/blanks-batches', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orders: [order], source: 'phase2-fixture' })
    }), env);
    const firstBatchResponse = await createBatch(firstBatchOrder);
    assert.equal(firstBatchResponse.status, 201, 'first receiving batch must be created');
    const firstBatch = (await firstBatchResponse.json()).batch;
    assert.equal(firstBatch.orderIds[0], firstBatchOrder.orderId, 'batch identity must retain the immutable Shopify order GID');
    const secondBatchResponse = await createBatch(missedBatchOrder);
    assert.equal(secondBatchResponse.status, 201, 'a separately created missed-order batch must be represented before transfer');
    const secondBatch = (await secondBatchResponse.json()).batch;

    const duplicateBatchResponse = await createBatch(firstBatchOrder);
    assert.equal(duplicateBatchResponse.status, 409, 'an order must not be created in a second active receiving batch');
    assert.equal((await duplicateBatchResponse.json()).error.code, 'ORDER_ALREADY_BATCHED');

    const receiveSecondBatch = await worker.fetch(new Request('https://worker.test/order-manager/blanks-batches', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        id: secondBatch.id,
        updates: [{ itemKey: secondBatch.manifest[0].itemKey, receivedQty: 1 }]
      })
    }), env);
    assert.equal(receiveSecondBatch.status, 200, 'source batch receiving must be saved before transfer');

    const assignMissedOrder = await worker.fetch(new Request('https://worker.test/order-manager/blanks-batches', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ id: firstBatch.id, action: 'assign-orders', orders: [missedBatchOrder] })
    }), env);
    assert.equal(assignMissedOrder.status, 200, 'a missed order must be assignable to the intended existing batch');
    const assignment = await assignMissedOrder.json();
    assert.equal(assignment.batch.orders.length, 2, 'the intended batch must contain both orders after transfer');
    assert.equal(assignment.batch.totals.receivedGarments, 1, 'received inventory must move with the transferred order');
    assert.deepEqual(assignment.removedBatchIds, [secondBatch.id], 'an emptied accidental batch must leave the active index');

    const batchIndexResponse = await worker.fetch(new Request('https://worker.test/order-manager/blanks-batches', { headers }), env);
    assert.equal(batchIndexResponse.status, 200);
    const receivingBatchIndex = await batchIndexResponse.json();
    assert.equal(receivingBatchIndex.batches.length, 1, 'unique batch membership must leave one active receiving batch');
    assert.equal(receivingBatchIndex.batches[0].id, firstBatch.id);

    const completedMutation = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedVersion: 2,
        patch: { stage: 'completed', printed_count: 3 },
        idempotencyKey: 'mutation-completed-1'
      })
    }), env);
    assert.equal(completedMutation.status, 200);
    const completedJson = await completedMutation.json();
    assert.equal(completedJson.production.stage, 'completed');
    assert.equal(completedJson.production.garmentCount, 3);
    const completedProjection = await env.ORDER_DB.prepare('SELECT active, stage FROM order_projection WHERE order_gid = ?')
      .bind(shopifyNode().id).first();
    assert.equal(completedProjection.active, 1, 'Production complete must remain active until customer handoff');
    assert.equal(completedProjection.stage, 'completed');

    const archiveMutation = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedVersion: 3,
        patch: { archived_at: 'untrusted-client-time' },
        idempotencyKey: 'mutation-archive-1'
      })
    }), env);
    assert.equal(archiveMutation.status, 200);
    const archiveJson = await archiveMutation.json();
    assert.equal(archiveJson.production.archivedBy, 'shopify:partner-1', 'archive actor must come from authenticated identity');
    assert.notEqual(archiveJson.production.archivedAt, 'untrusted-client-time', 'archive timestamp must be server-stamped');
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT active FROM order_projection WHERE order_gid = ?').bind(shopifyNode().id).first()).active,
      0,
      'handoff completion must remove the order from the active board'
    );

    const reopenMutation = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedVersion: 4,
        patch: { archived_at: null },
        idempotencyKey: 'mutation-reopen-1'
      })
    }), env);
    assert.equal(reopenMutation.status, 200);
    const reopenJson = await reopenMutation.json();
    assert.equal(reopenJson.production.archivedAt, null);
    assert.equal(reopenJson.production.archivedBy, null);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT active FROM order_projection WHERE order_gid = ?').bind(shopifyNode().id).first()).active,
      1,
      'reopening must return the order to the active board'
    );

    const resetForBatch = await worker.fetch(new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedVersion: 5,
        patch: { stage: 'to_order' },
        idempotencyKey: 'mutation-reset-batch-stage-1'
      })
    }), env);
    assert.equal(resetForBatch.status, 200, 'fixture order must return to the supplier-eligible stage');

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
  assert(!previewHtml.includes('data-order-source-target'), 'normal web UI must not expose a Legacy Redis source switch');
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
    previewHtml.indexOf('id="detail-mockups-strip"') < previewHtml.indexOf('id="detail-notes-wrapper"')
      && previewHtml.indexOf('id="detail-notes-wrapper"') < previewHtml.indexOf('id="detail-production-card"'),
    'persistent detail rail must keep artwork, customer instructions, then production controls in workflow order'
  );
  assert.equal(
    (previewHtml.match(/id="production-status-pill"/g) || []).length,
    1,
    'order detail must expose exactly one aggregate readiness summary'
  );
  assert(!previewHtml.includes('detail-header-ready-summary'), 'duplicate header readiness summary must stay removed');
  assert.equal(
    (previewHtml.match(/class="detail-tab-item/g) || []).length,
    5,
    'rich workbench must expose five workflow-oriented detail tabs'
  );
  assert(
    previewHtml.includes('id="detail-data-status"')
      && previewHtml.includes('id="detail-data-retry"')
      && previewHtml.includes('id="tab-activity"'),
    'canonical detail must expose loading/error recovery and activity/exception regions'
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
      && detailEnhancements.includes('function activateDetailTab(')
      && detailEnhancements.includes('function hydrateCanonicalDetail(')
      && detailEnhancements.includes('detailHydrationGeneration')
      && detailEnhancements.includes('canonicalDetailStillActive'),
    'the Shopify detail controller must own functional tab navigation'
  );
  assert(
    detailEnhancements.includes('const canonicalAssets = Array.isArray(production.assets)')
      && detailEnhancements.includes('assets: assetsByLine.get(item.id)')
      && detailEnhancements.includes("if (typeof renderOrderAssets === 'function') renderOrderAssets(order)")
      && detailEnhancements.includes('consolidateLineItemsForDisplay(rawLineItems)')
      && detailEnhancements.includes('consolidateLineItemsForDisplay(order?.items || [])'),
    'canonical detail must attach every private asset to its line, repaint Production downloads, and consolidate display rows'
  );
  assert(
    previewHtml.includes('id="detail-tab-items" class="detail-tab-item active"')
      && previewHtml.includes('id="tab-items" class="detail-tab-panel active"')
      && detailEnhancements.includes("activateDetailTab('tab-items')"),
    'Items & financials must be the default Shopify order-detail tab'
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
  assert(
    /#detail-items-wrapper\s*\{[\s\S]*?overflow:\s*visible;/.test(detailCss)
      && !/\.detail-table\s*\{[\s\S]*?min-width:\s*620px;/.test(detailCss),
    'line-item tables must stay fully visible without becoming a nested scroll owner'
  );
  assert(
    detailEnhancements.includes("'grouped item' : 'grouped items'")
      && detailEnhancements.includes("detail-item-qty-cell")
      && detailEnhancements.includes("classList.toggle('is-placeholder'")
      && /grid-template-areas:[\s\S]*?"quantity description total"/.test(detailCss)
      && /#detail-items \.detail-item-row \.detail-item-sku-cell\.is-placeholder\s*\{[\s\S]*?display:\s*none(?:\s*!important)?;/.test(detailCss),
    'mobile item breakdown must present consolidated lines compactly and suppress empty SKU metadata'
  );
  const previewController = fs.readFileSync(path.join(root, 'order-manager-web', 'shopify-preview.js'), 'utf8');
  assert(
    previewController.includes("const LEGACY_DEBUG_QUERY_PARAM = 'printmo_debug_legacy'")
      && previewController.includes('installLegacyDebugSourceControls'),
    'Legacy Redis source controls must require the explicit debug query parameter'
  );
  assert(previewController.includes('getShopifyPreviewOrderDetail'), 'preview controller must load details only when an order is opened');
  assert(
    previewController.includes('setPreviewActive(true, { render: false })'),
    'source-controller initialization must not duplicate the renderer-owned initial queue request'
  );
  const webShim = fs.readFileSync(path.join(root, 'order-manager-web', 'web-shim.js'), 'utf8');
  assert(webShim.includes('apiErrorMessage'), 'web errors must render structured Worker errors instead of [object Object]');
  assert(
    webShim.includes('shopifyIdTokenCache')
      && webShim.includes('getShopifyIdToken')
      && webShim.includes('expiresAt: Math.min(safeDeclaredExpiry, now + 30000)')
      && webShim.includes('if (res.status === 401)'),
    'adjacent queue and private-ticket requests must reuse only a short-lived Shopify token and refresh once on 401'
  );
  assert(
    webShim.includes('window.api.getOrderDetail')
      && webShim.includes('`/order-manager/v1/orders/${encodeURIComponent(orderId)}`'),
    'shared Shopify workbench must hydrate from the canonical on-demand detail endpoint'
  );
  const candidateAssetLoaderSource = webShim.slice(
    webShim.indexOf('async function candidateAssetObjectUrl'),
    webShim.indexOf('function candidateAssetIsMockup')
  );
  assert(
    webShim.includes('candidateAssetObjectUrl')
      && webShim.includes('candidateAssetObjectUrlLoads')
      && webShim.includes('ASSET_HYDRATION_CONCURRENCY')
      && webShim.includes('CANDIDATE_ASSET_OBJECT_URL_LIMIT')
      && webShim.includes('URL.revokeObjectURL')
      && webShim.includes('/order-manager/v1/assets/read-tickets')
      && webShim.includes('new URL(url, API_BASE).toString()')
      && !candidateAssetLoaderSource.includes('expect: "blob"')
      && webShim.includes('onMockupChange'),
    'Shopify board must batch private tickets and stream previews directly instead of buffering every full image in JavaScript'
  );
  assert(
    webShim.includes('window.api.downloadAsset = async (url, filename, assetId)')
      && webShim.includes('await candidateAssetObjectUrl({ assetId, name: filename })'),
    'detail downloads must refresh an expired private ticket from the stable opaque asset ID'
  );
  assert(
    webShim.includes('boardVisibleOnly')
      && webShim.includes('candidateRecordBelongsToActiveMobileTab')
      && webShim.includes('.mobile-tab[data-tab]'),
    'mobile board hydration must defer hidden-stage mockups until their tab becomes active'
  );
  assert(
    webShim.includes('const ASSET_HYDRATION_CONCURRENCY = 6')
      && webShim.includes('runWithConcurrency(assets, ASSET_HYDRATION_CONCURRENCY')
      && !webShim.includes('waitForCandidatePreviewBytes')
      && !webShim.includes('BOARD_PREVIEW_STREAM_TIMEOUT_MS'),
    'visible dashboard previews must not wait behind a detached-image timeout before later cards receive their URLs'
  );
  const processBatchSource = webShim.slice(
    webShim.indexOf('window.api.processBatch'),
    webShim.indexOf('window.api.createBlanksBatch')
  );
  assert(
    !processBatchSource.includes('order.status = "blanks"'),
    'confirmed supplier batches must let the renderer own the visible source/destination column repaint'
  );
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
  const summaryQuerySource = source.match(/const ORDER_SUMMARIES_QUERY[\s\S]*?`;\n/)?.[0] || '';
  assert(!summaryQuerySource.includes('customer {'), 'board summary refresh must not request unapproved protected-customer fields');
  assert(!summaryQuerySource.includes('variant {'), 'board summary refresh must not request the unapproved product relation');
  assert(
    source.includes("if (webhookConfirmsPayment(topic, payload))"),
    'paid orders/updated deliveries must enroll candidates when orders/paid is absent'
  );
  assert(source.includes('ROW_NUMBER() OVER ('), 'board payload must select one representative private preview per order');
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
  const desktopDragPolish = fs.readFileSync(path.join(root, 'order-manager-web', 'desktop-drag-polish.js'), 'utf8');
  const auxiliaryQueueReaders = fs.readdirSync(path.join(root, 'order-manager-web'))
    .filter(name => name.endsWith('.js') && name !== 'renderer.js')
    .filter(name => fs.readFileSync(path.join(root, 'order-manager-web', name), 'utf8').includes('window.api.getQueue('));
  assert.deepEqual(
    auxiliaryQueueReaders,
    [],
    'only the shared renderer may read the board queue; auxiliary browser scripts must consume its snapshot'
  );
  assert(
    sharedRenderer.includes('window.getOrderManagerBoardSnapshot = () => {')
      && sharedRenderer.includes('const snapshot = allOrders.slice()')
      && desktopDragPolish.includes('window.getOrderManagerBoardSnapshot()')
      && !desktopDragPolish.includes('window.api.getQueue('),
    'desktop drag metadata must read the current renderer snapshot without racing the initial board request'
  );
  const assetFingerprintStart = sharedRenderer.indexOf('function candidateAssetRenderFingerprint');
  const assetFingerprintEnd = sharedRenderer.indexOf('\nfunction candidateOrderRenderFingerprint', assetFingerprintStart);
  const assetFingerprintSource = sharedRenderer.slice(assetFingerprintStart, assetFingerprintEnd);
  assert(
    assetFingerprintStart >= 0
      && assetFingerprintEnd > assetFingerprintStart
      && !assetFingerprintSource.includes('url:'),
    'rotating private ticket URLs must not make unchanged orders rebuild their cards'
  );
  assert(
    sharedRenderer.includes('mockupSlot.dataset.assetId = mockupAssetIdentity')
      && sharedRenderer.includes('existingIdentity === assetIdentity')
      && sharedRenderer.includes("existingImage.dataset.previewLoadFailed !== 'true'")
      && sharedRenderer.includes("window.orderManagerPerformanceDebug?.log?.('tile-preview-source-preserved'")
      && sharedRenderer.includes("if (image.getAttribute('src') !== url) {")
      && sharedRenderer.includes("image.setAttribute('src', url)"),
    'tile hydration must preserve a healthy image for the same asset while refreshing missing, changed, or failed sources'
  );
  assert(
    sharedRenderer.includes('function updateBoardMockupPreview(order, { resolvePlaceholder = false } = {})')
      && sharedRenderer.includes("document.querySelectorAll('.card[data-order-id]')")
      && sharedRenderer.includes('slot.className = `mockup-slot mockup-slot-${renderedState}`')
      && sharedRenderer.includes('window.updateBoardMockupPreview = updateBoardMockupPreview')
      && webShim.includes('window.updateBoardMockupPreview(current, { resolvePlaceholder: true })'),
    'resolved Designer mockups must patch their visible card directly instead of waiting for a board poll'
  );
  assert(
    webShim.includes('async function loadCandidateQueue({ refresh = false, onPage } = {})')
      && webShim.includes('await onPage(mapped, {')
      && webShim.includes('hydrationChain = hydrationChain.catch(() => {}).then(async () => {')
      && !webShim.includes('await primeCandidateBoardMockups')
      && webShim.includes('const CANDIDATE_TICKET_BATCH_TIMEOUT_MS = 1500')
      && webShim.includes('withCandidateTicketBatchTimeout')
      && !webShim.includes('const pendingStatuses = new Set()'),
    'order pages must paint progressively before bounded private preview hydration begins'
  );
  assert(
    sharedRenderer.includes('const allowProgressivePaint = isShopifyBoardView() && !boardHasRendered')
      && sharedRenderer.includes('onPage: allowProgressivePaint')
      && sharedRenderer.includes('applyQueueSnapshot(pageOrders, pageInfo)')
      && sharedRenderer.includes('hydrateManualMockupsForOrders(pageOrders, { refresh: true })')
      && sharedRenderer.includes('window.orderManagerPerformanceDebug?.log?.("board-snapshot-painted"'),
    'the initial Shopify board must paint page snapshots without dropping the stable refresh view'
  );
  assert(
    sharedRenderer.includes('function reconcileManualMockupCard(order, changed, wasHydrated)')
      && sharedRenderer.includes("window.updateBoardMockupPreview(order, { resolvePlaceholder: true })")
      && !sharedRenderer.includes('scheduleManualMockupRepaint')
      && !sharedRenderer.includes('pendingManualMockupStatuses'),
    'manual mockup hydration must reconcile one card without rebuilding status columns over Designer previews'
  );
  const consolidatorStart = sharedRenderer.indexOf('function consolidateLineItemsForDisplay');
  const consolidatorEnd = sharedRenderer.indexOf('\nfunction openDetail', consolidatorStart);
  assert(consolidatorStart >= 0 && consolidatorEnd > consolidatorStart, 'shared renderer must expose display-only line consolidation');
  const consolidationInput = [
    { title: 'DTF Print', variantTitle: 'Full Back Print', sku: '', qty: 1, unitPrice: 8, customAttributes: [{ key: 'batch_id', value: 'a' }] },
    { title: 'DTF Print', variantTitle: 'Full Back Print', sku: '', qty: 2, unitPrice: 8, customAttributes: [{ key: 'batch_id', value: 'b' }] },
    { title: 'DTF Print', variantTitle: 'Breast Print', sku: '', qty: 3, unitPrice: 2 },
    { title: 'Gold Soft Touch T-Shirt', variantTitle: 'Black / XL', sku: 'B01542506', qty: 1, unitPrice: 4.49 },
    { title: 'Gold Soft Touch T-Shirt', variantTitle: 'Black / XL', sku: 'B01542506', qty: 2, unitPrice: 4.49 }
  ];
  const consolidationResult = vm.runInNewContext(
    `${sharedRenderer.slice(consolidatorStart, consolidatorEnd)}\nconsolidateLineItemsForDisplay(input);`,
    { input: consolidationInput },
    { filename: 'line-item-consolidation-fixture.js' }
  );
  assert.equal(consolidationResult.length, 3, 'batch-split Shopify lines must collapse into three commercial display rows');
  assert.equal(consolidationResult[0].qty, 3, 'matching print quantities must be summed visually');
  assert.equal(consolidationResult[0]._displayCurrentTotal, 24, 'consolidated print totals must remain financially exact');
  assert.equal(consolidationResult[0].customAttributes.length, 0, 'batch identifiers must stay out of the operator-facing table');
  assert(
    sharedRenderer.includes("const itemColumnCount = document.querySelectorAll('#detail-items thead th').length || 4")
      && sharedRenderer.includes('const separateSkuColumn = itemColumnCount >= 5'),
    'fallback detail rows must match both the four-column desktop shell and five-column Shopify table while detail hydrates'
  );
  assert(
    sharedRenderer.includes('function formatCardMoney(value)')
      && sharedRenderer.includes('formatCardMoney(o.subtotal)')
      && !sharedRenderer.includes('(o.subtotal||0).toFixed(2)'),
    'shared cards must safely format legacy string subtotals after a mutation repaint'
  );
  assert(
    sharedRenderer.includes('if (detailFilesBtn)'),
    'shared detail renderer must tolerate the Shopify layout omitting the legacy aggregate Files button'
  );
  assert(
    sharedRenderer.includes('orderIsVisibleOnOperationalBoard')
      && sharedRenderer.includes("fulfillment !== 'FULFILLED'")
      && sharedRenderer.includes("return order.productionStage === 'completed'"),
    'fulfilled historical projections must stay hidden while intentionally completed production remains in Printed'
  );
  assert(
    sharedRenderer.includes('boardFetchGeneration')
      && sharedRenderer.includes('changedCandidateBoardStatuses')
      && sharedRenderer.includes('fetchGeneration !== boardFetchGeneration'),
    'shared board rendering must discard superseded fetches and skip unchanged Shopify column repaints'
  );
  const printCardSource = sharedRenderer.slice(
    sharedRenderer.indexOf("style === 'printProgress'"),
    sharedRenderer.indexOf("style === 'picked'")
  );
  assert(
    printCardSource.includes('productionMockupSlotMarkup')
      && printCardSource.includes('print-card-details')
      && printCardSource.includes('print-card-statuses')
      && sharedRenderer.includes("toUpperCase() !== 'FULFILLED'")
      && sharedRenderer.includes("return pendingDesignerMockup || !manualHydrated ? 'loading' : 'unavailable'")
      && sharedRenderer.includes("touchedStatuses.add('toOrder')")
      && sharedRenderer.includes("window.setActiveBlanksView('cart', { render: false })"),
    'supplier submit repaint, fulfillment filtering, and stable Ready to Print preview states must retain their shared renderer contract'
  );
  assert(
    sharedRenderer.includes("const PRINT_VIEWS = ['toPrint', 'printed']")
      && sharedRenderer.includes("return order?.productionStage === 'completed' ? 'printed' : 'toPrint'")
      && sharedRenderer.includes("if (printViewForOrder(order) !== activePrintView) return false")
      && sharedRenderer.includes("if (orderView === 'printed') return true"),
    'Ready to Print tabs must separate canonical print/completed stages while retaining fulfilled completed orders'
  );
  assert(
    sharedRenderer.includes("return 'completed'")
      && sharedRenderer.includes("return 'print'")
      && sharedRenderer.includes("stageChanged")
      && sharedRenderer.includes("Order moved to Printed")
      && sharedRenderer.includes("Order returned to To Print"),
    'progress changes must atomically advance and reverse the canonical production stage with visible feedback'
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
  assert(
    blanksFoundation.includes("card.querySelector('.production-card-statuses')")
      && blanksFoundation.includes('statusRegion.appendChild(chip)')
      && blanksFoundation.includes('patchRenderStatusColumnForAccounting'),
    'garment accounting must mount inside the shared production-card status region and survive direct print-tab rerenders'
  );
  assert(
    blanksFoundation.includes("actionRow.className = `detail-accounting-action-row")
      && blanksFoundation.includes('function saveInlineReceivingLine(')
      && blanksFoundation.includes("stepper.className = 'inline-accounting-stepper'")
      && blanksFoundation.includes("document.addEventListener('printmo:detail-items-rendered'")
      && detailEnhancements.includes("document.dispatchEvent(new CustomEvent('printmo:detail-items-rendered'")
      && /\.inline-accounting-control\s*\{[\s\S]*?width:\s*100%;/.test(detailCss)
      && /@media \(max-width: 600px\)[\s\S]*?\.inline-accounting-control\s*\{[\s\S]*?min-height:\s*44px;/.test(detailCss),
    'garment receiving must render as a resilient desktop/mobile action sub-row with an accessible phone target'
  );
  const accessibilityHardening = fs.readFileSync(path.join(root, 'order-manager-web', 'accessibility-hardening.js'), 'utf8');
  assert(
    accessibilityHardening.includes("root: '#blanks-receive-overlay'")
      && accessibilityHardening.includes('dynamicDialogObserver')
      && accessibilityHardening.includes("root: '#batch-correction-overlay'"),
    'dynamic receiving dialogs must participate in the shared focus and inert stack'
  );
  assert(
    blanksFoundation.includes('function assignSelectedOrdersToActiveBatch()')
      && blanksFoundation.includes('window.api.assignOrdersToBlanksBatch')
      && webShim.includes('action: "assign-orders"')
      && source.includes('async function assignOrdersToBatch(')
      && source.includes('ORDER_ALREADY_BATCHED'),
    'receiving batches must use explicit selection, transfer existing membership, and reject duplicate creation'
  );
  assert(
    blanksFoundation.includes('function setupMarkInCartOrdered()')
      && blanksFoundation.includes("document.getElementById('blanks-mark-ordered-btn')")
      && blanksFoundation.includes("applyBatchAwareOrderMove(orderNames, 'blanks', { blanksOrdered: 1 })")
      && !blanksFoundation.includes('patchMarkInCartOrdered'),
    'Mark In Cart Ordered must directly persist all cart orders as canonical blanks_ordered state'
  );
  const workerSource = fs.readFileSync(path.join(root, 'order-manager-proxy', 'worker.js'), 'utf8');
  assert(
    webShim.includes('metadataPatch.blanks_ordered = currentBlanksOrdered ? 1 : 0')
      && blanksFoundation.includes("return order.productionStage === 'blanks_ordered';")
      && workerSource.includes("next.readiness.blanksOrdered = next.stage === 'blanks_ordered';"),
    'Shopify Blanks moves must atomically persist and consistently render the ordered substage after reload'
  );
  const desktopCss = fs.readFileSync(path.join(root, 'order-manager-web', 'desktop.css'), 'utf8');
  assert(
    desktopCss.includes('repeat(2, minmax(0, 1fr))'),
    'Shopify desktop work queues must keep a sparse queue in a two-column card grid'
  );
  assert(
    desktopCss.includes('body[data-order-source="shopify"] .production-card')
      && desktopCss.includes('grid-auto-rows: max-content')
      && desktopCss.includes('.production-card.print-card:hover .progress-view')
      && desktopCss.includes('.mockup-slot-unavailable')
      && desktopCss.includes('.production-card.print-card .print-card-details')
      && desktopCss.includes('.print-view-tab.active'),
    'relocated Supplies and Ready to Print cards must share a non-overlapping production layout contract'
  );
  const mobileCss = fs.readFileSync(path.join(root, 'order-manager-web', 'mobile.css'), 'utf8');
  assert(
    mobileCss.includes('body.mobile-mode[data-order-source="shopify"] .production-card.print-card')
      && mobileCss.includes('grid-template-columns: clamp(74px, 24vw, 92px) minmax(0, 1fr)')
      && mobileCss.includes('.production-card.print-card:hover .progress-view')
      && mobileCss.includes('.print-view-tab')
      && mobileCss.includes('min-height: 44px'),
    'mobile Ready to Print cards must keep the same stable preview and always-visible progress contract'
  );
  assert(
    previewHtml.includes('id="print-view-to-print"')
      && previewHtml.includes('id="print-view-printed"')
      && previewHtml.includes('role="tabpanel"')
      && previewHtml.includes('No orders waiting to be printed'),
    'Ready to Print markup must expose accessible To Print and Printed tabs with a named panel'
  );
  assert(
    previewHtml.includes('class="panel-header production-panel-header"')
      && previewHtml.includes('class="production-stage" id="print-section"')
      && previewHtml.includes('class="cards workflow-card-grid" id="col-print"')
      && previewHtml.indexOf('id="print-view-to-print"') < previewHtml.indexOf('id="print-section"')
      && !previewHtml.includes('class="sub-section" id="print-section"'),
    'Shopify production markup must keep its view tabs in the main panel header and expose a flat direct queue stage'
  );
  assert(
    !previewHtml.includes('id="received-bundle-start"')
      && !previewHtml.includes('id="blanks-bundle-start"')
      && !previewHtml.includes('id="print-bundle-start"')
      && !previewHtml.includes('id="blanks-fullscreen-btn"')
      && !previewHtml.includes('id="print-fullscreen-btn"'),
    'obsolete Bundle and Fullscreen entry points must remain absent from the web dashboard'
  );
  assert(
    sharedRenderer.includes("const showBoardPreview = hasMockup || Boolean(o._candidate);")
      && sharedRenderer.includes('class="production-card-statuses"')
      && sharedRenderer.includes("label.textContent = loading ? 'Loading preview' : 'No preview';")
      && sharedRenderer.includes('if (container) container.scrollTop = 0;'),
    'candidate cards must keep stable preview/status anatomy and explicit print-view scroll reset behavior'
  );
  assert(
    desktopCss.includes('Shopify workflow foundation')
      && desktopCss.includes('.workflow-card-grid')
      && desktopCss.includes('.production-panel-header .print-workflow-controls')
      && desktopCss.includes('.shopify-board-card::before')
      && desktopCss.includes('animation: none !important;'),
    'desktop Shopify workflow foundation must own the flat production queue, stable card grid, and quiet loading treatment'
  );
  assert(
    mobileCss.includes('Shopify mobile compatibility for the flattened desktop production panel')
      && mobileCss.includes('[data-active-tab="readyToPrint"] .panel.fulfillment > .production-panel-header')
      && mobileCss.includes('#print-section .workflow-card-grid')
      && mobileCss.includes('grid-template-columns: minmax(0, 1fr);'),
    'mobile must preserve its stage-specific header and phone card geometry after desktop production flattening'
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
      && webShimCode.includes('await onPage(mapped, {')
      && webShimCode.includes('window.updateBoardMockupPreview(current, { resolvePlaceholder: true })'),
    'candidate polling must publish progressive pages while preview hydration preserves cached assets and reconciles only affected cards'
  );
  assert(
    webShimCode.includes('payload.stage === "print" || payload.stage === "completed"')
      && webShimCode.includes('metadataPatch.stage = payload.stage'),
    'progress updates must send print/completed stage together with printed_count when requested'
  );
  const shimContext = vm.createContext({
    document: { body: {} },
    window: {},
    console, Map, Set, Number, String, Array, Object, URL
  });
  vm.runInContext(webShimCode, shimContext);
  const { candidateLineItem, candidateOrderToBoard } = shimContext;
  shimContext.atob = value => Buffer.from(value, 'base64').toString('binary');
  const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  const reusableToken = `header.${tokenPayload}.signature`;
  let idTokenCalls = 0;
  shimContext.window.shopify = {
    async idToken() {
      idTokenCalls += 1;
      return reusableToken;
    },
  };
  assert.equal(await shimContext.getShopifyIdToken(), reusableToken);
  assert.equal(await shimContext.getShopifyIdToken(), reusableToken);
  assert.equal(idTokenCalls, 1, 'adjacent authenticated requests must share one fresh App Bridge token');
  assert.equal(await shimContext.getShopifyIdToken({ force: true }), reusableToken);
  assert.equal(idTokenCalls, 2, 'forced auth recovery must obtain a new App Bridge token');

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

  // 7. Completion repair remains exact, PII-minimized, and dry-run by default.
  const completionFixture = {
    id: 'gid://shopify/Order/1001',
    displayName: '#1001',
    commerce: {
      lineItems: [
        { title: 'Fixture Shirt', currentQuantity: 3 },
        { title: 'DTF Print', currentQuantity: 1 }
      ]
    },
    production: {
      stage: 'print',
      version: 7,
      printedCount: 3,
      archivedAt: null
    }
  };
  assert.equal(repairGarmentCount(completionFixture), 3);
  assert.deepEqual(completionCandidate(completionFixture), {
    id: 'gid://shopify/Order/1001',
    order: '#1001',
    version: 7,
    garmentCount: 3,
    printedCount: 3
  });
  assert.equal(completionCandidate({
    ...completionFixture,
    production: { ...completionFixture.production, archivedAt: '2026-07-30T12:00:00Z' }
  }), null, 'archived orders must never enter the completion repair report');
  assert.equal(parseCompletionRepairArgs([]).execute, false, 'completion repair must default to dry-run');

  // 8. Discount source in worker contract
  assert(source.includes('currentTotalDiscountsSet'), 'Worker query must fetch currentTotalDiscountsSet');
  assert(source.includes('discount: moneyValue(node.currentTotalDiscountsSet'), 'Worker summary normalization must map commerce.discount from currentTotalDiscountsSet');

  console.log('Phase 2 shadow data plane verification passed.');
}

if (require.main === module) run().catch(error => { console.error(error); process.exit(1); });
module.exports = { run };
