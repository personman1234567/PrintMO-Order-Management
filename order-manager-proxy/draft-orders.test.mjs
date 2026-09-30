import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createDraftOrderService, matchDraftAssignments, draftUploadMetadata } from './draft-orders.mjs';

const line = (id, sku = 'BLACK-M', attrs = []) => ({ id, sku, title: 'Cotton tee', variantTitle: 'Black / M', quantity: 3, customAttributes: attrs });
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('./migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
  sqlite.prepare(`INSERT INTO shops (id, shop_domain, installed_at, created_at, updated_at) VALUES (1, 'test.myshopify.com', 'now', 'now', 'now')`).run();
  const wrap = (sql, values = []) => ({ bind(...next) { return wrap(sql, next); },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
    async first() { return sqlite.prepare(sql).get(...values); },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; } });
  const db = { prepare: sql => wrap(sql), async batch(statements) {
    sqlite.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  const draft = { id: 'gid://shopify/DraftOrder/42', name: '#D42', status: 'OPEN', createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z', email: 'fixture@example.test', totalQuantityOfLineItems: 6,
    totalPriceSet: { presentmentMoney: { amount: '80', currencyCode: 'USD' } },
    lineItems: { nodes: [line('draft-m'), { ...line('draft-l', 'BLACK-L'), variantTitle: 'Black / L' }], pageInfo: { hasNextPage: false } }, order: null };
  const objects = new Map();
  const calls = [];
  const env = { ORDER_DB: db, DRAFT_ORDERS_ENABLED: '1', R2_BUCKET: {
    async put(key, bytes, options) { objects.set(key, { bytes: new Uint8Array(bytes), options }); },
    async get(key) { const value = objects.get(key); return value ? { body: value.bytes, httpEtag: 'fixture-etag', writeHttpMetadata: headers => headers.set('Content-Type', value.options.httpMetadata.contentType), arrayBuffer: async () => value.bytes.buffer } : null; }
  } };
  let currentOrderItems = [];
  const deps = { shop: async () => ({ id: 1 }),
    graphql: async (_env, query, variables, operation) => {
      calls.push({ query, variables, operation });
      if (operation === 'PrintMODraft') return { data: { draftOrder: structuredClone(draft) } };
      if (operation === 'PrintMODrafts') return { data: { draftOrders: { nodes: [structuredClone(draft)], pageInfo: { hasNextPage: true, endCursor: 'next-page' } } } };
      if (operation === 'PrintMODraftOrderLines') return { data: { order: { id: draft.order.id,
        lineItems: { nodes: currentOrderItems, pageInfo: { hasNextPage: false } } } } };
      throw Error(`Unexpected operation ${operation}`);
    } };
  const service = createDraftOrderService(env, deps);
  const path = `/order-manager/v1/drafts/${encodeURIComponent(draft.id)}`;
  const request = (suffix = '', method = 'GET', body) => service.handle(new Request(`https://worker.test${path}${suffix}`, {
    method, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {})
  }), 'fixture:operator');
  const upload = (ids = ['draft-m', 'draft-l'], role = 'design', key = 'fixture_upload_12345') => {
    const form = new FormData(); form.set('file', new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'front.svg', { type: 'image/svg+xml' }));
    form.set('role', role); form.set('placement', 'front'); form.set('lineItemIds', JSON.stringify(ids)); form.set('uploadId', key);
    return request('/assets', 'POST', form);
  };
  const convert = (items = draft.lineItems.nodes.map((item, i) => ({ ...item, id: `order-${i}` }))) => {
    draft.order = { id: 'gid://shopify/Order/84', name: '#1084', displayFinancialStatus: 'PENDING' };
    draft.status = 'COMPLETED'; currentOrderItems = items;
  };
  return { db, deps, sqlite, draft, objects, calls, env, service, request, upload, convert, setOrderItems: items => { currentOrderItems = items; } };
}

test('matching preserves explicit garment identity and refuses duplicate or different artwork', () => {
  const saved = line('draft');
  assert.deepEqual(matchDraftAssignments([saved], [line('order')]).matched.map(item => item.id), ['order']);
  assert.equal(matchDraftAssignments([saved], [line('a'), line('b')]).needsReview, true);
  assert.equal(matchDraftAssignments([saved], [line('order', 'BLACK-M', [{ key: '_designref', value: 'different' }])]).needsReview, true);
  assert.equal(matchDraftAssignments([saved], [{ ...saved, quantity: 20 }], { sameKind: true }).needsReview, false);
});
test('print exports accept only PNG/SVG; role, placement, declared type and size are validated', () => {
  assert.equal(draftUploadMetadata(new File(['x'], 'print.png', { type: 'image/png' }), 'design', 'left-chest').placement, 'left-chest');
  assert.throws(() => draftUploadMetadata(new File(['x'], 'print.jpg', { type: 'image/jpeg' }), 'design', 'front'), /PNG or SVG/);
  assert.throws(() => draftUploadMetadata(new File(['x'], 'print.svg', { type: 'text/html' }), 'design', 'front'), /PNG or SVG/);
  assert.throws(() => draftUploadMetadata(new File([], 'print.svg'), 'design', 'front'), /50 MB/);
  assert.throws(() => draftUploadMetadata(new File(['x'], 'print.png'), 'design', 'bottom'), /placement/);
});
test('uploads remain private, retries reuse bytes, and assignment revisions prevent stale writes', async () => {
  const f = fixture();
  const first = await f.upload(); const asset = first.artwork[0];
  assert.equal(f.objects.size, 1);
  assert.deepEqual(asset.lineItemIds, ['draft-m', 'draft-l']);
  assert.equal(JSON.stringify(first).includes('object_key'), false);
  assert.equal(JSON.stringify(first).includes('drafts/42/'), false);
  const retry = await f.upload(); assert.equal(retry.artwork[0].assetId, asset.assetId); assert.equal(f.objects.size, 1);
  const updated = await f.request(`/assets/${asset.assetId}`, 'PATCH', { revision: 1, placement: 'left-chest', lineItemIds: ['draft-m'] });
  assert.equal(updated.artwork[0].revision, 2);
  await assert.rejects(f.request(`/assets/${asset.assetId}`, 'PATCH', { revision: 1, placement: 'back', lineItemIds: ['draft-l'] }), /another device/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM order_projection').get().count, 0, 'draft preparation cannot enroll production');
});
test('conversion reuses private blobs and preserves selected items exactly once without production enrollment', async () => {
  const f = fixture(); const first = await f.upload(); f.convert();
  const result = await f.request(); await f.request();
  assert.equal(result.editable, false); assert.equal(result.financialStatus, 'PENDING');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM asset_manifests').get().count, 1);
  const links = f.sqlite.prepare('SELECT * FROM asset_manifest_links ORDER BY line_item_id').all();
  assert.deepEqual(links.map(link => link.line_item_id), ['order-0', 'order-1']);
  assert.equal(links[0].origin_draft_gid, f.draft.id);
  assert.equal(links[0].assignment_status, 'assigned');
  assert.equal(f.objects.size, 1); assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM order_projection').get().count, 0);
  await assert.rejects(f.upload(['order-0']), /became an order/);
  assert.equal(first.artwork[0].assetId, f.sqlite.prepare('SELECT id FROM asset_manifests').get().id);
});
test('changed or ambiguous order items retain files with a visible review state; reassignment repairs links', async () => {
  const f = fixture(); const first = await f.upload(['draft-m']);
  f.convert([line('order-a'), line('order-b')]);
  let result = await f.request(); assert.equal(result.assignmentReview, true);
  assert.equal(f.sqlite.prepare('SELECT line_item_id FROM asset_manifest_links').get().line_item_id, '');
  result = await f.request(`/assets/${first.artwork[0].assetId}`, 'PATCH', { revision: 1, placement: 'left-sleeve', lineItemIds: ['order-b'] });
  assert.equal(result.assignmentReview, false);
  const link = f.sqlite.prepare('SELECT * FROM asset_manifest_links').get();
  assert.equal(link.line_item_id, 'order-b'); assert.equal(link.placement, 'left-sleeve');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM asset_manifest_links').get().count, 1);
});
test('Shopify item edits surface reassignment, deleted drafts retain private bytes, removed assets do not revive', async () => {
  const f = fixture(); const first = await f.upload(['draft-m']);
  f.draft.lineItems.nodes[0].sku = 'NEW-SKU';
  assert.equal((await f.request()).assignmentReview, true);
  await f.request(`/assets/${first.artwork[0].assetId}`, 'DELETE', { revision: 1 });
  const retry = await f.upload(['draft-l']); assert.equal(retry.artwork.length, 0);
  f.convert(); await f.request();
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM asset_manifests').get().count, 0);
  await f.service.deleted(f.draft.id); assert.equal(f.objects.size, 1);
});
test('conversion during the R2 upload is recovered before returning; reconciliation repairs missed webhooks', async () => {
  const f = fixture(); const put = f.env.R2_BUCKET.put;
  f.env.R2_BUCKET.put = async (...args) => { await put(...args); f.convert(); };
  const result = await f.upload(); assert.equal(result.orderId, 'gid://shopify/Order/84');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM asset_manifest_links').get().count, 2);
  const g = fixture(); await g.upload(); g.convert(); await g.service.reconcile();
  assert.equal(g.sqlite.prepare('SELECT converted_order_gid FROM draft_artwork').get().converted_order_gid, 'gid://shopify/Order/84');
});
test('pagination/filter state uses Shopify and scope-disabled service fails explicitly', async () => {
  const f = fixture(); const list = await f.service.list({ status: 'invoice', after: 'page-1', query: 'D42' });
  assert.equal(list.nextCursor, 'next-page');
  assert.equal(f.calls[0].variables.after, 'page-1'); assert.match(f.calls[0].variables.query, /status:invoice_sent/);
  f.env.DRAFT_ORDERS_ENABLED = '0';
  await assert.rejects(f.request(), /approve Shopify draft order access/);
});

test('a conversion that wins the removal race retains purchased artwork', async () => {
  const f = fixture(); const asset = (await f.upload()).artwork[0];
  const prepare = f.db.prepare;
  f.db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.startsWith('UPDATE draft_artwork SET items_json')) return statement;
    const bind = statement.bind;
    statement.bind = (...values) => {
      const bound = bind(...values), run = bound.run;
      bound.run = async () => {
        f.db.prepare = prepare; f.convert(); await f.service.detail(f.draft.id);
        return run();
      };
      return bound;
    };
    return statement;
  };
  await assert.rejects(f.request(`/assets/${asset.assetId}`, 'DELETE', { revision: 1 }), /changed/);
  assert.equal(f.sqlite.prepare('SELECT state FROM draft_artwork').get().state, 'active');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM asset_manifest_links').get().count, 2);
});
test('paid-order-first reconciliation finds a prepared recent conversion', async () => {
  const f = fixture(); await f.upload(); f.convert();
  await f.service.reconcile({ orderId: f.draft.order.id });
  assert.equal(f.sqlite.prepare('SELECT converted_order_gid FROM draft_artwork').get().converted_order_gid, f.draft.order.id);
  assert.equal(f.calls.filter(call => call.operation === 'PrintMODrafts').length, 1);
});
test('Worker authenticates draft routes, verifies draft webhooks, retries failures and keeps private SVG tickets isolated', async () => {
  const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8')
    .replace("'./draft-orders.mjs'", JSON.stringify(new URL('./draft-orders.mjs', import.meta.url).href));
  const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const f = fixture(); const secret = 'draft-fixture-secret';
  Object.assign(f.env, { SHOPIFY_API_KEY: 'draft-fixture-app', SHOPIFY_API_SECRET: secret,
    SHOPIFY_SHOP_DOMAIN: 'test.myshopify.com', PARTNER_USER_IDS: 'operator', ORDER_SYNC_COORDINATOR: {
      idFromName: shop => shop, get: () => ({ fetch: async request => {
        const input = await request.json(); return Response.json(await f.deps.graphql(f.env, input.query, input.variables, input.operationName));
      } })
    } });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: f.env.SHOPIFY_API_KEY, sub: 'operator',
    dest: 'https://test.myshopify.com', iss: 'https://test.myshopify.com/admin', exp: Math.floor(Date.now() / 1000) + 60 })}`;
  const token = `${signingInput}.${createHmac('sha256', secret).update(signingInput).digest('base64url')}`;
  const path = `https://worker.test/order-manager/v1/drafts/${encodeURIComponent(f.draft.id)}`;
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await worker.fetch(new Request(path), f.env)).status, 401);
  assert.equal((await worker.fetch(new Request(path, { headers }), f.env)).status, 200);
  const asset = (await f.upload()).artwork[0];
  const ticketPath = `https://worker.test/order-manager/v1/assets/${asset.assetId}/read-ticket`;
  assert.equal((await worker.fetch(new Request(ticketPath, { method: 'POST' }), f.env)).status, 401);
  const ticket = await (await worker.fetch(new Request(ticketPath, { method: 'POST', headers }), f.env)).json();
  const read = await worker.fetch(new Request(new URL(ticket.url, 'https://worker.test')), f.env);
  assert.equal(read.status, 200); assert.match(read.headers.get('Content-Security-Policy'), /sandbox/);
  assert.equal(read.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal((await worker.fetch(new Request(`https://worker.test/order-manager/v1/assets/${asset.assetId}/read`), f.env)).status, 401);
  const body = JSON.stringify({ id: 42, admin_graphql_api_id: f.draft.id, updated_at: f.draft.updatedAt });
  const webhook = (id, signature = createHmac('sha256', secret).update(body).digest('base64')) => new Request('https://worker.test/order-manager/v1/webhooks/shopify', {
    method: 'POST', body, headers: { 'X-Shopify-Hmac-Sha256': signature, 'X-Shopify-Shop-Domain': 'test.myshopify.com',
      'X-Shopify-Topic': 'draft_orders/update', 'X-Shopify-Webhook-Id': id }
  });
  assert.equal((await worker.fetch(webhook('invalid', 'bad'), f.env)).status, 401);
  const graph = f.deps.graphql;
  f.deps.graphql = async () => ({ errors: [{ extensions: { code: 'ACCESS_DENIED' } }] });
  assert.equal((await worker.fetch(webhook('retry'), f.env)).status, 403);
  f.deps.graphql = graph;
  assert.equal((await worker.fetch(webhook('retry'), f.env)).status, 200);
  const calls = f.calls.length;
  assert.equal((await (await worker.fetch(webhook('retry'), f.env)).json()).duplicate, true);
  assert.equal(f.calls.length, calls);
  assert.equal(f.sqlite.prepare("SELECT order_gid, state FROM webhook_receipts WHERE webhook_id = 'retry'").get().order_gid, null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM order_projection').get().count, 0);
});

test('purchased-order renderer retains every selected garment when deduplicating a shared draft mockup', () => {
  const source = readFileSync(new URL('../renderer.js', import.meta.url), 'utf8');
  const split = source.slice(source.indexOf('function splitOrderAssets(order)'), source.indexOf('function getFirstMockupUrl(order)'));
  const asset = { assetId: 'draft-shared', originDraftId: 'gid://shopify/DraftOrder/42', role: 'mockup', placement: 'front', name: 'mockup.png', url: '' };
  const order = { items: [
    { id: 'order-m', assets: [{ ...asset, lineItemId: 'order-m' }] },
    { id: 'order-l', assets: [{ ...asset, lineItemId: 'order-l' }] },
    { id: 'order-xl', assets: [{ ...asset, assetId: 'draft-chest', role: 'design', placement: 'left-chest', name: 'front.svg', contentType: 'image/svg+xml', lineItemId: 'order-xl' }] },
    { id: 'order-back', assets: [{ ...asset, assetId: 'draft-back', placement: 'back', lineItemId: 'order-back' }] }
  ] };
  const result = runInNewContext(`${split}; splitOrderAssets(order)`, {
    order, getAssetUrlValue: asset => asset.url || '', getAssetDimensionsIn: () => null
  });
  assert.equal(result.mockups.length, 2);
  assert.equal(result.front.length, 0); assert.equal(result.extras[0].placement, 'left-chest');
  assert.deepEqual(Array.from(result.mockups[0].lineItemIds), ['order-m', 'order-l']);
  assert.deepEqual(Array.from(result.mockups[1].lineItemIds), ['order-back']);
});
