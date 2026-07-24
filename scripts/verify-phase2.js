const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
    customer: { displayName: 'Fixture Customer' },
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

    const batchResponse = await worker.fetch(new Request('https://worker.test/order-manager/v1/batches/commit', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderIds: [shopifyNode().id], idempotencyKey: 'batch-fixture-1' }),
    }), env);
    assert.equal(batchResponse.status, 200, 'confirmed supplier batch must commit');
    const batchJson = await batchResponse.json();
    assert.equal(batchJson.supplierOrderNumber, 'SS-9001');
    assert.equal(batchJson.metadataRepairRequired.length, 0);
    assert.equal(productionState.stage, 'blanks_ordered');
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
  const previewController = fs.readFileSync(path.join(root, 'order-manager-web', 'shopify-preview.js'), 'utf8');
  assert(previewController.includes('getShopifyPreviewOrderDetail'), 'preview controller must load details only when an order is opened');
  const webShim = fs.readFileSync(path.join(root, 'order-manager-web', 'web-shim.js'), 'utf8');
  assert(webShim.includes('apiErrorMessage'), 'web errors must render structured Worker errors instead of [object Object]');
  assert(webShim.includes('candidateAssetObjectUrl'), 'Shopify board must hydrate private Designer Studio manifests through authenticated asset tickets');
  assert(source.includes('customAttributes { key value }'), 'Shopify board summaries must retain Designer Studio line-item properties');
  assert(source.includes('designer-studio-sync'), 'Shopify summary reconciliation must import Designer Studio assets into private R2');
  assert(source.includes('designer-studio-assets-v1'), 'active-order Designer Studio backfill must have an idempotent checkpoint');
  const webRenderer = fs.readFileSync(path.join(root, 'order-manager-web', 'renderer.js'), 'utf8');
  assert(webRenderer.includes('assetId'), 'shared web renderer must recognize private manifest assets without public /orders/ URLs');
  const previewCss = fs.readFileSync(path.join(root, 'order-manager-web', 'shopify-preview.css'), 'utf8');
  assert(
    !/body\\[data-order-source=["']shopify["']\\]\\s+#orders-view\\s*\\{[^}]*display:\\s*none/im.test(previewCss),
    'Shopify source must keep the shared operational board visible'
  );
  console.log('Phase 2 shadow data plane verification passed.');
}

if (require.main === module) run().catch(error => { console.error(error); process.exit(1); });
module.exports = { run };
