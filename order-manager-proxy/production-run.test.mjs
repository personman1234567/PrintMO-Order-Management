import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createProductionRunService, normalizeRunOrders } from './production-run.mjs';
const workerSource = readFileSync(new URL('./worker.js', import.meta.url), 'utf8')
  .replace(/from '(\.\/[^']+)'/g, (_, source) => `from ${JSON.stringify(new URL(source, import.meta.url).href)}`);
const { promoteDraftTargetDate } = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('./migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
  for (const id of [1, 2]) sqlite.prepare("INSERT INTO shops (id, shop_domain, installed_at, created_at, updated_at) VALUES (?, ?, 'now', 'now', 'now')").run(id, `shop${id}.myshopify.com`);
  const wrap = (sql, args = []) => ({ bind: (...next) => wrap(sql, next),
    run: () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
    first: () => sqlite.prepare(sql).get(...args), all: () => ({ results: sqlite.prepare(sql).all(...args) }) });
  const db = { prepare: sql => wrap(sql), async batch(statements) {
    sqlite.exec('BEGIN'); try { const result = statements.map(s => s.run()); sqlite.exec('COMMIT'); return result; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  const order = (id, shop = 1, stage = 'print') => {
    const gid = `gid://shopify/Order/${id}`;
    sqlite.prepare(`INSERT INTO order_projection (shop_id, order_gid, stage, active, production_revision, production_json, created_at, updated_at)
      VALUES (?, ?, ?, 1, 0, '{}', 'now', 'now')`).run(shop, gid, stage);
    return { provider: 'shopify', id: gid };
  };
  return { sqlite, db, order, service: createProductionRunService(db, 1) };
}
const patch = (version, operation, orders, idempotencyKey = crypto.randomUUID()) => ({ expectedVersion: version, operation, orders, idempotencyKey });
test('the optional run starts empty, persists whole identities and never changes order stages', async () => {
  const f = fixture(), first = f.order(1), second = f.order(2);
  assert.deepEqual(await f.service.get(), { revision: 0, orders: [], updatedAt: null });
  const saved = await f.service.patch(patch(0, 'add', [second, first, first]), 'operator:one');
  assert.equal(saved.revision, 1); assert.deepEqual(saved.orders, [first, second]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM order_projection WHERE stage = 'print'").get().n, 2);
  assert.deepEqual((await f.service.get()).orders, [first, second]);
  assert.deepEqual((await createProductionRunService(f.db, 2).get()).orders, []);
});
test('stale devices cannot overwrite a run; rebasing a delta preserves another operator’s additions', async () => {
  const f = fixture(), one = f.order(1), two = f.order(2);
  await f.service.patch(patch(0, 'add', [one]), 'operator:one');
  await assert.rejects(f.service.patch(patch(0, 'add', [two]), 'operator:two'), error => error.code === 'VERSION_CONFLICT' && error.details.current.revision === 1);
  const merged = await f.service.patch(patch(1, 'add', [two]), 'operator:two');
  assert.deepEqual(merged.orders, [one, two]);
  await assert.rejects(f.service.patch(patch(1, 'clear', []), 'operator:one'), error => error.code === 'VERSION_CONFLICT');
  assert.deepEqual((await f.service.get()).orders, [one, two]);
});
test('concurrent saves have a single winner and idempotent retries cannot replay a removal or clear twice', async () => {
  const f = fixture(), one = f.order(1), two = f.order(2);
  const result = await Promise.allSettled([f.service.patch(patch(0, 'add', [one]), 'a'), f.service.patch(patch(0, 'add', [two]), 'b')]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(result.filter(item => item.status === 'rejected' && item.reason.code === 'VERSION_CONFLICT').length, 1);
  const current = await f.service.get(), clear = patch(current.revision, 'clear', []);
  const cleared = await f.service.patch(clear, 'a');
  await f.service.patch(patch(cleared.revision, 'add', [two]), 'b');
  assert.deepEqual(await f.service.patch(clear, 'a'), cleared);
  assert.deepEqual((await f.service.get()).orders, [two]);
  await assert.rejects(f.service.patch({ ...clear, operation: 'add', orders: [one] }, 'a'), error => error.code === 'IDEMPOTENCY_KEY_REUSE');
});
test('only shop-owned active To Print orders can be added, but completed orders can always be removed', async () => {
  const f = fixture(), other = f.order(2, 2), pipeline = f.order(3, 1, 'received'), valid = f.order(4);
  for (const entry of [other, pipeline, { provider: 'shopify', id: 'gid://shopify/Order/999' }])
    await assert.rejects(f.service.patch(patch(0, 'add', [entry]), 'a'), error => error.code === 'RUN_ORDER_UNAVAILABLE');
  await f.service.patch(patch(0, 'add', [valid]), 'a');
  f.sqlite.prepare("UPDATE order_projection SET stage = 'completed', active = 0 WHERE order_gid = ?").run(valid.id);
  assert.deepEqual((await f.service.patch(patch(1, 'remove', [valid]), 'a')).orders, []);
  assert.throws(() => normalizeRunOrders([{ provider: 'legacy', id: 'anything' }]), /invalid/);
  assert.throws(() => normalizeRunOrders([{ provider: 'shopify', id: '<script>' }]), /invalid/);
  assert.throws(() => normalizeRunOrders(Array.from({ length: 501 }, (_, i) => ({ provider: 'shopify', id: `gid://shopify/Order/${i}` }))), /500/);
});
test('draft date promotion writes only the canonical date, retries CAS once and never revives an explicitly cleared date', async () => {
  const f = fixture(), gid = 'gid://shopify/Order/84';
  let state = { schemaVersion: 1, stage: 'print', revision: 3, printedCount: 2, internalNotes: 'Keep these instructions',
    readiness: { blanksReady: true, printsReady: false }, targetDate: null }, writes = 0, conflict = false;
  const env = { ORDER_DB: f.db, SHOPIFY_SHOP_DOMAIN: 'shop1.myshopify.com', ORDER_SYNC_COORDINATOR: {
    idFromName: name => name, get: () => ({ fetch: async request => {
      const body = await request.json();
      if (body.operationName === 'PrintMOProductionState') return Response.json({ data: { order: {
        id: gid, name: '#1084', displayFulfillmentStatus: 'UNFULFILLED',
        metafield: { value: JSON.stringify(state), compareDigest: `digest:${state.revision}` }
      } } });
      assert.equal(body.operationName, 'PrintMOSetProductionState'); ++writes;
      if (conflict) {
        conflict = false; state = { ...state, revision: state.revision + 1, internalNotes: 'Changed on another device' };
        return Response.json({ data: { metafieldsSet: { userErrors: [{ code: 'INVALID_COMPARE_DIGEST', message: 'stale digest' }] } } });
      }
      assert.equal(body.variables.metafields[0].compareDigest, `digest:${state.revision}`);
      state = JSON.parse(body.variables.metafields[0].value);
      return Response.json({ data: { metafieldsSet: { metafields: [{ value: JSON.stringify(state), compareDigest: `digest:${state.revision}` }], userErrors: [] } } });
    } })
  } };
  const mutation = 'draft-target:1:42:1';
  assert.equal(await promoteDraftTargetDate(env, gid, '2026-11-02', mutation), 'pending');
  assert.equal(writes, 0, 'preparation cannot enroll an absent or unpaid order');
  f.order(84); conflict = true;
  assert.equal(await promoteDraftTargetDate(env, gid, '2026-11-02', mutation), 'applied');
  assert.equal(writes, 2); assert.equal(state.targetDate, '2026-11-02'); assert.equal(state.stage, 'print');
  assert.equal(state.printedCount, 2); assert.equal(state.internalNotes, 'Changed on another device');
  assert.equal(await promoteDraftTargetDate(env, gid, '2026-11-02', mutation), 'applied');
  assert.equal(writes, 2, 'a repaired acknowledgment must not write the date a second time');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM production_events WHERE action = 'draft.target-date'").get().n, 1);
  state = { ...state, targetDate: null, revision: state.revision + 1, lastMutationId: 'manual-clear' };
  f.sqlite.prepare(`INSERT INTO production_events (id, shop_id, order_gid, actor_id, action, changed_fields_json, outcome, created_at)
    VALUES ('manual-clear', 1, ?, 'operator', 'production.patch', '["targetDate"]', 'committed', 'now')`).run(gid);
  assert.equal(await promoteDraftTargetDate(env, gid, '2026-11-02', mutation), 'kept-existing');
  assert.equal(state.targetDate, null); assert.equal(writes, 2);
});
