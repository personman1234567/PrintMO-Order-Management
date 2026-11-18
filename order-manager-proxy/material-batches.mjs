// Purchase membership is app data. Production changes use the incumbent canonical CAS handler.
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
export function orderedDate(value, fallback = new Date()) {
  const date = value === undefined || value === '' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fallback) : value;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    fail('INVALID_ORDERED_DATE', 'Choose a valid ordered date.');
  return date;
}
export function materialBatchLabel(kind, value, stamp = new Date()) {
  if (value !== undefined && typeof value !== 'string') fail('INVALID_BATCH_NAME', 'Enter a batch name.');
  if (value?.trim().length > 120) fail('INVALID_BATCH_NAME', 'Use a batch name of 120 characters or fewer.');
  return value?.trim() || `${kind === 'prints' ? 'Prints' : 'Apparel'} · ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(stamp)}`;
}
const validId = id => typeof id === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(id);
export function createPrintBatchService(db, shopId, { readOrder, mutateOrder, now = () => new Date() }) {
  async function row(id) {
    if (!validId(id)) fail('INVALID_BATCH', 'Choose a saved print batch.');
    return db.prepare('SELECT * FROM print_material_batches WHERE shop_id = ? AND id = ?').bind(shopId, id).first();
  }
  function dto(r) { return { ...JSON.parse(r.data_json), revision: r.revision }; }
  async function get(id) { const r = await row(id); if (!r) fail('BATCH_NOT_FOUND', 'Print batch not found.', 404); return dto(r); }
  async function list(before) {
    if (before && !validId(before)) fail('INVALID_CURSOR', 'Refresh the batch list.');
    const rows = await db.prepare(`SELECT * FROM print_material_batches WHERE shop_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 101`)
      .bind(...(before ? [shopId, before] : [shopId])).all();
    return { batches: rows.results.slice(0, 100).map(dto), cursor: rows.results.length > 100 ? rows.results[99].id : null };
  }
  async function create(body, actor) {
    if (!validId(body.id)) fail('INVALID_BATCH', 'Refresh and try saving the batch again.');
    const ids = [...new Set((Array.isArray(body.orders) ? body.orders : []).map(ref => ref?.provider === 'shopify' ? ref.orderKey : null))];
    if (!ids.length || ids.length > 100 || ids.some(id => !/^gid:\/\/shopify\/Order\/\d+$/.test(id || ''))) fail('INVALID_MEMBERS', 'Select 1–100 active Shopify customer orders.');
    if (!['saved-sheet', 'ordered'].includes(body.mode)) fail('INVALID_MODE', 'Choose saved-sheet or already ordered prints.');
    const fingerprint = JSON.stringify({ ids: [...ids].sort(), mode: body.mode, label: body.label || '', orderedDate: body.orderedDate || '' });
    const existing = await row(body.id);
    if (existing) {
      if (dto(existing).fingerprint !== fingerprint) fail('BATCH_INTENT_CHANGED', 'This save already belongs to a different selection. Reopen the tool.', 409);
      return get(body.id);
    }
    const members = [];
    for (const id of ids) {
      const order = await readOrder(id);
      if (!order.eligible || order.ready || (body.mode === 'saved-sheet' ? !order.savedSheet || order.ordered : !order.ordered))
        fail('PRINT_STATUS_CHANGED', 'A selected order changed. Refresh and review its current print status.', 409);
      members.push({ orderKey: id, name: order.name, ordered: body.mode === 'ordered', inHand: false, message: '' });
    }
    const stamp = now().toISOString();
    const batch = { id: body.id, label: materialBatchLabel('prints', body.label, now()), orderedDate: orderedDate(body.orderedDate, now()), createdAt: stamp, updatedAt: stamp, createdBy: actor, mode: body.mode, fingerprint, members };
    try {
      await db.batch([
        db.prepare('INSERT INTO print_material_batches (shop_id,id,data_json,created_at) VALUES (?,?,?,?)').bind(shopId, batch.id, JSON.stringify(batch), stamp),
        ...members.map(member => db.prepare('INSERT INTO print_material_members (shop_id,batch_id,order_key) VALUES (?,?,?)').bind(shopId, batch.id, member.orderKey))
      ]);
    } catch (error) {
      const retry = await row(body.id);
      if (retry && dto(retry).fingerprint === fingerprint) return dto(retry);
      fail('PRINT_ALREADY_BATCHED', 'One of these orders already belongs to an outstanding print batch. Open its saved batch.', 409);
    }
    return get(batch.id);
  }
  async function metadata(body) {
    const current = await get(body.id);
    const next = { ...current, label: materialBatchLabel('prints', body.label, new Date(current.createdAt)), orderedDate: orderedDate(body.orderedDate), updatedAt: now().toISOString() };
    const result = await db.prepare('UPDATE print_material_batches SET data_json = ?, revision = revision + 1 WHERE shop_id = ? AND id = ? AND revision = ? AND (lease_until IS NULL OR lease_until < ?)')
      .bind(JSON.stringify(next), shopId, body.id, body.expectedRevision, now().getTime()).run();
    if (!result.meta?.changes) fail('VERSION_CONFLICT', 'This batch changed or is being updated. Refresh before saving.', 409);
    return get(body.id);
  }
  async function run(body, actor) {
    if (!['mark-ordered', 'receive', 'remove'].includes(body.action)) fail('INVALID_ACTION', 'Choose a print batch action.');
    if (body.action === 'receive' && body.confirmComplete !== true) fail('RECEIPT_CONFIRMATION_REQUIRED', 'Confirm that every selected order’s complete usable set of prints is in hand.');
    const current = await get(body.id), token = crypto.randomUUID();
    const selected = body.orderKeys === undefined ? current.members.map(m => m.orderKey) : body.orderKeys;
    if (!Array.isArray(selected) || !selected.length || selected.some(id => !current.members.some(m => m.orderKey === id))) fail('INVALID_MEMBERS', 'Select members of this saved batch.');
    const acquire = await db.prepare('UPDATE print_material_batches SET lease_token = ?, lease_until = ? WHERE shop_id = ? AND id = ? AND revision = ? AND (lease_until IS NULL OR lease_until < ?)')
      .bind(token, now().getTime() + 120000, shopId, body.id, body.expectedRevision, now().getTime()).run();
    if (!acquire.meta?.changes) fail('VERSION_CONFLICT', 'This batch changed or is being updated. Refresh before receiving.', 409);
    async function persist() {
      current.updatedAt = now().toISOString();
      const stamp = now().getTime();
      const terminals = current.members.filter(member=>member.inHand || member.removedAt).map(member=>member.orderKey);
      const statements = [db.prepare('UPDATE print_material_batches SET data_json = ?, revision = revision + 1, lease_until = ? WHERE shop_id = ? AND id = ? AND lease_token = ? AND lease_until >= ?')
        .bind(JSON.stringify(current),stamp+120000,shopId,body.id,token,stamp)];
      if (terminals.length) statements.push(db.prepare('UPDATE print_material_members SET active = 0 WHERE shop_id = ? AND batch_id = ? AND order_key IN (' + terminals.map(()=>'?').join(',') + ') AND EXISTS (SELECT 1 FROM print_material_batches WHERE shop_id = ? AND id = ? AND lease_token = ? AND lease_until >= ?)')
        .bind(shopId,body.id,...terminals,shopId,body.id,token,stamp));
      const saved = await db.batch(statements);
      if (!saved[0].meta?.changes) fail('BATCH_LEASE_EXPIRED', 'The batch update was interrupted. Refresh to review saved results.', 409);
    }
    try {
      for (const member of current.members.filter(m => selected.includes(m.orderKey))) {
        if (member.removedAt || member.inHand) {
          await db.prepare('UPDATE print_material_members SET active = 0 WHERE shop_id = ? AND batch_id = ? AND order_key = ?').bind(shopId,body.id,member.orderKey).run();
          continue;
        }
        if (body.action === 'remove') {
          member.removedAt = now().toISOString(); member.message = 'Removed from this batch; print status was unchanged.';
          await persist();
          await db.prepare('UPDATE print_material_members SET active = 0 WHERE shop_id = ? AND batch_id = ? AND order_key = ?').bind(shopId,body.id,member.orderKey).run();
          continue;
        }
        if (body.action === 'mark-ordered' && member.ordered) continue;
        member.message = '';
        try {
          const order = await readOrder(member.orderKey);
          if (!order.eligible) throw new Error('This order is no longer active. Review it individually.');
          if (body.action === 'receive' && !member.ordered) throw new Error('Finish marking this batch Ordered first.');
          const already = body.action === 'receive' ? order.ready : order.ordered && !order.savedSheet;
          if (!already) {
            if (body.action === 'receive' ? !order.ordered : !order.savedSheet || order.ready) throw new Error('Print status changed. Review this order individually.');
            // The initial expected version is durable before dispatch. A retry uses the same canonical intent.
            const key = body.action === 'receive' ? 'receiveVersion' : 'orderVersion';
            if (member.retryConflict) {
              if (body.retryReviewed !== true) throw new Error('Print status needs a reviewed retry. Refresh this batch and confirm the retry.');
              delete member[key]; member.attempt = (member.attempt || 0) + 1; delete member.retryConflict;
            }
            member[key] ??= order.version;
            await persist();
            await mutateOrder(member.orderKey, member[key], body.action === 'receive' ? { prints_status: 1 } : { prints_ordered: 1, prints_on_saved_sheet: false }, `material-${body.id}-${body.action}-${member.orderKey.split('/').pop()}-${member.attempt || 0}`, actor);
          }
          const verified = await readOrder(member.orderKey);
          if (!verified.eligible || !(body.action === 'receive' ? verified.ready : verified.ordered))
            throw new Error('Print status changed after the save. Refresh and review this order.');
          member.ordered = true;
          if (body.action === 'receive') member.inHand = true;
        } catch (error) {
          if (error.code === 'VERSION_CONFLICT') member.retryConflict = true;
          member.message = ['VERSION_CONFLICT','SYNC_PENDING'].includes(error.code) ? 'Save needs review. Refresh the order before retrying.' : error.message?.startsWith('This order') || error.message?.startsWith('Print status') || error.message?.startsWith('Finish marking') ? error.message : 'Save not confirmed. Refresh and review this order before retrying.';
        }
        await persist();
        if (member.inHand) await db.prepare('UPDATE print_material_members SET active = 0 WHERE shop_id = ? AND batch_id = ? AND order_key = ?').bind(shopId, body.id, member.orderKey).run();
      }
    } finally {
      await db.prepare('UPDATE print_material_batches SET lease_token = NULL, lease_until = NULL WHERE shop_id = ? AND id = ? AND lease_token = ?').bind(shopId, body.id, token).run();
    }
    return get(body.id);
  }
  return { get, list, create, metadata, run };
}
