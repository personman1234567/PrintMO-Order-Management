// Shopify owns draft commerce; this service owns private preparation assets only.
const DRAFT_FIELDS = `id name status createdAt updatedAt invoiceSentAt email
  shippingAddress { name } billingAddress { name }
  totalPriceSet { presentmentMoney { amount currencyCode } }
  totalQuantityOfLineItems order { id name displayFinancialStatus }`;
const LINE_FIELDS = `id title variantTitle sku quantity customAttributes { key value }`;
const LIST_QUERY = `query PrintMODrafts($query: String!, $after: String) {
  draftOrders(first: 25, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
    nodes { ${DRAFT_FIELDS} } pageInfo { hasNextPage endCursor }
  }
}`;
const DETAIL_QUERY = `query PrintMODraft($id: ID!, $after: String) {
  draftOrder(id: $id) { ${DRAFT_FIELDS}
    lineItems(first: 100, after: $after) { nodes { ${LINE_FIELDS} } pageInfo { hasNextPage endCursor } }
  }
}`;
const ORDER_LINES_QUERY = `query PrintMODraftOrderLines($id: ID!, $after: String) {
  order(id: $id) { id lineItems(first: 100, after: $after) {
    nodes { ${LINE_FIELDS} } pageInfo { hasNextPage endCursor }
  } }
}`;
export const DRAFT_PLACEMENTS = ['front', 'back', 'left-chest', 'right-chest', 'left-sleeve', 'right-sleeve', 'other'];
const MAX_BYTES = 50 * 1024 * 1024;
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
export function draftGid(value) {
  return /^gid:\/\/shopify\/DraftOrder\/\d+$/.test(String(value)) ? String(value) : null;
}
// Include all attributes: two identical SKUs carrying different designs must never merge.
export function draftLineIdentity(item) {
  const attrs = (item.customAttributes || []).map(a => [String(a.key), String(a.value)]);
  attrs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([item.sku || '', item.title || '', item.variantTitle || '', attrs]);
}
export function matchDraftAssignments(saved, current, { sameKind = false } = {}) {
  const used = new Set();
  const matched = [];
  let needsReview = false;
  for (const original of saved) {
    const identity = draftLineIdentity(original);
    const candidates = current.filter(item => draftLineIdentity(item) === identity);
    const exact = sameKind && candidates.find(item => item.id === original.id);
    const target = exact || (candidates.length === 1 ? candidates[0] : null);
    if (!target || used.has(target.id)) { needsReview = true; continue; }
    used.add(target.id);
    matched.push(target);
  }
  return { matched, needsReview: needsReview || !saved.length };
}
export function draftUploadMetadata(file, role, placement) {
  if (!file || typeof file.arrayBuffer !== 'function') fail('FILE_REQUIRED', 'Choose a file to upload.');
  const types = role === 'design'
    ? { '.png': 'image/png', '.svg': 'image/svg+xml' }
    : role === 'mockup' ? { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } : {};
  const name = String(file.name || '');
  const extension = /\.[a-z0-9]+$/i.exec(name)?.[0]?.toLowerCase();
  const contentType = types[extension];
  if (!contentType || (file.type && file.type !== contentType)) fail('UNSUPPORTED_FILE', role === 'design'
    ? 'Print files must be PNG or SVG.' : 'Mockups must be PNG, JPG, or WebP.', 415);
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_BYTES) fail('INVALID_FILE_SIZE', 'Choose a file smaller than 50 MB.', 413);
  if (!DRAFT_PLACEMENTS.includes(placement)) fail('INVALID_PLACEMENT', 'Choose a print placement.');
  return { contentType, placement, role, filename: name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'artwork' };
}
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function normalizeDraft(node) {
  const total = node.totalPriceSet?.presentmentMoney;
  return { id: node.id, displayName: node.name, status: node.status,
    customerName: node.shippingAddress?.name || node.billingAddress?.name || node.email || 'Customer not specified',
    createdAt: node.createdAt, updatedAt: node.updatedAt, invoiceSentAt: node.invoiceSentAt || null,
    total: total?.amount || '0', currencyCode: total?.currencyCode || 'USD',
    quantity: node.totalQuantityOfLineItems || 0, orderId: node.order?.id || null,
    orderName: node.order?.name || null, financialStatus: node.order?.displayFinancialStatus || null };
}
export function createDraftOrderService(env, deps) {
  const db = env.ORDER_DB;
  const enabled = () => env.DRAFT_ORDERS_ENABLED === '1';
  const now = () => new Date().toISOString();
  async function shop() { return deps.shop(); }
  async function graphql(query, variables, operationName) {
    const result = await deps.graphql(env, query, variables, operationName);
    if (result?.errors?.length || !result?.data || result.ok === false) {
      if (result?.errors?.some(e => e.extensions?.code === 'ACCESS_DENIED'))
        fail('DRAFT_ACCESS_REQUIRED', 'Draft order access is not enabled in Shopify. Ask the app owner to approve draft order access, then refresh.', 403);
      fail('DRAFT_SYNC_FAILED', 'Shopify draft orders could not load. Try refreshing.', 502);
    }
    return result.data;
  }
  async function fetchDraft(id) {
    if (!draftGid(id)) fail('INVALID_DRAFT_ID', 'Draft order ID is invalid.');
    let after = null, node, items = [];
    do {
      const data = await graphql(DETAIL_QUERY, { id, after }, 'PrintMODraft');
      if (!data.draftOrder) fail('DRAFT_NOT_FOUND', 'This draft is no longer available in Shopify.', 404);
      node = data.draftOrder;
      items.push(...(node.lineItems?.nodes || []));
      after = node.lineItems?.pageInfo?.hasNextPage ? node.lineItems.pageInfo.endCursor : null;
      if (after && items.length >= 500) fail('DRAFT_TOO_LARGE', 'This draft has too many items to prepare here.', 422);
    } while (after);
    return { ...node, items };
  }
  async function orderItems(orderId) {
    let after = null, items = [];
    do {
      const data = await graphql(ORDER_LINES_QUERY, { id: orderId, after }, 'PrintMODraftOrderLines');
      if (!data.order) fail('ORDER_NOT_FOUND', 'The purchased order could not load. Try refreshing.', 404);
      items.push(...(data.order.lineItems?.nodes || []));
      after = data.order.lineItems?.pageInfo?.hasNextPage ? data.order.lineItems.pageInfo.endCursor : null;
      if (after && items.length >= 2000) fail('ORDER_TOO_LARGE', 'Order artwork needs manual review.', 422);
    } while (after);
    return items;
  }
  async function saveProjection(node) {
    const owner = await shop();
    await db.prepare(`INSERT INTO draft_order_projection (shop_id, draft_gid, status, order_gid, summary_json, shopify_updated_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(shop_id, draft_gid) DO UPDATE SET
      status = excluded.status, order_gid = excluded.order_gid, summary_json = excluded.summary_json,
      shopify_updated_at = excluded.shopify_updated_at, synced_at = excluded.synced_at, deleted_at = NULL
      WHERE excluded.shopify_updated_at >= draft_order_projection.shopify_updated_at`)
      .bind(owner.id, node.id, node.status, node.order?.id || null, JSON.stringify(normalizeDraft(node)), node.updatedAt, now()).run();
  }
  async function rows(id) {
    const owner = await shop();
    return (await db.prepare(`SELECT * FROM draft_artwork WHERE shop_id = ? AND draft_gid = ? AND state = 'active' ORDER BY created_at, id`)
      .bind(owner.id, id).all()).results || [];
  }
  function assetDto(row, items, kind) {
    const saved = parse(row.items_json, []);
    const result = matchDraftAssignments(saved, items, { sameKind: row.item_kind === kind });
    return { assetId: row.id, name: row.filename, contentType: row.content_type, byteSize: row.byte_size,
      role: row.role, placement: row.placement, revision: row.revision,
      lineItemIds: result.matched.map(item => item.id), needsReassignment: result.needsReview,
      appliesTo: saved.map(item => `${item.title}${item.variantTitle ? ` · ${item.variantTitle}` : ''}`).join(', ') };
  }
  async function promote(node, items) {
    if (!node.order?.id) return;
    const owner = await shop();
    const stamp = now();
    for (const row of await rows(node.id)) {
      const mapped = matchDraftAssignments(parse(row.items_json, []), items, { sameKind: row.item_kind === 'order' });
      // Preserve files with no guessed associations if even one selected item is ambiguous.
      const ids = mapped.needsReview ? [''] : mapped.matched.map(item => item.id);
      const side = row.placement === 'front' || row.placement === 'back' ? row.placement : '';
      const sourceKey = `draft-upload:${row.id}`;
      const guard = `EXISTS (SELECT 1 FROM draft_artwork WHERE id = ? AND revision = ? AND state = 'active')`;
      const statements = [db.prepare(`INSERT INTO asset_manifests
        (id, shop_id, order_gid, object_key, filename, content_type, byte_size, sha256, state, source_key, created_by, created_at, updated_at, role, side)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ? WHERE ${guard}
        ON CONFLICT(id) DO NOTHING`).bind(row.id, owner.id, node.order.id, row.object_key, row.filename,
          row.content_type, row.byte_size, row.sha256, sourceKey, row.created_by, row.created_at, stamp, row.role, side || null, row.id, row.revision),
        db.prepare(`DELETE FROM asset_manifest_links WHERE asset_id = ? AND source_key = ? AND ${guard}`)
          .bind(row.id, sourceKey, row.id, row.revision)];
      for (const id of ids) statements.push(db.prepare(`INSERT INTO asset_manifest_links
        (asset_id, line_item_id, design_ref, role, side, source_key, created_at, placement, assignment_status, assignment_label, origin_draft_gid)
        SELECT ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
        ON CONFLICT(asset_id, line_item_id, design_ref, role, side) DO UPDATE SET
        placement = excluded.placement, assignment_status = excluded.assignment_status,
        assignment_label = excluded.assignment_label, origin_draft_gid = excluded.origin_draft_gid`)
        .bind(row.id, id, row.role, side, sourceKey, stamp, row.placement, mapped.needsReview ? 'needs_review' : 'assigned',
          parse(row.items_json, []).map(item => `${item.title} · ${item.variantTitle || item.sku || 'Custom item'}`).join(', '), node.id, row.id, row.revision));
      statements.push(db.prepare(`UPDATE draft_artwork SET converted_order_gid = ?, converted_revision = ?, sync_error = NULL
        WHERE id = ? AND revision = ? AND state = 'active'`).bind(node.order.id, row.revision, row.id, row.revision));
      await db.batch(statements);
    }
  }
  async function detail(id) {
    const node = await fetchDraft(id);
    await saveProjection(node);
    const items = node.order?.id ? await orderItems(node.order.id) : node.items;
    await promote(node, items);
    const artwork = (await rows(id)).map(row => assetDto(row, items, node.order ? 'order' : 'draft'));
    return { ...normalizeDraft(node), items, artwork, editable: !node.order && node.status !== 'COMPLETED',
      assignmentReview: artwork.some(asset => asset.needsReassignment) };
  }
  async function list({ after = null, query = '', status = 'active' } = {}) {
    if (after && (after.length > 1024 || /[\x00-\x1f]/.test(after))) fail('INVALID_CURSOR', 'Refresh the draft list and try again.');
    const filter = { active: '-status:completed', open: 'status:open', invoice: 'status:invoice_sent', converted: 'status:completed' }[status];
    if (!filter) fail('INVALID_FILTER', 'Choose a draft order filter.');
    const search = query.trim().slice(0, 120).replace(/[\\"()]/g, ' ');
    const data = await graphql(LIST_QUERY, { query: `${filter}${search ? ` AND "${search}"` : ''}`, after }, 'PrintMODrafts');
    const connection = data.draftOrders;
    if (!connection) fail('DRAFT_SYNC_FAILED', 'Draft orders could not load. Try refreshing.', 502);
    const drafts = [];
    for (const node of connection.nodes || []) {
      await saveProjection(node);
      const files = await rows(node.id);
      const summary = normalizeDraft(node);
      drafts.push({ ...summary, artworkCount: files.length,
        mockupCount: files.filter(file => file.role === 'mockup').length,
        designCount: files.filter(file => file.role === 'design').length,
        preview: files.find(file => file.role === 'mockup') ? { assetId: files.find(file => file.role === 'mockup').id } : null,
        syncPending: files.some(file => node.order && file.converted_revision !== file.revision) });
    }
    return { drafts, nextCursor: connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null };
  }
  async function selectedItems(node, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) fail('ITEMS_REQUIRED', 'Select the garments this artwork applies to.');
    const items = node.order?.id ? await orderItems(node.order.id) : node.items;
    const unique = [...new Set(ids)];
    const selected = unique.map(id => items.find(item => item.id === id));
    if (selected.some(item => !item)) fail('DRAFT_CHANGED', 'The items changed in Shopify. Refresh this draft, then select the current garments.', 409);
    return selected;
  }
  async function event(owner, id, assetId, actor, action) {
    return db.prepare(`INSERT INTO draft_artwork_events (id, shop_id, draft_gid, asset_id, actor_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), owner.id, id, assetId, actor, action, now());
  }
  async function upload(id, form, actor) {
    const node = await fetchDraft(id);
    if (node.order || node.status === 'COMPLETED') fail('DRAFT_CONVERTED', 'This draft became an order. Open the purchased order to add files.', 409);
    const role = String(form.get('role') || ''), placement = String(form.get('placement') || '');
    const file = form.get('file');
    const metadata = draftUploadMetadata(file, role, placement);
    const selected = await selectedItems(node, parse(String(form.get('lineItemIds')), []));
    const uploadId = String(form.get('uploadId') || '');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(uploadId)) fail('UPLOAD_ID_REQUIRED', 'Refresh this draft before uploading.');
    const owner = await shop();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) fail('FILE_CHANGED', 'The file changed during upload. Select it again.');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const idDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${owner.id}:${id}:${uploadId}:${sha}`));
    const assetId = `draft_${Array.from(new Uint8Array(idDigest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
    const existing = await db.prepare('SELECT * FROM draft_artwork WHERE shop_id = ? AND id = ?').bind(owner.id, assetId).first();
    if (existing) return detail(id); // Safe retry never restores a removed/reassigned upload.
    if ((await rows(id)).length >= 100) fail('TOO_MANY_FILES', 'This draft already has 100 files. Remove unused files before uploading more.', 422);
    if (!env.R2_BUCKET) fail('R2_NOT_CONFIGURED', 'Artwork storage is unavailable. Try again later.', 503);
    const key = `drafts/${id.split('/').pop()}/${assetId}/${metadata.filename}`;
    await env.R2_BUCKET.put(key, bytes, { httpMetadata: { contentType: metadata.contentType } });
    const stored = await env.R2_BUCKET.get(key);
    const storedDigest = stored && await crypto.subtle.digest('SHA-256', await stored.arrayBuffer());
    if (!storedDigest || Array.from(new Uint8Array(storedDigest), b => b.toString(16).padStart(2, '0')).join('') !== sha)
      fail('UPLOAD_UNVERIFIED', 'The file could not be saved reliably. Try uploading it again.', 502);
    const stamp = now();
    await db.batch([db.prepare(`INSERT INTO draft_artwork
      (id, shop_id, draft_gid, object_key, filename, content_type, byte_size, sha256, role, placement, items_json, item_kind, revision, state, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, 'active', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(assetId, owner.id, id, key, metadata.filename, metadata.contentType, bytes.length, sha, role, placement, JSON.stringify(selected), actor, stamp, stamp),
      await event(owner, id, assetId, actor, 'upload')]);
    // Re-fetch covers a conversion while the private bytes were being uploaded.
    return detail(id);
  }
  async function mutate(id, assetId, body, actor, remove = false) {
    const node = await fetchDraft(id);
    const owner = await shop();
    const row = await db.prepare(`SELECT * FROM draft_artwork WHERE shop_id = ? AND draft_gid = ? AND id = ? AND state = 'active'`)
      .bind(owner.id, id, assetId).first();
    if (!row) fail('ASSET_NOT_FOUND', 'This artwork is no longer attached. Refresh the draft.', 404);
    if (!Number.isInteger(body.revision) || row.revision !== body.revision) fail('VERSION_CONFLICT', 'Artwork changed on another device. Refresh before saving.', 409);
    if (remove && (node.order || row.converted_order_gid)) fail('DRAFT_CONVERTED', 'Converted artwork is retained with the purchased order.', 409);
    if (!remove && !DRAFT_PLACEMENTS.includes(body.placement)) fail('INVALID_PLACEMENT', 'Choose a print placement.');
    const selected = remove ? [] : await selectedItems(node, body.lineItemIds);
    const updated = await db.prepare(`UPDATE draft_artwork SET items_json = ?, item_kind = ?, placement = ?, state = ?, revision = revision + 1, updated_at = ?
      WHERE shop_id = ? AND id = ? AND revision = ? AND state = 'active'${remove ? " AND converted_order_gid IS NULL AND NOT EXISTS (SELECT 1 FROM asset_manifests WHERE id = draft_artwork.id)" : ''}`)
      .bind(JSON.stringify(selected), node.order ? 'order' : 'draft', remove ? row.placement : body.placement,
        remove ? 'removed' : 'active', now(), owner.id, assetId, body.revision).run();
    if (!updated.meta?.changes && remove) fail('DRAFT_CHANGED', 'This draft or its artwork changed. Refresh before removing files.', 409);
    if (!updated.meta?.changes) fail('VERSION_CONFLICT', 'Artwork changed on another device. Refresh before saving.', 409);
    await (await event(owner, id, assetId, actor, remove ? 'remove' : 'assign')).run();
    return detail(id);
  }
  async function findAsset(assetId) {
    const owner = await shop();
    return db.prepare(`SELECT id, object_key FROM draft_artwork WHERE shop_id = ? AND id = ? AND state = 'active'`).bind(owner.id, assetId).first();
  }
  async function deleted(id) {
    if (!draftGid(id)) return;
    const owner = await shop();
    await db.prepare(`UPDATE draft_order_projection SET deleted_at = ?, synced_at = ? WHERE shop_id = ? AND draft_gid = ?`)
      .bind(now(), now(), owner.id, id).run(); // Preserve artwork; deletion is not conversion.
  }
  async function reconcile({ orderId } = {}) {
    if (!enabled()) return;
    const owner = await shop();
    if (orderId) {
      const known = (await db.prepare(`SELECT draft_gid FROM draft_order_projection WHERE shop_id = ? AND order_gid = ?`).bind(owner.id, orderId).all()).results || [];
      if (known.length) {
        for (const row of known) await detail(row.draft_gid);
      } else {
        // Shopify can deliver orders/paid before draft_orders/update. Check a bounded
        // recent conversion page; the rotating cron repairs older/missed transitions.
        const data = await graphql(LIST_QUERY, { query: 'status:completed', after: null }, 'PrintMODrafts');
        const converted = data.draftOrders?.nodes?.find(node => node.order?.id === orderId);
        if (converted && (await rows(converted.id)).length) await detail(converted.id);
      }
      return;
    }
    // Oldest-checked first rotates through prepared drafts instead of starving later rows.
    const pending = (await db.prepare(`SELECT DISTINCT p.draft_gid, p.synced_at FROM draft_order_projection p
      JOIN draft_artwork a ON a.shop_id = p.shop_id AND a.draft_gid = p.draft_gid
      WHERE p.shop_id = ? AND p.deleted_at IS NULL AND a.state = 'active'
        AND (p.order_gid IS NULL OR a.converted_revision IS NULL OR a.converted_revision <> a.revision)
      ORDER BY p.synced_at, p.draft_gid LIMIT 20`).bind(owner.id).all()).results || [];
    for (const row of pending) {
      try { await detail(row.draft_gid); }
      catch (error) {
        if (error.status === 404) await deleted(row.draft_gid);
        else {
          await db.prepare(`UPDATE draft_order_projection SET synced_at = ? WHERE shop_id = ? AND draft_gid = ?`).bind(now(), owner.id, row.draft_gid).run();
          await db.prepare(`UPDATE draft_artwork SET sync_error = ? WHERE shop_id = ? AND draft_gid = ? AND state = 'active'`)
            .bind(error.code || 'DRAFT_SYNC_FAILED', owner.id, row.draft_gid).run();
        }
      }
    }
  }
  async function handle(request, actor) {
    if (!enabled()) fail('DRAFT_ACCESS_REQUIRED', 'Draft orders are not enabled yet. The app owner needs to approve Shopify draft order access.', 503);
    const url = new URL(request.url);
    const parts = url.pathname.slice('/order-manager/v1/drafts'.length).split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length && request.method === 'GET') return list({ after: url.searchParams.get('cursor'), query: url.searchParams.get('q') || '', status: url.searchParams.get('status') || 'active' });
    const id = draftGid(parts[0]);
    if (!id) fail('INVALID_DRAFT_ID', 'Draft order ID is invalid.');
    if (parts.length === 1 && request.method === 'GET') return detail(id);
    if (parts.length === 2 && parts[1] === 'assets' && request.method === 'POST') return upload(id, await request.formData(), actor);
    if (parts.length === 3 && parts[1] === 'assets' && ['PATCH', 'DELETE'].includes(request.method))
      return mutate(id, parts[2], await request.json(), actor, request.method === 'DELETE');
    fail('METHOD_NOT_ALLOWED', 'This draft action is unavailable.', 405);
  }
  return { handle, detail, list, findAsset, deleted, reconcile, enabled };
}
