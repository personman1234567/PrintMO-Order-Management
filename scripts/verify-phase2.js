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

let fixtureShopifyCancelledAt = null;
let fixtureShopifyFulfillmentStatus = 'UNFULFILLED';

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
    displayFulfillmentStatus: fixtureShopifyFulfillmentStatus,
    cancelledAt: fixtureShopifyCancelledAt,
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

function etsyReceiptFixture({ receiptId = 7001, shipped = false } = {}) {
  return {
    receipt_id: receiptId,
    status: 'paid',
    is_paid: true,
    is_canceled: false,
    is_shipped: shipped,
    create_timestamp: 1750000000,
    update_timestamp: 1750000100,
    name: 'Protected Fixture Buyer',
    first_line: 'Do not return this address',
    buyer_email: 'private@example.test',
    message_from_buyer: 'Private production note',
    grandtotal: { amount: 3275, divisor: 100, currency_code: 'USD' },
  };
}

function etsyTransactionFixtures(receiptId = 7001) {
  if (receiptId === 7002) {
    return [{
      transaction_id: 8201,
      receipt_id: 7002,
      listing_id: 9201,
      title: 'Already shipped fixture',
      quantity: 1,
      sku: 'SHIPPED-1',
      variations: [],
      price: { amount: 3275, divisor: 100, currency_code: 'USD' },
    }];
  }
  return [
    {
      transaction_id: 8001, receipt_id: 7001, listing_id: 9001,
      title: 'Fixture garment', quantity: 2, sku: 'B001',
      variations: [
        { property_id: 100, value_id: 200, formatted_name: 'Size', formatted_value: 'Large' },
        { property_id: 101, value_id: 201, formatted_name: 'Color', formatted_value: 'Forest Green' },
        { property_id: 101, value_id: null, formatted_name: 'Personalization', formatted_value: 'Private custom text' }
      ],
      listing_image_id: 9101,
      price: { amount: 1250, divisor: 100, currency_code: 'USD' }
    },
    {
      transaction_id: 8002, receipt_id: 7001, listing_id: 9002,
      title: 'Fixture print', quantity: 1, sku: '', variations: [],
      price: { amount: 775, divisor: 100, currency_code: 'USD' }
    }
  ];
}

function signedEtsyWebhookRequest({
  secret,
  webhookId = 'msg_fixture_delivery_1',
  timestamp = Math.floor(Date.now() / 1000),
  payload = {
    event_type: 'order.paid',
    resource_url: 'https://api.etsy.com/v3/application/shops/98765/receipts/7001',
    shop_id: 98765,
  },
  signatureOverride = null,
} = {}) {
  const body = JSON.stringify(payload);
  const secretBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const signature = signatureOverride || crypto.createHmac('sha256', secretBytes)
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest('base64');
  return new Request('https://worker.test/order-manager/v1/webhooks/etsy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${signature}`,
    },
    body,
  });
}

async function run() {
  console.log('=== Running Phase 2 Shadow Data Plane Verification ===');
  await require('./verify-phase1.js').run();

  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'order-manager-proxy', 'worker.js'), 'utf8');
  const schema = ['0001_redis_free.sql', '0002_designer_asset_metadata.sql', '0003_asset_blob_links.sql', '0004_etsy_connection_probe.sql', '0005_provider_order_shadow.sql', '0006_provider_pilot_idempotency.sql', '0007_etsy_webhook_delivery.sql', '0008_etsy_catalog_previews.sql', '0009_etsy_preview_refresh_and_supplier_skus.sql']
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

  const supplierReportFixture = {
    requestedLines: [{ sku: 'B001', qty: 2 }, { sku: 'B002', qty: 1 }],
    lineSources: [
      { orderId: 'gid://shopify/Order/1', orderName: '#1001', sku: 'B001', title: 'Gildan 5000', variantTitle: 'Black / Medium', qty: 2 },
      { orderId: 'gid://shopify/Order/2', orderName: '#1002', sku: 'B002', title: 'Comfort Colors 1717', variantTitle: 'Blue Jean / Large', qty: 1 },
    ],
    orderIds: ['gid://shopify/Order/1', 'gid://shopify/Order/2'],
    batchId: 'ssb-report-fixture',
    poNumber: 'PM-REPORT-FIXTURE',
  };
  const partialSupplierReport = module.normalizeSupplierCommitReport({
    ...supplierReportFixture,
    payload: {
      Orders: [{ OrderNumber: 'SS-REPORT-1', Lines: [{ Sku: 'B001', QtyOrdered: 2 }] }],
      LineErrors: [{ Identifier: 'B002', Code: 'NO_STOCK', Message: 'No inventory is available for this SKU.' }],
      testOrder: true,
    },
  });
  assert.equal(partialSupplierReport.outcome, 'partial', 'S&S Orders plus LineErrors must become a partial result');
  assert.equal(partialSupplierReport.acceptedOrderCount, 1, 'only orders whose garment SKUs were fully accepted may advance');
  assert.deepEqual(partialSupplierReport.supplierOrderNumbers, ['SS-REPORT-1']);
  assert.deepEqual(partialSupplierReport.rejectedLines[0].orderNames, ['#1002']);
  assert.deepEqual(partialSupplierReport.rejectedLines[0].itemNames, ['Comfort Colors 1717 — Blue Jean / Large']);
  assert.equal(partialSupplierReport.rejectedLines[0].reason, 'No inventory is available for this SKU.');
  assert.equal(partialSupplierReport.orderResults[1].outcome, 'rejected');

  const rejectedSupplierReport = module.normalizeSupplierCommitReport({
    ...supplierReportFixture,
    payload: { code: '400', errors: [{ field: 'lines[0].identifier', message: 'The SKU was not found.' }] },
    error: Object.assign(new Error('Bad Request'), { status: 400 }),
  });
  assert.equal(rejectedSupplierReport.outcome, 'rejected', 'a structured supplier 400 must not be classified as an ambiguous result');
  assert.equal(rejectedSupplierReport.rejectedLines[0].sku, 'B001', 'indexed supplier fields must map back to the requested SKU');
  assert.deepEqual(rejectedSupplierReport.rejectedLines[0].itemNames, ['Gildan 5000 — Black / Medium']);

  const unknownSupplierReport = module.normalizeSupplierCommitReport({
    ...supplierReportFixture,
    payload: { error: 'Gateway timeout' },
    error: Object.assign(new Error('Gateway timeout'), { status: 502 }),
  });
  assert.equal(unknownSupplierReport.outcome, 'unknown', 'supplier transport failures must remain non-retryable unknown results');

  const etsyContract = module.normalizeEtsyOrderContract({
    providerAccountId: 98765,
    fetchedAt: '2026-08-08T22:00:00.000Z',
    receipt: {
      receipt_id: 7001,
      status: 'paid',
      is_paid: true,
      is_shipped: false,
      create_timestamp: 1750000000,
      update_timestamp: 1750000100,
      name: 'Fixture Recipient',
      message_from_buyer: 'Private instructions',
      subtotal: { amount: 2500, divisor: 100, currency_code: 'USD' },
      discount_amt: { amount: 250, divisor: 100, currency_code: 'USD' },
      grandtotal: { amount: 3275, divisor: 100, currency_code: 'USD' },
      refunds: [],
      shipments: [],
      transactions: [{
        transaction_id: 8001,
        receipt_id: 7001,
        listing_id: 9001,
        listing_image_id: 9101,
        title: 'Fixture garment',
        quantity: 2,
        sku: 'B001',
        price: { amount: 1250, divisor: 100, currency_code: 'USD' },
        variations: [
          { property_id: 100, value_id: 200, question_id: null, formatted_name: 'Size', formatted_value: 'Large' },
          { property_id: 101, value_id: 201, question_id: 301, formatted_name: 'Name', formatted_value: 'Private custom text' }
        ],
        product_data: [{ property_id: 100, property_name: 'Size', value_ids: [200], values: ['Large'] }]
      }]
    },
    transactions: [{
      transaction_id: 8001,
      receipt_id: 7001,
      listing_id: 9001,
      title: 'Fixture garment',
      quantity: 2,
      sku: 'B001',
      product_data: null
    }]
  });
  assert.equal(etsyContract.orderKey, 'etsy:98765:7001');
  assert.equal(etsyContract.source.provider, 'etsy');
  assert.equal(etsyContract.source.externalOrderId, '7001');
  assert.equal(etsyContract.commerce.lineItems[0].id, 'etsy:98765:7001:8001');
  assert.equal(etsyContract.commerce.lineItems[0].quantity, 2);
  assert.equal(etsyContract.commerce.lineItems[0].unitPrice, 12.5);
  assert.equal(etsyContract.commerce.lineItems[0].variations.length, 2);
  assert.equal(etsyContract.commerce.lineItems[0].personalization.length, 1);
  assert.equal(etsyContract.commerce.lineItems[0].listingImageIsProductionArtwork, false);
  assert.equal(etsyContract.commerce.hasBuyerMessage, true);
  assert.equal(etsyContract.productionRef.authority, 'printmo-d1');
  assert.equal(etsyContract.capabilities.productionWrite, false, 'Etsy production writes stay disabled before the D1 state contract ships');
  assert(!Object.prototype.hasOwnProperty.call(etsyContract.commerce, 'shippingAddress'), 'bounded Etsy board contract must omit full addresses');
  assert.deepEqual(module.etsyShadowEligibility({ is_paid: true, is_shipped: false }), { eligible: true, reason: 'PAID_UNSHIPPED' });
  assert.deepEqual(module.etsyShadowEligibility({ is_paid: false, is_shipped: false }), { eligible: false, reason: 'NOT_PAID' });
  assert.deepEqual(module.etsyShadowEligibility({ is_paid: true, is_canceled: true }), { eligible: false, reason: 'CANCELED' });
  assert.deepEqual(module.etsyShadowEligibility({ is_paid: true, is_shipped: true }), { eligible: false, reason: 'ALREADY_SHIPPED' });
  assert.throws(
    () => module.normalizeEtsyOrderContract({ providerAccountId: 'bad:id', receipt: { receipt_id: 7001 } }),
    /shop ID is invalid/,
    'provider identity must reject ambiguous or delimiter-bearing Etsy shop IDs'
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
    ETSY_API_KEY: 'etsy-fixture-key', ETSY_SHARED_SECRET: 'etsy-fixture-secret',
    ETSY_REDIRECT_URI: 'https://worker.test/order-manager/v1/oauth/etsy/callback',
    ETSY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
    ETSY_WEBHOOK_CALLBACK_URL: 'https://worker.test/order-manager/v1/webhooks/etsy',
    ETSY_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32, 9).toString('base64')}`,
    ETSY_WEBHOOK_ENROLLMENT_ENABLED: '0',
    ETSY_WEBHOOK_RECONCILIATION_ENABLED: '1',
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
  let etsyReconciliationReceipts = [];
  let etsyTransientReceiptFailures = 0;
  const calls = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target === 'https://api.etsy.com/v3/application/openapi-ping') {
      assert.equal(options.headers['x-api-key'], `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`);
      assert.equal(options.headers.Authorization, undefined, 'Etsy API-key preflight must not send an OAuth token');
      return Response.json({ application_id: env.ETSY_API_KEY });
    }
    if (target === 'https://api.etsy.com/v3/public/oauth/token') {
      const request = new URLSearchParams(String(options.body || ''));
      if (request.get('grant_type') === 'authorization_code') {
        assert(request.get('code_verifier'), 'Etsy authorization exchange must include the PKCE verifier');
        assert.equal(request.get('redirect_uri'), env.ETSY_REDIRECT_URI, 'Etsy token exchange must retain the exact callback URL');
        return Response.json({
          access_token: '12345.initial-access', refresh_token: '12345.initial-refresh',
          token_type: 'Bearer', expires_in: 3600, scope: 'transactions_r'
        });
      }
      if (request.get('grant_type') === 'refresh_token') {
        assert.equal(request.get('refresh_token'), '12345.initial-refresh');
        return Response.json({
          access_token: '12345.refreshed-access', refresh_token: '12345.refreshed-refresh',
          token_type: 'Bearer', expires_in: 3600, scope: 'transactions_r'
        });
      }
      throw new Error(`Unexpected Etsy token grant: ${request.get('grant_type')}`);
    }
    if (target === 'https://api.etsy.com/v3/application/users/12345/shops') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.initial-access', 'shop identity lookup must remain bound to the authorized owner token');
      return Response.json({ shop_id: 98765, user_id: 12345, shop_name: 'PrintMOFixture' });
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts?limit=1&offset=0') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      return Response.json({ count: 1, results: [etsyReceiptFixture()] });
    }
    if (target.startsWith('https://api.etsy.com/v3/application/shops/98765/receipts?')) {
      const parsed = new URL(target);
      if (parsed.searchParams.has('min_last_modified')) {
        assert.equal(parsed.searchParams.get('was_paid'), 'true');
        assert.equal(parsed.searchParams.get('was_shipped'), 'false');
        assert.equal(parsed.searchParams.get('sort_on'), 'updated');
        const offset = Number(parsed.searchParams.get('offset') || 0);
        return Response.json({
          count: etsyReconciliationReceipts.length,
          results: offset === 0 ? etsyReconciliationReceipts : [],
        });
      }
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts/7001') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      return Response.json(etsyReceiptFixture());
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts/7002') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      return Response.json(etsyReceiptFixture({ receiptId: 7002, shipped: true }));
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts/7004') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      if (etsyTransientReceiptFailures > 0) {
        etsyTransientReceiptFailures -= 1;
        return Response.json({ error: 'temporary fixture failure' }, { status: 503, headers: { 'Retry-After': '1' } });
      }
      return Response.json(etsyReceiptFixture({ receiptId: 7004 }));
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts/7005') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      return Response.json(etsyReceiptFixture({ receiptId: 7005 }));
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts/7001/transactions') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      return Response.json({ count: 2, results: etsyTransactionFixtures() });
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts/7002/transactions') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      return Response.json({ count: 1, results: etsyTransactionFixtures(7002) });
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts/7004/transactions') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      return Response.json({ count: 2, results: etsyTransactionFixtures(7004) });
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/receipts/7005/transactions') {
      assert.equal(options.headers.Authorization, 'Bearer 12345.refreshed-access');
      return Response.json({ count: 2, results: etsyTransactionFixtures(7005) });
    }
    if (target === 'https://api.etsy.com/v3/application/listings/9001/images/9101') {
      assert.equal(options.headers.Authorization, undefined, 'listing-image proof must use only the app key');
      assert.equal(options.headers['x-api-key'], `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`);
      return Response.json({
        listing_id: 9001,
        listing_image_id: 9101,
        url_75x75: 'https://i.etsystatic.com/9001-9101-75.jpg',
        url_570xN: 'https://i.etsystatic.com/9001-9101-570.jpg',
        url_fullxfull: 'https://i.etsystatic.com/9001-9101-full.jpg',
        full_width: 2000,
        full_height: 2500
      });
    }
    if (target === 'https://i.etsystatic.com/9001-9101-570.jpg') {
      return new Response(new TextEncoder().encode('etsy-preview-image-9001-9101'), {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '28' }
      });
    }
    if (target === 'https://api.etsy.com/v3/application/listings/9001') {
      assert.equal(options.headers.Authorization, undefined, 'catalog ownership proof must use only the app key');
      assert.equal(options.headers['x-api-key'], `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`);
      return Response.json({ listing_id: 9001, shop_id: 98765, title: 'Private Fixture Listing Title' });
    }
    if (target === 'https://api.etsy.com/v3/application/listings/9002') {
      assert.equal(options.headers.Authorization, undefined, 'foreign-listing rejection must use only the app key');
      assert.equal(options.headers['x-api-key'], `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`);
      return Response.json({ listing_id: 9002, shop_id: 12345, title: 'Foreign Fixture Listing' });
    }
    if (target === 'https://api.etsy.com/v3/application/shops/98765/listings/9001/variation-images') {
      assert.equal(options.headers.Authorization, undefined, 'variation-image proof must use only the app key');
      assert.equal(options.headers['x-api-key'], `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`);
      return Response.json({
        count: 1,
        results: [{ property_id: 101, value_id: 201, value: 'Forest Green', image_id: 9101 }]
      });
    }
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
              displayFulfillmentStatus: shopifyNode().displayFulfillmentStatus,
              cancelledAt: shopifyNode().cancelledAt,
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
                displayFulfillmentStatus: shopifyNode().displayFulfillmentStatus,
                cancelledAt: shopifyNode().cancelledAt,
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
      const providerBatch = request.lines?.length === 1 && request.lines[0]?.sku === 'B10259505';
      assert.deepEqual(request.lines, providerBatch ? [{ sku: 'B10259505', qty: 2 }] : [{ sku: 'B001', qty: 2 }, { sku: 'B002', qty: 1 }]);
      return Response.json({
        ok: true,
        orderNumber: providerBatch ? 'SS-ETSY-9001' : 'SS-9001',
        count: providerBatch ? 1 : 2,
        subtotal: providerBatch ? 5.5 : 8.5,
        skuCount: providerBatch ? 1 : 2,
        testOrder: true,
      });
    }
    if (target.includes('/order-manager/v1/data/legacy?')) return Response.json({ records: [], total: 0, nextOffset: null });
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const disconnectedEtsyStatus = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/integrations/etsy/status', { headers }),
      env
    );
    assert.equal(disconnectedEtsyStatus.status, 200);
    assert.equal((await disconnectedEtsyStatus.json()).connected, false, 'Etsy must begin disconnected');

    const etsyConnect = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/integrations/etsy/connect', { method: 'POST', headers }),
      env
    );
    assert.equal(etsyConnect.status, 201, 'authenticated owner must be able to start Etsy OAuth');
    assert(calls.some(call => call.target === 'https://api.etsy.com/v3/application/openapi-ping'), 'Etsy OAuth must preflight the configured key before creating a session');
    const etsyConnectJson = await etsyConnect.json();
    const etsyAuthorizationUrl = new URL(etsyConnectJson.authorizationUrl);
    assert.equal(etsyAuthorizationUrl.origin, 'https://www.etsy.com');
    assert.equal(etsyAuthorizationUrl.searchParams.get('scope'), 'transactions_r', 'Etsy proof must request read-only transactions only');
    assert.equal(etsyAuthorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(etsyConnectJson.callbackUrl, env.ETSY_REDIRECT_URI);
    const etsyState = etsyAuthorizationUrl.searchParams.get('state');
    assert(etsyState, 'Etsy OAuth start must issue single-use state');
    const etsySession = await env.ORDER_DB.prepare('SELECT * FROM etsy_oauth_sessions').first();
    assert(etsySession, 'Etsy OAuth start must persist its short-lived server-side session');
    assert(!JSON.stringify(etsySession).includes(etsyState), 'raw Etsy OAuth state must not be stored in D1');

    const etsyCallback = await worker.fetch(new Request(
      `${env.ETSY_REDIRECT_URI}?code=fixture-code&state=${encodeURIComponent(etsyState)}`
    ), env);
    assert.equal(etsyCallback.status, 200, 'valid Etsy state and PKCE exchange must connect the shop');
    assert((await etsyCallback.text()).includes('PrintMOFixture'));
    const connectedRow = await env.ORDER_DB.prepare('SELECT * FROM etsy_connections WHERE id = ?').bind('primary').first();
    assert.equal(connectedRow.etsy_shop_id, '98765');
    assert(!connectedRow.token_ciphertext.includes('initial-access'), 'Etsy access token must be encrypted at rest');
    assert(!connectedRow.token_ciphertext.includes('initial-refresh'), 'Etsy refresh token must be encrypted at rest');

    const replayedEtsyCallback = await worker.fetch(new Request(
      `${env.ETSY_REDIRECT_URI}?code=replayed-code&state=${encodeURIComponent(etsyState)}`
    ), env);
    assert.equal(replayedEtsyCallback.status, 400, 'Etsy OAuth state must be single-use');

    const etsyRead = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/test-read',
      { method: 'POST', headers, body: JSON.stringify({ forceRefresh: true, includeFieldShape: true }) }
    ), env);
    assert.equal(etsyRead.status, 200, 'Etsy connection proof must read a bounded receipt and its transactions');
    const etsyReadText = await etsyRead.text();
    assert(!etsyReadText.includes('Protected Fixture Buyer'), 'Etsy proof response must not expose buyer identity');
    assert(!etsyReadText.includes('private@example.test'), 'Etsy proof response must not expose buyer email');
    assert(!etsyReadText.includes('Do not return this address'), 'Etsy proof response must not expose buyer address');
    assert(!etsyReadText.includes('Private production note'), 'Etsy field inventory must not expose buyer messages');
    assert(!etsyReadText.includes('Private custom text'), 'Etsy field inventory must not expose personalization values');
    assert(!etsyReadText.includes('refreshed-access'), 'Etsy proof response must not expose OAuth tokens');
    const etsyReadJson = JSON.parse(etsyReadText);
    assert.equal(etsyReadJson.tokenRefreshed, true, 'forced proof must verify the refresh-token path');
    assert.equal(etsyReadJson.receiptRead.transactionCount, 2);
    assert.equal(etsyReadJson.customerDataRetained, false);
    assert.equal(etsyReadJson.boardChanged, false);
    assert.equal(etsyReadJson.fieldShape.schemaVersion, 1);
    assert.equal(etsyReadJson.fieldShape.customerValuesIncluded, false);
    assert.equal(etsyReadJson.fieldShape.receipt.valuesIncluded, false);
    assert.equal(etsyReadJson.fieldShape.transactions.valuesIncluded, false);
    assert(
      etsyReadJson.fieldShape.receipt.fields.some(field => field.path === 'buyer_email' && field.types.includes('string')),
      'Etsy field inventory must retain receipt field names and types without their values'
    );
    assert(
      etsyReadJson.fieldShape.transactions.fields.some(
        field => field.path === '$[].variations[].formatted_value' && field.types.includes('string')
      ),
      'Etsy field inventory must retain nested variation and personalization field shape'
    );
    assert(
      etsyReadJson.fieldShape.transactions.fields.some(
        field => field.path === '$[].variations[].value_id' && field.types.includes('integer') && field.types.includes('null')
      ),
      'Etsy field inventory must preserve observed nullable type unions'
    );

    const providerRowsBeforeListingImageProbe = await env.ORDER_DB.prepare(
      'SELECT COUNT(*) AS count FROM provider_order_projection'
    ).first();
    const listingImageProbe = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/listing-image-probe',
      { method: 'POST', headers, body: JSON.stringify({ receiptId: 7001, transactionId: 8001 }) }
    ), env);
    assert.equal(listingImageProbe.status, 200, 'a receipt-backed listing image probe must remain an authenticated read-only operation');
    const listingImageProbeText = await listingImageProbe.text();
    assert(!listingImageProbeText.includes('Protected Fixture Buyer'), 'listing image proof must not expose buyer identity');
    assert(!listingImageProbeText.includes('private@example.test'), 'listing image proof must not expose buyer email');
    assert(!listingImageProbeText.includes('Private custom text'), 'listing image proof must not expose personalization values');
    assert(!listingImageProbeText.includes('images.example.test'), 'listing image proof must not expose image URLs');
    const listingImageProbeJson = JSON.parse(listingImageProbeText);
    assert.equal(listingImageProbeJson.scope, 'transactions_r');
    assert.equal(listingImageProbeJson.boardChanged, false);
    assert.equal(listingImageProbeJson.imageBytesStored, false);
    assert.equal(listingImageProbeJson.customerDataIncluded, false);
    assert.equal(listingImageProbeJson.imageUrlIncluded, false);
    assert.equal(listingImageProbeJson.preview.listingId, '9001');
    assert.equal(listingImageProbeJson.preview.listingImageId, '9101');
    assert.deepEqual(listingImageProbeJson.preview.dimensions, { width: 2000, height: 2500 });
    assert.deepEqual(listingImageProbeJson.preview.renditionsAvailable, { thumbnail: true, standard: true, full: true });
    assert.equal(listingImageProbeJson.preview.purchasedVariationEvidence.verdict, 'MATCHED');
    assert.equal(listingImageProbeJson.preview.purchasedVariationEvidence.purchasedOptionCount, 2, 'personalization must be excluded from visual-variation matching');
    assert.equal(listingImageProbeJson.preview.purchasedVariationEvidence.transactionImageMatchesPurchasedVariation, true);
    const providerRowsAfterListingImageProbe = await env.ORDER_DB.prepare(
      'SELECT COUNT(*) AS count FROM provider_order_projection'
    ).first();
    assert.equal(providerRowsAfterListingImageProbe.count, providerRowsBeforeListingImageProbe.count, 'listing image proof must not create or change a provider projection');
    const catalogVariationOptions = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-image-probe',
      { method: 'POST', headers, body: JSON.stringify({ listingId: 9001 }) }
    ), env);
    assert.equal(catalogVariationOptions.status, 200, 'a catalog probe with only a listing ID must reveal safe mapped variation choices');
    const catalogVariationOptionsJson = await catalogVariationOptions.json();
    assert.equal(catalogVariationOptionsJson.probe, 'catalog-variation-options');
    assert.deepEqual(catalogVariationOptionsJson.variationOptions, [{
      propertyId: '101', valueId: '201', value: 'Forest Green', imageMapped: true
    }]);
    const catalogImageProbe = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-image-probe',
      { method: 'POST', headers, body: JSON.stringify({ listingId: 9001, propertyId: 101, valueId: 201 }) }
    ), env);
    assert.equal(catalogImageProbe.status, 200, 'a catalog-only listing image probe must verify an owner-selected color without an Etsy receipt');
    const catalogImageProbeText = await catalogImageProbe.text();
    assert(!catalogImageProbeText.includes('Private Fixture Listing Title'), 'catalog image proof must not return listing title data');
    assert(!catalogImageProbeText.includes('images.example.test'), 'catalog image proof must not return image URLs');
    const catalogImageProbeJson = JSON.parse(catalogImageProbeText);
    assert.equal(catalogImageProbeJson.probe, 'catalog-variation-image');
    assert.equal(catalogImageProbeJson.catalogReadAuthorization, 'api_key');
    assert.equal(catalogImageProbeJson.connectionScope, 'transactions_r');
    assert.equal(catalogImageProbeJson.boardChanged, false);
    assert.equal(catalogImageProbeJson.imageBytesStored, false);
    assert.equal(catalogImageProbeJson.customerDataIncluded, false);
    assert.equal(catalogImageProbeJson.imageUrlIncluded, false);
    assert.equal(catalogImageProbeJson.preview.listingId, '9001');
    assert.equal(catalogImageProbeJson.preview.listingImageId, '9101');
    assert.deepEqual(catalogImageProbeJson.preview.selectedVariation, {
      propertyId: '101', valueId: '201', value: 'Forest Green', imageMapped: true
    });
    const providerRowsAfterCatalogImageProbe = await env.ORDER_DB.prepare(
      'SELECT COUNT(*) AS count FROM provider_order_projection'
    ).first();
    assert.equal(providerRowsAfterCatalogImageProbe.count, providerRowsBeforeListingImageProbe.count, 'catalog image proof must not create or change a provider projection');
    const catalogPreviewDryRun = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-preview-sync',
      { method: 'POST', headers, body: JSON.stringify({ listings: ['https://www.etsy.com/listing/9001/fixture-listing'] }) }
    ), env);
    assert.equal(catalogPreviewDryRun.status, 200, 'catalog preview sync must default to a safe dry run');
    const catalogPreviewDryRunText = await catalogPreviewDryRun.text();
    assert(!catalogPreviewDryRunText.includes('i.etsystatic.com'), 'catalog preview dry run must not return Etsy rendition URLs');
    const catalogPreviewDryRunJson = JSON.parse(catalogPreviewDryRunText);
    assert.equal(catalogPreviewDryRunJson.mode, 'dry_run');
    assert.equal(catalogPreviewDryRunJson.boardChanged, false);
    assert.equal(catalogPreviewDryRunJson.orderDataChanged, false);
    assert.equal(catalogPreviewDryRunJson.productionArtworkChanged, false);
    assert.equal(catalogPreviewDryRunJson.report.wouldImport, 1);
    assert.equal(catalogPreviewDryRunJson.report.imported, 0);
    assert.equal(catalogPreviewDryRunJson.report.listings[0].variations[0].outcome, 'would_import');
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM etsy_catalog_preview_mappings').first()).count,
      0,
      'catalog preview dry runs must not write mappings'
    );
    const catalogPreviewExecute = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-preview-sync',
      { method: 'POST', headers, body: JSON.stringify({ listings: [9001], execute: true }) }
    ), env);
    assert.equal(catalogPreviewExecute.status, 200, 'catalog preview execute must cache the mapped Etsy image privately');
    const catalogPreviewExecuteText = await catalogPreviewExecute.text();
    assert(!catalogPreviewExecuteText.includes('i.etsystatic.com'), 'catalog preview execute must not return Etsy rendition URLs');
    const catalogPreviewExecuteJson = JSON.parse(catalogPreviewExecuteText);
    assert.equal(catalogPreviewExecuteJson.mode, 'execute');
    assert.equal(catalogPreviewExecuteJson.report.imported, 1);
    const catalogPreviewId = catalogPreviewExecuteJson.report.listings[0].variations[0].previewId;
    assert(catalogPreviewId, 'catalog preview execute must return only an opaque preview ID');
    const catalogPreviewMapping = await env.ORDER_DB.prepare(`
      SELECT mappings.id, mappings.shop_id, mappings.listing_image_id, mappings.source_type, mappings.resolution_mode,
             blobs.object_key, blobs.content_type, blobs.state AS blob_state
      FROM etsy_catalog_preview_mappings AS mappings
      JOIN etsy_catalog_preview_blobs AS blobs ON blobs.id = mappings.blob_id
      WHERE mappings.id = ?
    `).bind(catalogPreviewId).first();
    assert.equal(catalogPreviewMapping.listing_image_id, '9101');
    assert.equal(catalogPreviewMapping.source_type, 'etsy');
    assert.equal(catalogPreviewMapping.resolution_mode, 'direct');
    assert.equal(catalogPreviewMapping.content_type, 'image/jpeg');
    assert.equal(catalogPreviewMapping.blob_state, 'active');
    assert(privateObjects.has(catalogPreviewMapping.object_key), 'catalog preview execute must write private R2 bytes');
    const catalogPreviewBlob = await env.ORDER_DB.prepare(
      'SELECT blob_id FROM etsy_catalog_preview_mappings WHERE id = ?'
    ).bind(catalogPreviewId).first();
    const catalogPreviewTicket = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/catalog-previews/${encodeURIComponent(catalogPreviewId)}/read-ticket`,
      { method: 'POST', headers }
    ), env);
    assert.equal(catalogPreviewTicket.status, 200, 'catalog preview must issue a short-lived opaque read ticket');
    const catalogPreviewTicketJson = await catalogPreviewTicket.json();
    assert.equal(catalogPreviewTicketJson.previewId, catalogPreviewId);
    assert(!catalogPreviewTicketJson.url.includes(catalogPreviewMapping.object_key), 'catalog preview ticket must never reveal the R2 object key');
    const catalogPreviewRead = await worker.fetch(new Request(`https://worker.test${catalogPreviewTicketJson.url}`), env);
    assert.equal(catalogPreviewRead.status, 200, 'catalog preview signed read must resolve private R2 bytes');
    assert.equal(catalogPreviewRead.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(await catalogPreviewRead.text(), 'etsy-preview-image-9001-9101');
    const catalogPreviewBadRead = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/catalog-previews/${encodeURIComponent(catalogPreviewId)}/read?ticket=bad`
    ), env);
    assert.equal(catalogPreviewBadRead.status, 401, 'catalog preview reads must reject unsigned requests');
    const catalogPreviewRepeat = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-preview-sync',
      { method: 'POST', headers, body: JSON.stringify({ listings: [9001], execute: true }) }
    ), env);
    assert.equal(catalogPreviewRepeat.status, 200);
    const catalogPreviewRepeatJson = await catalogPreviewRepeat.json();
    assert.equal(catalogPreviewRepeatJson.report.imported, 0, 'identical catalog sync must not rewrite the existing mapping');
    assert.equal(catalogPreviewRepeatJson.report.unchanged, 1, 'identical catalog sync must report the existing preview');
    assert.equal(
      calls.filter(call => call.target === 'https://i.etsystatic.com/9001-9101-570.jpg').length,
      1,
      'an idempotent sync must not redownload an unchanged Etsy image'
    );
    const previewRefreshReview = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-preview-refresh',
      { method: 'POST', headers, body: JSON.stringify({ listings: [9001] }) }
    ), env);
    assert.equal(previewRefreshReview.status, 200, 'preview refresh must provide a read-only human review before changing cached mappings');
    const previewRefreshReviewJson = await previewRefreshReview.json();
    assert.equal(previewRefreshReviewJson.mode, 'review');
    assert.equal(previewRefreshReviewJson.plans[0].variations[0].proposedAction, 'unchanged');
    await env.ORDER_DB.prepare(`
      UPDATE etsy_catalog_preview_mappings SET listing_image_id = 'obsolete-image'
      WHERE id = ?
    `).bind(catalogPreviewId).run();
    await env.ORDER_DB.prepare(`
      INSERT INTO etsy_catalog_preview_mappings (
        id, shop_id, etsy_shop_id, etsy_listing_id, property_id, value_id, listing_image_id,
        source_type, resolution_mode, blob_id, state, created_by, created_at, updated_at, deleted_at
      ) VALUES ('fixture-stale-preview', 1, '98765', '9001', '102', '202', 'stale-image', 'etsy', 'direct', ?, 'active', 'fixture', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL)
    `).bind(catalogPreviewBlob.blob_id).run();
    const previewRefreshChanged = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-preview-refresh',
      { method: 'POST', headers, body: JSON.stringify({ listings: [9001] }) }
    ), env);
    const previewRefreshChangedJson = await previewRefreshChanged.json();
    assert.deepEqual(
      previewRefreshChangedJson.plans[0].variations.map(variation => variation.proposedAction).sort(),
      ['archive', 'update'],
      'refresh review must distinguish an Etsy replacement from a mapping Etsy removed'
    );
    const previewRefreshExecute = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-preview-refresh',
      { method: 'POST', headers, body: JSON.stringify({
        listings: [9001], execute: true,
        actions: [
          { propertyId: '101', valueId: '201', action: 'update' },
          { propertyId: '102', valueId: '202', action: 'archive' }
        ]
      }) }
    ), env);
    assert.equal(previewRefreshExecute.status, 200, 'only owner-selected preview refresh actions may write');
    assert.deepEqual((await previewRefreshExecute.json()).applied.map(action => action.outcome).sort(), ['archived', 'updated']);
    assert.equal((await env.ORDER_DB.prepare("SELECT state FROM etsy_catalog_preview_mappings WHERE id = 'fixture-stale-preview'").first()).state, 'deleted');
    const blankRecipeReview = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/blank-recipe',
      { method: 'POST', headers, body: JSON.stringify({
        listingId: 9001,
        supplier: { name: 'ss', snapshotDate: '2026-08-10', brand: 'Tultex', style: '202' },
        variants: [{
          selections: [{ propertyId: 100, valueId: 200 }, { propertyId: 101, valueId: 201 }],
          supplierSku: 'B10259505', supplierColor: 'Forest Green', supplierSize: 'L'
        }]
      }) }
    ), env);
    assert.equal(blankRecipeReview.status, 200, 'blank recipes must preview exact selector-to-S&S-SKU mappings before write');
    assert.equal((await blankRecipeReview.json()).mode, 'review');
    const blankRecipeExecute = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/blank-recipe',
      { method: 'POST', headers, body: JSON.stringify({
        listingId: 9001, execute: true,
        supplier: { name: 'ss', snapshotDate: '2026-08-10', brand: 'Tultex', style: '202' },
        variants: [{
          selections: [{ propertyId: 100, valueId: 200 }, { propertyId: 101, valueId: 201 }],
          supplierSku: 'B10259505', supplierColor: 'Forest Green', supplierSize: 'L'
        }]
      }) }
    ), env);
    assert.equal(blankRecipeExecute.status, 200, 'confirmed blank recipe setup must store an exact supplier mapping');
    assert.equal((await blankRecipeExecute.json()).mappedVariants, 1);
    const providerRowsAfterCatalogPreviewSync = await env.ORDER_DB.prepare(
      'SELECT COUNT(*) AS count FROM provider_order_projection'
    ).first();
    assert.equal(providerRowsAfterCatalogPreviewSync.count, providerRowsBeforeListingImageProbe.count, 'catalog preview sync must not create or change a provider projection');
    const foreignListingProbe = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/catalog-image-probe',
      { method: 'POST', headers, body: JSON.stringify({ listingId: 9002, propertyId: 101, valueId: 201 }) }
    ), env);
    assert.equal(foreignListingProbe.status, 403, 'catalog image proof must reject listings outside the connected Etsy shop');
    const missingProbeTransaction = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/listing-image-probe',
      { method: 'POST', headers, body: JSON.stringify({ receiptId: 7001, transactionId: 8999 }) }
    ), env);
    assert.equal(missingProbeTransaction.status, 404, 'listing image proof must reject a transaction outside the requested receipt');

    const connectedEtsyStatus = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/integrations/etsy/status', { headers }),
      env
    );
    const connectedEtsyStatusJson = await connectedEtsyStatus.json();
    assert.equal(connectedEtsyStatusJson.connected, true);
    assert.equal(connectedEtsyStatusJson.shop.name, 'PrintMOFixture');
    assert(!JSON.stringify(connectedEtsyStatusJson).includes('refreshed-refresh'), 'Etsy status must not expose refresh tokens');

    const webhookTasks = [];
    const validEtsyWebhook = await worker.fetch(
      signedEtsyWebhookRequest({ secret: env.ETSY_WEBHOOK_SECRET }),
      env,
      { waitUntil(promise) { webhookTasks.push(promise); } }
    );
    assert.equal(validEtsyWebhook.status, 202, 'a valid Etsy signature must durably accept order.paid without bearer auth');
    assert.deepEqual(await validEtsyWebhook.json(), { ok: true, accepted: true });
    await Promise.all(webhookTasks);
    const webhookDelivery = await env.ORDER_DB.prepare(`
      SELECT event_type, etsy_shop_id, receipt_id, state, outcome_code, error_code, attempt_count
      FROM etsy_webhook_deliveries
      WHERE webhook_id = ?
    `).bind('msg_fixture_delivery_1').first();
    assert.equal(webhookDelivery.event_type, 'order.paid');
    assert.equal(webhookDelivery.etsy_shop_id, '98765');
    assert.equal(webhookDelivery.receipt_id, '7001');
    assert.equal(webhookDelivery.state, 'processed');
    assert.equal(webhookDelivery.outcome_code, 'SHADOW_SYNCED');
    assert.equal(webhookDelivery.error_code, null);
    assert.equal(webhookDelivery.attempt_count, 1);
    const webhookProjection = await env.ORDER_DB.prepare(`
      SELECT enrollment_state, board_enrolled, commerce_json
      FROM provider_order_projection
      WHERE order_key = 'etsy:98765:7001'
    `).first();
    assert.equal(webhookProjection.enrollment_state, 'shadow', 'webhooks must default to hidden shadow persistence');
    assert.equal(webhookProjection.board_enrolled, 0, 'automatic enrollment must remain off by default');
    assert(webhookProjection.commerce_json.includes('"supplierSku":"B10259505"'), 'a configured Etsy blank recipe must resolve the receipt line to the exact S&S SKU');
    assert(webhookProjection.commerce_json.includes('"sourceSku":"B001"'), 'the Etsy source SKU must be retained separately from the S&S supplier SKU');
    assert(!webhookProjection.commerce_json.includes('private@example.test'), 'webhook projection must omit buyer email');
    const webhookLedgerJson = JSON.stringify(await env.ORDER_DB.prepare(
      'SELECT * FROM etsy_webhook_deliveries WHERE webhook_id = ?'
    ).bind('msg_fixture_delivery_1').first());
    assert(!webhookLedgerJson.includes('Protected Fixture Buyer'), 'webhook ledger must not retain raw customer payloads');
    assert(!webhookLedgerJson.includes('private@example.test'), 'webhook ledger must not retain buyer email');

    const duplicateEtsyWebhook = await worker.fetch(
      signedEtsyWebhookRequest({ secret: env.ETSY_WEBHOOK_SECRET }),
      env,
      { waitUntil() { throw new Error('duplicate Etsy deliveries must not schedule processing'); } }
    );
    assert.equal(duplicateEtsyWebhook.status, 200);
    assert.equal((await duplicateEtsyWebhook.json()).duplicate, true);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM etsy_webhook_deliveries').first()).count,
      1,
      'same webhook-id replay must remain a single durable delivery'
    );

    const invalidEtsySignature = await worker.fetch(
      signedEtsyWebhookRequest({ secret: env.ETSY_WEBHOOK_SECRET, webhookId: 'msg_invalid_signature', signatureOverride: 'invalidsignature==' }),
      env
    );
    assert.equal(invalidEtsySignature.status, 401, 'forged Etsy signatures must fail closed');
    assert.equal((await invalidEtsySignature.json()).error.code, 'ETSY_WEBHOOK_SIGNATURE_INVALID');

    const staleEtsyWebhook = await worker.fetch(
      signedEtsyWebhookRequest({
        secret: env.ETSY_WEBHOOK_SECRET,
        webhookId: 'msg_stale_delivery_1',
        timestamp: Math.floor(Date.now() / 1000) - 301,
      }),
      env
    );
    assert.equal(staleEtsyWebhook.status, 401, 'signed Etsy deliveries outside the replay window must be rejected');
    assert.equal((await staleEtsyWebhook.json()).error.code, 'ETSY_WEBHOOK_TIMESTAMP_STALE');

    const wrongShopWebhook = await worker.fetch(
      signedEtsyWebhookRequest({
        secret: env.ETSY_WEBHOOK_SECRET,
        webhookId: 'msg_wrong_shop_1',
        payload: {
          event_type: 'order.paid',
          resource_url: 'https://api.etsy.com/v3/application/shops/99999/receipts/7001',
          shop_id: 99999,
        },
      }),
      env
    );
    assert.equal(wrongShopWebhook.status, 403, 'a valid signature for another Etsy shop must not cross the owner boundary');
    assert.equal((await wrongShopWebhook.json()).error.code, 'ETSY_WEBHOOK_SHOP_INVALID');

    const unsafeResourceWebhook = await worker.fetch(
      signedEtsyWebhookRequest({
        secret: env.ETSY_WEBHOOK_SECRET,
        webhookId: 'msg_unsafe_resource_1',
        payload: {
          event_type: 'order.paid',
          resource_url: 'https://attacker.example.test/v3/application/shops/98765/receipts/7001',
          shop_id: 98765,
        },
      }),
      env
    );
    assert.equal(unsafeResourceWebhook.status, 400, 'webhook resource URLs must not become arbitrary server-side fetches');
    assert.equal((await unsafeResourceWebhook.json()).error.code, 'ETSY_WEBHOOK_RESOURCE_INVALID');

    const conflictingEtsyWebhook = await worker.fetch(
      signedEtsyWebhookRequest({
        secret: env.ETSY_WEBHOOK_SECRET,
        payload: {
          event_type: 'order.paid',
          resource_url: 'https://api.etsy.com/v3/application/shops/98765/receipts/7002',
          shop_id: 98765,
        },
      }),
      env
    );
    assert.equal(conflictingEtsyWebhook.status, 409, 'a reused webhook-id with changed content must be treated as a conflict');
    assert.equal((await conflictingEtsyWebhook.json()).error.code, 'ETSY_WEBHOOK_ID_CONFLICT');

    const unconfiguredEtsyWebhook = await worker.fetch(
      signedEtsyWebhookRequest({ secret: env.ETSY_WEBHOOK_SECRET, webhookId: 'msg_unconfigured_1' }),
      { ...env, ETSY_WEBHOOK_SECRET: '' }
    );
    assert.equal(unconfiguredEtsyWebhook.status, 503, 'the public endpoint must fail closed before its signing secret is installed');
    assert.equal((await unconfiguredEtsyWebhook.json()).error.code, 'ETSY_WEBHOOK_NOT_CONFIGURED');

    etsyTransientReceiptFailures = 1;
    const transientTasks = [];
    const transientEtsyWebhook = await worker.fetch(
      signedEtsyWebhookRequest({
        secret: env.ETSY_WEBHOOK_SECRET,
        webhookId: 'msg_transient_delivery_1',
        payload: {
          event_type: 'order.paid',
          resource_url: 'https://api.etsy.com/v3/application/shops/98765/receipts/7004',
          shop_id: 98765,
        },
      }),
      env,
      { waitUntil(promise) { transientTasks.push(promise); } }
    );
    assert.equal(transientEtsyWebhook.status, 202);
    await Promise.all(transientTasks);
    const retryingDelivery = await env.ORDER_DB.prepare(`
      SELECT state, outcome_code, error_code, attempt_count, next_attempt_at
      FROM etsy_webhook_deliveries
      WHERE webhook_id = 'msg_transient_delivery_1'
    `).first();
    assert.equal(retryingDelivery.state, 'retry');
    assert.equal(retryingDelivery.outcome_code, 'RETRY_SCHEDULED');
    assert.equal(retryingDelivery.error_code, 'ETSY_RECEIPT_READ_FAILED');
    assert.equal(retryingDelivery.attempt_count, 1);
    assert(retryingDelivery.next_attempt_at, 'temporary Etsy failures must receive a durable retry time');
    await env.ORDER_DB.prepare(`
      UPDATE etsy_webhook_deliveries
      SET next_attempt_at = ?
      WHERE webhook_id = 'msg_transient_delivery_1'
    `).bind(new Date(Date.now() - 1000).toISOString()).run();
    const maintenanceTasks = [];
    await worker.scheduled(
      { cron: '*/5 * * * *' },
      env,
      { waitUntil(promise) { maintenanceTasks.push(promise); } }
    );
    await Promise.all(maintenanceTasks);
    const recoveredDelivery = await env.ORDER_DB.prepare(`
      SELECT state, outcome_code, error_code, attempt_count
      FROM etsy_webhook_deliveries
      WHERE webhook_id = 'msg_transient_delivery_1'
    `).first();
    assert.equal(recoveredDelivery.state, 'processed', 'scheduled maintenance must recover a due Etsy delivery');
    assert.equal(recoveredDelivery.outcome_code, 'SHADOW_SYNCED');
    assert.equal(recoveredDelivery.error_code, null);
    assert.equal(recoveredDelivery.attempt_count, 2);

    const webhookStatus = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/webhook-status', { headers }
    ), env);
    assert.equal(webhookStatus.status, 200);
    const webhookStatusJson = await webhookStatus.json();
    assert.equal(webhookStatusJson.secretConfigured, true);
    assert.equal(webhookStatusJson.mode, 'shadow-only');
    assert.equal(webhookStatusJson.deliveries.processed, 2);
    assert.equal(webhookStatusJson.customerDataIncluded, false);

    const enrollmentTasks = [];
    const enrollmentWebhook = await worker.fetch(
      signedEtsyWebhookRequest({
        secret: env.ETSY_WEBHOOK_SECRET,
        webhookId: 'msg_enrollment_gate_1',
        payload: {
          event_type: 'order.paid',
          resource_url: 'https://api.etsy.com/v3/application/shops/98765/receipts/7005',
          shop_id: 98765,
        },
      }),
      { ...env, ETSY_WEBHOOK_ENROLLMENT_ENABLED: '1' },
      { waitUntil(promise) { enrollmentTasks.push(promise); } }
    );
    assert.equal(enrollmentWebhook.status, 202);
    await Promise.all(enrollmentTasks);
    const enrolledWebhookProjection = await env.ORDER_DB.prepare(`
      SELECT enrollment_state, board_enrolled
      FROM provider_order_projection
      WHERE order_key = 'etsy:98765:7005'
    `).first();
    assert.equal(enrolledWebhookProjection.enrollment_state, 'active', 'the explicit rollout flag must promote eligible receipts');
    assert.equal(enrolledWebhookProjection.board_enrolled, 1);
    const enrolledWebhookBoard = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders', { headers }),
      env
    );
    const enrolledWebhookCard = (await enrolledWebhookBoard.json()).data.find(order => order.orderKey === 'etsy:98765:7005');
    assert(enrolledWebhookCard, 'a flag-enabled eligible receipt must enter the shared board');
    assert.equal(enrolledWebhookCard.capabilities.productionWrite, true, 'active real Etsy orders must use revisioned D1 production state');
    assert.equal(enrolledWebhookCard.commerce.lineItems[0].supplierSku, 'B10259505', 'the active provider board DTO must expose the resolved S&S SKU');
    const enrolledOrderKey = encodeURIComponent('etsy:98765:7005');
    const providerToOrder = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${enrolledOrderKey}/production`,
      { method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: 0, idempotencyKey: 'etsy-active-to-order-1', patch: { stage: 'to_order' } }) }
    ), env);
    assert.equal(providerToOrder.status, 200, 'active real Etsy orders must accept guarded production-stage changes');
    const providerBatch = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/provider-batches/commit',
      { method: 'POST', headers, body: JSON.stringify({ orderKeys: ['etsy:98765:7005'], idempotencyKey: 'etsy-provider-batch-1' }) }
    ), env);
    assert.equal(providerBatch.status, 200, 'a resolved Etsy order must submit its S&S SKU through the provider batch path');
    assert.equal((await providerBatch.json()).supplierOrderNumber, 'SS-ETSY-9001');
    const providerBatchState = await env.ORDER_DB.prepare(`
      SELECT state_json FROM provider_production_state WHERE order_key = 'etsy:98765:7005'
    `).first();
    assert.equal(JSON.parse(providerBatchState.state_json).stage, 'blanks_cart', 'a confirmed Etsy S&S batch must advance only the provider production state');
    await env.ORDER_DB.prepare("DELETE FROM provider_order_projection WHERE order_key = 'etsy:98765:7005'").run();
    await env.ORDER_DB.prepare("DELETE FROM etsy_webhook_deliveries WHERE webhook_id = 'msg_enrollment_gate_1'").run();

    etsyReconciliationReceipts = [etsyReceiptFixture()];
    const etsyReconciliation = await module.reconcileEtsyPaidReceipts(env, 'incremental');
    etsyReconciliationReceipts = [];
    assert.equal(etsyReconciliation.observed, 1);
    assert.equal(etsyReconciliation.eligible, 1);
    assert.equal(etsyReconciliation.persisted, 1);
    assert.equal(etsyReconciliation.customerDataLogged, false);
    const etsyCheckpoint = await env.ORDER_DB.prepare(`
      SELECT last_completed_at, last_result_json
      FROM reconciliation_checkpoints
      WHERE name = 'etsy-webhook-reconciliation-v1'
    `).first();
    assert(etsyCheckpoint.last_completed_at, 'bounded Etsy reconciliation must record completion');
    assert(!etsyCheckpoint.last_result_json.includes('Protected Fixture Buyer'), 'reconciliation checkpoint must retain counts, not customer data');

    assert.equal(
      module.pickAllowOrigin('https://preview.printmo.pages.dev', { ALLOW_ORIGIN_SUFFIX: 'printmo.pages.dev' }),
      'https://preview.printmo.pages.dev'
    );
    assert.equal(
      module.pickAllowOrigin('https://evilprintmo.pages.dev', { ALLOW_ORIGIN_SUFFIX: 'printmo.pages.dev' }),
      '',
      'CORS suffix matching must require a hostname label boundary'
    );

    const untargetedShadowSync = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/shadow-sync',
      { method: 'POST', headers, body: '{}' }
    ), env);
    assert.equal(untargetedShadowSync.status, 400, 'shadow persistence must require an explicit receipt ID');
    assert.equal((await untargetedShadowSync.json()).error.code, 'ETSY_SHADOW_TARGET_REQUIRED');

    const providerCountBeforeLatestDryRun = (
      await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM provider_order_projection').first()
    ).count;
    const latestShadowDryRun = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/shadow-sync',
      { method: 'POST', headers, body: JSON.stringify({ latest: true, dryRun: true }) }
    ), env);
    assert.equal(latestShadowDryRun.status, 200, 'latest-receipt checks may run only as a non-persisting dry run');
    const latestShadowJson = await latestShadowDryRun.json();
    assert.equal(latestShadowJson.eligible, true);
    assert.equal(latestShadowJson.persisted, false);
    assert.equal(latestShadowJson.boardChanged, false);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM provider_order_projection').first()).count,
      providerCountBeforeLatestDryRun,
      'dry-run receipt checks must not create provider rows'
    );

    const orderProjectionCountBeforeShadow = (
      await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM order_projection').first()
    ).count;
    const shadowSync = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/shadow-sync',
      { method: 'POST', headers, body: JSON.stringify({ receiptId: '7001' }) }
    ), env);
    assert.equal(shadowSync.status, 200, 'an explicit paid and unshipped receipt must persist to the hidden provider shadow');
    const shadowSyncText = await shadowSync.text();
    assert(!shadowSyncText.includes('Protected Fixture Buyer'), 'shadow response must not expose buyer identity');
    assert(!shadowSyncText.includes('private@example.test'), 'shadow response must not expose buyer email');
    assert(!shadowSyncText.includes('Do not return this address'), 'shadow response must not expose buyer address');
    assert(!shadowSyncText.includes('Private production note'), 'shadow response must not expose buyer messages');
    assert(!shadowSyncText.includes('Private custom text'), 'shadow response must not expose personalization values');
    const shadowSyncJson = JSON.parse(shadowSyncText);
    assert.equal(shadowSyncJson.persisted, true);
    assert.equal(shadowSyncJson.orderKey, 'etsy:98765:7001');
    assert.equal(shadowSyncJson.enrollmentState, 'shadow');
    assert.equal(shadowSyncJson.productionRevision, 0);
    assert.equal(shadowSyncJson.boardChanged, false);
    const shadowProjection = await env.ORDER_DB.prepare(`
      SELECT order_key, enrollment_state, board_enrolled, commerce_json
      FROM provider_order_projection
      WHERE order_key = ?
    `).bind('etsy:98765:7001').first();
    assert.equal(shadowProjection.enrollment_state, 'shadow');
    assert.equal(shadowProjection.board_enrolled, 0);
    assert(!shadowProjection.commerce_json.includes('private@example.test'), 'shadow commerce projection must omit buyer email');
    assert(!shadowProjection.commerce_json.includes('Do not return this address'), 'shadow commerce projection must omit full address values');
    assert(!shadowProjection.commerce_json.includes('Private production note'), 'shadow commerce projection must retain only the presence of a buyer message');
    const shadowProduction = await env.ORDER_DB.prepare(`
      SELECT revision, state_json
      FROM provider_production_state
      WHERE order_key = ?
    `).bind('etsy:98765:7001').first();
    assert.equal(shadowProduction.revision, 0, 'provider production state must begin at revision zero');
    assert.equal(JSON.parse(shadowProduction.state_json).revision, 0);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM order_projection').first()).count,
      orderProjectionCountBeforeShadow,
      'Etsy shadow persistence must not write Shopify board projections'
    );

    const repeatedShadowSync = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/shadow-sync',
      { method: 'POST', headers, body: JSON.stringify({ receiptId: 7001 }) }
    ), env);
    assert.equal(repeatedShadowSync.status, 200, 'repeated receipt shadow sync must be idempotent');
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM provider_order_projection WHERE order_key = ?').bind('etsy:98765:7001').first()).count,
      1
    );
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM provider_production_state WHERE order_key = ?').bind('etsy:98765:7001').first()).count,
      1
    );

    const shippedShadowSync = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/shadow-sync',
      { method: 'POST', headers, body: JSON.stringify({ receiptId: 7002 }) }
    ), env);
    assert.equal(shippedShadowSync.status, 200, 'ineligible receipts should return a safe no-op result');
    const shippedShadowJson = await shippedShadowSync.json();
    assert.equal(shippedShadowJson.eligible, false);
    assert.equal(shippedShadowJson.reason, 'ALREADY_SHIPPED');
    assert.equal(shippedShadowJson.persisted, false);
    assert.equal(shippedShadowJson.boardChanged, false);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM provider_order_projection WHERE order_key = ?').bind('etsy:98765:7002').first()).count,
      0,
      'already-shipped receipts must not enter the provider shadow'
    );

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

    const unconfirmedSynthetic = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/synthetic-order',
      { method: 'POST', headers, body: '{}' }
    ), env);
    assert.equal(unconfirmedSynthetic.status, 400, 'live synthetic enrollment must require an exact confirmation phrase');

    // The live synthetic contract uses the owner-approved catalog listing. Seed
    // equivalent private mappings here so the fixture proves both receipt
    // selection fields and the cached-image identity gate without network data.
    for (const [id, valueId, imageId] of [
      ['fixture-synthetic-black-preview', '49928889190', '7722005927'],
      ['fixture-synthetic-white-preview', '49974750696', '7722005937'],
      ['fixture-synthetic-red-preview', '52041479599', '7722005931'],
      ['fixture-synthetic-green-preview', '49974750678', '7722005929'],
    ]) {
      await env.ORDER_DB.prepare(`
        INSERT INTO etsy_catalog_preview_mappings (
          id, shop_id, etsy_shop_id, etsy_listing_id, property_id, value_id,
          listing_image_id, source_type, resolution_mode, blob_id, state,
          created_by, created_at, updated_at, deleted_at
        ) VALUES (?, ?, '98765', '4452232638', '200', ?, ?, 'etsy', 'direct', ?, 'active', 'fixture', ?, ?, NULL)
      `).bind(id, catalogPreviewMapping.shop_id, valueId, imageId, catalogPreviewBlob.blob_id, '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z').run();
    }

    const syntheticCreate = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/synthetic-order',
      { method: 'POST', headers, body: JSON.stringify({ confirm: 'CREATE_LIVE_ETSY_TEST_ORDER' }) }
    ), env);
    assert.equal(syntheticCreate.status, 201, 'an explicitly confirmed synthetic Etsy pilot may enter the live board');
    const syntheticCreateJson = await syntheticCreate.json();
    const syntheticOrderKey = 'etsy-synthetic:98765:synthetic-pilot-1';
    assert.equal(syntheticCreateJson.orderKey, syntheticOrderKey);
    assert.equal(syntheticCreateJson.synthetic, true);
    const syntheticProjection = await env.ORDER_DB.prepare(`
      SELECT enrollment_state, board_enrolled
      FROM provider_order_projection
      WHERE order_key = ?
    `).bind(syntheticOrderKey).first();
    assert.equal(syntheticProjection.enrollment_state, 'pilot');
    assert.equal(syntheticProjection.board_enrolled, 1);

    const combinedBoard = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders', { headers }),
      env
    );
    const combinedBoardJson = await combinedBoard.json();
    assert.equal(combinedBoard.status, 200);
    assert.equal(combinedBoardJson.pageInfo.total, 2, 'the shared page must merge Shopify and enrolled provider identities once');
    const syntheticCard = combinedBoardJson.data.find(order => order.orderKey === syntheticOrderKey);
    assert(syntheticCard, 'the live board must include the enrolled synthetic Etsy order');
    assert.equal(syntheticCard.source.provider, 'etsy');
    assert.equal(syntheticCard.source.synthetic, true);
    assert.equal(syntheticCard.capabilities.productionWrite, true);
    assert.deepEqual(
      syntheticCard.commerce.lineItems.map(item => item.catalogPreview?.previewId),
      ['fixture-synthetic-black-preview', 'fixture-synthetic-green-preview'],
      'an Etsy receipt must resolve each purchased variation only to its matching cached catalog preview'
    );

    const encodedSyntheticOrderKey = encodeURIComponent(syntheticOrderKey);
    const syntheticDetail = await worker.fetch(
      new Request(`https://worker.test/order-manager/v1/orders/${encodedSyntheticOrderKey}`, { headers }),
      env
    );
    const syntheticDetailJson = await syntheticDetail.json();
    assert.equal(syntheticDetail.status, 200, 'the shared detail route must read provider orders');
    assert.equal(syntheticDetailJson.source.provider, 'etsy');
    assert.equal(syntheticDetailJson.source.synthetic, true);
    assert.equal(syntheticDetailJson.detail.lineItems.length, 2);

    const syntheticProduction = await worker.fetch(
      new Request(`https://worker.test/order-manager/v1/orders/${encodedSyntheticOrderKey}/production`, { headers }),
      env
    );
    assert.equal((await syntheticProduction.json()).production.revision, 0);
    const mutationBody = {
      expectedVersion: 0,
      idempotencyKey: 'etsy-synthetic-stage-1',
      patch: { stage: 'to_order' }
    };
    const mutateSynthetic = () => worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodedSyntheticOrderKey}/production`,
      { method: 'PATCH', headers, body: JSON.stringify(mutationBody) }
    ), env);
    const firstSyntheticMutation = await mutateSynthetic();
    const firstSyntheticMutationJson = await firstSyntheticMutation.json();
    assert.equal(firstSyntheticMutation.status, 200);
    assert.equal(firstSyntheticMutationJson.production.stage, 'to_order');
    assert.equal(firstSyntheticMutationJson.production.revision, 1);
    const replayedSyntheticMutation = await mutateSynthetic();
    assert.equal((await replayedSyntheticMutation.json()).production.revision, 1, 'provider mutation retries must be idempotent');

    const staleSyntheticMutation = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodedSyntheticOrderKey}/production`,
      {
        method: 'PATCH', headers,
        body: JSON.stringify({ expectedVersion: 0, idempotencyKey: 'etsy-synthetic-stage-stale', patch: { stage: 'received' } })
      }
    ), env);
    assert.equal(staleSyntheticMutation.status, 409, 'stale provider revisions must not overwrite current production state');
    assert.equal((await staleSyntheticMutation.json()).error.code, 'VERSION_CONFLICT');

    const syntheticStageBoard = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders?stage=to_order', { headers }),
      env
    );
    const syntheticStageBoardJson = await syntheticStageBoard.json();
    assert(syntheticStageBoardJson.data.some(order => order.orderKey === syntheticOrderKey), 'stage filtering must include enrolled provider state');

    const fullReceiptCreate = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/synthetic-order',
      { method: 'POST', headers, body: JSON.stringify({ scenario: 'full_receipt', confirm: 'CREATE_LIVE_ETSY_FULL_RECEIPT_TEST_ORDER' }) }
    ), env);
    assert.equal(fullReceiptCreate.status, 201, 'the full fabricated Etsy receipt must require and accept its own explicit confirmation');
    const fullReceiptCreateJson = await fullReceiptCreate.json();
    const fullReceiptOrderKey = 'etsy-synthetic:98765:synthetic-full-receipt-1';
    assert.equal(fullReceiptCreateJson.orderKey, fullReceiptOrderKey);
    assert.equal(fullReceiptCreateJson.scenario, 'full_receipt');
    const fullReceiptDetail = await worker.fetch(
      new Request(`https://worker.test/order-manager/v1/orders/${encodeURIComponent(fullReceiptOrderKey)}`, { headers }), env
    );
    const fullReceiptDetailJson = await fullReceiptDetail.json();
    assert.equal(fullReceiptDetail.status, 200);
    assert.equal(fullReceiptDetailJson.detail.lineItems.length, 4);
    assert.equal(fullReceiptDetailJson.detail.customer.email, 'avery.example@printmo-test.invalid');
    assert.equal(fullReceiptDetailJson.detail.data.delivery.shippingAddress.address1, '2002 Test Receipt Lane');
    assert.equal(fullReceiptDetailJson.detail.data.delivery.shippingLines.length, 1);
    assert.equal(fullReceiptDetailJson.detail.data.discounts[0].code, 'SYNTHETIC10');
    assert.equal(fullReceiptDetailJson.commerce.subtotal, 129.5, 'full synthetic receipt must use the shared raw Etsy receipt normalizer for money');
    assert.equal(fullReceiptDetailJson.commerce.lineItems[2].personalization[0].value, 'NO REAL CUSTOMER DATA');
    assert.deepEqual(
      fullReceiptDetailJson.commerce.lineItems.map(item => item.catalogPreview?.previewId),
      ['fixture-synthetic-black-preview', 'fixture-synthetic-white-preview', 'fixture-synthetic-red-preview', 'fixture-synthetic-green-preview'],
      'the full fabricated receipt must resolve every imported color through the same receipt-image gate'
    );
    const fullReceiptDelete = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/synthetic-order',
      { method: 'DELETE', headers, body: JSON.stringify({ scenario: 'full_receipt', confirm: 'DELETE_LIVE_ETSY_FULL_RECEIPT_TEST_ORDER' }) }
    ), env);
    assert.equal(fullReceiptDelete.status, 200);
    assert.equal((await fullReceiptDelete.json()).removed, true, 'full receipt cleanup must target only that synthetic scenario');

    const unconfirmedDelete = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/synthetic-order',
      { method: 'DELETE', headers, body: '{}' }
    ), env);
    assert.equal(unconfirmedDelete.status, 400, 'synthetic cleanup must require its exact confirmation phrase');
    const syntheticDelete = await worker.fetch(new Request(
      'https://worker.test/order-manager/v1/integrations/etsy/synthetic-order',
      { method: 'DELETE', headers, body: JSON.stringify({ confirm: 'DELETE_LIVE_ETSY_TEST_ORDER' }) }
    ), env);
    assert.equal(syntheticDelete.status, 200);
    assert.equal((await syntheticDelete.json()).removed, true);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT COUNT(*) AS count FROM provider_order_projection WHERE order_key = ?').bind(syntheticOrderKey).first()).count,
      0,
      'cleanup must remove only the deterministic synthetic pilot identity'
    );

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

    const manualDesignForm = new FormData();
    manualDesignForm.set('side', 'front');
    manualDesignForm.set('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'], {
      type: 'image/svg+xml'
    }), 'manual-front.svg');
    const manualDesignUpload = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/assets`,
      { method: 'POST', headers: { Authorization: headers.Authorization }, body: manualDesignForm }
    ), env);
    assert.equal(manualDesignUpload.status, 201, 'an authenticated operator must be able to attach a design to a Shopify order');
    const manualDesignUploadJson = await manualDesignUpload.json();
    const manualDesignAsset = manualDesignUploadJson.assets.find(asset => asset.assetId === manualDesignUploadJson.assetId && asset.side === 'front');
    assert.equal(manualDesignAsset?.role, 'design');
    assert.equal(manualDesignAsset?.manualUpload, true);
    assert.equal(manualDesignAsset?.removable, true);
    assert(!JSON.stringify(manualDesignUploadJson).includes('object_key'), 'manual upload responses must not expose manifest storage columns');
    assert(!JSON.stringify(manualDesignUploadJson).includes('orders/60129381/assets/'), 'manual upload responses must not expose private R2 keys');
    const manualDesignManifest = await env.ORDER_DB.prepare(`
      SELECT state, source_key, content_type, byte_size
      FROM asset_manifests
      WHERE id = ?
    `).bind(manualDesignUploadJson.assetId).first();
    assert.equal(manualDesignManifest.state, 'active');
    assert.equal(manualDesignManifest.content_type, 'image/svg+xml');
    assert(String(manualDesignManifest.source_key).startsWith('manual-upload:'));

    const invalidDesignForm = new FormData();
    invalidDesignForm.set('side', 'front');
    invalidDesignForm.set('file', new Blob(['not artwork'], { type: 'application/pdf' }), 'manual.pdf');
    const invalidDesignUpload = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/assets`,
      { method: 'POST', headers: { Authorization: headers.Authorization }, body: invalidDesignForm }
    ), env);
    assert.equal(invalidDesignUpload.status, 415, 'manual design uploads must reject formats outside the artwork allowlist');

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
    assert.equal(canonicalDetailJson.production.assets.length, 3, 'detail must return Designer links plus the order-level manual design');
    assert.equal(
      new Set(canonicalDetailJson.production.assets.filter(asset => !asset.manualUpload).map(asset => asset.assetId)).size,
      1,
      'detail links for identical Designer bytes must share one private asset ID'
    );
    assert.equal(
      canonicalDetailJson.production.assets.find(asset => asset.assetId === manualDesignUploadJson.assetId)?.side,
      'front',
      'canonical detail must surface the selected placement for a manual design'
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

    const manualDesignDelete = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/assets/${encodeURIComponent(manualDesignUploadJson.assetId)}?side=front`,
      { method: 'DELETE', headers }
    ), env);
    assert.equal(manualDesignDelete.status, 200, 'manual designs must be removable from the order detail');
    const manualDesignDeleteJson = await manualDesignDelete.json();
    assert(!manualDesignDeleteJson.assets.some(asset => asset.assetId === manualDesignUploadJson.assetId && asset.manualUpload));
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT state FROM asset_manifests WHERE id = ?').bind(manualDesignUploadJson.assetId).first()).state,
      'deleted',
      'an unreferenced manual design manifest must be retired without requiring an R2 hard delete'
    );
    assert(
      Array.from(privateObjects.keys()).some(key => key.includes(`/assets/${manualDesignUploadJson.assetId}/`)),
      'manual removal must leave the private bytes recoverable for audited cleanup'
    );

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

    const projectedBeforeFulfillment = await env.ORDER_DB.prepare(
      'SELECT * FROM order_projection WHERE order_gid = ?'
    ).bind(shopifyNode().id).first();
    fixtureShopifyFulfillmentStatus = 'FULFILLED';
    const knownFulfilledSummary = JSON.parse(projectedBeforeFulfillment.commerce_json);
    knownFulfilledSummary.commerce.fulfillmentStatus = 'FULFILLED';
    await env.ORDER_DB.prepare(`
      UPDATE order_projection
      SET active = 1, commerce_json = ?, stale_at = NULL
      WHERE order_gid = ?
    `).bind(JSON.stringify(knownFulfilledSummary), shopifyNode().id).run();

    const activeWithExistingFulfillment = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders?view=active', { headers }), env
    );
    assert.equal(activeWithExistingFulfillment.status, 200);
    assert.equal(
      (await activeWithExistingFulfillment.json()).data.some(order => order.id === shopifyNode().id),
      false,
      'an existing D1 row already reporting FULFILLED must be excluded before active-board assets are built'
    );

    const previousFirstResponse = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders?view=previous&limit=1', { headers }), env
    );
    assert.equal(previousFirstResponse.status, 200);
    const previousFirst = await previousFirstResponse.json();
    assert.equal(previousFirst.data.length, 1, 'fulfilled Shopify orders must appear in Previous Orders');
    assert.equal(previousFirst.data[0].id, shopifyNode().id);
    assert.equal(previousFirst.data[0].commerce.fulfillmentStatus, 'FULFILLED');
    assert.deepEqual(previousFirst.data[0].production.assets, [], 'history list responses must not contain asset summaries');

    const historyDetailResponse = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}`,
      { headers }
    ), env);
    assert.equal(historyDetailResponse.status, 200);
    assert(
      (await historyDetailResponse.json()).production.assets.length > 0,
      'opening one historical order must retrieve its artwork on demand'
    );

    const secondFulfilledSummary = JSON.parse(JSON.stringify(knownFulfilledSummary));
    secondFulfilledSummary.id = 'gid://shopify/Order/60129382';
    secondFulfilledSummary.displayName = '#1002';
    secondFulfilledSummary.shopifyUpdatedAt = '2026-07-24T14:05:00Z';
    secondFulfilledSummary.customer = { displayName: 'History Search Customer' };
    await env.ORDER_DB.prepare(`
      INSERT INTO order_projection (
        shop_id, order_gid, display_name, stage, active, production_revision,
        production_digest, production_json, commerce_json, shopify_updated_at,
        fetched_at, stale_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).bind(
      projectedBeforeFulfillment.shop_id,
      secondFulfilledSummary.id,
      secondFulfilledSummary.displayName,
      projectedBeforeFulfillment.stage,
      projectedBeforeFulfillment.production_revision,
      projectedBeforeFulfillment.production_digest,
      projectedBeforeFulfillment.production_json,
      JSON.stringify(secondFulfilledSummary),
      secondFulfilledSummary.shopifyUpdatedAt,
      projectedBeforeFulfillment.fetched_at,
      secondFulfilledSummary.createdAt,
      secondFulfilledSummary.shopifyUpdatedAt
    ).run();

    const pagedHistoryResponse = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders?view=previous&limit=1', { headers }), env
    );
    const pagedHistory = await pagedHistoryResponse.json();
    assert.equal(pagedHistory.data[0].displayName, '#1002', 'history must sort by newest Shopify update first');
    assert(pagedHistory.pageInfo.nextCursor, 'history must return a signed cursor when more fulfilled orders remain');
    const secondHistoryPage = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders?view=previous&limit=1&cursor=${encodeURIComponent(pagedHistory.pageInfo.nextCursor)}`,
      { headers }
    ), env);
    assert.equal(secondHistoryPage.status, 200);
    assert.equal((await secondHistoryPage.json()).data[0].displayName, '#1001');
    const mismatchedHistoryCursor = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders?view=previous&limit=1&q=other&cursor=${encodeURIComponent(pagedHistory.pageInfo.nextCursor)}`,
      { headers }
    ), env);
    assert.equal(mismatchedHistoryCursor.status, 400, 'history cursors must be bound to view, search, and limit');

    const searchedHistoryResponse = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders?view=previous&limit=25&q=history%20search', { headers }), env
    );
    const searchedHistory = await searchedHistoryResponse.json();
    assert.deepEqual(
      searchedHistory.data.map(order => order.displayName),
      ['#1002'],
      'history search must match customer names on the server'
    );

    fixtureShopifyFulfillmentStatus = 'FULFILLED';
    const fulfilledWebhookBody = JSON.stringify({
      id: '60129381',
      admin_graphql_api_id: shopifyNode().id,
      name: '#1001',
      order_number: 1001,
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      updated_at: '2026-07-25T12:00:00Z',
    });
    const fulfilledWebhookHmac = crypto.createHmac('sha256', secret).update(fulfilledWebhookBody).digest('base64');
    let fulfillmentRefresh = null;
    const fulfilledWebhook = await worker.fetch(new Request('https://worker.test/order-manager/v1/webhooks/shopify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': fulfilledWebhookHmac,
        'X-Shopify-Webhook-Id': 'delivery-fulfilled-1', 'X-Shopify-Topic': 'orders/updated',
        'X-Shopify-Shop-Domain': 'printmo-test.myshopify.com'
      },
      body: fulfilledWebhookBody
    }), env, { waitUntil(promise) { fulfillmentRefresh = promise; } });
    assert.equal(fulfilledWebhook.status, 200, 'an authenticated fulfilled update must be accepted');
    if (fulfillmentRefresh) await fulfillmentRefresh;
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT active FROM order_projection WHERE order_gid = ?').bind(shopifyNode().id).first()).active,
      0,
      'a Shopify fulfillment refresh must mark the projection inactive'
    );

    const fulfilledArchiveMutation = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          expectedVersion: productionState.revision,
          patch: { archived_at: 'untrusted-client-time' },
          idempotencyKey: 'mutation-fulfilled-archive-1'
        })
      }
    ), env);
    assert.equal(fulfilledArchiveMutation.status, 200);
    const fulfilledReopenMutation = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          expectedVersion: productionState.revision,
          patch: { archived_at: null },
          idempotencyKey: 'mutation-fulfilled-reopen-1'
        })
      }
    ), env);
    assert.equal(fulfilledReopenMutation.status, 200);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT active FROM order_projection WHERE order_gid = ?').bind(shopifyNode().id).first()).active,
      0,
      'production mutation and archive reopening must not reactivate a fulfilled order'
    );

    const fulfilledCoordinator = new module.OrderSyncCoordinator({}, env);
    const fulfilledIntegrity = await fulfilledCoordinator.reconcileIntegrity();
    assert.equal(fulfilledIntegrity.batchRepairErrors.length, 0);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT active FROM order_projection WHERE order_gid = ?').bind(shopifyNode().id).first()).active,
      0,
      'batch reconciliation must not reactivate a fulfilled order'
    );

    fixtureShopifyFulfillmentStatus = 'UNFULFILLED';
    const reversedWebhookBody = JSON.stringify({
      id: '60129381',
      admin_graphql_api_id: shopifyNode().id,
      name: '#1001',
      order_number: 1001,
      financial_status: 'paid',
      fulfillment_status: null,
      updated_at: '2026-07-26T12:00:00Z',
    });
    const reversedWebhookHmac = crypto.createHmac('sha256', secret).update(reversedWebhookBody).digest('base64');
    let reversalRefresh = null;
    const reversedWebhook = await worker.fetch(new Request('https://worker.test/order-manager/v1/webhooks/shopify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': reversedWebhookHmac,
        'X-Shopify-Webhook-Id': 'delivery-fulfillment-reversed-1', 'X-Shopify-Topic': 'orders/updated',
        'X-Shopify-Shop-Domain': 'printmo-test.myshopify.com'
      },
      body: reversedWebhookBody
    }), env, { waitUntil(promise) { reversalRefresh = promise; } });
    assert.equal(reversedWebhook.status, 200, 'an authenticated fulfillment reversal must be accepted');
    if (reversalRefresh) await reversalRefresh;
    const reversedProjection = await env.ORDER_DB.prepare(
      'SELECT active, stage FROM order_projection WHERE order_gid = ?'
    ).bind(shopifyNode().id).first();
    assert.equal(reversedProjection.active, 1, 'reversed fulfillment must restore an otherwise eligible order');
    assert.equal(reversedProjection.stage, productionState.stage, 'reversed fulfillment must preserve the production stage');
    const previousAfterReversal = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders?view=previous&limit=25&q=%231001', { headers }), env
    );
    assert.equal((await previousAfterReversal.json()).data.length, 0, 'reversed fulfillment must leave Previous Orders');

    const activeBeforeCancellation = await env.ORDER_DB.prepare(
      'SELECT active FROM order_projection WHERE order_gid = ?'
    ).bind(shopifyNode().id).first();
    assert.equal(activeBeforeCancellation.active, 1, 'an uncancelled, unarchived Shopify order must remain active');

    fixtureShopifyCancelledAt = '2026-07-23T12:00:00Z';
    const cancelledWebhookBody = JSON.stringify({
      id: '60129381',
      admin_graphql_api_id: shopifyNode().id,
      name: '#1001',
      order_number: 1001,
      financial_status: 'paid',
      cancelled_at: fixtureShopifyCancelledAt,
      updated_at: fixtureShopifyCancelledAt,
    });
    const cancelledWebhookHmac = crypto.createHmac('sha256', secret).update(cancelledWebhookBody).digest('base64');
    let cancellationRefresh = null;
    const cancelledWebhook = await worker.fetch(new Request('https://worker.test/order-manager/v1/webhooks/shopify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': cancelledWebhookHmac,
        'X-Shopify-Webhook-Id': 'delivery-cancelled-1', 'X-Shopify-Topic': 'orders/updated',
        'X-Shopify-Shop-Domain': 'printmo-test.myshopify.com'
      },
      body: cancelledWebhookBody
    }), env, { waitUntil(promise) { cancellationRefresh = promise; } });
    assert.equal(cancelledWebhook.status, 200, 'an authenticated cancellation update must be accepted');
    if (cancellationRefresh) await cancellationRefresh;

    const cancelledProjection = await env.ORDER_DB.prepare(
      'SELECT active, commerce_json, production_json FROM order_projection WHERE order_gid = ?'
    ).bind(shopifyNode().id).first();
    assert.equal(cancelledProjection.active, 0, 'a Shopify cancellation refresh must remove the order from the active board');
    assert.equal(JSON.parse(cancelledProjection.commerce_json).commerce.cancelledAt, fixtureShopifyCancelledAt);
    assert(JSON.parse(cancelledProjection.production_json), 'cancellation must preserve the production projection');

    const boardAfterCancellation = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders', { headers }), env
    );
    assert.equal(boardAfterCancellation.status, 200);
    assert.equal(
      (await boardAfterCancellation.json()).data.some(order => order.id === shopifyNode().id),
      false,
      'cancelled Shopify orders must not be returned by the active board endpoint'
    );
    const previousAfterCancellation = await worker.fetch(
      new Request('https://worker.test/order-manager/v1/orders?view=previous&limit=25&q=%231001', { headers }), env
    );
    assert.equal(
      (await previousAfterCancellation.json()).data.length,
      0,
      'cancelled Shopify orders must not appear in Previous Orders even if they were previously fulfilled'
    );

    const cancelledArchiveMutation = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`,
      {
        method: 'PATCH', headers,
        body: JSON.stringify({
          expectedVersion: productionState.revision,
          patch: { archived_at: 'untrusted-client-time' },
          idempotencyKey: 'mutation-cancelled-archive-1'
        })
      }
    ), env);
    assert.equal(cancelledArchiveMutation.status, 200, 'a production mutation must preserve source-driven cancellation inactivity');

    const cancelledReopenMutation = await worker.fetch(new Request(
      `https://worker.test/order-manager/v1/orders/${encodeURIComponent(shopifyNode().id)}/production`,
      {
        method: 'PATCH', headers,
        body: JSON.stringify({
          expectedVersion: productionState.revision,
          patch: { archived_at: null },
          idempotencyKey: 'mutation-cancelled-reopen-1'
        })
      }
    ), env);
    assert.equal(cancelledReopenMutation.status, 200, 'clearing PrintMO archive state must remain available for a cancelled order');
    assert.equal((await cancelledReopenMutation.json()).production.archivedAt, null);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT active FROM order_projection WHERE order_gid = ?').bind(shopifyNode().id).first()).active,
      0,
      'clearing PrintMO archive state must not reactivate a Shopify-cancelled order'
    );

    const coordinator = new module.OrderSyncCoordinator({}, env);
    const integrityResult = await coordinator.reconcileIntegrity();
    assert.equal(integrityResult.batchRepairErrors.length, 0);
    assert.equal(
      (await env.ORDER_DB.prepare('SELECT active FROM order_projection WHERE order_gid = ?').bind(shopifyNode().id).first()).active,
      0,
      'confirmed-batch integrity reconciliation must not reactivate a Shopify-cancelled order'
    );

    assert(calls.some(call => call.target.endsWith('/admin/oauth/access_token')), 'Worker must exchange client credentials for a runtime token');
    assert(calls.some(call => call.target.includes('/graphql.json')), 'Worker must query Shopify GraphQL');
    assert(calls.some(call => String(call.options?.body || '').includes('PrintMOShopifyPreviewOrders')), 'preview must use the cost-bounded Shopify list query');
    assert(!source.includes('SHOPIFY_ACCESS_TOKEN'), 'Worker must not depend on a static Shopify access token');
  } finally {
    fixtureShopifyCancelledAt = null;
    fixtureShopifyFulfillmentStatus = 'UNFULFILLED';
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
    6,
    'rich workbench must expose six workflow-oriented detail tabs including Overview'
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
  const detailState = require(path.join(root, 'order-manager-web', 'order-detail-state.js'));
  const draftStore = detailState.createNoteDraftStore();
  const orderA = { _provider: 'shopify', _gid: 'gid://shopify/Order/1', name: '#1001' };
  const orderB = { _provider: 'shopify', _gid: 'gid://shopify/Order/2', name: '#1002' };
  const orderAKey = draftStore.keyFor(orderA);
  const orderBKey = draftStore.keyFor(orderB);
  draftStore.remember(orderAKey, 'draft for A', 'saved A');
  assert.strictEqual(draftStore.read(orderAKey)?.text, 'draft for A');
  assert.strictEqual(draftStore.read(orderBKey), undefined);
  draftStore.remember(orderBKey, 'saved B', 'saved B');
  assert.strictEqual(draftStore.read(orderAKey)?.text, 'draft for A');
  assert.strictEqual(draftStore.read(orderBKey), undefined);
  assert(
    detailEnhancements.includes('window.OrderDetailState.createNoteDraftStore()')
      && detailEnhancements.includes('function detailOrderDraftKey(order)')
      && detailEnhancements.includes('function rememberCurrentNotesDraft()')
      && detailEnhancements.includes('function preserveNotesDraftForClose()')
      && detailEnhancements.includes('noteDraftStore.discard(activeNotesOrderKey)'),
    'Order Detail notes must isolate unsaved drafts by provider-aware immutable order identity and preserve only the matching draft across close/open'
  );
  const staleOrder = {
    _version: 2,
    progress: 1,
    blanksStatus: 0,
    printsStatus: 0,
    blanksOrdered: 0,
    printsOrdered: 0
  };
  detailState.mergeCanonicalProductionState(staleOrder, {
    revision: 7,
    printedCount: 12,
    blanksStatus: 1,
    printsStatus: 1,
    blanksOrdered: 1,
    printsOrdered: 1
  });
  assert.deepStrictEqual(staleOrder, {
    _version: 7,
    progress: 12,
    blanksStatus: 1,
    printsStatus: 1,
    blanksOrdered: 1,
    printsOrdered: 1
  });
  const newerLocalProgress = {
    _version: 9,
    progress: 6,
    productionStage: 'print',
    blanksStatus: 0
  };
  detailState.mergeCanonicalProductionState(newerLocalProgress, {
    revision: 8,
    printedCount: 2,
    stage: 'print',
    blanksStatus: 1
  });
  assert.deepStrictEqual(newerLocalProgress, {
    _version: 9,
    progress: 6,
    productionStage: 'print',
    blanksStatus: 0
  }, 'an older detail response must not rewind newer local production state');
  const pendingLocalProgress = {
    _version: 9,
    _progressMutationPending: true,
    progress: 10,
    productionStage: 'completed',
    blanksStatus: 0
  };
  detailState.mergeCanonicalProductionState(pendingLocalProgress, {
    revision: 10,
    printedCount: 4,
    stage: 'print',
    blanksStatus: 1
  });
  assert.equal(pendingLocalProgress._version, 10, 'pending progress must still adopt a newer canonical revision');
  assert.equal(pendingLocalProgress.progress, 10, 'pending optimistic progress must survive detail hydration');
  assert.equal(pendingLocalProgress.productionStage, 'completed', 'pending optimistic completion must survive detail hydration');
  assert.equal(pendingLocalProgress.blanksStatus, 1, 'unrelated canonical readiness state must still hydrate');

  let releaseFirstProgressCommit;
  const firstProgressCommit = new Promise(resolve => { releaseFirstProgressCommit = resolve; });
  const progressCommits = [];
  let nextProgressVersion = 1;
  const progressOrder = {
    _candidate: true,
    _version: nextProgressVersion,
    progress: 0,
    productionStage: 'print',
    status: 'print',
    totalApparel: 10
  };
  const progressCoordinator = detailState.createProgressSaveCoordinator({
    commit: async (_order, progress, stage) => {
      progressCommits.push({ progress, stage });
      if (progressCommits.length === 1) await firstProgressCommit;
      nextProgressVersion += 1;
      return {
        production: {
          printedCount: progress,
          stage,
          version: nextProgressVersion
        }
      };
    }
  });
  const rapidProgressSave = progressCoordinator.request(progressOrder, 1, { total: 10 });
  for (let progress = 2; progress <= 10; progress += 1) {
    progressCoordinator.request(progressOrder, progress, { total: 10 });
  }
  assert.equal(progressOrder.progress, 10, 'ten rapid increments must paint immediately');
  assert.deepStrictEqual(progressCommits, [{ progress: 1, stage: 'print' }], 'only one progress request may be in flight');
  releaseFirstProgressCommit();
  assert.equal(await rapidProgressSave, true);
  assert.deepStrictEqual(progressCommits, [
    { progress: 1, stage: 'print' },
    { progress: 10, stage: 'completed' }
  ], 'rapid increments must coalesce into the latest desired count and complete atomically');
  assert.equal(progressOrder.progress, 10);
  assert.equal(progressOrder.productionStage, 'completed');
  assert.equal(progressOrder._progressMutationPending, false);

  const failedProgressOrder = {
    _candidate: true,
    _version: 3,
    progress: 4,
    productionStage: 'print',
    totalApparel: 8
  };
  const failedProgressCoordinator = detailState.createProgressSaveCoordinator({
    commit: async () => { throw new Error('fixture progress failure'); }
  });
  assert.equal(await failedProgressCoordinator.request(failedProgressOrder, 5, { total: 8 }), false);
  assert.equal(failedProgressOrder.progress, 4, 'a failed progress save must restore the last confirmed count');
  assert.equal(failedProgressOrder._progressMutationPending, false);
  assert(
    detailEnhancements.includes('window.OrderDetailState.mergeCanonicalProductionState(order, production)')
      && detailEnhancements.includes('syncCanonicalProductionControls(order)')
      && detailEnhancements.includes("document.getElementById('ready-apply')?.classList.add('hidden')"),
    'canonical detail hydration must adopt revision, progress, and every readiness flag before repainting production controls'
  );
  assert(
    detailEnhancements.includes("label: 'Materials marked ready'")
      && !detailEnhancements.includes("label: 'Production ready'")
      && detailEnhancements.includes("'(prefers-reduced-motion: reduce)'")
      && detailEnhancements.includes("behavior: options.focus && !window.matchMedia"),
    'readiness copy must stay scoped to material milestones and programmatic tab scrolling must respect reduced motion'
  );
  const sharedDetailRenderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  assert(
    sharedDetailRenderer.includes("const canEditCustomerName = o?._candidate !== true")
      && sharedDetailRenderer.includes("nameSourceNote.textContent = canEditCustomerName ? '' : `Managed by ${sourceLabel}`")
      && sharedDetailRenderer.includes("if (order?._candidate === true || order?._capabilities?.commerceWrite === false) return")
      && previewHtml.includes('id="detail-cust-name-source-note"'),
    'commerce-source customer names must render as source-managed without exposing a mutation path the adapter rejects'
  );
  assert(
    previewHtml.includes('id="manual-design-side"')
      && previewHtml.includes('id="manual-design-file-input"')
      && previewHtml.includes('id="manual-design-upload-btn"')
      && previewHtml.includes('id="manual-design-upload-status"')
      && sharedDetailRenderer.includes('function uploadManualDesignFiles')
      && sharedDetailRenderer.includes('window.api.deleteOrderDesignAsset')
      && sharedDetailRenderer.includes("String(asset?.side || '').toLowerCase()"),
    'Design Files must support placed manual uploads, removable manual assets, and placement-aware deduplication'
  );
  assert(
    sharedDetailRenderer.includes("status.textContent = `Notes were not saved:")
      && sharedDetailRenderer.includes("confirmBtn.textContent = 'Try again'")
      && sharedDetailRenderer.includes('function saveProductionProgress')
      && sharedDetailRenderer.includes('createProgressSaveCoordinator')
      && sharedDetailRenderer.includes('progressSaveStatus(`Saving ${state.desiredProgress} / ${state.total}…`)'),
    'mobile/legacy notes and progress mutations must retain input, coalesce optimistic changes, and expose save state'
  );
  assert(
    previewHtml.includes('id="progress-decrement"')
      && previewHtml.includes('id="progress-increment"')
      && previewHtml.includes('id="progress-complete"')
      && previewHtml.includes('id="progress-validation"')
      && sharedDetailRenderer.includes('Mark all ${total} printed')
      && sharedDetailRenderer.includes('Enter a whole number from 0 to ${total}.'),
    'custom print progress must expose a validated stepper and an explicit mark-all action'
  );
  const detailAccessibilityHardening = fs.readFileSync(path.join(root, 'order-manager-web', 'accessibility-hardening.js'), 'utf8');
  assert(
    detailAccessibilityHardening.includes("element.closest('[hidden], [aria-hidden=\"true\"], [inert]')")
      && detailAccessibilityHardening.includes('element.tabIndex < 0')
      && detailAccessibilityHardening.includes('element.getClientRects().length > 0')
      && detailAccessibilityHardening.includes("event.target.closest('#detail-notes-wrapper.is-editing-notes')"),
    'dialog focus wrapping must include only rendered tabbable controls and let the inline notes editor own its first Escape'
  );
  assert(
    previewHtml.includes('<section id="detail-right-pane" aria-label="Order detail workspaces">')
      && !previewHtml.includes('<main id="detail-right-pane">')
      && previewHtml.indexOf('id="manual-mockup-file-input"') < previewHtml.indexOf('id="manual-mockup-upload-btn"')
      && previewHtml.includes('id="notes-modal-status"'),
    'Order Detail must avoid a nested main landmark and expose visible focus/error targets for upload and notes mutation'
  );
  assert(
    previewHtml.includes('id="detail-tab-overview" class="detail-tab-item active"')
      && previewHtml.includes('id="tab-overview" class="detail-tab-panel active detail-overview"')
      && previewHtml.includes('id="overview-primary-action"')
      && previewHtml.includes('id="overview-attention-list"')
      && previewHtml.includes('id="overview-milestone-materials"')
      && detailEnhancements.includes("activateDetailTab('tab-overview')")
      && detailEnhancements.includes('function renderOverview(order, result = null)')
      && detailEnhancements.includes(": !printItem && Boolean(String(item?.sku || '').trim())")
      && detailEnhancements.includes("reasons.push('This production order is marked as needing attention.')")
      && detailEnhancements.includes("mobileAnchor: 'ready-controls'")
      && detailEnhancements.includes("mobileAnchor: 'progress-section'")
      && detailEnhancements.includes("window.matchMedia?.('(max-width: 900px)')?.matches")
      && detailEnhancements.includes("activateDetailTab(action.dataset.overviewTarget, { focus: true })"),
    'Overview must be the default Shopify order-detail workspace, retain web garment counts, share the attention model, and route mobile production actions to their controls'
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
    detailCss.includes('--detail-border-strong:')
      && /#detail-overlay\.hidden\s*\{[\s\S]*?display:\s*none\s*!important;/.test(detailCss)
      && detailCss.includes('#manual-mockup-file-input:focus-visible + #manual-mockup-upload-btn')
      && detailCss.includes('@media (pointer: coarse), (any-pointer: coarse)')
      && /@media \(max-width: 900px\)[\s\S]*?min-height:\s*44px;/.test(detailCss)
      && /\.mockup-dot\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/.test(detailCss),
    'detail styling must define its border token, remove closed layout, expose upload focus, and enforce mobile touch targets'
  );
  assert(
    /@media \(max-width: 900px\)[\s\S]*?#detail-content[\s\S]*?overflow-y:\s*auto/.test(detailCss),
    'mobile order detail must keep #detail-content as its explicit vertical scroll owner'
  );
  assert(
    /@media \(max-width: 900px\)[\s\S]*?#detail-left-pane[\s\S]*?order:\s*2;/.test(detailCss)
      && /@media \(max-width: 900px\)[\s\S]*?#detail-right-pane[\s\S]*?order:\s*1;/.test(detailCss)
      && /\.overview-primary-action\s*\{[\s\S]*?min-height:\s*44px;/.test(detailCss)
      && /\.overview-milestones\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/.test(detailCss),
    'Overview must lead the mobile detail flow while keeping a complete, touch-safe workflow snapshot'
  );
  assert(
    /#detail-items-wrapper\s*\{[\s\S]*?overflow:\s*visible;/.test(detailCss)
      && !/\.detail-table\s*\{[\s\S]*?min-width:\s*620px;/.test(detailCss),
    'line-item tables must stay fully visible without becoming a nested scroll owner'
  );
  assert(
    /\.detail-mockup-context-product\s*\{[\s\S]*?display:\s*grid;[\s\S]*?min-width:\s*0;/.test(detailCss)
      && /\.detail-mockup-context-product-name\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/.test(detailCss)
      && /\.detail-mockup-context-quantities\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;/.test(detailCss)
      && /\.detail-mockup-quantity\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?white-space:\s*normal;/.test(detailCss),
    'detail mockup context must wrap long product titles and keep every quantity pill inside the pane'
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
  assert(
    webShim.includes('window.api.uploadOrderDesignAsset')
      && webShim.includes('`/order-manager/v1/orders/${encodeURIComponent(orderId)}/assets`')
      && webShim.includes('window.api.deleteOrderDesignAsset')
      && detailEnhancements.includes('window.refreshCanonicalOrderDetail'),
    'manual design mutations must use authenticated canonical endpoints and refresh the open canonical detail'
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
  const webHtml = fs.readFileSync(path.join(root, 'order-manager-web', 'index.html'), 'utf8');
  const accessibilityJs = fs.readFileSync(path.join(root, 'order-manager-web', 'accessibility-hardening.js'), 'utf8');
  const storageBrowserSource = fs.readFileSync(path.join(root, 'order-manager-web', 'storage-browser.js'), 'utf8');
  const previousOrdersSource = fs.readFileSync(path.join(root, 'order-manager-web', 'previous-orders.js'), 'utf8');
  const detailOverlaySource = fs.readFileSync(path.join(root, 'order-manager-web', 'detail-overlay-enhancements.js'), 'utf8');
  const dashboardTriageSource = fs.readFileSync(path.join(root, 'order-manager-web', 'dashboard-triage-enhancements.js'), 'utf8');
  const setActiveViewSource = storageBrowserSource.slice(
    storageBrowserSource.indexOf('function setActiveView'),
    storageBrowserSource.indexOf('async function fetchList')
  );
  const loadPreviewsSource = storageBrowserSource.slice(
    storageBrowserSource.indexOf('async function loadPreviews'),
    storageBrowserSource.indexOf('function buildAllCustomerGroups')
  );
  assert(
    previewHtml.includes("printmo:shopify:embedded-context-v1")
      && previewHtml.includes('window.history.replaceState')
      && previewHtml.includes('id="board-load-state"')
      && previewHtml.includes('id="board-load-retry"')
      && webShim.includes('SHOPIFY_CONTEXT_MISSING')
      && webShim.includes('SHOPIFY_AUTH_TIMEOUT')
      && webShim.includes('waitForShopifyIdTokenApi'),
    'embedded launch must restore validated Shopify context before App Bridge and expose retryable auth/load failures'
  );
  assert(
    sharedRenderer.includes("const MOBILE_TABS = ['pipeline', 'blanksCart', 'blanksOrdered', 'readyToPrint', 'storage', 'history']")
      && sharedRenderer.includes("nextTab === 'history' ? 'previous' : 'orders'")
      && sharedRenderer.includes("setBoardLoadState('error', boardLoadErrorPresentation(error))")
      && sharedRenderer.includes('setupBoardLoadRecovery()')
      && dashboardTriageSource.includes("boardState !== 'ready' || visible > 0"),
    'mobile navigation must reach Storage and History while failed board loads never masquerade as a genuine empty pipeline'
  );
  assert(
    webHtml.includes('data-view="previous"')
      && webHtml.includes('data-tab="history"')
      && webHtml.includes('id="previous-orders-view"')
      && webHtml.includes('src="./previous-orders.js"')
      && webShim.includes('window.api.getPreviousOrders')
      && webShim.includes('view: "previous"')
      && previousOrdersSource.includes('const PAGE_SIZE = 25')
      && previousOrdersSource.includes('window.mapCandidateOrderForDetail(order)')
      && previousOrdersSource.includes('const openDetail = window.openDetail || window.openOrderManagerDetail')
      && previousOrdersSource.includes('appContent.appendChild(overlay)')
      && previousOrdersSource.includes('mapped._historyReadOnly = true')
      && previousOrdersSource.includes('productionWrite: false')
      && detailOverlaySource.includes('window.openOrderManagerDetail = enhancedOpenDetail')
      && setActiveViewSource.includes("nextView === 'previous'")
      && setActiveViewSource.includes('window.loadPreviousOrders()')
      && !loadPreviewsSource.includes('nextView')
      && !previousOrdersSource.includes('window.api.getOrderDetail(order.id)')
      && !previousOrdersSource.includes('hydrateCandidateAssets')
      && !previousOrdersSource.includes('setInterval'),
    'Previous Orders must load on desktop navigation, open shared detail before canonical hydration, and remain view-only without polling or list artwork'
  );
  assert(
    source.includes("fulfillmentStatus === 'FULFILLED'")
      && source.includes("json_extract(commerce_json, '$.commerce.fulfillmentStatus')")
      && source.includes("ORDER BY COALESCE(shopify_updated_at, updated_at) DESC")
      && source.includes("JSON.stringify({ view, q, stage, limit })")
      && source.includes("view === 'active' && ctx?.waitUntil"),
    'fulfilled source state must control projection activity and history must bind pagination to view/search without asset backfill'
  );
  assert(
    webHtml.includes('detail-close-icon-dismiss')
      && webHtml.includes('detail-close-icon-back')
      && webHtml.includes('<span class="detail-close-label">Back</span>')
      && sharedRenderer.includes("const detailWasOpen = isMobileViewport && document.body?.classList.contains('detail-open')")
      && sharedRenderer.includes("if (detailWasOpen) document.getElementById('detail-close')?.click();")
      && storageBrowserSource.includes("const detailWasOpen = document.body.classList.contains('detail-open')")
      && storageBrowserSource.includes("if (detailWasOpen) document.getElementById('detail-close')?.click()"),
    'mobile Order Detail must provide Back and close before any global Orders, Blanks, Print, or Storage navigation'
  );
  assert(
    accessibilityJs.includes("config.mobileDrillIn && current.classList.contains('app-content')")
      && accessibilityJs.includes("document.getElementById('mobile-command-surface')")
      && accessibilityJs.includes("config.rootElement.setAttribute('aria-modal', mobileDrillIn ? 'false' : 'true')"),
    'mobile Order Detail must isolate the covered board without making the global mobile command surface inert'
  );
  assert(
    webHtml.includes('id="ss-submission-overlay"')
      && webHtml.includes('id="ss-submission-lines-body"')
      && sharedRenderer.includes('supplierSubmissionReportFromError')
      && sharedRenderer.includes("result?.acceptedOrderNames")
      && sharedRenderer.includes('result.itemNames')
      && webShim.includes('/order-manager/v1/batches/latest')
      && accessibilityJs.includes("root: '#ss-submission-overlay'"),
    'S&S submission feedback must retain a persistent, keyboard-contained line-result report and move only accepted orders'
  );
  assert(
    source.includes('const rejectedOrderIds = gids.filter')
      && source.includes('DELETE FROM batch_orders WHERE batch_id = ? AND order_gid = ?'),
    'partial supplier batches must remove rejected memberships before confirmed-batch metadata reconciliation'
  );
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
    fs.readFileSync(path.join(root, 'order-manager-web', 'order-detail-state.js'), 'utf8').includes("return 'completed'")
      && fs.readFileSync(path.join(root, 'order-manager-web', 'order-detail-state.js'), 'utf8').includes("return 'print'")
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
    desktopCss.includes('.board-load-state[data-state="error"]')
      && mobileCss.includes('.board-load-state[data-state="error"]')
      && mobileCss.includes('#board-load-retry')
      && mobileCss.includes('min-height: 44px')
      && mobileCss.includes('body.mobile-mode[data-active-view="storage"] #orders-view'),
    'board load recovery must remain visible, responsive, and touch-safe at mobile widths'
  );
  assert(
    mobileCss.includes('body.mobile-mode #detail-overlay.mobile-fullscreen-detail')
      && mobileCss.includes('position: absolute;')
      && mobileCss.includes('body.mobile-mode.detail-open #mobile-refresh-btn')
      && mobileCss.includes('.detail-close-icon-dismiss')
      && mobileCss.includes('.detail-close-icon-back')
      && detailCss.includes('.detail-close-icon-back'),
    'mobile Order Detail must sit beneath the command surface, expose Back, and hide the unrelated Sync action while open'
  );
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
    sharedRenderer.includes('isCatalogPreview: true')
      && sharedRenderer.includes('Etsy catalog preview')
      && detailEnhancements.includes('catalogPreview: mergeCatalogPreview(existing.catalogPreview, item.catalogPreview)')
      && detailEnhancements.includes('function mergeCatalogPreview(existingPreview, incomingPreview)'),
    'resolved Etsy catalog previews must remain read-only recognition images in the detail artwork browser after canonical detail hydration'
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
  assert(
    embeddedMobile.includes("overlay?.classList.toggle('mobile-fullscreen-detail', isMobile())")
      && embeddedMobile.includes("overlay?.setAttribute('aria-modal', mobile ? 'false' : 'true')")
      && embeddedMobile.includes("close?.setAttribute('aria-label', mobile ? 'Back to order board' : 'Close order details')")
      && embeddedMobile.includes("if (detailWasOpen) document.getElementById('detail-close')?.click()"),
    'embedded mobile must establish drill-in semantics before detail opens and restore desktop modal semantics outside the breakpoint'
  );

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
  shimContext.URLSearchParams = URLSearchParams;
  shimContext.setTimeout = setTimeout;
  shimContext.window.location = { search: '' };
  delete shimContext.window.shopify;
  await assert.rejects(
    () => shimContext.getShopifyIdToken({ force: true }),
    error => error?.code === 'SHOPIFY_CONTEXT_MISSING',
    'a launch without Shopify context must fail explicitly instead of returning an empty board'
  );
  shimContext.window.shopify = {
    async idToken() {
      idTokenCalls += 1;
      return reusableToken;
    },
  };

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
