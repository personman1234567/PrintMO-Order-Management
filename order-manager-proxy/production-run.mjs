const fail = (code, message, status = 400, current) => {
  throw Object.assign(new Error(message), { code, status, ...(current ? { details: { current } } : {}) });
};
export function normalizeRunOrders(orders) {
  if (!Array.isArray(orders) || orders.length > 1000) fail('INVALID_RUN', 'Select up to 500 orders.');
  const unique = new Map();
  for (const order of orders) {
    if (!order || !['shopify', 'etsy'].includes(order.provider) || typeof order.id !== 'string'
      || (order.provider === 'shopify' ? !/^gid:\/\/shopify\/Order\/\d+$/.test(order.id)
        : !/^etsy:[A-Za-z0-9:_-]{1,180}$/.test(order.id))) fail('INVALID_RUN_ORDER', 'An order identity is invalid. Refresh orders.');
    const item = { provider: order.provider, id: order.id };
    unique.set(JSON.stringify(item), item);
  }
  if (unique.size > 500) fail('INVALID_RUN', 'Select up to 500 orders.');
  return [...unique.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}
export function createProductionRunService(db, shopId) {
  const dto = row => row ? { revision: row.revision, orders: JSON.parse(row.orders_json), updatedAt: row.updated_at }
    : { revision: 0, orders: [], updatedAt: null };
  const get = async () => dto(await db.prepare('SELECT * FROM production_runs WHERE shop_id = ?').bind(shopId).first());
  async function patch(body, actor) {
    if (!body || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0
      || !['add', 'remove', 'clear'].includes(body.operation)
      || !/^[A-Za-z0-9._:-]{8,200}$/.test(body.idempotencyKey || '')) fail('INVALID_RUN', 'Refresh the run before saving.');
    if (body.orders?.length > 500) fail('INVALID_RUN', 'Select up to 500 orders.');
    const orders = normalizeRunOrders(body.orders || []);
    const request = JSON.stringify({ expectedVersion: body.expectedVersion, operation: body.operation, orders });
    const lookup = () => db.prepare(`SELECT request_json, result_json FROM production_run_mutations
      WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?`).bind(shopId, actor, body.idempotencyKey).first();
    const replay = row => {
      if (row.request_json !== request) fail('IDEMPOTENCY_KEY_REUSE', 'This save was already used for a different selection.', 409);
      return JSON.parse(row.result_json);
    };
    const previous = await lookup();
    if (previous) return replay(previous);
    const current = await get();
    if (current.revision !== body.expectedVersion) fail('VERSION_CONFLICT', 'The shared run changed on another device.', 409, current);
    // Validate additions against enrolled, active To Print projections. Removal and
    // clearing remain possible after completion or fulfillment.
    if (body.operation === 'add') for (const order of orders) {
      const row = order.provider === 'shopify'
        ? await db.prepare("SELECT order_gid FROM order_projection WHERE shop_id = ? AND order_gid = ? AND active = 1 AND stage = 'print'").bind(shopId, order.id).first()
        : await db.prepare(`SELECT p.order_key FROM provider_order_projection p JOIN provider_production_state s
          ON s.shop_id = p.shop_id AND s.order_key = p.order_key
          WHERE p.shop_id = ? AND p.order_key = ? AND p.board_enrolled = 1
          AND json_extract(s.state_json, '$.stage') = 'print'
          AND json_extract(s.state_json, '$.archivedAt') IS NULL`).bind(shopId, order.id).first();
      if (!row) fail('RUN_ORDER_UNAVAILABLE', 'A selected order is no longer in To Print. Refresh the planner.', 409);
    }
    const keys = new Set(orders.map(order => JSON.stringify(order)));
    const next = body.operation === 'clear' ? [] : body.operation === 'remove'
      ? current.orders.filter(order => !keys.has(JSON.stringify(order))) : normalizeRunOrders([...current.orders, ...orders]);
    const stamp = new Date().toISOString(), mutation = crypto.randomUUID();
    const result = { revision: current.revision + 1, orders: next, updatedAt: stamp };
    await db.batch([
      db.prepare('INSERT INTO production_runs (shop_id) VALUES (?) ON CONFLICT(shop_id) DO NOTHING').bind(shopId),
      db.prepare(`UPDATE production_runs SET orders_json = ?, revision = revision + 1,
        last_mutation_id = ?, updated_by = ?, updated_at = ? WHERE shop_id = ? AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM production_run_mutations WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?)`)
        .bind(JSON.stringify(next), mutation, actor, stamp, shopId, current.revision, shopId, actor, body.idempotencyKey),
      db.prepare(`INSERT INTO production_run_mutations
        (shop_id, actor_id, idempotency_key, request_json, result_json, created_at)
        SELECT ?, ?, ?, ?, ?, ? FROM production_runs WHERE shop_id = ? AND last_mutation_id = ?
        ON CONFLICT(shop_id, actor_id, idempotency_key) DO NOTHING`)
        .bind(shopId, actor, body.idempotencyKey, request, JSON.stringify(result), stamp, shopId, mutation)
    ]);
    const saved = await lookup();
    if (!saved) fail('VERSION_CONFLICT', 'The shared run changed on another device.', 409, await get());
    return replay(saved);
  }
  return { get, patch };
}
