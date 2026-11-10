var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// draft-orders.mjs
var DRAFT_FIELDS = `id name status createdAt updatedAt invoiceSentAt email
  shippingAddress { name } billingAddress { name }
  totalPriceSet { presentmentMoney { amount currencyCode } }
  totalQuantityOfLineItems order { id name displayFinancialStatus }`;
var LINE_FIELDS = `id title variantTitle sku quantity customAttributes { key value }`;
var LIST_QUERY = `query PrintMODrafts($query: String!, $after: String) {
  draftOrders(first: 25, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
    nodes { ${DRAFT_FIELDS} } pageInfo { hasNextPage endCursor }
  }
}`;
var DETAIL_QUERY = `query PrintMODraft($id: ID!, $after: String) {
  draftOrder(id: $id) { ${DRAFT_FIELDS}
    lineItems(first: 100, after: $after) { nodes { ${LINE_FIELDS} } pageInfo { hasNextPage endCursor } }
  }
}`;
var ORDER_LINES_QUERY = `query PrintMODraftOrderLines($id: ID!, $after: String) {
  order(id: $id) { id lineItems(first: 100, after: $after) {
    nodes { ${LINE_FIELDS} } pageInfo { hasNextPage endCursor }
  } }
}`;
var DRAFT_PLACEMENTS = ["front", "back", "left-chest", "right-chest", "left-sleeve", "right-sleeve", "other"];
var MAX_BYTES = 50 * 1024 * 1024;
var fail = /* @__PURE__ */ __name((code, message, status = 400) => {
  throw Object.assign(new Error(message), { code, status });
}, "fail");
function draftGid(value) {
  return /^gid:\/\/shopify\/DraftOrder\/\d+$/.test(String(value)) ? String(value) : null;
}
__name(draftGid, "draftGid");
function validDraftTargetDate(value) {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = /* @__PURE__ */ new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
__name(validDraftTargetDate, "validDraftTargetDate");
function draftLineIdentity(item) {
  const attrs = (item.customAttributes || []).map((a) => [String(a.key), String(a.value)]);
  attrs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([item.sku || "", item.title || "", item.variantTitle || "", attrs]);
}
__name(draftLineIdentity, "draftLineIdentity");
function matchDraftAssignments(saved, current, { sameKind = false } = {}) {
  const used = /* @__PURE__ */ new Set();
  const matched = [];
  let needsReview = false;
  for (const original of saved) {
    const identity = draftLineIdentity(original);
    const candidates = current.filter((item) => draftLineIdentity(item) === identity);
    const exact = sameKind && candidates.find((item) => item.id === original.id);
    const target = exact || (candidates.length === 1 ? candidates[0] : null);
    if (!target || used.has(target.id)) {
      needsReview = true;
      continue;
    }
    used.add(target.id);
    matched.push(target);
  }
  return { matched, needsReview: needsReview || !saved.length };
}
__name(matchDraftAssignments, "matchDraftAssignments");
function draftUploadMetadata(file, role, placement) {
  if (!file || typeof file.arrayBuffer !== "function") fail("FILE_REQUIRED", "Choose a file to upload.");
  const types = role === "design" ? { ".png": "image/png", ".svg": "image/svg+xml" } : role === "mobile-preview" ? { ".png": "image/png", ".webp": "image/webp" } : role === "mockup" ? { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } : {};
  const name = String(file.name || "");
  const extension = /\.[a-z0-9]+$/i.exec(name)?.[0]?.toLowerCase();
  const contentType = types[extension];
  if (!contentType || file.type && file.type !== contentType) fail("UNSUPPORTED_FILE", role === "design" ? "Print files must be PNG or SVG." : "Mockups must be PNG, JPG, or WebP.", 415);
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_BYTES) fail("INVALID_FILE_SIZE", "Choose a file smaller than 50 MB.", 413);
  if (!DRAFT_PLACEMENTS.includes(placement)) fail("INVALID_PLACEMENT", "Choose a print placement.");
  if (role === "mobile-preview" && placement !== "front") fail("INVALID_PLACEMENT", "Mobile previews must show the front.");
  return {
    contentType,
    placement,
    role: role === "mobile-preview" ? "mockup" : role,
    previewKind: role === "mobile-preview" ? "mobile-front" : "",
    filename: name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "artwork"
  };
}
__name(draftUploadMetadata, "draftUploadMetadata");
function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
__name(parse, "parse");
function normalizeDraft(node) {
  const total = node.totalPriceSet?.presentmentMoney;
  return {
    id: node.id,
    displayName: node.name,
    status: node.status,
    customerName: node.shippingAddress?.name || node.billingAddress?.name || node.email || "Customer not specified",
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    invoiceSentAt: node.invoiceSentAt || null,
    total: total?.amount || "0",
    currencyCode: total?.currencyCode || "USD",
    quantity: node.totalQuantityOfLineItems || 0,
    orderId: node.order?.id || null,
    orderName: node.order?.name || null,
    financialStatus: node.order?.displayFinancialStatus || null
  };
}
__name(normalizeDraft, "normalizeDraft");
function createDraftOrderService(env, deps) {
  const db = env.ORDER_DB;
  const enabled = /* @__PURE__ */ __name(() => env.DRAFT_ORDERS_ENABLED === "1", "enabled");
  const now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
  async function shop() {
    return deps.shop();
  }
  __name(shop, "shop");
  async function graphql(query, variables, operationName) {
    const result = await deps.graphql(env, query, variables, operationName);
    if (result?.errors?.length || !result?.data || result.ok === false) {
      if (result?.errors?.some((e) => e.extensions?.code === "ACCESS_DENIED"))
        fail("DRAFT_ACCESS_REQUIRED", "Draft order access is not enabled in Shopify. Ask the app owner to approve draft order access, then refresh.", 403);
      fail("DRAFT_SYNC_FAILED", "Shopify draft orders could not load. Try refreshing.", 502);
    }
    return result.data;
  }
  __name(graphql, "graphql");
  async function fetchDraft(id2) {
    if (!draftGid(id2)) fail("INVALID_DRAFT_ID", "Draft order ID is invalid.");
    let after = null, node, items = [];
    do {
      const data2 = await graphql(DETAIL_QUERY, { id: id2, after }, "PrintMODraft");
      if (!data2.draftOrder) fail("DRAFT_NOT_FOUND", "This draft is no longer available in Shopify.", 404);
      node = data2.draftOrder;
      items.push(...node.lineItems?.nodes || []);
      after = node.lineItems?.pageInfo?.hasNextPage ? node.lineItems.pageInfo.endCursor : null;
      if (after && items.length >= 500) fail("DRAFT_TOO_LARGE", "This draft has too many items to prepare here.", 422);
    } while (after);
    return { ...node, items };
  }
  __name(fetchDraft, "fetchDraft");
  async function orderItems(orderId) {
    let after = null, items = [];
    do {
      const data2 = await graphql(ORDER_LINES_QUERY, { id: orderId, after }, "PrintMODraftOrderLines");
      if (!data2.order) fail("ORDER_NOT_FOUND", "The purchased order could not load. Try refreshing.", 404);
      items.push(...data2.order.lineItems?.nodes || []);
      after = data2.order.lineItems?.pageInfo?.hasNextPage ? data2.order.lineItems.pageInfo.endCursor : null;
      if (after && items.length >= 2e3) fail("ORDER_TOO_LARGE", "Order artwork needs manual review.", 422);
    } while (after);
    return items;
  }
  __name(orderItems, "orderItems");
  function projectionStatement(node, owner, stamp) {
    return db.prepare(`INSERT INTO draft_order_projection (shop_id, draft_gid, status, order_gid, summary_json, shopify_updated_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(shop_id, draft_gid) DO UPDATE SET
      status = excluded.status, order_gid = excluded.order_gid, summary_json = excluded.summary_json,
      shopify_updated_at = excluded.shopify_updated_at, synced_at = excluded.synced_at, deleted_at = NULL
      WHERE excluded.shopify_updated_at >= draft_order_projection.shopify_updated_at`).bind(owner.id, node.id, node.status, node.order?.id || null, JSON.stringify(normalizeDraft(node)), node.updatedAt, stamp);
  }
  __name(projectionStatement, "projectionStatement");
  async function saveProjection(node) {
    await projectionStatement(node, await shop(), now()).run();
  }
  __name(saveProjection, "saveProjection");
  async function preparation(id2) {
    const owner = await shop();
    return db.prepare("SELECT * FROM draft_preparation WHERE shop_id = ? AND draft_gid = ?").bind(owner.id, id2).first();
  }
  __name(preparation, "preparation");
  function preparationDto(row, node) {
    return {
      targetDate: row?.target_date || null,
      targetDateRevision: row?.revision || 0,
      targetDateSyncPending: Boolean(node.order && row?.target_date && row.promoted_revision !== row.revision),
      targetDatePromotion: row?.promotion_outcome || null
    };
  }
  __name(preparationDto, "preparationDto");
  async function promoteDate(node) {
    if (!node.order?.id) return;
    const row = await preparation(node.id);
    if (!row?.target_date || row.promoted_revision === row.revision) return;
    const outcome = await deps.promoteTargetDate?.(
      node.order.id,
      row.target_date,
      `draft-target:${row.shop_id}:${node.id.split("/").pop()}:${row.revision}`
    ) || "pending";
    if (outcome === "pending") return;
    const owner = await shop();
    await db.prepare(`UPDATE draft_preparation SET promoted_revision = ?, promoted_order_gid = ?, promotion_outcome = ?
      WHERE shop_id = ? AND draft_gid = ? AND revision = ?`).bind(row.revision, node.order.id, outcome, owner.id, node.id, row.revision).run();
  }
  __name(promoteDate, "promoteDate");
  async function saveTargetDate(id2, body, actor) {
    if (!validDraftTargetDate(body.targetDate) || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0)
      fail("INVALID_TARGET_DATE", "Choose a valid target date, or clear the date.");
    const node = await fetchDraft(id2);
    if (node.order || node.status === "COMPLETED") fail("DRAFT_CONVERTED", "This draft became an order. Change its target date on the purchased order.", 409);
    const owner = await shop(), stamp = now();
    await db.prepare(`INSERT INTO draft_preparation (shop_id, draft_gid, updated_by, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(shop_id, draft_gid) DO NOTHING`).bind(owner.id, id2, actor, stamp).run();
    const previous = await preparation(id2);
    if (previous.revision !== body.expectedVersion) {
      if (previous.target_date === body.targetDate) return detail(id2);
      fail("VERSION_CONFLICT", "The target date changed on another device. Refresh the draft before saving.", 409);
    }
    const mutation = crypto.randomUUID();
    const [changed] = await db.batch([
      db.prepare(`UPDATE draft_preparation SET target_date = ?, revision = revision + 1,
        last_mutation_id = ?, promoted_revision = NULL, promoted_order_gid = NULL, promotion_outcome = NULL, updated_by = ?, updated_at = ?
        WHERE shop_id = ? AND draft_gid = ? AND revision = ?`).bind(body.targetDate, mutation, actor, stamp, owner.id, id2, body.expectedVersion),
      db.prepare(`INSERT INTO draft_preparation_events (id, shop_id, draft_gid, revision, target_date, actor_id, created_at)
        SELECT ?, shop_id, draft_gid, revision, target_date, ?, ? FROM draft_preparation
        WHERE shop_id = ? AND draft_gid = ? AND last_mutation_id = ?`).bind(mutation, actor, stamp, owner.id, id2, mutation)
    ]);
    if (!changed.meta?.changes) fail("VERSION_CONFLICT", "The target date changed on another device. Refresh the draft before saving.", 409);
    return detail(id2);
  }
  __name(saveTargetDate, "saveTargetDate");
  async function rows(id2, { includeMobile = false } = {}) {
    const owner = await shop();
    return (await db.prepare(`SELECT * FROM draft_artwork WHERE shop_id = ? AND draft_gid = ? AND state = 'active'
      ${includeMobile ? "" : "AND preview_kind = ''"} ORDER BY created_at, id`).bind(owner.id, id2).all()).results || [];
  }
  __name(rows, "rows");
  function assetDto(row, items, kind) {
    const saved = parse(row.items_json, []);
    const result = matchDraftAssignments(saved, items, { sameKind: row.item_kind === kind });
    return {
      assetId: row.id,
      name: row.filename,
      contentType: row.content_type,
      byteSize: row.byte_size,
      role: row.preview_kind === "mobile-front" ? "mobile-preview" : row.role,
      placement: row.placement,
      revision: row.revision,
      lineItemIds: result.matched.map((item) => item.id),
      needsReassignment: result.needsReview,
      appliesTo: saved.map((item) => `${item.title}${item.variantTitle ? ` \xB7 ${item.variantTitle}` : ""}`).join(", ")
    };
  }
  __name(assetDto, "assetDto");
  async function promote(node, items) {
    if (!node.order?.id) return;
    const owner = await shop();
    const stamp = now();
    for (const row of await rows(node.id, { includeMobile: true })) {
      const mapped = matchDraftAssignments(parse(row.items_json, []), items, { sameKind: row.item_kind === "order" });
      const ids = mapped.needsReview ? [""] : mapped.matched.map((item) => item.id);
      const side = row.placement === "front" || row.placement === "back" ? row.placement : "";
      const sourceKey = `draft-upload:${row.id}`;
      const guard = `EXISTS (SELECT 1 FROM draft_artwork WHERE id = ? AND revision = ? AND state = 'active')`;
      const statements = [
        db.prepare(`INSERT INTO asset_manifests
        (id, shop_id, order_gid, object_key, filename, content_type, byte_size, sha256, state, source_key, created_by, created_at, updated_at, role, side, preview_kind)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
        ON CONFLICT(id) DO NOTHING`).bind(
          row.id,
          owner.id,
          node.order.id,
          row.object_key,
          row.filename,
          row.content_type,
          row.byte_size,
          row.sha256,
          sourceKey,
          row.created_by,
          row.created_at,
          stamp,
          row.role,
          side || null,
          row.preview_kind || "",
          row.id,
          row.revision
        ),
        db.prepare(`DELETE FROM asset_manifest_links WHERE asset_id = ? AND source_key = ? AND ${guard}`).bind(row.id, sourceKey, row.id, row.revision)
      ];
      for (const id2 of ids) statements.push(db.prepare(`INSERT INTO asset_manifest_links
        (asset_id, line_item_id, design_ref, role, side, source_key, created_at, placement, assignment_status, assignment_label, origin_draft_gid, preview_kind)
        SELECT ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ${row.preview_kind === "mobile-front" ? "'mobile-front'" : "''"} WHERE ${guard}
        ON CONFLICT(asset_id, line_item_id, design_ref, role, side) DO UPDATE SET
        placement = excluded.placement, assignment_status = excluded.assignment_status,
        assignment_label = excluded.assignment_label, origin_draft_gid = excluded.origin_draft_gid, preview_kind = excluded.preview_kind`).bind(
        row.id,
        id2,
        row.role,
        side,
        sourceKey,
        stamp,
        row.placement,
        mapped.needsReview ? "needs_review" : "assigned",
        parse(row.items_json, []).map((item) => `${item.title} \xB7 ${item.variantTitle || item.sku || "Custom item"}`).join(", "),
        node.id,
        row.id,
        row.revision
      ));
      statements.push(db.prepare(`UPDATE draft_artwork SET converted_order_gid = ?, converted_revision = ?, sync_error = NULL
        WHERE id = ? AND revision = ? AND state = 'active'`).bind(node.order.id, row.revision, row.id, row.revision));
      await db.batch(statements);
    }
  }
  __name(promote, "promote");
  async function detail(id2) {
    const node = await fetchDraft(id2);
    await saveProjection(node);
    const items = node.order?.id ? await orderItems(node.order.id) : node.items;
    await promote(node, items);
    try {
      await promoteDate(node);
    } catch (_) {
    }
    const files = await rows(id2, { includeMobile: true });
    const artwork = files.filter((row) => !row.preview_kind).map((row) => assetDto(row, items, node.order ? "order" : "draft"));
    const mobilePreview = files.filter((row) => row.preview_kind === "mobile-front").map((row) => assetDto(row, items, node.order ? "order" : "draft")).find((asset) => !asset.needsReassignment) || null;
    return {
      ...normalizeDraft(node),
      ...preparationDto(await preparation(id2), node),
      items,
      artwork,
      mobilePreview,
      editable: !node.order && node.status !== "COMPLETED",
      assignmentReview: artwork.some((asset) => asset.needsReassignment)
    };
  }
  __name(detail, "detail");
  async function list({ after = null, query = "", status = "active" } = {}) {
    if (after && (after.length > 1024 || /[\x00-\x1f]/.test(after))) fail("INVALID_CURSOR", "Refresh the draft list and try again.");
    const filter = { active: "-status:completed", open: "status:open", invoice: "status:invoice_sent", converted: "status:completed" }[status];
    if (!filter) fail("INVALID_FILTER", "Choose a draft order filter.");
    const search = query.trim().slice(0, 120).replace(/[\\"()]/g, " ");
    const data2 = await graphql(LIST_QUERY, { query: `${filter}${search ? ` AND "${search}"` : ""}`, after }, "PrintMODrafts");
    const connection = data2.draftOrders;
    if (!connection) fail("DRAFT_SYNC_FAILED", "Draft orders could not load. Try refreshing.", 502);
    const nodes = connection.nodes || [];
    const artwork = /* @__PURE__ */ new Map();
    const preparations = /* @__PURE__ */ new Map();
    if (nodes.length) {
      const owner = await shop(), stamp = now();
      await db.batch(nodes.map((node) => projectionStatement(node, owner, stamp)));
      const files = (await db.prepare(`SELECT draft_gid, id, role, revision, converted_revision FROM draft_artwork
        WHERE shop_id = ? AND draft_gid IN (${nodes.map(() => "?").join(",")}) AND state = 'active'
          AND preview_kind = ''
        ORDER BY draft_gid, created_at, id`).bind(owner.id, ...nodes.map((node) => node.id)).all()).results || [];
      for (const file of files) {
        if (!artwork.has(file.draft_gid)) artwork.set(file.draft_gid, []);
        artwork.get(file.draft_gid).push(file);
      }
      const prepared = (await db.prepare(`SELECT * FROM draft_preparation WHERE shop_id = ?
        AND draft_gid IN (${nodes.map(() => "?").join(",")})`).bind(owner.id, ...nodes.map((node) => node.id)).all()).results || [];
      for (const row of prepared) preparations.set(row.draft_gid, row);
    }
    const drafts = nodes.map((node) => {
      const files = artwork.get(node.id) || [];
      const summary = normalizeDraft(node);
      return {
        ...summary,
        ...preparationDto(preparations.get(node.id), node),
        artworkCount: files.length,
        mockupCount: files.filter((file) => file.role === "mockup").length,
        designCount: files.filter((file) => file.role === "design").length,
        preview: files.find((file) => file.role === "mockup") ? { assetId: files.find((file) => file.role === "mockup").id } : null,
        syncPending: files.some((file) => node.order && file.converted_revision !== file.revision)
      };
    });
    return { drafts, nextCursor: connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null };
  }
  __name(list, "list");
  async function selectedItems(node, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) fail("ITEMS_REQUIRED", "Select the garments this artwork applies to.");
    const items = node.order?.id ? await orderItems(node.order.id) : node.items;
    const unique = [...new Set(ids)];
    const selected = unique.map((id2) => items.find((item) => item.id === id2));
    if (selected.some((item) => !item)) fail("DRAFT_CHANGED", "The items changed in Shopify. Refresh this draft, then select the current garments.", 409);
    return selected;
  }
  __name(selectedItems, "selectedItems");
  async function event(owner, id2, assetId2, actor, action) {
    return db.prepare(`INSERT INTO draft_artwork_events (id, shop_id, draft_gid, asset_id, actor_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), owner.id, id2, assetId2, actor, action, now());
  }
  __name(event, "event");
  async function upload(id2, form, actor) {
    const node = await fetchDraft(id2);
    if (node.order || node.status === "COMPLETED") fail("DRAFT_CONVERTED", "This draft became an order. Open the purchased order to add files.", 409);
    const role = String(form.get("role") || ""), placement = String(form.get("placement") || "");
    const file = form.get("file");
    const metadata2 = draftUploadMetadata(file, role, placement);
    const selected = await selectedItems(node, parse(String(form.get("lineItemIds")), []));
    if (metadata2.previewKind && selected.some((item) => {
      const attributes = Object.fromEntries((item.customAttributes || []).map((value) => [value.key, value.value]));
      return (attributes.batch_role || attributes.group_role || attributes._batch_role || attributes._group_role) !== "garment";
    })) fail("INVALID_PREVIEW_ASSIGNMENT", "A mobile preview must be attached to explicit garment lines.");
    const uploadId = String(form.get("uploadId") || "");
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(uploadId)) fail("UPLOAD_ID_REQUIRED", "Refresh this draft before uploading.");
    const owner = await shop();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) fail("FILE_CHANGED", "The file changed during upload. Select it again.");
    const digest2 = await crypto.subtle.digest("SHA-256", bytes);
    const sha = Array.from(new Uint8Array(digest2), (b) => b.toString(16).padStart(2, "0")).join("");
    const idDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${owner.id}:${id2}:${uploadId}:${sha}${metadata2.previewKind ? `:${metadata2.previewKind}` : ""}`));
    const assetId2 = `draft_${Array.from(new Uint8Array(idDigest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
    const existing = await db.prepare("SELECT * FROM draft_artwork WHERE shop_id = ? AND id = ?").bind(owner.id, assetId2).first();
    if (existing) return detail(id2);
    const existingRows = await rows(id2, { includeMobile: true });
    if (metadata2.previewKind) {
      if (existingRows.filter((row) => row.preview_kind === "mobile-front").length >= 20)
        fail("TOO_MANY_PREVIEWS", "This draft already has 20 mobile previews.", 422);
    } else if (existingRows.filter((row) => !row.preview_kind).length >= 100)
      fail("TOO_MANY_FILES", "This draft already has 100 files. Remove unused files before uploading more.", 422);
    if (!env.R2_BUCKET) fail("R2_NOT_CONFIGURED", "Artwork storage is unavailable. Try again later.", 503);
    const key2 = `drafts/${id2.split("/").pop()}/${assetId2}/${metadata2.filename}`;
    await env.R2_BUCKET.put(key2, bytes, { httpMetadata: { contentType: metadata2.contentType } });
    const stored = await env.R2_BUCKET.get(key2);
    const storedDigest = stored && await crypto.subtle.digest("SHA-256", await stored.arrayBuffer());
    if (!storedDigest || Array.from(new Uint8Array(storedDigest), (b) => b.toString(16).padStart(2, "0")).join("") !== sha)
      fail("UPLOAD_UNVERIFIED", "The file could not be saved reliably. Try uploading it again.", 502);
    const stamp = now();
    await db.batch([
      db.prepare(`INSERT INTO draft_artwork
      (id, shop_id, draft_gid, object_key, filename, content_type, byte_size, sha256, role, placement, items_json, item_kind, revision, state, created_by, created_at, updated_at, preview_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, 'active', ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(assetId2, owner.id, id2, key2, metadata2.filename, metadata2.contentType, bytes.length, sha, metadata2.role, placement, JSON.stringify(selected), actor, stamp, stamp, metadata2.previewKind),
      await event(owner, id2, assetId2, actor, "upload")
    ]);
    return detail(id2);
  }
  __name(upload, "upload");
  async function mutate(id2, assetId2, body, actor, remove = false) {
    const node = await fetchDraft(id2);
    const owner = await shop();
    const row = await db.prepare(`SELECT * FROM draft_artwork WHERE shop_id = ? AND draft_gid = ? AND id = ? AND state = 'active'`).bind(owner.id, id2, assetId2).first();
    if (!row) fail("ASSET_NOT_FOUND", "This artwork is no longer attached. Refresh the draft.", 404);
    if (!Number.isInteger(body.revision) || row.revision !== body.revision) fail("VERSION_CONFLICT", "Artwork changed on another device. Refresh before saving.", 409);
    if (remove && (node.order || row.converted_order_gid)) fail("DRAFT_CONVERTED", "Converted artwork is retained with the purchased order.", 409);
    if (!remove && !DRAFT_PLACEMENTS.includes(body.placement)) fail("INVALID_PLACEMENT", "Choose a print placement.");
    if (!remove && row.preview_kind === "mobile-front" && body.placement !== "front") fail("INVALID_PLACEMENT", "Mobile previews must show the front.");
    const selected = remove ? [] : await selectedItems(node, body.lineItemIds);
    const updated = await db.prepare(`UPDATE draft_artwork SET items_json = ?, item_kind = ?, placement = ?, state = ?, revision = revision + 1, updated_at = ?
      WHERE shop_id = ? AND id = ? AND revision = ? AND state = 'active'${remove ? " AND converted_order_gid IS NULL AND NOT EXISTS (SELECT 1 FROM asset_manifests WHERE id = draft_artwork.id)" : ""}`).bind(
      JSON.stringify(selected),
      node.order ? "order" : "draft",
      remove ? row.placement : body.placement,
      remove ? "removed" : "active",
      now(),
      owner.id,
      assetId2,
      body.revision
    ).run();
    if (!updated.meta?.changes && remove) fail("DRAFT_CHANGED", "This draft or its artwork changed. Refresh before removing files.", 409);
    if (!updated.meta?.changes) fail("VERSION_CONFLICT", "Artwork changed on another device. Refresh before saving.", 409);
    await (await event(owner, id2, assetId2, actor, remove ? "remove" : "assign")).run();
    return detail(id2);
  }
  __name(mutate, "mutate");
  async function findAsset(assetId2) {
    const owner = await shop();
    return db.prepare(`SELECT id, object_key FROM draft_artwork WHERE shop_id = ? AND id = ? AND state = 'active'`).bind(owner.id, assetId2).first();
  }
  __name(findAsset, "findAsset");
  async function deleted(id2) {
    if (!draftGid(id2)) return;
    const owner = await shop();
    await db.prepare(`UPDATE draft_order_projection SET deleted_at = ?, synced_at = ? WHERE shop_id = ? AND draft_gid = ?`).bind(now(), now(), owner.id, id2).run();
  }
  __name(deleted, "deleted");
  async function reconcile({ orderId } = {}) {
    if (!enabled()) return;
    const owner = await shop();
    if (orderId) {
      const known = (await db.prepare(`SELECT draft_gid FROM draft_order_projection WHERE shop_id = ? AND order_gid = ?`).bind(owner.id, orderId).all()).results || [];
      if (known.length) {
        for (const row of known) await detail(row.draft_gid);
      } else {
        const data2 = await graphql(LIST_QUERY, { query: "status:completed", after: null }, "PrintMODrafts");
        const converted = data2.draftOrders?.nodes?.find((node) => node.order?.id === orderId);
        if (converted && ((await rows(converted.id)).length || (await preparation(converted.id))?.target_date)) await detail(converted.id);
      }
      return;
    }
    const pending = (await db.prepare(`SELECT DISTINCT p.draft_gid, p.synced_at FROM draft_order_projection p
      LEFT JOIN draft_artwork a ON a.shop_id = p.shop_id AND a.draft_gid = p.draft_gid AND a.state = 'active'
      LEFT JOIN draft_preparation d ON d.shop_id = p.shop_id AND d.draft_gid = p.draft_gid
      WHERE p.shop_id = ? AND p.deleted_at IS NULL AND (
        (a.id IS NOT NULL AND (p.order_gid IS NULL OR a.converted_revision IS NULL OR a.converted_revision <> a.revision))
        OR (d.target_date IS NOT NULL AND (d.promoted_revision IS NULL OR d.promoted_revision <> d.revision)))
      ORDER BY p.synced_at, p.draft_gid LIMIT 20`).bind(owner.id).all()).results || [];
    for (const row of pending) {
      try {
        await detail(row.draft_gid);
      } catch (error) {
        if (error.status === 404) await deleted(row.draft_gid);
        else {
          await db.prepare(`UPDATE draft_order_projection SET synced_at = ? WHERE shop_id = ? AND draft_gid = ?`).bind(now(), owner.id, row.draft_gid).run();
          await db.prepare(`UPDATE draft_artwork SET sync_error = ? WHERE shop_id = ? AND draft_gid = ? AND state = 'active'`).bind(error.code || "DRAFT_SYNC_FAILED", owner.id, row.draft_gid).run();
        }
      }
    }
  }
  __name(reconcile, "reconcile");
  async function handle(request, actor) {
    if (!enabled()) fail("DRAFT_ACCESS_REQUIRED", "Draft orders are not enabled yet. The app owner needs to approve Shopify draft order access.", 503);
    const url = new URL(request.url);
    const parts = url.pathname.slice("/order-manager/v1/drafts".length).split("/").filter(Boolean).map(decodeURIComponent);
    if (!parts.length && request.method === "GET") return list({ after: url.searchParams.get("cursor"), query: url.searchParams.get("q") || "", status: url.searchParams.get("status") || "active" });
    const id2 = draftGid(parts[0]);
    if (!id2) fail("INVALID_DRAFT_ID", "Draft order ID is invalid.");
    if (parts.length === 1 && request.method === "GET") return detail(id2);
    if (parts.length === 2 && parts[1] === "target-date" && request.method === "PATCH") return saveTargetDate(id2, await request.json(), actor);
    if (parts.length === 2 && parts[1] === "assets" && request.method === "POST") return upload(id2, await request.formData(), actor);
    if (parts.length === 3 && parts[1] === "assets" && ["PATCH", "DELETE"].includes(request.method))
      return mutate(id2, parts[2], await request.json(), actor, request.method === "DELETE");
    fail("METHOD_NOT_ALLOWED", "This draft action is unavailable.", 405);
  }
  __name(handle, "handle");
  return { handle, detail, list, findAsset, deleted, reconcile, enabled };
}
__name(createDraftOrderService, "createDraftOrderService");

// supplier-submission.mjs
var isSupplierService = /* @__PURE__ */ __name((item) => [item?.sku, item?.supplierSku].some((value) => String(value || "").trim() === "PM-ART-BG-REMOVE"), "isSupplierService");
function consolidateSupplierEvidence({ requestedLines = [], lineSources = [], acceptedLines = [], rejectedLines = [], outcome, operation = "order_placement", summaryConfirmed = false, preflightFailed = false, invalidLineEvidence = false }) {
  const issues = rejectedLines.filter((line) => !line.sku).map((line) => ({ code: line.code || null, reason: line.reason }));
  const requested = new Map(requestedLines.map((line) => [line.sku, Number(line.qty)]));
  const unmatchedAcceptedLines = acceptedLines.filter((line) => !requested.has(line.sku));
  if (unmatchedAcceptedLines.length) issues.push({
    code: "SUPPLIER_IDENTIFIER_UNMATCHED",
    reason: "S&S returned item identifiers that do not match the submitted SKUs. The returned order reference is preserved; item attribution needs review."
  });
  if (invalidLineEvidence) issues.push({ code: "SUPPLIER_LINE_DETAIL_INCOMPLETE", reason: "Some supplier line quantities were not returned in a usable form." });
  const lineResults = requestedLines.map((line) => {
    const accepted = acceptedLines.find((value) => value.sku === line.sku);
    const errors = rejectedLines.filter((value) => value.sku === line.sku);
    const rawQty = accepted && accepted.acceptedQty !== null && accepted.acceptedQty !== void 0 && accepted.acceptedQty !== "" ? Number(accepted.acceptedQty) : null;
    const validQty = accepted && Number.isSafeInteger(rawQty) && rawQty >= 0 && rawQty <= line.qty;
    if (accepted && !validQty) issues.push({
      code: "SUPPLIER_QUANTITY_MISMATCH",
      sku: line.sku,
      reason: "The returned quantity differs from the requested item quantity. Check this line against the S&S order."
    });
    const reportedAcceptedQty = validQty && !summaryConfirmed ? rawQty : null;
    const explicitNotAccepted = !preflightFailed && !accepted && errors.length > 0;
    const unconfirmedQty = preflightFailed ? 0 : reportedAcceptedQty !== null ? Math.max(0, line.qty - reportedAcceptedQty) : explicitNotAccepted ? 0 : summaryConfirmed && validQty ? null : line.qty;
    const notAcceptedQty = explicitNotAccepted ? line.qty : null;
    const fullyCovered = !preflightFailed && ["confirmed", "partial"].includes(outcome) && validQty && rawQty >= line.qty && !errors.length;
    return {
      sku: line.sku,
      requestedQty: line.qty,
      reportedAcceptedQty,
      unconfirmedQty,
      notAcceptedQty,
      itemNames: [...new Set(lineSources.filter((source) => source.sku === line.sku).map((source) => [source.title, source.variantTitle].filter(Boolean).join(" - ")))],
      orderNames: [...new Set(lineSources.filter((source) => source.sku === line.sku).map((source) => source.orderName))],
      evidence: summaryConfirmed && validQty ? "summary_confirmed" : reportedAcceptedQty !== null ? "supplier_reported" : "unconfirmed",
      status: preflightFailed ? "not_sent" : fullyCovered ? "accepted" : explicitNotAccepted ? "not_accepted" : reportedAcceptedQty > 0 ? "partial" : "unconfirmed",
      fullyCovered,
      issues: errors.map((error) => ({ code: error.code || null, reason: error.reason }))
    };
  });
  const hasReported = lineResults.some((line) => line.reportedAcceptedQty !== null);
  const quantitative = !summaryConfirmed && !preflightFailed;
  const detailOutcome = invalidLineEvidence || unmatchedAcceptedLines.length || issues.some((issue) => issue.code === "SUPPLIER_QUANTITY_MISMATCH") || summaryConfirmed ? "unresolved" : lineResults.every((line) => line.fullyCovered || line.notAcceptedQty !== null) ? "complete" : "partial";
  return {
    outcome,
    placementOutcome: outcome,
    detailOutcome,
    operation,
    operationEvidence: "request",
    acceptanceEvidence: summaryConfirmed ? "summary_confirmed" : hasReported ? "supplier_reported" : "unconfirmed",
    lineResults,
    unmatchedAcceptedLines,
    issues,
    totals: {
      requestedUnits: requestedLines.reduce((sum, line) => sum + line.qty, 0),
      reportedAcceptedUnits: quantitative ? lineResults.reduce((sum, line) => sum + (line.reportedAcceptedQty || 0), 0) : null,
      unconfirmedUnits: quantitative ? lineResults.reduce((sum, line) => sum + (line.unconfirmedQty || 0), 0) : null,
      notAcceptedUnits: quantitative ? lineResults.reduce((sum, line) => sum + (line.notAcceptedQty || 0), 0) : null
    }
  };
}
__name(consolidateSupplierEvidence, "consolidateSupplierEvidence");
var retryRisk = `b.id <> ? AND b.shop_id = ?
  AND COALESCE(json_extract(b.request_json, '$.provider'), 'shopify') = ?
  AND (b.state = 'submitting' OR (b.state IN ('unknown','failed')
    AND COALESCE(json_extract(b.response_json, '$.preflightFailed'), 0) <> 1 AND (
    (b.state = 'unknown' AND COALESCE(json_array_length(json_extract(b.response_json, '$.supplierOrderNumbers')), 0) = 0
      AND COALESCE(json_extract(b.response_json, '$.supplierOrderNumber'), '') = '')
    OR json_extract(b.response_json, '$.postResultUncertain') = 1
    OR CAST(json_extract(b.response_json, '$.httpStatus') AS INTEGER) IN (408,425,429)
    OR CAST(json_extract(b.response_json, '$.httpStatus') AS INTEGER) >= 500)
    AND NOT EXISTS (SELECT 1 FROM supplier_attempts resolution
      WHERE resolution.batch_id = b.id AND resolution.attempt_type = 'owner_retry_resolution'
        AND resolution.outcome = 'owner_authorized_retry'
        AND json_extract(resolution.response_json, '$.originalLineHash') = b.line_hash
        AND json_extract(resolution.response_json, '$.originalUpdatedAt') = b.updated_at
        AND json_extract(resolution.response_json, '$.originalResponseJson') = b.response_json)))
  AND EXISTS (SELECT 1 FROM json_each(b.request_json, '$.lineSources') old_line, json_each(?) current_line
    WHERE json_extract(old_line.value, '$.orderId') = json_extract(current_line.value, '$.orderId')
      AND json_extract(old_line.value, '$.sku') = json_extract(current_line.value, '$.sku'))
  AND NOT COALESCE((b.state = 'failed' AND COALESCE(json_extract(b.response_json, '$.failureKind'), '') = 'rate_limited'
    AND json_extract(b.response_json, '$.orderSubmissionAttempted') = 1
    AND json_extract(b.response_json, '$.upstreamHttpStatus') = 503
    AND json_extract(b.response_json, '$.supplierErrorCode') = '503'
    AND json_extract(b.response_json, '$.retryAt') IS NOT NULL
    AND json_extract(b.response_json, '$.retryAt') <= ?), 0)`;
async function claimSupplierAttempt(db, { shopId, provider, lineSources, batchId, now }) {
  const parameters = [batchId, shopId, provider, JSON.stringify(lineSources), now];
  const claimed = await db.prepare(`UPDATE batches SET state = 'submitting', updated_at = ?
    WHERE id = ? AND shop_id = ? AND state = 'prepared'
      AND NOT EXISTS (SELECT 1 FROM batches b WHERE ${retryRisk})`).bind(now, batchId, shopId, ...parameters).run();
  if (claimed.meta?.changes === 1) return;
  const previous = await db.prepare(`SELECT b.id, b.state, b.created_at, b.response_json FROM batches b WHERE ${retryRisk}
    ORDER BY b.created_at DESC LIMIT 1`).bind(...parameters).first();
  if (previous) {
    await db.prepare(`DELETE FROM batch_orders WHERE batch_id = ? AND EXISTS (
      SELECT 1 FROM batches WHERE id = ? AND shop_id = ? AND state = 'prepared')`).bind(batchId, batchId, shopId).run();
    let saved = {};
    try {
      saved = JSON.parse(previous.response_json || "{}");
    } catch {
    }
    const rateLimited = saved.failureKind === "rate_limited" && saved.retryAt;
    const summary = rateLimited ? `S&S asked you to wait before trying again. This selection was not sent. Retry after ${saved.retryAt}.` : previous.state === "submitting" ? "An earlier request for these garments is still running. No new S&S request was sent." : "An earlier request has no confirmed S&S order result. This selection was not sent.";
    const orderIds = [...new Set(lineSources.map((line) => line.orderId))];
    throw Object.assign(new Error(summary), {
      code: "BATCH_REVIEW_REQUIRED",
      status: 409,
      batchId,
      body: { report: {
        batchId,
        blockedBatchId: batchId,
        outcome: "unknown",
        operation: "order_placement",
        submissionAction: "blocked",
        supplierRequestSent: false,
        actionMessage: summary,
        failureKind: rateLimited ? "rate_limited" : null,
        retryAt: rateLimited ? saved.retryAt : null,
        orderCount: orderIds.length,
        totals: { requestedUnits: lineSources.reduce((sum, line) => sum + line.qty, 0) },
        orderResults: orderIds.map((orderId) => ({ orderId })),
        lineResults: [],
        previousResults: [{
          ...saved,
          batchId: previous.id,
          attemptStartedAt: saved.attemptStartedAt || previous.created_at,
          submissionAction: "saved",
          supplierRequestSent: false
        }]
      } }
    });
  }
  throw Object.assign(new Error("This attempt is already running. Review its saved result."), {
    code: "BATCH_RECONCILIATION_REQUIRED",
    status: 409,
    batchId,
    body: { report: {
      batchId,
      submissionAction: "blocked",
      supplierRequestSent: false,
      actionMessage: "This attempt is already running. No new S&S request was sent by this action."
    } }
  });
}
__name(claimSupplierAttempt, "claimSupplierAttempt");

// garment-costs.mjs
var COST_TTL_MS = 3e5;
var catalogCache = /* @__PURE__ */ new Map();
var pendingCatalog = /* @__PURE__ */ new Map();
function moneyToMinor(amount) {
  const match = /^(\d+)(?:\.(\d{1,2})0*)?$/.exec(String(amount ?? ""));
  if (!match) return null;
  const result = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}
__name(moneyToMinor, "moneyToMinor");
function estimateGarments(order, costs, isPrint, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const totals = { garmentMinor: 0, shelfMinor: 0, supplierMinor: 0 };
  const lines = [];
  for (const item of order.items || []) {
    if (isPrint(item) || isSupplierService(item)) continue;
    const quantity = Number(item.currentQuantity ?? item.quantity ?? item.qty ?? 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;
    const sku = String(order.provider === "etsy" ? item.supplierSku || "" : item.sku || "").trim();
    const shelfQuantity = Math.min(quantity, Math.max(0, Number(item.shelfQuantity) || 0));
    const lookupKey = order.provider === "etsy" ? `sku:${sku}` : `variant:${item.variantId || ""}`;
    const cost = costs.get(lookupKey);
    let exclusionReason = !sku ? "Manual item" : cost?.reason || null;
    const unitCostMinor = moneyToMinor(cost?.amount);
    if (!exclusionReason && cost?.currencyCode !== "USD") exclusionReason = cost?.currencyCode ? "Different currency" : "Missing cost";
    if (!exclusionReason && unitCostMinor === null) exclusionReason = "Missing cost";
    if (!exclusionReason && cost?.sku && cost.sku !== sku) exclusionReason = "Catalog SKU changed";
    if (!exclusionReason && !Number.isSafeInteger(unitCostMinor * quantity)) exclusionReason = "Cost unavailable";
    const known = !exclusionReason;
    const line = {
      lineId: item.id,
      title: item.title || "Garment",
      variantTitle: item.variantTitle || "",
      sku,
      quantity,
      shelfQuantity,
      supplierQuantity: quantity - shelfQuantity,
      unitCostMinor: known ? unitCostMinor : null,
      garmentMinor: known ? unitCostMinor * quantity : null,
      shelfMinor: known ? unitCostMinor * shelfQuantity : null,
      supplierMinor: known ? unitCostMinor * (quantity - shelfQuantity) : null,
      exclusionReason
    };
    if (known) for (const key2 of Object.keys(totals)) totals[key2] += line[key2];
    lines.push(line);
  }
  const exclusions = lines.filter((line) => line.exclusionReason);
  return {
    version: 1,
    source: "shopify-catalog",
    orderId: order.id,
    orderName: order.name,
    currencyCode: "USD",
    lookupAt: now,
    status: exclusions.length ? "incomplete" : "complete",
    ...totals,
    lines,
    exclusions
  };
}
__name(estimateGarments, "estimateGarments");
function unavailableEstimate(id2, name = "") {
  return {
    version: 1,
    source: "shopify-catalog",
    orderId: id2,
    orderName: name,
    currencyCode: "USD",
    lookupAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "unavailable",
    garmentMinor: null,
    shelfMinor: null,
    supplierMinor: null,
    lines: [],
    exclusions: []
  };
}
__name(unavailableEstimate, "unavailableEstimate");
function createGarmentCostService({ readOrder, graphql, isPrint, shopKey }) {
  let active = 0;
  const waiting = [];
  async function limited(task) {
    if (active >= 4) await new Promise((resolve2) => waiting.push(resolve2));
    else active++;
    try {
      return await task();
    } finally {
      if (waiting.length) waiting.shift()();
      else active--;
    }
  }
  __name(limited, "limited");
  async function resolve(key2) {
    const cacheKey = `${shopKey}|${key2}`;
    const cached = catalogCache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) return cached.cost;
    if (pendingCatalog.has(cacheKey)) return pendingCatalog.get(cacheKey);
    const promise = (async () => {
      let result;
      if (key2.startsWith("variant:")) {
        const id2 = key2.slice(8);
        if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id2)) return { reason: "Catalog variant unavailable" };
        const query = `query PrintMOGarmentVariantCost($id: ID!) {
                    productVariant(id: $id) { id sku inventoryItem { unitCost { amount currencyCode } } }
                }`;
        const response = await limited(() => graphql(query, { id: id2 }, "PrintMOGarmentVariantCost"));
        if (response.errors?.length) throw new Error("Catalog cost unavailable");
        const variant = response.data?.productVariant;
        result = variant ? { ...variant.inventoryItem?.unitCost, sku: variant.sku } : { reason: "Catalog variant unavailable" };
      } else {
        const sku = key2.slice(4);
        const query = `query PrintMOGarmentSkuCost($query: String!) {
                    productVariants(first: 20, query: $query) {
                        nodes { id sku inventoryItem { unitCost { amount currencyCode } } }
                        pageInfo { hasNextPage }
                    }
                }`;
        const response = await limited(() => graphql(query, { query: `sku:${JSON.stringify(sku)}` }, "PrintMOGarmentSkuCost"));
        if (response.errors?.length) throw new Error("Catalog cost unavailable");
        const connection = response.data?.productVariants;
        const matches = (connection?.nodes || []).filter((variant) => variant.sku === sku);
        result = connection?.pageInfo?.hasNextPage || matches.length > 1 ? { reason: "Ambiguous catalog SKU" } : matches.length === 1 ? { ...matches[0].inventoryItem?.unitCost, sku } : { reason: "No catalog match" };
      }
      if (catalogCache.size > 2e3) catalogCache.clear();
      catalogCache.set(cacheKey, { cost: result, expiresAt: Date.now() + COST_TTL_MS });
      return result;
    })();
    pendingCatalog.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      pendingCatalog.delete(cacheKey);
    }
  }
  __name(resolve, "resolve");
  async function bounded(promise, deadline) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Cost lookup timed out")), Math.max(1, deadline - Date.now()));
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  __name(bounded, "bounded");
  async function estimate(id2, deadline) {
    try {
      const order = await bounded(limited(() => readOrder(id2)), deadline);
      const costs = /* @__PURE__ */ new Map();
      if (order.provider !== "etsy") for (const item of order.items || []) {
        if (!isPrint(item) && !isSupplierService(item) && Object.hasOwn(item, "catalogCost"))
          costs.set(`variant:${item.variantId || ""}`, item.catalogCost);
      }
      const keys = [...new Set((order.items || []).filter((item) => !isPrint(item) && !isSupplierService(item) && Number(item.currentQuantity ?? item.quantity ?? item.qty ?? 0) > 0).map((item) => {
        const sku = String(order.provider === "etsy" ? item.supplierSku || "" : item.sku || "").trim();
        return !sku ? null : order.provider === "etsy" ? `sku:${sku}` : `variant:${item.variantId || ""}`;
      }).filter((key2) => key2 && !costs.has(key2)))];
      let lookupFailed = false;
      for (let start = 0; start < keys.length; start += 4) {
        await Promise.all(keys.slice(start, start + 4).map(async (key2) => {
          try {
            costs.set(key2, await bounded(resolve(key2), deadline));
          } catch (_) {
            lookupFailed = true;
            costs.set(key2, { reason: "Cost unavailable" });
          }
        }));
      }
      const result = estimateGarments(order, costs, isPrint);
      if (lookupFailed) result.lookupFailed = true;
      if (lookupFailed && result.lines.every((line) => line.unitCostMinor === null)) {
        result.status = "unavailable";
        result.garmentMinor = result.shelfMinor = result.supplierMinor = null;
      }
      return result;
    } catch (_) {
      return unavailableEstimate(id2);
    }
  }
  __name(estimate, "estimate");
  async function estimates(ids) {
    const unique = [...new Set(ids)];
    const results = new Array(unique.length);
    let next = 0;
    const deadline = Date.now() + 2e4;
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
      while (next < unique.length) {
        const index2 = next++;
        const id2 = unique[index2];
        results[index2] = Date.now() >= deadline ? unavailableEstimate(id2) : await estimate(id2, deadline);
      }
    }));
    return results;
  }
  __name(estimates, "estimates");
  return { estimates };
}
__name(createGarmentCostService, "createGarmentCostService");

// production-run.mjs
var fail2 = /* @__PURE__ */ __name((code, message, status = 400, current) => {
  throw Object.assign(new Error(message), { code, status, ...current ? { details: { current } } : {} });
}, "fail");
function normalizeRunOrders(orders) {
  if (!Array.isArray(orders) || orders.length > 1e3) fail2("INVALID_RUN", "Select up to 500 orders.");
  const unique = /* @__PURE__ */ new Map();
  for (const order of orders) {
    if (!order || !["shopify", "etsy"].includes(order.provider) || typeof order.id !== "string" || (order.provider === "shopify" ? !/^gid:\/\/shopify\/Order\/\d+$/.test(order.id) : !/^etsy:[A-Za-z0-9:_-]{1,180}$/.test(order.id))) fail2("INVALID_RUN_ORDER", "An order identity is invalid. Refresh orders.");
    const item = { provider: order.provider, id: order.id };
    unique.set(JSON.stringify(item), item);
  }
  if (unique.size > 500) fail2("INVALID_RUN", "Select up to 500 orders.");
  return [...unique.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}
__name(normalizeRunOrders, "normalizeRunOrders");
function createProductionRunService(db, shopId) {
  const dto = /* @__PURE__ */ __name((row) => row ? { revision: row.revision, orders: JSON.parse(row.orders_json), updatedAt: row.updated_at } : { revision: 0, orders: [], updatedAt: null }, "dto");
  const get = /* @__PURE__ */ __name(async () => dto(await db.prepare("SELECT * FROM production_runs WHERE shop_id = ?").bind(shopId).first()), "get");
  async function patch(body, actor) {
    if (!body || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0 || !["add", "remove", "clear"].includes(body.operation) || !/^[A-Za-z0-9._:-]{8,200}$/.test(body.idempotencyKey || "")) fail2("INVALID_RUN", "Refresh the run before saving.");
    if (body.orders?.length > 500) fail2("INVALID_RUN", "Select up to 500 orders.");
    const orders = normalizeRunOrders(body.orders || []);
    const request = JSON.stringify({ expectedVersion: body.expectedVersion, operation: body.operation, orders });
    const lookup = /* @__PURE__ */ __name(() => db.prepare(`SELECT request_json, result_json FROM production_run_mutations
      WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?`).bind(shopId, actor, body.idempotencyKey).first(), "lookup");
    const replay = /* @__PURE__ */ __name((row) => {
      if (row.request_json !== request) fail2("IDEMPOTENCY_KEY_REUSE", "This save was already used for a different selection.", 409);
      return JSON.parse(row.result_json);
    }, "replay");
    const previous = await lookup();
    if (previous) return replay(previous);
    const current = await get();
    if (current.revision !== body.expectedVersion) fail2("VERSION_CONFLICT", "The shared run changed on another device.", 409, current);
    if (body.operation === "add") for (const order of orders) {
      const row = order.provider === "shopify" ? await db.prepare("SELECT order_gid FROM order_projection WHERE shop_id = ? AND order_gid = ? AND active = 1 AND stage = 'print'").bind(shopId, order.id).first() : await db.prepare(`SELECT p.order_key FROM provider_order_projection p JOIN provider_production_state s
          ON s.shop_id = p.shop_id AND s.order_key = p.order_key
          WHERE p.shop_id = ? AND p.order_key = ? AND p.board_enrolled = 1
          AND json_extract(s.state_json, '$.stage') = 'print'
          AND json_extract(s.state_json, '$.archivedAt') IS NULL`).bind(shopId, order.id).first();
      if (!row) fail2("RUN_ORDER_UNAVAILABLE", "A selected order is no longer in To Print. Refresh the planner.", 409);
    }
    const keys = new Set(orders.map((order) => JSON.stringify(order)));
    const next = body.operation === "clear" ? [] : body.operation === "remove" ? current.orders.filter((order) => !keys.has(JSON.stringify(order))) : normalizeRunOrders([...current.orders, ...orders]);
    const stamp = (/* @__PURE__ */ new Date()).toISOString(), mutation = crypto.randomUUID();
    const result = { revision: current.revision + 1, orders: next, updatedAt: stamp };
    await db.batch([
      db.prepare("INSERT INTO production_runs (shop_id) VALUES (?) ON CONFLICT(shop_id) DO NOTHING").bind(shopId),
      db.prepare(`UPDATE production_runs SET orders_json = ?, revision = revision + 1,
        last_mutation_id = ?, updated_by = ?, updated_at = ? WHERE shop_id = ? AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM production_run_mutations WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?)`).bind(JSON.stringify(next), mutation, actor, stamp, shopId, current.revision, shopId, actor, body.idempotencyKey),
      db.prepare(`INSERT INTO production_run_mutations
        (shop_id, actor_id, idempotency_key, request_json, result_json, created_at)
        SELECT ?, ?, ?, ?, ?, ? FROM production_runs WHERE shop_id = ? AND last_mutation_id = ?
        ON CONFLICT(shop_id, actor_id, idempotency_key) DO NOTHING`).bind(shopId, actor, body.idempotencyKey, request, JSON.stringify(result), stamp, shopId, mutation)
    ]);
    const saved = await lookup();
    if (!saved) fail2("VERSION_CONFLICT", "The shared run changed on another device.", 409, await get());
    return replay(saved);
  }
  __name(patch, "patch");
  return { get, patch };
}
__name(createProductionRunService, "createProductionRunService");

// prepared-publish-progress.mjs
async function mapConcurrent(values, limit, task) {
  const results = new Array(values.length);
  let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (!failure && next < values.length) {
      const index2 = next++;
      try {
        results[index2] = await task(values[index2], index2);
      } catch (error) {
        failure ||= error;
      }
    }
  }));
  if (failure) throw failure;
  return results;
}
__name(mapConcurrent, "mapConcurrent");
function preparedPublishStream(operation, headers, context) {
  let connected = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = /* @__PURE__ */ __name((value) => {
        if (!connected) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
        } catch {
          connected = false;
        }
      }, "send");
      const work = Promise.resolve().then(() => operation((progress) => send({ type: "progress", ...progress }))).then((result) => send({ type: "result", ...result })).catch((error) => send({ type: "error", error: {
        code: error.code && error.status ? error.code : "PUBLISH_UNAVAILABLE",
        message: error.code && error.status ? error.message : "The customer link could not be published. Your changes are saved; retry.",
        status: error.status || 503
      } })).finally(() => {
        if (connected) {
          connected = false;
          controller.close();
        }
      });
      context?.waitUntil(work);
    },
    cancel() {
      connected = false;
    }
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
__name(preparedPublishStream, "preparedPublishStream");

// prepared-order-browse.mjs
var prefix = /* @__PURE__ */ __name((env) => `admin-prepared-orders/v1/${encodeURIComponent(env.SHOPIFY_SHOP_DOMAIN.toLowerCase())}/`, "prefix");
function preparedDraftSummary(record) {
  const first = record.items[0];
  const mockup = record.mockups.find((image) => image.itemIds?.includes(first?.id)) || record.mockups[0];
  const thumbnail = first?.proofAssetId ? { assetId: first.proofAssetId, mime: "image/png" } : mockup && /^image\/(png|jpeg|webp)$/.test(mockup.mime) ? { assetId: mockup.assetId, mime: mockup.mime } : { image: first?.image || "" };
  return {
    listVersion: 2,
    id: record.id,
    title: record.title,
    preparedFor: record.preparedFor,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt || null,
    itemCount: record.items.length,
    mockupCount: record.mockups.length,
    thumbnail
  };
}
__name(preparedDraftSummary, "preparedDraftSummary");
function preparedListLinkState(mapping, revision, now = Date.now()) {
  if (mapping?.publishingAt && now - Date.parse(mapping.publishingAt) < 12e4) return "publishing";
  const link = mapping?.link;
  if (!link) return "none";
  if (["revoked", "purged"].includes(link.status)) return "disabled";
  if (Date.parse(link.expiresAt) <= now || link.status === "expired") return "expired";
  if (link.status !== "active") return "disabled";
  return (mapping.sourceRevision || link.sourceRevision) === revision ? "ready" : "changes";
}
__name(preparedListLinkState, "preparedListLinkState");
async function metadata(bucket, keyPrefix) {
  const entries = [];
  let cursor;
  do {
    const result = await bucket.list({ prefix: keyPrefix, limit: 1e3, cursor, include: ["customMetadata"] });
    entries.push(...result.objects);
    cursor = result.truncated ? result.cursor : null;
  } while (cursor);
  return entries;
}
__name(metadata, "metadata");
function parsed(entry, field) {
  try {
    return JSON.parse(entry.customMetadata?.[field] || "null");
  } catch {
    return null;
  }
}
__name(parsed, "parsed");
async function browsePreparedOrders(env, options, read) {
  const bucket = env.R2_BUCKET, root = prefix(env);
  const q = String(options.q || "").trim().slice(0, 120).toLocaleLowerCase();
  const view = ["current", "archived", "all"].includes(options.view) ? options.view : "current";
  const sort = options.sort === "name" ? "name" : "recent";
  const [entries, management] = await Promise.all([metadata(bucket, root + "drafts/"), metadata(bucket, root + "management/")]);
  const flags = new Map(management.map((entry) => {
    const value = parsed(entry, "management");
    return [value?.id, value];
  }));
  let rows = entries.map((entry) => {
    const summary = parsed(entry, "summary");
    return summary && !summary.deletedAt ? { ...summary, revision: entry.etag, archivedAt: flags.get(summary.id)?.archivedAt || null } : null;
  }).filter(Boolean);
  if (q) {
    const matching = /* @__PURE__ */ new Set();
    await mapConcurrent(rows, 4, async (row) => {
      if (`${row.title} ${row.preparedFor}`.toLocaleLowerCase().includes(q)) {
        matching.add(row.id);
        return;
      }
      const record = await read(row.id);
      if (record.items.some((item) => `${item.title} ${item.color} ${item.variantTitle}`.toLocaleLowerCase().includes(q))) matching.add(row.id);
    });
    rows = rows.filter((row) => matching.has(row.id));
  }
  const counts = { current: rows.filter((row) => !row.archivedAt).length, archived: rows.filter((row) => row.archivedAt).length, all: rows.length };
  rows = rows.filter((row) => view === "all" || (view === "archived" ? row.archivedAt : !row.archivedAt));
  rows.sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
  const offset = /^\d{1,8}$/.test(options.cursor || "") ? Number(options.cursor) : 0;
  const page = rows.slice(offset, offset + 25);
  await mapConcurrent(page, 4, async (row) => {
    if (row.listVersion !== 2) Object.assign(row, preparedDraftSummary(await read(row.id)));
    try {
      const stored = await bucket.get(root + "links/" + row.id + ".json");
      const mapping = stored ? await stored.json() : null;
      row.linkState = preparedListLinkState(mapping, row.revision);
      row.hasLink = Boolean(mapping?.link);
    } catch {
      row.linkState = "unknown";
      row.hasLink = true;
    }
  });
  return { drafts: page, counts, total: rows.length, cursor: offset + page.length < rows.length ? String(offset + page.length) : null };
}
__name(browsePreparedOrders, "browsePreparedOrders");

// ../order-manager-web/prepared-catalog-model.mjs
var COLOR_FAMILIES = ["Black", "White", "Gray", "Blue", "Green", "Red", "Pink", "Purple", "Orange", "Yellow", "Brown", "Beige", "Multicolor", "Unmapped"];
var normalized = /* @__PURE__ */ __name((value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), "normalized");
function catalogBrand(product) {
  if (product.vendor && !/^(my store|print[ -]?mo)$/i.test(product.vendor)) return product.vendor;
  const named = /^(American Apparel|Comfort Colors|Gildan|Tultex|Shaka Wear|Independent Trading Co\.?|Bella\s*\+\s*Canvas|Devon\s*&\s*Jones|Adidas|Next Level|Hanes|Jerzees|District|Port & Company|Sport-Tek)\b/i.exec(product.title);
  return named?.[1] || (product.title.includes(" - ") ? product.title.split(" - ")[0] : "Other brands");
}
__name(catalogBrand, "catalogBrand");
function garmentType(product) {
  const value = normalized(`${product.productType || ""} ${product.category?.name || ""} ${product.title}`);
  for (const [test, label] of [[/\bhood(?:ed|ie|ies)?\b/, "Hoodies"], [/\bpolo\b/, "Polos"], [/\btank|\bmuscle tee|\bsleeveless/, "Tanks"], [/crewneck|sweatshirt/, "Crewnecks"], [/\bt shirts?\b|\btees?\b|\bjersey shirts?\b/, "T-shirts"], [/jacket|windbreaker|\bvest\b/, "Outerwear"], [/\bpant|jogger|shorts|legging/, "Bottoms"], [/\bcap\b|beanie|\bhat\b/, "Headwear"]]) if (test.test(value)) return label;
  return "Other garments";
}
__name(garmentType, "garmentType");
function colorFamilies(name, hex, native = []) {
  const aliases = { grey: "Gray", silver: "Gray", gold: "Yellow", beige: "Beige", multicolor: "Multicolor", "multi color": "Multicolor", "rose gold": "Pink" };
  const declared = native.map((value) => aliases[normalized(value)] || COLOR_FAMILIES.find((f) => normalized(f) === normalized(value))).filter(Boolean);
  if (declared.length) return [...new Set(declared)];
  const text2 = normalized(name);
  const names = [[/multi|rainbow|camo|camouflage|tie dye/, "Multicolor"], [/black|onyx/, "Black"], [/navy|blue|aqua|sapphire|turquoise|teal|denim|indigo/, "Blue"], [/green|olive|army|kiwi|moss|sage|forest|jade/, "Green"], [/purple|violet|lavender|lilac|plum/, "Purple"], [/pink|rose|azalea|fuchsia|coral/, "Pink"], [/red|maroon|burgundy|cardinal|cherry|scarlet|wine/, "Red"], [/orange|rust|paprika/, "Orange"], [/yellow|gold|mustard|citron/, "Yellow"], [/brown|chocolate|cocoa|espresso/, "Brown"], [/beige|tan|khaki|sand|cream|natural|ivory|bone/, "Beige"], [/white/, "White"], [/gr[ae]y|charcoal|ash|silver|pewter/, "Gray"]];
  for (const [test, family] of names) if (test.test(text2)) return [family];
  if (/^#[0-9a-f]{6}$/i.test(hex || "")) {
    const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255), max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
    if (max < 0.18) return ["Black"];
    if (min > 0.91) return ["White"];
    if (delta < 0.08) return ["Gray"];
    const hue = ((max === rgb[0] ? (rgb[1] - rgb[2]) / delta : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4) * 60 + 360) % 360;
    if (hue < 20 || hue >= 345) return ["Red"];
    if (hue < 48) return [max < 0.58 ? "Brown" : min > 0.55 ? "Beige" : "Orange"];
    if (hue < 70) return ["Yellow"];
    if (hue < 165) return ["Green"];
    if (hue < 260) return ["Blue"];
    if (hue < 305) return ["Purple"];
    return ["Pink"];
  }
  return ["Unmapped"];
}
__name(colorFamilies, "colorFamilies");
function searchWords(value) {
  return normalized(value).replace(/\bt shirts?\b|\btees?\b/g, "tshirt").replace(/\bhooded\s+sweatshirts?\b|\bhoodies\b/g, "hoodie").replace(/\bcrew\s+necks?\b/g, "crewneck").split(/\s+/).filter(Boolean);
}
__name(searchWords, "searchWords");
function catalogMatch(product, query, filters = {}, skuMatches = /* @__PURE__ */ new Set()) {
  if (filters.status?.length && !filters.status.includes(product.status)) return -1;
  if (filters.type?.length && !filters.type.includes(product.garmentType)) return -1;
  if (filters.brand?.length && !filters.brand.includes(product.brand)) return -1;
  if (filters.family?.length && !product.colors.some((color) => color.families.some((family) => filters.family.includes(family)))) return -1;
  const words = searchWords(query), title = searchWords(product.title).join(" "), haystack = searchWords(`${product.title} ${product.brand} ${product.garmentType} ${product.colors.map((c) => c.name).join(" ")}`).join(" ");
  if (!words.length) return 0;
  if (skuMatches.has(product.id)) return 100;
  if (!words.every((word) => haystack.includes(word))) return -1;
  const style = normalized(product.title.split(" - ").at(-1));
  return normalized(query) === style ? 120 : title === words.join(" ") ? 110 : title.startsWith(words.join(" ")) ? 60 : 20;
}
__name(catalogMatch, "catalogMatch");

// prepared-catalog.mjs
var FINDER_PRODUCTS_QUERY = `query PreparedFinderProducts($after:String){products(first:100,after:$after,query:"status:active OR status:unlisted",sortKey:TITLE){nodes{
 id title handle status vendor productType category{name} featuredMedia{preview{image{url}}}
 options{name optionValues{name hasVariants linkedMetafieldValue swatch{color image{image{url}}}}}
}pageInfo{hasNextPage endCursor}}}`;
var NATIVE_COLORS_QUERY = `query PreparedFinderColors($ids:[ID!]!){nodes(ids:$ids){...on Metaobject{id field(key:"color_taxonomy_reference"){references(first:5){nodes{...on TaxonomyValue{name}}}}}}}`;
var SKU_QUERY = `query PreparedFinderSku($query:String!,$after:String){products(first:100,query:$query,after:$after){nodes{id}pageInfo{hasNextPage endCursor}}}`;
var caches = /* @__PURE__ */ new WeakMap();
var fail3 = /* @__PURE__ */ __name((message, code = "CATALOG_UNAVAILABLE") => {
  throw Object.assign(new Error(message), { code, status: 502 });
}, "fail");
function checked(result) {
  if (result?.ok !== false && result?.data && !result.errors?.length) return result.data;
  if (result?.errors?.some((e) => e.extensions?.code === "ACCESS_DENIED")) fail3("Shopify did not allow product access. Reopen Order Manager from Shopify Admin and retry.", "CATALOG_ACCESS_DENIED");
  fail3("The garment catalog could not load. Retry; your selected garments are still here.");
}
__name(checked, "checked");
async function index(env, graphql, context, force = false) {
  let shops = caches.get(graphql);
  if (!shops) {
    shops = /* @__PURE__ */ new Map();
    caches.set(graphql, shops);
  }
  const shop = env.SHOPIFY_SHOP_DOMAIN.toLowerCase(), existing = shops.get(shop);
  if (existing && existing.expires > Date.now() && (!force || existing.refreshing)) return existing.promise;
  const value = { expires: Date.now() + 3e5, promise: null, refreshing: force };
  value.promise = (async () => {
    const key2 = `admin-prepared-orders/v1/${encodeURIComponent(shop)}/catalog-index.json`;
    const snapshot = await env.R2_BUCKET?.get(key2).then((stored) => stored?.json()).catch(() => null);
    if (!force && snapshot?.version === 1 && Array.isArray(snapshot.products) && snapshot.loadedAt) {
      if (Date.now() - Date.parse(snapshot.loadedAt) > 3e5) {
        if (context?.waitUntil) {
          const refresh = index(env, graphql, context, true);
          shops.set(shop, value);
          value.expires = Date.now() + 3e4;
          context.waitUntil(refresh.then((fresh) => {
            if (shops.get(shop) === value) {
              value.promise = Promise.resolve(fresh);
              value.expires = Date.now() + 3e5;
            }
          }).catch(() => {
          }));
        } else return index(env, graphql, context, true);
      }
      return { ...snapshot, skuCache: /* @__PURE__ */ new Map() };
    }
    const products = [];
    let after = null;
    do {
      const data2 = checked(await graphql(env, FINDER_PRODUCTS_QUERY, { after }, "PreparedFinderProducts"));
      products.push(...data2.products.nodes.filter((p) => ["ACTIVE", "UNLISTED"].includes(p.status)));
      after = data2.products.pageInfo.hasNextPage ? data2.products.pageInfo.endCursor : null;
      if (data2.products.pageInfo.hasNextPage && !after) fail3("The complete garment catalog could not load. Retry.");
    } while (after);
    const native = new Map(snapshot?.nativeFamilies || []), ids = [...new Set(products.flatMap((p) => p.options?.flatMap((o) => o.optionValues?.map((v) => v.linkedMetafieldValue).filter(Boolean) || []) || []))];
    let nativeDenied = false;
    await mapConcurrent(Array.from({ length: Math.ceil(ids.length / 80) }, (_, i) => ids.slice(i * 80, i * 80 + 80)), 2, async (batch) => {
      if (nativeDenied) return;
      try {
        const result = await graphql(env, NATIVE_COLORS_QUERY, { ids: batch }, "PreparedFinderColors");
        if (result?.errors?.length || result?.ok === false) {
          nativeDenied = true;
          return;
        }
        for (const node of result.data?.nodes || []) if (node?.id) native.set(node.id, node.field?.references?.nodes?.map((v) => v.name) || []);
      } catch {
        nativeDenied = true;
      }
    });
    const built = { version: 1, nativeFamilies: [...native], products: products.map((p) => {
      const colors = (p.options || []).filter((o) => /colou?r/i.test(o.name)).flatMap((o) => (o.optionValues || []).filter((v) => v.hasVariants !== false).map((v) => ({ name: v.name, color: v.swatch?.color || "", image: v.swatch?.image?.image?.url || "", families: colorFamilies(v.name, v.swatch?.color, native.get(v.linkedMetafieldValue)) })));
      return { id: p.id, title: p.title, handle: p.handle, status: p.status, brand: catalogBrand(p), garmentType: garmentType(p), image: p.featuredMedia?.preview?.image?.url || "", colors };
    }), loadedAt: (/* @__PURE__ */ new Date()).toISOString() };
    try {
      await env.R2_BUCKET?.put(key2, JSON.stringify(built), { httpMetadata: { contentType: "application/json" } });
    } catch {
    }
    return { ...built, skuCache: /* @__PURE__ */ new Map() };
  })().catch((error) => {
    if (shops.get(shop) === value) shops.delete(shop);
    throw error;
  }).finally(() => {
    value.refreshing = false;
  });
  shops.set(shop, value);
  return value.promise;
}
__name(index, "index");
async function searchPreparedCatalog(env, graphql, input, context) {
  const state = await index(env, graphql, context, input.refresh === "1"), query = String(input.q || "").trim().slice(0, 120);
  let skuMatches = /* @__PURE__ */ new Set();
  if (/^[a-z0-9_.-]{3,80}$/i.test(query) && /\d/.test(query)) {
    if (!state.skuCache.has(query)) state.skuCache.set(query, (async () => {
      const found = /* @__PURE__ */ new Set();
      let after = null;
      do {
        const data2 = checked(await graphql(env, SKU_QUERY, { query: `(status:active OR status:unlisted) AND sku:${query}*`, after }, "PreparedFinderSku"));
        data2.products.nodes.forEach((p) => found.add(p.id));
        after = data2.products.pageInfo.hasNextPage ? data2.products.pageInfo.endCursor : null;
      } while (after);
      return found;
    })().catch((error) => {
      state.skuCache.delete(query);
      throw error;
    }));
    skuMatches = await state.skuCache.get(query);
  }
  const parse2 = /* @__PURE__ */ __name((key2) => String(input[key2] || "").split("|").filter(Boolean), "parse");
  const filters = { status: parse2("status"), type: parse2("type"), brand: parse2("brand"), family: parse2("family") };
  const recent = new Set(String(input.recent || "").split("|").filter(Boolean));
  const matches = state.products.filter((product) => !input.recent || recent.has(product.id)).map((product) => ({ product, score: catalogMatch(product, query, filters, skuMatches) })).filter((value) => value.score >= 0).sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title));
  const offset = /^\d{1,8}$/.test(input.after || "") ? Number(input.after) : 0;
  const facets = { brand: [...new Set(state.products.map((p) => p.brand))].sort(), type: [...new Set(state.products.map((p) => p.garmentType))].sort(), family: COLOR_FAMILIES.filter((f) => state.products.some((p) => p.colors.some((c) => c.families.includes(f)))) };
  return { products: matches.slice(offset, offset + 30).map((v) => v.product), total: matches.length, facets, hasNextPage: offset + 30 < matches.length, endCursor: offset + 30 < matches.length ? String(offset + 30) : null, loadedAt: state.loadedAt };
}
__name(searchPreparedCatalog, "searchPreparedCatalog");

// prepared-commerce-pricing.mjs
function rotAabb(print) {
  return rotSubRectAabb(print, { x: 0, y: 0, w: print.design.wIn, h: print.design.hIn });
}
__name(rotAabb, "rotAabb");
function rotSubRectAabb(print, rect) {
  const { xIn, yIn, wIn, hIn, rotation } = print.design;
  const cx = xIn + wIn / 2;
  const cy = yIn + hIn / 2;
  const corners = [
    { x: xIn + rect.x, y: yIn + rect.y },
    { x: xIn + rect.x + rect.w, y: yIn + rect.y },
    { x: xIn + rect.x + rect.w, y: yIn + rect.y + rect.h },
    { x: xIn + rect.x, y: yIn + rect.y + rect.h }
  ].map((pt) => rotatePointAround(pt, { x: cx, y: cy }, rotation));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
__name(rotSubRectAabb, "rotSubRectAabb");
function unionOf(rects) {
  const u = rects.reduce(
    (acc, r) => ({
      x: Math.min(acc.x, r.x),
      y: Math.min(acc.y, r.y),
      r: Math.max(acc.r, r.x + r.w),
      b: Math.max(acc.b, r.y + r.h)
    }),
    { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity }
  );
  return { wIn: Math.max(0, u.r - u.x), hIn: Math.max(0, u.b - u.y) };
}
__name(unionOf, "unionOf");
function rotatePointAround(point, pivot, rotationDeg) {
  const rad = rotationDeg * Math.PI / 180;
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos
  };
}
__name(rotatePointAround, "rotatePointAround");
var SIDE_MAP = {
  front: ["breast", "chest", "front_full"],
  back: ["back_tag", "back_half", "back_full"],
  breast: ["breast"],
  // Map both left/right to sleeve placement unless specific keys exist
  left: ["left", "sleeve_left", "sleeve"],
  right: ["right", "sleeve_right", "sleeve"]
};
var FRONT_BACK_TIER_KEY_PATTERN = /^(tote|koozie|kozzie|hat)[_-]/i;
var FRONT_TIER_SUFFIX_PATTERN = /(?:[_-])front$/i;
var BACK_TIER_SUFFIX_PATTERN = /(?:[_-])back$/i;
function isTieredFrontBackPlacementKey(key2) {
  return FRONT_BACK_TIER_KEY_PATTERN.test(String(key2 || ""));
}
__name(isTieredFrontBackPlacementKey, "isTieredFrontBackPlacementKey");
function tieredPlacementSupportsSide(key2, side) {
  if (side !== "front" && side !== "back") return false;
  const normalizedKey = String(key2 || "");
  if (FRONT_TIER_SUFFIX_PATTERN.test(normalizedKey)) return side === "front";
  if (BACK_TIER_SUFFIX_PATTERN.test(normalizedKey)) return side === "back";
  return true;
}
__name(tieredPlacementSupportsSide, "tieredPlacementSupportsSide");
function placementKeysForSide(placements, side) {
  const safePlacements = placements || {};
  const baseKeys = (SIDE_MAP[side] || []).filter((key2) => safePlacements[key2]);
  if (baseKeys.length > 0 || side !== "front" && side !== "back") return baseKeys;
  return Object.keys(safePlacements).filter((key2) => isTieredFrontBackPlacementKey(key2) && tieredPlacementSupportsSide(key2, side)).sort((a, b) => {
    const areaA = (Number(safePlacements[a]?.wIn) || 0) * (Number(safePlacements[a]?.hIn) || 0);
    const areaB = (Number(safePlacements[b]?.wIn) || 0) * (Number(safePlacements[b]?.hIn) || 0);
    return areaA - areaB || a.localeCompare(b);
  });
}
__name(placementKeysForSide, "placementKeysForSide");
function selectPlacement(placements, side, wIn, hIn) {
  const safePlacements = placements || {};
  const keys = placementKeysForSide(safePlacements, side);
  const eligible = keys.map((key2) => ({ key: key2, placement: safePlacements[key2] })).filter(
    ({ placement }) => wIn >= (placement.minWIn ?? 0) && hIn >= (placement.minHIn ?? 0)
  );
  if (!eligible.length) return null;
  eligible.sort(
    (a, b) => b.placement.wIn * b.placement.hIn - a.placement.wIn * a.placement.hIn
  );
  return eligible[0];
}
__name(selectPlacement, "selectPlacement");
function selectTieredPlacementByArea(placements, side, areaIn2) {
  if (side !== "front" && side !== "back") return null;
  const safePlacements = placements || {};
  const area = Math.max(0, Number(areaIn2) || 0);
  if (!(area > 0)) return null;
  const tiers = placementKeysForSide(safePlacements, side).filter((key2) => isTieredFrontBackPlacementKey(key2)).map((key2) => {
    const placement = safePlacements[key2];
    const tierArea = Math.max(0, (Number(placement.wIn) || 0) * (Number(placement.hIn) || 0));
    return { key: key2, placement, tierArea };
  }).filter(({ tierArea }) => tierArea > 0).sort((a, b) => a.tierArea - b.tierArea || a.key.localeCompare(b.key));
  if (!tiers.length) return null;
  const selected = tiers.find((tier) => area <= tier.tierArea) || tiers[tiers.length - 1];
  return { key: selected.key, placement: selected.placement };
}
__name(selectTieredPlacementByArea, "selectTieredPlacementByArea");
var PRINT_AREA_PRICING = {
  front: [
    { maxArea: 25, variantId: 46714190135544, label: "Breast Print" },
    { maxArea: 112, variantId: 46714190168312, label: "Chest Print" },
    { maxArea: Infinity, variantId: 46714190201080, label: "Full Front Print" }
  ],
  back: [
    { maxArea: 16, variantId: 46714190233848, label: "Back Tag" },
    { maxArea: 112, variantId: 46714190266616, label: "Half Back Print" },
    { maxArea: Infinity, variantId: 46714190299384, label: "Full Back Print" }
  ],
  left: [
    { maxArea: Infinity, variantId: 46714190332152, label: "Short Sleeve Print" }
  ],
  right: [
    { maxArea: Infinity, variantId: 46714190332152, label: "Short Sleeve Print" }
  ]
};
function resolvePrintVariantByArea(side, areaIn2) {
  const rules = PRINT_AREA_PRICING[side];
  if (!rules || !rules.length) return void 0;
  const area = Math.max(0, areaIn2 || 0);
  for (const rule of rules) {
    if (area <= rule.maxArea) return rule;
  }
  return rules[rules.length - 1];
}
__name(resolvePrintVariantByArea, "resolvePrintVariantByArea");
var DEFAULT_CANVAS_REFERENCE_WIDTH_IN = 14;
function approxEq(a, b, eps = 0.01) {
  if (a === null || b === null) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= eps * scale;
}
__name(approxEq, "approxEq");
function unionArea(rects) {
  if (!rects.length) return 0;
  const events = [];
  rects.forEach((rect, idx) => {
    const x1 = rect.x;
    const y1 = rect.y;
    const x2 = rect.x + rect.w;
    const y2 = rect.y + rect.h;
    if (!(x2 > x1 && y2 > y1)) return;
    events.push({ x: x1, type: 1, y1, y2, id: idx });
    events.push({ x: x2, type: -1, y1, y2, id: idx });
  });
  if (!events.length) return 0;
  events.sort((a, b) => a.x === b.x ? a.type - b.type : a.x - b.x);
  const active = /* @__PURE__ */ new Map();
  let prevX = events[0]?.x ?? 0;
  let area = 0;
  const computeCoveredY = /* @__PURE__ */ __name(() => {
    if (!active.size) return 0;
    const segments = Array.from(active.values()).map((seg) => ({ y1: Math.min(seg.y1, seg.y2), y2: Math.max(seg.y1, seg.y2) })).filter((seg) => seg.y2 > seg.y1).sort((a, b) => a.y1 - b.y1);
    if (!segments.length) return 0;
    let total = 0;
    let curStart = segments[0].y1;
    let curEnd = segments[0].y2;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.y1 > curEnd) {
        total += curEnd - curStart;
        curStart = seg.y1;
        curEnd = seg.y2;
      } else {
        curEnd = Math.max(curEnd, seg.y2);
      }
    }
    total += curEnd - curStart;
    return total;
  }, "computeCoveredY");
  for (const event of events) {
    const dx = event.x - prevX;
    if (dx > 0) {
      const coveredY = computeCoveredY();
      if (coveredY > 0) {
        area += dx * coveredY;
      }
    }
    if (event.type === 1) {
      active.set(event.id, { y1: event.y1, y2: event.y2 });
    } else {
      active.delete(event.id);
    }
    prevX = event.x;
  }
  return area;
}
__name(unionArea, "unionArea");
function applyTrimToDesign(design, trim, naturalWidthHint, naturalHeightHint) {
  if (!trim) return design;
  if (trim.blank) return design;
  const padded = trim.paddedCrop || trim.crop;
  if (!padded || !(padded.width > 0 && padded.height > 0)) return design;
  const naturalWidth = Math.max(0, Number(trim.naturalWidth ?? naturalWidthHint) || 0);
  const naturalHeight = Math.max(0, Number(trim.naturalHeight ?? naturalHeightHint) || 0);
  if (!(naturalWidth > 0 && naturalHeight > 0)) return design;
  const trimmedWidthRatio = padded.width / naturalWidth;
  const trimmedHeightRatio = padded.height / naturalHeight;
  if (!(trimmedWidthRatio > 0 && trimmedHeightRatio > 0)) return design;
  const designAspect = design.wIn > 0 && design.hIn > 0 ? design.wIn / design.hIn : null;
  const naturalAspect = naturalWidth / naturalHeight;
  const trimmedAspect = padded.width / padded.height;
  if (designAspect !== null && approxEq(designAspect, naturalAspect) && !approxEq(designAspect, trimmedAspect)) {
    const cx = design.xIn + design.wIn / 2;
    const cy = design.yIn + design.hIn / 2;
    const nextW = design.wIn * trimmedWidthRatio;
    const nextH = design.hIn * trimmedHeightRatio;
    return {
      xIn: cx - nextW / 2,
      yIn: cy - nextH / 2,
      wIn: nextW,
      hIn: nextH,
      rotation: design.rotation
    };
  }
  return design;
}
__name(applyTrimToDesign, "applyTrimToDesign");
function derivePrintPricingForDesign(options) {
  const {
    prints,
    safeAreaWidthInBySide,
    canvasReferenceWidthIn = DEFAULT_CANVAS_REFERENCE_WIDTH_IN,
    canvasReferenceWidthInBySide,
    placements,
    coverageMode = "trimmed-rect"
  } = options;
  const resolvedPrints = Array.isArray(prints) ? prints : [];
  if (!resolvedPrints.length) return [];
  const safeWidths = safeAreaWidthInBySide || {};
  const referenceWidths = canvasReferenceWidthInBySide || {};
  const referenceWidthIn = Math.max(1e-3, Number(canvasReferenceWidthIn) || DEFAULT_CANVAS_REFERENCE_WIDTH_IN);
  const coverageRectsBySide = {
    front: [],
    back: [],
    left: [],
    right: [],
    breast: []
  };
  for (const entry of resolvedPrints) {
    const side = String(entry?.side || "").toLowerCase();
    if (side !== "front" && side !== "back" && side !== "left" && side !== "right" && side !== "breast") continue;
    const safeWidth = Math.max(
      1e-3,
      Number(safeWidths[side]) || Number(safeWidths.front) || referenceWidthIn
    );
    const sideReferenceWidth = Math.max(
      1e-3,
      Number(referenceWidths[side]) || referenceWidthIn
    );
    const conversion = sideReferenceWidth / safeWidth;
    const design = entry?.design || {};
    const baseDesign = {
      xIn: (Number(design?.xIn) || 0) * conversion,
      yIn: (Number(design?.yIn) || 0) * conversion,
      wIn: Math.max(0, Number(design?.wIn) || 0) * conversion,
      hIn: Math.max(0, Number(design?.hIn) || 0) * conversion,
      rotation: Number(design?.rotation) || 0
    };
    if (!(baseDesign.wIn > 0 && baseDesign.hIn > 0)) continue;
    const trimMeta = entry?.trim ?? entry?.asset?.trim ?? null;
    const naturalW = Number(entry?.asset?.naturalW ?? trimMeta?.naturalWidth ?? null);
    const naturalH = Number(entry?.asset?.naturalH ?? trimMeta?.naturalHeight ?? null);
    const trimmedDesign = applyTrimToDesign(baseDesign, trimMeta, naturalW, naturalH);
    if (!trimmedDesign) continue;
    const designForCoverage = coverageMode === "painted-pixels" ? trimmedDesign : trimmedDesign;
    const box = rotAabb({ design: designForCoverage });
    if (!(box.w > 0 && box.h > 0)) continue;
    coverageRectsBySide[side].push(box);
  }
  const rectsByPricingSide = {
    front: [...coverageRectsBySide.front, ...coverageRectsBySide.breast],
    back: coverageRectsBySide.back,
    left: coverageRectsBySide.left,
    right: coverageRectsBySide.right
  };
  const decisions = [];
  ["front", "back", "left", "right"].forEach((side) => {
    const rects = rectsByPricingSide[side];
    const areaIn2 = unionArea(rects);
    if (!(areaIn2 > 0)) return;
    const bounds = unionOf(rects);
    const placement = selectTieredPlacementByArea(placements, side, areaIn2) || selectPlacement(placements, side, bounds.wIn, bounds.hIn);
    const addonVariantId = Number(placement?.placement?.addonVariantId);
    if (placement && isTieredFrontBackPlacementKey(placement.key) && Number.isFinite(addonVariantId) && addonVariantId > 0) {
      decisions.push({
        side,
        areaIn2,
        placementKey: placement.key,
        rule: {
          maxArea: Infinity,
          variantId: addonVariantId,
          label: placement.placement.label || placement.key
        }
      });
      return;
    }
    const rule = resolvePrintVariantByArea(side, areaIn2);
    if (!rule) return;
    decisions.push({ side, areaIn2, rule });
  });
  return decisions;
}
__name(derivePrintPricingForDesign, "derivePrintPricingForDesign");
function printClassChoices(config2, side) {
  const tiers = placementKeysForSide(config2.placements, side).filter(isTieredFrontBackPlacementKey).map((key2) => config2.placements[key2]).filter((placement) => Number.isSafeInteger(placement.addonVariantId) && Number(placement.addonVariantId) > 0).map((placement) => ({ variantId: placement.addonVariantId, label: placement.label }));
  return tiers.length ? tiers : PRINT_AREA_PRICING[side].map(({ variantId, label }) => ({ variantId, label }));
}
__name(printClassChoices, "printClassChoices");
function resolvePrintClasses(config2, decisions, overrides) {
  return decisions.map((decision) => {
    const manual = printClassChoices(config2, decision.side).find((choice) => choice.variantId === overrides[decision.side]?.variantId);
    return {
      side: decision.side,
      variantId: manual?.variantId || decision.rule.variantId,
      label: manual?.label || decision.rule.label,
      mode: manual ? "manual" : "automatic"
    };
  });
}
__name(resolvePrintClasses, "resolvePrintClasses");
function resolveInkRectFromTrim(trim, design) {
  if (!trim) return null;
  const renderCrop = trim.paddedCrop ?? trim.crop ?? null;
  const inkCrop = trim.crop ?? renderCrop;
  const baseW = renderCrop?.width || trim.naturalWidth || 0;
  const baseH = renderCrop?.height || trim.naturalHeight || 0;
  if (!renderCrop || !inkCrop || baseW <= 0 || baseH <= 0) return null;
  const scaleX = design.wIn / baseW;
  const scaleY = design.hIn / baseH;
  return { x: (inkCrop.x - renderCrop.x) * scaleX, y: (inkCrop.y - renderCrop.y) * scaleY, w: inkCrop.width * scaleX, h: inkCrop.height * scaleY };
}
__name(resolveInkRectFromTrim, "resolveInkRectFromTrim");
var FALLBACK_PLACEMENT_CALIBRATION = {
  version: 1,
  fingerprint: "admin-reference-12x16",
  bySide: Object.fromEntries(["front", "back", "left", "right", "breast"].map((side) => [side, { referenceWidthIn: 12, safeWidthIn: 12, safeHeightIn: 16 }]))
};
function placementInkBounds(print) {
  return rotSubRectAabb(print, resolveInkRectFromTrim(print.trim || print.asset.trim, print.design) || { x: 0, y: 0, w: print.design.wIn, h: print.design.hIn });
}
__name(placementInkBounds, "placementInkBounds");

// prepared-recipient.mjs
var SIDES = ["front", "back", "breast", "left", "right"];
var fail4 = /* @__PURE__ */ __name((message) => {
  throw Object.assign(new Error(message), { code: "INVALID_DESIGN", status: 400 });
}, "fail");
function recipientDesigns(record, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail4("The edited designs could not be read.");
  const next = structuredClone(record), normalized2 = {};
  for (const [id2, value] of Object.entries(input)) {
    const item = next.items.find((item2) => item2.id === id2);
    if (!item?.project?.prints?.length) fail4("This item has a supplied mockup and cannot be edited in Designer.");
    if (!value || !/^[a-f0-9]{64}$/.test(value.revision || "") || !Array.isArray(value.prints) || value.prints.length > 40) fail4("The edited design is invalid.");
    const prints = value.prints.map((print) => {
      if (!SIDES.includes(print.side) || !["image", "text"].includes(print.type)) fail4("This design has an unsupported layer.");
      const d = print.design;
      if (!d || !["xIn", "yIn", "wIn", "hIn", "rotation"].every((key2) => Number.isFinite(d[key2]) && Math.abs(d[key2]) <= 200) || d.wIn <= 0 || d.hIn <= 0) fail4("Check the artwork size and placement.");
      const trim = print.trim || print.asset?.trim;
      if (trim && (!trim.crop || !["x", "y", "width", "height"].every((key2) => Number.isFinite(trim.crop[key2]) && trim.crop[key2] >= 0) || !Number.isFinite(trim.naturalWidth) || !Number.isFinite(trim.naturalHeight) || trim.naturalWidth <= 0 || trim.naturalHeight <= 0)) fail4("Check the artwork crop.");
      return { type: print.type, side: print.side, design: Object.fromEntries(["xIn", "yIn", "wIn", "hIn", "rotation"].map((key2) => [key2, d[key2]])), ...trim ? { trim } : {}, asset: {} };
    });
    const bySide = {};
    for (const side of SIDES) {
      const area = value.canvasCalibration?.bySide?.[side];
      if (!area) continue;
      if (!["referenceWidthIn", "safeWidthIn", "safeHeightIn"].every((key2) => Number.isFinite(area[key2]) && area[key2] > 0 && area[key2] <= 200)) fail4("Check the design calibration.");
      bySide[side] = { referenceWidthIn: area.referenceWidthIn, safeWidthIn: area.safeWidthIn, safeHeightIn: area.safeHeightIn };
    }
    const project = { ...item.project, prints, canvasCalibration: { bySide } };
    item.project = project;
    normalized2[id2] = { revision: value.revision, prints, canvasCalibration: project.canvasCalibration };
  }
  return { record: next, designs: normalized2 };
}
__name(recipientDesigns, "recipientDesigns");
function recipientColorPresentation(product, item, color) {
  const same = /* @__PURE__ */ __name((value) => String(value || "").trim().toLowerCase() === String(color || "").trim().toLowerCase(), "same");
  const native = Object.entries(product.swatches || {}).find(([name]) => same(name))?.[1];
  const configured = product.config?.colors?.find((value) => same(value.name));
  const saved = same(item.color) ? item.swatch : null;
  return {
    name: color,
    tintHex: native?.color || saved?.color || configured?.tintHex || "",
    ...native?.image || saved?.image || configured?.swatchImage ? { swatchImage: native?.image || saved?.image || configured?.swatchImage } : {}
  };
}
__name(recipientColorPresentation, "recipientColorPresentation");
function recipientChoicePresentations(groups, record, template) {
  return (groups || []).map((group) => ({ ...group, options: group.options.map((option) => {
    const fresh = template.workspaces.find((workspace) => workspace.id === option.id);
    const item = record.items.find((item2) => item2.id === option.id) || {};
    return { ...option, config: { ...option.config, colors: fresh?.config?.colors || [recipientColorPresentation({ config: option.config }, item, option.color)] } };
  }) }));
}
__name(recipientChoicePresentations, "recipientChoicePresentations");
async function recipientTemplate(record, items, service, sourceTemplate, { preferPublished = false } = {}) {
  const workspaces = [];
  const products = /* @__PURE__ */ new Map(), publishedProducts = /* @__PURE__ */ new Map();
  if (preferPublished) for (const item of record.items) {
    const saved = sourceTemplate?.workspaces?.find((value) => value.id === item.id), commerce = items.find((value) => value.id === item.id);
    if (saved?.config && saved.handle && Array.isArray(saved.variants) && commerce?.variants.every((variant) => saved.variants.some((value) => String(value.id) === variant.id.split("/").pop()))) {
      publishedProducts.set(item.id, {
        title: saved.title || item.title,
        handle: saved.handle,
        image: saved.image || "",
        config: saved.config,
        variants: saved.variants.map((variant) => ({ id: "gid://shopify/ProductVariant/" + variant.id, image: variant.image, selectedOptions: [{ name: "Color", value: variant.color || saved.color || item.color || "" }, { name: "Size", value: variant.size || "One size" }] }))
      });
    }
  }
  const missing = [...new Set(record.items.filter((item) => !publishedProducts.has(item.id)).map((item) => item.productId))];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
    while (next < missing.length) {
      const id2 = missing[next++];
      products.set(id2, await service.product(id2));
    }
  }));
  for (const item of record.items) {
    const commerce = items.find((value) => value.id === item.id), product = publishedProducts.get(item.id) || products.get(item.productId);
    const selected = product.variants.find((value) => value.id === item.variantId);
    const color = selected?.selectedOptions.find((option) => /^colou?r$/i.test(option.name))?.value || item.color || commerce.color || "";
    const originals = sourceTemplate?.workspaces?.find((value) => value.id === item.id)?.design?.prints || [];
    const prints = (item.project?.prints || []).map((print) => ({ ...print, asset: { ...print.asset, url: originals.find((value) => value.id === print.id)?.asset?.url || "" } }));
    if (prints.some((print) => !print.asset.url)) throw Object.assign(new Error("The saved artwork could not load. Refresh this customer link in Order Manager."), { code: "ARTWORK_UNAVAILABLE", status: 409 });
    const variants = commerce.variants.map((variant) => {
      const image = product.variants.find((value) => value.id === variant.id)?.image;
      return { id: Number(variant.id.split("/").pop()), color, size: variant.size === "One size" ? "" : variant.size, priceCents: variant.priceCents, available: true, image: (typeof image === "string" ? image : image?.url) || product.image || "" };
    });
    const images = commerce.images || [];
    workspaces.push({
      id: item.id,
      handle: product.handle || item.handle,
      title: product.title,
      image: product.image || "",
      variants,
      config: { ...product.config, colors: [recipientColorPresentation(product, item, color)], ...variants.every((v) => !v.size) ? { oneSize: true } : {} },
      selectedVariantId: Number(item.variantId.split("/").pop()),
      color,
      activeVariantColor: color,
      customerInstructions: item.instructions || "",
      preparedItem: { editable: prints.length > 0, images, printMode: item.printMode || "auto", prefilledQuantities: Object.values(item.sizeQty || {}).some((quantity) => quantity > 0), prints: commerce.prints },
      design: { ...item.project, prints, selectedIds: [], panelView: "none", textValue: "", rotationInput: 0, activeSide: item.project?.activeSide || "front", selectedColor: color, selectedSize: variants[0]?.size || "", selectedVariantId: Number(item.variantId.split("/").pop()), sizeQty: { ...item.sizeQty || {} } }
    });
  }
  return { version: 1, activeHandle: workspaces[0]?.handle || null, activeWorkspaceId: workspaces[0]?.id, workspaces };
}
__name(recipientTemplate, "recipientTemplate");
function recipientArtwork(record, designs, input, selectedIds, previews = {}, frontPreviews = {}) {
  const files = [];
  let frontBudget = 2 * 1024 * 1024;
  for (const item of record.items) {
    if (!selectedIds.has(item.id) || !designs[item.id]) continue;
    const sides = [...new Set(designs[item.id].prints.map((print) => print.side))];
    for (const side of sides) {
      const svg = input?.[item.id]?.[side];
      if (typeof svg !== "string" || svg.length > 12 * 1024 * 1024 || !/<svg[\s>]/i.test(svg) || /<script|<foreignObject|on[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/)/i.test(svg)) fail4("The edited artwork could not be exported safely. Return to the review and retry.");
      files.push({ itemId: item.id, side, svg });
    }
    const preview = previews[item.id];
    if (typeof preview === "string" && preview.length <= 8 * 1024 * 1024) {
      const match = preview.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (match) files.push({ itemId: item.id, side: "other", mime: match[1], base64: match[2] });
    }
    const front = frontPreviews && typeof frontPreviews === "object" && !Array.isArray(frontPreviews) ? frontPreviews[item.id] : null;
    if (sides.includes("front") && typeof front === "string" && front.length <= Math.min(1024 * 1024, frontBudget)) {
      const match = front.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (match) {
        files.push({ itemId: item.id, side: "front", role: "mobile-preview", mime: match[1], base64: match[2] });
        frontBudget -= front.length;
      }
    }
  }
  return files;
}
__name(recipientArtwork, "recipientArtwork");

// prepared-choices.mjs
var invalid = /* @__PURE__ */ __name((message) => {
  throw Object.assign(new Error(message), { code: "INVALID_SELECTION", status: 400 });
}, "invalid");
function validateAlternativeGroups(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) if (item.alternativeForItemId) {
    const parent = byId.get(item.alternativeForItemId);
    if (!parent || parent.id === item.id || parent.alternativeForItemId) invalid("An alternative must belong to a proposed garment, not another alternative.");
  }
}
__name(validateAlternativeGroups, "validateAlternativeGroups");
function preparedSelection(record, selection) {
  validateAlternativeGroups(record.items);
  const roots = record.items.filter((item) => !item.alternativeForItemId);
  if (selection === void 0) return roots.map((item) => item.id);
  if (!selection || typeof selection !== "object" || Array.isArray(selection) || !selection.choices || typeof selection.choices !== "object" || Array.isArray(selection.choices) || !Array.isArray(selection.extras)) invalid("Choose the garments to include in this order.");
  const byId = new Map(record.items.map((item) => [item.id, item]));
  if (Object.keys(selection.choices).length !== roots.length) invalid("Review every proposed garment before continuing.");
  const selected = roots.map((root) => {
    const chosen = byId.get(selection.choices[root.id]);
    if (!chosen || chosen.id !== root.id && chosen.alternativeForItemId !== root.id) invalid("A selected alternative does not belong to this garment.");
    return chosen.id;
  });
  for (const extra of selection.extras) {
    const item = byId.get(extra);
    if (!item || !item.alternativeForItemId && !record.items.some((option) => option.alternativeForItemId === item.id)) invalid("An extra garment is not an available option.");
    selected.push(extra);
  }
  if (new Set(selected).size !== selected.length || selected.length > record.items.length) invalid("A garment cannot be selected twice. Adjust its quantities instead.");
  return selected;
}
__name(preparedSelection, "preparedSelection");
function selectedPreparedRecord(record, selection) {
  const ids = new Set(preparedSelection(record, selection));
  return { ...record, items: record.items.filter((item) => ids.has(item.id)) };
}
__name(selectedPreparedRecord, "selectedPreparedRecord");
function primaryPreparedTemplate(template, record) {
  const ids = new Set(preparedSelection(record));
  const workspaces = template.workspaces.filter((workspace) => ids.has(workspace.id));
  return { ...template, workspaces, activeWorkspaceId: workspaces[0]?.id, activeHandle: workspaces[0]?.handle || null };
}
__name(primaryPreparedTemplate, "primaryPreparedTemplate");

// prepared-size-guides.mjs
var PREPARED_SIZE_GUIDES_QUERY = `query PreparedRecipientSizeGuides($ids:[ID!]!) { nodes(ids:$ids) { ... on Product { id
  guide:metafield(namespace:"custom",key:"garment_size_guide") { reference { ... on Metaobject { fields { key value } } } }
  chart:metafield(namespace:"custom",key:"size_chart") { reference { ... on Page { title body } } }
} } }`;
var cache = /* @__PURE__ */ new Map();
var clean = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim().slice(0, 180) : "", "clean");
function publicSizeGuide(product, now = Date.now()) {
  const fields = Object.fromEntries((product.guide?.reference?.fields || []).map((field) => [field.key, field.value]));
  if (fields.review_status === "approved" && fields.reviewed_by && fields.reviewed_at && (!fields.review_due || Date.parse(fields.review_due + "T23:59:59Z") >= now)) {
    try {
      const columns = JSON.parse(fields.columns), rows = JSON.parse(fields.rows);
      if (Array.isArray(columns) && columns.length && columns.length <= 20 && Array.isArray(rows) && rows.length && rows.length <= 12) {
        const result = {
          title: clean(fields.name) || "Size guide",
          unit: clean(fields.default_unit),
          fitSummary: clean(fields.fit_summary),
          columns: columns.map((col) => ({ key: clean(col.key), label: clean(col.label), shopify_labels: (col.shopify_labels || []).map(clean) })),
          rows: rows.map((row) => ({ label: clean(row.label), unit: clean(row.unit), tolerance: clean(row.tolerance), values: Object.fromEntries(columns.map((col) => [col.key, clean(row.values?.[col.key])])) }))
        };
        if (result.columns.every((col) => col.key && col.label) && result.rows.every((row) => row.label && result.columns.every((col) => row.values[col.key]))) return result;
      }
    } catch {
    }
  }
  const page = product.chart?.reference;
  return page?.body && page.body.length <= 1e5 ? { title: clean(page.title) || "Size guide", html: page.body } : null;
}
__name(publicSizeGuide, "publicSizeGuide");
async function recipientSizeGuides(env, deps, record) {
  const ids = [...new Set(record.items.map((item) => item.productId))], missing = ids.filter((id2) => !cache.has(id2) || cache.get(id2).expires < Date.now());
  if (missing.length) {
    try {
      const result = await deps.graphql(env, PREPARED_SIZE_GUIDES_QUERY, { ids: missing }, "PreparedRecipientSizeGuides");
      for (const product of result?.data?.nodes || []) if (product?.id) {
        if (cache.size > 500) cache.clear();
        cache.set(product.id, { guide: publicSizeGuide(product), expires: Date.now() + 3e5 });
      }
    } catch {
    }
  }
  return { guides: Object.fromEntries(record.items.flatMap((item) => {
    const saved = cache.get(item.productId), guide = saved?.expires >= Date.now() ? saved.guide : null;
    return guide ? [[item.id, guide]] : [];
  })) };
}
__name(recipientSizeGuides, "recipientSizeGuides");

// prepared-colors.mjs
var fail5 = /* @__PURE__ */ __name((message, code = "COLOR_UNAVAILABLE") => {
  throw Object.assign(new Error(message), { code, status: 409 });
}, "fail");
var colorOption = /* @__PURE__ */ __name((option) => /^colou?r$/i.test(option.name), "colorOption");
var sizeOption = /* @__PURE__ */ __name((option) => /^size$/i.test(option.name), "sizeOption");
var colorOf = /* @__PURE__ */ __name((variant) => variant.selectedOptions.find(colorOption)?.value || "", "colorOf");
var key = /* @__PURE__ */ __name((value) => String(value || "").trim().toLowerCase(), "key");
async function preparedColorOptions(record, itemId, service) {
  const item = record.items.find((item2) => item2.id === itemId);
  if (!item?.project?.prints?.length) fail5("This supplied mockup needs Print-MO\u2019s help to change color.");
  const product = await service.product(item.productId);
  const reference = product.variants.find((variant) => variant.id === item.variantId);
  if (!reference) fail5("This garment configuration changed. Contact Print-MO.");
  const fixed = reference.selectedOptions.filter((option) => !colorOption(option) && !sizeOption(option));
  const hidden = new Set((product.config?.hiddenColors || []).map(key));
  const variants = product.variants.filter((variant) => fixed.every((option) => variant.selectedOptions.some((value) => value.name === option.name && value.value === option.value)));
  const names = [...new Set(variants.map(colorOf).filter((name) => name && !hidden.has(key(name))))];
  return { itemId, config: product.config, colors: names.map((name) => {
    const swatch = product.swatches?.[name] || {}, configured = product.config?.colors?.find((value) => value.name === name);
    const tintHex = swatch.color || configured?.tintHex || "";
    return {
      name,
      tintHex,
      families: colorFamilies(name, tintHex),
      swatchImage: swatch.image || configured?.swatchImage,
      variants: variants.filter((variant) => colorOf(variant) === name).map((variant) => ({
        id: Number(variant.id.split("/").pop()),
        color: name,
        size: variant.selectedOptions.find(sizeOption)?.value || "",
        priceCents: Math.round(Number(variant.price) * 100),
        available: variant.availableForSale === true,
        image: variant.image?.url || ""
      }))
    };
  }) };
}
__name(preparedColorOptions, "preparedColorOptions");
async function recipientConfigurations(record, input, service) {
  if (input === void 0) return record;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > record.items.length) fail5("The garment colors could not be verified.");
  const next = structuredClone(record);
  for (const [id2, variantId] of Object.entries(input)) {
    const item = next.items.find((item2) => item2.id === id2);
    const options = await preparedColorOptions(record, id2, service);
    const color = options.colors.find((color2) => color2.variants.some((variant2) => "gid://shopify/ProductVariant/" + variant2.id === variantId && variant2.available));
    if (!item || !color) fail5("This color is no longer available. Choose another color.");
    item.variantId = variantId;
    item.color = color.name;
    item.recipientConfiguration = true;
    const product = await service.product(item.productId), variant = product.variants.find((variant2) => variant2.id === variantId);
    item.optionLabel = variant.selectedOptions.filter((option) => !sizeOption(option)).map((option) => option.value).join(" \xB7 ");
    item.swatch = { color: color.tintHex, image: color.swatchImage || "" };
  }
  return next;
}
__name(recipientConfigurations, "recipientConfigurations");

// prepared-order-discounts.mjs
var PREPARED_BULK_POLICY = "prepared-bulk-v1";
var PREPARED_BULK_COLLECTION = "gid://shopify/Collection/482306556152";
var PREPARED_BULK_COMMERCE = `query PreparedBulkCommerce($ids: [ID!]!) {
  shop { currencyCode }
  nodes(ids: $ids) { ... on ProductVariant { id price product { bulkEligible: inCollection(id: "${PREPARED_BULK_COLLECTION}") } } }
}`;
var PREPARED_BULK_CALCULATE = `mutation PreparedBulkCalculate($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    calculatedDraftOrder {
      subtotalPriceSet { presentmentMoney { amount currencyCode } }
      totalDiscountsSet { presentmentMoney { amount currencyCode } }
      platformDiscounts { title }
      lineItems { uuid quantity originalTotalSet { presentmentMoney { amount currencyCode } } discountedTotalSet { presentmentMoney { amount currencyCode } } }
    }
    userErrors { field message }
  }
}`;
var fail6 = /* @__PURE__ */ __name((code, message, status = 502) => {
  throw Object.assign(new Error(message), { code, status });
}, "fail");
var attribute = /* @__PURE__ */ __name((line, key2) => line.customAttributes?.find((value) => value.key === key2)?.value, "attribute");
var preparedBulkRate = /* @__PURE__ */ __name((quantity) => quantity >= 72 ? 0.2 : quantity >= 48 ? 0.15 : quantity >= 24 ? 0.1 : quantity >= 12 ? 0.05 : 0, "preparedBulkRate");
function preparedMoneyCents(amount) {
  if (typeof amount !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(amount)) fail6("PRICE_UNAVAILABLE", "Current prices could not be verified. Refresh the order price.");
  const [whole, fraction = ""] = amount.split("."), cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) fail6("PRICE_UNAVAILABLE", "Current prices could not be verified. Refresh the order price.");
  return cents;
}
__name(preparedMoneyCents, "preparedMoneyCents");
var money = /* @__PURE__ */ __name((value) => {
  if (value?.presentmentMoney?.currencyCode !== "USD") fail6("CURRENCY_UNSUPPORTED", "This prepared checkout must be priced in US dollars. Contact Print-MO.");
  return preparedMoneyCents(value.presentmentMoney.amount);
}, "money");
function verifyPreparedBulkTotals(draft, pricing) {
  if (money(draft?.subtotalPriceSet) !== pricing.checkoutSubtotalCents || money(draft?.totalDiscountsSet) !== pricing.discountCents)
    fail6("CHECKOUT_PRICE_CHANGED", "Shopify returned a different checkout price. Contact Print-MO before purchasing.", 409);
}
__name(verifyPreparedBulkTotals, "verifyPreparedBulkTotals");
var data = /* @__PURE__ */ __name((result) => {
  if (result?.ok === false || result?.errors?.length || !result?.data) fail6("PRICE_UNAVAILABLE", "Shopify could not verify the order price. Retry the order price.");
  return result.data;
}, "data");
async function calculatePreparedBulk(env, deps, lines, items) {
  const pricing = { policyVersion: PREPARED_BULK_POLICY, currencyCode: "USD", eligibleQuantity: 0, rate: 0, subtotalCents: 0, discountCents: 0, checkoutSubtotalCents: 0 };
  const input = { presentmentCurrencyCode: "USD", acceptAutomaticDiscounts: false, allowDiscountCodesInCheckout: false, discountCodes: [], lineItems: [] };
  if (!lines.length) return { pricing, input };
  const ids = [...new Set(lines.map((line) => line.variantId))];
  const commerce = data(await deps.graphql(env, PREPARED_BULK_COMMERCE, { ids }, "PreparedBulkCommerce"));
  if (commerce.shop?.currencyCode !== "USD") fail6("CURRENCY_UNSUPPORTED", "This prepared checkout must be priced in US dollars. Contact Print-MO.");
  const variants = new Map((commerce.nodes || []).filter(Boolean).map((variant) => [variant.id, variant]));
  const eligibleBatches = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const variant = variants.get(line.variantId);
    if (!variant || typeof variant.product?.bulkEligible !== "boolean") fail6("PRICE_UNAVAILABLE", "A selected product could not be verified. Refresh the order price.");
    if (attribute(line, "_batch_role") === "garment" && variant.product.bulkEligible) {
      pricing.eligibleQuantity += line.quantity;
      eligibleBatches.add(attribute(line, "_batch_id"));
    }
  }
  pricing.rate = preparedBulkRate(pricing.eligibleQuantity);
  input.lineItems = lines.map((line, index2) => {
    const item = items.find((value) => value.id === attribute(line, "_preparedItemId"));
    const expected = attribute(line, "_batch_role") === "garment" ? item?.variants.find((value) => value.id === line.variantId)?.priceCents : item?.prints.find((value) => "gid://shopify/ProductVariant/" + value.variantId === line.variantId)?.priceCents;
    const unitCents = preparedMoneyCents(variants.get(line.variantId).price);
    if (unitCents !== expected) fail6("PRICE_CHANGED", "A price changed while checking this order. Refresh the order price.", 409);
    pricing.subtotalCents += unitCents * line.quantity;
    const discounted = pricing.rate > 0 && eligibleBatches.has(attribute(line, "_batch_id"));
    return {
      ...line,
      uuid: `00000000-0000-4000-8000-${String(index2 + 1).padStart(12, "0")}`,
      // Lock the server-verified base price across calculation, creation and checkout.
      priceOverride: { amount: (unitCents / 100).toFixed(2), currencyCode: "USD" },
      ...discounted ? { appliedDiscount: { title: `Bulk discount (${pricing.rate * 100}% off)`, valueType: "PERCENTAGE", value: pricing.rate * 100 } } : {}
    };
  });
  const result = data(await deps.graphql(env, PREPARED_BULK_CALCULATE, { input }, "PreparedBulkCalculate")).draftOrderCalculate;
  if (result?.userErrors?.length || !result?.calculatedDraftOrder) fail6("PRICE_UNAVAILABLE", "Shopify could not calculate this order. Retry the order price.");
  const calculated = result.calculatedDraftOrder;
  if (calculated.platformDiscounts?.length || calculated.lineItems?.length !== input.lineItems.length) fail6("PRICE_UNAVAILABLE", "The checkout calculation changed. Retry the order price.");
  const calculatedLines = new Map(calculated.lineItems.map((line) => [line.uuid, line]));
  let gross = 0, net = 0;
  for (const line of input.lineItems) {
    const actual = calculatedLines.get(line.uuid);
    const expected = preparedMoneyCents(line.priceOverride.amount) * line.quantity;
    if (!actual || actual.quantity !== line.quantity || money(actual.originalTotalSet) !== expected) fail6("PRICE_CHANGED", "The checkout calculation changed. Refresh the order price.", 409);
    const discounted = money(actual.discountedTotalSet);
    if (discounted > expected || !line.appliedDiscount && discounted !== expected) fail6("PRICE_UNAVAILABLE", "The checkout calculation changed. Retry the order price.");
    gross += expected;
    net += discounted;
  }
  pricing.discountCents = money(calculated.totalDiscountsSet);
  pricing.checkoutSubtotalCents = money(calculated.subtotalPriceSet);
  if (gross !== pricing.subtotalCents || net !== pricing.checkoutSubtotalCents || gross - net !== pricing.discountCents) fail6("PRICE_UNAVAILABLE", "The checkout totals could not be verified. Retry the order price.");
  return { pricing, input };
}
__name(calculatePreparedBulk, "calculatePreparedBulk");

// prepared-order-links.mjs
var UPSTREAM = "https://designer-preview-upload.printmobusiness.workers.dev";
var customerUrl = /* @__PURE__ */ __name((_env, id2) => "https://print-mo.com/pages/designer-studio?preparedOrder=" + id2, "customerUrl");
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var HASH = /^[a-f0-9]{64}$/;
var attempts = /* @__PURE__ */ new Map();
var quoteFlights = /* @__PURE__ */ new Map();
var ROOT = /* @__PURE__ */ __name((env) => `admin-prepared-orders/v1/${encodeURIComponent(env.SHOPIFY_SHOP_DOMAIN.toLowerCase())}/`, "ROOT");
var fail7 = /* @__PURE__ */ __name((code, message, status = 400) => {
  throw Object.assign(new Error(message), { code, status });
}, "fail");
var hash = /* @__PURE__ */ __name(async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join(""), "hash");
var checked2 = /* @__PURE__ */ __name((result) => {
  if (result?.ok !== false && result?.data && !result.errors?.length) return result.data;
  if (result?.errors?.some((error) => error.extensions?.code === "ACCESS_DENIED")) fail7("CHECKOUT_ACCESS_REQUIRED", "Shopify needs draft checkout permission. Reopen Order Manager in Shopify and approve the updated app permissions, then retry.", 403);
  fail7("SHOPIFY_UNAVAILABLE", "Shopify could not finish this action. Your order is still here; retry.", 502);
}, "checked");
var PREPARED_SCOPE_QUERY = "query PreparedCheckoutScopes { currentAppInstallation { accessScopes { handle } } }";
var PREPARED_PRICE_QUERY = "query PreparedCheckoutPrices($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price product { handle } } } }";
var PREPARED_CHECKOUT_TOTALS = "subtotalPriceSet { presentmentMoney { amount currencyCode } } totalDiscountsSet { presentmentMoney { amount currencyCode } }";
var PREPARED_CHECKOUT_CREATE = `mutation PreparedCheckoutCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id invoiceUrl ${PREPARED_CHECKOUT_TOTALS} } userErrors { field message } } }`;
var PREPARED_CHECKOUT_RECOVER = `query PreparedCheckoutRecover($query: String!) { draftOrders(first: 1, query: $query) { nodes { id invoiceUrl status ${PREPARED_CHECKOUT_TOTALS} } } }`;
async function requireCheckoutAccess(env, deps) {
  const data2 = checked2(await deps.graphql(env, PREPARED_SCOPE_QUERY, {}, "PreparedCheckoutScopes"));
  if (!data2.currentAppInstallation.accessScopes.some((scope) => scope.handle === "write_draft_orders")) fail7("CHECKOUT_ACCESS_REQUIRED", "Shopify needs draft checkout permission. Reopen Order Manager in Shopify and approve the updated app permissions, then retry.", 403);
}
__name(requireCheckoutAccess, "requireCheckoutAccess");
async function remote(env, path, { method = "GET", body, mime = "application/json", staff = false } = {}) {
  if (staff && !env.PREPARED_ORDER_ADMIN_TOKEN) fail7("PUBLISH_NOT_CONFIGURED", "Customer links are not configured yet. Ask the app owner to finish setup.", 503);
  const transport = env.PREPARED_ORDER_SERVICE ? env.PREPARED_ORDER_SERVICE.fetch.bind(env.PREPARED_ORDER_SERVICE) : fetch;
  const response = await transport(UPSTREAM + "/api/prepared-orders" + path, { method, headers: { Origin: "https://print-mo.com", "Content-Type": mime, ...staff ? { "X-PM-Admin-Token": env.PREPARED_ORDER_ADMIN_TOKEN } : {} }, body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) fail7("PREPARED_LINK_UNAVAILABLE", [404, 410].includes(response.status) ? "This order link is unavailable or has expired. Contact Print-MO for a new link." : "The order link could not be updated or opened. Try again.", response.status);
  return result;
}
__name(remote, "remote");
async function readJson(bucket, key2) {
  const stored = await bucket.get(key2);
  return stored ? { value: await stored.json(), etag: stored.etag } : null;
}
__name(readJson, "readJson");
async function writeJson(bucket, key2, value, onlyIf) {
  return bucket.put(key2, JSON.stringify(value), { httpMetadata: { contentType: "application/json" }, ...onlyIf ? { onlyIf } : {} });
}
__name(writeJson, "writeJson");
var mappingKey = /* @__PURE__ */ __name((env, id2) => ROOT(env) + "links/" + id2 + ".json", "mappingKey");
async function deletePreparedPreparation(env, service, id2, body, actor) {
  if (!UUID.test(id2)) fail7("INVALID_ID", "Choose a saved prepared order.");
  const key2 = mappingKey(env, id2), existing = await readJson(env.R2_BUCKET, key2);
  if (existing?.value?.publishingAt && Date.now() - Date.parse(existing.value.publishingAt) < 12e4)
    fail7("PUBLISH_PENDING", "This customer link is being updated. Wait a moment before deleting.", 409);
  const lease = await writeJson(
    env.R2_BUCKET,
    key2,
    { ...existing?.value || {}, publishingAt: (/* @__PURE__ */ new Date()).toISOString() },
    existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: "*" }
  );
  if (!lease) fail7("PUBLISH_PENDING", "This link changed. Refresh before deleting.", 409);
  let revoked = false;
  try {
    return await service.remove(id2, body, actor, async () => {
      if (existing?.value?.link) {
        try {
          await remote(env, "/" + existing.value.link.id + "/revoke", { method: "POST", body: "{}", staff: true });
        } catch (error) {
          if (![404, 410].includes(error.status)) throw error;
        }
      }
      revoked = true;
    });
  } finally {
    const value = { ...existing?.value || {} };
    delete value.publishingAt;
    if (revoked && value.link) value.link = { ...value.link, status: "revoked" };
    const released = await writeJson(env.R2_BUCKET, key2, value, { etagMatches: lease.etag });
    if (!released) fail7("VERSION_CONFLICT", "The link state changed. Refresh the list to check this deletion.", 409);
  }
}
__name(deletePreparedPreparation, "deletePreparedPreparation");
async function currentLink(env, mapping) {
  if (!mapping?.link) return null;
  try {
    const { preparedOrder } = await remote(env, "/" + mapping.link.id, { staff: true });
    return { ...mapping.link, url: customerUrl(env, mapping.link.id), status: preparedOrder.status, expiresAt: preparedOrder.expiresAt };
  } catch (error) {
    if ([404, 410].includes(error.status)) return { ...mapping.link, status: "revoked" };
    throw error;
  }
}
__name(currentLink, "currentLink");
function physicalWidths(project, field) {
  return Object.fromEntries(["front", "back", "breast", "left", "right"].map((side) => [side, project?.canvasCalibration?.bySide?.[side]?.[field] || 12]));
}
__name(physicalWidths, "physicalWidths");
function resolveItemPrints(item, product) {
  const mode = item.printMode || (item.project?.prints?.length ? "auto" : "");
  if (!mode) fail7("PRINTING_REQUIRED", `Choose printing or \u201CNo printing\u201D for ${item.title} before creating its link.`);
  if (mode === "none") return [];
  if (mode === "manual") {
    if (!item.manualPrints?.length) fail7("PRINTING_REQUIRED", `Choose at least one print for ${item.title}, or select \u201CNo printing\u201D.`);
    const used = /* @__PURE__ */ new Set();
    return item.manualPrints.map((value) => {
      const choice = printClassChoices(product.config, value.side).find((c) => c.variantId === value.variantId);
      if (!choice || used.has(value.side)) fail7("PRINTING_CHANGED", `Check the print setup for ${item.title}.`);
      used.add(value.side);
      return { ...choice, side: value.side, mode: "manual" };
    });
  }
  if (!item.project?.prints?.length) fail7("PRINTING_REQUIRED", `Add artwork or choose a manual print setup for ${item.title}.`);
  const decisions = derivePrintPricingForDesign({ prints: item.project.prints, placements: product.config.placements, safeAreaWidthInBySide: physicalWidths(item.project, "safeWidthIn"), canvasReferenceWidthInBySide: physicalWidths(item.project, "referenceWidthIn") });
  const classes = resolvePrintClasses(product.config, decisions, item.project.printClassOverrides || {});
  if (!classes.length) fail7("PRINTING_REQUIRED", `Check the artwork size or choose a manual print setup for ${item.title}.`);
  const charged = new Set(classes.map((value) => value.side === "breast" ? "front" : value.side));
  if (item.project.prints.some((print) => !charged.has(print.side === "breast" ? "front" : print.side))) fail7("PRINTING_REQUIRED", `A designed print location on ${item.title} has no print charge. Check its artwork or choose a manual print setup.`);
  return classes;
}
__name(resolveItemPrints, "resolveItemPrints");
function variantChoices(item, product) {
  const reference = product.variants.find((variant) => variant.id === item.variantId);
  if (!reference) fail7("PRODUCT_CHANGED", `${item.title} has changed in Shopify. Choose its garment and color again.`);
  const options = reference.selectedOptions.filter((option) => !/^size$/i.test(option.name));
  return product.variants.filter((variant) => options.every((option) => variant.selectedOptions.some((value) => value.name === option.name && value.value === option.value))).map((variant) => ({ id: variant.id, size: variant.selectedOptions.find((option) => /^size$/i.test(option.name))?.value || "One size", priceCents: Math.round(Number(variant.price) * 100), ...item.recipientConfiguration && typeof variant.availableForSale === "boolean" ? { available: variant.availableForSale } : {} }));
}
__name(variantChoices, "variantChoices");
async function enrich(env, deps, service, record, snapshotItems, preloadedProducts = /* @__PURE__ */ new Map()) {
  if (!record.items.length) fail7("ITEMS_REQUIRED", "Add a garment before creating a customer link.");
  const missingRecord = { ...record, items: record.items.filter((item) => !preloadedProducts.has(item.productId)) };
  const lean = snapshotItems && service.priceProducts && missingRecord.items.length ? await service.priceProducts(missingRecord, snapshotItems) : /* @__PURE__ */ new Map();
  const products = new Map([...lean, ...preloadedProducts]), items = [];
  await mapConcurrent([...new Set(record.items.map((item) => item.productId))].filter((id2) => !products.has(id2)), 3, async (id2) => products.set(id2, await service.product(id2)));
  for (const item of record.items) {
    if (!products.has(item.productId)) products.set(item.productId, await service.product(item.productId));
    const product = products.get(item.productId);
    const dimensions = (item.project?.prints || []).map((print) => {
      const bounds = placementInkBounds(print), side = item.project.canvasCalibration?.bySide?.[print.side], scale = side ? side.referenceWidthIn / side.safeWidthIn : 1;
      return `${print.side}: ${(bounds.w * scale).toFixed(2)} x ${(bounds.h * scale).toFixed(2)} in, ${print.design.rotation} degrees`;
    }).join("; ");
    items.push({ id: item.id, title: product.title, color: item.optionLabel || item.color || item.variantTitle, variants: variantChoices(item, product), prints: resolveItemPrints(item, product), dimensions, instructions: item.instructions || "", image: product.image || "" });
  }
  const ids = [...new Set(items.flatMap((item) => item.prints.map((print) => "gid://shopify/ProductVariant/" + print.variantId)))];
  const prices = /* @__PURE__ */ new Map(), handles = /* @__PURE__ */ new Map();
  if (ids.length) {
    const data2 = checked2(await deps.graphql(env, PREPARED_PRICE_QUERY, { ids }, "PreparedCheckoutPrices"));
    for (const value of data2.nodes || []) if (value?.id) {
      prices.set(value.id, Math.round(Number(value.price) * 100));
      handles.set(value.id, value.product?.handle || "");
    }
  }
  for (const item of items) {
    item.cartHandle = products.get(record.items.find((source) => source.id === item.id).productId)?.handle || "";
    for (const print of item.prints) {
      print.priceCents = prices.get("gid://shopify/ProductVariant/" + print.variantId);
      print.cartHandle = handles.get("gid://shopify/ProductVariant/" + print.variantId) || "";
      if (!Number.isSafeInteger(print.priceCents) || print.priceCents < 0) fail7("PRINT_UNAVAILABLE", `A print option on ${item.title} is unavailable. Check its printing setup.`);
    }
    if (item.variants.some((variant) => !Number.isSafeInteger(variant.priceCents) || variant.priceCents < 0)) fail7("PRICE_UNAVAILABLE", `The price for ${item.title} could not load.`);
  }
  return items;
}
__name(enrich, "enrich");
async function preparedPrintChoices(service, productId) {
  const product = await service.product(productId);
  return Object.fromEntries(["front", "back", "left", "right"].map((side) => [side, printClassChoices(product.config, side)]));
}
__name(preparedPrintChoices, "preparedPrintChoices");
async function publishedOrder(env, id2) {
  if (!UUID.test(id2)) fail7("LINK_UNAVAILABLE", "This order link is invalid.", 404);
  const result = await remote(env, "/public/" + id2);
  const order = result.preparedOrder;
  const purchase = order?.template?.purchase;
  if (!order || purchase?.kind !== "order_manager_prepared" || !HASH.test(purchase.snapshotId || "")) fail7("LINK_UNAVAILABLE", "This order link is unavailable.", 404);
  const stored = await readJson(env.R2_BUCKET, ROOT(env) + "published/" + id2 + "/" + purchase.snapshotId + ".json");
  if (!stored) fail7("LINK_UNAVAILABLE", "This order link is unavailable. Contact Print-MO.", 410);
  return { order, purchase, snapshot: stored.value };
}
__name(publishedOrder, "publishedOrder");
async function handlePreparedLinkRequest(request, env, deps, service, id2, action, onProgress = () => {
}) {
  if (!UUID.test(id2)) fail7("INVALID_ID", "Choose a saved prepared order.");
  const key2 = mappingKey(env, id2), existing = await readJson(env.R2_BUCKET, key2);
  if (action === "link" && request.method === "GET") return { link: await currentLink(env, existing?.value) };
  if (action === "print-choices" && request.method === "GET") return { choices: await preparedPrintChoices(service, new URL(request.url).searchParams.get("productId")) };
  if (action === "revoke" && request.method === "POST") {
    if (existing?.value?.link) {
      await remote(env, "/" + existing.value.link.id + "/revoke", { method: "POST", body: "{}", staff: true });
      await writeJson(env.R2_BUCKET, key2, { ...existing.value, link: { ...existing.value.link, status: "revoked" } });
    }
    return { revoked: true };
  }
  if (action !== "publish" || request.method !== "POST") fail7("NOT_FOUND", "This customer-link action is unavailable.", 404);
  const body = await request.json(), record = await service.read(id2);
  if (record.revision !== body.expectedRevision) fail7("VERSION_CONFLICT", "This order changed. Wait for saving to finish, then create the link again.", 409);
  const started = Date.now();
  onProgress({ stage: "checking" });
  const activeLink = await currentLink(env, existing?.value);
  if (!body.refresh && existing?.value?.sourceRevision === record.revision && activeLink?.status === "active" && Date.parse(activeLink.expiresAt) > Date.now()) return { link: activeLink, publication: { unchanged: true, uploadedAssets: 0, reusedAssets: 0, durationMs: Date.now() - started } };
  await requireCheckoutAccess(env, deps);
  if (existing?.value?.publishingAt && Date.now() - Date.parse(existing.value.publishingAt) < 12e4) fail7("PUBLISH_PENDING", "This link is already being created. Wait a moment, then retry.", 409);
  const lease = await writeJson(env.R2_BUCKET, key2, { ...existing?.value || {}, publishingAt: (/* @__PURE__ */ new Date()).toISOString() }, existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: "*" });
  if (!lease) fail7("PUBLISH_PENDING", "This link is already being created. Retry in a moment.", 409);
  let link = activeLink;
  const assetUrls = /* @__PURE__ */ new Map();
  let uploadedAssets = 0, reusedAssets = 0;
  try {
    onProgress({ stage: "products" });
    const products = /* @__PURE__ */ new Map(), publishingService = { ...service, product: /* @__PURE__ */ __name((productId) => {
      if (!products.has(productId)) products.set(productId, Promise.resolve().then(() => service.product(productId)));
      return products.get(productId);
    }, "product") };
    const items = await enrich(env, deps, publishingService, record), snapshotId = await hash(JSON.stringify({ record, items }));
    if (link?.status === "active" && Date.parse(link.expiresAt) > Date.now() && existing?.value.snapshotId === snapshotId) {
      const saved2 = await writeJson(env.R2_BUCKET, key2, { ...existing.value, link }, { etagMatches: lease.etag });
      if (!saved2) fail7("PUBLISH_CHANGED", "This link changed while publishing. Reopen the order before retrying.", 409);
      return { link, publication: { unchanged: true, uploadedAssets: 0, reusedAssets: 0, durationMs: Date.now() - started } };
    }
    if (!link || link.status !== "active" || Date.parse(link.expiresAt) <= Date.now()) link = await remote(env, "", { method: "POST", body: JSON.stringify({ uploadDraft: true, title: record.title.slice(0, 120), preparedFor: record.preparedFor, customerMessage: record.customerMessage || "", expiresInDays: 30, productHandles: record.items.map((item) => item.handle) }), staff: true });
    const required = /* @__PURE__ */ new Map();
    for (const mockup of record.mockups) required.set(mockup.assetId, mockup.mime);
    for (const item of record.items) {
      if (item.proofAssetId) required.set(item.proofAssetId, "image/png");
      for (const print of item.project?.prints || []) required.set(print.asset.assetId, print.asset.mime);
    }
    if (required.size > 64) fail7("TOO_MANY_ASSETS", "Use up to 64 artwork images and mockups in one customer order.");
    const savedAssets = existing?.value.assetLinkId === link.id ? existing.value.assets || {} : {};
    const ownedPrefix = UPSTREAM + "/api/prepared-orders/public/" + link.id + "/assets/";
    for (const [assetId2, mime] of required) {
      const saved2 = savedAssets[assetId2];
      if (saved2?.mime === mime && saved2.url?.startsWith(ownedPrefix) && HASH.test(saved2.url.slice(ownedPrefix.length))) {
        assetUrls.set(assetId2, saved2);
        reusedAssets++;
      }
    }
    const total = required.size;
    const reportAssets = /* @__PURE__ */ __name(() => onProgress({ stage: "assets", completed: reusedAssets + uploadedAssets, total, reused: reusedAssets }), "reportAssets");
    reportAssets();
    const edit = link.status === "active" ? remote(env, "/" + link.id + "/edit", { staff: true }).then((value) => ({ value }), (error) => ({ error })) : null;
    await mapConcurrent([...required].filter(([assetId2]) => !assetUrls.has(assetId2)), 2, async ([assetId2, mime]) => {
      const stored = await service.asset(id2, assetId2), bytes = await stored.arrayBuffer();
      const digest2 = await crypto.subtle.digest("SHA-256", bytes), sha = [...new Uint8Array(digest2)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const result2 = await remote(env, "/" + link.id + "/assets/" + sha, { method: "POST", body: bytes, mime, staff: true });
      if (result2.url !== ownedPrefix + sha) fail7("UPLOAD_UNVERIFIED", "An artwork copy could not be verified.", 502);
      assetUrls.set(assetId2, { url: result2.url, mime });
      uploadedAssets++;
      reportAssets();
    });
    const copyAsset = /* @__PURE__ */ __name((assetId2) => assetUrls.get(assetId2).url, "copyAsset");
    const workspaces = [];
    for (const [index2, item] of record.items.entries()) {
      const sourceMockups = record.mockups.filter((mockup) => mockup.itemIds?.includes(item.id));
      const images = [];
      for (const mockup of sourceMockups) images.push(await copyAsset(mockup.assetId, mockup.mime));
      if (item.proofAssetId) images.push(await copyAsset(item.proofAssetId, "image/png"));
      items[index2].images = images.length ? images : item.image ? [item.image] : [];
      const prints = [];
      for (const print of item.project?.prints || []) prints.push({ ...print, asset: { ...print.asset, url: await copyAsset(print.asset.assetId, print.asset.mime) } });
      workspaces.push({ id: item.id, handle: item.handle, design: { prints } });
    }
    const referenceImages = [];
    for (const mockup of record.mockups.filter((value) => !value.itemIds?.length)) referenceImages.push(await copyAsset(mockup.assetId, mockup.mime));
    const fullTemplate = await recipientTemplate(record, items, publishingService, { workspaces });
    const choices = record.items.filter((item) => !item.alternativeForItemId && record.items.some((option) => option.alternativeForItemId === item.id)).map((root) => ({ rootId: root.id, options: fullTemplate.workspaces.filter((workspace) => workspace.id === root.id || record.items.find((item) => item.id === workspace.id)?.alternativeForItemId === root.id) }));
    await writeJson(env.R2_BUCKET, ROOT(env) + "published/" + link.id + "/" + snapshotId + ".json", { record, items, referenceImages, choices });
    const template = { ...primaryPreparedTemplate(fullTemplate, record), purchase: { kind: "order_manager_prepared", snapshotId } };
    const presentation = { title: record.title.slice(0, 120), preparedFor: record.preparedFor, customerMessage: record.customerMessage || "", expiresInDays: 30, productHandles: record.items.map((item) => item.handle), template };
    let result;
    onProgress({ stage: "publishing" });
    if (link.status === "uploading") result = await remote(env, "/" + link.id + "/finalize", { method: "POST", body: JSON.stringify(presentation), staff: true });
    else {
      const ready = await edit;
      if (ready.error) throw ready.error;
      result = await remote(env, "/" + link.id + "/revise", { method: "POST", body: JSON.stringify({ ...presentation, expectedRevision: ready.value.revision }), staff: true });
    }
    const publicLink = { ...result, id: link.id, status: "active", sourceRevision: record.revision, url: customerUrl(env, link.id) };
    const saved = await writeJson(env.R2_BUCKET, key2, { sourceRevision: record.revision, snapshotId, assetLinkId: link.id, assets: { ...savedAssets, ...Object.fromEntries(assetUrls) }, link: publicLink }, { etagMatches: lease.etag });
    if (!saved) fail7("PUBLISH_CHANGED", "This link changed while publishing. Reopen the order before retrying.", 409);
    return { link: publicLink, publication: { unchanged: false, uploadedAssets, reusedAssets, durationMs: Date.now() - started } };
  } catch (error) {
    const recovered = existing?.value || {};
    if (link?.id === recovered.link?.id) {
      recovered.assetLinkId = link.id;
      recovered.assets = { ...recovered.assets || {}, ...Object.fromEntries(assetUrls) };
    }
    await writeJson(env.R2_BUCKET, key2, recovered, { etagMatches: lease.etag });
    throw error;
  }
}
__name(handlePreparedLinkRequest, "handlePreparedLinkRequest");
function buildPreparedCheckoutLines(items, selections, orderId, snapshotId, allowEmpty = false) {
  const lines = [], chosen = [];
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) fail7("QUANTITIES_REQUIRED", "Choose your sizes and quantities.");
  for (const key2 of Object.keys(selections)) if (!items.some((item) => item.id === key2)) fail7("ORDER_CHANGED", "The order changed. Reload this page before checkout.", 409);
  let total = 0;
  for (const item of items) {
    const values = selections[item.id] || {};
    if (typeof values !== "object" || Array.isArray(values)) fail7("INVALID_QUANTITY", "Enter whole-number quantities.");
    for (const [variantId, quantity] of Object.entries(values)) {
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) fail7("INVALID_QUANTITY", "Use whole-number quantities between 0 and 9999.");
      if (!quantity) continue;
      const variant = item.variants.find((value) => value.id === variantId);
      if (!variant || variant.available === false) fail7("VARIANT_UNAVAILABLE", "A selected size is unavailable. Reload the order and choose again.", 409);
      total += quantity;
      if (total > 1e4) fail7("QUANTITY_LIMIT", "Contact Print-MO for orders over 10,000 garments.");
      const batch = orderId + ":" + item.id + ":" + variantId.split("/").pop();
      const base = { group_id: orderId + ":" + item.id, batch_id: batch, _preparedOrderId: orderId, _preparedConfigId: snapshotId, _preparedItemId: item.id, method: "DTF", garment_color: item.color, garment_size: variant.size, product_title: item.title };
      const customerKeys = /* @__PURE__ */ new Set(["Printing", "Artwork placement", "Printing instructions"]);
      const attrs = /* @__PURE__ */ __name((values2) => Object.entries(values2).filter(([, value]) => value !== void 0 && value !== null && String(value) !== "").map(([key2, value]) => ({ key: key2.startsWith("_") || customerKeys.has(key2) ? key2 : "_" + key2, value: String(value).slice(0, 1e3) })), "attrs");
      lines.push({ variantId, quantity, customAttributes: attrs({ ...base, group_role: "garment", batch_role: "garment", Printing: item.prints.length ? item.prints.map((print) => print.label).join(", ") : "No printing", ...item.dimensions ? { "Artwork placement": item.dimensions } : {}, ...item.instructions ? { "Printing instructions": item.instructions } : {}, ...item.images?.[0] ? { design_preview_url: item.images[0] } : {} }) });
      for (const print of item.prints) lines.push({ variantId: "gid://shopify/ProductVariant/" + print.variantId, quantity, customAttributes: attrs({ ...base, group_role: "print", batch_role: "print", parent_id: variantId.split("/").pop(), side: print.side, Printing: print.label }) });
      chosen.push({ itemId: item.id, variantId, quantity });
    }
  }
  if (!total && !allowEmpty) fail7("QUANTITIES_REQUIRED", "Choose at least one size and quantity to continue.");
  if (lines.length > 200) fail7("ORDER_TOO_LARGE", "This order has too many size and print combinations. Contact Print-MO to split it.");
  return { lines, chosen, total };
}
__name(buildPreparedCheckoutLines, "buildPreparedCheckoutLines");
async function withOptionalPreparedPreviewDeadline(work, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => resolve(false), 5e3);
  });
  try {
    return await Promise.race([Promise.resolve().then(work).then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    if (timer !== void 0) clearTimer(timer);
  }
}
__name(withOptionalPreparedPreviewDeadline, "withOptionalPreparedPreviewDeadline");
async function transferProductionAssets(env, deps, service, snapshot, checkoutId, draftId, chosen, progress) {
  const detail = await deps.drafts.detail(draftId), roles = { front: "front", back: "back", breast: "left-chest", left: "left-sleeve", right: "right-sleeve" }, jobs = /* @__PURE__ */ new Map();
  for (const item of snapshot.record.items) {
    if (!chosen.some((value) => value.itemId === item.id)) continue;
    const lineIds = detail.items.filter((line) => line.customAttributes?.some((value) => value.key === "_preparedItemId" && value.value === item.id) && line.customAttributes?.some((value) => ["group_role", "_group_role"].includes(value.key) && value.value === "garment")).map((line) => line.id);
    if (!lineIds.length) fail7("PRODUCTION_ASSOCIATION_PENDING", "Your checkout is being prepared. Retry in a moment.", 503);
    const recipientFiles = (snapshot.recipientFiles || []).filter((file) => file.itemId === item.id);
    const edited = recipientFiles.filter((file) => file.role !== "mobile-preview");
    const files = [
      ...edited.map((file) => ({ assetId: "recipient-" + item.id + "-" + file.side, mime: file.mime || "image/svg+xml", svg: file.svg, base64: file.base64, role: file.svg ? "design" : "mockup", placement: roles[file.side] || "other" })),
      ...recipientFiles.filter((file) => file.role === "mobile-preview" && file.side === "front").map((file) => ({ assetId: "recipient-" + item.id + "-mobile-front", mime: file.mime, base64: file.base64, role: "mobile-preview", placement: "front" })),
      ...(!edited.length ? item.project?.prints || [] : []).map((print) => ({ assetId: print.asset.assetId, mime: print.asset.mime, role: ["image/png", "image/svg+xml"].includes(print.asset.mime) ? "design" : "mockup", placement: roles[print.side] || "other" })),
      ...item.proofAssetId && !edited.length ? [{ assetId: item.proofAssetId, mime: "image/png", role: "mockup", placement: roles[item.proofSide] || "other" }] : [],
      ...snapshot.record.mockups.filter((mockup) => !mockup.itemIds?.length || mockup.itemIds.includes(item.id)).map((mockup) => ({ ...mockup, role: "mockup", placement: "other" }))
    ];
    for (const file of files) {
      const key2 = file.assetId + file.role + file.placement;
      if (!jobs.has(key2)) jobs.set(key2, { ...file, lineIds: /* @__PURE__ */ new Set() });
      for (const lineId of lineIds) jobs.get(key2).lineIds.add(lineId);
    }
  }
  for (const [key2, file] of jobs) {
    const uploadId = "prep-" + await hash(checkoutId + key2);
    if (progress.completedUploads.includes(uploadId)) continue;
    try {
      const bytes = file.svg ? new TextEncoder().encode(file.svg) : file.base64 ? Uint8Array.from(atob(file.base64), (value) => value.charCodeAt(0)) : await (await service.asset(snapshot.record.id, file.assetId)).arrayBuffer(), extension = { "image/png": ".png", "image/svg+xml": ".svg", "image/jpeg": ".jpg", "image/webp": ".webp" }[file.mime];
      if (!extension) fail7("ARTWORK_FORMAT", "An artwork file format needs attention. Contact Print-MO.");
      const form = new FormData();
      form.set("role", file.role);
      form.set("placement", file.placement);
      form.set("lineItemIds", JSON.stringify([...file.lineIds]));
      form.set("uploadId", uploadId);
      form.set("file", new File([bytes], "prepared-" + file.assetId.slice(0, 32) + extension, { type: file.mime }));
      const request = new Request("https://internal/order-manager/v1/drafts/" + encodeURIComponent(draftId) + "/assets", { method: "POST", body: form });
      if (file.role === "mobile-preview") {
        if (await withOptionalPreparedPreviewDeadline(() => deps.drafts.handle(request, "prepared-checkout"))) progress.completedUploads.push(uploadId);
        continue;
      }
      await deps.drafts.handle(request, "prepared-checkout");
      progress.completedUploads.push(uploadId);
      await writeJson(env.R2_BUCKET, ROOT(env) + "checkouts/" + checkoutId + ".json", progress);
    } catch (error) {
      if (file.role !== "mobile-preview") throw error;
    }
  }
}
__name(transferProductionAssets, "transferProductionAssets");
async function recipientQuote(env, deps, service, document, body) {
  if (body.snapshotId !== document.purchase.snapshotId) fail7("ORDER_CHANGED", "Print-MO updated this order. Reload it before continuing.", 409);
  const selected = selectedPreparedRecord(document.snapshot.record, body.selection);
  if (body.configurations && env.PREPARED_RECIPIENT_COLORS_ENABLED !== "true") fail7("COLORS_UNAVAILABLE", "Color changes are not enabled on this order service.", 409);
  const colorProducts = /* @__PURE__ */ new Map(), configuredService = body.configurations ? { ...service, product: /* @__PURE__ */ __name((id2) => {
    if (!colorProducts.has(id2)) colorProducts.set(id2, service.product(id2));
    return colorProducts.get(id2);
  }, "product") } : service;
  const configured = await recipientConfigurations(selected, body.configurations, configuredService);
  const edited = recipientDesigns(configured, body.designs);
  const loadedProducts = new Map(await Promise.all([...colorProducts].map(async ([id2, job]) => [id2, await job])));
  const items = await enrich(env, deps, configuredService, edited.record, document.snapshot.items, loadedProducts);
  for (const item of items) {
    const saved = document.snapshot.items.find((value) => value.id === item.id);
    const changed = configured.items.find((value) => value.id === item.id)?.variantId !== selected.items.find((value) => value.id === item.id)?.variantId;
    item.images = changed ? [] : saved.images || [];
  }
  const chosen = body.quantities === void 0 ? null : buildPreparedCheckoutLines(items, body.quantities, document.order.id, body.snapshotId, true);
  const calculated = chosen ? await calculatePreparedBulk(env, deps, chosen.lines, items) : null;
  const quoteId = await hash(JSON.stringify({
    policyVersion: PREPARED_BULK_POLICY,
    snapshotId: body.snapshotId,
    designs: edited.designs,
    items,
    ...chosen ? { chosen: chosen.chosen, pricing: calculated.pricing } : {},
    ...body.selection ? { selection: body.selection } : {},
    ...body.configurations ? { configurations: body.configurations } : {}
  }));
  return { ...edited, items, quoteId, ...calculated ? { pricing: calculated.pricing, checkoutInput: calculated.input } : {} };
}
__name(recipientQuote, "recipientQuote");
async function checkout(request, env, deps, service, id2, document, isQuote = false) {
  if (Number(request.headers.get("Content-Length")) > 24 * 1024 * 1024) fail7("REQUEST_TOO_LARGE", "This order selection is too large.", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 24 * 1024 * 1024) fail7("REQUEST_TOO_LARGE", "This order selection is too large.", 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    fail7("INVALID_JSON", "Your quantities could not be read. Try again.");
  }
  if (body.snapshotId !== document.purchase.snapshotId) fail7("ORDER_CHANGED", "Print-MO updated this order. Reload it to review the changes before checkout.", 409);
  const selectedIds = new Set(preparedSelection(document.snapshot.record, body.selection));
  for (const [itemId, values] of Object.entries(body.quantities || {})) if (!selectedIds.has(itemId) && Object.values(values || {}).some((quantity) => Number(quantity) > 0)) fail7("INVALID_SELECTION", "An unselected option cannot be purchased. Review your order.");
  let quote = null;
  if (isQuote) {
    const key3 = await hash(JSON.stringify({ policyVersion: PREPARED_BULK_POLICY, shop: env.SHOPIFY_SHOP_DOMAIN, id: id2, snapshotId: body.snapshotId, designs: body.designs, quantities: body.quantities, selection: body.selection, ...body.configurations ? { configurations: body.configurations } : {} }));
    let job = quoteFlights.get(key3);
    if (!job) {
      job = recipientQuote(env, deps, service, document, body);
      if (quoteFlights.size < 100) quoteFlights.set(key3, job);
    }
    try {
      quote = await job;
    } finally {
      if (quoteFlights.get(key3) === job) quoteFlights.delete(key3);
    }
  } else quote = await recipientQuote(env, deps, service, document, body);
  if (isQuote) return { quoteId: quote.quoteId, items: quote.items, ...quote.pricing ? { pricing: quote.pricing } : {} };
  if (!UUID.test(body.sessionId || "")) fail7("INVALID_SESSION", "Reload this order, then try checkout again.");
  if (!quote.checkoutInput || body.quoteId !== quote.quoteId) fail7("PRICE_CHANGED", "The price, quantities or design changed. Refresh the order price and retry checkout.", 409);
  const chosen = buildPreparedCheckoutLines(quote?.items || document.snapshot.items.filter((item) => selectedIds.has(item.id)), body.quantities, id2, body.snapshotId);
  const files = recipientArtwork(document.snapshot.record, quote?.designs || {}, body.artwork, new Set(chosen.chosen.map((value) => value.itemId)), body.previews, body.frontPreviews);
  const checkoutId = await hash(JSON.stringify({ policyVersion: PREPARED_BULK_POLICY, id: id2, snapshotId: body.snapshotId, sessionId: body.sessionId, chosen: chosen.chosen, ...quote ? { quoteId: quote.quoteId, artworkHash: await hash(JSON.stringify(files)) } : {} })), key2 = ROOT(env) + "checkouts/" + checkoutId + ".json";
  const existing = await readJson(env.R2_BUCKET, key2);
  if (existing?.value.state === "ready" && existing.value.pricingVerified) return { checkoutUrl: existing.value.url };
  let progress = existing?.value;
  if (!progress?.draftId && progress?.state === "pending") {
    const recovered = checked2(await deps.graphql(env, PREPARED_CHECKOUT_RECOVER, { query: "tag:pm-prepared-" + checkoutId.slice(0, 40) }, "PreparedCheckoutRecover")).draftOrders.nodes[0];
    if (recovered) {
      if (recovered.status === "COMPLETED") fail7("CHECKOUT_COMPLETE", "This checkout has already been completed. Contact Print-MO if you need another order.", 409);
      verifyPreparedBulkTotals(recovered, quote.pricing);
      progress = { ...progress, draftId: recovered.id, url: recovered.invoiceUrl, completedUploads: [], state: "attaching", pricingVerified: true };
    } else if (Date.now() - Date.parse(progress.startedAt) < 12e4) fail7("CHECKOUT_PENDING", "Shopify is preparing your checkout. Retry in a moment.", 409);
  }
  if (!progress?.draftId) {
    await requireCheckoutAccess(env, deps);
    const lease = await writeJson(env.R2_BUCKET, key2, { state: "pending", startedAt: (/* @__PURE__ */ new Date()).toISOString() }, existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: "*" });
    if (!lease) fail7("CHECKOUT_PENDING", "Your checkout is already being prepared. Retry in a moment.", 409);
    const result = checked2(await deps.graphql(env, PREPARED_CHECKOUT_CREATE, { input: { ...quote.checkoutInput, tags: ["pm-prepared-checkout", "pm-prepared-" + checkoutId.slice(0, 40)], customAttributes: [{ key: "_preparedOrderId", value: id2 }, { key: "_preparedConfigId", value: body.snapshotId }, { key: "_preparedPricingPolicy", value: PREPARED_BULK_POLICY }] } }, "PreparedCheckoutCreate")).draftOrderCreate;
    if (result.userErrors?.length) {
      await writeJson(env.R2_BUCKET, key2, { state: "failed" });
      fail7("CHECKOUT_REJECTED", result.userErrors.map((error) => error.message).join(" ").slice(0, 500), 422);
    }
    if (!result.draftOrder?.invoiceUrl) fail7("CHECKOUT_PENDING", "Shopify has not returned the checkout yet. Retry in a moment.", 503);
    progress = { draftId: result.draftOrder.id, url: result.draftOrder.invoiceUrl, state: "attaching", completedUploads: [], pricingVerified: false };
    await writeJson(env.R2_BUCKET, key2, progress);
    verifyPreparedBulkTotals(result.draftOrder, quote.pricing);
    progress.pricingVerified = true;
    await writeJson(env.R2_BUCKET, key2, progress);
  }
  if (!progress.pricingVerified) {
    const recovered = checked2(await deps.graphql(env, PREPARED_CHECKOUT_RECOVER, { query: "tag:pm-prepared-" + checkoutId.slice(0, 40) }, "PreparedCheckoutRecover")).draftOrders.nodes[0];
    if (!recovered || recovered.id !== progress.draftId) fail7("CHECKOUT_PENDING", "Shopify is confirming your checkout. Retry in a moment.", 503);
    if (recovered.status === "COMPLETED") fail7("CHECKOUT_COMPLETE", "This checkout has already been completed. Contact Print-MO if you need another order.", 409);
    verifyPreparedBulkTotals(recovered, quote.pricing);
    progress.pricingVerified = true;
    await writeJson(env.R2_BUCKET, key2, progress);
  }
  if (quote) {
    progress.recipientDesigns = quote.designs;
    await writeJson(env.R2_BUCKET, key2, progress);
  }
  await transferProductionAssets(env, deps, service, { ...document.snapshot, recipientFiles: files }, checkoutId, progress.draftId, chosen.chosen, progress);
  const url = new URL(progress.url);
  if (url.protocol !== "https:" || !(url.hostname === "print-mo.com" || url.hostname === "www.print-mo.com" || url.hostname.endsWith(".myshopify.com") || url.hostname.endsWith(".shopify.com"))) fail7("CHECKOUT_UNAVAILABLE", "The checkout address could not be verified. Contact Print-MO.", 502);
  progress.state = "ready";
  await writeJson(env.R2_BUCKET, key2, progress);
  return { checkoutUrl: progress.url };
}
__name(checkout, "checkout");
async function handlePublicPreparedLinkRequest(request, env, deps, service) {
  const match = new URL(request.url).pathname.match(/^\/order-manager\/v1\/prepared-orders\/public\/([a-f0-9-]{36})(?:\/(checkout|quote|size-guides|colors))?$/i);
  if (!match) fail7("LINK_UNAVAILABLE", "This order link is unavailable.", 404);
  const document = await publishedOrder(env, match[1]);
  if (request.method === "GET" && match[2] === "colors") {
    if (env.PREPARED_RECIPIENT_COLORS_ENABLED !== "true") fail7("COLORS_UNAVAILABLE", "Color changes are not enabled on this order service.", 409);
    const params = new URL(request.url).searchParams;
    if (params.get("snapshotId") !== document.purchase.snapshotId) fail7("ORDER_CHANGED", "Print-MO updated this order. Reload before changing colors.", 409);
    return preparedColorOptions(document.snapshot.record, params.get("item"), service);
  }
  if (request.method === "GET" && match[2] === "size-guides") return recipientSizeGuides(env, deps, document.snapshot.record);
  if (request.method === "GET" && !match[2]) {
    const template = await recipientTemplate(selectedPreparedRecord(document.snapshot.record), document.snapshot.items, service, document.order.template, { preferPublished: true });
    return { order: { id: document.order.id, url: customerUrl(env, match[1]), reference: document.order.reference, title: document.snapshot.record.title, preparedFor: document.snapshot.record.preparedFor, customerMessage: document.snapshot.record.customerMessage, expiresAt: document.order.expiresAt, snapshotId: document.purchase.snapshotId, items: document.snapshot.items, choices: recipientChoicePresentations(document.snapshot.choices, document.snapshot.record, template), referenceImages: document.snapshot.referenceImages || [], template: { ...template, purchase: document.purchase } } };
  }
  if (request.method === "POST" && ["checkout", "quote"].includes(match[2])) {
    const key2 = (request.headers.get("CF-Connecting-IP") || "unknown") + ":" + match[1] + ":" + match[2], minute = Math.floor(Date.now() / 6e4), previous = attempts.get(key2), count = previous?.minute === minute ? previous.count + 1 : 1;
    if (attempts.size > 5e3) attempts.clear();
    attempts.set(key2, { minute, count });
    if (count > (match[2] === "quote" ? 60 : 12)) fail7("CHECKOUT_RATE_LIMIT", "Too many checkout attempts. Wait a minute, then retry.", 429);
    return checkout(request, env, deps, service, match[1], document, match[2] === "quote");
  }
  fail7("METHOD_NOT_ALLOWED", "This action is unavailable.", 405);
}
__name(handlePublicPreparedLinkRequest, "handlePublicPreparedLinkRequest");

// prepared-price-products.mjs
var PREPARED_RECIPIENT_COMMERCE_QUERY = `query PreparedRecipientCommerce($ids:[ID!]!) { nodes(ids:$ids) {
  ... on Product { id title handle status designerConfig:metafield(namespace:"custom",key:"designer_config") { value } }
  ... on ProductVariant { id price selectedOptions { name value } product { id status } }
} }`;
async function preparedPriceProducts(env, graphql, record, snapshotItems, normalizeConfig) {
  const products = /* @__PURE__ */ new Map(), variants = /* @__PURE__ */ new Map(), ids = [...new Set(record.items.flatMap((item) => [item.productId, item.variantId, ...(snapshotItems.find((value) => value.id === item.id)?.variants || []).map((value) => value.id)]))];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const response = await graphql(env, PREPARED_RECIPIENT_COMMERCE_QUERY, { ids: ids.slice(offset, offset + 200) }, "PreparedRecipientCommerce");
    if (response?.ok === false || !response?.data || response.errors?.length) throw Object.assign(new Error("Current prices could not load from Shopify. Retry the order price."), { code: "SHOPIFY_UNAVAILABLE", status: 502 });
    for (const value of response.data.nodes || []) {
      if (!value) continue;
      if (value.id?.startsWith("gid://shopify/ProductVariant/")) variants.set(value.id, value);
      else if (value.id?.startsWith("gid://shopify/Product/")) products.set(value.id, value);
    }
  }
  for (const item of record.items) {
    const product = products.get(item.productId);
    if (!product || !["ACTIVE", "UNLISTED"].includes(product.status)) throw Object.assign(new Error(`${item.title} is no longer available. Contact Print-MO.`), { code: "PRODUCT_UNAVAILABLE", status: 409 });
  }
  return new Map([...products].map(([id2, product]) => [id2, {
    ...product,
    config: normalizeConfig(product.designerConfig?.value),
    image: snapshotItems.find((item) => record.items.find((source) => source.id === item.id)?.productId === id2)?.image || "",
    variants: [...variants.values()].filter((variant) => variant.product?.id === id2)
  }]));
}
__name(preparedPriceProducts, "preparedPriceProducts");

// prepared-order-drafts.mjs
var ROOT2 = "admin-prepared-orders/v1/";
var UUID2 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var HASH2 = /^[a-f0-9]{64}$/;
var MAX_JSON = 1024 * 1024;
var MAX_ASSET = 20 * 1024 * 1024;
var fail8 = /* @__PURE__ */ __name((code, message, status = 400) => {
  throw Object.assign(new Error(message), { code, status });
}, "fail");
var object = /* @__PURE__ */ __name((value) => value && typeof value === "object" && !Array.isArray(value), "object");
var text = /* @__PURE__ */ __name((value, max) => typeof value === "string" ? value.trim().slice(0, max) : "", "text");
var id = /* @__PURE__ */ __name((value) => UUID2.test(String(value)) ? String(value).toLowerCase() : fail8("INVALID_ID", "Choose a saved prepared order."), "id");
var gid = /* @__PURE__ */ __name((value, kind) => new RegExp(`^gid://shopify/${kind}/\\d+$`).test(String(value)), "gid");
var positive = /* @__PURE__ */ __name((value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 200, "positive");
var digest = /* @__PURE__ */ __name((bytes) => crypto.subtle.digest("SHA-256", bytes).then((buffer) => [...new Uint8Array(buffer)].map((v) => v.toString(16).padStart(2, "0")).join("")), "digest");
function assetId(value) {
  return HASH2.test(String(value)) ? value : fail8("INVALID_ASSET", "An artwork reference is invalid.");
}
__name(assetId, "assetId");
function cleanTrim(value) {
  if (!value) return void 0;
  if (!object(value) || !["none", "transparency", "background"].includes(value.mode) || !["none", "alpha", "color"].includes(value.basis)) fail8("INVALID_TRIM", "Artwork trim metadata is invalid.");
  const rect = /* @__PURE__ */ __name((input) => {
    if (!object(input) || ![input.x, input.y, input.width, input.height].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e5) || !input.width || !input.height) fail8("INVALID_TRIM", "Artwork trim dimensions are invalid.");
    return { x: input.x, y: input.y, width: input.width, height: input.height };
  }, "rect");
  return {
    mode: value.mode,
    basis: value.basis,
    naturalWidth: Number(value.naturalWidth),
    naturalHeight: Number(value.naturalHeight),
    crop: rect(value.crop),
    paddedCrop: rect(value.paddedCrop),
    padding: Number(value.padding) || 0,
    tolerance: Number(value.tolerance) || 0,
    blank: false
  };
}
__name(cleanTrim, "cleanTrim");
function cleanPrint(print) {
  if (!object(print) || print.type !== "image" || !["front", "back", "breast", "left", "right"].includes(print.side) || !object(print.design) || !object(print.asset)) fail8("INVALID_PROJECT", "This editor supports uploaded artwork. Open other project types in Designer Studio.");
  const d = print.design;
  if (![d.xIn, d.yIn, d.rotation].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e4) || !positive(d.wIn) || !positive(d.hIn)) fail8("INVALID_PLACEMENT", "Enter valid artwork dimensions and placement.");
  const trim = cleanTrim(print.trim || print.asset.trim);
  return {
    id: id(print.id),
    type: "image",
    side: print.side,
    trim,
    design: { xIn: d.xIn, yIn: d.yIn, wIn: d.wIn, hIn: d.hIn, rotation: d.rotation },
    asset: {
      assetId: assetId(print.asset.assetId),
      mime: text(print.asset.mime, 60),
      naturalW: Number(print.asset.naturalW) || 0,
      naturalH: Number(print.asset.naturalH) || 0,
      trim
    },
    flipH: print.flipH === true,
    flipV: print.flipV === true
  };
}
__name(cleanPrint, "cleanPrint");
function normalizePreparedDraft(input) {
  if (!object(input) || !Array.isArray(input.items) || input.items.length > 30) fail8("INVALID_DRAFT", "Use up to 30 garment configurations in one prepared order.");
  const used = /* @__PURE__ */ new Set();
  const items = input.items.map((item) => {
    if (!object(item) || !gid(item.productId, "Product") || !gid(item.variantId, "ProductVariant")) fail8("INVALID_PRODUCT", "Choose a catalog product and variant.");
    const itemId = id(item.id);
    if (used.has(itemId)) fail8("DUPLICATE_ITEM", "A garment configuration is duplicated.");
    used.add(itemId);
    const project = item.project;
    if (project && (!object(project) || !Array.isArray(project.prints) || project.prints.length > 40)) fail8("INVALID_PROJECT", "Use up to 40 artwork layers per garment.");
    const cleanProject = project ? {
      version: 1,
      prints: project.prints.map(cleanPrint),
      activeSide: ["front", "back", "breast", "left", "right"].includes(project.activeSide) ? project.activeSide : "front",
      canvasCalibration: object(project.canvasCalibration) ? project.canvasCalibration : null,
      printClassOverrides: Object.fromEntries(Object.entries(object(project.printClassOverrides) ? project.printClassOverrides : {}).filter(([side, value]) => ["front", "back", "left", "right"].includes(side) && object(value) && Number.isSafeInteger(value.variantId) && value.variantId > 0).map(([side, value]) => [side, { variantId: value.variantId, label: text(value.label, 100) }])),
      printSummary: (Array.isArray(project.printSummary) ? project.printSummary : []).slice(0, 4).filter((value) => object(value) && ["front", "back", "left", "right"].includes(value.side) && Number.isSafeInteger(value.variantId) && value.variantId > 0).map((value) => ({ side: value.side, variantId: value.variantId, label: text(value.label, 100), mode: value.mode === "manual" ? "manual" : "automatic" }))
    } : null;
    return {
      id: itemId,
      ...item.alternativeForItemId ? { alternativeForItemId: id(item.alternativeForItemId) } : {},
      productId: item.productId,
      variantId: item.variantId,
      handle: text(item.handle, 255),
      title: text(item.title, 180),
      variantTitle: text(item.variantTitle, 180),
      color: text(item.color, 100),
      optionLabel: text(item.optionLabel, 180),
      swatch: { color: /^#[0-9a-f]{6}$/i.test(item.swatch?.color || "") ? item.swatch.color : "", image: /^https:\/\/cdn\.shopify\.com\//.test(item.swatch?.image || "") ? item.swatch.image : "" },
      sizeQty: Object.fromEntries(Object.entries(object(item.sizeQty) ? item.sizeQty : {}).slice(0, 30).map(([size, quantity]) => {
        if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 9999 || size.length > 80) fail8("INVALID_QUANTITY", "Enter whole garment quantities from 0 to 9999.");
        return [size, quantity];
      }).filter(([, quantity]) => quantity > 0)),
      mockupNeedsUpdate: item.mockupNeedsUpdate === true,
      placementNeedsReview: item.placementNeedsReview === true,
      image: /^https:\/\/cdn\.shopify\.com\//.test(item.image || "") ? item.image : "",
      instructions: text(item.instructions, 1e3),
      project: cleanProject,
      printMode: ["auto", "manual", "none"].includes(item.printMode) ? item.printMode : null,
      manualPrints: (Array.isArray(item.manualPrints) ? item.manualPrints : []).slice(0, 4).filter((value) => object(value) && ["front", "back", "left", "right"].includes(value.side) && Number.isSafeInteger(value.variantId) && value.variantId > 0).map((value) => ({ side: value.side, variantId: value.variantId })),
      proofAssetId: item.proofAssetId ? assetId(item.proofAssetId) : null,
      proofSide: text(item.proofSide, 16),
      proofKind: item.proofKind === "garment" ? "garment" : "placement-reference"
    };
  });
  validateAlternativeGroups(items);
  if (!Array.isArray(input.mockups || []) || (input.mockups || []).length > 20) fail8("TOO_MANY_MOCKUPS", "Use up to 20 mockups.");
  return {
    version: 1,
    title: text(input.title, 160) || "Untitled prepared order",
    preparedFor: text(input.preparedFor, 120),
    customerMessage: text(input.customerMessage, 240),
    note: text(input.note, 1e3),
    items,
    mockups: (input.mockups || []).map((asset) => ({
      assetId: assetId(asset.assetId),
      name: text(asset.name, 160),
      mime: text(asset.mime, 60),
      itemIds: [...new Set((Array.isArray(asset.itemIds) ? asset.itemIds : []).map(id))].filter((value) => used.has(value))
    }))
  };
}
__name(normalizePreparedDraft, "normalizePreparedDraft");
async function limitedBytes(request, limit) {
  if (Number(request.headers.get("Content-Length")) > limit) fail8("TOO_LARGE", "This upload is too large.", 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = [];
  let total = 0;
  for (; ; ) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      fail8("TOO_LARGE", "This upload is too large.", 413);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
__name(limitedBytes, "limitedBytes");
function collectAssets(draft) {
  return /* @__PURE__ */ new Set([...draft.mockups.map((a) => a.assetId), ...draft.items.flatMap((item) => [item.proofAssetId, ...(item.project?.prints || []).map((p) => p.asset.assetId)]).filter(Boolean)]);
}
__name(collectAssets, "collectAssets");
var productFields = `id title handle status featuredMedia { preview { image { url } } }
  options { name optionValues { name swatch { color image { image { url } } } } }
  designerConfig: metafield(namespace: "custom", key: "designer_config") { value }
  variants(first: 100, after: $variantCursor) { nodes { id title price availableForSale selectedOptions { name value } media(first: 1) { nodes { preview { image { url } } } } } pageInfo { hasNextPage endCursor } }`;
var PREPARED_PRODUCT_QUERY = `query PreparedAdminProduct($id: ID!, $variantCursor: String) { product(id: $id) { ${productFields} } }`;
var PREPARED_CATALOG_QUERY = `query PreparedAdminCatalog($query: String!, $after: String) {
  products(first: 15, query: $query, after: $after, sortKey: TITLE) { nodes { id title handle status featuredMedia { preview { image { url } } } } pageInfo { hasNextPage endCursor } }
}`;
function config(value) {
  try {
    const parsed2 = JSON.parse(value || "{}");
    return object(parsed2.placements) ? parsed2 : { placements: {} };
  } catch {
    return { placements: {} };
  }
}
__name(config, "config");
function productDto(product) {
  return { id: product.id, title: product.title, handle: product.handle, status: product.status, image: product.featuredMedia?.preview?.image?.url || "" };
}
__name(productDto, "productDto");
function catalogData(result) {
  if (result?.ok !== false && result?.data && !result.errors?.length) return result.data;
  const denied = result?.errors?.some((error) => error?.extensions?.code === "ACCESS_DENIED");
  fail8(denied ? "CATALOG_ACCESS_DENIED" : "CATALOG_UNAVAILABLE", denied ? "Shopify did not allow access to products. Check this app\u2019s product access in Shopify Admin, then retry." : "Products could not load from Shopify. Try again; your order has not changed.", 502);
}
__name(catalogData, "catalogData");
function createPreparedDraftService(env, { graphql }) {
  const bucket = env.R2_BUCKET;
  const prefix2 = `${ROOT2}${encodeURIComponent(String(env.SHOPIFY_SHOP_DOMAIN || "").toLowerCase())}/`;
  const key2 = /* @__PURE__ */ __name((value) => `${prefix2}drafts/${id(value)}.json`, "key");
  const assetKey = /* @__PURE__ */ __name((draftId, hash2) => `${prefix2}assets/${id(draftId)}/${assetId(hash2)}`, "assetKey");
  const verifiedAssetOwners = /* @__PURE__ */ new Set();
  async function read(draftId, includeDeleted = false) {
    const stored = await bucket.get(key2(draftId));
    if (!stored) fail8("DRAFT_NOT_FOUND", "This prepared order was not found. Return to the list and refresh.", 404);
    const record = { ...await stored.json(), revision: stored.etag };
    if (record.deletedAt && !includeDeleted) fail8("DRAFT_NOT_FOUND", "This prepared order has been deleted. Return to the list.", 404);
    verifiedAssetOwners.add(draftId);
    return record;
  }
  __name(read, "read");
  return {
    list(cursor, options = {}) {
      return browsePreparedOrders(env, { ...options, cursor }, read);
    },
    read,
    async manage(draftId, body, actor) {
      const mutationId = id(body.mutationId), record = await read(draftId);
      if (body.action === "rename") {
        const title = text(body.title, 160);
        if (!title) fail8("TITLE_REQUIRED", "Enter an order name.");
        return this.save(draftId, { draft: { ...record, title }, expectedRevision: body.expectedRevision, mutationId }, actor);
      }
      if (!["archive", "restore"].includes(body.action)) fail8("INVALID_ACTION", "Choose archive, restore, rename or delete.");
      const managementKey = `${prefix2}management/${id(draftId)}.json`;
      const previous = await bucket.get(managementKey), existing = previous ? await previous.json() : null;
      if (existing?.mutationId === mutationId) return { managed: true };
      if (body.expectedRevision !== record.revision) fail8("VERSION_CONFLICT", "This order changed. Refresh the list before trying again.", 409);
      const value = { id: draftId, archivedAt: body.action === "archive" ? (/* @__PURE__ */ new Date()).toISOString() : null, mutationId, updatedBy: actor };
      const saved = await bucket.put(managementKey, JSON.stringify(value), {
        onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
        customMetadata: { management: JSON.stringify(value) }
      });
      if (!saved) fail8("VERSION_CONFLICT", "This order was managed in another session. Refresh the list.", 409);
      return { managed: true };
    },
    async remove(draftId, body, actor, disableLink) {
      const mutationId = id(body.mutationId), record = await read(draftId, true);
      if (record.deletedAt) return { deleted: true };
      if (body.expectedRevision !== record.revision) fail8("VERSION_CONFLICT", "This order changed. Refresh and review it before deleting.", 409);
      await disableLink();
      const { revision, ...original } = record;
      const value = { ...original, deletedAt: (/* @__PURE__ */ new Date()).toISOString(), deletedBy: actor, mutationId };
      const saved = await bucket.put(key2(draftId), JSON.stringify(value), {
        onlyIf: { etagMatches: revision },
        httpMetadata: { contentType: "application/json" },
        customMetadata: { summary: JSON.stringify(preparedDraftSummary(value)) }
      });
      if (!saved) fail8("VERSION_CONFLICT", "This order changed during deletion. Its link was disabled; refresh and review before retrying.", 409);
      return { deleted: true };
    },
    async save(draftId, body, actor) {
      id(draftId);
      const mutationId = id(body.mutationId), draft = normalizePreparedDraft(body.draft);
      const previous = await bucket.get(key2(draftId));
      const existing = previous ? await previous.json() : null;
      if (existing?.deletedAt) fail8("DRAFT_NOT_FOUND", "This prepared order has been deleted.", 404);
      if (existing?.mutationId === mutationId) return { ...existing, revision: previous.etag };
      if (previous ? body.expectedRevision !== previous.etag : Boolean(body.expectedRevision)) fail8("VERSION_CONFLICT", "This prepared order changed in another session. Your edits are still here; reopen the saved version before replacing them.", 409);
      for (const hash2 of collectAssets(draft)) if (!await bucket.head(assetKey(draftId, hash2))) fail8("ASSET_MISSING", "An artwork upload has not finished. Retry the upload before saving.", 409);
      const record = { ...draft, id: draftId, createdAt: existing?.createdAt || (/* @__PURE__ */ new Date()).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString(), updatedBy: actor, mutationId };
      const stored = await bucket.put(key2(draftId), JSON.stringify(record), {
        onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
        customMetadata: { summary: JSON.stringify(preparedDraftSummary(record)) }
      });
      if (!stored) fail8("VERSION_CONFLICT", "Another session saved this prepared order first. Your edits are still here.", 409);
      return { ...record, revision: stored.etag };
    },
    async upload(draftId, request) {
      await read(draftId);
      const mime = (request.headers.get("Content-Type") || "").split(";")[0];
      if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(mime)) fail8("UNSUPPORTED_IMAGE", "Use PNG, JPG, WebP or SVG artwork.", 415);
      const bytes = await limitedBytes(request, MAX_ASSET);
      const head = new TextDecoder().decode(bytes.subarray(0, 2048));
      const valid = mime === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index2) => bytes[index2] === value) : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : mime === "image/webp" ? String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP" : /<svg[\s>]/i.test(head) && !/<!DOCTYPE|<!ENTITY/i.test(head);
      if (!valid || bytes.length < 8) fail8("INVALID_IMAGE", "This file does not match its image format.", 415);
      const hash2 = await digest(bytes);
      if (!await bucket.head(assetKey(draftId, hash2))) {
        const assets = await bucket.list({ prefix: `${prefix2}assets/${id(draftId)}/`, limit: 129 });
        if (assets.truncated || assets.objects.length >= 128) fail8("ASSET_LIMIT", "This order has reached its artwork upload limit. Start a separate prepared order.", 413);
      }
      await bucket.put(assetKey(draftId, hash2), bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: mime }, customMetadata: { mime } });
      return { assetId: hash2, mime, bytes: bytes.length };
    },
    async asset(draftId, hash2) {
      if (!verifiedAssetOwners.has(draftId)) await read(draftId, true);
      const stored = await bucket.get(assetKey(draftId, hash2));
      if (!stored) fail8("ASSET_NOT_FOUND", "This artwork could not be found. Upload it again.", 404);
      return stored;
    },
    async catalog(query, after) {
      const safe = text(query, 120).replace(/["\\\x00-\x1f]/g, " ");
      const result = catalogData(await graphql(env, PREPARED_CATALOG_QUERY, { query: `(status:active OR status:unlisted)${safe ? ` AND (title:*${safe.replace(/[^\p{L}\p{N} _.-]/gu, " ").trim().split(/\s+/).join("* AND title:*")}*)` : ""}`, after: after || null }, "PreparedAdminCatalog"));
      return { products: result.products.nodes.filter((p) => ["ACTIVE", "UNLISTED"].includes(p.status)).map(productDto), ...result.products.pageInfo };
    },
    priceProducts(record, snapshotItems) {
      return preparedPriceProducts(env, graphql, record, snapshotItems, config);
    },
    async product(productId) {
      if (!gid(productId, "Product")) fail8("INVALID_PRODUCT", "Choose a catalog product.");
      let cursor = null, product, variants = [];
      for (let page = 0; page < 30; page++) {
        const result = catalogData(await graphql(env, PREPARED_PRODUCT_QUERY, { id: productId, variantCursor: cursor }, "PreparedAdminProduct"));
        product = result.product;
        if (!product || !["ACTIVE", "UNLISTED"].includes(product.status)) fail8("PRODUCT_UNAVAILABLE", "This product is no longer active or unlisted.", 404);
        variants.push(...product.variants.nodes.map(({ media, ...variant }) => ({ ...variant, image: media?.nodes?.[0]?.preview?.image || null })));
        if (!product.variants.pageInfo.hasNextPage) {
          const designer = config(product.designerConfig?.value), swatches = {};
          for (const value of designer.colors || []) if (value.name) swatches[value.name] = { color: /^#[0-9a-f]{6}$/i.test(value.tintHex || "") ? value.tintHex : "", image: /^https:\/\/cdn\.shopify\.com\//.test(value.swatchImage || "") ? value.swatchImage : "" };
          for (const option of product.options || []) if (/colou?r/i.test(option.name)) for (const value of option.optionValues || []) {
            const color = value.swatch?.color, image = value.swatch?.image?.image?.url;
            if (color || image) swatches[value.name] = { color: color || swatches[value.name]?.color || "", image: image || swatches[value.name]?.image || "" };
          }
          return { ...productDto(product), config: designer, swatches, variants };
        }
        cursor = product.variants.pageInfo.endCursor;
        if (!cursor) break;
      }
      fail8("CATALOG_INCOMPLETE", "The complete variant list could not load. Retry before selecting a variant.", 503);
    }
  };
}
__name(createPreparedDraftService, "createPreparedDraftService");
async function handlePreparedDraftRequest(request, env, deps, identity, headers, context) {
  if (!env.R2_BUCKET || !env.SHOPIFY_SHOP_DOMAIN) fail8("PREPARATION_UNAVAILABLE", "Prepared order storage is not configured.", 503);
  const service = createPreparedDraftService(env, deps), url = new URL(request.url);
  const tail = url.pathname.slice("/order-manager/v1/prepared-order-drafts".length).split("/").filter(Boolean).map(decodeURIComponent);
  const json = /* @__PURE__ */ __name((value) => Response.json(value, { headers: { ...headers, "Cache-Control": "no-store" } }), "json");
  if (!tail.length && request.method === "GET") return json(await service.list(url.searchParams.get("cursor"), Object.fromEntries(url.searchParams)));
  if (tail[0] === "catalog" && tail[1] === "finder" && tail.length === 2 && request.method === "GET") return json(await searchPreparedCatalog(env, deps.graphql, Object.fromEntries(url.searchParams), context));
  if (tail[0] === "catalog" && request.method === "GET") return json(await service.catalog(url.searchParams.get("q"), url.searchParams.get("after")));
  if (tail[0] === "product" && tail.length === 2 && request.method === "GET") return json(await service.product(tail[1]));
  if (tail.length === 2 && tail[1] === "publish" && request.method === "POST" && request.headers.get("Accept")?.includes("application/x-ndjson")) {
    return preparedPublishStream((progress) => handlePreparedLinkRequest(request, env, deps, service, tail[0], tail[1], progress), headers, context);
  }
  if (tail.length === 2 && ["publish", "link", "revoke", "print-choices"].includes(tail[1])) return json(await handlePreparedLinkRequest(request, env, deps, service, tail[0], tail[1]));
  if (tail.length === 2 && tail[1] === "manage" && request.method === "POST") {
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(await limitedBytes(request, 4096)));
    } catch (error) {
      if (error.status) throw error;
      fail8("INVALID_JSON", "This order action could not be read. Refresh and retry.");
    }
    if (!object(body)) fail8("INVALID_ACTION", "Choose an order action.");
    const actor = `${identity.kind}:${identity.subject}`;
    if (body.action === "delete") return json(await deletePreparedPreparation(env, service, tail[0], body, actor));
    return json(await service.manage(tail[0], body, actor));
  }
  if (tail.length === 1 && request.method === "GET") return json(await service.read(tail[0]));
  if (tail.length === 1 && request.method === "PUT") {
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(await limitedBytes(request, MAX_JSON)));
    } catch (error) {
      if (error.status) throw error;
      fail8("INVALID_JSON", "The order details could not be read.");
    }
    return json(await service.save(tail[0], body, `${identity.kind}:${identity.subject}`));
  }
  if (tail.length === 2 && tail[1] === "assets" && request.method === "POST") return json(await service.upload(tail[0], request));
  if (tail.length === 3 && tail[1] === "assets" && request.method === "GET") {
    await service.read(tail[0]);
    const asset = await service.asset(tail[0], tail[2]);
    return new Response(asset.body, { headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    } });
  }
  fail8("NOT_FOUND", "This prepared order action is unavailable.", 404);
}
__name(handlePreparedDraftRequest, "handlePreparedDraftRequest");
async function handlePublicPreparedOrderRequest(request, env, deps, headers) {
  const service = createPreparedDraftService(env, deps);
  return Response.json(await handlePublicPreparedLinkRequest(request, env, deps, service), { headers: { ...headers, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
__name(handlePublicPreparedOrderRequest, "handlePublicPreparedOrderRequest");

// worker.js
function draftOrderService(env) {
  return createDraftOrderService(env, {
    shop: /* @__PURE__ */ __name(() => d1Shop(env), "shop"),
    graphql: coordinatorGraphQL,
    promoteTargetDate: /* @__PURE__ */ __name((gid2, date, mutationId) => promoteDraftTargetDate(env, gid2, date, mutationId), "promoteTargetDate")
  });
}
__name(draftOrderService, "draftOrderService");
async function promoteDraftTargetDate(env, gid2, date, mutationId) {
  const shop = await d1Shop(env), db = requireOrderDb(env), actor = "system:draft-target-date";
  const projection = await db.prepare("SELECT order_gid FROM order_projection WHERE shop_id = ? AND order_gid = ?").bind(shop.id, gid2).first();
  if (!projection) return "pending";
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await readProductionMetafield(env, gid2, actor);
    if (!current.exists) return "pending";
    if (current.state.lastMutationId !== mutationId) {
      if (current.state.targetDate) return "kept-existing";
      const edited = await db.prepare(`SELECT id FROM production_events WHERE shop_id = ? AND order_gid = ?
                AND action = 'production.patch' AND EXISTS (SELECT 1 FROM json_each(changed_fields_json) WHERE value = 'targetDate') LIMIT 1`).bind(shop.id, gid2).first();
      const pendingEdit = current.state.lastMutationId && await db.prepare(`SELECT id FROM mutation_requests
                WHERE id = ? AND shop_id = ? AND json_type(requested_patch_json, '$.targetDate') IS NOT NULL`).bind(current.state.lastMutationId, shop.id).first();
      if (edited || pendingEdit) return "kept-existing";
    }
    try {
      const saved = current.state.lastMutationId === mutationId ? current : await setProductionMetafield(
        env,
        gid2,
        applyProductionPatch(current.state, { targetDate: date }, actor, mutationId),
        current.compareDigest,
        coordinatorGraphQL
      );
      await d1ProjectionUpsert(env, shop.id, gid2, saved.state, saved.compareDigest, void 0, current.order);
      await db.prepare(`INSERT OR IGNORE INTO production_events
                (id, shop_id, order_gid, actor_id, action, old_revision, new_revision, changed_fields_json, outcome, created_at)
                VALUES (?, ?, ?, ?, 'draft.target-date', ?, ?, '["targetDate"]', 'committed', ?)`).bind(mutationId, shop.id, gid2, actor, Math.max(0, saved.state.revision - 1), saved.state.revision, isoNow()).run();
      return "applied";
    } catch (error) {
      if (error.code !== "VERSION_CONFLICT" || attempt) throw error;
    }
  }
}
__name(promoteDraftTargetDate, "promoteDraftTargetDate");
async function handleDraftOrderRequest(request, env, origin, headers, identity) {
  try {
    const result = await draftOrderService(env).handle(request, `${identity.kind}:${identity.subject}`);
    return jsonResponse(result, origin, headers);
  } catch (error) {
    return v1Error(error, origin, headers, error.status || 500);
  }
}
__name(handleDraftOrderRequest, "handleDraftOrderRequest");
var oidcCache = /* @__PURE__ */ new Map();
function decodeBase64Url(value) {
  const normalized2 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized2 + "=".repeat((4 - normalized2.length % 4) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
__name(decodeBase64Url, "decodeBase64Url");
function decodeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed bearer token");
  const parse2 = /* @__PURE__ */ __name((part) => JSON.parse(new TextDecoder().decode(decodeBase64Url(part))), "parse");
  return { header: parse2(parts[0]), payload: parse2(parts[1]), signingInput: `${parts[0]}.${parts[1]}`, signature: decodeBase64Url(parts[2]) };
}
__name(decodeJwt, "decodeJwt");
function configuredIds(value) {
  return new Set(String(value || "").split(",").map((v) => v.trim()).filter(Boolean));
}
__name(configuredIds, "configuredIds");
function validateJwtTimes(payload) {
  const now = Math.floor(Date.now() / 1e3);
  if (!Number.isFinite(payload.exp) || payload.exp < now - 10) throw new Error("Bearer token expired");
  if (Number.isFinite(payload.nbf) && payload.nbf > now + 10) throw new Error("Bearer token is not active");
}
__name(validateJwtTimes, "validateJwtTimes");
function audienceIncludes(aud, expected) {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}
__name(audienceIncludes, "audienceIncludes");
async function verifyShopifyToken(jwt, env) {
  const clientId = env.SHOPIFY_CLIENT_ID || env.SHOPIFY_API_KEY;
  const secret = env.SHOPIFY_APP_SECRET || env.SHOPIFY_API_SECRET;
  const expectedShop = String(env.SHOPIFY_SHOP_DOMAIN || "").toLowerCase();
  if (!clientId || !secret || !expectedShop) throw new Error("Shopify authentication is not configured");
  if (jwt.header.alg !== "HS256") throw new Error("Unsupported Shopify token algorithm");
  const key2 = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key2, jwt.signature, new TextEncoder().encode(jwt.signingInput));
  if (!valid) throw new Error("Invalid Shopify token signature");
  validateJwtTimes(jwt.payload);
  if (!audienceIncludes(jwt.payload.aud, clientId)) throw new Error("Invalid Shopify token audience");
  const dest = new URL(jwt.payload.dest);
  if (dest.protocol !== "https:" || dest.hostname.toLowerCase() !== expectedShop) throw new Error("Invalid Shopify shop");
  if (jwt.payload.iss !== `${dest.origin}/admin`) throw new Error("Invalid Shopify token issuer");
  const partners = configuredIds(env.PARTNER_USER_IDS);
  if (!partners.size || !partners.has(String(jwt.payload.sub))) throw new Error("Shopify user is not authorized");
  return { kind: "shopify", subject: String(jwt.payload.sub), shop: expectedShop };
}
__name(verifyShopifyToken, "verifyShopifyToken");
async function cachedJson(url) {
  const cached = oidcCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Unable to load OIDC metadata");
  const value = await response.json();
  oidcCache.set(url, { value, expiresAt: Date.now() + 3e5 });
  return value;
}
__name(cachedJson, "cachedJson");
async function verifyOidcToken(jwt, env) {
  const issuer = String(env.OIDC_ISSUER || "").replace(/\/+$/, "");
  const audience = env.OIDC_AUDIENCE || env.OIDC_CLIENT_ID;
  if (!issuer || !audience) throw new Error("Electron OIDC authentication is not configured");
  if (jwt.header.alg !== "RS256" || !jwt.header.kid) throw new Error("Unsupported OIDC token algorithm");
  if (jwt.payload.iss !== issuer) throw new Error("Invalid OIDC issuer");
  const discovery = await cachedJson(`${issuer}/.well-known/openid-configuration`);
  if (discovery.issuer !== issuer || !String(discovery.jwks_uri || "").startsWith("https://")) throw new Error("Invalid OIDC metadata");
  const jwks = await cachedJson(discovery.jwks_uri);
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((key3) => key3.kid === jwt.header.kid && key3.kty === "RSA") : null;
  if (!jwk) throw new Error("OIDC signing key not found");
  const key2 = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key2, jwt.signature, new TextEncoder().encode(jwt.signingInput));
  if (!valid) throw new Error("Invalid OIDC token signature");
  validateJwtTimes(jwt.payload);
  if (!audienceIncludes(jwt.payload.aud, audience)) throw new Error("Invalid OIDC audience");
  const partners = configuredIds(env.PARTNER_SUBJECT_IDS);
  if (!partners.size || !partners.has(String(jwt.payload.sub))) throw new Error("OIDC user is not authorized");
  return { kind: "oidc", subject: String(jwt.payload.sub) };
}
__name(verifyOidcToken, "verifyOidcToken");
async function authenticateRequest(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) throw new Error("Missing bearer token");
  const jwt = decodeJwt(match[1]);
  return jwt.header.alg === "HS256" ? verifyShopifyToken(jwt, env) : verifyOidcToken(jwt, env);
}
__name(authenticateRequest, "authenticateRequest");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/order-manager/")) {
      return new Response("Not Found", { status: 404 });
    }
    const origin = (request.headers.get("Origin") || "").replace(/\/+$/, "");
    const publicPreparedPath = /^\/order-manager\/v1\/prepared-orders\/public\/[a-f0-9-]{36}(?:\/(checkout|quote|size-guides|colors))?$/i.test(url.pathname);
    const allowOrigin = pickAllowOrigin(origin, env) || (publicPreparedPath && ["https://print-mo.com", "https://www.print-mo.com"].includes(origin) ? origin : "");
    if (origin && !allowOrigin) {
      return new Response("CORS blocked", {
        status: 403,
        headers: { Vary: "Origin" }
      });
    }
    const reqAllowHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type";
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowOrigin || origin || "*", reqAllowHeaders)
      });
    }
    if (publicPreparedPath) {
      try {
        return await handlePublicPreparedOrderRequest(
          request,
          env,
          { graphql: coordinatorGraphQL, drafts: draftOrderService(env) },
          { "Access-Control-Allow-Origin": allowOrigin || origin || "*", Vary: "Origin" }
        );
      } catch (error) {
        return v1Error(error?.code ? error : { code: "CHECKOUT_UNAVAILABLE", message: "This order could not load or continue to checkout. Try again, or contact Print-MO." }, allowOrigin || origin || "*", reqAllowHeaders, error.status || 503);
      }
    }
    if (url.pathname === "/order-manager/v1/webhooks/shopify" && request.method === "POST") {
      return handleShopifyWebhook(request, env, allowOrigin || origin || "*", reqAllowHeaders, ctx);
    }
    if (url.pathname === ETSY_WEBHOOK_PATH) {
      if (request.method !== "POST") {
        return etsyWebhookResponse({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }, 405, { Allow: "POST" });
      }
      return handleEtsyWebhook(request, env, ctx);
    }
    if (url.pathname === "/order-manager/v1/oauth/etsy/callback" && request.method === "GET") {
      return handleEtsyOauthCallback(request, env);
    }
    if (url.pathname.startsWith("/order-manager/v1/assets/") && url.pathname.endsWith("/read") && request.method === "GET") {
      return handleV1AssetRead(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname.startsWith("/order-manager/v1/catalog-previews/") && url.pathname.endsWith("/read") && request.method === "GET") {
      return handleEtsyCatalogPreviewRead(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    let identity;
    try {
      identity = await authenticateRequest(request, env);
    } catch (err) {
      return jsonResponse({ error: err.message }, allowOrigin || origin || "*", reqAllowHeaders, 401, {
        "WWW-Authenticate": 'Bearer realm="printmo"',
        "X-Shopify-Retry-Invalid-Session-Request": "1"
      });
    }
    if (url.pathname === "/order-manager/v1/prepared-order-drafts" || url.pathname.startsWith("/order-manager/v1/prepared-order-drafts/")) {
      try {
        return await handlePreparedDraftRequest(
          request,
          env,
          { graphql: coordinatorGraphQL, drafts: draftOrderService(env) },
          identity,
          { "Access-Control-Allow-Origin": allowOrigin || origin || "*", Vary: "Origin" },
          ctx
        );
      } catch (error) {
        const safe = error?.code && error?.status ? error : { code: "PREPARATION_UNAVAILABLE", message: "Prepared orders could not finish this action. Try again; your current edits are still here." };
        return v1Error(safe, allowOrigin || origin || "*", reqAllowHeaders, safe.status || 500);
      }
    }
    if (url.pathname === "/order-manager/v1/drafts" || url.pathname.startsWith("/order-manager/v1/drafts/")) {
      return handleDraftOrderRequest(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/production-run") {
      try {
        const shop = await d1Shop(env);
        const service = createProductionRunService(requireOrderDb(env), shop.id);
        const result = request.method === "GET" ? await service.get() : request.method === "PATCH" ? await service.patch(await request.json(), `${identity.kind}:${identity.subject}`) : null;
        if (!result) return v1Error({ code: "METHOD_NOT_ALLOWED", message: "Run action unavailable." }, allowOrigin || origin || "*", reqAllowHeaders, 405);
        return jsonResponse(result, allowOrigin || origin || "*", reqAllowHeaders);
      } catch (error) {
        return v1Error(error, allowOrigin || origin || "*", reqAllowHeaders, error.status || 500, error.details);
      }
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/connect" && request.method === "POST") {
      return handleEtsyConnect(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/status" && request.method === "GET") {
      return handleEtsyStatus(env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/webhook-status" && request.method === "GET") {
      return handleEtsyWebhookStatus(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/test-read" && request.method === "POST") {
      return handleEtsyTestRead(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/listing-image-probe" && request.method === "POST") {
      return handleEtsyListingImageProbe(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/catalog-image-probe" && request.method === "POST") {
      return handleEtsyCatalogImageProbe(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/catalog-preview-sync" && request.method === "POST") {
      return handleEtsyCatalogPreviewSync(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/catalog-preview-refresh" && request.method === "POST") {
      return handleEtsyCatalogPreviewRefresh(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/blank-recipe" && request.method === "POST") {
      return handleEtsyBlankRecipe(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/shadow-sync" && request.method === "POST") {
      return handleEtsyShadowSync(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/integrations/etsy/synthetic-order" && ["POST", "DELETE"].includes(request.method)) {
      return handleEtsySyntheticOrder(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/storage/list") {
      return handleStorageList(
        request,
        env,
        allowOrigin || origin || "*",
        reqAllowHeaders
      );
    }
    if (url.pathname === "/order-manager/storage/object") {
      return handleStorageObject(
        request,
        env,
        allowOrigin || origin || "*",
        reqAllowHeaders
      );
    }
    if (url.pathname === "/order-manager/storage/head") {
      return handleStorageHead(
        request,
        env,
        allowOrigin || origin || "*",
        reqAllowHeaders
      );
    }
    if (url.pathname === "/order-manager/orders/manual-mockups") {
      try {
        return await handleManualMockups(
          request,
          env,
          allowOrigin || origin || "*",
          reqAllowHeaders
        );
      } catch (err) {
        console.error("Manual mockup request failed:", err?.stack || err?.message || err);
        return jsonResponse(
          { error: "Manual mockup storage request failed" },
          allowOrigin || origin || "*",
          reqAllowHeaders,
          500
        );
      }
    }
    if (url.pathname === "/order-manager/orders/manual-mockups/bulk") {
      try {
        return await handleManualMockupsBulk(
          request,
          env,
          allowOrigin || origin || "*",
          reqAllowHeaders
        );
      } catch (err) {
        console.error("Manual mockup bulk request failed:", err?.stack || err?.message || err);
        return jsonResponse(
          { error: "Manual mockup bulk storage request failed" },
          allowOrigin || origin || "*",
          reqAllowHeaders,
          500
        );
      }
    }
    if (url.pathname === "/order-manager/orders/manual-checklist") {
      return handleManualChecklist(
        request,
        env,
        allowOrigin || origin || "*",
        reqAllowHeaders
      );
    }
    if (url.pathname === "/order-manager/orders/manual-checklist/bulk") {
      return handleManualChecklistBulk(
        request,
        env,
        allowOrigin || origin || "*",
        reqAllowHeaders
      );
    }
    if (url.pathname === "/order-manager/v1/garment-costs" && request.method === "POST") {
      return handleGarmentCosts(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/blanks-batches") {
      return handleBlanksBatches(
        request,
        env,
        allowOrigin || origin || "*",
        reqAllowHeaders
      );
    }
    if (url.pathname === "/order-manager/blanks-batches/status-refresh") {
      return handleBlanksBatchStatusRefresh(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/legacy/queue" && request.method === "GET") {
      return handleLegacyQueueGet(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/legacy/queue/mutate" && request.method === "POST") {
      return handleLegacyQueueMutate(request, env, allowOrigin || origin || "*", reqAllowHeaders, ctx);
    }
    if (url.pathname === "/order-manager/v1/legacy/queue/item" && request.method === "DELETE") {
      return handleLegacyQueueDelete(request, env, allowOrigin || origin || "*", reqAllowHeaders, ctx);
    }
    if (url.pathname === "/order-manager/v1/legacy/ss/batch" && request.method === "POST") {
      return handleLegacySSBatch(request, env, allowOrigin || origin || "*", reqAllowHeaders, ctx);
    }
    if (url.pathname.startsWith("/order-manager/v1/shopify-preview/orders/") && request.method === "GET") {
      return handleShopifyPreviewOrderDetailGet(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/shopify-preview/orders" && request.method === "GET") {
      return handleShopifyPreviewOrdersGet(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/orders" && request.method === "GET") {
      return handleV1OrdersGet(request, env, allowOrigin || origin || "*", reqAllowHeaders, ctx);
    }
    if (url.pathname.startsWith("/order-manager/v1/orders/") && url.pathname.endsWith("/production") && request.method === "GET") {
      return handleV1ProductionGet(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname.startsWith("/order-manager/v1/orders/") && url.pathname.endsWith("/production") && request.method === "PATCH") {
      return handleV1ProductionPatch(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname.startsWith("/order-manager/v1/orders/") && url.pathname.endsWith("/assets") && request.method === "POST") {
      return handleV1DesignAssetUpload(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/shelf-stock" && request.method === "GET") {
      return handleShelfInventory(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname.startsWith("/order-manager/v1/orders/") && url.pathname.endsWith("/shelf") && ["GET", "PUT", "PATCH"].includes(request.method)) {
      return handleShelfOrder(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname.startsWith("/order-manager/v1/shelf-stock/")) {
      if (request.method === "PUT")
        return handleShelfCount(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
      if (request.method === "POST")
        return handleShelfReceive(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname.startsWith("/order-manager/v1/orders/") && request.method === "GET") {
      return handleV1OrderDetailGet(request, env, allowOrigin || origin || "*");
    }
    if (url.pathname === "/order-manager/v1/batches/commit" && request.method === "POST") {
      return handleV1BatchCommit(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/batches/latest" && request.method === "GET") {
      return handleV1LatestBatchResult(env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/batches/retry-review" && request.method === "POST") {
      return v1Error({ code: "RETRY_REVIEW_RETIRED", message: "Use the normal Place S&S order action for a new submission. Earlier evidence is preserved." }, allowOrigin || origin || "*", reqAllowHeaders, 410);
    }
    if (url.pathname === "/order-manager/v1/batches/cart-review" && request.method === "GET") {
      return v1Error({ code: "CART_REVIEW_RETIRED", message: "Use the saved S&S order result and the existing reviewed production-stage move." }, allowOrigin || origin || "*", reqAllowHeaders, 410);
    }
    if (url.pathname === "/order-manager/v1/batches/cart-reconcile" && request.method === "POST") {
      return v1Error({ code: "CART_RECONCILIATION_RETIRED", message: "This cart-attestation action is retired. Existing audit records are preserved; use the reviewed production-stage move." }, allowOrigin || origin || "*", reqAllowHeaders, 410);
    }
    if (url.pathname === "/order-manager/v1/provider-batches/commit" && request.method === "POST") {
      return handleProviderBatchCommit(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
    }
    if (url.pathname === "/order-manager/v1/assets/read-tickets" && request.method === "POST") {
      return handleV1AssetReadTickets(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname.startsWith("/order-manager/v1/assets/") && url.pathname.endsWith("/read-ticket") && request.method === "POST") {
      return handleV1AssetReadTicket(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname.startsWith("/order-manager/v1/assets/") && request.method === "DELETE") {
      return handleV1ManualAssetDelete(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname.startsWith("/order-manager/v1/catalog-previews/") && url.pathname.endsWith("/read-ticket") && request.method === "POST") {
      return handleEtsyCatalogPreviewReadTicket(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname.startsWith("/order-manager/v1/assets/") && url.pathname.endsWith("/read") && request.method === "GET") {
      return handleV1AssetRead(request, env, allowOrigin || origin || "*", reqAllowHeaders);
    }
    if (url.pathname === "/order-manager/v1/parity/check" && request.method === "POST") {
      return handleV1ParityCheck(request, env, allowOrigin || origin || "*");
    }
    if (url.pathname === "/order-manager/v1/parity/report" && request.method === "GET") {
      return handleV1ParityReport(request, env, allowOrigin || origin || "*");
    }
    if (url.pathname === "/order-manager/v1/migration/run" && request.method === "POST") {
      return handleV1MigrationRun(request, env, allowOrigin || origin || "*");
    }
    const upstreamBase = (env.UPSTREAM_BASE || "").replace(/\/+$/, "");
    if (!upstreamBase) return new Response("Missing UPSTREAM_BASE", { status: 500 });
    const upstreamUrl = `${upstreamBase}${url.pathname}${url.search}`;
    const reqHeaders = new Headers(request.headers);
    reqHeaders.delete("Origin");
    reqHeaders.delete("Host");
    const adminKey = env.ORDER_MANAGER_ADMIN_KEY || "";
    if (!adminKey) {
      return new Response("Missing ORDER_MANAGER_ADMIN_KEY", { status: 500 });
    }
    reqHeaders.set("X-Order-Manager-Key", adminKey);
    if (env.SHOPIFY_SHOP_DOMAIN) reqHeaders.set("X-Shopify-Shop-Domain", String(env.SHOPIFY_SHOP_DOMAIN).toLowerCase());
    const isWebSocket = (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
    if (isWebSocket) {
      const wsReq = new Request(upstreamUrl, {
        method: request.method,
        headers: reqHeaders
      });
      return fetch(wsReq);
    }
    const upstreamRes = await fetch(upstreamUrl, {
      method: request.method,
      headers: reqHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? void 0 : request.body,
      redirect: "follow"
    });
    const outHeaders = new Headers(upstreamRes.headers);
    outHeaders.set("Cache-Control", "no-store");
    const finalAllowOrigin = allowOrigin || origin || "*";
    for (const [k, v] of Object.entries(corsHeaders(finalAllowOrigin, reqAllowHeaders))) {
      outHeaders.set(k, v);
    }
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: outHeaders
    });
  },
  async scheduled(event, env, ctx) {
    const shop = (env.SHOPIFY_SHOP_DOMAIN || "printmo-test.myshopify.com").toLowerCase();
    if (env.ORDER_SYNC_COORDINATOR) {
      const id2 = env.ORDER_SYNC_COORDINATOR.idFromName(shop);
      const coordinator = env.ORDER_SYNC_COORDINATOR.get(id2);
      if (event.cron === "*/5 * * * *") {
        ctx.waitUntil(
          restoreLegacySnapshotPositions(env).then(() => coordinator.fetch(new Request("https://internal/reconcile-incremental"))).catch((err) => console.error("Legacy position catch-up or incremental reconciliation error:", err))
        );
        ctx.waitUntil(backfillDesignerStudioAssets(env).catch((err) => console.error("Designer Studio asset backfill error:", err)));
      } else if (event.cron === "0 2 * * *") {
        ctx.waitUntil(coordinator.fetch(new Request("https://internal/reconcile-integrity")).catch((err) => console.error("Cron integrity error:", err)));
      }
    }
    if (event.cron === "*/5 * * * *") {
      if (env.DRAFT_ORDERS_ENABLED === "1") ctx.waitUntil(draftOrderService(env).reconcile().catch((error) => {
        console.error("Draft artwork reconciliation failed:", error.code || "DRAFT_SYNC_FAILED");
      }));
      ctx.waitUntil(syncSupplierOrderStatuses(env).catch((err) => {
        console.error("S&S order status sync error:", String(err?.message || err));
      }));
      ctx.waitUntil(runEtsyWebhookMaintenance(env, "incremental").catch((err) => {
        console.error("Etsy webhook maintenance error:", String(err?.code || "ETSY_MAINTENANCE_FAILED"));
      }));
    } else if (event.cron === "0 2 * * *") {
      ctx.waitUntil(runEtsyWebhookMaintenance(env, "integrity").catch((err) => {
        console.error("Etsy webhook integrity error:", String(err?.code || "ETSY_INTEGRITY_FAILED"));
      }));
    }
  }
};
function pickAllowOrigin(origin, env) {
  if (!origin) return "";
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch (_) {
    return "";
  }
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) return "";
  const normalizedOrigin = parsedOrigin.origin;
  if (normalizedOrigin === "https://extensions.shopifycdn.com") return normalizedOrigin;
  const exact = (env.ALLOW_ORIGIN_EXACT || "").replace(/\/+$/, "");
  const suffix = (env.ALLOW_ORIGIN_SUFFIX || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^\./, "");
  if (exact && normalizedOrigin === exact) return normalizedOrigin;
  const hostname = parsedOrigin.hostname.toLowerCase();
  if (suffix && (hostname === suffix || hostname.endsWith(`.${suffix}`))) return normalizedOrigin;
  return "";
}
__name(pickAllowOrigin, "pickAllowOrigin");
function corsHeaders(allowOrigin, allowHeaders) {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": allowHeaders || "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(body, allowOrigin, reqAllowHeaders, status = 200, extraHeaders = {}) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) {
    headers.set(k, v);
  }
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}
__name(jsonResponse, "jsonResponse");
function guessContentTypeFromKey(key2) {
  const lower = String(key2 || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
__name(guessContentTypeFromKey, "guessContentTypeFromKey");
var MANUAL_ASSETS_PREFIX = "manual-order-assets/";
var BLANKS_BATCHES_PREFIX = `${MANUAL_ASSETS_PREFIX}blanks-batches/`;
var SUPPLIER_STATUS_PREFIX = `${BLANKS_BATCHES_PREFIX}supplier-status/`;
var BLANKS_BATCH_INDEX_KEY = `${BLANKS_BATCHES_PREFIX}index.json`;
var MANUAL_MOCKUP_CONTENT_TYPES = /* @__PURE__ */ new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);
var PRINT_TITLES = /* @__PURE__ */ new Set([
  "T-shirt Breast Print",
  "T-shirt Chest Print",
  "T-shirt Full Print",
  "T-shirt Full Back Print",
  "T-shirt Half Back Print",
  "T-shirt Back Tag Print",
  "T-shirt Neck Tag Print",
  "T-shirt Sleeve Print",
  "Full Sleeve Print",
  "Half Sleeve Print",
  "Hood Print",
  "Sweatpants Small Logo Print",
  "Sweatpants Half Leg Print",
  "Sweatpants Full Leg Print",
  "Hat Front Print",
  "Hat Side Print",
  "Hat Back Print",
  "Drawstring Bag Full Print",
  "Drawstring Bag Small Print",
  "Tote Bag Small Print",
  "Tote Bag Half Print",
  "Tote Bag Full Print",
  "DTF Print"
]);
function isAllowedStorageKey(key2) {
  return key2.startsWith("previews/") || key2.startsWith("prompts/") || key2.startsWith(MANUAL_ASSETS_PREFIX);
}
__name(isAllowedStorageKey, "isAllowedStorageKey");
function normalizeManualOrderNumber(value) {
  const raw = String(value || "").trim().replace(/^#+/, "");
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return "";
  return raw;
}
__name(normalizeManualOrderNumber, "normalizeManualOrderNumber");
function manualManifestKey(orderNumber) {
  return `${MANUAL_ASSETS_PREFIX}orders/${orderNumber}/manifest.json`;
}
__name(manualManifestKey, "manualManifestKey");
function manualMockupKey(orderNumber, assetId2, ext) {
  return `${MANUAL_ASSETS_PREFIX}orders/${orderNumber}/mockups/${assetId2}.${ext}`;
}
__name(manualMockupKey, "manualMockupKey");
function manualChecklistKey(orderNumber) {
  return `${MANUAL_ASSETS_PREFIX}orders/${orderNumber}/manual-checklist.json`;
}
__name(manualChecklistKey, "manualChecklistKey");
function blanksBatchKey(batchId) {
  return `${BLANKS_BATCHES_PREFIX}${batchId}.json`;
}
__name(blanksBatchKey, "blanksBatchKey");
function normalizeBlanksBatchId(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 80 || !/^[A-Za-z0-9_-]+$/.test(raw)) return "";
  return raw;
}
__name(normalizeBlanksBatchId, "normalizeBlanksBatchId");
function makeBlanksBatchId() {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return `ssb-${date}-${random}`;
}
__name(makeBlanksBatchId, "makeBlanksBatchId");
function safeText(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}
__name(safeText, "safeText");
function normalizeBatchKeyPart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
__name(normalizeBatchKeyPart, "normalizeBatchKeyPart");
function batchOrderParts(orderName) {
  const parts = String(orderName || "").split(" \u2013 ");
  return {
    number: safeText(parts[0] || orderName, 80),
    customer: safeText(parts.slice(1).join(" \u2013 "), 160)
  };
}
__name(batchOrderParts, "batchOrderParts");
function batchItemStableId(item, index2) {
  const stableId = item?.lineItemId || item?.shopifyLineItemId || item?.admin_graphql_api_id || item?.id;
  if (stableId) return `line:${String(stableId).slice(0, 160)}`;
  return [
    "manual",
    index2,
    normalizeBatchKeyPart(item?.title),
    normalizeBatchKeyPart(item?.variantTitle),
    Number(item?.qty) || 0
  ].join("|");
}
__name(batchItemStableId, "batchItemStableId");
function batchManifestItemKey(item) {
  const sku = safeText(item?.sku, 120);
  if (sku) return `sku:${sku.toLowerCase()}`;
  return [
    "variant",
    normalizeBatchKeyPart(item?.title),
    normalizeBatchKeyPart(item?.variantTitle)
  ].join("|");
}
__name(batchManifestItemKey, "batchManifestItemKey");
function isBatchPrintItem(item) {
  return PRINT_TITLES.has(item?.title);
}
__name(isBatchPrintItem, "isBatchPrintItem");
function isBatchGarmentItem(item) {
  return !isBatchPrintItem(item) && !isSupplierService(item) && Boolean(safeText(item?.sku, 120));
}
__name(isBatchGarmentItem, "isBatchGarmentItem");
function makeBlanksBatchLabel(now) {
  const day = now.toISOString().slice(0, 10);
  return `S&S Batch ${day}`;
}
__name(makeBlanksBatchLabel, "makeBlanksBatchLabel");
var GARMENT_COST_ORDER_QUERY = `query PrintMOGarmentCostOrder($id: ID!, $after: String) {
  order(id: $id) { id name lineItems(first: 100, after: $after) {
    nodes { id title variantTitle sku currentQuantity
      variant { id sku inventoryItem { unitCost { amount currencyCode } } }
    }
    pageInfo { hasNextPage endCursor }
  } }
}`;
function validCostOrderId(id2) {
  return /^gid:\/\/shopify\/Order\/\d+$/.test(id2) || /^etsy:\d+:\d+$/.test(id2);
}
__name(validCostOrderId, "validCostOrderId");
function garmentCostService(env) {
  return createGarmentCostService({
    shopKey: shopDomain(env),
    isPrint: isBatchPrintItem,
    graphql: /* @__PURE__ */ __name((query, variables, name) => coordinatorGraphQL(env, query, variables, name), "graphql"),
    readOrder: /* @__PURE__ */ __name(async (id2) => {
      if (id2.startsWith("etsy:")) {
        const { record } = await readProviderOrder(env, id2);
        return {
          id: id2,
          name: record.contract.displayName,
          provider: "etsy",
          items: providerDetailLineItems(record.contract)
        };
      }
      const shop = await d1Shop(env);
      const claims = shelfEnabled(env) ? (await requireOrderDb(env).prepare(
        "SELECT line_item_gid, variant_gid, sku, qty FROM shelf_claims WHERE shop_id = ? AND order_gid = ?"
      ).bind(shop.id, id2).all()).results || [] : [];
      const held = new Map(claims.filter((claim) => claim.qty > 0).map((claim) => [claim.line_item_gid, claim]));
      const items = [];
      let after = null;
      let name = "";
      for (let page = 0; page < 20; page++) {
        const result = await coordinatorGraphQL(
          env,
          GARMENT_COST_ORDER_QUERY,
          { id: id2, after },
          "PrintMOGarmentCostOrder"
        );
        const order = requireShopifyData(result, "PrintMOGarmentCostOrder").order;
        if (!order) throw new Error("Order not found");
        name = order.name;
        for (const item of order.lineItems.nodes) {
          const claim = held.get(item.id);
          if (claim && (claim.variant_gid !== item.variant?.id || claim.sku !== item.sku || claim.qty > item.currentQuantity))
            throw new Error("Shelf allocation needs review");
          held.delete(item.id);
          items.push({
            ...item,
            variantId: item.variant?.id || null,
            shelfQuantity: claim?.qty || 0,
            ...item.variant && Object.hasOwn(item.variant, "inventoryItem") ? { catalogCost: { ...item.variant.inventoryItem?.unitCost, sku: item.variant.sku } } : {}
          });
        }
        if (!order.lineItems.pageInfo.hasNextPage) {
          if (held.size) throw new Error("Shelf allocation needs review");
          return { id: id2, name, provider: "shopify", items };
        }
        after = order.lineItems.pageInfo.endCursor;
        if (!after) break;
      }
      throw new Error("Order lines incomplete");
    }, "readOrder")
  });
}
__name(garmentCostService, "garmentCostService");
async function handleGarmentCosts(request, env, origin, headers) {
  try {
    const body = await request.json();
    const ids = Array.isArray(body.orderIds) ? [...new Set(body.orderIds)] : [];
    if (!ids.length || ids.length > 50 || ids.some((id2) => typeof id2 !== "string" || !validCostOrderId(id2)))
      return v1Error({ code: "INVALID_ORDER_IDS", message: "Supply 1\u201350 valid order identities." }, origin, headers, 400);
    return jsonResponse({ estimates: await garmentCostService(env).estimates(ids) }, origin, headers);
  } catch (_) {
    return v1Error({ code: "COST_LOOKUP_FAILED", message: "Catalog costs could not load. Retry the estimate." }, origin, headers, 503);
  }
}
__name(handleGarmentCosts, "handleGarmentCosts");
async function captureGarmentCosts(env, body) {
  const orders = Array.isArray(body.orders) ? body.orders.slice(0, 300) : [];
  const ids = orders.map((order) => String(order.orderId || order.gid || order.id || "")).filter(validCostOrderId);
  let estimates = [];
  try {
    estimates = await garmentCostService(env).estimates(ids);
  } catch (_) {
  }
  const byId = new Map(estimates.map((estimate) => [estimate.orderId, estimate]));
  const capturedAt = isoNow();
  return { ...body, orders: orders.map((order) => {
    const id2 = String(order.orderId || order.gid || order.id || "");
    return { ...order, garmentCostSnapshot: validCostOrderId(id2) ? { ...byId.get(id2) || unavailableEstimate(id2, order.name), capturedAt } : null };
  }) };
}
__name(captureGarmentCosts, "captureGarmentCosts");
function buildBlanksBatch(body) {
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const rawOrders = Array.isArray(body?.orders) ? body.orders.slice(0, 300) : [];
  const id2 = normalizeBlanksBatchId(body?.id) || makeBlanksBatchId();
  const supplierOrderNumber = safeText(body?.supplierOrderNumber, 80);
  const label = safeText(body?.label, 120) || (supplierOrderNumber ? `S&S ${supplierOrderNumber}` : makeBlanksBatchLabel(now));
  const source = safeText(body?.source, 80) || "mark-in-cart-ordered";
  const orders = [];
  const manifestByKey = /* @__PURE__ */ new Map();
  rawOrders.forEach((rawOrder) => {
    const name = safeText(rawOrder?.name, 240);
    if (!name) return;
    const orderId = safeText(rawOrder?.orderId || rawOrder?.gid || rawOrder?.id, 240);
    const parts = batchOrderParts(name);
    const orderNumber = safeText(rawOrder?.orderNumber, 80) || parts.number;
    const customer = safeText(rawOrder?.customer, 160) || parts.customer;
    const receivedAt = safeText(rawOrder?.receivedAt, 80);
    let garmentCount = 0;
    const items = Array.isArray(rawOrder?.items) ? rawOrder.items : [];
    items.forEach((item, index2) => {
      if (!item || !isBatchGarmentItem(item)) return;
      const qty = Math.max(0, Number(item.qty) || 0);
      if (!qty) return;
      const title = safeText(item.title, 240) || "Untitled garment";
      const variantTitle = safeText(item.variantTitle, 240);
      const sku = safeText(item.sku, 120);
      const itemKey = batchManifestItemKey(item);
      const lineId = batchItemStableId(item, index2);
      garmentCount += qty;
      if (!manifestByKey.has(itemKey)) {
        manifestByKey.set(itemKey, {
          itemKey,
          title,
          variantTitle,
          sku,
          expectedQty: 0,
          receivedQty: 0,
          accountedQty: 0,
          orderLines: []
        });
      }
      const manifestLine = manifestByKey.get(itemKey);
      manifestLine.expectedQty += qty;
      manifestLine.orderLines.push({
        orderId,
        orderName: name,
        orderNumber,
        customer,
        lineId,
        title,
        variantTitle,
        sku,
        expectedQty: qty,
        accountedQty: 0
      });
    });
    orders.push({
      orderId,
      name,
      orderNumber,
      customer,
      receivedAt,
      garmentCount,
      ...rawOrder.garmentCostSnapshot ? { garmentCostSnapshot: rawOrder.garmentCostSnapshot } : {}
    });
  });
  const manifest = Array.from(manifestByKey.values()).map((line) => ({
    ...line,
    missingQty: Math.max(0, line.expectedQty - line.receivedQty)
  })).sort((left, right) => {
    const leftLabel = `${left.title} ${left.variantTitle} ${left.sku}`;
    const rightLabel = `${right.title} ${right.variantTitle} ${right.sku}`;
    return leftLabel.localeCompare(rightLabel);
  });
  const expectedGarments = manifest.reduce((sum, line) => sum + line.expectedQty, 0);
  return {
    version: 1,
    id: id2,
    label,
    supplierOrderNumber,
    purchaseOrderNumber: safeText(body?.purchaseOrderNumber, 80),
    trackingNumber: safeText(body?.trackingNumber, 120),
    status: "ordered",
    source,
    createdAt: nowIso,
    updatedAt: nowIso,
    orderNames: orders.map((order) => order.name),
    orderIds: orders.map((order) => order.orderId).filter(Boolean),
    orders,
    manifest,
    totals: {
      orderCount: orders.length,
      manifestLineCount: manifest.length,
      expectedGarments,
      receivedGarments: 0,
      accountedGarments: 0,
      missingGarments: expectedGarments
    }
  };
}
__name(buildBlanksBatch, "buildBlanksBatch");
function blanksBatchIndexEntry(batch) {
  return {
    id: batch.id,
    key: blanksBatchKey(batch.id),
    label: batch.label,
    supplierOrderNumber: batch.supplierOrderNumber || "",
    purchaseOrderNumber: batch.purchaseOrderNumber || "",
    trackingNumber: batch.trackingNumber || "",
    status: batch.status,
    source: batch.source,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    orderNames: Array.isArray(batch.orderNames) ? batch.orderNames : [],
    orderIds: Array.isArray(batch.orderIds) ? batch.orderIds : Array.isArray(batch.orders) ? batch.orders.map((order) => order?.orderId).filter(Boolean) : [],
    orderCount: batch.totals?.orderCount || 0,
    manifestLineCount: batch.totals?.manifestLineCount || 0,
    expectedGarments: batch.totals?.expectedGarments || 0,
    receivedGarments: batch.totals?.receivedGarments || 0,
    missingGarments: batch.totals?.missingGarments || 0,
    pendingAllocationLines: (batch.manifest || []).filter((line) => line.allocationConfirmed === false).length
  };
}
__name(blanksBatchIndexEntry, "blanksBatchIndexEntry");
function blanksBatchOrderIdentity(order) {
  const orderId = safeText(order?.orderId || order?.gid || order?.id, 240);
  if (orderId) return `id:${orderId}`;
  const name = safeText(order?.name || order?.orderName, 240);
  return name ? `name:${name}` : "";
}
__name(blanksBatchOrderIdentity, "blanksBatchOrderIdentity");
function blanksBatchOrderIdentities(orders) {
  return new Set((Array.isArray(orders) ? orders : []).map(blanksBatchOrderIdentity).filter(Boolean));
}
__name(blanksBatchOrderIdentities, "blanksBatchOrderIdentities");
function batchContainsIncomingOrder(batch, incomingOrder) {
  const incomingIdentity = blanksBatchOrderIdentity(incomingOrder);
  if (!incomingIdentity) return false;
  return (Array.isArray(batch?.orders) ? batch.orders : []).some((order) => {
    const storedIdentity = blanksBatchOrderIdentity(order);
    if (storedIdentity === incomingIdentity) return true;
    if (storedIdentity.startsWith("id:") && incomingIdentity.startsWith("id:")) return false;
    return safeText(order?.name, 240) === safeText(incomingOrder?.name || incomingOrder?.orderName, 240);
  });
}
__name(batchContainsIncomingOrder, "batchContainsIncomingOrder");
function indexEntryContainsIncomingOrder(entry, incomingOrder) {
  const orderId = safeText(incomingOrder?.orderId || incomingOrder?.gid || incomingOrder?.id, 240);
  const name = safeText(incomingOrder?.name || incomingOrder?.orderName, 240);
  return Boolean(
    orderId && (Array.isArray(entry?.orderIds) ? entry.orderIds : []).includes(orderId) || name && (Array.isArray(entry?.orderNames) ? entry.orderNames : []).includes(name)
  );
}
__name(indexEntryContainsIncomingOrder, "indexEntryContainsIncomingOrder");
function batchOrderSortValue(batch, orderName) {
  const order = (Array.isArray(batch?.orders) ? batch.orders : []).find((item) => item?.name === orderName);
  const time = Date.parse(order?.receivedAt || "");
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}
__name(batchOrderSortValue, "batchOrderSortValue");
function applyOldestFirstAllocation(batch) {
  const orderTotals = /* @__PURE__ */ new Map();
  (Array.isArray(batch.orders) ? batch.orders : []).forEach((order) => {
    orderTotals.set(order.name, {
      expectedGarments: Number(order.garmentCount) || 0,
      accountedGarments: 0,
      missingGarments: Number(order.garmentCount) || 0,
      fullyAccounted: false
    });
  });
  let expectedGarments = 0;
  let receivedGarments = 0;
  let accountedGarments = 0;
  let missingGarments = 0;
  batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : []).map((line) => {
    const expectedQty = Math.max(0, Number(line.expectedQty) || 0);
    const receivedQty = Math.max(0, Number(line.receivedQty) || 0);
    let remaining = receivedQty;
    let lineAccounted = 0;
    const orderLines = (Array.isArray(line.orderLines) ? line.orderLines : []).map((orderLine) => ({
      ...orderLine,
      expectedQty: Math.max(0, Number(orderLine.expectedQty) || 0),
      accountedQty: 0
    })).sort((left, right) => {
      const leftTime = batchOrderSortValue(batch, left.orderName);
      const rightTime = batchOrderSortValue(batch, right.orderName);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.orderName || "").localeCompare(String(right.orderName || ""));
    });
    const orderNames = new Set(orderLines.map((orderLine) => orderLine.orderName));
    const shared = orderNames.size > 1;
    const confirmedNames = Object.keys(line.confirmedAllocation || {});
    const confirmedTotal = confirmedNames.reduce((sum, name) => sum + (Number(line.confirmedAllocation[name]) || 0), 0);
    const confirmed = shared && line.allocationConfirmed === true && confirmedNames.length === orderNames.size && confirmedNames.every((name) => orderNames.has(name)) && confirmedTotal === Math.min(receivedQty, expectedQty);
    if (confirmed) {
      const remainingForOrder = new Map(Object.entries(line.confirmedAllocation || {}).map(([name, quantity]) => [name, Math.max(0, Number(quantity) || 0)]));
      orderLines.forEach((orderLine) => {
        const requested = remainingForOrder.get(orderLine.orderName) || 0;
        const assigned = Math.min(orderLine.expectedQty, requested, remaining);
        orderLine.accountedQty = assigned;
        remainingForOrder.set(orderLine.orderName, requested - assigned);
        remaining -= assigned;
        lineAccounted += assigned;
      });
    }
    orderLines.forEach((orderLine) => {
      const accountedQty = Math.min(orderLine.expectedQty - orderLine.accountedQty, remaining);
      orderLine.accountedQty += accountedQty;
      remaining -= accountedQty;
      lineAccounted += accountedQty;
      if (!orderTotals.has(orderLine.orderName)) {
        orderTotals.set(orderLine.orderName, {
          expectedGarments: 0,
          accountedGarments: 0,
          missingGarments: 0,
          fullyAccounted: false
        });
      }
      const totals = orderTotals.get(orderLine.orderName);
      totals.accountedGarments += orderLine.accountedQty;
    });
    const missingQty = Math.max(0, expectedQty - lineAccounted);
    expectedGarments += expectedQty;
    receivedGarments += receivedQty;
    accountedGarments += lineAccounted;
    missingGarments += missingQty;
    return {
      ...line,
      expectedQty,
      receivedQty,
      accountedQty: lineAccounted,
      missingQty,
      extraQty: Math.max(0, receivedQty - expectedQty),
      allocationConfirmed: !shared || confirmed,
      orderLines
    };
  });
  batch.orders = (Array.isArray(batch.orders) ? batch.orders : []).map((order) => {
    const totals = orderTotals.get(order.name) || {
      expectedGarments: Number(order.garmentCount) || 0,
      accountedGarments: 0,
      missingGarments: Number(order.garmentCount) || 0,
      fullyAccounted: false
    };
    const expected = totals.expectedGarments;
    const accounted = Math.min(expected, totals.accountedGarments);
    const missing = Math.max(0, expected - accounted);
    return {
      ...order,
      accountedGarments: accounted,
      missingGarments: missing,
      fullyAccounted: expected > 0 && missing === 0 && !batch.manifest.some((line) => line.allocationConfirmed === false && line.orderLines?.some((orderLine) => orderLine.orderName === order.name))
    };
  });
  batch.totals = {
    ...batch.totals || {},
    orderCount: batch.orders.length,
    manifestLineCount: batch.manifest.length,
    expectedGarments,
    receivedGarments,
    accountedGarments,
    missingGarments,
    fullyAccountedOrders: batch.orders.filter((order) => order.fullyAccounted).length
  };
  batch.status = expectedGarments > 0 ? missingGarments === 0 ? "received" : "ordered" : "empty";
  batch.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return batch;
}
__name(applyOldestFirstAllocation, "applyOldestFirstAllocation");
async function readBlanksBatch(env, batchId) {
  const id2 = normalizeBlanksBatchId(batchId);
  if (!id2) return null;
  const obj = await env.PREVIEWS.get(blanksBatchKey(id2));
  if (!obj) return null;
  const batch = JSON.parse(await obj.text());
  return batch && typeof batch === "object" ? batch : null;
}
__name(readBlanksBatch, "readBlanksBatch");
function receiveQtyUpdatesFromBody(body) {
  if (Array.isArray(body?.updates)) {
    return body.updates.map((update) => ({
      itemKey: safeText(update?.itemKey, 1e3),
      receivedQty: Math.max(0, Number(update?.receivedQty) || 0)
    })).filter((update) => update.itemKey);
  }
  if (body?.received && typeof body.received === "object" && !Array.isArray(body.received)) {
    return Object.entries(body.received).map(([itemKey, receivedQty]) => ({
      itemKey: safeText(itemKey, 1e3),
      receivedQty: Math.max(0, Number(receivedQty) || 0)
    })).filter((update) => update.itemKey);
  }
  return [];
}
__name(receiveQtyUpdatesFromBody, "receiveQtyUpdatesFromBody");
function applyReceivingUpdates(batch, body) {
  const updates = receiveQtyUpdatesFromBody(body);
  if (!updates.length) return { ok: false, error: "No receiving updates provided" };
  const byKey = new Map(updates.map((update) => [update.itemKey, update.receivedQty]));
  let matched = 0;
  batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : []).map((line) => {
    if (!byKey.has(line.itemKey)) return line;
    matched += 1;
    return {
      ...line,
      receivedQty: byKey.get(line.itemKey),
      allocationConfirmed: new Set((line.orderLines || []).map((orderLine) => orderLine.orderName)).size > 1 ? byKey.get(line.itemKey) === Number(line.receivedQty) && line.allocationConfirmed === true : true,
      confirmedAllocation: byKey.get(line.itemKey) === Number(line.receivedQty) ? line.confirmedAllocation : void 0
    };
  });
  if (!matched) return { ok: false, error: "No matching manifest lines found" };
  return { ok: true, batch: applyOldestFirstAllocation(batch) };
}
__name(applyReceivingUpdates, "applyReceivingUpdates");
function applyAllocationConfirmation(batch, body) {
  const itemKey = safeText(body?.itemKey, 1e3);
  const line = (batch.manifest || []).find((item) => item.itemKey === itemKey);
  if (!line) return { ok: false, error: "Manifest line not found" };
  const orderLines = Array.isArray(line.orderLines) ? line.orderLines : [];
  const allocations = body?.allocations;
  if (!allocations || typeof allocations !== "object" || Array.isArray(allocations)) {
    return { ok: false, error: "Order allocations are required" };
  }
  const expectedByOrder = /* @__PURE__ */ new Map();
  orderLines.forEach((orderLine) => expectedByOrder.set(
    orderLine.orderName,
    (expectedByOrder.get(orderLine.orderName) || 0) + Number(orderLine.expectedQty || 0)
  ));
  const names = new Set(expectedByOrder.keys());
  if (Object.keys(allocations).some((name) => !names.has(name))) {
    return { ok: false, error: "Allocation contains an unknown order" };
  }
  const confirmedAllocation = {};
  let total = 0;
  for (const [name, expected] of expectedByOrder) {
    const amount = allocations[name];
    if (!Number.isInteger(amount) || amount < 0 || amount > expected) {
      return { ok: false, error: "Each allocation must be a whole number within the order quantity" };
    }
    confirmedAllocation[name] = amount;
    total += amount;
  }
  if (total !== Math.min(Number(line.receivedQty) || 0, Number(line.expectedQty) || 0)) {
    return { ok: false, error: "Allocate every received usable garment before confirming" };
  }
  line.confirmedAllocation = confirmedAllocation;
  line.allocationConfirmed = true;
  return { ok: true, batch: applyOldestFirstAllocation(batch) };
}
__name(applyAllocationConfirmation, "applyAllocationConfirmation");
function applyBatchReferenceUpdate(batch, body) {
  const supplierOrderNumber = safeText(body?.supplierOrderNumber, 80);
  if (!supplierOrderNumber) return { ok: false, error: "S&S order number is required" };
  batch.supplierOrderNumber = supplierOrderNumber;
  batch.purchaseOrderNumber = safeText(body?.purchaseOrderNumber, 80);
  batch.trackingNumber = safeText(body?.trackingNumber, 120);
  batch.label = `S&S ${supplierOrderNumber}`;
  batch.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return { ok: true, batch };
}
__name(applyBatchReferenceUpdate, "applyBatchReferenceUpdate");
function orderNamesFromBody(body) {
  const rawNames = Array.isArray(body?.orderNames) ? body.orderNames : Array.isArray(body?.names) ? body.names : [];
  return Array.from(new Set(rawNames.map((name) => safeText(name, 240)).filter(Boolean)));
}
__name(orderNamesFromBody, "orderNamesFromBody");
function removeOrdersFromBatch(batch, body) {
  const orderNames = orderNamesFromBody(body);
  if (!orderNames.length) return { ok: false, error: "No order names provided" };
  const result = removeIncomingOrdersFromBatch(batch, orderNames.map((name) => ({ name })));
  if (!result.removedCount) return { ok: false, error: "No matching batch orders found" };
  return { ok: true, batch: result.batch, removedCount: result.removedCount };
}
__name(removeOrdersFromBatch, "removeOrdersFromBatch");
function addOrdersToBatch(batch, body) {
  const addBatch = buildBlanksBatch({
    orders: Array.isArray(body?.orders) ? body.orders : [],
    source: "manual-batch-add"
  });
  if (!addBatch.orders.length) return { ok: false, error: "At least one order is required" };
  if (!addBatch.manifest.length || !addBatch.totals.expectedGarments) {
    return { ok: false, error: "Orders have no garment line items" };
  }
  const duplicateOrders = addBatch.orders.filter((order) => batchContainsIncomingOrder(batch, order));
  if (duplicateOrders.length === addBatch.orders.length) {
    return { ok: false, error: "All provided orders are already in this batch" };
  }
  const duplicateIdentities = blanksBatchOrderIdentities(duplicateOrders);
  const incomingOrders = addBatch.orders.filter((order) => !duplicateIdentities.has(blanksBatchOrderIdentity(order)));
  const allowedNames = new Set(incomingOrders.map((order) => order.name));
  batch.orders = [
    ...Array.isArray(batch.orders) ? batch.orders : [],
    ...incomingOrders
  ];
  batch.orderNames = batch.orders.map((order) => order.name).filter(Boolean);
  batch.orderIds = batch.orders.map((order) => order.orderId).filter(Boolean);
  const manifestByKey = new Map((Array.isArray(batch.manifest) ? batch.manifest : []).map((line) => [line.itemKey, { ...line, orderLines: Array.isArray(line.orderLines) ? line.orderLines.slice() : [] }]));
  addBatch.manifest.forEach((incomingLine) => {
    const incomingOrderLines = (Array.isArray(incomingLine.orderLines) ? incomingLine.orderLines : []).filter((orderLine) => allowedNames.has(orderLine?.orderName));
    if (!incomingOrderLines.length) return;
    if (!manifestByKey.has(incomingLine.itemKey)) {
      manifestByKey.set(incomingLine.itemKey, {
        ...incomingLine,
        receivedQty: 0,
        accountedQty: 0,
        missingQty: incomingOrderLines.reduce((sum, orderLine) => sum + (Number(orderLine.expectedQty) || 0), 0),
        orderLines: []
      });
    }
    const line = manifestByKey.get(incomingLine.itemKey);
    line.orderLines.push(...incomingOrderLines);
    line.expectedQty = line.orderLines.reduce((sum, orderLine) => {
      return sum + Math.max(0, Number(orderLine?.expectedQty) || 0);
    }, 0);
  });
  batch.manifest = Array.from(manifestByKey.values()).sort((left, right) => {
    const leftLabel = `${left.title} ${left.variantTitle} ${left.sku}`;
    const rightLabel = `${right.title} ${right.variantTitle} ${right.sku}`;
    return leftLabel.localeCompare(rightLabel);
  });
  return {
    ok: true,
    batch: applyOldestFirstAllocation(batch),
    addedCount: incomingOrders.length,
    duplicateNames: duplicateOrders.map((order) => order.name)
  };
}
__name(addOrdersToBatch, "addOrdersToBatch");
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
__name(cloneJson, "cloneJson");
function removeIncomingOrdersFromBatch(batch, incomingOrders) {
  const matchingOrders = (Array.isArray(batch?.orders) ? batch.orders : []).filter((order) => incomingOrders.some((incoming) => batchContainsIncomingOrder({ orders: [order] }, incoming)));
  if (!matchingOrders.length) return { batch, removedCount: 0, movedReceivedByItemKey: /* @__PURE__ */ new Map() };
  const identities = blanksBatchOrderIdentities(matchingOrders);
  const names = new Set(matchingOrders.map((order) => order.name).filter(Boolean));
  const matchesStoredOrder = /* @__PURE__ */ __name((value) => {
    const identity = blanksBatchOrderIdentity(value);
    return Boolean(identity && identities.has(identity) || names.has(value?.name || value?.orderName));
  }, "matchesStoredOrder");
  const movedReceivedByItemKey = /* @__PURE__ */ new Map();
  batch.orders = (Array.isArray(batch.orders) ? batch.orders : []).filter((order) => !matchesStoredOrder(order));
  batch.orderNames = batch.orders.map((order) => order.name).filter(Boolean);
  batch.orderIds = batch.orders.map((order) => order.orderId).filter(Boolean);
  batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : []).map((line) => {
    const orderLines = Array.isArray(line.orderLines) ? line.orderLines : [];
    const removedLines = orderLines.filter((orderLine) => matchesStoredOrder({
      orderId: orderLine?.orderId,
      name: orderLine?.orderName
    }));
    const movedReceived = removedLines.reduce((sum, orderLine) => {
      return sum + Math.max(0, Number(orderLine?.accountedQty) || 0);
    }, 0);
    if (movedReceived) {
      movedReceivedByItemKey.set(line.itemKey, (movedReceivedByItemKey.get(line.itemKey) || 0) + movedReceived);
    }
    const keptLines = orderLines.filter((orderLine) => !removedLines.includes(orderLine));
    return {
      ...line,
      expectedQty: keptLines.reduce((sum, orderLine) => sum + Math.max(0, Number(orderLine?.expectedQty) || 0), 0),
      receivedQty: Math.max(0, (Number(line.receivedQty) || 0) - movedReceived),
      orderLines: keptLines
    };
  }).filter((line) => (Number(line.expectedQty) || 0) > 0);
  return {
    batch: applyOldestFirstAllocation(batch),
    removedCount: matchingOrders.length,
    movedReceivedByItemKey
  };
}
__name(removeIncomingOrdersFromBatch, "removeIncomingOrdersFromBatch");
function applyTransferredReceiving(batch, movedReceivedByItemKey, incomingOrders) {
  const incomingBatch = buildBlanksBatch({ orders: incomingOrders });
  const incomingExpectedByKey = new Map((incomingBatch.manifest || []).map((line) => [
    line.itemKey,
    Math.max(0, Number(line.expectedQty) || 0)
  ]));
  batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : []).map((line) => {
    const transferred = Math.min(
      incomingExpectedByKey.get(line.itemKey) || 0,
      movedReceivedByItemKey.get(line.itemKey) || 0
    );
    return transferred ? { ...line, receivedQty: (Number(line.receivedQty) || 0) + transferred } : line;
  });
  return applyOldestFirstAllocation(batch);
}
__name(applyTransferredReceiving, "applyTransferredReceiving");
async function assignOrdersToBatch(env, targetBatch, body) {
  const incomingOrders = Array.isArray(body?.orders) ? body.orders : [];
  const incomingBatch = buildBlanksBatch({
    orders: incomingOrders,
    source: "manual-batch-assignment"
  });
  if (!incomingBatch.orders.length) return { ok: false, error: "At least one order is required" };
  if (!incomingBatch.manifest.length || !incomingBatch.totals.expectedGarments) {
    return { ok: false, error: "Orders have no garment line items" };
  }
  const newOrders = incomingOrders.filter((order) => !batchContainsIncomingOrder(targetBatch, order));
  if (!newOrders.length) return { ok: false, error: "All provided orders are already in this batch" };
  const originalIndex = await readBlanksBatchIndex(env);
  const sourceEntries = originalIndex.batches.filter((entry) => {
    return entry?.id !== targetBatch.id && newOrders.some((order) => indexEntryContainsIncomingOrder(entry, order));
  });
  const sources = [];
  for (const entry of sourceEntries) {
    const source = await readBlanksBatch(env, entry.id);
    if (source && newOrders.some((order) => batchContainsIncomingOrder(source, order))) sources.push(source);
  }
  const originals = /* @__PURE__ */ new Map([[targetBatch.id, cloneJson(targetBatch)]]);
  sources.forEach((source) => originals.set(source.id, cloneJson(source)));
  const movedReceivedByItemKey = /* @__PURE__ */ new Map();
  const affectedBatches = [];
  const emptiedBatchIds = [];
  sources.forEach((source) => {
    for (const incoming of newOrders) {
      const previous = (source.orders || []).find((order) => blanksBatchOrderIdentity(order) === blanksBatchOrderIdentity(incoming));
      if (previous?.garmentCostSnapshot) incoming.garmentCostSnapshot = previous.garmentCostSnapshot;
    }
    const result = removeIncomingOrdersFromBatch(source, newOrders);
    result.movedReceivedByItemKey.forEach((quantity, itemKey) => {
      movedReceivedByItemKey.set(itemKey, (movedReceivedByItemKey.get(itemKey) || 0) + quantity);
    });
    if (result.removedCount) {
      if (result.batch.orders.length) affectedBatches.push(result.batch);
      else emptiedBatchIds.push(result.batch.id);
    }
  });
  const added = addOrdersToBatch(targetBatch, { orders: newOrders });
  if (!added.ok) return added;
  const updatedTarget = applyTransferredReceiving(added.batch, movedReceivedByItemKey, newOrders);
  const changedBatches = [updatedTarget, ...affectedBatches];
  const changedIds = new Set(changedBatches.map((batch) => batch.id));
  const removedIds = new Set(emptiedBatchIds);
  const nextIndex = {
    ...originalIndex,
    batches: originalIndex.batches.filter((entry) => !changedIds.has(entry?.id) && !removedIds.has(entry?.id)).concat(changedBatches.map(blanksBatchIndexEntry)).sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
  };
  try {
    for (const batch of changedBatches) await writeBlanksBatch(env, batch);
    const writtenIndex = await writeBlanksBatchIndex(env, nextIndex);
    for (const batchId of emptiedBatchIds) {
      if (typeof env.PREVIEWS.delete === "function") await env.PREVIEWS.delete(blanksBatchKey(batchId));
    }
    return {
      ok: true,
      batch: updatedTarget,
      affectedBatches,
      removedBatchIds: emptiedBatchIds,
      movedFromBatchIds: sources.map((source) => source.id),
      indexUpdatedAt: writtenIndex.updatedAt
    };
  } catch (error) {
    try {
      for (const original of originals.values()) await writeBlanksBatch(env, original);
      await writeBlanksBatchIndex(env, originalIndex);
    } catch (rollbackError) {
      console.error("Blanks batch assignment rollback failed", rollbackError);
    }
    throw error;
  }
}
__name(assignOrdersToBatch, "assignOrdersToBatch");
function applyBatchOrderAction(batch, body) {
  const action = safeText(body?.action, 80);
  if (action === "remove-orders") return removeOrdersFromBatch(batch, body);
  if (action === "add-orders") return addOrdersToBatch(batch, body);
  if (action === "confirm-allocation") return applyAllocationConfirmation(batch, body);
  if (action === "update-reference") return applyBatchReferenceUpdate(batch, body);
  return applyReceivingUpdates(batch, body);
}
__name(applyBatchOrderAction, "applyBatchOrderAction");
async function readBlanksBatchIndex(env) {
  const obj = await env.PREVIEWS.get(BLANKS_BATCH_INDEX_KEY);
  if (!obj) return { version: 1, updatedAt: "", batches: [] };
  try {
    const state = JSON.parse(await obj.text());
    return {
      version: 1,
      updatedAt: safeText(state?.updatedAt, 80),
      batches: Array.isArray(state?.batches) ? state.batches : []
    };
  } catch (err) {
    return { version: 1, updatedAt: "", batches: [] };
  }
}
__name(readBlanksBatchIndex, "readBlanksBatchIndex");
function supplierNumbers(reference) {
  const parts = String(reference || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (parts.length > 25 || new Set(parts).size !== parts.length) return [];
  return parts.every((value) => /^\d{5,12}$/.test(value)) ? parts : [];
}
__name(supplierNumbers, "supplierNumbers");
function supplierReferencesOverlap(left, right) {
  const leftNumbers = supplierNumbers(left);
  const rightNumbers = supplierNumbers(right);
  if (leftNumbers.length && rightNumbers.length) return leftNumbers.some((number) => rightNumbers.includes(number));
  return Boolean(String(left || "").trim()) && String(left || "").trim() === String(right || "").trim();
}
__name(supplierReferencesOverlap, "supplierReferencesOverlap");
async function readSupplierStatus(env, number) {
  const object2 = await env.PREVIEWS.get(`${SUPPLIER_STATUS_PREFIX}${number}.json`);
  if (!object2) return null;
  try {
    return JSON.parse(await object2.text());
  } catch {
    return null;
  }
}
__name(readSupplierStatus, "readSupplierStatus");
async function writeSupplierStatus(env, item) {
  if (!item || !/^\d{5,12}$/.test(String(item.orderNumber || "")) || !item.observedAt) return;
  await env.PREVIEWS.put(`${SUPPLIER_STATUS_PREFIX}${item.orderNumber}.json`, JSON.stringify(item), {
    httpMetadata: { contentType: "application/json" }
  });
}
__name(writeSupplierStatus, "writeSupplierStatus");
function summarizeSupplierStatuses(items) {
  if (!items.length) return null;
  const known = items.filter(Boolean);
  if (!known.length) return { state: "pending", items: [], observedAt: "" };
  const states = known.map((item) => item.state);
  let state = "processing";
  if (states.includes("exception")) state = "exception";
  else if (states.includes("canceled")) state = "canceled";
  else if (known.length === items.length && states.every((value) => value === "delivered")) state = "delivered";
  else if (states.includes("delivered") || states.includes("partially_delivered")) state = "partially_delivered";
  else if (states.includes("out_for_delivery")) state = "out_for_delivery";
  else if (states.includes("in_transit")) state = "in_transit";
  else if (states.includes("pickup_ready")) state = "pickup_ready";
  else if (states.every((value) => value === "not_found")) state = "not_found";
  return {
    state,
    observedAt: known.map((item) => item.observedAt || "").sort()[0] || "",
    items: items.map((item) => item || null)
  };
}
__name(summarizeSupplierStatuses, "summarizeSupplierStatuses");
async function supplierStatusForReference(env, reference) {
  const numbers = supplierNumbers(reference);
  if (!numbers.length) return null;
  const items = await Promise.all(numbers.map((number) => readSupplierStatus(env, number)));
  return summarizeSupplierStatuses(items);
}
__name(supplierStatusForReference, "supplierStatusForReference");
async function syncSupplierOrderStatuses(env, requestedNumbers = null) {
  if (!env.PREVIEWS || !env.UPSTREAM_BASE || !env.ORDER_MANAGER_ADMIN_KEY) return { checked: 0 };
  const index2 = await readBlanksBatchIndex(env);
  const active = requestedNumbers ? index2.batches : index2.batches.filter((batch) => Number(batch.missingGarments) > 0);
  const numbers = [...new Set(active.flatMap((batch) => supplierNumbers(batch.supplierOrderNumber)))];
  const candidates = requestedNumbers ? numbers.filter((number) => requestedNumbers.includes(number)) : numbers;
  if (!candidates.length) return { checked: 0 };
  const snapshots = await Promise.all(candidates.map(async (number) => ({ number, status: await readSupplierStatus(env, number) })));
  snapshots.sort((a, b) => String(a.status?.observedAt || "").localeCompare(String(b.status?.observedAt || "")));
  const due = snapshots.filter(({ status }) => !status?.observedAt || Date.now() - Date.parse(status.observedAt) >= 6e4);
  const chosen = due.slice(0, 25).map((entry) => entry.number);
  if (!chosen.length) return { checked: 0 };
  const result = await upstreamDataRequest(env, `/order-manager/v1/supplier/ss/order-status?orders=${chosen.join(",")}`);
  const items = Array.isArray(result?.items) ? result.items : [];
  if (items.length !== chosen.length || items.some((item) => !chosen.includes(item?.orderNumber))) {
    throw new Error("Invalid S&S status gateway response");
  }
  await Promise.all(items.map((item) => writeSupplierStatus(env, item)));
  return { checked: chosen.length };
}
__name(syncSupplierOrderStatuses, "syncSupplierOrderStatuses");
async function handleBlanksBatchStatusRefresh(request, env, allowOrigin, reqAllowHeaders) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, allowOrigin, reqAllowHeaders, 400);
  }
  const id2 = normalizeBlanksBatchId(body?.id);
  if (!id2) return jsonResponse({ error: "Missing batch id" }, allowOrigin, reqAllowHeaders, 400);
  const index2 = await readBlanksBatchIndex(env);
  const batch = index2.batches.find((entry) => entry.id === id2);
  if (!batch) return jsonResponse({ error: "Not Found" }, allowOrigin, reqAllowHeaders, 404);
  const numbers = supplierNumbers(batch.supplierOrderNumber);
  if (!numbers.length) return jsonResponse({ error: "Enter a valid S&S order number first" }, allowOrigin, reqAllowHeaders, 400);
  try {
    await syncSupplierOrderStatuses(env, numbers);
    return jsonResponse({ supplierStatus: await supplierStatusForReference(env, batch.supplierOrderNumber) }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return jsonResponse({ error: "S&S status is temporarily unavailable" }, allowOrigin, reqAllowHeaders, 502);
  }
}
__name(handleBlanksBatchStatusRefresh, "handleBlanksBatchStatusRefresh");
async function writeBlanksBatchIndex(env, index2) {
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const body = JSON.stringify({
    version: 1,
    updatedAt,
    batches: Array.isArray(index2?.batches) ? index2.batches : []
  }, null, 2);
  await env.PREVIEWS.put(BLANKS_BATCH_INDEX_KEY, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      role: "blanks-batch-index",
      updatedAt
    }
  });
  return JSON.parse(body);
}
__name(writeBlanksBatchIndex, "writeBlanksBatchIndex");
async function writeBlanksBatch(env, batch) {
  const key2 = blanksBatchKey(batch.id);
  const body = JSON.stringify(batch, null, 2);
  await env.PREVIEWS.put(key2, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      role: "blanks-batch",
      batchId: batch.id,
      status: batch.status,
      createdAt: batch.createdAt,
      expectedGarments: String(batch.totals?.expectedGarments || 0),
      orderCount: String(batch.totals?.orderCount || 0)
    }
  });
  return { key: key2, batch };
}
__name(writeBlanksBatch, "writeBlanksBatch");
async function upsertBlanksBatchIndexEntry(env, batch) {
  const index2 = await readBlanksBatchIndex(env);
  const entry = blanksBatchIndexEntry(batch);
  const existingIndex = index2.batches.findIndex((item) => item?.id === entry.id);
  if (existingIndex >= 0) {
    index2.batches[existingIndex] = entry;
  } else {
    index2.batches.unshift(entry);
  }
  index2.batches.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return writeBlanksBatchIndex(env, index2);
}
__name(upsertBlanksBatchIndexEntry, "upsertBlanksBatchIndexEntry");
function extensionForManualMockup(file, contentType) {
  const name = String(file?.name || "").toLowerCase();
  if (contentType === "image/png" || name.endsWith(".png")) return "png";
  if (contentType === "image/webp" || name.endsWith(".webp")) return "webp";
  if (contentType === "image/jpeg" || /\.jpe?g$/i.test(name)) return "jpg";
  return "";
}
__name(extensionForManualMockup, "extensionForManualMockup");
function contentTypeForManualMockup(file) {
  const declared = String(file?.type || "").toLowerCase();
  if (MANUAL_MOCKUP_CONTENT_TYPES.has(declared)) return declared;
  const guessed = guessContentTypeFromKey(file?.name || "");
  return MANUAL_MOCKUP_CONTENT_TYPES.has(guessed) ? guessed : "";
}
__name(contentTypeForManualMockup, "contentTypeForManualMockup");
function publicObjectUrl(request, key2) {
  return `${new URL(request.url).origin}/order-manager/storage/object?key=${encodeURIComponent(key2)}`;
}
__name(publicObjectUrl, "publicObjectUrl");
function hydrateManualManifest(manifest, request) {
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  return {
    orderNumber: String(manifest?.orderNumber || ""),
    assets: assets.filter((asset) => asset && typeof asset.key === "string" && asset.id).map((asset) => {
      const url = publicObjectUrl(request, asset.key);
      return {
        ...asset,
        url,
        objectUrl: url,
        thumbUrl: url
      };
    })
  };
}
__name(hydrateManualManifest, "hydrateManualManifest");
async function readManualManifest(env, orderNumber) {
  const key2 = manualManifestKey(orderNumber);
  const obj = await env.PREVIEWS.get(key2);
  if (!obj) {
    return { orderNumber, assets: [] };
  }
  try {
    const manifest = JSON.parse(await obj.text());
    return {
      orderNumber,
      assets: Array.isArray(manifest.assets) ? manifest.assets : []
    };
  } catch (err) {
    return { orderNumber, assets: [] };
  }
}
__name(readManualManifest, "readManualManifest");
async function writeManualManifest(env, orderNumber, manifest) {
  const key2 = manualManifestKey(orderNumber);
  const body = JSON.stringify({
    orderNumber,
    assets: Array.isArray(manifest.assets) ? manifest.assets : []
  }, null, 2);
  await env.PREVIEWS.put(key2, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      role: "manual-mockup-manifest",
      orderNumber
    }
  });
}
__name(writeManualManifest, "writeManualManifest");
async function readManualChecklist(env, orderNumber) {
  const key2 = manualChecklistKey(orderNumber);
  const obj = await env.PREVIEWS.get(key2);
  if (!obj) {
    return { orderNumber, version: 1, items: {}, updatedAt: "" };
  }
  try {
    const state = JSON.parse(await obj.text());
    return {
      orderNumber,
      version: 1,
      items: state && typeof state.items === "object" && !Array.isArray(state.items) ? state.items : {},
      updatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : ""
    };
  } catch (err) {
    return { orderNumber, version: 1, items: {}, updatedAt: "" };
  }
}
__name(readManualChecklist, "readManualChecklist");
async function writeManualChecklist(env, orderNumber, state) {
  const key2 = manualChecklistKey(orderNumber);
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const body = JSON.stringify({
    orderNumber,
    version: 1,
    updatedAt,
    items: state && typeof state.items === "object" && !Array.isArray(state.items) ? state.items : {}
  }, null, 2);
  await env.PREVIEWS.put(key2, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      role: "manual-add-checklist",
      orderNumber,
      updatedAt
    }
  });
  return { orderNumber, version: 1, updatedAt, items: JSON.parse(body).items };
}
__name(writeManualChecklist, "writeManualChecklist");
function normalizeManualChecklistItemId(value) {
  const itemId = String(value || "").trim();
  if (!itemId || itemId.length > 300) return "";
  return itemId;
}
__name(normalizeManualChecklistItemId, "normalizeManualChecklistItemId");
function checklistItemMetadata(value) {
  const item = value && typeof value === "object" ? value : {};
  return {
    title: String(item.title || "").slice(0, 240),
    variantTitle: String(item.variantTitle || "").slice(0, 240),
    qty: Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0,
    orderName: String(item.orderName || "").slice(0, 240),
    customer: String(item.customer || "").slice(0, 160)
  };
}
__name(checklistItemMetadata, "checklistItemMetadata");
async function applyManualChecklistUpdate(env, update) {
  const orderNumber = normalizeManualOrderNumber(update?.orderNumber || update?.orderKey);
  const itemId = normalizeManualChecklistItemId(update?.itemId || update?.key);
  if (!orderNumber || !itemId) {
    return { ok: false, error: "Missing or invalid orderNumber/itemId" };
  }
  const state = await readManualChecklist(env, orderNumber);
  state.items = state.items && typeof state.items === "object" && !Array.isArray(state.items) ? state.items : {};
  if (Boolean(update.checked)) {
    state.items[itemId] = {
      checked: true,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      item: checklistItemMetadata(update.item)
    };
  } else {
    delete state.items[itemId];
  }
  const saved = await writeManualChecklist(env, orderNumber, state);
  return { ok: true, orderNumber, itemId, state: saved };
}
__name(applyManualChecklistUpdate, "applyManualChecklistUpdate");
function makeManualAssetId() {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return `${date}-${random}`;
}
__name(makeManualAssetId, "makeManualAssetId");
function getManualOrderNumberFromUrl(url) {
  return normalizeManualOrderNumber(
    url.searchParams.get("orderNumber") || url.searchParams.get("orderKey")
  );
}
__name(getManualOrderNumberFromUrl, "getManualOrderNumberFromUrl");
function isFileLike(value) {
  return Boolean(
    value && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.name === "string"
  );
}
__name(isFileLike, "isFileLike");
async function handleBlanksBatches(request, env, allowOrigin, reqAllowHeaders) {
  if (!env.PREVIEWS) {
    return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
  }
  const url = new URL(request.url);
  if (request.method === "GET") {
    const batchId = normalizeBlanksBatchId(url.searchParams.get("id"));
    if (batchId) {
      let batch = null;
      try {
        batch = await readBlanksBatch(env, batchId);
      } catch (err) {
        return jsonResponse({ error: "Invalid stored batch", id: batchId }, allowOrigin, reqAllowHeaders, 500);
      }
      if (!batch) {
        return jsonResponse({ error: "Not Found", id: batchId }, allowOrigin, reqAllowHeaders, 404);
      }
      return jsonResponse({ batch: { ...batch, supplierStatus: await supplierStatusForReference(env, batch.supplierOrderNumber) } }, allowOrigin, reqAllowHeaders, 200);
    }
    const index2 = await readBlanksBatchIndex(env);
    return jsonResponse({ ...index2, batches: await Promise.all(index2.batches.map(async (batch) => ({
      ...batch,
      supplierStatus: await supplierStatusForReference(env, batch.supplierOrderNumber)
    }))) }, allowOrigin, reqAllowHeaders, 200);
  }
  if (request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({ error: "Invalid JSON body" }, allowOrigin, reqAllowHeaders, 400);
    }
    body = await captureGarmentCosts(env, body);
    const batch = buildBlanksBatch(body);
    if (batch.source === "outside-order" && !batch.supplierOrderNumber) {
      return jsonResponse({ error: "S&S order number is required for an outside purchase" }, allowOrigin, reqAllowHeaders, 400);
    }
    if (!batch.orders.length) {
      return jsonResponse({ error: "At least one order is required" }, allowOrigin, reqAllowHeaders, 400);
    }
    if (!batch.manifest.length || !batch.totals.expectedGarments) {
      return jsonResponse({ error: "Batch has no garment line items" }, allowOrigin, reqAllowHeaders, 400);
    }
    const currentIndex = await readBlanksBatchIndex(env);
    if (batch.supplierOrderNumber && currentIndex.batches.some((entry) => supplierReferencesOverlap(entry.supplierOrderNumber, batch.supplierOrderNumber))) {
      return jsonResponse({ error: "This S&S order number already has a receiving record" }, allowOrigin, reqAllowHeaders, 409);
    }
    const duplicateEntries = currentIndex.batches.filter((entry) => {
      return batch.orders.some((order) => indexEntryContainsIncomingOrder(entry, order));
    });
    if (duplicateEntries.length) {
      return jsonResponse({
        error: {
          code: "ORDER_ALREADY_BATCHED",
          message: "One or more orders already belong to a receiving batch. Add or move them from the existing batch instead.",
          batchIds: duplicateEntries.map((entry) => entry.id)
        }
      }, allowOrigin, reqAllowHeaders, 409);
    }
    const { key: key2 } = await writeBlanksBatch(env, batch);
    const index2 = await upsertBlanksBatchIndexEntry(env, batch);
    return jsonResponse(
      {
        ok: true,
        key: key2,
        batch,
        indexEntry: blanksBatchIndexEntry(batch),
        indexUpdatedAt: index2.updatedAt
      },
      allowOrigin,
      reqAllowHeaders,
      201
    );
  }
  if (request.method === "PATCH") {
    let body = {};
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({ error: "Invalid JSON body" }, allowOrigin, reqAllowHeaders, 400);
    }
    const batchId = normalizeBlanksBatchId(body?.id || url.searchParams.get("id"));
    if (!batchId) {
      return jsonResponse({ error: "Missing or invalid batch id" }, allowOrigin, reqAllowHeaders, 400);
    }
    let batch = null;
    try {
      batch = await readBlanksBatch(env, batchId);
    } catch (err) {
      return jsonResponse({ error: "Invalid stored batch", id: batchId }, allowOrigin, reqAllowHeaders, 500);
    }
    if (!batch) {
      return jsonResponse({ error: "Not Found", id: batchId }, allowOrigin, reqAllowHeaders, 404);
    }
    const action = safeText(body?.action, 80);
    if (action === "update-reference") {
      const reference = safeText(body?.supplierOrderNumber, 80);
      const currentIndex = await readBlanksBatchIndex(env);
      if (reference && currentIndex.batches.some((entry) => entry.id !== batchId && supplierReferencesOverlap(entry.supplierOrderNumber, reference))) {
        return jsonResponse({ error: "This S&S order number already has a receiving record" }, allowOrigin, reqAllowHeaders, 409);
      }
    }
    if (action === "add-orders" || action === "assign-orders") body = await captureGarmentCosts(env, body);
    const result = action === "assign-orders" ? await assignOrdersToBatch(env, batch, body) : applyBatchOrderAction(batch, body);
    if (!result.ok) {
      return jsonResponse({ error: result.error }, allowOrigin, reqAllowHeaders, 400);
    }
    if (action === "assign-orders") {
      return jsonResponse(result, allowOrigin, reqAllowHeaders, 200);
    }
    const { key: key2 } = await writeBlanksBatch(env, result.batch);
    const index2 = await upsertBlanksBatchIndexEntry(env, result.batch);
    return jsonResponse(
      {
        ok: true,
        key: key2,
        batch: result.batch,
        indexEntry: blanksBatchIndexEntry(result.batch),
        indexUpdatedAt: index2.updatedAt
      },
      allowOrigin,
      reqAllowHeaders,
      200
    );
  }
  return new Response("Method Not Allowed", { status: 405 });
}
__name(handleBlanksBatches, "handleBlanksBatches");
async function handleStorageList(request, env, allowOrigin, reqAllowHeaders) {
  if (!env.PREVIEWS) {
    return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
  }
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const prefix2 = (url.searchParams.get("prefix") || "").trim();
  const cursor = (url.searchParams.get("cursor") || "").trim() || void 0;
  const delimiter = (url.searchParams.get("delimiter") || "").trim() || void 0;
  const limitRaw = url.searchParams.get("limit");
  const limitNum = Number(limitRaw);
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(limitNum, 1e3) : 150;
  if (!prefix2) {
    return jsonResponse({ error: "Missing prefix" }, allowOrigin, reqAllowHeaders, 400);
  }
  const page = await env.PREVIEWS.list({
    prefix: prefix2,
    cursor,
    limit,
    delimiter,
    include: ["customMetadata", "httpMetadata"]
  });
  const workerOrigin = new URL(request.url).origin;
  const items = (page.objects || []).map((o) => {
    const objectUrl = `${workerOrigin}/order-manager/storage/object?key=${encodeURIComponent(o.key)}`;
    return {
      key: o.key,
      size: o.size ?? null,
      etag: o.etag ?? null,
      uploadedAt: o.uploaded instanceof Date ? o.uploaded.toISOString() : null,
      customMetadata: o.customMetadata || null,
      httpMetadata: o.httpMetadata || null,
      // UI can use this directly as <img src="">
      objectUrl,
      // alias (some UIs expect url)
      url: objectUrl,
      // you can add thumbUrl later if you implement resizing
      thumbUrl: objectUrl
    };
  });
  const commonPrefixes = Array.isArray(page.delimitedPrefixes) ? page.delimitedPrefixes : [];
  return jsonResponse(
    {
      prefix: prefix2,
      cursor: page.cursor || null,
      truncated: Boolean(page.truncated),
      items,
      commonPrefixes
    },
    allowOrigin,
    reqAllowHeaders,
    200
  );
}
__name(handleStorageList, "handleStorageList");
async function handleStorageHead(request, env, allowOrigin, reqAllowHeaders) {
  if (!env.PREVIEWS) {
    return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
  }
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const key2 = (url.searchParams.get("key") || "").trim();
  if (!key2) return jsonResponse({ error: "Missing key" }, allowOrigin, reqAllowHeaders, 400);
  if (!isAllowedStorageKey(key2)) {
    return jsonResponse({ error: "Invalid key" }, allowOrigin, reqAllowHeaders, 400);
  }
  const head = await env.PREVIEWS.head(key2);
  if (!head) return jsonResponse({ error: "Not Found", key: key2 }, allowOrigin, reqAllowHeaders, 404);
  const customMetadata = head.customMetadata || head.custom_metadata || null;
  const httpMetadata = head.httpMetadata || head.http_metadata || null;
  return jsonResponse(
    {
      key: head.key || key2,
      size: typeof head.size === "number" ? head.size : null,
      etag: head.etag || null,
      uploadedAt: head.uploaded instanceof Date ? head.uploaded.toISOString() : null,
      httpMetadata,
      customMetadata,
      metadata: customMetadata
    },
    allowOrigin,
    reqAllowHeaders,
    200
  );
}
__name(handleStorageHead, "handleStorageHead");
async function handleStorageObject(request, env, allowOrigin, reqAllowHeaders) {
  if (!env.PREVIEWS) {
    return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
  }
  const url = new URL(request.url);
  const key2 = (url.searchParams.get("key") || "").trim();
  if (!key2) return new Response("Missing key", { status: 400 });
  if (!isAllowedStorageKey(key2)) {
    return new Response("Invalid key", { status: 400 });
  }
  if (request.method === "HEAD") {
    const head = await env.PREVIEWS.head(key2);
    if (!head) return new Response("Not Found", { status: 404 });
    const headers2 = new Headers();
    headers2.set("Cache-Control", "no-store");
    const contentType2 = head.httpMetadata?.contentType || guessContentTypeFromKey(key2);
    headers2.set("Content-Type", contentType2);
    if (typeof head.size === "number") headers2.set("Content-Length", String(head.size));
    if (head.etag) headers2.set("ETag", head.etag);
    for (const [k, v] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) {
      headers2.set(k, v);
    }
    return new Response(null, { status: 200, headers: headers2 });
  }
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const obj = await env.PREVIEWS.get(key2);
  if (!obj) return new Response("Not Found", { status: 404 });
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  const contentType = obj.httpMetadata?.contentType || guessContentTypeFromKey(key2);
  headers.set("Content-Type", contentType);
  for (const [k, v] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) {
    headers.set(k, v);
  }
  return new Response(obj.body, { status: 200, headers });
}
__name(handleStorageObject, "handleStorageObject");
async function handleManualMockups(request, env, allowOrigin, reqAllowHeaders) {
  if (!env.PREVIEWS) {
    return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
  }
  const url = new URL(request.url);
  const orderNumber = getManualOrderNumberFromUrl(url);
  if (!orderNumber) {
    return jsonResponse({ error: "Missing or invalid orderNumber" }, allowOrigin, reqAllowHeaders, 400);
  }
  if (request.method === "GET") {
    const manifest = await readManualManifest(env, orderNumber);
    return jsonResponse(hydrateManualManifest(manifest, request), allowOrigin, reqAllowHeaders, 200);
  }
  if (request.method === "POST") {
    const form = await request.formData();
    let file = form.get("file");
    if (!isFileLike(file)) {
      file = Array.from(form.values()).find(isFileLike);
    }
    if (!isFileLike(file)) {
      return jsonResponse({ error: "Missing file" }, allowOrigin, reqAllowHeaders, 400);
    }
    const contentType = contentTypeForManualMockup(file);
    const ext = extensionForManualMockup(file, contentType);
    if (!contentType || !ext) {
      return jsonResponse({ error: "Only PNG, JPG, and WebP mockups are allowed" }, allowOrigin, reqAllowHeaders, 415);
    }
    const assetId2 = makeManualAssetId();
    const key2 = manualMockupKey(orderNumber, assetId2, ext);
    const uploadedAt = (/* @__PURE__ */ new Date()).toISOString();
    const filename = String(file.name || `mockup.${ext}`);
    await env.PREVIEWS.put(key2, await file.arrayBuffer(), {
      httpMetadata: { contentType },
      customMetadata: {
        role: "manual-mockup",
        orderNumber,
        assetId: assetId2,
        filename,
        uploadedAt
      }
    });
    const manifest = await readManualManifest(env, orderNumber);
    const asset = {
      id: assetId2,
      key: key2,
      role: "mockup",
      type: "mockup",
      filename,
      contentType,
      uploadedAt
    };
    manifest.assets = [
      ...Array.isArray(manifest.assets) ? manifest.assets : [],
      asset
    ];
    await writeManualManifest(env, orderNumber, manifest);
    return jsonResponse(
      {
        orderNumber,
        asset: hydrateManualManifest({ orderNumber, assets: [asset] }, request).assets[0],
        manifest: hydrateManualManifest(manifest, request)
      },
      allowOrigin,
      reqAllowHeaders,
      201
    );
  }
  if (request.method === "DELETE") {
    const assetId2 = String(url.searchParams.get("assetId") || "").trim();
    if (!assetId2) {
      return jsonResponse({ error: "Missing assetId" }, allowOrigin, reqAllowHeaders, 400);
    }
    const manifest = await readManualManifest(env, orderNumber);
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    const asset = assets.find((item) => item && item.id === assetId2);
    if (!asset) {
      return jsonResponse({ error: "Not Found", assetId: assetId2 }, allowOrigin, reqAllowHeaders, 404);
    }
    if (typeof asset.key === "string" && asset.key.startsWith(`${MANUAL_ASSETS_PREFIX}orders/${orderNumber}/mockups/`)) {
      await env.PREVIEWS.delete(asset.key);
    }
    manifest.assets = assets.filter((item) => item && item.id !== assetId2);
    await writeManualManifest(env, orderNumber, manifest);
    return jsonResponse(
      {
        ok: true,
        orderNumber,
        assetId: assetId2,
        manifest: hydrateManualManifest(manifest, request)
      },
      allowOrigin,
      reqAllowHeaders,
      200
    );
  }
  return new Response("Method Not Allowed", { status: 405 });
}
__name(handleManualMockups, "handleManualMockups");
async function handleManualMockupsBulk(request, env, allowOrigin, reqAllowHeaders) {
  if (!env.PREVIEWS) {
    return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid JSON body" }, allowOrigin, reqAllowHeaders, 400);
  }
  const rawOrderNumbers = Array.isArray(body.orderNumbers) ? body.orderNumbers : Array.isArray(body.orderKeys) ? body.orderKeys : [];
  const orderNumbers = Array.from(new Set(
    rawOrderNumbers.map(normalizeManualOrderNumber).filter(Boolean)
  )).slice(0, 250);
  const orders = {};
  await Promise.all(orderNumbers.map(async (orderNumber) => {
    const manifest = await readManualManifest(env, orderNumber);
    orders[orderNumber] = hydrateManualManifest(manifest, request);
  }));
  return jsonResponse({ orders }, allowOrigin, reqAllowHeaders, 200);
}
__name(handleManualMockupsBulk, "handleManualMockupsBulk");
async function handleManualChecklist(request, env, allowOrigin, reqAllowHeaders) {
  if (!env.PREVIEWS) {
    return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
  }
  const url = new URL(request.url);
  const orderNumber = getManualOrderNumberFromUrl(url);
  if (request.method === "GET") {
    if (!orderNumber) {
      return jsonResponse({ error: "Missing or invalid orderNumber" }, allowOrigin, reqAllowHeaders, 400);
    }
    const state = await readManualChecklist(env, orderNumber);
    return jsonResponse(state, allowOrigin, reqAllowHeaders, 200);
  }
  if (request.method === "POST" || request.method === "PATCH") {
    let body = {};
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({ error: "Invalid JSON body" }, allowOrigin, reqAllowHeaders, 400);
    }
    const result = await applyManualChecklistUpdate(env, body);
    if (!result.ok) {
      return jsonResponse({ error: result.error }, allowOrigin, reqAllowHeaders, 400);
    }
    return jsonResponse(result, allowOrigin, reqAllowHeaders, 200);
  }
  return new Response("Method Not Allowed", { status: 405 });
}
__name(handleManualChecklist, "handleManualChecklist");
async function handleManualChecklistBulk(request, env, allowOrigin, reqAllowHeaders) {
  if (!env.PREVIEWS) {
    return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid JSON body" }, allowOrigin, reqAllowHeaders, 400);
  }
  if (Array.isArray(body.updates)) {
    const updates = body.updates.slice(0, 500);
    const grouped = /* @__PURE__ */ new Map();
    const results = [];
    for (const update of updates) {
      const orderNumber = normalizeManualOrderNumber(update?.orderNumber || update?.orderKey);
      const itemId = normalizeManualChecklistItemId(update?.itemId || update?.key);
      if (!orderNumber || !itemId) {
        results.push({ ok: false, error: "Missing or invalid orderNumber/itemId" });
        continue;
      }
      if (!grouped.has(orderNumber)) grouped.set(orderNumber, []);
      grouped.get(orderNumber).push({ ...update, orderNumber, itemId });
    }
    const orders2 = {};
    for (const [orderNumber, orderUpdates] of grouped.entries()) {
      const state = await readManualChecklist(env, orderNumber);
      state.items = state.items && typeof state.items === "object" && !Array.isArray(state.items) ? state.items : {};
      orderUpdates.forEach((update) => {
        if (Boolean(update.checked)) {
          state.items[update.itemId] = {
            checked: true,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            item: checklistItemMetadata(update.item)
          };
        } else {
          delete state.items[update.itemId];
        }
        results.push({ ok: true, orderNumber, itemId: update.itemId });
      });
      orders2[orderNumber] = await writeManualChecklist(env, orderNumber, state);
    }
    return jsonResponse({ ok: true, results, orders: orders2 }, allowOrigin, reqAllowHeaders, 200);
  }
  const rawOrderNumbers = Array.isArray(body.orderNumbers) ? body.orderNumbers : Array.isArray(body.orderKeys) ? body.orderKeys : [];
  const orderNumbers = Array.from(new Set(
    rawOrderNumbers.map(normalizeManualOrderNumber).filter(Boolean)
  )).slice(0, 250);
  const orders = {};
  await Promise.all(orderNumbers.map(async (orderNumber) => {
    orders[orderNumber] = await readManualChecklist(env, orderNumber);
  }));
  return jsonResponse({ orders }, allowOrigin, reqAllowHeaders, 200);
}
__name(handleManualChecklistBulk, "handleManualChecklistBulk");
async function upstreamDataRequest(env, path, options = {}) {
  const upstreamBase = String(env.UPSTREAM_BASE || "").replace(/\/+$/, "");
  const adminKey = env.ORDER_MANAGER_ADMIN_KEY;
  if (!upstreamBase || !adminKey) throw new Error("Render data adapter is not configured");
  const headers = new Headers(options.headers || {});
  headers.set("X-Order-Manager-Key", adminKey);
  if (env.SHOPIFY_SHOP_DOMAIN) headers.set("X-Shopify-Shop-Domain", String(env.SHOPIFY_SHOP_DOMAIN).toLowerCase());
  if (options.body !== void 0 && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${upstreamBase}${path}`, { ...options, headers });
  const responseId = response.headers.get("X-Order-Manager-Response-Id");
  const gatewayEvidence = {
    httpStatus: response.status,
    contentType: String(response.headers.get("Content-Type") || "").split(";")[0].slice(0, 80),
    responseId: /^ssr-[a-f0-9-]{36}$/.test(responseId || "") ? responseId : null,
    bodyFormat: "unreadable",
    bodyBytes: null,
    hasSupplierStatus: false,
    hasSupplierMessage: false,
    hasDispatchMarker: false
  };
  let text2;
  try {
    text2 = await response.text();
  } catch {
    const error = new Error("The gateway response ended before its body could be read.");
    error.status = response.status >= 400 ? response.status : 502;
    error.gatewayEvidence = { ...gatewayEvidence, failurePhase: "body_read" };
    throw error;
  }
  let body = null;
  let bodyFormat = text2 ? "json" : "empty";
  try {
    body = text2 ? JSON.parse(text2) : null;
  } catch {
    bodyFormat = "non_json";
  }
  if (!response.ok) {
    const error = new Error(body?.error?.message || (typeof body?.error === "string" ? body.error : null) || `Render data adapter HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    error.gatewayEvidence = {
      ...gatewayEvidence,
      bodyFormat,
      bodyBytes: new TextEncoder().encode(text2).length,
      hasSupplierStatus: typeof body?.upstreamHttpStatus === "number",
      hasSupplierMessage: typeof body?.error?.message === "string",
      hasDispatchMarker: typeof body?.orderSubmissionAttempted === "boolean"
    };
    throw error;
  }
  return body;
}
__name(upstreamDataRequest, "upstreamDataRequest");
async function handleLegacyQueueGet(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const orders = await upstreamDataRequest(env, "/order-manager/v1/legacy/queue");
    return jsonResponse(orders, allowOrigin, reqAllowHeaders);
  } catch (err) {
    return jsonResponse({ error: err.message }, allowOrigin, reqAllowHeaders, 500);
  }
}
__name(handleLegacyQueueGet, "handleLegacyQueueGet");
async function handleLegacyQueueMutate(request, env, allowOrigin, reqAllowHeaders, ctx) {
  try {
    const body = await request.json();
    const { orderName, orderNames, bundleName, patch } = body;
    if (!orderName && !Array.isArray(orderNames) && !bundleName || !patch || typeof patch !== "object") {
      return jsonResponse({ error: "Mutation target and patch are required" }, allowOrigin, reqAllowHeaders, 400);
    }
    const spec = {
      orderNames: [.../* @__PURE__ */ new Set([...Array.isArray(orderNames) ? orderNames : [], ...orderName ? [orderName] : []])],
      bundleName: bundleName || null,
      patch
    };
    const result = await upstreamDataRequest(env, "/order-manager/v1/legacy/queue/mutate", {
      method: "POST",
      body: JSON.stringify(spec)
    });
    return jsonResponse(result, allowOrigin, reqAllowHeaders);
  } catch (err) {
    return jsonResponse({ error: err.message }, allowOrigin, reqAllowHeaders, 500);
  }
}
__name(handleLegacyQueueMutate, "handleLegacyQueueMutate");
async function handleLegacyQueueDelete(request, env, allowOrigin, reqAllowHeaders, ctx) {
  return v1Error({
    code: "ORDER_REMOVAL_NOT_ALLOWED",
    message: "Only an identified Etsy order can be removed through its production action."
  }, allowOrigin, reqAllowHeaders, 403);
}
__name(handleLegacyQueueDelete, "handleLegacyQueueDelete");
async function handleLegacySSBatch(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.orderIds) || !body.orderIds.length) {
      return jsonResponse({ error: "No orderIds provided for batch" }, allowOrigin, reqAllowHeaders, 400);
    }
    const result = await upstreamDataRequest(env, "/order-manager/orders/process-batch", {
      method: "POST",
      body: JSON.stringify({ orderIds: body.orderIds, orderNames: body.orderIds })
    });
    return jsonResponse(result, allowOrigin, reqAllowHeaders);
  } catch (err) {
    return jsonResponse({ error: err.message }, allowOrigin, reqAllowHeaders, err.status || 500);
  }
}
__name(handleLegacySSBatch, "handleLegacySSBatch");
var shopifyAccessTokenCache = /* @__PURE__ */ new Map();
var shopifyPreviewCache = /* @__PURE__ */ new Map();
var SHOPIFY_API_VERSION = "2026-07";
var SHOPIFY_PREVIEW_TTL_MS = 3e4;
var SHOPIFY_PREVIEW_DETAIL_TTL_MS = 3e5;
var SHOPIFY_PREVIEW_ORDERS_QUERY = `query PrintMOShopifyPreviewOrders($first: Int!) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id name createdAt updatedAt displayFinancialStatus displayFulfillmentStatus cancelledAt closedAt currencyCode
      currentSubtotalLineItemsQuantity
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      currentTotalDiscountsSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { firstName lastName displayName }
      shippingAddress { name }
      billingAddress { name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
var SHOPIFY_PREVIEW_ORDER_DETAIL_QUERY = `query PrintMOShopifyPreviewOrderDetail($id: ID!) {
  order(id: $id) {
    id name createdAt processedAt updatedAt cancelledAt closedAt cancelReason note tags test sourceName
    email phone customerLocale
    customer { id firstName lastName displayName email phone }
    shippingAddress { name company address1 address2 city province provinceCode zip country countryCodeV2 phone }
    billingAddress { name company address1 address2 city province provinceCode zip country countryCodeV2 phone }
    displayFinancialStatus displayFulfillmentStatus fullyPaid unpaid currencyCode
    currentSubtotalLineItemsQuantity
    currentSubtotalPriceSet { shopMoney { amount currencyCode } }
    currentShippingPriceSet { shopMoney { amount currencyCode } }
    currentTotalDiscountsSet { shopMoney { amount currencyCode } }
    currentTotalTaxSet { shopMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    totalReceivedSet { shopMoney { amount currencyCode } }
    totalRefundedSet { shopMoney { amount currencyCode } }
    totalOutstandingSet { shopMoney { amount currencyCode } }
    paymentGatewayNames
    transactions(first: 25) {
      id kind status gateway formattedGateway createdAt processedAt test errorCode
      amountSet { shopMoney { amount currencyCode } }
    }
    shippingLines(first: 10) {
      nodes {
        id title code source deliveryCategory custom
        originalPriceSet { shopMoney { amount currencyCode } }
        currentDiscountedPriceSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
      }
    }
    fulfillmentOrders(first: 10) {
      nodes {
        id status requestStatus fulfillAt fulfillBy
        deliveryMethod {
          id methodType presentedName serviceCode minDeliveryDateTime maxDeliveryDateTime
        }
      }
    }
    fulfillments {
      id name status displayStatus createdAt updatedAt deliveredAt estimatedDeliveryAt totalQuantity
      trackingInfo(first: 10) { company number url }
    }
    customerJourneySummary {
      ready customerOrderIndex daysToConversion
      firstVisit { id occurredAt source sourceDescription sourceType landingPage referrerUrl referralCode }
      lastVisit { id occurredAt source sourceDescription sourceType landingPage referrerUrl referralCode }
    }
    discountApplications(first: 10) {
      nodes {
        __typename allocationMethod targetSelection targetType
        value {
          __typename
          ... on MoneyV2 { amount currencyCode }
          ... on PricingPercentageValue { percentage }
        }
        ... on AutomaticDiscountApplication { title }
        ... on DiscountCodeApplication { code }
        ... on ManualDiscountApplication { title description }
        ... on ScriptDiscountApplication { title }
      }
    }
    events(first: 25, reverse: true) {
      nodes {
        __typename id createdAt criticalAlert message
        ... on BasicEvent { action appTitle author secondaryMessage }
        ... on CommentEvent { action rawMessage }
      }
    }
    lineItems(first: 50) {
      nodes {
        id sku title variantTitle vendor quantity currentQuantity unfulfilledQuantity requiresShipping
        customAttributes { key value }
        variant { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        originalTotalSet { shopMoney { amount currencyCode } }
        totalDiscountSet { shopMoney { amount currencyCode } }
        priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
var SHOPIFY_PREVIEW_ORDER_LINE_ITEMS_QUERY = `query PrintMOShopifyPreviewOrderLineItems($id: ID!, $after: String) {
  order(id: $id) {
    lineItems(first: 50, after: $after) {
      nodes {
        id sku title variantTitle vendor quantity currentQuantity unfulfilledQuantity requiresShipping
        customAttributes { key value }
        variant { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        originalTotalSet { shopMoney { amount currencyCode } }
        totalDiscountSet { shopMoney { amount currencyCode } }
        priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
var ORDER_SUMMARIES_QUERY = `query PrintMOOrderSummaries($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id name createdAt updatedAt displayFinancialStatus displayFulfillmentStatus cancelledAt closedAt currencyCode
      currentSubtotalLineItemsQuantity
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      currentTotalDiscountsSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      shippingAddress { name }
      billingAddress { name }
      fulfillmentOrders(first: 10) {
        nodes { id status deliveryMethod { methodType } }
        pageInfo { hasNextPage }
      }
      lineItems(first: 25) {
        nodes {
          id sku title variantTitle quantity currentQuantity customAttributes { key value }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;
var ORDER_LINE_ITEMS_QUERY = `query PrintMOOrderLineItems($id: ID!, $after: String) {
  order(id: $id) {
    lineItems(first: 25, after: $after) {
      nodes {
        id sku title variantTitle quantity currentQuantity customAttributes { key value }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
var ORDER_DETAIL_QUERY = `query PrintMOOrderDetail($id: ID!, $after: String) {
  order(id: $id) {
    id name createdAt processedAt updatedAt cancelledAt closedAt cancelReason note tags test sourceName
    email phone customerLocale
    displayFinancialStatus displayFulfillmentStatus fullyPaid unpaid currencyCode
    currentSubtotalLineItemsQuantity
    currentSubtotalPriceSet { shopMoney { amount currencyCode } }
    currentShippingPriceSet { shopMoney { amount currencyCode } }
    currentTotalDiscountsSet { shopMoney { amount currencyCode } }
    currentTotalTaxSet { shopMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    totalReceivedSet { shopMoney { amount currencyCode } }
    totalRefundedSet { shopMoney { amount currencyCode } }
    totalOutstandingSet { shopMoney { amount currencyCode } }
    paymentGatewayNames
    transactions(first: 25) { id kind status gateway formattedGateway createdAt processedAt test errorCode amountSet { shopMoney { amount currencyCode } } }
    shippingAddress { name company address1 address2 city province provinceCode zip country countryCodeV2 phone }
    billingAddress { name company address1 address2 city province provinceCode zip country countryCodeV2 phone }
    shippingLines(first: 10) { nodes { id title code source deliveryCategory custom originalPriceSet { shopMoney { amount currencyCode } } currentDiscountedPriceSet { shopMoney { amount currencyCode } } } }
    fulfillmentOrders(first: 10) { nodes { id status requestStatus fulfillAt fulfillBy deliveryMethod { id methodType presentedName serviceCode minDeliveryDateTime maxDeliveryDateTime } } pageInfo { hasNextPage } }
    fulfillments { id name status displayStatus createdAt updatedAt deliveredAt estimatedDeliveryAt totalQuantity trackingInfo(first: 10) { number url company } }
    customerJourneySummary { ready customerOrderIndex daysToConversion firstVisit { id occurredAt source sourceDescription sourceType landingPage referrerUrl referralCode } lastVisit { id occurredAt source sourceDescription sourceType landingPage referrerUrl referralCode } }
    discountApplications(first: 10) { nodes { __typename allocationMethod targetSelection targetType value { __typename ... on MoneyV2 { amount currencyCode } ... on PricingPercentageValue { percentage } } ... on AutomaticDiscountApplication { title } ... on DiscountCodeApplication { code } ... on ManualDiscountApplication { title description } ... on ScriptDiscountApplication { title } } }
    events(first: 25, reverse: true) { nodes { __typename id createdAt criticalAlert message ... on BasicEvent { action appTitle author secondaryMessage } ... on CommentEvent { action rawMessage } } }
    lineItems(first: 25, after: $after) {
      nodes {
        id sku title variantTitle vendor quantity currentQuantity unfulfilledQuantity requiresShipping customAttributes { key value }
        originalUnitPriceSet { shopMoney { amount currencyCode } } originalTotalSet { shopMoney { amount currencyCode } } totalDiscountSet { shopMoney { amount currencyCode } } priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
        taxLines { title rate priceSet { shopMoney { amount currencyCode } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
var ORDER_DETAIL_LINE_ITEMS_QUERY = `query PrintMOOrderDetailLineItems($id: ID!, $after: String) {
  order(id: $id) {
    lineItems(first: 25, after: $after) {
      nodes {
        id sku title variantTitle vendor quantity currentQuantity unfulfilledQuantity requiresShipping customAttributes { key value }
        originalUnitPriceSet { shopMoney { amount currencyCode } } originalTotalSet { shopMoney { amount currencyCode } } totalDiscountSet { shopMoney { amount currencyCode } } priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
        taxLines { title rate priceSet { shopMoney { amount currencyCode } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
var ORDER_SEARCH_QUERY = `query PrintMOOrderSearch($query: String!) {
  orders(first: 5, query: $query) { nodes { id name createdAt updatedAt displayFinancialStatus } }
}`;
var UPDATED_ORDERS_QUERY = `query PrintMOUpdatedOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: UPDATED_AT, query: $query) {
    nodes {
      id name createdAt updatedAt cancelledAt closedAt
      displayFinancialStatus displayFulfillmentStatus
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
var PRODUCTION_METAFIELD_NAMESPACE = "$app:printmo";
var PRODUCTION_METAFIELD_KEY = "production_state_v1";
var BOOTSTRAP_ORDERS_QUERY = `query PrintMOBootstrapOrders($query: String!, $first: Int!) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
    nodes {
      id name createdAt updatedAt displayFinancialStatus displayFulfillmentStatus cancelledAt closedAt
      metafield(namespace: "${PRODUCTION_METAFIELD_NAMESPACE}", key: "${PRODUCTION_METAFIELD_KEY}") {
        id namespace key type value compareDigest createdAt updatedAt
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
var PRODUCTION_STAGES = /* @__PURE__ */ new Set(["received", "to_order", "blanks_cart", "blanks_ordered", "print", "completed"]);
var PRODUCTION_STATE_QUERY = `query PrintMOProductionState($id: ID!) {
  order(id: $id) {
    id name createdAt updatedAt displayFulfillmentStatus cancelledAt closedAt
    lineItems(first: 50) {
      nodes {
        id sku title variantTitle quantity currentQuantity variant { id }
      }
      pageInfo { hasNextPage endCursor }
    }
    metafield(namespace: "${PRODUCTION_METAFIELD_NAMESPACE}", key: "${PRODUCTION_METAFIELD_KEY}") {
      id namespace key type value compareDigest createdAt updatedAt
    }
  }
}`;
var PRODUCTION_STATE_MUTATION = `mutation PrintMOSetProductionState($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value compareDigest createdAt updatedAt }
    userErrors { field message code }
  }
}`;
function requireOrderDb(env) {
  if (!env.ORDER_DB) {
    throw Object.assign(new Error("The Redis-free order database is not configured."), {
      code: "ORDER_DB_NOT_CONFIGURED",
      status: 503
    });
  }
  return env.ORDER_DB;
}
__name(requireOrderDb, "requireOrderDb");
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(isoNow, "isoNow");
var ETSY_CONNECTION_ID = "primary";
var ETSY_OAUTH_SCOPE = "transactions_r";
var ETSY_OAUTH_SESSION_TTL_MS = 10 * 60 * 1e3;
var ETSY_ACCESS_REFRESH_SKEW_MS = 60 * 1e3;
var ETSY_AUTHORIZATION_URL = "https://www.etsy.com/oauth/connect";
var ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
var ETSY_API_BASE_URL = "https://api.etsy.com/v3/application";
var ETSY_API_PING_URL = `${ETSY_API_BASE_URL}/openapi-ping`;
var ETSY_FIELD_SHAPE_VERSION = 1;
var ETSY_FIELD_SHAPE_MAX_DEPTH = 8;
var ETSY_FIELD_SHAPE_MAX_ENTRIES = 300;
var ETSY_FIELD_SHAPE_ARRAY_SAMPLE = 5;
var SAFE_JSON_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
var ETSY_SYNTHETIC_EXTERNAL_ID = "synthetic-pilot-1";
var ETSY_SYNTHETIC_CONFIRM_CREATE = "CREATE_LIVE_ETSY_TEST_ORDER";
var ETSY_SYNTHETIC_CONFIRM_DELETE = "DELETE_LIVE_ETSY_TEST_ORDER";
var ETSY_SYNTHETIC_FULL_RECEIPT_EXTERNAL_ID = "synthetic-full-receipt-1";
var ETSY_SYNTHETIC_FULL_RECEIPT_CONFIRM_CREATE = "CREATE_LIVE_ETSY_FULL_RECEIPT_TEST_ORDER";
var ETSY_SYNTHETIC_FULL_RECEIPT_CONFIRM_DELETE = "DELETE_LIVE_ETSY_FULL_RECEIPT_TEST_ORDER";
var ETSY_WEBHOOK_PATH = "/order-manager/v1/webhooks/etsy";
var ETSY_WEBHOOK_EVENT = "order.paid";
var ETSY_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
var ETSY_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
var ETSY_WEBHOOK_MAX_ATTEMPTS = 8;
var ETSY_WEBHOOK_PROCESSING_LEASE_MS = 10 * 60 * 1e3;
var ETSY_WEBHOOK_RETRY_DELAYS_SECONDS = Object.freeze([300, 900, 1800, 7200, 18e3, 36e3, 36e3, 86400]);
var ETSY_RECONCILIATION_CHECKPOINT = "etsy-webhook-reconciliation-v1";
var ETSY_RECONCILIATION_LIMIT = 25;
var ETSY_RECONCILIATION_OVERLAP_SECONDS = 15 * 60;
var ETSY_RECONCILIATION_INITIAL_SECONDS = 24 * 60 * 60;
var ETSY_RECONCILIATION_INTEGRITY_SECONDS = 30 * 24 * 60 * 60;
var ETSY_WEBHOOK_ALLOWED_HOSTS = /* @__PURE__ */ new Set(["api.etsy.com", "openapi.etsy.com"]);
var ETSY_CATALOG_PREVIEW_MAX_LISTINGS = 25;
var ETSY_CATALOG_PREVIEW_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
var ETSY_CATALOG_PREVIEW_CONTENT_TYPES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp"]);
function etsyWebhookError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
__name(etsyWebhookError, "etsyWebhookError");
function etsyWebhookResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders
    }
  });
}
__name(etsyWebhookResponse, "etsyWebhookResponse");
function decodeBase64Standard(value, code = "ETSY_WEBHOOK_SECRET_INVALID") {
  const normalized2 = String(value || "").trim();
  if (!normalized2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized2)) {
    throw etsyWebhookError(code, "Etsy webhook base64 material is invalid.", 503);
  }
  try {
    const padded = normalized2 + "=".repeat((4 - normalized2.length % 4) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch (_) {
    throw etsyWebhookError(code, "Etsy webhook base64 material is invalid.", 503);
  }
}
__name(decodeBase64Standard, "decodeBase64Standard");
function etsyWebhookSecretBytes(value) {
  const encoded = String(value || "").trim();
  if (!encoded.startsWith("whsec_")) {
    throw etsyWebhookError("ETSY_WEBHOOK_SECRET_INVALID", "Etsy webhook signing secret is invalid.", 503);
  }
  const bytes = decodeBase64Standard(encoded.slice("whsec_".length));
  if (bytes.byteLength < 16 || bytes.byteLength > 128) {
    throw etsyWebhookError("ETSY_WEBHOOK_SECRET_INVALID", "Etsy webhook signing secret has an invalid length.", 503);
  }
  return bytes;
}
__name(etsyWebhookSecretBytes, "etsyWebhookSecretBytes");
function etsyWebhookSecrets(env, { required = true } = {}) {
  const current = String(env.ETSY_WEBHOOK_SECRET || "").trim();
  const previous = String(env.ETSY_WEBHOOK_SECRET_PREVIOUS || "").trim();
  if (!current) {
    if (!required) return [];
    throw etsyWebhookError("ETSY_WEBHOOK_NOT_CONFIGURED", "Etsy webhook signing is not configured.", 503);
  }
  return [current, previous].filter(Boolean).map(etsyWebhookSecretBytes);
}
__name(etsyWebhookSecrets, "etsyWebhookSecrets");
function etsyWebhookSignatureValues(header) {
  return String(header || "").trim().split(/\s+/).map((entry) => {
    const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(entry);
    if (!match) return null;
    try {
      return decodeBase64Standard(match[1], "ETSY_WEBHOOK_SIGNATURE_INVALID");
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}
__name(etsyWebhookSignatureValues, "etsyWebhookSignatureValues");
async function sha256BytesHex(bytes) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}
__name(sha256BytesHex, "sha256BytesHex");
async function verifyEtsyWebhookSignature(rawBytes, headers, env, nowSeconds = Math.floor(Date.now() / 1e3)) {
  const webhookId = String(headers.get("webhook-id") || "").trim();
  const timestampValue = String(headers.get("webhook-timestamp") || "").trim();
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(webhookId)) {
    throw etsyWebhookError("ETSY_WEBHOOK_ID_INVALID", "Etsy webhook delivery ID is missing or invalid.", 400);
  }
  if (!/^\d{10,13}$/.test(timestampValue)) {
    throw etsyWebhookError("ETSY_WEBHOOK_TIMESTAMP_INVALID", "Etsy webhook timestamp is missing or invalid.", 400);
  }
  const timestamp = Number(timestampValue);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > ETSY_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    throw etsyWebhookError("ETSY_WEBHOOK_TIMESTAMP_STALE", "Etsy webhook timestamp is outside the replay window.", 401);
  }
  const signatures = etsyWebhookSignatureValues(headers.get("webhook-signature"));
  if (!signatures.length) {
    throw etsyWebhookError("ETSY_WEBHOOK_SIGNATURE_INVALID", "Etsy webhook signature is missing or invalid.", 401);
  }
  const prefix2 = new TextEncoder().encode(`${webhookId}.${timestampValue}.`);
  const signedContent = new Uint8Array(prefix2.byteLength + rawBytes.byteLength);
  signedContent.set(prefix2, 0);
  signedContent.set(rawBytes, prefix2.byteLength);
  const secrets = etsyWebhookSecrets(env);
  for (const secret of secrets) {
    const key2 = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    for (const signature of signatures) {
      if (await crypto.subtle.verify("HMAC", key2, signature, signedContent)) {
        return { webhookId, timestamp, timestampValue };
      }
    }
  }
  throw etsyWebhookError("ETSY_WEBHOOK_SIGNATURE_INVALID", "Etsy webhook signature verification failed.", 401);
}
__name(verifyEtsyWebhookSignature, "verifyEtsyWebhookSignature");
function parseEtsyWebhookResource(value, expectedShopId) {
  let parsed2;
  try {
    parsed2 = new URL(String(value || ""));
  } catch (_) {
  }
  if (!parsed2 || parsed2.protocol !== "https:" || parsed2.port || parsed2.username || parsed2.password || parsed2.search || parsed2.hash || !ETSY_WEBHOOK_ALLOWED_HOSTS.has(parsed2.hostname.toLowerCase())) {
    throw etsyWebhookError("ETSY_WEBHOOK_RESOURCE_INVALID", "Etsy webhook resource URL is invalid.", 400);
  }
  const match = /^\/v3\/application\/shops\/(\d+)\/receipts\/(\d+)$/.exec(parsed2.pathname);
  if (!match || match[1] !== String(expectedShopId)) {
    throw etsyWebhookError("ETSY_WEBHOOK_RESOURCE_INVALID", "Etsy webhook resource does not match the authorized shop.", 403);
  }
  return { shopId: match[1], receiptId: etsyNumericIdentity(match[2], "receipt ID") };
}
__name(parseEtsyWebhookResource, "parseEtsyWebhookResource");
function etsyConfig(env) {
  const keystring = String(env.ETSY_API_KEY || "").trim();
  const sharedSecret = String(env.ETSY_SHARED_SECRET || "").trim();
  const redirectUri = String(env.ETSY_REDIRECT_URI || "").trim();
  if (!keystring || !sharedSecret) {
    throw Object.assign(new Error("Etsy API credentials are not configured."), {
      code: "ETSY_NOT_CONFIGURED",
      status: 503
    });
  }
  let parsedRedirect;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch (_) {
  }
  if (!parsedRedirect || parsedRedirect.protocol !== "https:" || parsedRedirect.pathname !== "/order-manager/v1/oauth/etsy/callback" || parsedRedirect.search || parsedRedirect.hash) {
    throw Object.assign(new Error("ETSY_REDIRECT_URI must be the exact HTTPS Etsy callback URL."), {
      code: "ETSY_REDIRECT_URI_INVALID",
      status: 503
    });
  }
  return { keystring, sharedSecret, redirectUri };
}
__name(etsyConfig, "etsyConfig");
function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
__name(randomBase64Url, "randomBase64Url");
async function sha256Hex(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
}
__name(sha256Hex, "sha256Hex");
async function etsyEncryptionKey(env) {
  const encoded = String(env.ETSY_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw Object.assign(new Error("Etsy token encryption is not configured."), {
      code: "ETSY_ENCRYPTION_NOT_CONFIGURED",
      status: 503
    });
  }
  const bytes = decodeBase64Url(encoded);
  if (bytes.byteLength !== 32) {
    throw Object.assign(new Error("ETSY_TOKEN_ENCRYPTION_KEY must decode to 32 bytes."), {
      code: "ETSY_ENCRYPTION_KEY_INVALID",
      status: 503
    });
  }
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
__name(etsyEncryptionKey, "etsyEncryptionKey");
async function encryptEtsySecret(env, value) {
  const key2 = await etsyEncryptionKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key2, plaintext));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}
__name(encryptEtsySecret, "encryptEtsySecret");
async function decryptEtsySecret(env, encoded) {
  const [version, ivEncoded, ciphertextEncoded] = String(encoded || "").split(".");
  if (version !== "v1" || !ivEncoded || !ciphertextEncoded) {
    throw Object.assign(new Error("Stored Etsy credentials are unreadable."), {
      code: "ETSY_CREDENTIALS_INVALID",
      status: 503
    });
  }
  try {
    const key2 = await etsyEncryptionKey(env);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(ivEncoded) },
      key2,
      decodeBase64Url(ciphertextEncoded)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error("Stored Etsy credentials could not be decrypted."), {
      code: "ETSY_CREDENTIALS_INVALID",
      status: 503
    });
  }
}
__name(decryptEtsySecret, "decryptEtsySecret");
function etsyApiHeaders(config2, accessToken) {
  const headers = {
    Accept: "application/json",
    "x-api-key": `${config2.keystring}:${config2.sharedSecret}`
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}
__name(etsyApiHeaders, "etsyApiHeaders");
async function verifyEtsyApiCredentials(env) {
  const config2 = etsyConfig(env);
  const response = await fetch(ETSY_API_PING_URL, {
    headers: etsyApiHeaders(config2)
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Etsy rejected the configured API key with HTTP ${response.status}.`), {
      code: "ETSY_API_KEY_INVALID",
      status: response.status >= 500 ? 502 : response.status
    });
  }
}
__name(verifyEtsyApiCredentials, "verifyEtsyApiCredentials");
async function etsyJson(response, code) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    throw Object.assign(new Error(`Etsy request failed with HTTP ${response.status}.`), {
      code,
      upstreamStatus: response.status,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(Math.ceil(retryAfter), 86400) : null,
      status: response.status >= 500 ? 502 : response.status
    });
  }
  return body;
}
__name(etsyJson, "etsyJson");
async function etsyAuthorizedJson(env, url, code, connection = null) {
  let active = connection || await freshEtsyConnection(env, false);
  const request = /* @__PURE__ */ __name(() => fetch(url, {
    headers: etsyApiHeaders(etsyConfig(env), active.accessToken)
  }), "request");
  let response = await request();
  if (response.status === 401) {
    active = await freshEtsyConnection(env, true);
    response = await request();
  }
  return { body: await etsyJson(response, code), connection: active };
}
__name(etsyAuthorizedJson, "etsyAuthorizedJson");
async function etsyApiKeyJson(env, url, code) {
  const response = await fetch(url, {
    headers: etsyApiHeaders(etsyConfig(env))
  });
  return etsyJson(response, code);
}
__name(etsyApiKeyJson, "etsyApiKeyJson");
async function requestEtsyToken(env, params) {
  const config2 = etsyConfig(env);
  const response = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": `${config2.keystring}:${config2.sharedSecret}`
    },
    body: new URLSearchParams(params)
  });
  const token = await etsyJson(response, "ETSY_TOKEN_EXCHANGE_FAILED");
  if (!token.access_token || token.token_type !== "Bearer" || !Number.isFinite(Number(token.expires_in))) {
    throw Object.assign(new Error("Etsy returned an invalid OAuth token response."), {
      code: "ETSY_TOKEN_RESPONSE_INVALID",
      status: 502
    });
  }
  return token;
}
__name(requestEtsyToken, "requestEtsyToken");
function etsyUserIdFromAccessToken(accessToken) {
  const match = /^(\d+)\./.exec(String(accessToken || ""));
  if (!match) {
    throw Object.assign(new Error("Etsy access token does not contain an owner ID."), {
      code: "ETSY_TOKEN_RESPONSE_INVALID",
      status: 502
    });
  }
  return match[1];
}
__name(etsyUserIdFromAccessToken, "etsyUserIdFromAccessToken");
function requireEtsyScope(scope) {
  const scopes = new Set(String(scope || "").split(/\s+/).filter(Boolean));
  if (!scopes.has(ETSY_OAUTH_SCOPE)) {
    throw Object.assign(new Error("Etsy did not grant the required read-only transaction scope."), {
      code: "ETSY_SCOPE_MISSING",
      status: 403
    });
  }
  return [...scopes].sort().join(" ");
}
__name(requireEtsyScope, "requireEtsyScope");
async function etsyShopForUser(env, userId, accessToken) {
  const config2 = etsyConfig(env);
  const response = await fetch(`${ETSY_API_BASE_URL}/users/${encodeURIComponent(userId)}/shops`, {
    headers: etsyApiHeaders(config2, accessToken)
  });
  const shop = await etsyJson(response, "ETSY_SHOP_READ_FAILED");
  if (!shop.shop_id || !shop.shop_name) {
    throw Object.assign(new Error("Etsy did not return a shop owned by the authorized user."), {
      code: "ETSY_SHOP_NOT_FOUND",
      status: 404
    });
  }
  return shop;
}
__name(etsyShopForUser, "etsyShopForUser");
async function persistEtsyConnection(env, { token, scope, actorId, userId, shop }) {
  const now = isoNow();
  const expiresAt = new Date(Date.now() + Number(token.expires_in) * 1e3).toISOString();
  const tokenCiphertext = await encryptEtsySecret(env, {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null
  });
  await requireOrderDb(env).prepare(`
      INSERT INTO etsy_connections (
        id, etsy_user_id, etsy_shop_id, shop_name, scope, token_ciphertext,
        access_expires_at, connected_by, connected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        etsy_user_id = excluded.etsy_user_id,
        etsy_shop_id = excluded.etsy_shop_id,
        shop_name = excluded.shop_name,
        scope = excluded.scope,
        token_ciphertext = excluded.token_ciphertext,
        access_expires_at = excluded.access_expires_at,
        connected_by = excluded.connected_by,
        connected_at = excluded.connected_at,
        updated_at = excluded.updated_at,
        last_tested_at = NULL,
        last_test_result_json = NULL
    `).bind(
    ETSY_CONNECTION_ID,
    String(userId),
    String(shop.shop_id),
    String(shop.shop_name),
    scope,
    tokenCiphertext,
    expiresAt,
    actorId,
    now,
    now
  ).run();
}
__name(persistEtsyConnection, "persistEtsyConnection");
async function loadEtsyConnection(env) {
  const row = await requireOrderDb(env).prepare("SELECT * FROM etsy_connections WHERE id = ?").bind(ETSY_CONNECTION_ID).first();
  if (!row) {
    throw Object.assign(new Error("Etsy has not been connected yet."), {
      code: "ETSY_NOT_CONNECTED",
      status: 409
    });
  }
  return row;
}
__name(loadEtsyConnection, "loadEtsyConnection");
async function freshEtsyConnection(env, forceRefresh = false) {
  const row = await loadEtsyConnection(env);
  const stored = await decryptEtsySecret(env, row.token_ciphertext);
  let accessToken = stored.accessToken;
  let refreshToken = stored.refreshToken;
  let refreshed = false;
  if (forceRefresh || Date.parse(row.access_expires_at) <= Date.now() + ETSY_ACCESS_REFRESH_SKEW_MS) {
    if (!refreshToken) {
      throw Object.assign(new Error("Etsy must be reconnected because no refresh token is available."), {
        code: "ETSY_REFRESH_TOKEN_MISSING",
        status: 409
      });
    }
    const config2 = etsyConfig(env);
    const token = await requestEtsyToken(env, {
      grant_type: "refresh_token",
      client_id: config2.keystring,
      refresh_token: refreshToken
    });
    const scope = requireEtsyScope(token.scope || row.scope);
    accessToken = token.access_token;
    refreshToken = token.refresh_token || refreshToken;
    const tokenCiphertext = await encryptEtsySecret(env, { accessToken, refreshToken });
    const updatedAt = isoNow();
    const accessExpiresAt = new Date(Date.now() + Number(token.expires_in) * 1e3).toISOString();
    await requireOrderDb(env).prepare(`
          UPDATE etsy_connections
          SET scope = ?, token_ciphertext = ?, access_expires_at = ?, updated_at = ?
          WHERE id = ?
        `).bind(scope, tokenCiphertext, accessExpiresAt, updatedAt, ETSY_CONNECTION_ID).run();
    row.scope = scope;
    row.access_expires_at = accessExpiresAt;
    row.updated_at = updatedAt;
    refreshed = true;
  }
  return { row, accessToken, refreshed };
}
__name(freshEtsyConnection, "freshEtsyConnection");
function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
__name(escapeHtml, "escapeHtml");
function etsyCallbackPage(status, title, message) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>You can close this window and return to Print-MO Order Manager.</p></main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(etsyCallbackPage, "etsyCallbackPage");
async function handleEtsyConnect(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const config2 = etsyConfig(env);
    await verifyEtsyApiCredentials(env);
    const db = requireOrderDb(env);
    const state = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const stateHash = await sha256Hex(state);
    const challenge = base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const now = isoNow();
    const expiresAt = new Date(Date.now() + ETSY_OAUTH_SESSION_TTL_MS).toISOString();
    const actorId = `${identity.kind}:${identity.subject}`;
    const encryptedVerifier = await encryptEtsySecret(env, { verifier });
    await db.prepare("DELETE FROM etsy_oauth_sessions WHERE expires_at < ? OR consumed_at IS NOT NULL").bind(now).run();
    await db.prepare(`
          INSERT INTO etsy_oauth_sessions (
            state_hash, code_verifier_ciphertext, redirect_uri, requested_scope,
            actor_id, expires_at, consumed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
        `).bind(stateHash, encryptedVerifier, config2.redirectUri, ETSY_OAUTH_SCOPE, actorId, expiresAt, now).run();
    const authorizationUrl = new URL(ETSY_AUTHORIZATION_URL);
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: config2.keystring,
      redirect_uri: config2.redirectUri,
      scope: ETSY_OAUTH_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    }).toString();
    return jsonResponse({
      authorizationUrl: authorizationUrl.toString(),
      callbackUrl: config2.redirectUri,
      scope: ETSY_OAUTH_SCOPE,
      expiresIn: Math.floor(ETSY_OAUTH_SESSION_TTL_MS / 1e3)
    }, allowOrigin, reqAllowHeaders, 201);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyConnect, "handleEtsyConnect");
async function handleEtsyOauthCallback(request, env) {
  try {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") || "";
    if (!state) {
      throw Object.assign(new Error("The Etsy callback did not include OAuth state."), {
        code: "ETSY_OAUTH_STATE_MISSING",
        status: 400
      });
    }
    const db = requireOrderDb(env);
    const stateHash = await sha256Hex(state);
    const session = await db.prepare("SELECT * FROM etsy_oauth_sessions WHERE state_hash = ?").bind(stateHash).first();
    if (!session || session.consumed_at || Date.parse(session.expires_at) <= Date.now()) {
      throw Object.assign(new Error("The Etsy authorization request is invalid, expired, or already used."), {
        code: "ETSY_OAUTH_STATE_INVALID",
        status: 400
      });
    }
    const consumedAt = isoNow();
    const consumed = await db.prepare(`
          UPDATE etsy_oauth_sessions SET consumed_at = ?
          WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?
        `).bind(consumedAt, stateHash, consumedAt).run();
    if (!consumed.meta?.changes) {
      throw Object.assign(new Error("The Etsy authorization request has already been used."), {
        code: "ETSY_OAUTH_STATE_INVALID",
        status: 400
      });
    }
    if (url.searchParams.get("error")) {
      return etsyCallbackPage(400, "Etsy connection was not completed", "Etsy authorization was denied or canceled.");
    }
    const code = url.searchParams.get("code") || "";
    if (!code) {
      throw Object.assign(new Error("The Etsy callback did not include an authorization code."), {
        code: "ETSY_OAUTH_CODE_MISSING",
        status: 400
      });
    }
    const config2 = etsyConfig(env);
    const { verifier } = await decryptEtsySecret(env, session.code_verifier_ciphertext);
    const token = await requestEtsyToken(env, {
      grant_type: "authorization_code",
      client_id: config2.keystring,
      redirect_uri: session.redirect_uri,
      code,
      code_verifier: verifier
    });
    const scope = requireEtsyScope(token.scope || session.requested_scope);
    const userId = etsyUserIdFromAccessToken(token.access_token);
    const shop = await etsyShopForUser(env, userId, token.access_token);
    await persistEtsyConnection(env, {
      token,
      scope,
      actorId: session.actor_id,
      userId,
      shop
    });
    return etsyCallbackPage(200, "Etsy connected", `${shop.shop_name} is authorized for the read-only connection test.`);
  } catch (error) {
    const errorCode = typeof error?.code === "string" ? `${error.code}: ` : "";
    return etsyCallbackPage(
      error.status || 500,
      "Etsy connection failed",
      `${errorCode}${error.message || "The Etsy connection could not be completed."}`
    );
  }
}
__name(handleEtsyOauthCallback, "handleEtsyOauthCallback");
async function handleEtsyStatus(env, allowOrigin, reqAllowHeaders) {
  try {
    const row = await requireOrderDb(env).prepare("SELECT * FROM etsy_connections WHERE id = ?").bind(ETSY_CONNECTION_ID).first();
    if (!row) {
      return jsonResponse({ connected: false, scope: ETSY_OAUTH_SCOPE }, allowOrigin, reqAllowHeaders);
    }
    let lastTest = null;
    try {
      lastTest = row.last_test_result_json ? JSON.parse(row.last_test_result_json) : null;
    } catch (_) {
    }
    return jsonResponse({
      connected: true,
      shop: { id: row.etsy_shop_id, name: row.shop_name },
      scope: row.scope,
      accessTokenExpiresAt: row.access_expires_at,
      connectedAt: row.connected_at,
      lastTestedAt: row.last_tested_at,
      lastTest
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyStatus, "handleEtsyStatus");
function jsonFieldType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string" || typeof value === "boolean") return typeof value;
  if (value && typeof value === "object") return "object";
  return "unknown";
}
__name(jsonFieldType, "jsonFieldType");
function redactedJsonFieldShape(value) {
  const observed = /* @__PURE__ */ new Map();
  let truncated = false;
  const record = /* @__PURE__ */ __name((path, type) => {
    if (!observed.has(path) && observed.size >= ETSY_FIELD_SHAPE_MAX_ENTRIES) {
      truncated = true;
      return false;
    }
    const types = observed.get(path) || /* @__PURE__ */ new Set();
    types.add(type);
    observed.set(path, types);
    return true;
  }, "record");
  const visit = /* @__PURE__ */ __name((current, path, depth) => {
    const type = jsonFieldType(current);
    if (!record(path, type)) return;
    if (depth >= ETSY_FIELD_SHAPE_MAX_DEPTH) {
      if (type === "array" || type === "object") truncated = true;
      return;
    }
    if (type === "array") {
      current.slice(0, ETSY_FIELD_SHAPE_ARRAY_SAMPLE).forEach((item) => visit(item, `${path}[]`, depth + 1));
      if (current.length > ETSY_FIELD_SHAPE_ARRAY_SAMPLE) truncated = true;
      return;
    }
    if (type !== "object") return;
    for (const [rawKey, child] of Object.entries(current)) {
      const key2 = SAFE_JSON_FIELD_NAME.test(rawKey) ? rawKey : "[dynamic-key]";
      visit(child, path === "$" ? key2 : `${path}.${key2}`, depth + 1);
      if (observed.size >= ETSY_FIELD_SHAPE_MAX_ENTRIES) break;
    }
  }, "visit");
  visit(value, "$", 0);
  return {
    fields: Array.from(observed.entries()).map(([path, types]) => ({ path, types: Array.from(types).sort() })).sort((left, right) => left.path.localeCompare(right.path)),
    truncated,
    valuesIncluded: false
  };
}
__name(redactedJsonFieldShape, "redactedJsonFieldShape");
function etsyNumericIdentity(value, field) {
  const normalized2 = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized2) || normalized2 === "0") {
    throw Object.assign(new Error(`Etsy ${field} is invalid.`), {
      code: "ETSY_IDENTITY_INVALID",
      status: 502
    });
  }
  return normalized2;
}
__name(etsyNumericIdentity, "etsyNumericIdentity");
function etsyMoney(value) {
  if (!value || typeof value !== "object") return null;
  const amount = Number(value.amount);
  const divisor = Number(value.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor <= 0) return null;
  return {
    amount: amount / divisor,
    currencyCode: String(value.currency_code || "").trim().toUpperCase() || null
  };
}
__name(etsyMoney, "etsyMoney");
function etsyTimestamp(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const parsed2 = new Date(seconds * 1e3);
  return Number.isNaN(parsed2.getTime()) ? null : parsed2.toISOString();
}
__name(etsyTimestamp, "etsyTimestamp");
function mergeEtsyTransactions(receipt, transactions) {
  const merged = /* @__PURE__ */ new Map();
  const apply = /* @__PURE__ */ __name((transaction) => {
    if (!transaction || typeof transaction !== "object") return;
    const id2 = String(transaction.transaction_id ?? "").trim();
    if (!id2) return;
    const next = { ...merged.get(id2) || {} };
    Object.entries(transaction).forEach(([key2, value]) => {
      if (value !== null && value !== void 0) next[key2] = value;
    });
    merged.set(id2, next);
  }, "apply");
  (Array.isArray(transactions) ? transactions : []).forEach((transaction) => apply(transaction));
  (Array.isArray(receipt?.transactions) ? receipt.transactions : []).forEach((transaction) => apply(transaction));
  return Array.from(merged.values());
}
__name(mergeEtsyTransactions, "mergeEtsyTransactions");
function etsyDeliveryMethod(fetchedAt = isoNow()) {
  return {
    kind: "shipping",
    types: ["SHIPPING"],
    complete: true,
    source: "etsy-shipping-policy",
    fetchedAt
  };
}
__name(etsyDeliveryMethod, "etsyDeliveryMethod");
function normalizeEtsyOrderContract({ providerAccountId, receipt, transactions = [], fetchedAt = isoNow() } = {}) {
  const accountId = etsyNumericIdentity(providerAccountId, "shop ID");
  const receiptId = etsyNumericIdentity(receipt?.receipt_id, "receipt ID");
  const orderKey = `etsy:${accountId}:${receiptId}`;
  const total = etsyMoney(receipt?.grandtotal) || etsyMoney(receipt?.total_price);
  const subtotal = etsyMoney(receipt?.subtotal);
  const discount = etsyMoney(receipt?.discount_amt);
  const normalizedLines = mergeEtsyTransactions(receipt, transactions).map((transaction) => {
    const transactionId = etsyNumericIdentity(transaction.transaction_id, "transaction ID");
    const variations = (Array.isArray(transaction.variations) ? transaction.variations : []).map((variation) => ({
      propertyId: variation?.property_id == null ? null : String(variation.property_id),
      valueId: variation?.value_id == null ? null : String(variation.value_id),
      questionId: variation?.question_id == null ? null : String(variation.question_id),
      name: String(variation?.formatted_name || "").trim(),
      value: String(variation?.formatted_value || "").trim()
    }));
    const linePrice = etsyMoney(transaction.price);
    return {
      id: `${orderKey}:${transactionId}`,
      externalLineId: transactionId,
      listingId: transaction.listing_id == null ? null : String(transaction.listing_id),
      title: String(transaction.title || "").trim() || "Untitled Etsy item",
      sku: String(transaction.sku || "").trim() || null,
      quantity: Math.max(0, Number(transaction.quantity) || 0),
      unitPrice: linePrice?.amount ?? null,
      currencyCode: linePrice?.currencyCode || total?.currencyCode || subtotal?.currencyCode || null,
      variations,
      personalization: variations.filter((variation) => variation.questionId || /personal/i.test(variation.name)),
      expectedShipAt: etsyTimestamp(transaction.expected_ship_date),
      listingImageId: transaction.listing_image_id == null ? null : String(transaction.listing_image_id),
      listingImageIsProductionArtwork: false
    };
  });
  const status = String(receipt?.status || "").trim().toLowerCase();
  const paid = Boolean(receipt?.is_paid ?? receipt?.was_paid ?? status === "paid");
  const canceled = Boolean(receipt?.is_canceled ?? receipt?.was_canceled ?? ["canceled", "cancelled"].includes(status));
  const shipped = Boolean(receipt?.is_shipped ?? receipt?.was_shipped);
  return {
    id: orderKey,
    orderKey,
    displayName: receiptId,
    createdAt: etsyTimestamp(receipt?.create_timestamp ?? receipt?.created_timestamp),
    sourceUpdatedAt: etsyTimestamp(receipt?.update_timestamp ?? receipt?.updated_timestamp),
    source: {
      provider: "etsy",
      label: "Etsy",
      providerAccountId: accountId,
      externalOrderId: receiptId,
      displayNumber: receiptId,
      adminUrl: null
    },
    customer: { displayName: String(receipt?.name || "").trim() || null },
    commerce: {
      paid,
      canceled,
      shipped,
      delivered: null,
      deliveryMethod: etsyDeliveryMethod(fetchedAt),
      financialStatus: paid ? "paid" : status || "unknown",
      fulfillmentStatus: shipped ? "shipped" : "unshipped",
      currencyCode: total?.currencyCode || subtotal?.currencyCode || null,
      subtotal: subtotal?.amount ?? null,
      discount: discount?.amount ?? null,
      total: total?.amount ?? null,
      lineItems: normalizedLines,
      hasBuyerMessage: Boolean(receipt?.message_from_buyer),
      isGift: Boolean(receipt?.is_gift),
      hasGiftMessage: Boolean(receipt?.gift_message),
      refundCount: Array.isArray(receipt?.refunds) ? receipt.refunds.length : 0,
      shipmentCount: Array.isArray(receipt?.shipments) ? receipt.shipments.length : 0
    },
    productionRef: {
      authority: "printmo-d1",
      provider: "etsy",
      orderKey,
      revision: null
    },
    capabilities: {
      commerceWrite: false,
      fulfillmentWrite: false,
      productionWrite: false
    },
    sync: {
      fetchedAt,
      partial: false,
      errors: []
    }
  };
}
__name(normalizeEtsyOrderContract, "normalizeEtsyOrderContract");
async function handleEtsyTestRead(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const body = await request.json().catch(() => ({}));
    const connection = await freshEtsyConnection(env, body.forceRefresh === true);
    const config2 = etsyConfig(env);
    const receiptsResponse = await fetch(
      `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts?limit=1&offset=0`,
      { headers: etsyApiHeaders(config2, connection.accessToken) }
    );
    const receipts = await etsyJson(receiptsResponse, "ETSY_RECEIPT_READ_FAILED");
    const receipt = Array.isArray(receipts.results) ? receipts.results[0] : null;
    let transactionCount = 0;
    let transactionRecords = [];
    if (receipt?.receipt_id) {
      const transactionsResponse = await fetch(
        `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts/${encodeURIComponent(receipt.receipt_id)}/transactions`,
        { headers: etsyApiHeaders(config2, connection.accessToken) }
      );
      const transactions = await etsyJson(transactionsResponse, "ETSY_TRANSACTION_READ_FAILED");
      transactionRecords = Array.isArray(transactions.results) ? transactions.results : [];
      transactionCount = transactionRecords.length || Number(transactions.count || 0);
    }
    const result = {
      ok: true,
      source: "etsy",
      shop: { id: connection.row.etsy_shop_id, name: connection.row.shop_name },
      scope: connection.row.scope,
      tokenRefreshed: connection.refreshed,
      receiptRead: {
        found: Boolean(receipt),
        paid: Boolean(receipt && (receipt.is_paid ?? receipt.was_paid ?? receipt.status === "paid")),
        canceled: Boolean(receipt && (receipt.is_canceled ?? receipt.was_canceled)),
        shipped: Boolean(receipt && (receipt.is_shipped ?? receipt.was_shipped)),
        transactionCount
      },
      customerDataRetained: false,
      boardChanged: false
    };
    if (body.includeFieldShape === true) {
      result.fieldShape = {
        schemaVersion: ETSY_FIELD_SHAPE_VERSION,
        receipt: redactedJsonFieldShape(receipt),
        transactions: redactedJsonFieldShape(transactionRecords),
        boundedSample: {
          receiptCount: receipt ? 1 : 0,
          transactionCount: Math.min(transactionRecords.length, ETSY_FIELD_SHAPE_ARRAY_SAMPLE)
        },
        customerValuesIncluded: false
      };
    }
    const testedAt = isoNow();
    await requireOrderDb(env).prepare(`
          UPDATE etsy_connections
          SET last_tested_at = ?, last_test_result_json = ?, updated_at = ?
          WHERE id = ?
        `).bind(testedAt, JSON.stringify(result), testedAt, ETSY_CONNECTION_ID).run();
    return jsonResponse(result, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyTestRead, "handleEtsyTestRead");
function etsyListingImageProbeError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
__name(etsyListingImageProbeError, "etsyListingImageProbeError");
function etsyPurchasedImageVariationEvidence(transaction, variationImages, listingImageId) {
  const selections = (Array.isArray(transaction?.variations) ? transaction.variations : []).filter((variation) => variation?.question_id == null).map((variation) => ({
    propertyId: variation?.property_id == null ? null : String(variation.property_id),
    valueId: variation?.value_id == null ? null : String(variation.value_id)
  })).filter((variation) => /^\d+$/.test(variation.propertyId || "") && /^\d+$/.test(variation.valueId || ""));
  const images = Array.isArray(variationImages?.results) ? variationImages.results : [];
  const matches = selections.map((selection) => {
    const image = images.find((candidate) => String(candidate?.property_id ?? "") === selection.propertyId && String(candidate?.value_id ?? "") === selection.valueId);
    return {
      propertyId: selection.propertyId,
      valueId: selection.valueId,
      imageMapped: Boolean(image?.image_id),
      transactionImageMatches: String(image?.image_id ?? "") === listingImageId
    };
  });
  const mapped = matches.filter((match) => match.imageMapped);
  const matching = mapped.filter((match) => match.transactionImageMatches);
  return {
    purchasedOptionCount: selections.length,
    mappedOptionCount: mapped.length,
    transactionImageMatchCount: matching.length,
    transactionImageMatchesPurchasedVariation: matching.length > 0,
    verdict: matching.length > 0 ? "MATCHED" : mapped.length > 0 ? "DIFFERENT_IMAGE" : "UNMAPPED",
    matches
  };
}
__name(etsyPurchasedImageVariationEvidence, "etsyPurchasedImageVariationEvidence");
function etsyListingImagePreview(image, listingId, listingImageId) {
  return {
    listingId,
    listingImageId,
    isProductionArtwork: false,
    dimensions: {
      width: Number.isFinite(Number(image?.full_width)) ? Number(image.full_width) : null,
      height: Number.isFinite(Number(image?.full_height)) ? Number(image.full_height) : null
    },
    renditionsAvailable: {
      thumbnail: Boolean(image?.url_75x75),
      standard: Boolean(image?.url_570xN),
      full: Boolean(image?.url_fullxfull)
    }
  };
}
__name(etsyListingImagePreview, "etsyListingImagePreview");
async function handleEtsyListingImageProbe(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const body = await request.json().catch(() => ({}));
    const receiptId = etsyNumericIdentity(body.receiptId, "receipt ID");
    const transactionId = etsyNumericIdentity(body.transactionId, "transaction ID");
    const connection = await freshEtsyConnection(env, false);
    const observed = await readEtsyReceiptForShadow(env, connection, { receiptId });
    if (!observed.receipt) {
      throw etsyListingImageProbeError("ETSY_RECEIPT_NOT_FOUND", "Etsy did not return the requested receipt.", 404);
    }
    const transaction = mergeEtsyTransactions(observed.receipt, observed.transactions).find((candidate) => String(candidate?.transaction_id ?? "") === transactionId);
    if (!transaction) {
      throw etsyListingImageProbeError("ETSY_TRANSACTION_NOT_FOUND", "The requested transaction is not in that Etsy receipt.", 404);
    }
    const listingId = etsyNumericIdentity(transaction.listing_id, "listing ID");
    const listingImageId = etsyNumericIdentity(transaction.listing_image_id, "listing image ID");
    const [image, variationImages] = await Promise.all([
      etsyApiKeyJson(
        env,
        `${ETSY_API_BASE_URL}/listings/${encodeURIComponent(listingId)}/images/${encodeURIComponent(listingImageId)}`,
        "ETSY_LISTING_IMAGE_READ_FAILED"
      ),
      etsyApiKeyJson(
        env,
        `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/listings/${encodeURIComponent(listingId)}/variation-images`,
        "ETSY_LISTING_VARIATION_IMAGES_READ_FAILED"
      )
    ]);
    if (String(image?.listing_id ?? "") !== listingId || String(image?.listing_image_id ?? "") !== listingImageId) {
      throw etsyListingImageProbeError("ETSY_LISTING_IMAGE_ID_MISMATCH", "Etsy returned an image that does not match the purchased transaction.", 502);
    }
    const variationEvidence = etsyPurchasedImageVariationEvidence(transaction, variationImages, listingImageId);
    return jsonResponse({
      ok: true,
      source: "etsy",
      scope: ETSY_OAUTH_SCOPE,
      boardChanged: false,
      imageBytesStored: false,
      customerDataIncluded: false,
      imageUrlIncluded: false,
      preview: {
        ...etsyListingImagePreview(image, listingId, listingImageId),
        purchasedVariationEvidence: variationEvidence
      }
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyListingImageProbe, "handleEtsyListingImageProbe");
async function handleEtsyCatalogImageProbe(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const body = await request.json().catch(() => ({}));
    const listingId = etsyNumericIdentity(body.listingId, "listing ID");
    const hasPropertyId = body.propertyId != null && String(body.propertyId).trim() !== "";
    const hasValueId = body.valueId != null && String(body.valueId).trim() !== "";
    if (hasPropertyId !== hasValueId) {
      throw etsyListingImageProbeError("ETSY_VARIATION_SELECTION_INCOMPLETE", "Select both the Etsy variation property and value IDs, or omit both to list mapped variations.");
    }
    const propertyId = hasPropertyId ? etsyNumericIdentity(body.propertyId, "variation property ID") : null;
    const valueId = hasValueId ? etsyNumericIdentity(body.valueId, "variation value ID") : null;
    const connection = await loadEtsyConnection(env);
    const listing = await etsyApiKeyJson(
      env,
      `${ETSY_API_BASE_URL}/listings/${encodeURIComponent(listingId)}`,
      "ETSY_CATALOG_LISTING_READ_FAILED"
    );
    if (String(listing?.shop_id ?? "") !== String(connection.etsy_shop_id)) {
      throw etsyListingImageProbeError("ETSY_LISTING_NOT_IN_CONNECTED_SHOP", "The selected listing does not belong to the connected Etsy shop.", 403);
    }
    const variationImages = await etsyApiKeyJson(
      env,
      `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.etsy_shop_id)}/listings/${encodeURIComponent(listingId)}/variation-images`,
      "ETSY_LISTING_VARIATION_IMAGES_READ_FAILED"
    );
    const mappedVariations = (Array.isArray(variationImages?.results) ? variationImages.results : []).map((candidate) => ({
      propertyId: candidate?.property_id == null ? null : String(candidate.property_id),
      valueId: candidate?.value_id == null ? null : String(candidate.value_id),
      value: typeof candidate?.value === "string" ? candidate.value : null,
      imageId: candidate?.image_id == null ? null : String(candidate.image_id)
    })).filter((candidate) => /^\d+$/.test(candidate.propertyId || "") && /^\d+$/.test(candidate.valueId || "") && /^\d+$/.test(candidate.imageId || ""));
    const responseBase = {
      ok: true,
      source: "etsy",
      catalogReadAuthorization: "api_key",
      connectionScope: connection.scope,
      boardChanged: false,
      imageBytesStored: false,
      customerDataIncluded: false,
      imageUrlIncluded: false
    };
    if (!hasPropertyId) {
      return jsonResponse({
        ...responseBase,
        probe: "catalog-variation-options",
        listingId,
        variationOptions: mappedVariations.map(({ propertyId: optionPropertyId, valueId: optionValueId, value }) => ({
          propertyId: optionPropertyId,
          valueId: optionValueId,
          value,
          imageMapped: true
        }))
      }, allowOrigin, reqAllowHeaders);
    }
    const selected = mappedVariations.find((candidate) => candidate.propertyId === propertyId && candidate.valueId === valueId);
    if (!selected) {
      throw etsyListingImageProbeError("ETSY_VARIATION_IMAGE_NOT_FOUND", "That listing variation does not have an Etsy image mapping.", 404);
    }
    const listingImageId = etsyNumericIdentity(selected.imageId, "variation image ID");
    const image = await etsyApiKeyJson(
      env,
      `${ETSY_API_BASE_URL}/listings/${encodeURIComponent(listingId)}/images/${encodeURIComponent(listingImageId)}`,
      "ETSY_LISTING_IMAGE_READ_FAILED"
    );
    if (String(image?.listing_id ?? "") !== listingId || String(image?.listing_image_id ?? "") !== listingImageId) {
      throw etsyListingImageProbeError("ETSY_LISTING_IMAGE_ID_MISMATCH", "Etsy returned an image that does not match the selected listing variation.", 502);
    }
    return jsonResponse({
      ...responseBase,
      probe: "catalog-variation-image",
      preview: {
        ...etsyListingImagePreview(image, listingId, listingImageId),
        selectedVariation: {
          propertyId,
          valueId,
          value: selected.value,
          imageMapped: true
        }
      }
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyCatalogImageProbe, "handleEtsyCatalogImageProbe");
function etsyListingIdFromCatalogInput(value) {
  const raw = String(value ?? "").trim();
  if (/^\d+$/.test(raw)) return etsyNumericIdentity(raw, "listing ID");
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw etsyListingImageProbeError("ETSY_LISTING_INPUT_INVALID", "Provide an Etsy listing URL or numeric listing ID.");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host === "etsy.com" || host.endsWith(".etsy.com"))) {
    throw etsyListingImageProbeError("ETSY_LISTING_INPUT_INVALID", "Provide an Etsy listing URL from etsy.com.");
  }
  const match = /^\/listing\/(\d+)(?:\/|$)/.exec(url.pathname);
  if (!match) throw etsyListingImageProbeError("ETSY_LISTING_INPUT_INVALID", "The Etsy listing URL does not contain a listing ID.");
  return etsyNumericIdentity(match[1], "listing ID");
}
__name(etsyListingIdFromCatalogInput, "etsyListingIdFromCatalogInput");
function etsyPreviewImageSourceUrl(image) {
  const raw = String(image?.url_570xN || "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw etsyListingImageProbeError("ETSY_PREVIEW_RENDITION_UNAVAILABLE", "Etsy did not provide a standard preview image rendition.", 502);
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host === "etsystatic.com" || host.endsWith(".etsystatic.com"))) {
    throw etsyListingImageProbeError("ETSY_PREVIEW_RENDITION_INVALID", "Etsy returned an unsupported preview image host.", 502);
  }
  return url.toString();
}
__name(etsyPreviewImageSourceUrl, "etsyPreviewImageSourceUrl");
function etsyPreviewFilename(contentType, listingId, imageId) {
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  return `etsy-${listingId}-${imageId}.${extension}`;
}
__name(etsyPreviewFilename, "etsyPreviewFilename");
async function etsyCatalogPreviewMappings(env, connection, listingId) {
  const listing = await etsyApiKeyJson(
    env,
    `${ETSY_API_BASE_URL}/listings/${encodeURIComponent(listingId)}`,
    "ETSY_CATALOG_LISTING_READ_FAILED"
  );
  if (String(listing?.shop_id ?? "") !== String(connection.etsy_shop_id)) {
    throw etsyListingImageProbeError("ETSY_LISTING_NOT_IN_CONNECTED_SHOP", "The selected listing does not belong to the connected Etsy shop.", 403);
  }
  const variationImages = await etsyApiKeyJson(
    env,
    `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.etsy_shop_id)}/listings/${encodeURIComponent(listingId)}/variation-images`,
    "ETSY_LISTING_VARIATION_IMAGES_READ_FAILED"
  );
  return (Array.isArray(variationImages?.results) ? variationImages.results : []).map((candidate) => ({
    propertyId: candidate?.property_id == null ? null : String(candidate.property_id),
    valueId: candidate?.value_id == null ? null : String(candidate.value_id),
    value: typeof candidate?.value === "string" ? candidate.value : null,
    listingImageId: candidate?.image_id == null ? null : String(candidate.image_id)
  })).filter((candidate) => /^\d+$/.test(candidate.propertyId || "") && /^\d+$/.test(candidate.valueId || "") && /^\d+$/.test(candidate.listingImageId || ""));
}
__name(etsyCatalogPreviewMappings, "etsyCatalogPreviewMappings");
async function existingEtsyCatalogPreviewMapping(db, shopId, listingId, propertyId, valueId) {
  return db.prepare(`
      SELECT mappings.id, mappings.listing_image_id, mappings.blob_id, blobs.state AS blob_state
      FROM etsy_catalog_preview_mappings AS mappings
      LEFT JOIN etsy_catalog_preview_blobs AS blobs ON blobs.id = mappings.blob_id
      WHERE mappings.shop_id = ? AND mappings.etsy_listing_id = ?
        AND mappings.property_id = ? AND mappings.value_id = ?
        AND mappings.source_type = 'etsy' AND mappings.resolution_mode = 'direct'
        AND mappings.state = 'active'
      LIMIT 1
    `).bind(shopId, listingId, propertyId, valueId).first();
}
__name(existingEtsyCatalogPreviewMapping, "existingEtsyCatalogPreviewMapping");
async function attachEtsyCatalogPreviews(env, dto) {
  if (String(dto?.source?.provider || "").toLowerCase() !== "etsy") return dto;
  const lineItems = Array.isArray(dto?.commerce?.lineItems) ? dto.commerce.lineItems : [];
  const listingIds = [...new Set(lineItems.map((item) => String(item?.listingId || "").trim()).filter((listingId) => /^\d{1,30}$/.test(listingId)))];
  if (!listingIds.length) return dto;
  const shop = await d1Shop(env);
  const mappings = await requireOrderDb(env).prepare(`
      SELECT id, etsy_listing_id, property_id, value_id, listing_image_id
      FROM etsy_catalog_preview_mappings
      WHERE shop_id = ? AND state = 'active'
        AND source_type = 'etsy' AND resolution_mode = 'direct'
        AND etsy_listing_id IN (${listingIds.map(() => "?").join(",")})
    `).bind(shop.id, ...listingIds).all();
  const bySelection = new Map((mappings.results || []).map((mapping) => [
    `${mapping.etsy_listing_id}:${mapping.property_id}:${mapping.value_id}`,
    mapping
  ]));
  const enrichedLines = lineItems.map((item) => {
    const listingId = String(item?.listingId || "").trim();
    const purchasedImageId = String(item?.listingImageId || "").trim();
    if (!listingId || !purchasedImageId) return item;
    const match = (Array.isArray(item.variations) ? item.variations : []).map((variation) => ({
      variation,
      mapping: bySelection.get(`${listingId}:${String(variation?.propertyId || "")}:${String(variation?.valueId || "")}`)
    })).find((candidate) => candidate.mapping && String(candidate.mapping.listing_image_id) === purchasedImageId);
    if (!match) return item;
    return {
      ...item,
      catalogPreview: {
        previewId: match.mapping.id,
        listingId,
        listingImageId: purchasedImageId,
        propertyId: String(match.variation.propertyId),
        valueId: String(match.variation.valueId),
        source: "etsy"
      }
    };
  });
  return {
    ...dto,
    commerce: { ...dto.commerce, lineItems: enrichedLines }
  };
}
__name(attachEtsyCatalogPreviews, "attachEtsyCatalogPreviews");
function etsyCatalogPreviewIsCurrent(existing, listingImageId) {
  return Boolean(existing?.id && existing?.blob_id && existing?.blob_state === "active" && String(existing?.listing_image_id || "") === String(listingImageId));
}
__name(etsyCatalogPreviewIsCurrent, "etsyCatalogPreviewIsCurrent");
async function fetchEtsyCatalogPreviewBytes(image, listingId, listingImageId) {
  const sourceUrl = etsyPreviewImageSourceUrl(image);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw etsyListingImageProbeError("ETSY_PREVIEW_IMAGE_DOWNLOAD_FAILED", `Etsy preview image download failed with HTTP ${response.status}.`, 502);
  }
  const contentType = String(response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!ETSY_CATALOG_PREVIEW_CONTENT_TYPES.has(contentType)) {
    throw etsyListingImageProbeError("ETSY_PREVIEW_IMAGE_TYPE_INVALID", "Etsy preview image is not a supported raster format.", 502);
  }
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > ETSY_CATALOG_PREVIEW_MAX_IMAGE_BYTES) {
    throw etsyListingImageProbeError("ETSY_PREVIEW_IMAGE_TOO_LARGE", "Etsy preview image exceeds the private-cache size limit.", 502);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > ETSY_CATALOG_PREVIEW_MAX_IMAGE_BYTES) {
    throw etsyListingImageProbeError("ETSY_PREVIEW_IMAGE_SIZE_INVALID", "Etsy preview image has an invalid size.", 502);
  }
  return { bytes, contentType, filename: etsyPreviewFilename(contentType, listingId, listingImageId) };
}
__name(fetchEtsyCatalogPreviewBytes, "fetchEtsyCatalogPreviewBytes");
async function storeEtsyCatalogPreviewBlob(env, db, shopId, source) {
  if (!env.R2_BUCKET) {
    throw etsyListingImageProbeError("R2_NOT_CONFIGURED", "Private preview storage is not configured.", 503);
  }
  const sha256 = bytesToHex(await crypto.subtle.digest("SHA-256", source.bytes));
  const existing = await db.prepare(`
      SELECT id, object_key, state
      FROM etsy_catalog_preview_blobs
      WHERE shop_id = ? AND sha256 = ? AND byte_size = ? AND content_type = ?
      LIMIT 1
    `).bind(shopId, sha256, source.bytes.byteLength, source.contentType).first();
  const blobId = existing?.id || await stableAssetId(`etsy-catalog-preview:${shopId}:${sha256}:${source.bytes.byteLength}:${source.contentType}`);
  const objectKey = existing?.object_key || `etsy/catalog-previews/${shopId}/blobs/${blobId}/${source.filename}`;
  const now = isoNow();
  await env.R2_BUCKET.put(objectKey, source.bytes, {
    httpMetadata: { contentType: source.contentType },
    customMetadata: { sha256, source: "etsy-catalog-preview" }
  });
  const stored = await env.R2_BUCKET.get(objectKey);
  if (!stored) throw etsyListingImageProbeError("ETSY_PREVIEW_R2_VERIFY_FAILED", "Private preview storage could not verify the cached image.", 502);
  const storedBytes = new Uint8Array(await stored.arrayBuffer());
  const storedDigest = bytesToHex(await crypto.subtle.digest("SHA-256", storedBytes));
  if (storedDigest !== sha256) throw etsyListingImageProbeError("ETSY_PREVIEW_R2_CHECKSUM_FAILED", "Private preview storage checksum verification failed.", 502);
  await db.prepare(`
      INSERT INTO etsy_catalog_preview_blobs (
        id, shop_id, object_key, content_type, byte_size, sha256, state, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        object_key = excluded.object_key,
        content_type = excluded.content_type,
        byte_size = excluded.byte_size,
        sha256 = excluded.sha256,
        state = 'active',
        deleted_at = NULL,
        updated_at = excluded.updated_at
    `).bind(blobId, shopId, objectKey, source.contentType, source.bytes.byteLength, sha256, now, now).run();
  return { blobId, sha256 };
}
__name(storeEtsyCatalogPreviewBlob, "storeEtsyCatalogPreviewBlob");
async function upsertEtsyCatalogPreviewMapping(db, { shopId, etsyShopId, listingId, mapping, blobId, actor }) {
  const previewId = await stableAssetId(`etsy-catalog-preview-mapping:${shopId}:${listingId}:${mapping.propertyId}:${mapping.valueId}:etsy:direct`);
  const now = isoNow();
  await db.prepare(`
      INSERT INTO etsy_catalog_preview_mappings (
        id, shop_id, etsy_shop_id, etsy_listing_id, property_id, value_id,
        listing_image_id, source_type, resolution_mode, blob_id, state,
        created_by, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'etsy', 'direct', ?, 'active', ?, ?, ?, NULL)
      ON CONFLICT(shop_id, etsy_listing_id, property_id, value_id, source_type, resolution_mode) DO UPDATE SET
        etsy_shop_id = excluded.etsy_shop_id,
        listing_image_id = excluded.listing_image_id,
        blob_id = excluded.blob_id,
        state = 'active',
        created_by = excluded.created_by,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `).bind(
    previewId,
    shopId,
    etsyShopId,
    listingId,
    mapping.propertyId,
    mapping.valueId,
    mapping.listingImageId,
    blobId,
    actor,
    now,
    now
  ).run();
  return previewId;
}
__name(upsertEtsyCatalogPreviewMapping, "upsertEtsyCatalogPreviewMapping");
async function importEtsyCatalogPreviewMapping(env, db, shop, connection, listingId, mapping, actor, sourceCache) {
  const imageKey = `${listingId}:${mapping.listingImageId}`;
  let sourcePromise = sourceCache.get(imageKey);
  if (!sourcePromise) {
    sourcePromise = (async () => {
      const image = await etsyApiKeyJson(
        env,
        `${ETSY_API_BASE_URL}/listings/${encodeURIComponent(listingId)}/images/${encodeURIComponent(mapping.listingImageId)}`,
        "ETSY_LISTING_IMAGE_READ_FAILED"
      );
      if (String(image?.listing_id ?? "") !== listingId || String(image?.listing_image_id ?? "") !== mapping.listingImageId) {
        throw etsyListingImageProbeError("ETSY_LISTING_IMAGE_ID_MISMATCH", "Etsy returned an image that does not match the selected listing variation.", 502);
      }
      return fetchEtsyCatalogPreviewBytes(image, listingId, mapping.listingImageId);
    })();
    sourceCache.set(imageKey, sourcePromise);
  }
  const source = await sourcePromise;
  const blob = await storeEtsyCatalogPreviewBlob(env, db, shop.id, source);
  const previewId = await upsertEtsyCatalogPreviewMapping(db, {
    shopId: shop.id,
    etsyShopId: String(connection.etsy_shop_id),
    listingId,
    mapping,
    blobId: blob.blobId,
    actor
  });
  return { previewId, sha256: blob.sha256 };
}
__name(importEtsyCatalogPreviewMapping, "importEtsyCatalogPreviewMapping");
async function activeEtsyListingIds(env, connection, offset) {
  const response = await etsyApiKeyJson(
    env,
    `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.etsy_shop_id)}/listings/active?limit=${ETSY_CATALOG_PREVIEW_MAX_LISTINGS}&offset=${offset}`,
    "ETSY_ACTIVE_LISTINGS_READ_FAILED"
  );
  const results = Array.isArray(response?.results) ? response.results : [];
  const listingIds = results.map((listing) => etsyNumericIdentity(listing?.listing_id, "listing ID"));
  const count = Number(response?.count);
  return {
    listingIds,
    nextOffset: Number.isFinite(count) && offset + listingIds.length < count ? offset + listingIds.length : null,
    totalActiveListings: Number.isFinite(count) ? count : null
  };
}
__name(activeEtsyListingIds, "activeEtsyListingIds");
async function handleEtsyCatalogPreviewSync(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const body = await request.json().catch(() => ({}));
    const execute = body.execute === true;
    const activeBackfill = body.activeBackfill === true;
    const rawListings = Array.isArray(body.listings) ? body.listings : Array.isArray(body.listingUrls) ? body.listingUrls : body.listing != null ? [body.listing] : [];
    if (activeBackfill && rawListings.length) {
      throw etsyListingImageProbeError("ETSY_PREVIEW_SCOPE_AMBIGUOUS", "Choose supplied listings or one active-listings page, not both.");
    }
    const connection = await loadEtsyConnection(env);
    let activePage = null;
    if (!activeBackfill && rawListings.length > ETSY_CATALOG_PREVIEW_MAX_LISTINGS) {
      throw etsyListingImageProbeError("ETSY_PREVIEW_LISTING_LIMIT", "Sync at most 25 listings per request.");
    }
    const activeOffset = Math.max(0, Math.floor(Number(body.offset) || 0));
    const listingIds = activeBackfill ? (activePage = await activeEtsyListingIds(env, connection, activeOffset)).listingIds : [...new Set(rawListings.map(etsyListingIdFromCatalogInput))];
    if (!listingIds.length) {
      throw etsyListingImageProbeError("ETSY_PREVIEW_LISTINGS_REQUIRED", "Provide up to 25 Etsy listing URLs or IDs, or request an active-listings page.");
    }
    const db = requireOrderDb(env);
    const shop = await d1Shop(env);
    const actor = `${identity.kind}:${identity.subject}`;
    const report = { wouldImport: 0, imported: 0, unchanged: 0, skipped: 0, failed: 0, listings: [] };
    const sourceCache = /* @__PURE__ */ new Map();
    for (const listingId of listingIds) {
      try {
        const mappings = await etsyCatalogPreviewMappings(env, connection, listingId);
        const result = { listingId, wouldImport: 0, imported: 0, unchanged: 0, skipped: 0, failed: 0, variations: [] };
        if (!mappings.length) {
          result.skipped = 1;
          result.variations.push({ outcome: "skipped", reason: "NO_DIRECT_ETSY_VARIATION_IMAGE" });
        }
        for (const mapping of mappings) {
          const existing = await existingEtsyCatalogPreviewMapping(db, shop.id, listingId, mapping.propertyId, mapping.valueId);
          if (etsyCatalogPreviewIsCurrent(existing, mapping.listingImageId)) {
            result.unchanged += 1;
            result.variations.push({
              propertyId: mapping.propertyId,
              valueId: mapping.valueId,
              value: mapping.value,
              listingImageId: mapping.listingImageId,
              previewId: existing.id,
              source: "etsy",
              outcome: "unchanged"
            });
            continue;
          }
          if (!execute) {
            result.wouldImport += 1;
            result.variations.push({
              propertyId: mapping.propertyId,
              valueId: mapping.valueId,
              value: mapping.value,
              listingImageId: mapping.listingImageId,
              source: "etsy",
              outcome: "would_import"
            });
            continue;
          }
          try {
            const stored = await importEtsyCatalogPreviewMapping(env, db, shop, connection, listingId, mapping, actor, sourceCache);
            result.imported += 1;
            result.variations.push({
              propertyId: mapping.propertyId,
              valueId: mapping.valueId,
              value: mapping.value,
              listingImageId: mapping.listingImageId,
              previewId: stored.previewId,
              source: "etsy",
              outcome: "imported"
            });
          } catch (error) {
            result.failed += 1;
            result.variations.push({
              propertyId: mapping.propertyId,
              valueId: mapping.valueId,
              value: mapping.value,
              source: "etsy",
              outcome: "failed",
              errorCode: error.code || "ETSY_PREVIEW_IMPORT_FAILED"
            });
          }
        }
        report.wouldImport += result.wouldImport;
        report.imported += result.imported;
        report.unchanged += result.unchanged;
        report.skipped += result.skipped;
        report.failed += result.failed;
        report.listings.push(result);
      } catch (error) {
        report.failed += 1;
        report.listings.push({ listingId, wouldImport: 0, imported: 0, unchanged: 0, skipped: 0, failed: 1, variations: [{ outcome: "failed", errorCode: error.code || "ETSY_PREVIEW_LISTING_FAILED" }] });
      }
    }
    return jsonResponse({
      ok: true,
      source: "etsy",
      mode: execute ? "execute" : "dry_run",
      catalogReadAuthorization: "api_key",
      connectionScope: connection.scope,
      boardChanged: false,
      orderDataChanged: false,
      productionArtworkChanged: false,
      imageUrlIncluded: false,
      customerDataIncluded: false,
      activeBackfill: activeBackfill ? {
        totalActiveListings: activePage.totalActiveListings,
        nextOffset: activePage.nextOffset
      } : null,
      report
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyCatalogPreviewSync, "handleEtsyCatalogPreviewSync");
function etsyPreviewRefreshKey(listingId, propertyId, valueId) {
  return `${listingId}:${propertyId}:${valueId}`;
}
__name(etsyPreviewRefreshKey, "etsyPreviewRefreshKey");
async function etsyCatalogPreviewRefreshPlan(env, db, shop, connection, listingId) {
  const liveMappings = await etsyCatalogPreviewMappings(env, connection, listingId);
  const stored = await db.prepare(`
      SELECT mappings.id, mappings.property_id, mappings.value_id, mappings.listing_image_id,
             mappings.blob_id, blobs.state AS blob_state
      FROM etsy_catalog_preview_mappings mappings
      LEFT JOIN etsy_catalog_preview_blobs blobs ON blobs.id = mappings.blob_id
      WHERE mappings.shop_id = ? AND mappings.etsy_listing_id = ? AND mappings.source_type = 'etsy'
        AND mappings.resolution_mode = 'direct' AND mappings.state = 'active'
    `).bind(shop.id, listingId).all();
  const liveBySelection = new Map(liveMappings.map((mapping) => [
    etsyPreviewRefreshKey(listingId, mapping.propertyId, mapping.valueId),
    mapping
  ]));
  const storedBySelection = new Map((stored.results || []).map((mapping) => [
    etsyPreviewRefreshKey(listingId, mapping.property_id, mapping.value_id),
    mapping
  ]));
  const variations = [];
  for (const mapping of liveMappings) {
    const key2 = etsyPreviewRefreshKey(listingId, mapping.propertyId, mapping.valueId);
    const existing = storedBySelection.get(key2);
    const proposedAction = etsyCatalogPreviewIsCurrent(existing, mapping.listingImageId) ? "unchanged" : existing ? "update" : "import";
    variations.push({
      listingId,
      propertyId: mapping.propertyId,
      valueId: mapping.valueId,
      value: mapping.value,
      listingImageId: mapping.listingImageId,
      existingPreviewId: existing?.id || null,
      existingListingImageId: existing?.listing_image_id || null,
      proposedAction
    });
  }
  for (const [key2, existing] of storedBySelection) {
    if (liveBySelection.has(key2)) continue;
    variations.push({
      listingId,
      propertyId: String(existing.property_id),
      valueId: String(existing.value_id),
      value: null,
      listingImageId: null,
      existingPreviewId: existing.id,
      existingListingImageId: existing.listing_image_id,
      proposedAction: "archive"
    });
  }
  return { listingId, variations };
}
__name(etsyCatalogPreviewRefreshPlan, "etsyCatalogPreviewRefreshPlan");
function etsyPreviewRefreshActions(body, listingIds) {
  const actions = Array.isArray(body?.actions) ? body.actions : [];
  const byKey = /* @__PURE__ */ new Map();
  for (const entry of actions) {
    const listingId = entry?.listingId == null ? listingIds.length === 1 ? listingIds[0] : null : etsyNumericIdentity(entry.listingId, "listing ID");
    const propertyId = entry?.propertyId == null ? "" : String(entry.propertyId).trim();
    const valueId = entry?.valueId == null ? "" : String(entry.valueId).trim();
    const action = String(entry?.action || "").trim().toLowerCase();
    if (!listingId || !/^\d+$/.test(propertyId) || !/^\d+$/.test(valueId) || !["import", "update", "archive", "keep"].includes(action)) {
      throw etsyListingImageProbeError("ETSY_PREVIEW_REFRESH_ACTION_INVALID", "Each refresh action needs a listing ID, property ID, value ID, and import, update, archive, or keep action.");
    }
    byKey.set(etsyPreviewRefreshKey(listingId, propertyId, valueId), action);
  }
  return byKey;
}
__name(etsyPreviewRefreshActions, "etsyPreviewRefreshActions");
async function handleEtsyCatalogPreviewRefresh(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawListings = Array.isArray(body.listings) ? body.listings : body.listing == null ? [] : [body.listing];
    const listingIds = [...new Set(rawListings.map(etsyListingIdFromCatalogInput))];
    if (!listingIds.length || listingIds.length > ETSY_CATALOG_PREVIEW_MAX_LISTINGS) {
      throw etsyListingImageProbeError("ETSY_PREVIEW_LISTINGS_REQUIRED", "Provide between one and 25 Etsy listing URLs or IDs.");
    }
    const execute = body.execute === true;
    const connection = await loadEtsyConnection(env);
    const db = requireOrderDb(env);
    const shop = await d1Shop(env);
    const plans = [];
    for (const listingId of listingIds) plans.push(await etsyCatalogPreviewRefreshPlan(env, db, shop, connection, listingId));
    if (!execute) return jsonResponse({
      ok: true,
      source: "etsy",
      mode: "review",
      boardChanged: false,
      orderDataChanged: false,
      productionArtworkChanged: false,
      plans
    }, allowOrigin, reqAllowHeaders);
    const selectedActions = etsyPreviewRefreshActions(body, listingIds);
    const actor = `${identity.kind}:${identity.subject}`;
    const sourceCache = /* @__PURE__ */ new Map();
    const applied = [];
    for (const plan of plans) {
      const liveByKey = new Map((await etsyCatalogPreviewMappings(env, connection, plan.listingId)).map((mapping) => [
        etsyPreviewRefreshKey(plan.listingId, mapping.propertyId, mapping.valueId),
        mapping
      ]));
      for (const variation of plan.variations) {
        const key2 = etsyPreviewRefreshKey(plan.listingId, variation.propertyId, variation.valueId);
        const action = selectedActions.get(key2);
        if (!action || action === "keep" || variation.proposedAction === "unchanged") continue;
        if (action === "archive" && variation.proposedAction === "archive") {
          await db.prepare(`
                      UPDATE etsy_catalog_preview_mappings
                      SET state = 'deleted', deleted_at = ?, updated_at = ?
                      WHERE shop_id = ? AND id = ? AND state = 'active'
                    `).bind(isoNow(), isoNow(), shop.id, variation.existingPreviewId).run();
          applied.push({ ...variation, action, outcome: "archived" });
          continue;
        }
        const live = liveByKey.get(key2);
        if (!live || !["import", "update"].includes(action) || action !== variation.proposedAction) {
          applied.push({ ...variation, action: action || "none", outcome: "skipped_action_mismatch" });
          continue;
        }
        const stored = await importEtsyCatalogPreviewMapping(env, db, shop, connection, plan.listingId, live, actor, sourceCache);
        applied.push({ ...variation, action, outcome: action === "update" ? "updated" : "imported", previewId: stored.previewId });
      }
    }
    return jsonResponse({
      ok: true,
      source: "etsy",
      mode: "execute",
      boardChanged: false,
      orderDataChanged: false,
      productionArtworkChanged: false,
      applied
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyCatalogPreviewRefresh, "handleEtsyCatalogPreviewRefresh");
function etsySupplierSelectorKey(variations) {
  const selections = (Array.isArray(variations) ? variations : []).filter((variation) => !variation?.questionId && variation?.propertyId != null && variation?.valueId != null).map((variation) => ({ propertyId: String(variation.propertyId).trim(), valueId: String(variation.valueId).trim() })).filter((variation) => /^\d+$/.test(variation.propertyId) && /^\d+$/.test(variation.valueId)).sort((left, right) => left.propertyId.localeCompare(right.propertyId) || left.valueId.localeCompare(right.valueId));
  return selections.map((variation) => `${variation.propertyId}:${variation.valueId}`).join("|");
}
__name(etsySupplierSelectorKey, "etsySupplierSelectorKey");
function etsyBlankRecipeVariants(input) {
  if (!Array.isArray(input) || !input.length || input.length > 250) {
    throw etsyListingImageProbeError("ETSY_BLANK_RECIPE_VARIANTS_REQUIRED", "Provide between one and 250 exact Etsy variation-to-S&S SKU mappings.");
  }
  const seen = /* @__PURE__ */ new Set();
  return input.map((entry) => {
    const selectorKey = etsySupplierSelectorKey(entry?.selections);
    const supplierSku = String(entry?.supplierSku || "").trim();
    const supplierColor = String(entry?.supplierColor || "").trim();
    const supplierSize = String(entry?.supplierSize || "").trim();
    if (!selectorKey || !/^[A-Za-z0-9._-]{2,120}$/.test(supplierSku) || !supplierColor || !supplierSize) {
      throw etsyListingImageProbeError("ETSY_BLANK_RECIPE_VARIANT_INVALID", "Each blank mapping needs exact Etsy selections and an exact S&S SKU, color, and size.");
    }
    if (seen.has(selectorKey)) throw etsyListingImageProbeError("ETSY_BLANK_RECIPE_SELECTOR_DUPLICATE", "Each Etsy variation selector can map to only one S&S SKU.");
    seen.add(selectorKey);
    return { selectorKey, supplierSku, supplierColor: supplierColor.slice(0, 120), supplierSize: supplierSize.slice(0, 80) };
  });
}
__name(etsyBlankRecipeVariants, "etsyBlankRecipeVariants");
async function handleEtsyBlankRecipe(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const body = await request.json().catch(() => ({}));
    const listingId = etsyListingIdFromCatalogInput(body.listing ?? body.listingId);
    const supplier = body?.supplier || {};
    const snapshotDate = String(supplier.snapshotDate || "").trim();
    const brand = String(supplier.brand || "").trim();
    const style = String(supplier.style || "").trim();
    if (String(supplier.name || "ss").toLowerCase() !== "ss" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !brand || !style) {
      throw etsyListingImageProbeError("ETSY_BLANK_RECIPE_SUPPLIER_INVALID", "Use the dated S&S snapshot plus an exact supplier brand and style.");
    }
    const variants = etsyBlankRecipeVariants(body.variants);
    const connection = await loadEtsyConnection(env);
    await etsyCatalogPreviewMappings(env, connection, listingId);
    if (body.execute !== true) return jsonResponse({
      ok: true,
      source: "etsy",
      mode: "review",
      boardChanged: false,
      orderDataChanged: false,
      listingId,
      supplier: { name: "ss", snapshotDate, brand, style },
      variants
    }, allowOrigin, reqAllowHeaders);
    const db = requireOrderDb(env);
    const shop = await d1Shop(env);
    const actor = `${identity.kind}:${identity.subject}`;
    const recipeId = await stableAssetId(`etsy-blank-recipe:${shop.id}:${listingId}:ss`);
    const now = isoNow();
    await db.prepare(`
          INSERT INTO etsy_listing_blank_recipes (
            id, shop_id, etsy_shop_id, etsy_listing_id, supplier, supplier_snapshot_date,
            supplier_brand, supplier_style, state, created_by, created_at, updated_at, archived_at
          ) VALUES (?, ?, ?, ?, 'ss', ?, ?, ?, 'active', ?, ?, ?, NULL)
          ON CONFLICT(shop_id, etsy_listing_id) DO UPDATE SET
            etsy_shop_id = excluded.etsy_shop_id, supplier = excluded.supplier,
            supplier_snapshot_date = excluded.supplier_snapshot_date, supplier_brand = excluded.supplier_brand,
            supplier_style = excluded.supplier_style, state = 'active', created_by = excluded.created_by,
            updated_at = excluded.updated_at, archived_at = NULL
        `).bind(recipeId, shop.id, String(connection.etsy_shop_id), listingId, snapshotDate, brand, style, actor, now, now).run();
    const variantStatements = [];
    for (const variant of variants) {
      const variantId = await stableAssetId(`etsy-blank-recipe-line:${recipeId}:${variant.selectorKey}`);
      variantStatements.push(db.prepare(`
              INSERT INTO etsy_listing_supplier_skus (
                id, shop_id, recipe_id, selector_key, supplier_sku, supplier_color, supplier_size,
                state, created_by, created_at, updated_at, archived_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)
              ON CONFLICT(recipe_id, selector_key) DO UPDATE SET
                supplier_sku = excluded.supplier_sku, supplier_color = excluded.supplier_color,
                supplier_size = excluded.supplier_size, state = 'active', created_by = excluded.created_by,
                updated_at = excluded.updated_at, archived_at = NULL
            `).bind(
        variantId,
        shop.id,
        recipeId,
        variant.selectorKey,
        variant.supplierSku,
        variant.supplierColor,
        variant.supplierSize,
        actor,
        now,
        now
      ));
    }
    await db.batch(variantStatements);
    const refreshedOrders = await refreshEtsySupplierSkusForListing(env, listingId);
    return jsonResponse({
      ok: true,
      source: "etsy",
      mode: "execute",
      listingId,
      supplier: { name: "ss", snapshotDate, brand, style },
      mappedVariants: variants.length,
      refreshedOrders,
      boardChanged: false,
      orderDataChanged: refreshedOrders > 0
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyBlankRecipe, "handleEtsyBlankRecipe");
async function resolveEtsySupplierSkus(env, contract) {
  const lines = Array.isArray(contract?.commerce?.lineItems) ? contract.commerce.lineItems : [];
  if (!lines.length) return contract;
  const shop = await d1Shop(env);
  const db = requireOrderDb(env);
  const resolvedLines = [];
  for (const item of lines) {
    const listingId = String(item?.listingId || "").trim();
    const selectorKey = etsySupplierSelectorKey(item?.variations);
    if (!listingId || !selectorKey) {
      resolvedLines.push(item);
      continue;
    }
    const mapping = await db.prepare(`
          SELECT m.supplier_sku, m.supplier_color, m.supplier_size,
                 r.supplier, r.supplier_snapshot_date, r.supplier_brand, r.supplier_style
          FROM etsy_listing_blank_recipes r
          JOIN etsy_listing_supplier_skus m ON m.recipe_id = r.id
          WHERE r.shop_id = ? AND r.etsy_listing_id = ? AND r.state = 'active'
            AND m.state = 'active' AND m.selector_key = ?
          LIMIT 1
        `).bind(shop.id, listingId, selectorKey).first();
    if (!mapping) {
      resolvedLines.push(item);
      continue;
    }
    resolvedLines.push({
      ...item,
      sourceSku: item.sku || null,
      supplierSku: mapping.supplier_sku,
      supplier: {
        name: mapping.supplier,
        snapshotDate: mapping.supplier_snapshot_date,
        brand: mapping.supplier_brand,
        style: mapping.supplier_style,
        color: mapping.supplier_color,
        size: mapping.supplier_size
      }
    });
  }
  return { ...contract, commerce: { ...contract.commerce, lineItems: resolvedLines } };
}
__name(resolveEtsySupplierSkus, "resolveEtsySupplierSkus");
function etsyShadowEligibility(receipt) {
  const status = String(receipt?.status || "").trim().toLowerCase();
  const paid = Boolean(receipt?.is_paid ?? receipt?.was_paid ?? status === "paid");
  const canceled = Boolean(receipt?.is_canceled ?? receipt?.was_canceled ?? ["canceled", "cancelled"].includes(status));
  const shipped = Boolean(receipt?.is_shipped ?? receipt?.was_shipped);
  if (!paid) return { eligible: false, reason: "NOT_PAID" };
  if (canceled) return { eligible: false, reason: "CANCELED" };
  if (shipped) return { eligible: false, reason: "ALREADY_SHIPPED" };
  return { eligible: true, reason: "PAID_UNSHIPPED" };
}
__name(etsyShadowEligibility, "etsyShadowEligibility");
async function readEtsyReceiptForShadow(env, connection, { receiptId = null } = {}) {
  let receipt;
  let activeConnection = connection;
  if (receiptId) {
    const result = await etsyAuthorizedJson(
      env,
      `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts/${encodeURIComponent(receiptId)}`,
      "ETSY_RECEIPT_READ_FAILED",
      activeConnection
    );
    receipt = result.body;
    activeConnection = result.connection;
  } else {
    const result = await etsyAuthorizedJson(
      env,
      `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts?limit=1&offset=0`,
      "ETSY_RECEIPT_READ_FAILED",
      activeConnection
    );
    const receipts = result.body;
    activeConnection = result.connection;
    receipt = Array.isArray(receipts.results) ? receipts.results[0] : null;
  }
  if (!receipt?.receipt_id) return { receipt: null, transactions: [] };
  const transactionResult = await etsyAuthorizedJson(
    env,
    `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts/${encodeURIComponent(receipt.receipt_id)}/transactions`,
    "ETSY_TRANSACTION_READ_FAILED",
    activeConnection
  );
  return {
    receipt,
    transactions: Array.isArray(transactionResult.body.results) ? transactionResult.body.results : []
  };
}
__name(readEtsyReceiptForShadow, "readEtsyReceiptForShadow");
async function persistEtsyShadowOrder(env, contract, eligibility, actorId, { enroll = false } = {}) {
  const db = requireOrderDb(env);
  const shop = await d1Shop(env);
  contract = await resolveEtsySupplierSkus(env, contract);
  const now = isoNow();
  const production = defaultProductionState(actorId || "etsy-shadow");
  const source = contract.source;
  await db.batch([
    db.prepare(`
          INSERT INTO provider_order_projection (
            shop_id, provider, provider_account_id, external_order_id, order_key,
            source_display_number, source_created_at, source_updated_at, commerce_json,
            eligibility_state, enrollment_state, board_enrolled, fetched_at, stale_at,
            last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shadow', 0, ?, NULL, NULL, ?, ?)
          ON CONFLICT(shop_id, provider, provider_account_id, external_order_id) DO UPDATE SET
            order_key = excluded.order_key,
            source_display_number = excluded.source_display_number,
            source_created_at = excluded.source_created_at,
            source_updated_at = excluded.source_updated_at,
            commerce_json = excluded.commerce_json,
            eligibility_state = excluded.eligibility_state,
            fetched_at = excluded.fetched_at,
            stale_at = NULL,
            last_error = NULL,
            updated_at = excluded.updated_at
        `).bind(
      shop.id,
      source.provider,
      source.providerAccountId,
      source.externalOrderId,
      contract.orderKey,
      source.displayNumber,
      contract.createdAt,
      contract.sourceUpdatedAt,
      JSON.stringify(contract),
      eligibility.reason,
      contract.sync.fetchedAt,
      now,
      now
    ),
    db.prepare(`
          INSERT INTO provider_production_state (
            shop_id, order_key, provider, provider_account_id, external_order_id,
            revision, last_mutation_id, state_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
          ON CONFLICT(shop_id, order_key) DO NOTHING
        `).bind(
      shop.id,
      contract.orderKey,
      source.provider,
      source.providerAccountId,
      source.externalOrderId,
      JSON.stringify(production),
      now,
      now
    )
  ]);
  if (enroll) {
    await db.prepare(`
          UPDATE provider_order_projection
          SET enrollment_state = 'active', board_enrolled = 1, updated_at = ?
          WHERE shop_id = ? AND order_key = ? AND eligibility_state = 'PAID_UNSHIPPED'
        `).bind(now, shop.id, contract.orderKey).run();
  }
  const persistedState = await db.prepare(`
      SELECT revision
      FROM provider_production_state
      WHERE shop_id = ? AND order_key = ?
    `).bind(shop.id, contract.orderKey).first();
  return { shopId: shop.id, revision: Number(persistedState?.revision || 0), enrolled: enroll };
}
__name(persistEtsyShadowOrder, "persistEtsyShadowOrder");
async function handleEtsyShadowSync(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;
    const latest = body.latest === true;
    const receiptId = body.receiptId == null ? null : etsyNumericIdentity(body.receiptId, "receipt ID");
    if (!receiptId && !(latest && dryRun)) {
      throw Object.assign(new Error("Shadow persistence requires an explicit Etsy receipt ID. Latest-receipt checks must be dry-run only."), {
        code: "ETSY_SHADOW_TARGET_REQUIRED",
        status: 400
      });
    }
    if (receiptId && latest) {
      throw Object.assign(new Error("Choose either an explicit Etsy receipt ID or a latest-receipt dry run."), {
        code: "ETSY_SHADOW_TARGET_INVALID",
        status: 400
      });
    }
    const connection = await freshEtsyConnection(env, false);
    const observed = await readEtsyReceiptForShadow(env, connection, { receiptId });
    if (!observed.receipt) {
      return jsonResponse({
        ok: true,
        source: "etsy",
        found: false,
        eligible: false,
        reason: "NO_RECEIPT",
        persisted: false,
        boardChanged: false
      }, allowOrigin, reqAllowHeaders);
    }
    const eligibility = etsyShadowEligibility(observed.receipt);
    if (!eligibility.eligible) {
      return jsonResponse({
        ok: true,
        source: "etsy",
        found: true,
        eligible: false,
        reason: eligibility.reason,
        persisted: false,
        boardChanged: false
      }, allowOrigin, reqAllowHeaders);
    }
    const contract = normalizeEtsyOrderContract({
      providerAccountId: connection.row.etsy_shop_id,
      receipt: observed.receipt,
      transactions: observed.transactions,
      fetchedAt: isoNow()
    });
    if (dryRun) {
      return jsonResponse({
        ok: true,
        source: "etsy",
        found: true,
        eligible: true,
        reason: eligibility.reason,
        persisted: false,
        orderKey: contract.orderKey,
        lineCount: contract.commerce.lineItems.length,
        currencyCode: contract.commerce.currencyCode,
        boardChanged: false
      }, allowOrigin, reqAllowHeaders);
    }
    const actorId = String(identity?.sub || identity?.userId || identity?.id || "etsy-shadow").slice(0, 160);
    const persisted = await persistEtsyShadowOrder(env, contract, eligibility, actorId);
    return jsonResponse({
      ok: true,
      source: "etsy",
      found: true,
      eligible: true,
      reason: eligibility.reason,
      persisted: true,
      orderKey: contract.orderKey,
      lineCount: contract.commerce.lineItems.length,
      currencyCode: contract.commerce.currencyCode,
      productionRevision: persisted.revision,
      enrollmentState: "shadow",
      boardChanged: false
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyShadowSync, "handleEtsyShadowSync");
function etsyWebhookEnrollmentEnabled(env) {
  return String(env.ETSY_WEBHOOK_ENROLLMENT_ENABLED || "0").trim() === "1";
}
__name(etsyWebhookEnrollmentEnabled, "etsyWebhookEnrollmentEnabled");
function etsyWebhookReconciliationEnabled(env) {
  return String(env.ETSY_WEBHOOK_RECONCILIATION_ENABLED || "1").trim() !== "0";
}
__name(etsyWebhookReconciliationEnabled, "etsyWebhookReconciliationEnabled");
async function handleEtsyWebhook(request, env, ctx) {
  try {
    const contentType = String(request.headers.get("Content-Type") || "").toLowerCase();
    const contentEncoding = String(request.headers.get("Content-Encoding") || "").trim().toLowerCase();
    const declaredLength = Number(request.headers.get("Content-Length"));
    if (!contentType.startsWith("application/json")) {
      throw etsyWebhookError("ETSY_WEBHOOK_CONTENT_TYPE_INVALID", "Etsy webhook content type must be JSON.", 415);
    }
    if (contentEncoding && contentEncoding !== "identity") {
      throw etsyWebhookError("ETSY_WEBHOOK_CONTENT_ENCODING_INVALID", "Encoded Etsy webhook bodies are not accepted.", 415);
    }
    if (Number.isFinite(declaredLength) && declaredLength > ETSY_WEBHOOK_MAX_BODY_BYTES) {
      throw etsyWebhookError("ETSY_WEBHOOK_BODY_TOO_LARGE", "Etsy webhook body is too large.", 413);
    }
    const rawBytes = new Uint8Array(await request.arrayBuffer());
    if (!rawBytes.byteLength || rawBytes.byteLength > ETSY_WEBHOOK_MAX_BODY_BYTES) {
      throw etsyWebhookError("ETSY_WEBHOOK_BODY_INVALID", "Etsy webhook body is empty or too large.", rawBytes.byteLength ? 413 : 400);
    }
    const verified = await verifyEtsyWebhookSignature(rawBytes, request.headers, env);
    let payload;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
    } catch (_) {
      throw etsyWebhookError("ETSY_WEBHOOK_JSON_INVALID", "Etsy webhook body is not valid JSON.", 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw etsyWebhookError("ETSY_WEBHOOK_PAYLOAD_INVALID", "Etsy webhook payload is invalid.", 400);
    }
    if (String(payload.event_type || "") !== ETSY_WEBHOOK_EVENT) {
      throw etsyWebhookError("ETSY_WEBHOOK_EVENT_UNSUPPORTED", "Etsy webhook event is not supported.", 422);
    }
    const connection = await loadEtsyConnection(env);
    const payloadShopId = etsyNumericIdentity(payload.shop_id, "shop ID");
    if (payloadShopId !== String(connection.etsy_shop_id)) {
      throw etsyWebhookError("ETSY_WEBHOOK_SHOP_INVALID", "Etsy webhook shop is not authorized.", 403);
    }
    const resource = parseEtsyWebhookResource(payload.resource_url, payloadShopId);
    const bodyHash = await sha256BytesHex(rawBytes);
    const shop = await d1Shop(env);
    const now = isoNow();
    const triggeredAt = new Date(verified.timestamp * 1e3).toISOString();
    const insert = await requireOrderDb(env).prepare(`
          INSERT OR IGNORE INTO etsy_webhook_deliveries (
            webhook_id, shop_id, event_type, etsy_shop_id, receipt_id, body_sha256,
            state, outcome_code, error_code, attempt_count, triggered_at,
            received_at, next_attempt_at, processed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'received', NULL, NULL, 0, ?, ?, NULL, NULL, ?)
        `).bind(
      verified.webhookId,
      shop.id,
      ETSY_WEBHOOK_EVENT,
      payloadShopId,
      resource.receiptId,
      bodyHash,
      triggeredAt,
      now,
      now
    ).run();
    if (!insert.meta?.changes) {
      const existing = await requireOrderDb(env).prepare(`
              SELECT event_type, etsy_shop_id, receipt_id, body_sha256, state
              FROM etsy_webhook_deliveries
              WHERE webhook_id = ?
            `).bind(verified.webhookId).first();
      const sameDelivery = existing && existing.event_type === ETSY_WEBHOOK_EVENT && existing.etsy_shop_id === payloadShopId && existing.receipt_id === resource.receiptId && existing.body_sha256 === bodyHash;
      if (!sameDelivery) {
        throw etsyWebhookError("ETSY_WEBHOOK_ID_CONFLICT", "Etsy webhook delivery ID was reused with different content.", 409);
      }
      return etsyWebhookResponse({ ok: true, duplicate: true, state: existing.state }, 200);
    }
    const processing = processEtsyWebhookDelivery(env, verified.webhookId).catch((error) => {
      console.error("Etsy webhook processing error:", String(error?.code || "ETSY_WEBHOOK_PROCESSING_FAILED"));
    });
    if (ctx?.waitUntil) ctx.waitUntil(processing);
    else await processing;
    return etsyWebhookResponse({ ok: true, accepted: true }, 202);
  } catch (error) {
    const status = Number(error?.status) || 500;
    const code = String(error?.code || "ETSY_WEBHOOK_FAILED");
    if (status >= 500) console.error("Etsy webhook endpoint error:", code);
    return etsyWebhookResponse({ ok: false, error: { code } }, status);
  }
}
__name(handleEtsyWebhook, "handleEtsyWebhook");
function etsyWebhookRetryAt(error, attemptCount) {
  const providerDelay = Number(error?.retryAfterSeconds);
  const fallback = ETSY_WEBHOOK_RETRY_DELAYS_SECONDS[Math.min(Math.max(0, attemptCount - 1), ETSY_WEBHOOK_RETRY_DELAYS_SECONDS.length - 1)];
  const delaySeconds = Number.isFinite(providerDelay) && providerDelay > 0 ? providerDelay : fallback;
  return new Date(Date.now() + delaySeconds * 1e3).toISOString();
}
__name(etsyWebhookRetryAt, "etsyWebhookRetryAt");
async function claimEtsyWebhookDelivery(env, webhookId) {
  const db = requireOrderDb(env);
  const now = isoNow();
  const leaseExpiredAt = new Date(Date.now() - ETSY_WEBHOOK_PROCESSING_LEASE_MS).toISOString();
  const claim = await db.prepare(`
      UPDATE etsy_webhook_deliveries
      SET state = 'processing', attempt_count = attempt_count + 1,
          next_attempt_at = NULL, error_code = NULL, updated_at = ?
      WHERE webhook_id = ?
        AND (
          state IN ('received', 'retry')
          OR (state = 'processing' AND updated_at <= ?)
        )
    `).bind(now, webhookId, leaseExpiredAt).run();
  if (!claim.meta?.changes) return null;
  return db.prepare("SELECT * FROM etsy_webhook_deliveries WHERE webhook_id = ?").bind(webhookId).first();
}
__name(claimEtsyWebhookDelivery, "claimEtsyWebhookDelivery");
async function completeEtsyWebhookDelivery(env, webhookId, state, outcomeCode, errorCode = null, nextAttemptAt = null) {
  const now = isoNow();
  await requireOrderDb(env).prepare(`
      UPDATE etsy_webhook_deliveries
      SET state = ?, outcome_code = ?, error_code = ?, next_attempt_at = ?,
          processed_at = CASE WHEN ? IN ('processed', 'ignored', 'failed') THEN ? ELSE processed_at END,
          updated_at = ?
      WHERE webhook_id = ?
    `).bind(state, outcomeCode, errorCode, nextAttemptAt, state, now, now, webhookId).run();
}
__name(completeEtsyWebhookDelivery, "completeEtsyWebhookDelivery");
async function processEtsyWebhookDelivery(env, webhookId) {
  const delivery = await claimEtsyWebhookDelivery(env, webhookId);
  if (!delivery) return { claimed: false };
  try {
    const connection = await freshEtsyConnection(env, false);
    if (String(connection.row.etsy_shop_id) !== String(delivery.etsy_shop_id)) {
      throw etsyWebhookError("ETSY_WEBHOOK_SHOP_INVALID", "Stored webhook shop is not authorized.", 403);
    }
    const observed = await readEtsyReceiptForShadow(env, connection, { receiptId: delivery.receipt_id });
    if (!observed.receipt) {
      await completeEtsyWebhookDelivery(env, webhookId, "ignored", "NO_RECEIPT");
      return { claimed: true, outcome: "NO_RECEIPT" };
    }
    if (String(observed.receipt.receipt_id) !== String(delivery.receipt_id)) {
      throw etsyWebhookError("ETSY_RECEIPT_ID_MISMATCH", "Etsy returned an unexpected receipt identity.", 502);
    }
    const eligibility = etsyShadowEligibility(observed.receipt);
    if (!eligibility.eligible) {
      await completeEtsyWebhookDelivery(env, webhookId, "ignored", eligibility.reason);
      return { claimed: true, outcome: eligibility.reason };
    }
    const contract = normalizeEtsyOrderContract({
      providerAccountId: connection.row.etsy_shop_id,
      receipt: observed.receipt,
      transactions: observed.transactions,
      fetchedAt: isoNow()
    });
    const enroll = etsyWebhookEnrollmentEnabled(env);
    await persistEtsyShadowOrder(env, contract, eligibility, "etsy-webhook", { enroll });
    const outcome = enroll ? "BOARD_ENROLLED" : "SHADOW_SYNCED";
    await completeEtsyWebhookDelivery(env, webhookId, "processed", outcome);
    return { claimed: true, outcome };
  } catch (error) {
    const attemptCount = Number(delivery.attempt_count || 1);
    const terminal = attemptCount >= ETSY_WEBHOOK_MAX_ATTEMPTS;
    const state = terminal ? "failed" : "retry";
    await completeEtsyWebhookDelivery(
      env,
      webhookId,
      state,
      terminal ? "RETRY_EXHAUSTED" : "RETRY_SCHEDULED",
      String(error?.code || "ETSY_WEBHOOK_PROCESSING_FAILED").slice(0, 120),
      terminal ? null : etsyWebhookRetryAt(error, attemptCount)
    );
    throw error;
  }
}
__name(processEtsyWebhookDelivery, "processEtsyWebhookDelivery");
async function retryDueEtsyWebhookDeliveries(env) {
  const now = isoNow();
  const leaseExpiredAt = new Date(Date.now() - ETSY_WEBHOOK_PROCESSING_LEASE_MS).toISOString();
  const due = await requireOrderDb(env).prepare(`
      SELECT webhook_id
      FROM etsy_webhook_deliveries
      WHERE (state = 'retry' AND next_attempt_at <= ?)
         OR (state = 'processing' AND updated_at <= ?)
      ORDER BY COALESCE(next_attempt_at, updated_at), received_at
      LIMIT 10
    `).bind(now, leaseExpiredAt).all();
  let processed = 0;
  for (const row of due.results || []) {
    try {
      const result = await processEtsyWebhookDelivery(env, row.webhook_id);
      if (result.claimed) processed += 1;
    } catch (_) {
    }
  }
  return { due: (due.results || []).length, processed };
}
__name(retryDueEtsyWebhookDeliveries, "retryDueEtsyWebhookDeliveries");
async function reconcileEtsyPaidReceipts(env, mode = "incremental") {
  if (!etsyWebhookReconciliationEnabled(env) || !etsyWebhookSecrets(env, { required: false }).length) {
    return { skipped: true, reason: "NOT_ACTIVE" };
  }
  const db = requireOrderDb(env);
  const shop = await d1Shop(env);
  const now = isoNow();
  const existing = await db.prepare(`
      SELECT checkpoint, last_started_at, last_completed_at
      FROM reconciliation_checkpoints
      WHERE shop_id = ? AND name = ?
    `).bind(shop.id, ETSY_RECONCILIATION_CHECKPOINT).first();
  const activeStart = Date.parse(existing?.last_started_at || "");
  const activeComplete = Date.parse(existing?.last_completed_at || "");
  if (Number.isFinite(activeStart) && activeStart > (Number.isFinite(activeComplete) ? activeComplete : 0) && activeStart > Date.now() - ETSY_WEBHOOK_PROCESSING_LEASE_MS) {
    return { skipped: true, reason: "ALREADY_RUNNING" };
  }
  await db.prepare(`
      INSERT INTO reconciliation_checkpoints (shop_id, name, checkpoint, last_started_at, last_completed_at, last_result_json)
      VALUES (?, ?, NULL, ?, NULL, NULL)
      ON CONFLICT(shop_id, name) DO UPDATE SET last_started_at = excluded.last_started_at
    `).bind(shop.id, ETSY_RECONCILIATION_CHECKPOINT, now).run();
  try {
    let priorCompletedAt = null;
    try {
      priorCompletedAt = JSON.parse(existing?.checkpoint || "{}").lastCompletedAt || null;
    } catch (_) {
    }
    const baseLookback = mode === "integrity" ? ETSY_RECONCILIATION_INTEGRITY_SECONDS : ETSY_RECONCILIATION_INITIAL_SECONDS;
    const priorSeconds = Math.floor(Date.parse(priorCompletedAt || "") / 1e3);
    const minimumSeconds = Number.isFinite(priorSeconds) ? priorSeconds - ETSY_RECONCILIATION_OVERLAP_SECONDS : Math.floor(Date.now() / 1e3) - baseLookback;
    const connection = await freshEtsyConnection(env, false);
    const maxPages = mode === "integrity" ? 4 : 2;
    let activeConnection = connection;
    let observed = 0;
    let eligible = 0;
    let persisted = 0;
    let truncated = false;
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(`${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts`);
      url.searchParams.set("min_last_modified", String(Math.max(946684800, minimumSeconds)));
      url.searchParams.set("was_paid", "true");
      url.searchParams.set("was_shipped", "false");
      url.searchParams.set("sort_on", "updated");
      url.searchParams.set("sort_order", "asc");
      url.searchParams.set("limit", String(ETSY_RECONCILIATION_LIMIT));
      url.searchParams.set("offset", String(page * ETSY_RECONCILIATION_LIMIT));
      const pageResult = await etsyAuthorizedJson(env, url.toString(), "ETSY_RECONCILIATION_READ_FAILED", activeConnection);
      activeConnection = pageResult.connection;
      const receipts = Array.isArray(pageResult.body.results) ? pageResult.body.results : [];
      observed += receipts.length;
      for (const receipt of receipts) {
        const eligibility = etsyShadowEligibility(receipt);
        if (!eligibility.eligible) continue;
        eligible += 1;
        const receiptId = etsyNumericIdentity(receipt.receipt_id, "receipt ID");
        const transactionResult = await etsyAuthorizedJson(
          env,
          `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts/${encodeURIComponent(receiptId)}/transactions`,
          "ETSY_TRANSACTION_READ_FAILED",
          activeConnection
        );
        activeConnection = transactionResult.connection;
        const contract = normalizeEtsyOrderContract({
          providerAccountId: connection.row.etsy_shop_id,
          receipt,
          transactions: Array.isArray(transactionResult.body.results) ? transactionResult.body.results : [],
          fetchedAt: isoNow()
        });
        await persistEtsyShadowOrder(env, contract, eligibility, "etsy-reconciliation", {
          enroll: etsyWebhookEnrollmentEnabled(env)
        });
        persisted += 1;
      }
      if (receipts.length < ETSY_RECONCILIATION_LIMIT) break;
      if (page === maxPages - 1) truncated = true;
    }
    const completedAt = isoNow();
    const result = { mode, observed, eligible, persisted, truncated, customerDataLogged: false };
    await db.prepare(`
          UPDATE reconciliation_checkpoints
          SET checkpoint = ?, last_completed_at = ?, last_result_json = ?
          WHERE shop_id = ? AND name = ?
        `).bind(
      JSON.stringify({ lastCompletedAt: truncated ? priorCompletedAt : completedAt }),
      completedAt,
      JSON.stringify(result),
      shop.id,
      ETSY_RECONCILIATION_CHECKPOINT
    ).run();
    return result;
  } catch (error) {
    await db.prepare(`
          UPDATE reconciliation_checkpoints
          SET last_result_json = ?
          WHERE shop_id = ? AND name = ?
        `).bind(
      JSON.stringify({ mode, failed: true, errorCode: String(error?.code || "ETSY_RECONCILIATION_FAILED") }),
      shop.id,
      ETSY_RECONCILIATION_CHECKPOINT
    ).run();
    throw error;
  }
}
__name(reconcileEtsyPaidReceipts, "reconcileEtsyPaidReceipts");
async function runEtsyWebhookMaintenance(env, mode = "incremental") {
  const retry = await retryDueEtsyWebhookDeliveries(env);
  const reconciliation = await reconcileEtsyPaidReceipts(env, mode);
  return { retry, reconciliation };
}
__name(runEtsyWebhookMaintenance, "runEtsyWebhookMaintenance");
async function handleEtsyWebhookStatus(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const shop = await d1Shop(env);
    let secretConfigured = false;
    let secretConfigurationError = null;
    try {
      secretConfigured = etsyWebhookSecrets(env, { required: false }).length > 0;
    } catch (error) {
      secretConfigurationError = String(error?.code || "ETSY_WEBHOOK_SECRET_INVALID");
    }
    const counts = await requireOrderDb(env).prepare(`
          SELECT state, COUNT(*) AS count
          FROM etsy_webhook_deliveries
          WHERE shop_id = ?
          GROUP BY state
        `).bind(shop.id).all();
    const latest = await requireOrderDb(env).prepare(`
          SELECT event_type, state, outcome_code, error_code, received_at, processed_at, updated_at
          FROM etsy_webhook_deliveries
          WHERE shop_id = ?
          ORDER BY received_at DESC
          LIMIT 1
        `).bind(shop.id).first();
    const checkpoint = await requireOrderDb(env).prepare(`
          SELECT last_started_at, last_completed_at, last_result_json
          FROM reconciliation_checkpoints
          WHERE shop_id = ? AND name = ?
        `).bind(shop.id, ETSY_RECONCILIATION_CHECKPOINT).first();
    let reconciliationResult = null;
    try {
      reconciliationResult = checkpoint?.last_result_json ? JSON.parse(checkpoint.last_result_json) : null;
    } catch (_) {
    }
    return jsonResponse({
      endpoint: String(env.ETSY_WEBHOOK_CALLBACK_URL || ""),
      event: ETSY_WEBHOOK_EVENT,
      secretConfigured,
      secretConfigurationError,
      mode: etsyWebhookEnrollmentEnabled(env) ? "automatic-enrollment" : "shadow-only",
      reconciliationEnabled: etsyWebhookReconciliationEnabled(env),
      deliveries: Object.fromEntries((counts.results || []).map((row) => [row.state, Number(row.count || 0)])),
      latest: latest || null,
      reconciliation: checkpoint ? {
        lastStartedAt: checkpoint.last_started_at,
        lastCompletedAt: checkpoint.last_completed_at,
        result: reconciliationResult
      } : null,
      customerDataIncluded: false
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyWebhookStatus, "handleEtsyWebhookStatus");
function etsySyntheticOrderKey(providerAccountId, externalId = ETSY_SYNTHETIC_EXTERNAL_ID) {
  return `etsy-synthetic:${etsyNumericIdentity(providerAccountId, "shop ID")}:${externalId}`;
}
__name(etsySyntheticOrderKey, "etsySyntheticOrderKey");
function syntheticEtsyOrderContract(providerAccountId, fetchedAt = isoNow()) {
  const accountId = etsyNumericIdentity(providerAccountId, "shop ID");
  const orderKey = etsySyntheticOrderKey(accountId);
  return {
    id: orderKey,
    orderKey,
    displayName: "#ETSY-TEST-001",
    createdAt: fetchedAt,
    sourceUpdatedAt: fetchedAt,
    source: {
      provider: "etsy",
      label: "Etsy",
      providerAccountId: accountId,
      externalOrderId: ETSY_SYNTHETIC_EXTERNAL_ID,
      displayNumber: "ETSY-TEST-001",
      adminUrl: null,
      synthetic: true
    },
    customer: { displayName: "Etsy test order" },
    commerce: {
      paid: true,
      canceled: false,
      shipped: false,
      delivered: false,
      synthetic: true,
      financialStatus: "paid",
      fulfillmentStatus: "unshipped",
      currencyCode: "USD",
      subtotal: 37,
      discount: 0,
      total: 40.05,
      lineItems: [
        {
          id: `${orderKey}:line-1`,
          externalLineId: "synthetic-line-1",
          listingId: "4452232638",
          title: "Etsy catalog preview test \u2014 Black",
          sku: "1717-BLACK-L",
          quantity: 1,
          currentQuantity: 1,
          unitPrice: 18.5,
          currencyCode: "USD",
          variations: [
            { propertyId: "200", valueId: "49928889190", questionId: null, name: "Color", value: "Black" }
          ],
          personalization: [],
          expectedShipAt: null,
          listingImageId: "7722005927",
          listingImageIsProductionArtwork: false
        },
        {
          id: `${orderKey}:line-2`,
          externalLineId: "synthetic-line-2",
          listingId: "4452232638",
          title: "Etsy catalog preview test \u2014 Green",
          sku: "1717-GREEN-L",
          quantity: 1,
          currentQuantity: 1,
          unitPrice: 18.5,
          currencyCode: "USD",
          variations: [
            { propertyId: "200", valueId: "49974750678", questionId: null, name: "Color", value: "Green" }
          ],
          personalization: [],
          expectedShipAt: null,
          listingImageId: "7722005929",
          listingImageIsProductionArtwork: false
        }
      ],
      hasBuyerMessage: false,
      isGift: false,
      hasGiftMessage: false,
      refundCount: 0,
      shipmentCount: 0
    },
    productionRef: {
      authority: "printmo-d1",
      provider: "etsy",
      orderKey,
      revision: 0
    },
    capabilities: {
      commerceWrite: false,
      fulfillmentWrite: false,
      productionWrite: true,
      supplierBatch: false,
      artworkUpload: false
    },
    sync: {
      fetchedAt,
      freshUntil: null,
      stale: false,
      partial: false,
      synthetic: true,
      errors: []
    }
  };
}
__name(syntheticEtsyOrderContract, "syntheticEtsyOrderContract");
function syntheticEtsyFullReceiptContract(providerAccountId, fetchedAt = isoNow()) {
  const accountId = etsyNumericIdentity(providerAccountId, "shop ID");
  const orderKey = etsySyntheticOrderKey(accountId, ETSY_SYNTHETIC_FULL_RECEIPT_EXTERNAL_ID);
  const timestamp = Math.floor(new Date(fetchedAt).getTime() / 1e3);
  const money2 = /* @__PURE__ */ __name((amount) => ({ amount, divisor: 100, currency_code: "USD" }), "money");
  const transaction = /* @__PURE__ */ __name(({ transactionId, color, colorValueId, size, sizeValueId, imageId, quantity, sku, personalization = null }) => ({
    transaction_id: transactionId,
    listing_id: 4452232638,
    title: `Synthetic Etsy receipt: ${color} / ${size}`,
    sku,
    quantity,
    price: money2(1850),
    expected_ship_date: timestamp + 3 * 24 * 60 * 60,
    listing_image_id: imageId,
    variations: [
      { property_id: 200, value_id: colorValueId, question_id: null, formatted_name: "Color", formatted_value: color },
      { property_id: 201, value_id: sizeValueId, question_id: null, formatted_name: "Size", formatted_value: size },
      ...personalization ? [{ property_id: 202, value_id: null, question_id: 9000001, formatted_name: "Personalization", formatted_value: personalization }] : []
    ]
  }), "transaction");
  const receipt = {
    receipt_id: 9999999002,
    create_timestamp: timestamp,
    update_timestamp: timestamp,
    status: "paid",
    is_paid: true,
    is_canceled: false,
    is_shipped: false,
    grandtotal: money2(12450),
    subtotal: money2(12950),
    discount_amt: money2(1295),
    name: "Avery Example (synthetic)",
    message_from_buyer: "Synthetic buyer message - no real customer data.",
    is_gift: true,
    gift_message: "Synthetic gift message - no real customer data.",
    refunds: [],
    shipments: []
  };
  const transactions = [
    transaction({ transactionId: 9999999101, color: "Black", colorValueId: 49928889190, size: "Large", sizeValueId: 90000011, imageId: 7722005927, quantity: 2, sku: "1717-BLACK-L" }),
    transaction({ transactionId: 9999999102, color: "White", colorValueId: 49974750696, size: "Medium", sizeValueId: 90000012, imageId: 7722005937, quantity: 1, sku: "1717-WHITE-M" }),
    transaction({ transactionId: 9999999103, color: "Red", colorValueId: 52041479599, size: "Extra Large", sizeValueId: 90000013, imageId: 7722005931, quantity: 1, sku: "1717-RED-XL", personalization: "NO REAL CUSTOMER DATA" }),
    transaction({ transactionId: 9999999104, color: "Green", colorValueId: 49974750678, size: "Small", sizeValueId: 90000014, imageId: 7722005929, quantity: 3, sku: "1717-GREEN-S" })
  ];
  const normalized2 = normalizeEtsyOrderContract({ providerAccountId: accountId, receipt, transactions, fetchedAt });
  return {
    ...normalized2,
    id: orderKey,
    orderKey,
    displayName: "#ETSY-TEST-RECEIPT-002",
    source: {
      ...normalized2.source,
      externalOrderId: ETSY_SYNTHETIC_FULL_RECEIPT_EXTERNAL_ID,
      displayNumber: "ETSY-TEST-RECEIPT-002",
      synthetic: true
    },
    commerce: { ...normalized2.commerce, synthetic: true },
    // Fixed `.invalid` contact data and a synthetic address exist only to
    // exercise detail fields that are not yet authorized from live Etsy.
    syntheticDetail: {
      orderNote: "Synthetic receipt only - verify color/size, pricing, personalization, delivery, and detail rendering.",
      customer: { email: "avery.example@printmo-test.invalid", phone: "+1 555-010-2002", locale: "en-US" },
      delivery: {
        shippingAddress: { name: "Avery Example (synthetic)", address1: "2002 Test Receipt Lane", address2: "Unit 4", city: "Exampleton", province: "Test State", zip: "00002", country: "United States", countryCode: "US" },
        billingAddress: { name: "Avery Example (synthetic)", address1: "2002 Test Receipt Lane", address2: null, city: "Exampleton", province: "Test State", zip: "00002", country: "United States", countryCode: "US" },
        shippingLines: [{ id: "synthetic-shipping-standard", title: "Standard synthetic shipping", code: "SYNTHETIC_STANDARD", source: "synthetic", deliveryCategory: "shipping", custom: false, originalPrice: { amount: 7.95, currencyCode: "USD" }, currentPrice: { amount: 7.95, currencyCode: "USD" } }],
        fulfillmentOrders: [],
        fulfillments: []
      },
      discounts: [{ id: "synthetic-discount-1", title: "SYNTHETIC10", code: "SYNTHETIC10", amount: { amount: 12.95, currencyCode: "USD" } }],
      timeline: [
        { id: `${orderKey}:created`, type: "SYNTHETIC_RECEIPT", createdAt: fetchedAt, action: "receipt.created", message: "Synthetic Etsy receipt created for end-to-end UI testing", author: "PrintMO test fixture" },
        { id: `${orderKey}:paid`, type: "SYNTHETIC_RECEIPT", createdAt: fetchedAt, action: "receipt.paid", message: "Synthetic payment captured", author: "PrintMO test fixture" }
      ]
    },
    productionRef: { authority: "printmo-d1", provider: "etsy", orderKey, revision: 0 },
    capabilities: { commerceWrite: false, fulfillmentWrite: false, productionWrite: true, supplierBatch: false, artworkUpload: false },
    sync: { fetchedAt, freshUntil: null, stale: false, partial: false, synthetic: true, errors: [] }
  };
}
__name(syntheticEtsyFullReceiptContract, "syntheticEtsyFullReceiptContract");
function syntheticEtsyScenario(body = {}) {
  const scenario = String(body?.scenario || "catalog_preview").trim();
  if (scenario === "catalog_preview") return {
    scenario,
    contract: syntheticEtsyOrderContract,
    createConfirmation: ETSY_SYNTHETIC_CONFIRM_CREATE,
    deleteConfirmation: ETSY_SYNTHETIC_CONFIRM_DELETE
  };
  if (scenario === "full_receipt") return {
    scenario,
    contract: syntheticEtsyFullReceiptContract,
    createConfirmation: ETSY_SYNTHETIC_FULL_RECEIPT_CONFIRM_CREATE,
    deleteConfirmation: ETSY_SYNTHETIC_FULL_RECEIPT_CONFIRM_DELETE
  };
  throw Object.assign(new Error("Synthetic Etsy scenario is invalid."), { code: "ETSY_SYNTHETIC_SCENARIO_INVALID", status: 400 });
}
__name(syntheticEtsyScenario, "syntheticEtsyScenario");
async function handleEtsySyntheticOrder(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const body = await request.json().catch(() => ({}));
    const connection = await loadEtsyConnection(env);
    const scenario = syntheticEtsyScenario(body);
    const contract = scenario.contract(connection.etsy_shop_id);
    const orderKey = contract.orderKey;
    const db = requireOrderDb(env);
    const shop = await d1Shop(env);
    if (request.method === "DELETE") {
      if (body.confirm !== scenario.deleteConfirmation) {
        throw Object.assign(new Error("Deleting the live Etsy test order requires the exact confirmation phrase."), {
          code: "ETSY_SYNTHETIC_CONFIRMATION_REQUIRED",
          status: 400
        });
      }
      const removed = await db.prepare(`
              DELETE FROM provider_order_projection
              WHERE shop_id = ? AND order_key = ? AND enrollment_state = 'pilot'
            `).bind(shop.id, orderKey).run();
      return jsonResponse({
        ok: true,
        source: "etsy",
        synthetic: true,
        orderKey,
        removed: Boolean(removed.meta?.changes)
      }, allowOrigin, reqAllowHeaders);
    }
    if (body.confirm !== scenario.createConfirmation) {
      throw Object.assign(new Error("Creating the live Etsy test order requires the exact confirmation phrase."), {
        code: "ETSY_SYNTHETIC_CONFIRMATION_REQUIRED",
        status: 400
      });
    }
    const existing = await db.prepare(`
          SELECT order_key FROM provider_order_projection
          WHERE shop_id = ? AND order_key = ?
        `).bind(shop.id, orderKey).first();
    const actor = `${identity?.kind || "unknown"}:${identity?.subject || "unknown"}`;
    const production = defaultProductionState(actor);
    const now = isoNow();
    await db.batch([
      db.prepare(`
              INSERT INTO provider_order_projection (
                shop_id, provider, provider_account_id, external_order_id, order_key,
                source_display_number, source_created_at, source_updated_at, commerce_json,
                eligibility_state, enrollment_state, board_enrolled, fetched_at, stale_at,
                last_error, created_at, updated_at
              ) VALUES (?, 'etsy', ?, ?, ?, ?, ?, ?, ?, 'SYNTHETIC_PILOT', 'pilot', 1, ?, NULL, NULL, ?, ?)
              ON CONFLICT(shop_id, provider, provider_account_id, external_order_id) DO UPDATE SET
                order_key = excluded.order_key,
                source_display_number = excluded.source_display_number,
                source_created_at = excluded.source_created_at,
                source_updated_at = excluded.source_updated_at,
                commerce_json = excluded.commerce_json,
                eligibility_state = excluded.eligibility_state,
                enrollment_state = 'pilot',
                board_enrolled = 1,
                fetched_at = excluded.fetched_at,
                stale_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at
            `).bind(
        shop.id,
        contract.source.providerAccountId,
        contract.source.externalOrderId,
        orderKey,
        contract.source.displayNumber,
        contract.createdAt,
        contract.sourceUpdatedAt,
        JSON.stringify(contract),
        contract.sync.fetchedAt,
        now,
        now
      ),
      db.prepare(`
              INSERT INTO provider_production_state (
                shop_id, order_key, provider, provider_account_id, external_order_id,
                revision, last_mutation_id, state_json, created_at, updated_at
              ) VALUES (?, ?, 'etsy', ?, ?, 0, NULL, ?, ?, ?)
              ON CONFLICT(shop_id, order_key) DO NOTHING
            `).bind(
        shop.id,
        orderKey,
        contract.source.providerAccountId,
        contract.source.externalOrderId,
        JSON.stringify(production),
        now,
        now
      )
    ]);
    return jsonResponse({
      ok: true,
      source: "etsy",
      synthetic: true,
      scenario: scenario.scenario,
      created: !existing,
      orderKey,
      displayName: contract.displayName,
      boardEnrolled: true,
      cleanupConfirmation: scenario.deleteConfirmation
    }, allowOrigin, reqAllowHeaders, existing ? 200 : 201);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsySyntheticOrder, "handleEtsySyntheticOrder");
async function d1Shop(env, { allowUninstalled = false } = {}) {
  const db = requireOrderDb(env);
  const shop = shopDomain(env);
  const now = isoNow();
  await db.prepare(`
      INSERT INTO shops (shop_domain, installed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(shop_domain) DO UPDATE SET updated_at = excluded.updated_at
    `).bind(shop, now, now, now).run();
  const row = await db.prepare("SELECT id, shop_domain, uninstalled_at FROM shops WHERE shop_domain = ?").bind(shop).first();
  if (!row) throw Object.assign(new Error("Unable to initialize the shop database record."), { code: "SHOP_DB_INIT_FAILED", status: 503 });
  if (row.uninstalled_at && !allowUninstalled) {
    throw Object.assign(new Error("This Shopify installation is disabled."), { code: "SHOP_UNINSTALLED", status: 403 });
  }
  return row;
}
__name(d1Shop, "d1Shop");
function validTargetDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
__name(validTargetDate, "validTargetDate");
function defaultProductionState(actor = "system") {
  const now = isoNow();
  return {
    schemaVersion: 1,
    revision: 0,
    lastMutationId: null,
    stage: "received",
    readiness: { blanksOrdered: false, blanksReady: false, printsOrdered: false, printsReady: false },
    printsOnSavedSheet: false,
    artworkReferences: {},
    printedCount: 0,
    printEligibility: {},
    printPlacements: {},
    targetDate: null,
    bundleId: null,
    batchRefs: [],
    internalNotes: "",
    attention: { required: false, reasons: [], acknowledgedAt: null },
    archivedAt: null,
    archivedBy: null,
    updatedAt: now,
    updatedBy: actor
  };
}
__name(defaultProductionState, "defaultProductionState");
function normalizeProductionState(value, actor = "system") {
  const base = defaultProductionState(actor);
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const readiness = input.readiness && typeof input.readiness === "object" ? input.readiness : {};
  const attention = input.attention && typeof input.attention === "object" ? input.attention : {};
  return {
    ...base,
    schemaVersion: 1,
    revision: Math.max(0, Number.isInteger(Number(input.revision)) ? Number(input.revision) : 0),
    lastMutationId: input.lastMutationId ? String(input.lastMutationId).slice(0, 160) : null,
    stage: PRODUCTION_STAGES.has(input.stage) ? input.stage : "received",
    readiness: {
      blanksOrdered: "blanksOrdered" in readiness ? Boolean(readiness.blanksOrdered) : ["blanks_ordered", "print", "completed"].includes(input.stage),
      blanksReady: Boolean(readiness.blanksReady),
      printsOrdered: Boolean(readiness.printsOrdered),
      printsReady: Boolean(readiness.printsReady)
    },
    printsOnSavedSheet: Boolean(input.printsOnSavedSheet) && !readiness.printsOrdered && !readiness.printsReady,
    artworkReferences: Object.fromEntries(Object.entries(input.artworkReferences || {}).filter(([key2, value2]) => /^[A-Za-z0-9_-]{1,160}\|[a-z0-9_-]{0,40}$/.test(key2) && value2 === true).slice(0, 500)),
    printedCount: Math.min(Math.max(Number(input.printedCount) || 0, 0), 1e6),
    printEligibility: Object.fromEntries(Object.entries(input.printEligibility || {}).filter(([id2, value2]) => validPrintItemId(id2) && typeof value2 === "boolean").slice(0, 1e3)),
    printPlacements: normalizePrintPlacements(input.printPlacements),
    bundleId: input.bundleId ? String(input.bundleId).slice(0, 160) : null,
    targetDate: validTargetDate(input.targetDate) ? input.targetDate : null,
    batchRefs: Array.isArray(input.batchRefs) ? [...new Set(input.batchRefs.map(String))].slice(0, 100) : [],
    internalNotes: String(input.internalNotes || "").slice(0, 5e3),
    attention: {
      required: Boolean(attention.required),
      reasons: Array.isArray(attention.reasons) ? [...new Set(attention.reasons.map(String))].slice(0, 25) : [],
      acknowledgedAt: attention.acknowledgedAt || null
    },
    archivedAt: input.archivedAt || null,
    archivedBy: input.archivedBy || null,
    updatedAt: input.updatedAt || base.updatedAt,
    updatedBy: input.updatedBy || actor
  };
}
__name(normalizeProductionState, "normalizeProductionState");
function parseProductionMetafield(metafield, actor = "system") {
  if (!metafield?.value) return { state: defaultProductionState(actor), compareDigest: null, exists: false };
  try {
    return {
      state: normalizeProductionState(JSON.parse(metafield.value), actor),
      compareDigest: metafield.compareDigest || null,
      exists: true
    };
  } catch (_) {
    throw Object.assign(new Error("The Shopify production metafield contains invalid JSON."), {
      code: "INVALID_PRODUCTION_METAFIELD",
      status: 409
    });
  }
}
__name(parseProductionMetafield, "parseProductionMetafield");
function productionForClient(gid2, state, compareDigest, assets = [], garmentCount = null) {
  return {
    id: gid2,
    stage: state.stage,
    version: state.revision,
    revision: state.revision,
    compareDigest: compareDigest || null,
    bundleId: state.bundleId || "",
    blanksPo: state.batchRefs || [],
    garmentCount: Number.isInteger(garmentCount) && garmentCount >= 0 ? garmentCount : null,
    printedCount: state.printedCount,
    printEligibility: state.printEligibility || {},
    printPlacements: state.printPlacements || {},
    targetDate: state.targetDate || null,
    blanksOrdered: state.readiness.blanksOrdered ? 1 : 0,
    blanksStatus: state.readiness.blanksReady ? 1 : 0,
    printsStatus: state.readiness.printsReady ? 1 : 0,
    printsOrdered: state.readiness.printsOrdered ? 1 : 0,
    printsOnSavedSheet: Boolean(state.printsOnSavedSheet),
    artworkReferences: { ...state.artworkReferences },
    internalNotes: state.internalNotes,
    attention: state.attention,
    archivedAt: state.archivedAt,
    archivedBy: state.archivedBy,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
    assets
  };
}
__name(productionForClient, "productionForClient");
async function readProductionMetafield(env, gid2, actor = "system", graphQL = coordinatorGraphQL) {
  const result = await graphQL(env, PRODUCTION_STATE_QUERY, { id: gid2 }, "PrintMOProductionState");
  const data2 = requireShopifyData(result, "PrintMOProductionState");
  if (!data2.order) throw Object.assign(new Error("Shopify order not found."), { code: "ORDER_NOT_FOUND", status: 404 });
  const parsed2 = parseProductionMetafield(data2.order.metafield, actor);
  return { gid: gid2, order: data2.order, ...parsed2 };
}
__name(readProductionMetafield, "readProductionMetafield");
function normalizeProductionPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw Object.assign(new Error("Production patch must be an object."), { code: "INVALID_PATCH", status: 400 });
  }
  const aliases = {
    stage: "stage",
    bundleId: "bundleId",
    bundle_id: "bundleId",
    internalNotes: "internalNotes",
    internal_notes: "internalNotes",
    printedCount: "printedCount",
    printed_count: "printedCount",
    printEligibility: "printEligibility",
    print_eligibility: "printEligibility",
    print_placements: "printPlacements",
    printPlacements: "printPlacements",
    targetDate: "targetDate",
    target_date: "targetDate",
    blanksStatus: "blanksStatus",
    blanks_status: "blanksStatus",
    blanksOrdered: "blanksOrdered",
    blanks_ordered: "blanksOrdered",
    printsStatus: "printsStatus",
    prints_status: "printsStatus",
    printsOrdered: "printsOrdered",
    prints_ordered: "printsOrdered",
    printsOnSavedSheet: "printsOnSavedSheet",
    prints_on_saved_sheet: "printsOnSavedSheet",
    artworkReferences: "artworkReferences",
    artwork_references: "artworkReferences",
    attention: "attention",
    archivedAt: "archivedAt",
    archived_at: "archivedAt"
  };
  const normalized2 = {};
  for (const [key2, value] of Object.entries(patch)) {
    const target = aliases[key2];
    if (!target) throw Object.assign(new Error(`Production field "${key2}" is not mutable.`), { code: "INVALID_PATCH_FIELD", status: 400 });
    normalized2[target] = value;
  }
  if ("printPlacements" in normalized2) normalizePrintPlacements(normalized2.printPlacements, true);
  if ("artworkReferences" in normalized2) {
    const references = normalized2.artworkReferences;
    if (!references || typeof references !== "object" || Array.isArray(references) || Object.keys(references).length > 500 || Object.entries(references).some(([key2, value]) => !/^[A-Za-z0-9_-]{1,160}\|[a-z0-9_-]{0,40}$/.test(key2) || value !== true && value !== null)) {
      throw Object.assign(new Error("Artwork references require asset/placement identities and true or null."), {
        code: "INVALID_ARTWORK_REFERENCE",
        status: 400
      });
    }
  }
  if ("targetDate" in normalized2 && normalized2.targetDate !== null && !validTargetDate(normalized2.targetDate)) {
    throw Object.assign(new Error("Choose a valid target date, or clear the date."), {
      code: "INVALID_TARGET_DATE",
      status: 400
    });
  }
  if ("printEligibility" in normalized2) {
    const values = normalized2.printEligibility;
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 1e3 || Object.entries(values).some(([id2, value]) => !validPrintItemId(id2) || typeof value !== "boolean" && value !== null)) {
      throw Object.assign(new Error("Printable item overrides require line-item IDs and true, false, or null."), {
        code: "INVALID_PRINT_ELIGIBILITY",
        status: 400
      });
    }
  }
  if ("stage" in normalized2 && !PRODUCTION_STAGES.has(normalized2.stage)) {
    throw Object.assign(new Error("Production stage is invalid."), { code: "INVALID_STAGE", status: 400 });
  }
  if ("bundleId" in normalized2 && normalized2.bundleId !== null && String(normalized2.bundleId).length > 160) {
    throw Object.assign(new Error("Bundle is too long."), { code: "INVALID_BUNDLE", status: 400 });
  }
  if ("internalNotes" in normalized2 && String(normalized2.internalNotes || "").length > 5e3) {
    throw Object.assign(new Error("Internal notes exceed 5,000 characters."), { code: "INVALID_NOTES", status: 400 });
  }
  if ("printedCount" in normalized2) {
    const count = Number(normalized2.printedCount);
    if (!Number.isInteger(count) || count < 0 || count > 1e6) {
      throw Object.assign(new Error("Printed count must be a non-negative integer."), { code: "INVALID_PRINTED_COUNT", status: 400 });
    }
  }
  for (const flag of ["blanksStatus", "blanksOrdered", "printsStatus", "printsOrdered", "printsOnSavedSheet"]) {
    if (flag in normalized2 && ![0, 1, false, true].includes(normalized2[flag])) {
      throw Object.assign(new Error(`${flag} must be boolean or 0/1.`), { code: "INVALID_READINESS", status: 400 });
    }
  }
  if ("archivedAt" in normalized2 && normalized2.archivedAt !== null && normalized2.archivedAt !== true && (typeof normalized2.archivedAt !== "string" || !normalized2.archivedAt.trim())) {
    throw Object.assign(new Error("Archive state must be a timestamp, true, or null."), { code: "INVALID_ARCHIVE_STATE", status: 400 });
  }
  return normalized2;
}
__name(normalizeProductionPatch, "normalizeProductionPatch");
function applyProductionPatch(current, patch, actor, mutationId) {
  const next = normalizeProductionState(current, actor);
  if ("stage" in patch) next.stage = patch.stage;
  if ("bundleId" in patch) next.bundleId = patch.bundleId ? String(patch.bundleId) : null;
  if ("internalNotes" in patch) next.internalNotes = String(patch.internalNotes || "");
  if ("targetDate" in patch) next.targetDate = patch.targetDate;
  if ("printPlacements" in patch) {
    for (const [id2, entry] of Object.entries(patch.printPlacements)) {
      if (entry === null) delete next.printPlacements[id2];
      else next.printPlacements[id2] = normalizePrintPlacements({ [id2]: entry })[id2];
    }
  }
  if ("printedCount" in patch) next.printedCount = Number(patch.printedCount);
  if ("printEligibility" in patch) {
    for (const [id2, value] of Object.entries(patch.printEligibility)) {
      if (value === null) delete next.printEligibility[id2];
      else next.printEligibility[id2] = value;
    }
  }
  if ("blanksStatus" in patch) next.readiness.blanksReady = Boolean(Number(patch.blanksStatus));
  if ("blanksOrdered" in patch) next.readiness.blanksOrdered = Boolean(Number(patch.blanksOrdered));
  if ("printsStatus" in patch) next.readiness.printsReady = Boolean(Number(patch.printsStatus));
  if ("printsOrdered" in patch) next.readiness.printsOrdered = Boolean(Number(patch.printsOrdered));
  if ("printsOnSavedSheet" in patch) next.printsOnSavedSheet = Boolean(Number(patch.printsOnSavedSheet));
  if ("artworkReferences" in patch) {
    for (const [key2, value] of Object.entries(patch.artworkReferences)) {
      if (value === null) delete next.artworkReferences[key2];
      else next.artworkReferences[key2] = true;
    }
    if (Object.keys(next.artworkReferences).length > 500) {
      throw Object.assign(new Error("This order already has 500 reference files. Restore a reference before adding another."), {
        code: "INVALID_ARTWORK_REFERENCE",
        status: 400
      });
    }
  }
  if (next.readiness.printsOrdered || next.readiness.printsReady) next.printsOnSavedSheet = false;
  if (next.stage === "blanks_cart" || next.stage === "blanks_ordered") {
    next.readiness.blanksOrdered = next.stage === "blanks_ordered";
  }
  if ("attention" in patch) next.attention = normalizeProductionState({ attention: patch.attention }, actor).attention;
  if ("archivedAt" in patch) {
    next.archivedAt = patch.archivedAt ? isoNow() : null;
    next.archivedBy = next.archivedAt ? actor : null;
  }
  next.revision = current.revision + 1;
  next.lastMutationId = mutationId;
  next.updatedAt = isoNow();
  next.updatedBy = actor;
  return next;
}
__name(applyProductionPatch, "applyProductionPatch");
async function setProductionMetafield(env, gid2, state, compareDigest, graphQL = performShopifyGraphQL) {
  const result = await graphQL(env, PRODUCTION_STATE_MUTATION, {
    metafields: [{
      ownerId: gid2,
      namespace: PRODUCTION_METAFIELD_NAMESPACE,
      key: PRODUCTION_METAFIELD_KEY,
      type: "json",
      value: JSON.stringify(state),
      compareDigest: compareDigest === void 0 ? null : compareDigest
    }]
  }, "PrintMOSetProductionState");
  const data2 = requireShopifyData(result, "PrintMOSetProductionState");
  const payload = data2.metafieldsSet;
  const userError = payload?.userErrors?.[0];
  if (userError) {
    const conflict = /digest|stale|compare/i.test(`${userError.code || ""} ${userError.message || ""}`);
    throw Object.assign(new Error(userError.message || "Shopify rejected the production update."), {
      code: conflict ? "VERSION_CONFLICT" : userError.code || "SHOPIFY_MUTATION_ERROR",
      status: conflict ? 409 : 422,
      details: payload.userErrors
    });
  }
  const metafield = payload?.metafields?.[0];
  if (!metafield) throw Object.assign(new Error("Shopify did not return the saved production metafield."), { code: "SHOPIFY_MUTATION_EMPTY", status: 502 });
  return parseProductionMetafield(metafield, state.updatedBy);
}
__name(setProductionMetafield, "setProductionMetafield");
async function ensureCandidateOrder(env, gid2, actor = "system", graphQL = coordinatorGraphQL) {
  const shop = await d1Shop(env);
  let current = await readProductionMetafield(env, gid2, actor, graphQL);
  if (!current.exists) {
    try {
      const saved = await setProductionMetafield(env, gid2, current.state, null, graphQL);
      current = { ...current, ...saved };
    } catch (error) {
      if (error.code !== "VERSION_CONFLICT") throw error;
      current = await readProductionMetafield(env, gid2, actor, graphQL);
    }
  }
  await d1ProjectionUpsert(env, shop.id, gid2, current.state, current.compareDigest, void 0, current.order);
  return current;
}
__name(ensureCandidateOrder, "ensureCandidateOrder");
async function d1AssetsForOrder(env, shopId, gid2) {
  const result = await requireOrderDb(env).prepare(`
      SELECT manifests.id, manifests.filename, manifests.content_type,
             manifests.byte_size, manifests.sha256,
             COALESCE(links.line_item_id, manifests.line_item_id, '') AS line_item_id,
             COALESCE(links.design_ref, manifests.design_ref, '') AS design_ref,
             COALESCE(links.role, manifests.role, '') AS role,
             COALESCE(links.side, manifests.side, '') AS side,
             COALESCE(NULLIF(links.source_key, ''), manifests.source_key, '') AS association_source_key,
             links.placement, links.assignment_status, links.assignment_label, links.origin_draft_gid,
             manifests.created_at
      FROM asset_manifests AS manifests
      LEFT JOIN asset_manifest_links AS links ON links.asset_id = manifests.id
      WHERE manifests.shop_id = ? AND manifests.order_gid = ? AND manifests.state = 'active'
        AND manifests.preview_kind = '' AND COALESCE(links.preview_kind, '') = ''
      ORDER BY manifests.created_at, manifests.id, links.line_item_id, links.role, links.side
    `).bind(shopId, gid2).all();
  return (result.results || []).map((row) => {
    const manualUpload = String(row.association_source_key || "").startsWith("manual-upload:");
    return {
      assetId: row.id,
      name: row.filename,
      contentType: row.content_type,
      byteSize: row.byte_size,
      sha256: row.sha256,
      lineItemId: row.line_item_id || null,
      designRef: row.design_ref || null,
      role: row.role || null,
      side: row.side || null,
      placement: row.placement || null,
      assignmentStatus: row.assignment_status || null,
      assignmentLabel: row.assignment_label || null,
      originDraftId: row.origin_draft_gid || null,
      manualUpload,
      removable: manualUpload
    };
  });
}
__name(d1AssetsForOrder, "d1AssetsForOrder");
async function d1AssetsForOrders(env, shopId, gids) {
  const valid = [...new Set((gids || []).map(canonicalOrderGid).filter(Boolean))];
  const byOrder = new Map(valid.map((gid2) => [gid2, []]));
  for (let index2 = 0; index2 < valid.length; index2 += 50) {
    const chunk = valid.slice(index2, index2 + 50);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await requireOrderDb(env).prepare(`
          SELECT order_gid, id, filename, content_type, byte_size, sha256,
                 line_item_id, design_ref, role, side
          FROM (
            SELECT manifests.order_gid, manifests.id, manifests.filename,
                   manifests.content_type, manifests.byte_size, manifests.sha256,
                   COALESCE(links.line_item_id, manifests.line_item_id, '') AS line_item_id,
                   COALESCE(links.design_ref, manifests.design_ref, '') AS design_ref,
                   COALESCE(links.role, manifests.role, '') AS role,
                   COALESCE(links.side, manifests.side, '') AS side,
                   ROW_NUMBER() OVER (
                     PARTITION BY manifests.order_gid
                     ORDER BY
                       CASE COALESCE(links.role, manifests.role, '') WHEN 'mockup' THEN 0 ELSE 1 END,
                       manifests.created_at, manifests.id, links.line_item_id
                   ) AS asset_rank
            FROM asset_manifests AS manifests
            LEFT JOIN asset_manifest_links AS links ON links.asset_id = manifests.id
            WHERE manifests.shop_id = ? AND manifests.state = 'active'
              AND manifests.preview_kind = '' AND COALESCE(links.preview_kind, '') = ''
              AND manifests.order_gid IN (${placeholders})
          )
          WHERE asset_rank = 1
          ORDER BY order_gid
        `).bind(shopId, ...chunk).all();
    for (const row of result.results || []) {
      const assets = byOrder.get(row.order_gid) || [];
      assets.push({
        assetId: row.id,
        name: row.filename,
        contentType: row.content_type,
        byteSize: row.byte_size,
        sha256: row.sha256,
        lineItemId: row.line_item_id || null,
        designRef: row.design_ref || null,
        role: row.role || null,
        side: row.side || null
      });
      byOrder.set(row.order_gid, assets);
    }
  }
  return byOrder;
}
__name(d1AssetsForOrders, "d1AssetsForOrders");
async function d1MobilePreviewsForOrders(env, shopId, gids) {
  const valid = [...new Set((gids || []).map(canonicalOrderGid).filter(Boolean))];
  const byOrder = /* @__PURE__ */ new Map();
  for (let index2 = 0; index2 < valid.length; index2 += 50) {
    const chunk = valid.slice(index2, index2 + 50);
    const result = await requireOrderDb(env).prepare(`
          SELECT * FROM (
            SELECT manifests.order_gid, manifests.id, manifests.filename, manifests.content_type,
                   manifests.byte_size, manifests.sha256, links.line_item_id, links.design_ref, links.origin_draft_gid,
                   ROW_NUMBER() OVER (PARTITION BY manifests.order_gid
                     ORDER BY manifests.created_at DESC, manifests.id, links.line_item_id) AS preview_rank
            FROM asset_manifests AS manifests
            JOIN asset_manifest_links AS links ON links.asset_id = manifests.id
            WHERE manifests.shop_id = ? AND manifests.state = 'active'
              AND manifests.preview_kind = 'mobile-front' AND links.preview_kind = 'mobile-front'
              AND links.role = 'mockup' AND links.side = 'front' AND links.line_item_id <> ''
              AND links.assignment_status <> 'needs_review'
              AND manifests.order_gid IN (${chunk.map(() => "?").join(", ")})
          ) WHERE preview_rank = 1
        `).bind(shopId, ...chunk).all();
    for (const row of result.results || []) byOrder.set(row.order_gid, {
      assetId: row.id,
      name: row.filename,
      contentType: row.content_type,
      byteSize: row.byte_size,
      sha256: row.sha256,
      lineItemId: row.line_item_id,
      designRef: row.design_ref || null,
      role: "mobile-preview",
      side: "front",
      previewKind: "mobile-front",
      originDraftId: row.origin_draft_gid || null
    });
  }
  return byOrder;
}
__name(d1MobilePreviewsForOrders, "d1MobilePreviewsForOrders");
function mobilePreviewForSummary(preview, summary) {
  if (!preview) return null;
  const line = summary?.commerce?.lineItems?.find((item) => item.id === preview.lineItemId);
  if (!line || !(Number(line.currentQuantity ?? line.quantity) > 0)) return null;
  if (preview.originDraftId) {
    const values = designerAttributeMap(line.customAttributes);
    return (values.get("batch_role") || values.get("group_role") || values.get("_batch_role") || values.get("_group_role")) === "garment" ? preview : null;
  }
  const current = designerAssetCandidates(summary).some((candidate) => candidate.previewKind === "mobile-front" && candidate.lineItemId === preview.lineItemId && candidate.designRef === preview.designRef && candidate.name === preview.name);
  return current ? preview : null;
}
__name(mobilePreviewForSummary, "mobilePreviewForSummary");
function shopifyProjectionActiveValue(state, summary, order = {}) {
  const closedAt = summary?.commerce?.closedAt || order?.closedAt || order?.closed_at || null;
  const cancelledAt = summary?.commerce?.cancelledAt || order?.cancelledAt || order?.cancelled_at || null;
  const fulfillmentStatus = String(
    summary?.commerce?.fulfillmentStatus || order?.displayFulfillmentStatus || order?.fulfillmentStatus || order?.fulfillment_status || ""
  ).toUpperCase();
  return state?.archivedAt || closedAt || cancelledAt || fulfillmentStatus === "FULFILLED" ? 0 : 1;
}
__name(shopifyProjectionActiveValue, "shopifyProjectionActiveValue");
async function d1ProjectionUpsert(env, shopId, gid2, state, compareDigest, summary = void 0, order = {}) {
  const db = requireOrderDb(env);
  const now = isoNow();
  const active = shopifyProjectionActiveValue(state, summary, order);
  await db.prepare(`
      INSERT INTO order_projection (
        shop_id, order_gid, display_name, stage, active, production_revision,
        production_digest, production_json, commerce_json, shopify_updated_at,
        fetched_at, stale_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(shop_id, order_gid) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, order_projection.display_name),
        stage = excluded.stage,
        active = excluded.active,
        production_revision = excluded.production_revision,
        production_digest = excluded.production_digest,
        production_json = excluded.production_json,
        commerce_json = COALESCE(excluded.commerce_json, order_projection.commerce_json),
        shopify_updated_at = COALESCE(excluded.shopify_updated_at, order_projection.shopify_updated_at),
        fetched_at = COALESCE(excluded.fetched_at, order_projection.fetched_at),
        stale_at = CASE WHEN excluded.commerce_json IS NULL THEN order_projection.stale_at ELSE NULL END,
        last_error = CASE WHEN excluded.commerce_json IS NULL THEN order_projection.last_error ELSE NULL END,
        updated_at = excluded.updated_at
    `).bind(
    shopId,
    gid2,
    summary?.displayName || order.name || null,
    state.stage,
    active,
    state.revision,
    compareDigest || null,
    JSON.stringify(state),
    summary === void 0 ? null : JSON.stringify(summary),
    summary?.shopifyUpdatedAt || order.updatedAt || null,
    summary?.sync?.fetchedAt || null,
    order.createdAt || summary?.createdAt || now,
    now
  ).run();
}
__name(d1ProjectionUpsert, "d1ProjectionUpsert");
function d1ProjectionRecord(row) {
  let production = defaultProductionState();
  let summary = null;
  try {
    production = normalizeProductionState(JSON.parse(row.production_json || "{}"));
  } catch (_) {
  }
  try {
    summary = row.commerce_json ? JSON.parse(row.commerce_json) : null;
  } catch (_) {
  }
  if (summary?.sync) {
    const stale = Boolean(row.stale_at) || !summary.sync.freshUntil || Date.parse(summary.sync.freshUntil) <= Date.now();
    summary.sync = { ...summary.sync, stale };
  }
  return {
    kind: "shopify",
    gid: row.order_gid,
    production: productionForClient(row.order_gid, production, row.production_digest),
    summary,
    staleAt: row.stale_at,
    lastError: row.last_error
  };
}
__name(d1ProjectionRecord, "d1ProjectionRecord");
function v1Error(error, allowOrigin, reqAllowHeaders, status = 500, details) {
  const requestId = crypto.randomUUID();
  const code = typeof error === "string" ? error : error?.code || "INTERNAL_ERROR";
  const message = typeof error === "string" ? error : error?.message || "Unexpected error";
  return jsonResponse({ error: { code, message, requestId, ...details ? { details } : {} } }, allowOrigin, reqAllowHeaders, status);
}
__name(v1Error, "v1Error");
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(ms, 3e4))));
}
__name(sleepMs, "sleepMs");
function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64UrlEncode, "base64UrlEncode");
function decodeJsonBase64Url(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}
__name(decodeJsonBase64Url, "decodeJsonBase64Url");
function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
__name(bytesToHex, "bytesToHex");
async function hmacBase64Url(payload, secret) {
  const key2 = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key2, new TextEncoder().encode(payload))));
}
__name(hmacBase64Url, "hmacBase64Url");
async function encodeSignedCursor(value, env) {
  const payload = base64UrlEncode(JSON.stringify(value));
  return `${payload}.${await hmacBase64Url(payload, env.SHOPIFY_API_SECRET)}`;
}
__name(encodeSignedCursor, "encodeSignedCursor");
async function decodeSignedCursor(cursor, expectedFilter, env) {
  if (!cursor) return 0;
  const [payload, signature] = String(cursor).split(".");
  if (!payload || !signature || signature !== await hmacBase64Url(payload, env.SHOPIFY_API_SECRET)) {
    throw Object.assign(new Error("Invalid board cursor"), { code: "INVALID_CURSOR", status: 400 });
  }
  const value = decodeJsonBase64Url(payload);
  if (value.v !== 1 || value.filter !== expectedFilter || !Number.isInteger(value.offset) || value.offset < 0) {
    throw Object.assign(new Error("Cursor does not match this board query"), { code: "INVALID_CURSOR", status: 400 });
  }
  return value.offset;
}
__name(decodeSignedCursor, "decodeSignedCursor");
function numericIdFromGid(value) {
  const match = /(?:gid:\/\/shopify\/Order\/)?(\d+)$/.exec(String(value || ""));
  return match ? match[1] : null;
}
__name(numericIdFromGid, "numericIdFromGid");
function canonicalOrderGid(value) {
  const id2 = numericIdFromGid(value);
  return id2 ? `gid://shopify/Order/${id2}` : null;
}
__name(canonicalOrderGid, "canonicalOrderGid");
function shopDomain(env) {
  const shop = String(env.SHOPIFY_SHOP_DOMAIN || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error("SHOPIFY_SHOP_DOMAIN is invalid");
  return shop;
}
__name(shopDomain, "shopDomain");
async function getShopifyAccessToken(env) {
  const shop = shopDomain(env);
  const cached = shopifyAccessTokenCache.get(shop);
  if (cached && cached.expiresAt > Date.now() + 6e4) return cached.token;
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) throw new Error("Shopify client credentials are not configured");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.SHOPIFY_API_KEY,
    client_secret: env.SHOPIFY_API_SECRET
  });
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    const message = json.error_description || json.error || `Shopify token exchange failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  const expiresIn = Number(json.expires_in || 86399);
  shopifyAccessTokenCache.set(shop, { token: json.access_token, expiresAt: Date.now() + expiresIn * 1e3 });
  return json.access_token;
}
__name(getShopifyAccessToken, "getShopifyAccessToken");
async function performShopifyGraphQL(env, query, variables, operationName) {
  const token = await getShopifyAccessToken(env);
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token
  };
  if (env.SHOPIFY_COST_DEBUG === "1") headers["Shopify-GraphQL-Cost-Debug"] = "1";
  const response = await fetch(`https://${shopDomain(env)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables: variables || {}, ...operationName ? { operationName } : {} })
  });
  const apiVersion = response.headers.get("X-Shopify-API-Version");
  const json = await response.json().catch(() => ({}));
  return {
    httpStatus: response.status,
    ok: response.ok,
    apiVersion,
    data: json.data || null,
    errors: Array.isArray(json.errors) ? json.errors : [],
    extensions: json.extensions || {}
  };
}
__name(performShopifyGraphQL, "performShopifyGraphQL");
function isThrottled(result) {
  return result.httpStatus === 429 || result.errors.some((error) => error?.extensions?.code === "THROTTLED");
}
__name(isThrottled, "isThrottled");
function requireShopifyData(result, operationName) {
  if (result?.ok !== false && result?.data) return result.data;
  const first = result?.errors?.[0];
  const error = new Error(first?.message || `${operationName} failed with Shopify HTTP ${result?.httpStatus || "unknown"}`);
  error.code = first?.extensions?.code || "SHOPIFY_API_ERROR";
  error.status = result?.httpStatus === 404 ? 404 : 502;
  throw error;
}
__name(requireShopifyData, "requireShopifyData");
async function shopifyGraphQLWithRetry(env, query, variables, operationName) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await performShopifyGraphQL(env, query, variables, operationName);
    if (!isThrottled(last)) return last;
    const throttle = last.extensions?.cost?.throttleStatus || {};
    const requested = Number(last.extensions?.cost?.requestedQueryCost || 50);
    const available = Number(throttle.currentlyAvailable || 0);
    const rate = Math.max(Number(throttle.restoreRate || 50), 1);
    await sleepMs(Math.max(requested - available, 1) / rate * 1e3 + Math.random() * 250);
  }
  return last;
}
__name(shopifyGraphQLWithRetry, "shopifyGraphQLWithRetry");
async function coordinatorGraphQL(env, query, variables, operationName) {
  if (!env.ORDER_SYNC_COORDINATOR) return shopifyGraphQLWithRetry(env, query, variables, operationName);
  const id2 = env.ORDER_SYNC_COORDINATOR.idFromName(shopDomain(env));
  const response = await env.ORDER_SYNC_COORDINATOR.get(id2).fetch(new Request("https://internal/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables, operationName })
  }));
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error || "Shopify coordinator failed"), { status: response.status });
  return body;
}
__name(coordinatorGraphQL, "coordinatorGraphQL");
function moneyValue(moneySet, fallbackCurrency) {
  const money2 = moneySet?.shopMoney;
  return money2 ? { amount: String(money2.amount), currencyCode: money2.currencyCode || fallbackCurrency } : null;
}
__name(moneyValue, "moneyValue");
function normalizeLineItem(item) {
  return {
    id: item.id,
    sku: item.sku || null,
    title: item.title || "",
    variantTitle: item.variantTitle || "",
    quantity: Number(item.quantity || 0),
    currentQuantity: Number(item.currentQuantity || 0),
    unitPrice: String(item.originalUnitPriceSet?.shopMoney?.amount || "0"),
    ...item.customAttributes ? { customAttributes: item.customAttributes } : {},
    ...item.discountAllocations ? { discountAllocations: item.discountAllocations } : {}
  };
}
__name(normalizeLineItem, "normalizeLineItem");
async function completeLineItems(env, orderId, connection, graphQL = coordinatorGraphQL) {
  const items = (connection?.nodes || []).map(normalizeLineItem);
  let pageInfo = connection?.pageInfo || { hasNextPage: false, endCursor: null };
  while (pageInfo.hasNextPage) {
    const result = await graphQL(env, ORDER_LINE_ITEMS_QUERY, { id: orderId, after: pageInfo.endCursor }, "PrintMOOrderLineItems");
    const next = result.data?.order?.lineItems;
    if (!next) return { items, complete: false, errors: result.errors || [] };
    items.push(...(next.nodes || []).map(normalizeLineItem));
    pageInfo = next.pageInfo || { hasNextPage: false, endCursor: null };
  }
  return { items, complete: true, errors: [] };
}
__name(completeLineItems, "completeLineItems");
function validPrintItemId(id2) {
  return typeof id2 === "string" && id2.length > 0 && id2.length <= 160 && !["__proto__", "prototype", "constructor"].includes(id2);
}
__name(validPrintItemId, "validPrintItemId");
var PRINT_PLACEMENTS = /* @__PURE__ */ new Set([
  "breast",
  "chest",
  "front",
  "full-front",
  "back",
  "back-tag",
  "half-back",
  "full-back",
  "sleeve",
  "full-sleeve",
  "half-sleeve",
  "left-sleeve",
  "right-sleeve",
  "hood",
  "hat-side"
]);
function normalizePrintPlacements(value, strict = false) {
  const invalid2 = /* @__PURE__ */ __name(() => {
    throw Object.assign(new Error("Choose a valid print location and the garments it applies to."), {
      code: "INVALID_PRINT_PLACEMENTS",
      status: 400
    });
  }, "invalid");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (strict) invalid2();
    return {};
  }
  const result = {};
  if (Object.keys(value).length > 250) {
    if (strict) invalid2();
    return {};
  }
  let references = 0;
  for (const [id2, entry] of Object.entries(value)) {
    if (entry === null && strict && validPrintItemId(id2)) continue;
    if (!validPrintItemId(id2) || !entry || typeof entry !== "object" || Array.isArray(entry) || !PRINT_PLACEMENTS.has(entry.placement) || !(entry.printItemId === null || validPrintItemId(entry.printItemId)) || !Array.isArray(entry.garmentLineIds) || !entry.garmentLineIds.length || entry.garmentLineIds.length > 100 || entry.garmentLineIds.some((id3) => !validPrintItemId(id3))) {
      if (strict) invalid2();
      continue;
    }
    references += entry.garmentLineIds.length;
    if (references > 2e3) {
      if (strict) invalid2();
      return {};
    }
    result[id2] = {
      printItemId: entry.printItemId,
      placement: entry.placement,
      garmentLineIds: [...new Set(entry.garmentLineIds)]
    };
  }
  return result;
}
__name(normalizePrintPlacements, "normalizePrintPlacements");
function garmentCountFromLineItems(items = [], eligibility = {}) {
  return items.reduce((total, item) => {
    const included = Object.hasOwn(eligibility, item?.id) ? eligibility[item.id] : !PRINT_TITLES.has(item?.title) && !isSupplierService(item) && Boolean(safeText(item?.sku, 120));
    if (!included) return total;
    const quantity = Number(item?.currentQuantity ?? item?.quantity ?? 0);
    return total + (Number.isInteger(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
}
__name(garmentCountFromLineItems, "garmentCountFromLineItems");
async function productionGarmentCount(env, productionRead, graphQL = coordinatorGraphQL) {
  if (!productionRead?.order?.lineItems) {
    throw Object.assign(new Error("Shopify did not return order line items for garment counting."), {
      code: "GARMENT_COUNT_UNAVAILABLE",
      status: 502
    });
  }
  const lines = await completeLineItems(
    env,
    productionRead.gid,
    productionRead.order.lineItems,
    graphQL
  );
  if (!lines.complete) {
    throw Object.assign(new Error("Shopify line-item pagination did not complete."), {
      code: "GARMENT_COUNT_INCOMPLETE",
      status: 502,
      details: lines.errors
    });
  }
  productionRead.countLineItems = lines.items;
  return garmentCountFromLineItems(lines.items, productionRead.state?.printEligibility);
}
__name(productionGarmentCount, "productionGarmentCount");
function validatePrintablePatch(items, current, patch, next) {
  if ("printPlacements" in patch) {
    const ids = new Set(items.map((item) => item.id));
    for (const entry of Object.values(patch.printPlacements).filter(Boolean)) {
      if (entry.printItemId && !ids.has(entry.printItemId) || entry.garmentLineIds.some((id2) => !ids.has(id2) || id2 === entry.printItemId)) {
        throw Object.assign(new Error("An assigned item is no longer in this order. Refresh and review the print placements."), {
          code: "INVALID_PRINT_PLACEMENTS",
          status: 400
        });
      }
    }
    normalizePrintPlacements(next.printPlacements, true);
  }
  if ("printedCount" in patch && next.printedCount > current.printedCount && !next.readiness.printsReady) {
    throw Object.assign(new Error("Prints must be marked ready before recording printed pieces."), {
      code: "PRINTS_NOT_READY",
      status: 409
    });
  }
  if ("printEligibility" in patch) {
    const ids = new Set(items.map((item) => item.id));
    if (Object.entries(patch.printEligibility).some(([id2, value]) => value !== null && !ids.has(id2))) {
      throw Object.assign(new Error("An item is no longer in this order. Refresh and try again."), {
        code: "INVALID_PRINT_ELIGIBILITY",
        status: 400
      });
    }
    if (Object.keys(next.printEligibility).length > 1e3) {
      throw Object.assign(new Error("Too many printable item overrides."), { code: "INVALID_PRINT_ELIGIBILITY", status: 400 });
    }
  }
  const total = garmentCountFromLineItems(items, next.printEligibility);
  if (("printedCount" in patch || "printEligibility" in patch) && next.printedCount > total) {
    throw Object.assign(new Error(`Printed count cannot exceed ${total} printable pieces. Adjust the printed count before excluding items.`), {
      code: "INVALID_PRINTED_COUNT",
      status: 400
    });
  }
  if (("printedCount" in patch || "printEligibility" in patch) && ["print", "completed"].includes(next.stage)) {
    next.stage = total > 0 && next.printedCount === total ? "completed" : "print";
  }
  return total;
}
__name(validatePrintablePatch, "validatePrintablePatch");
function selectOperationalCustomerName(node) {
  if (!node) return null;
  const shipping = String(node.shippingAddress?.name || "").trim();
  if (shipping) return shipping;
  const billing = String(node.billingAddress?.name || "").trim();
  if (billing) return billing;
  const first = String(node.customer?.firstName || "").trim();
  const last = String(node.customer?.lastName || "").trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return null;
}
__name(selectOperationalCustomerName, "selectOperationalCustomerName");
function summarizeDeliveryMethods(connection, errors = [], fetchedAt = isoNow()) {
  const kinds = {
    PICK_UP: "pickup",
    SHIPPING: "shipping",
    LOCAL: "local-delivery",
    PICKUP_POINT: "pickup-point",
    RETAIL: "in-store",
    NONE: "none"
  };
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes.filter((node) => node?.status !== "CANCELLED") : [];
  const types = [...new Set(nodes.map((node) => node?.deliveryMethod?.methodType).filter((type) => typeof type === "string"))].sort();
  const unavailable = errors.some((error) => !Array.isArray(error?.path) || error.path.some((part) => part === "fulfillmentOrders" || part === "deliveryMethod"));
  const reason = unavailable ? "unavailable" : !connection ? "not-returned" : connection.pageInfo?.hasNextPage !== false ? "incomplete" : !nodes.length ? "not-assigned" : nodes.some((node) => !kinds[node?.deliveryMethod?.methodType]) ? "unknown-method" : null;
  const physicalTypes = types.filter((type) => type !== "NONE");
  const effectiveTypes = physicalTypes.length ? physicalTypes : types;
  return {
    kind: reason ? "unknown" : effectiveTypes.length > 1 ? "mixed" : kinds[effectiveTypes[0]],
    types,
    complete: !reason,
    source: "shopify-fulfillment-orders",
    fetchedAt,
    ...reason ? { reason } : {}
  };
}
__name(summarizeDeliveryMethods, "summarizeDeliveryMethods");
async function normalizeShopifySummary(env, node, resultErrors = [], graphQL = coordinatorGraphQL) {
  const now = /* @__PURE__ */ new Date();
  const lines = await completeLineItems(env, node.id, node.lineItems, graphQL);
  const currency = node.currencyCode || node.currentTotalPriceSet?.shopMoney?.currencyCode || null;
  const errors = [...resultErrors, ...lines.errors].map((error) => ({ message: error.message, code: error?.extensions?.code || null }));
  return {
    id: node.id,
    displayName: node.name,
    createdAt: node.createdAt,
    shopifyUpdatedAt: node.updatedAt,
    customer: {
      displayName: selectOperationalCustomerName(node)
    },
    commerce: {
      financialStatus: node.displayFinancialStatus || null,
      fulfillmentStatus: node.displayFulfillmentStatus || null,
      cancelledAt: node.cancelledAt || null,
      closedAt: node.closedAt || null,
      currencyCode: currency,
      subtotal: moneyValue(node.currentSubtotalPriceSet, currency)?.amount || null,
      discount: moneyValue(node.currentTotalDiscountsSet, currency)?.amount || null,
      total: moneyValue(node.currentTotalPriceSet, currency)?.amount || null,
      currentLineItemQuantity: Number(node.currentSubtotalLineItemsQuantity || 0),
      deliveryMethod: summarizeDeliveryMethods(node.fulfillmentOrders, resultErrors, now.toISOString()),
      lineItemsComplete: lines.complete,
      lineItems: lines.items
    },
    sync: {
      fetchedAt: now.toISOString(),
      freshUntil: new Date(now.getTime() + 6e4).toISOString(),
      hardExpiresAt: new Date(now.getTime() + 864e5).toISOString(),
      stale: false,
      partial: errors.length > 0 || !lines.complete,
      cacheRevision: now.getTime(),
      errors
    }
  };
}
__name(normalizeShopifySummary, "normalizeShopifySummary");
var DESIGNER_REFERENCE_KEYS = /* @__PURE__ */ new Set(["_designref", "_design_ref"]);
var DESIGNER_PREVIEW_KEYS = /* @__PURE__ */ new Set(["design_preview_url", "design-preview-url"]);
var DESIGNER_ASSET_MAX_BYTES = 50 * 1024 * 1024;
var DESIGNER_ASSET_BACKFILL_CHECKPOINT = "designer-studio-assets-v1";
var MANUAL_DESIGN_CONTENT_TYPES = /* @__PURE__ */ new Map([
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);
function designerAttributeMap(attributes) {
  const values = /* @__PURE__ */ new Map();
  for (const attribute2 of Array.isArray(attributes) ? attributes : []) {
    const key2 = String(attribute2?.key || "").trim().toLowerCase();
    if (key2 && !values.has(key2)) values.set(key2, String(attribute2?.value || "").trim());
  }
  return values;
}
__name(designerAttributeMap, "designerAttributeMap");
function designerSideFromName(name) {
  const value = String(name || "").toLowerCase();
  if (/(^|[_./-])front([_.-]|$)/.test(value)) return "front";
  if (/(^|[_./-])back([_.-]|$)/.test(value)) return "back";
  return null;
}
__name(designerSideFromName, "designerSideFromName");
function designerAssetCandidates(summary) {
  const orderNumber = /^#?(\d+)$/.exec(String(summary?.displayName || "").trim())?.[1] || null;
  if (!orderNumber) return [];
  const candidates = [];
  for (const item of summary?.commerce?.lineItems || []) {
    const values = designerAttributeMap(item.customAttributes);
    const designRef = [...DESIGNER_REFERENCE_KEYS].map((key2) => values.get(key2)).find(Boolean);
    if (!designRef || !/^[A-Za-z0-9_-]{8,160}$/.test(designRef)) continue;
    const groupRole = String(values.get("batch_role") || values.get("group_role") || values.get("_batch_role") || values.get("_group_role") || "").toLowerCase();
    const sources = [{ url: [...DESIGNER_PREVIEW_KEYS].map((key2) => values.get(key2)).find(Boolean), previewKind: "" }];
    if (groupRole === "garment" && item.id) sources.push({ url: values.get("_designer_front_preview_url"), previewKind: "mobile-front" });
    for (const { url, previewKind } of sources) {
      if (!url) continue;
      let parsed2;
      try {
        parsed2 = new URL(url);
      } catch (_) {
        continue;
      }
      if (parsed2.protocol !== "https:") continue;
      const match = parsed2.pathname.match(/^\/previews\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/(.+)$/);
      if (!match) continue;
      let pathDesignRef, rest;
      try {
        pathDesignRef = decodeURIComponent(match[2]);
        rest = match[3].split("/").map((segment) => decodeURIComponent(segment)).join("/");
      } catch (_) {
        continue;
      }
      if (pathDesignRef !== designRef || !rest || rest.split("/").some((segment) => !segment || segment === "." || segment === "..")) continue;
      candidates.push({
        lineItemId: item.id,
        designRef,
        previewKey: `previews/${match[1]}/${designRef}/${rest}`,
        orderNumber,
        rest,
        name: safeAssetName(rest.split("/").pop()),
        role: previewKind || groupRole === "garment" ? "mockup" : groupRole === "print" ? "design" : item.sku ? "mockup" : "design",
        side: previewKind ? "front" : designerSideFromName(rest),
        ...previewKind ? { previewKind } : {}
      });
    }
  }
  return candidates;
}
__name(designerAssetCandidates, "designerAssetCandidates");
async function resolveDesignerSourceKey(env, candidate) {
  if (!env.PREVIEWS) throw new Error("Designer Studio preview storage is not configured.");
  if (await env.PREVIEWS.head(candidate.previewKey)) return candidate.previewKey;
  const promotedKey = `orders/${candidate.orderNumber}/${candidate.designRef}/${candidate.rest}`;
  if (await env.PREVIEWS.head(promotedKey)) return promotedKey;
  const prefix2 = `orders/${candidate.orderNumber}_`;
  const suffix = `/${candidate.designRef}/${candidate.rest}`;
  let cursor;
  const matches = [];
  for (let page = 0; page < 5; page += 1) {
    const result = await env.PREVIEWS.list({ prefix: prefix2, cursor, limit: 1e3 });
    for (const object2 of result.objects || []) {
      if (String(object2.key || "").endsWith(suffix)) matches.push(object2.key);
    }
    if (!result.truncated || !result.cursor) break;
    cursor = result.cursor;
  }
  if (matches.length > 1) throw new Error(`Designer Studio asset is ambiguous for ${candidate.designRef}/${candidate.rest}.`);
  return matches[0] || null;
}
__name(resolveDesignerSourceKey, "resolveDesignerSourceKey");
async function copyDesignerAsset(env, shopId, gid2, candidate) {
  const db = requireOrderDb(env);
  const linkValues = {
    lineItemId: String(candidate.lineItemId || ""),
    designRef: String(candidate.designRef || ""),
    role: String(candidate.role || ""),
    side: String(candidate.side || ""),
    previewKind: String(candidate.previewKind || ""),
    sourceKey: String(candidate.previewKey || "")
  };
  const existingLink = await db.prepare(`
      SELECT manifests.id
      FROM asset_manifest_links AS links
      JOIN asset_manifests AS manifests ON manifests.id = links.asset_id
      WHERE manifests.shop_id = ? AND manifests.order_gid = ? AND manifests.state = 'active'
        AND links.line_item_id = ? AND links.design_ref = ? AND links.role = ?
        AND links.side = ? AND links.source_key = ?
        AND links.preview_kind = ? AND manifests.preview_kind = ?
      LIMIT 1
    `).bind(
    shopId,
    gid2,
    linkValues.lineItemId,
    linkValues.designRef,
    linkValues.role,
    linkValues.side,
    linkValues.sourceKey,
    linkValues.previewKind,
    linkValues.previewKind
  ).first();
  if (existingLink) return { state: "existing", assetId: existingLink.id };
  const sourceKey = await resolveDesignerSourceKey(env, candidate);
  if (!sourceKey) throw new Error(`Designer Studio asset was not found for ${candidate.designRef}/${candidate.rest}.`);
  const source = await env.PREVIEWS.get(sourceKey);
  if (!source) throw new Error(`Designer Studio source disappeared during import: ${sourceKey}.`);
  if (!candidate.previewKind && source.customMetadata?.role === "mobile-preview") throw new Error("Mobile derivatives cannot replace canonical artwork.");
  if (candidate.previewKind && (candidate.previewKind !== "mobile-front" || candidate.side !== "front" || source.customMetadata?.role !== "mobile-preview" || source.customMetadata?.side !== "front" || source.customMetadata?.designref !== candidate.designRef)) {
    throw new Error("Mobile front preview metadata is invalid.");
  }
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > DESIGNER_ASSET_MAX_BYTES) {
    throw new Error(`Designer Studio asset size is invalid for ${candidate.name}.`);
  }
  const sha256 = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
  const sourceHeaders = new Headers();
  if (typeof source.writeHttpMetadata === "function") source.writeHttpMetadata(sourceHeaders);
  const contentType = sourceHeaders.get("Content-Type") || guessContentTypeFromKey(candidate.name);
  if (candidate.previewKind && contentType !== "image/png") throw new Error("Mobile front previews must be PNG.");
  const existingBlob = await db.prepare(`
      SELECT id
      FROM asset_manifests
      WHERE shop_id = ? AND order_gid = ? AND state = 'active'
        AND sha256 = ? AND byte_size = ? AND content_type = ?
        AND preview_kind = ?
      ORDER BY created_at, id
      LIMIT 1
    `).bind(shopId, gid2, sha256, bytes.byteLength, contentType, linkValues.previewKind).first();
  const now = isoNow();
  if (existingBlob) {
    await insertAssetManifestLink(db, existingBlob.id, linkValues, now);
    return { state: "existing", assetId: existingBlob.id };
  }
  const assetId2 = await stableAssetId(`${gid2}:sha256:${sha256}:${bytes.byteLength}:${contentType}${linkValues.previewKind ? `:${linkValues.previewKind}` : ""}`);
  const objectKey = `orders/${numericIdFromGid(gid2)}/assets/${assetId2}/${candidate.name}`;
  if (!env.R2_BUCKET) throw new Error("Private artwork storage is not configured.");
  await env.R2_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { sha256, source: "designer-studio" }
  });
  const stored = await env.R2_BUCKET.get(objectKey);
  if (!stored) throw new Error(`Private R2 verification could not read ${candidate.name}.`);
  const storedBytes = new Uint8Array(await stored.arrayBuffer());
  const storedDigest = bytesToHex(await crypto.subtle.digest("SHA-256", storedBytes));
  if (storedDigest !== sha256) throw new Error(`Private R2 checksum verification failed for ${candidate.name}.`);
  await db.prepare(`
      INSERT INTO asset_manifests (
        id, shop_id, order_gid, object_key, filename, content_type, byte_size,
        sha256, state, source_key, created_by, created_at, updated_at,
        line_item_id, design_ref, role, side, preview_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'designer-studio-sync', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        object_key = excluded.object_key,
        filename = excluded.filename,
        content_type = excluded.content_type,
        byte_size = excluded.byte_size,
        sha256 = excluded.sha256,
        state = 'active',
        source_key = excluded.source_key,
        line_item_id = excluded.line_item_id,
        design_ref = excluded.design_ref,
        role = excluded.role,
        side = excluded.side,
        preview_kind = excluded.preview_kind,
        deleted_at = NULL,
        updated_at = excluded.updated_at
    `).bind(
    assetId2,
    shopId,
    gid2,
    objectKey,
    candidate.name,
    contentType,
    bytes.byteLength,
    sha256,
    sourceKey,
    now,
    now,
    candidate.lineItemId,
    candidate.designRef,
    candidate.role,
    candidate.side,
    linkValues.previewKind
  ).run();
  await insertAssetManifestLink(db, assetId2, linkValues, now);
  return { state: "imported", assetId: assetId2 };
}
__name(copyDesignerAsset, "copyDesignerAsset");
async function insertAssetManifestLink(db, assetId2, values, createdAt = isoNow()) {
  await db.prepare(`
      INSERT OR IGNORE INTO asset_manifest_links (
        asset_id, line_item_id, design_ref, role, side, source_key, created_at, preview_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
    assetId2,
    String(values?.lineItemId || ""),
    String(values?.designRef || ""),
    String(values?.role || ""),
    String(values?.side || ""),
    String(values?.sourceKey || ""),
    createdAt,
    String(values?.previewKind || "")
  ).run();
}
__name(insertAssetManifestLink, "insertAssetManifestLink");
function manualDesignUploadMetadata(file, placement) {
  if (!isFileLike(file)) {
    throw Object.assign(new Error("Choose a design file to upload."), {
      code: "DESIGN_FILE_REQUIRED",
      status: 400
    });
  }
  const name = safeAssetName(file.name);
  const extension = /\.[A-Za-z0-9]+$/.exec(name)?.[0]?.toLowerCase() || "";
  const expectedType = MANUAL_DESIGN_CONTENT_TYPES.get(extension);
  const declaredType = String(file.type || "").trim().toLowerCase();
  if (!expectedType || declaredType && declaredType !== expectedType) {
    throw Object.assign(new Error("Design files must be SVG, PNG, JPG, or WebP."), {
      code: "UNSUPPORTED_DESIGN_FILE",
      status: 415
    });
  }
  const byteSize = Number(file.size);
  if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > DESIGNER_ASSET_MAX_BYTES) {
    throw Object.assign(new Error("Design files must be between 1 byte and 50 MB."), {
      code: "INVALID_DESIGN_FILE_SIZE",
      status: 413
    });
  }
  const normalizedPlacement = String(placement || "").trim().toLowerCase();
  if (!["front", "back", "extra", "extras"].includes(normalizedPlacement)) {
    throw Object.assign(new Error("Choose Front, Back, or Extras for this design."), {
      code: "INVALID_DESIGN_PLACEMENT",
      status: 400
    });
  }
  return {
    name,
    contentType: expectedType,
    byteSize,
    side: normalizedPlacement === "front" || normalizedPlacement === "back" ? normalizedPlacement : ""
  };
}
__name(manualDesignUploadMetadata, "manualDesignUploadMetadata");
async function handleV1DesignAssetUpload(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const orderIdentity = orderIdentityFromV1Path(new URL(request.url).pathname);
    if (!orderIdentity) {
      throw Object.assign(new Error("Order ID is invalid."), { code: "INVALID_ORDER_ID", status: 400 });
    }
    if (orderIdentity.provider !== "shopify") {
      throw Object.assign(new Error("Manual design uploads currently require a Shopify order."), {
        code: "UNSUPPORTED_ORDER_PROVIDER",
        status: 409
      });
    }
    if (!env.R2_BUCKET) {
      throw Object.assign(new Error("Private artwork storage is not configured."), {
        code: "R2_NOT_CONFIGURED",
        status: 503
      });
    }
    const form = await request.formData();
    const file = form.get("file");
    const metadata2 = manualDesignUploadMetadata(file, form.get("side") || form.get("placement"));
    const actor = `${identity?.kind || "unknown"}:${identity?.subject || "unknown"}`;
    await readProductionMetafield(env, orderIdentity.id, actor);
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== metadata2.byteSize) {
      throw Object.assign(new Error("The uploaded design changed while it was being read."), {
        code: "DESIGN_FILE_SIZE_MISMATCH",
        status: 400
      });
    }
    const sha256 = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
    const existingBlob = await db.prepare(`
          SELECT id
          FROM asset_manifests
          WHERE shop_id = ? AND order_gid = ? AND state = 'active'
            AND sha256 = ? AND byte_size = ? AND content_type = ?
            AND preview_kind = ''
          ORDER BY created_at, id
          LIMIT 1
        `).bind(shop.id, orderIdentity.id, sha256, bytes.byteLength, metadata2.contentType).first();
    const assetId2 = existingBlob?.id || await stableAssetId(
      `${orderIdentity.id}:sha256:${sha256}:${bytes.byteLength}:${metadata2.contentType}`
    );
    const sourceKey = `manual-upload:${assetId2}`;
    const now = isoNow();
    if (!existingBlob) {
      const objectKey = `orders/${numericIdFromGid(orderIdentity.id)}/assets/${assetId2}/${metadata2.name}`;
      await env.R2_BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType: metadata2.contentType },
        customMetadata: { sha256, source: "manual-upload" }
      });
      const stored = await env.R2_BUCKET.get(objectKey);
      if (!stored) throw new Error(`Private R2 verification could not read ${metadata2.name}.`);
      const storedBytes = new Uint8Array(await stored.arrayBuffer());
      const storedDigest = bytesToHex(await crypto.subtle.digest("SHA-256", storedBytes));
      if (storedDigest !== sha256) {
        throw new Error(`Private R2 checksum verification failed for ${metadata2.name}.`);
      }
      await db.prepare(`
              INSERT INTO asset_manifests (
                id, shop_id, order_gid, object_key, filename, content_type, byte_size,
                sha256, state, source_key, created_by, created_at, updated_at,
                line_item_id, design_ref, role, side
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, '', '', 'design', ?)
              ON CONFLICT(id) DO UPDATE SET
                object_key = excluded.object_key,
                filename = excluded.filename,
                content_type = excluded.content_type,
                byte_size = excluded.byte_size,
                sha256 = excluded.sha256,
                state = 'active',
                source_key = excluded.source_key,
                created_by = excluded.created_by,
                role = 'design',
                side = excluded.side,
                deleted_at = NULL,
                updated_at = excluded.updated_at
            `).bind(
        assetId2,
        shop.id,
        orderIdentity.id,
        objectKey,
        metadata2.name,
        metadata2.contentType,
        bytes.byteLength,
        sha256,
        sourceKey,
        actor,
        now,
        now,
        metadata2.side || null
      ).run();
    }
    await insertAssetManifestLink(db, assetId2, {
      role: "design",
      side: metadata2.side,
      sourceKey
    }, now);
    const assets = await d1AssetsForOrder(env, shop.id, orderIdentity.id);
    return jsonResponse({
      ok: true,
      orderId: orderIdentity.id,
      assetId: assetId2,
      placement: metadata2.side || "extra",
      assets
    }, allowOrigin, reqAllowHeaders, 201);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1DesignAssetUpload, "handleV1DesignAssetUpload");
async function handleV1ManualAssetDelete(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const url = new URL(request.url);
    const assetId2 = assetIdFromPath(url.pathname);
    const placement = String(url.searchParams.get("side") || "").trim().toLowerCase();
    if (!assetId2 || !["front", "back", "extra", "extras"].includes(placement)) {
      throw Object.assign(new Error("Asset ID and placement are required."), {
        code: "INVALID_ASSET_DELETE",
        status: 400
      });
    }
    const side = placement === "front" || placement === "back" ? placement : "";
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const manualLink = await db.prepare(`
          SELECT manifests.id, manifests.order_gid
          FROM asset_manifest_links AS links
          JOIN asset_manifests AS manifests ON manifests.id = links.asset_id
          WHERE manifests.id = ? AND manifests.shop_id = ? AND manifests.state = 'active'
            AND links.line_item_id = '' AND links.design_ref = ''
            AND links.role = 'design' AND links.side = ?
            AND links.source_key LIKE 'manual-upload:%'
          LIMIT 1
        `).bind(assetId2, shop.id, side).first();
    if (!manualLink) {
      throw Object.assign(new Error("This design is not a removable manual upload."), {
        code: "MANUAL_ASSET_NOT_FOUND",
        status: 404
      });
    }
    await db.prepare(`
          DELETE FROM asset_manifest_links
          WHERE asset_id = ? AND line_item_id = '' AND design_ref = ''
            AND role = 'design' AND side = ? AND source_key LIKE 'manual-upload:%'
        `).bind(assetId2, side).run();
    const remaining = await db.prepare("SELECT COUNT(*) AS count FROM asset_manifest_links WHERE asset_id = ?").bind(assetId2).first();
    if (Number(remaining?.count || 0) === 0) {
      const now = isoNow();
      await db.prepare(`
              UPDATE asset_manifests
              SET state = 'deleted', deleted_at = ?, updated_at = ?
              WHERE id = ? AND shop_id = ?
            `).bind(now, now, assetId2, shop.id).run();
    }
    const assets = await d1AssetsForOrder(env, shop.id, manualLink.order_gid);
    return jsonResponse({ ok: true, assetId: assetId2, assets }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1ManualAssetDelete, "handleV1ManualAssetDelete");
async function syncDesignerStudioAssetsForSummary(env, shopId, summary) {
  const report = { candidates: 0, imported: 0, existing: 0, errors: [] };
  const candidates = designerAssetCandidates(summary);
  report.candidates = candidates.length;
  for (const candidate of candidates) {
    try {
      const result = await copyDesignerAsset(env, shopId, summary.id, candidate);
      report[result.state] += 1;
    } catch (error) {
      if (candidate.previewKind) continue;
      report.errors.push({
        code: "DESIGNER_ASSET_SYNC_FAILED",
        message: error.message,
        lineItemId: candidate.lineItemId,
        designRef: candidate.designRef
      });
    }
  }
  return report;
}
__name(syncDesignerStudioAssetsForSummary, "syncDesignerStudioAssetsForSummary");
async function storeSummaries(env, summaries) {
  if (!summaries.length) return;
  const shop = await d1Shop(env);
  const db = requireOrderDb(env);
  for (const summary of summaries) {
    const row = await db.prepare(`
          SELECT production_json, production_digest
          FROM order_projection
          WHERE shop_id = ? AND order_gid = ?
        `).bind(shop.id, summary.id).first();
    if (!row) continue;
    let state;
    try {
      state = normalizeProductionState(JSON.parse(row.production_json));
    } catch (_) {
      state = defaultProductionState();
    }
    await d1ProjectionUpsert(env, shop.id, summary.id, state, row.production_digest, summary);
  }
}
__name(storeSummaries, "storeSummaries");
async function refreshSummaries(env, gids, graphQL = coordinatorGraphQL) {
  const valid = [...new Set(gids.map(canonicalOrderGid).filter(Boolean))];
  const summaries = [];
  for (let index2 = 0; index2 < valid.length; index2 += 20) {
    const chunk = valid.slice(index2, index2 + 20);
    const result = await graphQL(env, ORDER_SUMMARIES_QUERY, { ids: chunk }, "PrintMOOrderSummaries");
    const data2 = requireShopifyData(result, "PrintMOOrderSummaries");
    for (const [nodeIndex, node] of (data2.nodes || []).entries()) {
      if (node?.id) {
        const nodeErrors = (result.errors || []).filter((error) => {
          const path = Array.isArray(error?.path) ? error.path : null;
          if (!path || path[0] !== "nodes" || !Number.isInteger(path[1])) return true;
          return path[1] === nodeIndex;
        });
        summaries.push(await normalizeShopifySummary(env, node, nodeErrors, graphQL));
      }
    }
  }
  const shop = await d1Shop(env);
  const projected = /* @__PURE__ */ new Set();
  for (let index2 = 0; index2 < summaries.length; index2 += 50) {
    const ids = summaries.slice(index2, index2 + 50).map((summary) => summary.id);
    if (!ids.length) continue;
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await requireOrderDb(env).prepare(`
          SELECT order_gid FROM order_projection
          WHERE shop_id = ? AND order_gid IN (${placeholders})
        `).bind(shop.id, ...ids).all();
    for (const row of rows.results || []) projected.add(row.order_gid);
  }
  for (const summary of summaries) {
    if (!projected.has(summary.id)) continue;
    const assetSync = await syncDesignerStudioAssetsForSummary(env, shop.id, summary);
    summary.sync.assetSync = {
      candidates: assetSync.candidates,
      imported: assetSync.imported,
      existing: assetSync.existing,
      failed: assetSync.errors.length
    };
    if (assetSync.errors.length) {
      summary.sync.partial = true;
      summary.sync.errors.push(...assetSync.errors);
    }
  }
  await storeSummaries(env, summaries);
  return summaries;
}
__name(refreshSummaries, "refreshSummaries");
async function refreshThroughCoordinator(env, gids) {
  if (!env.ORDER_SYNC_COORDINATOR) return refreshSummaries(env, gids, coordinatorGraphQL);
  const id2 = env.ORDER_SYNC_COORDINATOR.idFromName(shopDomain(env));
  const response = await env.ORDER_SYNC_COORDINATOR.get(id2).fetch(new Request("https://internal/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gids })
  }));
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || "Shopify refresh failed");
  return body.summaries || [];
}
__name(refreshThroughCoordinator, "refreshThroughCoordinator");
async function backfillDesignerStudioAssets(env) {
  const shop = await d1Shop(env);
  const db = requireOrderDb(env);
  const completed = await db.prepare(`
      SELECT checkpoint, last_result_json
      FROM reconciliation_checkpoints
      WHERE shop_id = ? AND name = ?
    `).bind(shop.id, DESIGNER_ASSET_BACKFILL_CHECKPOINT).first();
  if (completed) {
    let previous = {};
    try {
      previous = JSON.parse(completed.last_result_json || "{}");
    } catch (_) {
    }
    return { ok: true, alreadyCompleted: true, ...previous };
  }
  const rows = await db.prepare(`
      SELECT order_gid
      FROM order_projection
      WHERE shop_id = ? AND active = 1
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(shop.id).all();
  const gids = (rows.results || []).map((row) => row.order_gid);
  const startedAt = isoNow();
  const summaries = gids.length ? await refreshThroughCoordinator(env, gids) : [];
  const result = summaries.reduce((report, summary) => {
    const sync = summary.sync?.assetSync || {};
    report.candidates += Number(sync.candidates || 0);
    report.imported += Number(sync.imported || 0);
    report.existing += Number(sync.existing || 0);
    report.failed += Number(sync.failed || 0);
    return report;
  }, {
    orders: gids.length,
    candidates: 0,
    imported: 0,
    existing: 0,
    failed: 0,
    completedAt: isoNow()
  });
  if (result.failed > 0) {
    throw Object.assign(
      new Error(`Designer Studio backfill left ${result.failed} asset(s) unresolved; it will retry.`),
      { code: "DESIGNER_ASSET_BACKFILL_INCOMPLETE", report: result }
    );
  }
  await db.prepare(`
      INSERT INTO reconciliation_checkpoints (
        shop_id, name, checkpoint, last_started_at, last_completed_at, last_result_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, name) DO UPDATE SET
        checkpoint = excluded.checkpoint,
        last_started_at = excluded.last_started_at,
        last_completed_at = excluded.last_completed_at,
        last_result_json = excluded.last_result_json
    `).bind(
    shop.id,
    DESIGNER_ASSET_BACKFILL_CHECKPOINT,
    result.completedAt,
    startedAt,
    result.completedAt,
    JSON.stringify(result)
  ).run();
  return { ok: true, ...result };
}
__name(backfillDesignerStudioAssets, "backfillDesignerStudioAssets");
async function bootstrapInitialBoard(env, graphQL = shopifyGraphQLWithRetry) {
  const shop = await d1Shop(env);
  const db = requireOrderDb(env);
  const existing = await db.prepare(`
      SELECT checkpoint, last_result_json
      FROM reconciliation_checkpoints
      WHERE shop_id = ? AND name = 'bootstrap'
    `).bind(shop.id).first();
  if (existing) {
    let previous = null;
    try {
      previous = existing.last_result_json ? JSON.parse(existing.last_result_json) : null;
    } catch (_) {
    }
    return { ok: true, alreadyInitialized: true, ...previous || {} };
  }
  const startedAt = isoNow();
  const result = await graphQL(
    env,
    BOOTSTRAP_ORDERS_QUERY,
    { query: "financial_status:paid status:open", first: 50 },
    "PrintMOBootstrapOrders"
  );
  const connection = requireShopifyData(result, "PrintMOBootstrapOrders").orders;
  if (!connection) {
    throw Object.assign(new Error("Initial Shopify reconciliation returned no orders connection."), {
      code: "BOOTSTRAP_ORDERS_MISSING",
      status: 502
    });
  }
  const gids = [];
  for (const order of connection.nodes || []) {
    const gid2 = canonicalOrderGid(order?.id);
    if (!gid2) continue;
    const production = parseProductionMetafield(order.metafield, "bootstrap");
    await d1ProjectionUpsert(
      env,
      shop.id,
      gid2,
      production.state,
      production.compareDigest,
      void 0,
      order
    );
    gids.push(gid2);
  }
  if (gids.length) await refreshSummaries(env, gids, graphQL);
  const completedAt = isoNow();
  const report = {
    ok: true,
    projected: gids.length,
    truncated: Boolean(connection.pageInfo?.hasNextPage),
    query: "financial_status:paid status:open",
    completedAt
  };
  await db.prepare(`
      INSERT INTO reconciliation_checkpoints (
        shop_id, name, checkpoint, last_started_at, last_completed_at, last_result_json
      ) VALUES (?, 'bootstrap', ?, ?, ?, ?)
      ON CONFLICT(shop_id, name) DO UPDATE SET
        checkpoint = excluded.checkpoint,
        last_started_at = excluded.last_started_at,
        last_completed_at = excluded.last_completed_at,
        last_result_json = excluded.last_result_json
    `).bind(shop.id, completedAt, startedAt, completedAt, JSON.stringify(report)).run();
  return report;
}
__name(bootstrapInitialBoard, "bootstrapInitialBoard");
async function bootstrapThroughCoordinator(env) {
  if (!env.ORDER_SYNC_COORDINATOR) return bootstrapInitialBoard(env, shopifyGraphQLWithRetry);
  const id2 = env.ORDER_SYNC_COORDINATOR.idFromName(shopDomain(env));
  const response = await env.ORDER_SYNC_COORDINATOR.get(id2).fetch(new Request("https://internal/bootstrap"));
  const body = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(body?.error || "Initial Shopify reconciliation failed"), {
      code: "BOARD_BOOTSTRAP_FAILED",
      status: response.status
    });
  }
  return body;
}
__name(bootstrapThroughCoordinator, "bootstrapThroughCoordinator");
function computeProductionDiff(summary, snapshot) {
  if (!snapshot || !summary?.commerce) return [];
  const reasons = [];
  const before = new Map((snapshot.lineItems || []).map((item) => [item.id, item]));
  const live = new Map((summary.commerce.lineItems || []).map((item) => [item.id, item]));
  for (const [id2, item] of live) {
    const prior = before.get(id2);
    if (!prior) reasons.push("LINE_ITEM_ADDED");
    else {
      if ((prior.sku || null) !== (item.sku || null)) reasons.push("SKU_CHANGED");
      if (Number(item.currentQuantity) > Number(prior.currentQuantity)) reasons.push("QUANTITY_INCREASED");
      if (Number(item.currentQuantity) < Number(prior.currentQuantity)) reasons.push("QUANTITY_DECREASED");
    }
  }
  for (const id2 of before.keys()) if (!live.has(id2)) reasons.push("LINE_ITEM_REMOVED");
  if (summary.commerce.cancelledAt) reasons.push("ORDER_CANCELLED");
  if (String(summary.commerce.financialStatus || "").includes("REFUND")) reasons.push("ORDER_REFUNDED");
  return [...new Set(reasons)];
}
__name(computeProductionDiff, "computeProductionDiff");
async function handleShopifyPreviewOrdersGet(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 50);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const cacheKey = `${shopDomain(env)}:${limit}`;
    const cached = shopifyPreviewCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return jsonResponse({ ...cached.payload, cached: true }, allowOrigin, reqAllowHeaders);
    }
    const result = await coordinatorGraphQL(
      env,
      SHOPIFY_PREVIEW_ORDERS_QUERY,
      { first: limit },
      "PrintMOShopifyPreviewOrders"
    );
    const connection = requireShopifyData(result, "PrintMOShopifyPreviewOrders").orders;
    const fetchedAt = (/* @__PURE__ */ new Date()).toISOString();
    const data2 = (connection?.nodes || []).map((node) => ({
      id: node.id,
      displayName: node.name,
      createdAt: node.createdAt,
      shopifyUpdatedAt: node.updatedAt,
      customer: {
        displayName: selectOperationalCustomerName(node)
      },
      commerce: {
        financialStatus: node.displayFinancialStatus || null,
        fulfillmentStatus: node.displayFulfillmentStatus || null,
        cancelledAt: node.cancelledAt || null,
        currencyCode: node.currencyCode || node.currentTotalPriceSet?.shopMoney?.currencyCode || null,
        subtotal: node.currentSubtotalPriceSet?.shopMoney?.amount || null,
        discount: node.currentTotalDiscountsSet?.shopMoney?.amount || null,
        total: node.currentTotalPriceSet?.shopMoney?.amount || null,
        currentLineItemQuantity: Number(node.currentSubtotalLineItemsQuantity || 0)
      }
    }));
    const payload = {
      source: "shopify-admin-graphql",
      readOnly: true,
      cached: false,
      fetchedAt,
      apiVersion: result.apiVersion || SHOPIFY_API_VERSION,
      data: data2,
      pageInfo: {
        returned: data2.length,
        hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
        limit
      },
      errors: (result.errors || []).map((error) => ({
        code: error?.extensions?.code || null,
        message: error?.message || "Shopify returned a partial error"
      }))
    };
    shopifyPreviewCache.set(cacheKey, { payload, expiresAt: Date.now() + SHOPIFY_PREVIEW_TTL_MS });
    return jsonResponse(payload, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 502);
  }
}
__name(handleShopifyPreviewOrdersGet, "handleShopifyPreviewOrdersGet");
function normalizePreviewAddress(address) {
  if (!address) return null;
  return {
    name: address.name || null,
    company: address.company || null,
    address1: address.address1 || null,
    address2: address.address2 || null,
    city: address.city || null,
    province: address.province || null,
    provinceCode: address.provinceCode || null,
    zip: address.zip || null,
    country: address.country || null,
    countryCode: address.countryCodeV2 || null,
    phone: address.phone || null
  };
}
__name(normalizePreviewAddress, "normalizePreviewAddress");
function normalizePreviewVisit(visit) {
  if (!visit) return null;
  return {
    id: visit.id,
    occurredAt: visit.occurredAt,
    source: visit.source || null,
    sourceDescription: visit.sourceDescription || null,
    sourceType: visit.sourceType || null,
    landingPage: visit.landingPage || null,
    referrerUrl: visit.referrerUrl || null,
    referralCode: visit.referralCode || null
  };
}
__name(normalizePreviewVisit, "normalizePreviewVisit");
function normalizePreviewDiscount(discount) {
  const value = discount?.value || null;
  return {
    type: discount?.__typename || "DiscountApplication",
    label: discount?.code || discount?.title || discount?.description || "Discount",
    code: discount?.code || null,
    description: discount?.description || null,
    allocationMethod: discount?.allocationMethod || null,
    targetSelection: discount?.targetSelection || null,
    targetType: discount?.targetType || null,
    value: value?.__typename === "MoneyV2" ? { type: "money", amount: String(value.amount), currencyCode: value.currencyCode } : value?.__typename === "PricingPercentageValue" ? { type: "percentage", percentage: Number(value.percentage) } : null
  };
}
__name(normalizePreviewDiscount, "normalizePreviewDiscount");
function normalizePreviewLineItem(item, fallbackCurrency) {
  return {
    id: item.id,
    variantId: item.variant?.id || null,
    sku: item.sku || null,
    title: item.title || "",
    variantTitle: item.variantTitle || null,
    vendor: item.vendor || null,
    quantity: Number(item.quantity || 0),
    currentQuantity: Number(item.currentQuantity || 0),
    unfulfilledQuantity: Number(item.unfulfilledQuantity || 0),
    requiresShipping: Boolean(item.requiresShipping),
    unitPrice: moneyValue(item.originalUnitPriceSet, fallbackCurrency),
    originalTotal: moneyValue(item.originalTotalSet, fallbackCurrency),
    totalDiscount: moneyValue(item.totalDiscountSet, fallbackCurrency),
    currentTotal: moneyValue(item.priceAfterAllDiscountsBeforeTaxesSet, fallbackCurrency),
    customAttributes: Array.isArray(item.customAttributes) ? item.customAttributes : [],
    taxLines: (item.taxLines || []).map((taxLine) => ({
      title: taxLine.title || "Tax",
      rate: Number(taxLine.rate || 0),
      amount: moneyValue(taxLine.priceSet, fallbackCurrency)
    })),
    discountAllocations: (item.discountAllocations || []).map(
      (allocation) => moneyValue(allocation.allocatedAmountSet, fallbackCurrency)
    ).filter(Boolean)
  };
}
__name(normalizePreviewLineItem, "normalizePreviewLineItem");
async function completeCanonicalDetailLineItems(env, orderId, connection, fallbackCurrency) {
  const items = (connection?.nodes || []).map((item) => normalizePreviewLineItem(item, fallbackCurrency));
  const errors = [];
  let pageInfo = connection?.pageInfo || { hasNextPage: false, endCursor: null };
  while (pageInfo.hasNextPage) {
    const result = await coordinatorGraphQL(env, ORDER_DETAIL_LINE_ITEMS_QUERY, { id: orderId, after: pageInfo.endCursor }, "PrintMOOrderDetailLineItems");
    errors.push(...result.errors || []);
    const next = result.data?.order?.lineItems;
    if (!next) return { items, complete: false, errors };
    items.push(...(next.nodes || []).map((item) => normalizePreviewLineItem(item, fallbackCurrency)));
    pageInfo = next.pageInfo || { hasNextPage: false, endCursor: null };
  }
  return { items, complete: true, errors };
}
__name(completeCanonicalDetailLineItems, "completeCanonicalDetailLineItems");
async function completePreviewLineItems(env, orderId, connection, fallbackCurrency) {
  const items = (connection?.nodes || []).map((item) => normalizePreviewLineItem(item, fallbackCurrency));
  const errors = [];
  let pageInfo = connection?.pageInfo || { hasNextPage: false, endCursor: null };
  while (pageInfo.hasNextPage) {
    const result = await coordinatorGraphQL(
      env,
      SHOPIFY_PREVIEW_ORDER_LINE_ITEMS_QUERY,
      { id: orderId, after: pageInfo.endCursor },
      "PrintMOShopifyPreviewOrderLineItems"
    );
    errors.push(...result.errors || []);
    const next = result.data?.order?.lineItems;
    if (!next) return { items, complete: false, errors };
    items.push(...(next.nodes || []).map((item) => normalizePreviewLineItem(item, fallbackCurrency)));
    pageInfo = next.pageInfo || { hasNextPage: false, endCursor: null };
  }
  return { items, complete: true, errors };
}
__name(completePreviewLineItems, "completePreviewLineItems");
function previewError(error) {
  return {
    code: error?.extensions?.code || null,
    message: error?.message || "Shopify returned a partial error",
    path: Array.isArray(error?.path) ? error.path : []
  };
}
__name(previewError, "previewError");
async function handleShopifyPreviewOrderDetailGet(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const url = new URL(request.url);
    const prefix2 = "/order-manager/v1/shopify-preview/orders/";
    const rawId = decodeURIComponent(url.pathname.slice(prefix2.length));
    const gid2 = canonicalOrderGid(rawId);
    if (!gid2) return v1Error({ code: "INVALID_ORDER_ID", message: "A valid Shopify order ID is required" }, allowOrigin, reqAllowHeaders, 400);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const cacheKey = `detail:${shopDomain(env)}:${gid2}`;
    const cached = shopifyPreviewCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return jsonResponse({ ...cached.payload, cached: true }, allowOrigin, reqAllowHeaders);
    }
    const result = await coordinatorGraphQL(
      env,
      SHOPIFY_PREVIEW_ORDER_DETAIL_QUERY,
      { id: gid2 },
      "PrintMOShopifyPreviewOrderDetail"
    );
    const order = requireShopifyData(result, "PrintMOShopifyPreviewOrderDetail").order;
    if (!order) return v1Error({ code: "ORDER_NOT_FOUND", message: "Shopify order was not found" }, allowOrigin, reqAllowHeaders, 404);
    const currency = order.currencyCode || order.currentTotalPriceSet?.shopMoney?.currencyCode || null;
    const lineItems = await completePreviewLineItems(env, gid2, order.lineItems, currency);
    const rawErrors = [...result.errors || [], ...lineItems.errors];
    const identityReturned = Boolean(
      selectOperationalCustomerName(order) || order.customer?.email || order.customer?.phone || order.email || order.phone
    );
    const protectedDataError = rawErrors.some((error) => {
      const message = String(error?.message || "").toLowerCase();
      const path = Array.isArray(error?.path) ? error.path.join(".").toLowerCase() : "";
      return message.includes("protected customer") || error?.extensions?.code === "ACCESS_DENIED" && /customer|email|phone|address/.test(path || message);
    });
    const payload = {
      source: "shopify-admin-graphql",
      readOnly: true,
      cached: false,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      apiVersion: result.apiVersion || SHOPIFY_API_VERSION,
      data: {
        id: order.id,
        displayName: order.name,
        createdAt: order.createdAt,
        processedAt: order.processedAt,
        shopifyUpdatedAt: order.updatedAt,
        closedAt: order.closedAt || null,
        cancelledAt: order.cancelledAt || null,
        cancelReason: order.cancelReason || null,
        note: order.note || null,
        tags: order.tags || [],
        test: Boolean(order.test),
        sourceName: order.sourceName || null,
        customer: {
          id: order.customer?.id || null,
          displayName: selectOperationalCustomerName(order),
          email: order.customer?.email || order.email || null,
          phone: order.customer?.phone || order.phone || null,
          locale: order.customerLocale || null
        },
        protectedCustomerData: {
          identityReturned,
          possiblyRestricted: protectedDataError || !identityReturned
        },
        commerce: {
          financialStatus: order.displayFinancialStatus || null,
          fulfillmentStatus: order.displayFulfillmentStatus || null,
          fullyPaid: Boolean(order.fullyPaid),
          unpaid: Boolean(order.unpaid),
          currencyCode: currency,
          lineItemQuantity: Number(order.currentSubtotalLineItemsQuantity || 0),
          subtotal: moneyValue(order.currentSubtotalPriceSet, currency),
          shipping: moneyValue(order.currentShippingPriceSet, currency),
          discounts: moneyValue(order.currentTotalDiscountsSet, currency),
          tax: moneyValue(order.currentTotalTaxSet, currency),
          total: moneyValue(order.currentTotalPriceSet, currency),
          received: moneyValue(order.totalReceivedSet, currency),
          refunded: moneyValue(order.totalRefundedSet, currency),
          outstanding: moneyValue(order.totalOutstandingSet, currency),
          paymentGateways: order.paymentGatewayNames || [],
          transactions: (order.transactions || []).map((transaction) => ({
            id: transaction.id,
            kind: transaction.kind,
            status: transaction.status,
            gateway: transaction.formattedGateway || transaction.gateway || null,
            createdAt: transaction.createdAt,
            processedAt: transaction.processedAt || null,
            test: Boolean(transaction.test),
            errorCode: transaction.errorCode || null,
            amount: moneyValue(transaction.amountSet, currency)
          }))
        },
        delivery: {
          shippingAddress: normalizePreviewAddress(order.shippingAddress),
          billingAddress: normalizePreviewAddress(order.billingAddress),
          shippingLines: (order.shippingLines?.nodes || []).map((line) => ({
            id: line.id,
            title: line.title,
            code: line.code || null,
            source: line.source || null,
            deliveryCategory: line.deliveryCategory || null,
            custom: Boolean(line.custom),
            originalPrice: moneyValue(line.originalPriceSet, currency),
            currentPrice: moneyValue(line.currentDiscountedPriceSet, currency),
            discountAllocations: (line.discountAllocations || []).map(
              (allocation) => moneyValue(allocation.allocatedAmountSet, currency)
            ).filter(Boolean)
          })),
          fulfillmentOrders: (order.fulfillmentOrders?.nodes || []).map((fulfillmentOrder) => ({
            id: fulfillmentOrder.id,
            status: fulfillmentOrder.status,
            requestStatus: fulfillmentOrder.requestStatus,
            fulfillAt: fulfillmentOrder.fulfillAt || null,
            fulfillBy: fulfillmentOrder.fulfillBy || null,
            method: fulfillmentOrder.deliveryMethod ? {
              type: fulfillmentOrder.deliveryMethod.methodType,
              presentedName: fulfillmentOrder.deliveryMethod.presentedName || null,
              serviceCode: fulfillmentOrder.deliveryMethod.serviceCode || null,
              minDeliveryAt: fulfillmentOrder.deliveryMethod.minDeliveryDateTime || null,
              maxDeliveryAt: fulfillmentOrder.deliveryMethod.maxDeliveryDateTime || null
            } : null
          })),
          fulfillments: (order.fulfillments || []).map((fulfillment) => ({
            id: fulfillment.id,
            name: fulfillment.name,
            status: fulfillment.status,
            displayStatus: fulfillment.displayStatus || null,
            createdAt: fulfillment.createdAt,
            updatedAt: fulfillment.updatedAt,
            deliveredAt: fulfillment.deliveredAt || null,
            estimatedDeliveryAt: fulfillment.estimatedDeliveryAt || null,
            totalQuantity: Number(fulfillment.totalQuantity || 0),
            tracking: fulfillment.trackingInfo || []
          }))
        },
        conversion: order.customerJourneySummary ? {
          ready: Boolean(order.customerJourneySummary.ready),
          customerOrderIndex: order.customerJourneySummary.customerOrderIndex,
          daysToConversion: order.customerJourneySummary.daysToConversion,
          firstVisit: normalizePreviewVisit(order.customerJourneySummary.firstVisit),
          lastVisit: normalizePreviewVisit(order.customerJourneySummary.lastVisit)
        } : null,
        discounts: (order.discountApplications?.nodes || []).map(normalizePreviewDiscount),
        lineItems: lineItems.items,
        lineItemsComplete: lineItems.complete,
        timeline: (order.events?.nodes || []).map((event) => ({
          id: event.id,
          type: event.__typename,
          createdAt: event.createdAt,
          critical: Boolean(event.criticalAlert),
          action: event.action || null,
          appTitle: event.appTitle || null,
          author: event.author || null,
          message: event.rawMessage || event.message || null,
          secondaryMessage: event.secondaryMessage || null
        }))
      },
      errors: rawErrors.map(previewError)
    };
    shopifyPreviewCache.set(cacheKey, { payload, expiresAt: Date.now() + SHOPIFY_PREVIEW_DETAIL_TTL_MS });
    return jsonResponse(payload, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 502);
  }
}
__name(handleShopifyPreviewOrderDetailGet, "handleShopifyPreviewOrderDetailGet");
async function boardDto(env, record) {
  if (record?.kind === "provider") return providerBoardDto(env, record);
  const production = record.production || { stage: "received", version: 0, assets: [] };
  const summary = record.summary;
  if (!summary) {
    return {
      id: record.gid,
      displayName: production.legacyIdentifier || record.gid,
      createdAt: production.createdAt,
      shopifyUpdatedAt: null,
      customer: { displayName: null },
      commerce: null,
      production,
      supplierAttention: record.supplierAttention || null,
      attention: { required: false, reasons: [], acknowledgedAt: null },
      sync: { fetchedAt: null, freshUntil: null, hardExpiresAt: null, stale: true, partial: true, errors: [{ code: "SHOPIFY_UNAVAILABLE", message: "Live Shopify fields are unavailable." }] }
    };
  }
  const reasons = computeProductionDiff(summary, production.productionSnapshot);
  return {
    ...summary,
    production,
    supplierAttention: record.supplierAttention || null,
    attention: { required: reasons.length > 0, reasons, acknowledgedAt: null }
  };
}
__name(boardDto, "boardDto");
function providerProjectionRecord(row) {
  let contract = null;
  let production = defaultProductionState();
  try {
    contract = row.commerce_json ? JSON.parse(row.commerce_json) : null;
  } catch (_) {
  }
  try {
    production = normalizeProductionState(JSON.parse(row.state_json || "{}"));
  } catch (_) {
  }
  return {
    kind: "provider",
    orderKey: row.order_key,
    provider: row.provider,
    contract,
    production,
    enrollmentState: row.enrollment_state,
    staleAt: row.stale_at,
    lastError: row.last_error
  };
}
__name(providerProjectionRecord, "providerProjectionRecord");
function providerGarmentCount(contract, state = {}) {
  return garmentCountFromLineItems(contract?.commerce?.lineItems || [], state.printEligibility);
}
__name(providerGarmentCount, "providerGarmentCount");
async function providerBoardDto(env, record) {
  const contract = record.contract || {};
  const production = productionForClient(
    record.orderKey,
    record.production,
    null,
    [],
    providerGarmentCount(contract, record.production)
  );
  const source = {
    provider: record.provider || contract?.source?.provider || "unknown",
    label: contract?.source?.label || record.provider || "Unknown",
    providerAccountId: contract?.source?.providerAccountId || null,
    externalOrderId: contract?.source?.externalOrderId || null,
    displayNumber: contract?.source?.displayNumber || contract?.displayName || record.orderKey,
    adminUrl: contract?.source?.adminUrl || null,
    synthetic: Boolean(contract?.source?.synthetic)
  };
  const errors = [...Array.isArray(contract?.sync?.errors) ? contract.sync.errors : []];
  if (record.lastError) errors.push({ code: "PROVIDER_PROJECTION_ERROR", message: record.lastError });
  const dto = {
    ...contract,
    id: record.orderKey,
    orderKey: record.orderKey,
    source,
    // Apply shop policy to previously cached receipts as well as newly synced orders.
    commerce: source.provider === "etsy" ? {
      ...contract.commerce,
      deliveryMethod: etsyDeliveryMethod(contract.sync?.fetchedAt || isoNow())
    } : contract.commerce,
    production,
    productionRef: {
      authority: "printmo-d1",
      provider: source.provider,
      orderKey: record.orderKey,
      revision: production.revision
    },
    supplierAttention: record.supplierAttention || null,
    attention: record.production.attention,
    capabilities: {
      ...contract?.capabilities || {},
      productionWrite: ["pilot", "active"].includes(record.enrollmentState)
    },
    sync: {
      ...contract?.sync || {},
      stale: Boolean(record.staleAt || contract?.sync?.stale),
      partial: Boolean(record.lastError || contract?.sync?.partial),
      errors
    }
  };
  return attachEtsyCatalogPreviews(env, dto);
}
__name(providerBoardDto, "providerBoardDto");
function d1LikePattern(value) {
  return `%${String(value || "").replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}
__name(d1LikePattern, "d1LikePattern");
async function loadDataPage(env, { view = "active", stage = "", q = "", limit, offset }) {
  const shop = await d1Shop(env);
  const db = requireOrderDb(env);
  if (!["active", "previous"].includes(view)) {
    throw Object.assign(new Error("View filter is invalid."), { code: "INVALID_VIEW", status: 400 });
  }
  if (stage) {
    if (!PRODUCTION_STAGES.has(stage)) throw Object.assign(new Error("Stage filter is invalid."), { code: "INVALID_STAGE", status: 400 });
  }
  if (view === "previous") {
    const searchPattern = d1LikePattern(q.toLowerCase());
    const searchSql = q ? ` AND (
                LOWER(COALESCE(display_name, '')) LIKE ? ESCAPE '\\'
                OR LOWER(COALESCE(json_extract(commerce_json, '$.customer.displayName'), '')) LIKE ? ESCAPE '\\'
              )` : "";
    const searchValues = q ? [searchPattern, searchPattern] : [];
    const where = `
          WHERE shop_id = ?
            AND (UPPER(COALESCE(json_extract(commerce_json, '$.commerce.fulfillmentStatus'), '')) = 'FULFILLED'
              OR json_extract(commerce_json, '$.commerce.closedAt') IS NOT NULL)
            AND json_extract(commerce_json, '$.commerce.cancelledAt') IS NULL${searchSql}
        `;
    const [rows, count] = await Promise.all([
      db.prepare(`
              SELECT * FROM order_projection
              ${where}
              ORDER BY COALESCE(shopify_updated_at, updated_at) DESC, order_gid DESC
              LIMIT ? OFFSET ?
            `).bind(shop.id, ...searchValues, limit, offset).all(),
      db.prepare(`SELECT COUNT(*) AS count FROM order_projection ${where}`).bind(shop.id, ...searchValues).first()
    ]);
    const total2 = Number(count?.count || 0);
    return {
      records: (rows.results || []).map((row) => d1ProjectionRecord(row)),
      shopifyTotal: total2,
      providerTotal: 0,
      total: total2,
      nextOffset: offset + limit < total2 ? offset + limit : null
    };
  }
  const shopifyStage = stage ? " AND stage = ?" : "";
  const providerStage = stage ? ` AND json_extract(ps.state_json, '$.stage') = ?` : "";
  const shopifyValues = [shop.id, ...stage ? [stage] : []];
  const providerValues = [shop.id, ...stage ? [stage] : []];
  const refs = await db.prepare(`
      SELECT source_kind, source_id, source_created_at
      FROM (
        SELECT 'shopify' AS source_kind, order_gid AS source_id, created_at AS source_created_at
        FROM order_projection
        WHERE shop_id = ? AND active = 1
          AND UPPER(COALESCE(json_extract(commerce_json, '$.commerce.fulfillmentStatus'), '')) <> 'FULFILLED'${shopifyStage}
        UNION ALL
        SELECT 'provider' AS source_kind, p.order_key AS source_id,
               COALESCE(p.source_created_at, p.created_at) AS source_created_at
        FROM provider_order_projection p
        JOIN provider_production_state ps
          ON ps.shop_id = p.shop_id AND ps.order_key = p.order_key
        WHERE p.shop_id = ? AND p.board_enrolled = 1
          AND json_extract(ps.state_json, '$.archivedAt') IS NULL${providerStage}
      )
      ORDER BY source_created_at ASC, source_id ASC
      LIMIT ? OFFSET ?
    `).bind(...shopifyValues, ...providerValues, limit, offset).all();
  const [shopifyCount, providerCount] = await Promise.all([
    db.prepare(`
          SELECT COUNT(*) AS count FROM order_projection
          WHERE shop_id = ? AND active = 1
            AND UPPER(COALESCE(json_extract(commerce_json, '$.commerce.fulfillmentStatus'), '')) <> 'FULFILLED'${shopifyStage}
        `).bind(...shopifyValues).first(),
    db.prepare(`
          SELECT COUNT(*) AS count
          FROM provider_order_projection p
          JOIN provider_production_state ps
            ON ps.shop_id = p.shop_id AND ps.order_key = p.order_key
          WHERE p.shop_id = ? AND p.board_enrolled = 1
            AND json_extract(ps.state_json, '$.archivedAt') IS NULL${providerStage}
        `).bind(...providerValues).first()
  ]);
  const shopifyTotal = Number(shopifyCount?.count || 0);
  const providerTotal = Number(providerCount?.count || 0);
  const total = shopifyTotal + providerTotal;
  const refList = refs.results || [];
  const shopifyIds = refList.filter((ref) => ref.source_kind === "shopify").map((ref) => ref.source_id);
  const providerIds = refList.filter((ref) => ref.source_kind === "provider").map((ref) => ref.source_id);
  const [shopifyRows, providerRows] = await Promise.all([
    shopifyIds.length ? db.prepare(`SELECT * FROM order_projection WHERE shop_id = ? AND order_gid IN (${shopifyIds.map(() => "?").join(",")})`).bind(shop.id, ...shopifyIds).all() : Promise.resolve({ results: [] }),
    providerIds.length ? db.prepare(`
                SELECT p.*, ps.revision, ps.last_mutation_id, ps.state_json,
                       ps.created_at AS production_created_at, ps.updated_at AS production_updated_at
                FROM provider_order_projection p
                JOIN provider_production_state ps
                  ON ps.shop_id = p.shop_id AND ps.order_key = p.order_key
                WHERE p.shop_id = ? AND p.order_key IN (${providerIds.map(() => "?").join(",")})
              `).bind(shop.id, ...providerIds).all() : Promise.resolve({ results: [] })
  ]);
  const shopifyById = new Map((shopifyRows.results || []).map((row) => [row.order_gid, row]));
  const providerById = new Map((providerRows.results || []).map((row) => [row.order_key, row]));
  const [assetsByOrder, mobilePreviewsByOrder] = await Promise.all([
    d1AssetsForOrders(env, shop.id, shopifyIds),
    d1MobilePreviewsForOrders(env, shop.id, shopifyIds)
  ]);
  const records = refList.map((ref) => {
    if (ref.source_kind === "provider") return providerProjectionRecord(providerById.get(ref.source_id) || {});
    const row = shopifyById.get(ref.source_id) || {};
    const record = d1ProjectionRecord(row);
    record.production.assets = assetsByOrder.get(row.order_gid) || [];
    record.production.mobilePreview = mobilePreviewForSummary(mobilePreviewsByOrder.get(row.order_gid), record.summary);
    return record;
  });
  return {
    records,
    shopifyTotal,
    providerTotal,
    total,
    nextOffset: offset + limit < total ? offset + limit : null
  };
}
__name(loadDataPage, "loadDataPage");
async function handleV1OrdersGet(request, env, allowOrigin, reqAllowHeaders, ctx) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") || "active";
    const stage = url.searchParams.get("stage") || "";
    const q = safeText(url.searchParams.get("q"), 120).trim();
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 50);
    const filter = JSON.stringify({ view, q, stage, limit });
    const offset = await decodeSignedCursor(url.searchParams.get("cursor"), filter, env);
    let page = await loadDataPage(env, { view, stage, q, limit, offset });
    if (view === "active" && page.shopifyTotal === 0 && offset === 0) {
      const shop = await d1Shop(env);
      const initialized = await requireOrderDb(env).prepare(`
              SELECT 1 AS ready
              FROM reconciliation_checkpoints
              WHERE shop_id = ? AND name IN ('migration', 'bootstrap')
              LIMIT 1
            `).bind(shop.id).first();
      if (!initialized) {
        try {
          await bootstrapThroughCoordinator(env);
          page = await loadDataPage(env, { view, stage, q, limit, offset });
        } catch (error) {
          console.error("Initial Shopify board reconciliation failed:", error.message);
          return v1Error({
            code: "BOARD_NOT_INITIALIZED",
            message: `The Shopify board could not complete its initial read: ${error.message}`
          }, allowOrigin, reqAllowHeaders, 503);
        }
      }
    }
    const staleGids = (page.records || []).filter((record) => {
      if (record.kind !== "shopify") return false;
      if (forceRefresh) return true;
      const summary = record.summary;
      return !summary || summary.sync?.stale || !summary.sync?.freshUntil || Date.parse(summary.sync.freshUntil) <= Date.now();
    }).map((record) => record.gid);
    if (staleGids.length) {
      if (forceRefresh || !ctx?.waitUntil) {
        try {
          await refreshThroughCoordinator(env, staleGids);
          page = await loadDataPage(env, { view, stage, q, limit, offset });
        } catch (error) {
          console.error("Shopify summary refresh failed:", error.message);
        }
      } else {
        ctx.waitUntil(refreshThroughCoordinator(env, staleGids).catch((error) => {
          console.error("Background Shopify summary refresh failed:", error.message);
        }));
      }
    }
    if (view === "active" && ctx?.waitUntil) {
      ctx.waitUntil(backfillDesignerStudioAssets(env).catch((error) => {
        console.error("Designer Studio asset backfill error:", error.message);
      }));
    }
    const nextCursor = page.nextOffset === null ? null : await encodeSignedCursor({ v: 1, filter, offset: page.nextOffset }, env);
    return jsonResponse({ data: await Promise.all((page.records || []).map((record) => boardDto(env, record))), pageInfo: { nextCursor, total: page.total } }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1OrdersGet, "handleV1OrdersGet");
function orderIdFromV1Path(pathname) {
  const raw = pathname.replace(/^\/order-manager\/v1\/orders\//, "").replace(/\/(production|assets)$/, "");
  try {
    return canonicalOrderGid(decodeURIComponent(raw));
  } catch {
    return null;
  }
}
__name(orderIdFromV1Path, "orderIdFromV1Path");
function providerOrderKeyFromV1Path(pathname) {
  const raw = pathname.replace(/^\/order-manager\/v1\/orders\//, "").replace(/\/(production|assets)$/, "");
  try {
    const decoded = decodeURIComponent(raw);
    return /^etsy(?:-synthetic)?:[A-Za-z0-9._-]{1,80}:[A-Za-z0-9._-]{1,120}$/.test(decoded) ? decoded : null;
  } catch (_) {
    return null;
  }
}
__name(providerOrderKeyFromV1Path, "providerOrderKeyFromV1Path");
function orderIdentityFromV1Path(pathname) {
  const providerKey = providerOrderKeyFromV1Path(pathname);
  if (providerKey) return { provider: "etsy", id: providerKey };
  const gid2 = orderIdFromV1Path(pathname);
  return gid2 ? { provider: "shopify", id: gid2 } : null;
}
__name(orderIdentityFromV1Path, "orderIdentityFromV1Path");
async function readProviderOrder(env, orderKey) {
  const shop = await d1Shop(env);
  const row = await requireOrderDb(env).prepare(`
      SELECT p.*, ps.revision, ps.last_mutation_id, ps.state_json,
             ps.created_at AS production_created_at, ps.updated_at AS production_updated_at
      FROM provider_order_projection p
      JOIN provider_production_state ps
        ON ps.shop_id = p.shop_id AND ps.order_key = p.order_key
      WHERE p.shop_id = ? AND p.order_key = ? AND p.board_enrolled = 1
    `).bind(shop.id, orderKey).first();
  if (!row) {
    throw Object.assign(new Error("Provider order not found on the active board."), {
      code: "ORDER_NOT_FOUND",
      status: 404
    });
  }
  return { shop, row, record: providerProjectionRecord(row) };
}
__name(readProviderOrder, "readProviderOrder");
function providerDetailLineItems(contract) {
  const currencyCode = contract?.commerce?.currencyCode || "USD";
  return (contract?.commerce?.lineItems || []).map((item) => {
    const variations = Array.isArray(item.variations) ? item.variations : [];
    const variantTitle = variations.filter((variation) => !variation?.questionId && !/personal/i.test(String(variation?.name || ""))).map((variation) => variation?.value).filter(Boolean).join(" / ");
    const quantity = Math.max(0, Number(item.currentQuantity ?? item.quantity ?? 0));
    const unitPrice = Number(item.unitPrice || 0);
    return {
      ...item,
      sku: item.supplierSku || item.sku || null,
      sourceSku: item.sourceSku || item.sku || null,
      supplierSku: item.supplierSku || null,
      quantity,
      currentQuantity: quantity,
      unfulfilledQuantity: contract?.commerce?.shipped ? 0 : quantity,
      variantTitle,
      customAttributes: variations.filter((variation) => variation?.name && variation?.value).map((variation) => ({ key: variation.name, value: variation.value })),
      unitPrice: { amount: unitPrice, currencyCode: item.currencyCode || currencyCode },
      currentTotal: { amount: unitPrice * quantity, currencyCode: item.currencyCode || currencyCode },
      discountAllocations: [],
      requiresShipping: true
    };
  });
}
__name(providerDetailLineItems, "providerDetailLineItems");
async function providerProductionEvents(env, shopId, orderKey) {
  const result = await requireOrderDb(env).prepare(`
      SELECT actor_id, old_revision, new_revision, changed_fields_json, outcome, created_at
      FROM provider_production_events
      WHERE shop_id = ? AND order_key = ?
      ORDER BY created_at DESC
      LIMIT 25
    `).bind(shopId, orderKey).all();
  return (result.results || []).map((row) => {
    let fields = [];
    try {
      const parsed2 = JSON.parse(row.changed_fields_json || "{}");
      fields = Array.isArray(parsed2) ? parsed2 : Object.keys(parsed2);
    } catch (_) {
    }
    return {
      action: "provider.production.patch",
      actor: row.actor_id || null,
      fields,
      outcome: row.outcome || null,
      oldRevision: row.old_revision,
      newRevision: row.new_revision,
      createdAt: row.created_at || null
    };
  });
}
__name(providerProductionEvents, "providerProductionEvents");
async function handleProviderOrderDetailGet(env, orderKey, allowOrigin, reqAllowHeaders) {
  const { shop, record } = await readProviderOrder(env, orderKey);
  const dto = await providerBoardDto(env, record);
  const lineItems = providerDetailLineItems(dto);
  const productionEvents = await providerProductionEvents(env, shop.id, orderKey);
  const synthetic = Boolean(dto.source?.synthetic);
  const syntheticDetail = synthetic && dto.syntheticDetail && typeof dto.syntheticDetail === "object" ? dto.syntheticDetail : null;
  const detailCustomer = {
    displayName: dto.customer?.displayName || null,
    email: syntheticDetail?.customer?.email || null,
    phone: syntheticDetail?.customer?.phone || null,
    ...syntheticDetail?.customer?.locale ? { locale: syntheticDetail.customer.locale } : {}
  };
  const detailDelivery = syntheticDetail?.delivery || {
    shippingAddress: null,
    billingAddress: null,
    shippingLines: [],
    fulfillmentOrders: [],
    fulfillments: []
  };
  return jsonResponse({
    ...dto,
    productionEvents,
    detail: {
      id: orderKey,
      provider: dto.source?.provider || "etsy",
      fetchedAt: dto.sync?.fetchedAt || isoNow(),
      partial: Boolean(dto.sync?.partial),
      errors: dto.sync?.errors || [],
      orderNote: syntheticDetail?.orderNote || null,
      customer: detailCustomer,
      lineItems,
      data: {
        source: dto.source,
        customer: detailCustomer,
        commerce: { ...dto.commerce, lineItems },
        delivery: detailDelivery,
        discounts: syntheticDetail?.discounts || [],
        timeline: syntheticDetail?.timeline || [{
          id: `${orderKey}:enrolled`,
          type: synthetic ? "SYNTHETIC_PILOT" : "ETSY_RECEIPT",
          createdAt: dto.createdAt,
          action: "provider.enrolled",
          message: synthetic ? "Synthetic Etsy pilot order created" : "Etsy receipt enrolled",
          author: "PrintMO Order Manager"
        }]
      }
    }
  }, allowOrigin, reqAllowHeaders);
}
__name(handleProviderOrderDetailGet, "handleProviderOrderDetailGet");
async function handleProviderProductionGet(env, orderKey, allowOrigin, reqAllowHeaders) {
  const { record } = await readProviderOrder(env, orderKey);
  const dto = await providerBoardDto(env, record);
  return jsonResponse({
    orderKey,
    canonicalSource: "printmo-d1-provider-production",
    production: dto.production
  }, allowOrigin, reqAllowHeaders);
}
__name(handleProviderProductionGet, "handleProviderProductionGet");
async function completeProviderMutation(env, shopId, requestRow, record, nextState, patch) {
  const db = requireOrderDb(env);
  const contract = record.contract || {};
  const production = productionForClient(
    requestRow.order_key,
    nextState,
    null,
    [],
    providerGarmentCount(contract, nextState)
  );
  const result = {
    ok: true,
    canonicalSource: "printmo-d1-provider-production",
    syncPending: false,
    production
  };
  const now = isoNow();
  const changedFields = Object.fromEntries(Object.keys(patch).map((key2) => [key2, true]));
  await db.batch([
    db.prepare(`
          INSERT OR IGNORE INTO provider_production_events (
            id, shop_id, order_key, mutation_request_id, actor_id,
            old_revision, new_revision, changed_fields_json, outcome, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?)
        `).bind(
      `event:${requestRow.id}`,
      shopId,
      requestRow.order_key,
      requestRow.id,
      requestRow.actor_id,
      Number(requestRow.expected_revision || 0),
      nextState.revision,
      JSON.stringify(changedFields),
      now
    ),
    db.prepare(`
          UPDATE provider_mutation_requests
          SET state = 'complete', result_revision = ?, result_json = ?, error_code = NULL, updated_at = ?
          WHERE id = ?
        `).bind(nextState.revision, JSON.stringify(result), now, requestRow.id)
  ]);
  return result;
}
__name(completeProviderMutation, "completeProviderMutation");
async function handleProviderProductionPatch(request, env, orderKey, allowOrigin, reqAllowHeaders, identity) {
  const body = await request.json().catch(() => ({}));
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return v1Error({ code: "EXPECTED_VERSION_REQUIRED", message: "A non-negative expectedVersion is required." }, allowOrigin, reqAllowHeaders, 400);
  }
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
    return v1Error({ code: "IDEMPOTENCY_KEY_REQUIRED", message: "A valid idempotency key is required." }, allowOrigin, reqAllowHeaders, 400);
  }
  let patch;
  try {
    patch = normalizeProductionPatch(body.patch);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 400);
  }
  if (!Object.keys(patch).length) {
    return v1Error({ code: "EMPTY_PATCH", message: "At least one production field must change." }, allowOrigin, reqAllowHeaders, 400);
  }
  const actor = `${identity?.kind || "unknown"}:${identity?.subject || "unknown"}`;
  const { shop, record } = await readProviderOrder(env, orderKey);
  if ("archivedAt" in patch && (record.provider !== "etsy" || record.contract?.commerce?.canceled || record.contract?.commerce?.shipped || ["FULFILLED", "SHIPPED"].includes(String(record.contract?.commerce?.fulfillmentStatus || "").toUpperCase()))) {
    return v1Error({ code: "ORDER_REMOVAL_NOT_ALLOWED", message: "Only active Etsy orders can be removed from the board." }, allowOrigin, reqAllowHeaders, 403);
  }
  if (!["pilot", "active"].includes(record.enrollmentState)) {
    return v1Error({
      code: "PROVIDER_PRODUCTION_WRITE_DISABLED",
      message: "Production updates are disabled for this provider order."
    }, allowOrigin, reqAllowHeaders, 409);
  }
  const db = requireOrderDb(env);
  const requestId = crypto.randomUUID();
  const patchJson = JSON.stringify(patch);
  const now = isoNow();
  await db.prepare(`
      INSERT INTO provider_mutation_requests (
        id, shop_id, order_key, actor_id, idempotency_key, expected_revision,
        patch_json, state, result_revision, result_json, error_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)
      ON CONFLICT(shop_id, actor_id, idempotency_key) DO NOTHING
    `).bind(requestId, shop.id, orderKey, actor, idempotencyKey, expectedVersion, patchJson, now, now).run();
  const requestRow = await db.prepare(`
      SELECT * FROM provider_mutation_requests
      WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?
    `).bind(shop.id, actor, idempotencyKey).first();
  if (!requestRow) throw Object.assign(new Error("Unable to persist the provider mutation request."), { code: "MUTATION_REQUEST_FAILED", status: 503 });
  if (requestRow.order_key !== orderKey || requestRow.patch_json !== patchJson || Number(requestRow.expected_revision) !== expectedVersion) {
    return v1Error({ code: "IDEMPOTENCY_KEY_REUSE", message: "This idempotency key was already used for a different request." }, allowOrigin, reqAllowHeaders, 409);
  }
  if (requestRow.state === "complete" && requestRow.result_json) {
    return jsonResponse(JSON.parse(requestRow.result_json), allowOrigin, reqAllowHeaders);
  }
  const currentRead = await readProviderOrder(env, orderKey);
  const current = currentRead.record.production;
  if ("printedCount" in patch && patch.printedCount > current.printedCount && !current.readiness.printsReady && !patch.printsStatus) {
    return v1Error({ code: "PRINTS_NOT_READY", message: "Prints must be marked ready before recording printed pieces." }, allowOrigin, reqAllowHeaders, 409);
  }
  const garmentCount = providerGarmentCount(currentRead.record.contract, current);
  if (!("printEligibility" in patch) && "printedCount" in patch && patch.printedCount > garmentCount) {
    await db.prepare(`
          UPDATE provider_mutation_requests
          SET state = 'failed', error_code = 'INVALID_PRINTED_COUNT', updated_at = ?
          WHERE id = ?
        `).bind(isoNow(), requestRow.id).run();
    return v1Error({
      code: "INVALID_PRINTED_COUNT",
      message: `Printed count cannot exceed the current printable piece count of ${garmentCount}.`
    }, allowOrigin, reqAllowHeaders, 400);
  }
  if (current.lastMutationId === requestRow.id) {
    const repaired = await completeProviderMutation(env, shop.id, requestRow, currentRead.record, current, patch);
    return jsonResponse(repaired, allowOrigin, reqAllowHeaders);
  }
  if (current.revision !== expectedVersion) {
    return v1Error({
      code: "VERSION_CONFLICT",
      message: "Production metadata changed on another client."
    }, allowOrigin, reqAllowHeaders, 409, {
      currentVersion: current.revision,
      current: productionForClient(orderKey, current, null, [], garmentCount)
    });
  }
  const next = applyProductionPatch(current, patch, actor, requestRow.id);
  validatePrintablePatch(currentRead.record.contract?.commerce?.lineItems || [], current, patch, next);
  const saved = await db.prepare(`
      UPDATE provider_production_state
      SET revision = ?, last_mutation_id = ?, state_json = ?, updated_at = ?
      WHERE shop_id = ? AND order_key = ? AND revision = ?
    `).bind(next.revision, next.lastMutationId, JSON.stringify(next), next.updatedAt, shop.id, orderKey, expectedVersion).run();
  if (!saved.meta?.changes) {
    const conflictRead = await readProviderOrder(env, orderKey);
    const conflict = conflictRead.record.production;
    return v1Error({
      code: "VERSION_CONFLICT",
      message: "Production metadata changed on another client."
    }, allowOrigin, reqAllowHeaders, 409, {
      currentVersion: conflict.revision,
      current: productionForClient(orderKey, conflict, null, [], providerGarmentCount(conflictRead.record.contract, conflict))
    });
  }
  const result = await completeProviderMutation(env, shop.id, requestRow, currentRead.record, next, patch);
  return jsonResponse(result, allowOrigin, reqAllowHeaders);
}
__name(handleProviderProductionPatch, "handleProviderProductionPatch");
async function fetchOrderDetail(env, gid2) {
  const result = await coordinatorGraphQL(env, ORDER_DETAIL_QUERY, { id: gid2, after: null }, "PrintMOOrderDetail");
  const node = requireShopifyData(result, "PrintMOOrderDetail").order;
  if (!node) throw Object.assign(new Error("Shopify order not found"), { status: 404, code: "ORDER_NOT_FOUND" });
  const currency = node.currencyCode || node.currentTotalPriceSet?.shopMoney?.currencyCode || null;
  const lines = await completeCanonicalDetailLineItems(env, gid2, node.lineItems, currency);
  const summary = await normalizeShopifySummary(env, { ...node, lineItems: { nodes: lines.items.map((item) => ({
    ...item,
    originalUnitPriceSet: { shopMoney: { amount: item.unitPrice?.amount || "0", currencyCode: currency } }
  })), pageInfo: { hasNextPage: false } } }, result.errors || [], coordinatorGraphQL);
  const now = Date.now();
  const rawErrors = [...result.errors || [], ...lines.errors];
  const detail = {
    id: gid2,
    summary,
    orderNote: node.note || null,
    customer: {
      displayName: selectOperationalCustomerName(node),
      email: node.email || null,
      phone: node.phone || null,
      locale: node.customerLocale || null
    },
    shippingAddress: node.shippingAddress || null,
    billingAddress: node.billingAddress || null,
    fulfillments: node.fulfillments || [],
    lineItems: lines.items,
    data: {
      id: node.id,
      displayName: node.name,
      createdAt: node.createdAt,
      processedAt: node.processedAt || null,
      shopifyUpdatedAt: node.updatedAt,
      closedAt: node.closedAt || null,
      cancelledAt: node.cancelledAt || null,
      cancelReason: node.cancelReason || null,
      note: node.note || null,
      tags: node.tags || [],
      test: Boolean(node.test),
      sourceName: node.sourceName || null,
      customer: {
        displayName: selectOperationalCustomerName(node),
        email: node.email || null,
        phone: node.phone || null,
        locale: node.customerLocale || null
      },
      commerce: {
        financialStatus: node.displayFinancialStatus || null,
        fulfillmentStatus: node.displayFulfillmentStatus || null,
        fullyPaid: Boolean(node.fullyPaid),
        unpaid: Boolean(node.unpaid),
        currencyCode: currency,
        lineItemQuantity: Number(node.currentSubtotalLineItemsQuantity || 0),
        subtotal: moneyValue(node.currentSubtotalPriceSet, currency),
        shipping: moneyValue(node.currentShippingPriceSet, currency),
        discounts: moneyValue(node.currentTotalDiscountsSet, currency),
        tax: moneyValue(node.currentTotalTaxSet, currency),
        total: moneyValue(node.currentTotalPriceSet, currency),
        received: moneyValue(node.totalReceivedSet, currency),
        refunded: moneyValue(node.totalRefundedSet, currency),
        outstanding: moneyValue(node.totalOutstandingSet, currency),
        paymentGateways: node.paymentGatewayNames || [],
        transactions: (node.transactions || []).map((transaction) => ({
          id: transaction.id,
          kind: transaction.kind,
          status: transaction.status,
          gateway: transaction.formattedGateway || transaction.gateway || null,
          createdAt: transaction.createdAt,
          processedAt: transaction.processedAt || null,
          test: Boolean(transaction.test),
          errorCode: transaction.errorCode || null,
          amount: moneyValue(transaction.amountSet, currency)
        }))
      },
      delivery: {
        shippingAddress: normalizePreviewAddress(node.shippingAddress),
        billingAddress: normalizePreviewAddress(node.billingAddress),
        shippingLines: (node.shippingLines?.nodes || []).map((line) => ({
          id: line.id,
          title: line.title,
          code: line.code || null,
          source: line.source || null,
          deliveryCategory: line.deliveryCategory || null,
          custom: Boolean(line.custom),
          originalPrice: moneyValue(line.originalPriceSet, currency),
          currentPrice: moneyValue(line.currentDiscountedPriceSet, currency)
        })),
        fulfillmentOrders: (node.fulfillmentOrders?.nodes || []).map((fulfillmentOrder) => ({
          id: fulfillmentOrder.id,
          status: fulfillmentOrder.status,
          requestStatus: fulfillmentOrder.requestStatus,
          fulfillAt: fulfillmentOrder.fulfillAt || null,
          fulfillBy: fulfillmentOrder.fulfillBy || null,
          method: fulfillmentOrder.deliveryMethod ? {
            type: fulfillmentOrder.deliveryMethod.methodType,
            presentedName: fulfillmentOrder.deliveryMethod.presentedName || null,
            serviceCode: fulfillmentOrder.deliveryMethod.serviceCode || null,
            minDeliveryAt: fulfillmentOrder.deliveryMethod.minDeliveryDateTime || null,
            maxDeliveryAt: fulfillmentOrder.deliveryMethod.maxDeliveryDateTime || null
          } : null
        })),
        fulfillments: (node.fulfillments || []).map((fulfillment) => ({
          id: fulfillment.id,
          name: fulfillment.name,
          status: fulfillment.status,
          displayStatus: fulfillment.displayStatus || null,
          createdAt: fulfillment.createdAt,
          updatedAt: fulfillment.updatedAt,
          deliveredAt: fulfillment.deliveredAt || null,
          estimatedDeliveryAt: fulfillment.estimatedDeliveryAt || null,
          totalQuantity: Number(fulfillment.totalQuantity || 0),
          tracking: fulfillment.trackingInfo || []
        }))
      },
      conversion: node.customerJourneySummary ? {
        ready: Boolean(node.customerJourneySummary.ready),
        customerOrderIndex: node.customerJourneySummary.customerOrderIndex,
        daysToConversion: node.customerJourneySummary.daysToConversion,
        firstVisit: normalizePreviewVisit(node.customerJourneySummary.firstVisit),
        lastVisit: normalizePreviewVisit(node.customerJourneySummary.lastVisit)
      } : null,
      discounts: (node.discountApplications?.nodes || []).map(normalizePreviewDiscount),
      lineItems: lines.items,
      lineItemsComplete: lines.complete,
      timeline: (node.events?.nodes || []).map((event) => ({
        id: event.id,
        type: event.__typename,
        createdAt: event.createdAt,
        critical: Boolean(event.criticalAlert),
        message: event.message || event.rawMessage || null,
        action: event.action || null,
        appTitle: event.appTitle || null,
        author: event.author || null,
        secondaryMessage: event.secondaryMessage || null
      }))
    },
    fetchedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 3e5).toISOString(),
    hardExpiresAt: new Date(now + 9e5).toISOString(),
    partial: !lines.complete || rawErrors.length > 0,
    errors: rawErrors.map(previewError)
  };
  return detail;
}
__name(fetchOrderDetail, "fetchOrderDetail");
async function d1ProductionEventsForOrder(env, shopId, gid2) {
  const result = await requireOrderDb(env).prepare(`
      SELECT action, actor_id, changed_fields_json, outcome, created_at
      FROM production_events
      WHERE shop_id = ? AND order_gid = ?
      ORDER BY created_at DESC
      LIMIT 25
    `).bind(shopId, gid2).all();
  return (result.results || []).map((row) => {
    let changedFields = [];
    try {
      changedFields = Object.keys(JSON.parse(row.changed_fields_json || "{}"));
    } catch (_) {
    }
    return {
      action: row.action || "production.patch",
      actor: row.actor_id || null,
      fields: changedFields,
      outcome: row.outcome || null,
      createdAt: row.created_at || null
    };
  });
}
__name(d1ProductionEventsForOrder, "d1ProductionEventsForOrder");
async function handleV1OrderDetailGet(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const orderIdentity = orderIdentityFromV1Path(new URL(request.url).pathname);
    if (!orderIdentity) return v1Error({ code: "INVALID_ORDER_ID", message: "Invalid order identity" }, allowOrigin, reqAllowHeaders, 400);
    if (orderIdentity.provider === "etsy") {
      return await handleProviderOrderDetailGet(env, orderIdentity.id, allowOrigin, reqAllowHeaders);
    }
    const gid2 = orderIdentity.id;
    const [detail, productionRead] = await Promise.all([
      fetchOrderDetail(env, gid2),
      readProductionMetafield(env, gid2)
    ]);
    const shop = await d1Shop(env);
    const [assets, productionEvents] = await Promise.all([
      d1AssetsForOrder(env, shop.id, gid2),
      d1ProductionEventsForOrder(env, shop.id, gid2)
    ]);
    await d1ProjectionUpsert(env, shop.id, gid2, productionRead.state, productionRead.compareDigest, detail.summary, productionRead.order);
    return jsonResponse({
      ...detail.summary,
      production: productionForClient(
        gid2,
        productionRead.state,
        productionRead.compareDigest,
        assets,
        garmentCountFromLineItems(detail.summary?.commerce?.lineItems || [], productionRead.state.printEligibility)
      ),
      attention: productionRead.state.attention,
      productionEvents,
      detail
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
  }
}
__name(handleV1OrderDetailGet, "handleV1OrderDetailGet");
async function handleV1ProductionGet(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const orderIdentity = orderIdentityFromV1Path(new URL(request.url).pathname);
    if (!orderIdentity) return v1Error({ code: "INVALID_ORDER_ID", message: "Invalid order identity" }, allowOrigin, reqAllowHeaders, 400);
    if (orderIdentity.provider === "etsy") {
      return await handleProviderProductionGet(env, orderIdentity.id, allowOrigin, reqAllowHeaders);
    }
    const gid2 = orderIdentity.id;
    const productionRead = await readProductionMetafield(env, gid2);
    const shop = await d1Shop(env);
    const [assets, garmentCount] = await Promise.all([
      d1AssetsForOrder(env, shop.id, gid2),
      productionGarmentCount(env, productionRead)
    ]);
    await d1ProjectionUpsert(env, shop.id, gid2, productionRead.state, productionRead.compareDigest, void 0, productionRead.order);
    return jsonResponse({
      gid: gid2,
      canonicalSource: "shopify-app-owned-metafield",
      production: productionForClient(gid2, productionRead.state, productionRead.compareDigest, assets, garmentCount)
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error.body?.error || error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
  }
}
__name(handleV1ProductionGet, "handleV1ProductionGet");
async function d1FinalizeProductionMutation(env, shopId, requestRow, gid2, state, compareDigest, production, changedFields, order) {
  const db = requireOrderDb(env);
  const now = isoNow();
  const active = shopifyProjectionActiveValue(state, void 0, order);
  const resultJson = JSON.stringify({
    ok: true,
    canonicalSource: "shopify-app-owned-metafield",
    syncPending: false,
    production
  });
  const projection = db.prepare(`
      INSERT INTO order_projection (
        shop_id, order_gid, display_name, stage, active, production_revision,
        production_digest, production_json, commerce_json, shopify_updated_at,
        fetched_at, stale_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?, ?)
      ON CONFLICT(shop_id, order_gid) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, order_projection.display_name),
        stage = excluded.stage,
        active = excluded.active,
        production_revision = excluded.production_revision,
        production_digest = excluded.production_digest,
        production_json = excluded.production_json,
        shopify_updated_at = COALESCE(excluded.shopify_updated_at, order_projection.shopify_updated_at),
        stale_at = COALESCE(order_projection.stale_at, excluded.stale_at),
        last_error = NULL,
        updated_at = excluded.updated_at
    `).bind(
    shopId,
    gid2,
    order?.name || null,
    state.stage,
    active,
    state.revision,
    compareDigest || null,
    JSON.stringify(state),
    order?.updatedAt || null,
    now,
    order?.createdAt || now,
    now
  );
  const event = db.prepare(`
      INSERT OR IGNORE INTO production_events (
        id, shop_id, order_gid, mutation_request_id, actor_id, action,
        old_revision, new_revision, changed_fields_json, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, 'production.patch', ?, ?, ?, 'committed', ?)
    `).bind(
    `event:${requestRow.id}`,
    shopId,
    gid2,
    requestRow.id,
    requestRow.actor_id,
    Number(requestRow.expected_revision || 0),
    state.revision,
    JSON.stringify(changedFields),
    now
  );
  const complete = db.prepare(`
      UPDATE mutation_requests
      SET state = 'complete', result_json = ?, error_code = NULL, updated_at = ?
      WHERE id = ?
    `).bind(resultJson, now, requestRow.id);
  await db.batch([projection, event, complete]);
  return JSON.parse(resultJson);
}
__name(d1FinalizeProductionMutation, "d1FinalizeProductionMutation");
async function handleV1ProductionPatch(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const orderIdentity = orderIdentityFromV1Path(new URL(request.url).pathname);
    if (!orderIdentity) return v1Error({ code: "INVALID_ORDER_ID", message: "Invalid order identity" }, allowOrigin, reqAllowHeaders, 400);
    if (orderIdentity.provider === "etsy") {
      return await handleProviderProductionPatch(request, env, orderIdentity.id, allowOrigin, reqAllowHeaders, identity);
    }
    const gid2 = orderIdentity.id;
    const body = await request.json().catch(() => ({}));
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return v1Error({ code: "EXPECTED_VERSION_REQUIRED", message: "A non-negative expectedVersion is required." }, allowOrigin, reqAllowHeaders, 400);
    }
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
      return v1Error({ code: "IDEMPOTENCY_KEY_REQUIRED", message: "A valid idempotency key is required." }, allowOrigin, reqAllowHeaders, 400);
    }
    const patch = normalizeProductionPatch(body.patch);
    if ("archivedAt" in patch) return v1Error({
      code: "ORDER_REMOVAL_NOT_ALLOWED",
      message: "Only Etsy orders can be removed from the board."
    }, allowOrigin, reqAllowHeaders, 403);
    if (!Object.keys(patch).length) {
      return v1Error({ code: "EMPTY_PATCH", message: "At least one production field must change." }, allowOrigin, reqAllowHeaders, 400);
    }
    const actor = `${identity?.kind || "unknown"}:${identity?.subject || "unknown"}`;
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const requestId = crypto.randomUUID();
    const now = isoNow();
    const patchJson = JSON.stringify(patch);
    await db.prepare(`
          INSERT INTO mutation_requests (
            id, shop_id, actor_id, idempotency_key, order_gid, state,
            requested_patch_json, expected_revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
          ON CONFLICT(shop_id, actor_id, idempotency_key) DO NOTHING
        `).bind(requestId, shop.id, actor, idempotencyKey, gid2, patchJson, expectedVersion, now, now).run();
    const requestRow = await db.prepare(`
          SELECT * FROM mutation_requests
          WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?
        `).bind(shop.id, actor, idempotencyKey).first();
    if (!requestRow) throw Object.assign(new Error("Unable to persist the mutation request."), { code: "MUTATION_REQUEST_FAILED", status: 503 });
    if (requestRow.order_gid !== gid2 || requestRow.requested_patch_json !== patchJson || Number(requestRow.expected_revision) !== expectedVersion) {
      return v1Error({ code: "IDEMPOTENCY_KEY_REUSE", message: "This idempotency key was already used for a different request." }, allowOrigin, reqAllowHeaders, 409);
    }
    if (requestRow.state === "complete" && requestRow.result_json) {
      return jsonResponse(JSON.parse(requestRow.result_json), allowOrigin, reqAllowHeaders);
    }
    const current = await readProductionMetafield(env, gid2, actor);
    let garmentCount = await productionGarmentCount(env, current);
    if (!("printEligibility" in patch) && "printedCount" in patch && patch.printedCount > garmentCount) {
      await db.prepare(`
              UPDATE mutation_requests
              SET state = 'failed', error_code = 'INVALID_PRINTED_COUNT', updated_at = ?
              WHERE id = ?
            `).bind(isoNow(), requestRow.id).run();
      return v1Error({
        code: "INVALID_PRINTED_COUNT",
        message: `Printed count cannot exceed the current printable piece count of ${garmentCount}.`
      }, allowOrigin, reqAllowHeaders, 400);
    }
    if (current.state.lastMutationId === requestRow.id) {
      const assets2 = await d1AssetsForOrder(env, shop.id, gid2);
      const production2 = productionForClient(gid2, current.state, current.compareDigest, assets2, garmentCount);
      const repaired = await d1FinalizeProductionMutation(
        env,
        shop.id,
        requestRow,
        gid2,
        current.state,
        current.compareDigest,
        production2,
        Object.keys(patch),
        current.order
      );
      return jsonResponse(repaired, allowOrigin, reqAllowHeaders);
    }
    if (current.state.revision !== expectedVersion) {
      return v1Error({
        code: "VERSION_CONFLICT",
        message: "Production metadata changed on another client."
      }, allowOrigin, reqAllowHeaders, 409, {
        currentVersion: current.state.revision,
        current: productionForClient(gid2, current.state, current.compareDigest, [], garmentCount)
      });
    }
    if ("artworkReferences" in patch) {
      const linkedAssets = await d1AssetsForOrder(env, shop.id, gid2);
      const validReferences = new Set(linkedAssets.filter((asset) => asset.role !== "mockup").map((asset) => `${asset.assetId}|${asset.side || ""}`));
      if (Object.keys(patch.artworkReferences).some((key2) => !validReferences.has(key2))) {
        return v1Error({
          code: "INVALID_ARTWORK_REFERENCE",
          message: "The design file is no longer attached to this order. Refresh the artwork before trying again."
        }, allowOrigin, reqAllowHeaders, 400);
      }
    }
    const nextState = applyProductionPatch(current.state, patch, actor, requestRow.id);
    garmentCount = validatePrintablePatch(current.countLineItems, current.state, patch, nextState);
    const saved = await setProductionMetafield(env, gid2, nextState, current.compareDigest);
    const assets = await d1AssetsForOrder(env, shop.id, gid2);
    const production = productionForClient(gid2, saved.state, saved.compareDigest, assets, garmentCount);
    try {
      const result = await d1FinalizeProductionMutation(
        env,
        shop.id,
        requestRow,
        gid2,
        saved.state,
        saved.compareDigest,
        production,
        Object.keys(patch),
        current.order
      );
      return jsonResponse(result, allowOrigin, reqAllowHeaders);
    } catch (error) {
      console.error("D1 finalization failed after Shopify production commit:", error.message);
      return jsonResponse({
        ok: true,
        canonicalSource: "shopify-app-owned-metafield",
        syncPending: true,
        production,
        warning: { code: "SYNC_PENDING", message: "Shopify saved the change; PrintMO is repairing its board projection." }
      }, allowOrigin, reqAllowHeaders, 202);
    }
  } catch (error) {
    return v1Error(error.body?.error || error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
  }
}
__name(handleV1ProductionPatch, "handleV1ProductionPatch");
var TULTEX_202_PRODUCT_GID = "gid://shopify/Product/8984050729208";
var SHELF_ORDER_QUERY = `query PrintMOShelfOrder($id: ID!, $after: String) {
  order(id: $id) { id cancelledAt lineItems(first: 100, after: $after) {
    nodes { id sku currentQuantity variant { id product { id } } }
    pageInfo { hasNextPage endCursor }
  } }
}`;
var SHELF_VARIANT_QUERY = `query PrintMOShelfVariant($id: ID!) {
  productVariant(id: $id) { id sku product { id } }
}`;
var SHELF_CATALOG_QUERY = `query PrintMOShelfCatalog($id: ID!, $after: String) {
  product(id: $id) { id title variants(first: 100, after: $after) {
    nodes { id sku title selectedOptions { name value } }
    pageInfo { hasNextPage endCursor }
  } }
}`;
var SHELF_ACCESS_QUERY = `query PrintMOShelfAccess {
  currentAppInstallation { accessScopes { handle } }
}`;
function shelfEnabled(env) {
  return env.SHELF_ALLOCATION_ENABLED === "1";
}
__name(shelfEnabled, "shelfEnabled");
function shelfActor(identity) {
  return `${identity?.kind || "unknown"}:${identity?.subject || "unknown"}`;
}
__name(shelfActor, "shelfActor");
function shelfValidKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,200}$/.test(value);
}
__name(shelfValidKey, "shelfValidKey");
function shelfVariantGid(value) {
  return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(value || "")) ? value : null;
}
__name(shelfVariantGid, "shelfVariantGid");
function shelfLineGid(value) {
  return /^gid:\/\/shopify\/LineItem\/\d+$/.test(String(value || "")) ? value : null;
}
__name(shelfLineGid, "shelfLineGid");
function shelfOrderId(request) {
  const part = new URL(request.url).pathname.split("/").at(-2);
  try {
    return canonicalOrderGid(decodeURIComponent(part));
  } catch {
    return null;
  }
}
__name(shelfOrderId, "shelfOrderId");
function shelfVariantId(request) {
  try {
    return shelfVariantGid(decodeURIComponent(new URL(request.url).pathname.split("/").at(-1)));
  } catch {
    return null;
  }
}
__name(shelfVariantId, "shelfVariantId");
async function shelfLiveOrder(env, orderGid, graphQL = coordinatorGraphQL) {
  const lines = [];
  let missingVariant = false;
  let after = null;
  let cancelledAt = null;
  for (let page = 0; page < 10; page++) {
    const result = await graphQL(env, SHELF_ORDER_QUERY, { id: orderGid, after }, "PrintMOShelfOrder");
    const order = requireShopifyData(result, "PrintMOShelfOrder").order;
    if (!order || order.id !== orderGid) throw Object.assign(new Error("Order not found"), { code: "ORDER_NOT_FOUND", status: 404 });
    cancelledAt = order.cancelledAt;
    const connection = order.lineItems;
    if (!connection || !Array.isArray(connection.nodes)) throw Object.assign(new Error("Incomplete order"), { code: "ORDER_LINES_UNVERIFIED", status: 409 });
    missingVariant ||= connection.nodes.some((line) => line?.sku && !line?.variant);
    lines.push(...connection.nodes.filter((line) => line?.variant?.product?.id === TULTEX_202_PRODUCT_GID).map((line) => ({
      lineItemId: line.id,
      variantId: line.variant.id,
      sku: line.sku,
      quantity: Number(line.currentQuantity)
    })));
    if (!connection.pageInfo?.hasNextPage) {
      if (!lines.length && missingVariant) {
        const access = requireShopifyData(await graphQL(env, SHELF_ACCESS_QUERY, {}, "PrintMOShelfAccess"), "PrintMOShelfAccess");
        if (!access.currentAppInstallation?.accessScopes?.some((scope) => scope.handle === "read_products"))
          throw Object.assign(
            new Error("Shelf allocation needs product read access. An owner must approve the updated Print-MO Order Manager permissions in Shopify."),
            { code: "SHELF_PRODUCT_ACCESS_REQUIRED", status: 503 }
          );
      }
      return { cancelledAt, lines };
    }
    after = connection.pageInfo.endCursor;
    if (!after) break;
  }
  throw Object.assign(new Error("Order lines require pagination"), { code: "ORDER_LINES_UNVERIFIED", status: 409 });
}
__name(shelfLiveOrder, "shelfLiveOrder");
async function shelfOrderSnapshot(env, shopId, orderGid, live) {
  const db = requireOrderDb(env);
  const [stock, claims, projection, batch] = await Promise.all([
    db.prepare("SELECT variant_gid, sku, available, on_shelf, version, counted_at FROM shelf_stock WHERE shop_id = ?").bind(shopId).all(),
    db.prepare("SELECT line_item_gid, variant_gid, sku, qty, pulled_qty, version FROM shelf_claims WHERE shop_id = ? AND order_gid = ?").bind(shopId, orderGid).all(),
    db.prepare("SELECT active, stage FROM order_projection WHERE shop_id = ? AND order_gid = ?").bind(shopId, orderGid).first(),
    db.prepare(`SELECT 1 AS found FROM batch_orders bo JOIN batches b ON b.id = bo.batch_id
            WHERE b.shop_id = ? AND bo.order_gid = ? AND b.state IN ('prepared','submitting','confirmed','unknown') LIMIT 1`).bind(shopId, orderGid).first()
  ]);
  const stockByVariant = new Map((stock.results || []).map((row) => [row.variant_gid, row]));
  const claimByLine = new Map((claims.results || []).map((row) => [row.line_item_gid, row]));
  const liveLineIds = new Set(live.lines.map((line) => line.lineItemId));
  const orphanedClaim = (claims.results || []).some((row) => row.qty > 0 && !liveLineIds.has(row.line_item_gid));
  return {
    orderId: orderGid,
    cancelled: Boolean(live.cancelledAt),
    locked: (!projection?.active || !["received", "to_order"].includes(projection?.stage)) && !live.cancelledAt || Boolean(batch),
    needsReview: orphanedClaim || live.lines.some((line) => {
      const held = claimByLine.get(line.lineItemId);
      return Boolean(held && (held.variant_gid !== line.variantId || held.sku !== line.sku || held.qty > line.quantity));
    }),
    lines: live.lines.map((line) => {
      const held = claimByLine.get(line.lineItemId);
      const counted = stockByVariant.get(line.variantId);
      return {
        ...line,
        available: counted?.available ?? null,
        onShelf: counted?.on_shelf ?? null,
        stockVersion: counted?.version ?? -1,
        countedAt: counted?.counted_at || null,
        claimed: held?.qty || 0,
        reserved: (held?.qty || 0) - (held?.pulled_qty || 0),
        pulled: held?.pulled_qty || 0,
        claimVersion: held?.version ?? -1,
        supplierNeeded: Math.max(0, line.quantity - (held?.qty || 0)),
        needsReview: Boolean(held && (held.variant_gid !== line.variantId || held.sku !== line.sku || held.qty > line.quantity))
      };
    })
  };
}
__name(shelfOrderSnapshot, "shelfOrderSnapshot");
async function shelfVerifiedVariant(env, variantId) {
  const result = await coordinatorGraphQL(env, SHELF_VARIANT_QUERY, { id: variantId }, "PrintMOShelfVariant");
  const variant = requireShopifyData(result, "PrintMOShelfVariant").productVariant;
  if (!variant || variant.id !== variantId || variant.product?.id !== TULTEX_202_PRODUCT_GID || !variant.sku)
    throw Object.assign(new Error("Only exact Tultex 202 variants can be counted."), { code: "NOT_TULTEX_202", status: 409 });
  return variant;
}
__name(shelfVerifiedVariant, "shelfVerifiedVariant");
async function handleShelfInventory(request, env, allowOrigin, reqAllowHeaders) {
  if (!shelfEnabled(env)) return v1Error({ code: "SHELF_DISABLED", message: "Shelf inventory is disabled." }, allowOrigin, reqAllowHeaders, 404);
  try {
    const variants = [];
    let after = null;
    let productTitle = "";
    let complete = false;
    for (let page = 0; page < 10; page++) {
      const result = await coordinatorGraphQL(
        env,
        SHELF_CATALOG_QUERY,
        { id: TULTEX_202_PRODUCT_GID, after },
        "PrintMOShelfCatalog"
      );
      const product = requireShopifyData(result, "PrintMOShelfCatalog").product;
      if (!product || product.id !== TULTEX_202_PRODUCT_GID || !Array.isArray(product.variants?.nodes))
        throw Object.assign(new Error("Tultex 202 catalog is incomplete."), { code: "SHELF_CATALOG_UNVERIFIED", status: 409 });
      productTitle = product.title;
      variants.push(...product.variants.nodes);
      if (!product.variants.pageInfo?.hasNextPage) {
        complete = true;
        break;
      }
      after = product.variants.pageInfo.endCursor;
      if (!after) break;
    }
    if (!complete) throw Object.assign(
      new Error("Tultex 202 catalog needs more pages."),
      { code: "SHELF_CATALOG_UNVERIFIED", status: 409 }
    );
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const [stock, pending] = await Promise.all([
      db.prepare("SELECT variant_gid, sku, on_shelf, available, version, counted_at FROM shelf_stock WHERE shop_id = ?").bind(shop.id).all(),
      db.prepare(`SELECT c.order_gid, c.line_item_gid, c.variant_gid, c.sku, c.qty, c.pulled_qty, c.version,
                p.commerce_json, p.active, p.stage FROM shelf_claims c
                LEFT JOIN order_projection p ON p.shop_id = c.shop_id AND p.order_gid = c.order_gid
                WHERE c.shop_id = ? AND c.qty > c.pulled_qty ORDER BY c.updated_at DESC`).bind(shop.id).all()
    ]);
    const stockByVariant = new Map((stock.results || []).map((row) => [row.variant_gid, row]));
    const catalog = variants.filter((variant) => variant?.id && variant.sku).map((variant) => {
      const row = stockByVariant.get(variant.id);
      return {
        variantId: variant.id,
        sku: variant.sku,
        title: variant.title,
        selectedOptions: variant.selectedOptions || [],
        onShelf: row?.on_shelf ?? null,
        available: row?.available ?? null,
        stockVersion: row?.version ?? -1,
        countedAt: row?.counted_at || null
      };
    });
    const ids = new Set(catalog.map((item) => item.variantId));
    const toPull = (pending.results || []).filter((row) => ids.has(row.variant_gid)).map((row) => {
      let summary;
      try {
        summary = JSON.parse(row.commerce_json || "{}");
      } catch {
        summary = null;
      }
      return {
        orderId: row.order_gid,
        orderName: summary?.displayName || "Shopify order",
        lineItemId: row.line_item_gid,
        variantId: row.variant_gid,
        sku: row.sku,
        reserved: row.qty - row.pulled_qty,
        pulled: row.pulled_qty,
        claimVersion: row.version,
        active: Boolean(row.active),
        stage: row.stage || null
      };
    });
    return jsonResponse({ product: productTitle, variants: catalog, toPull }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(
      { code: error.code || "SHELF_INVENTORY_FAILED", message: error.message },
      allowOrigin,
      reqAllowHeaders,
      error.status || 500
    );
  }
}
__name(handleShelfInventory, "handleShelfInventory");
async function shelfReplay(db, shopId, key2, fingerprint) {
  const old = await db.prepare("SELECT fingerprint FROM shelf_operations WHERE shop_id = ? AND idempotency_key = ?").bind(shopId, key2).first();
  if (!old) return false;
  if (old.fingerprint !== fingerprint) throw Object.assign(new Error("Idempotency key was reused"), { code: "SHELF_IDEMPOTENCY_CONFLICT", status: 409 });
  return true;
}
__name(shelfReplay, "shelfReplay");
async function handleShelfCount(request, env, allowOrigin, reqAllowHeaders, identity) {
  if (!shelfEnabled(env)) return v1Error({ code: "SHELF_DISABLED", message: "Shelf allocation is disabled." }, allowOrigin, reqAllowHeaders, 404);
  try {
    const variantId = shelfVariantId(request);
    const body = await request.json().catch(() => ({}));
    const qty = body.onShelf;
    const expected = body.expectedVersion;
    const key2 = body.idempotencyKey;
    const reason = String(body.reason || "").trim();
    if (!variantId || !Number.isSafeInteger(qty) || qty < 0 || qty > 1e5 || !Number.isSafeInteger(expected) || expected < -1 || !shelfValidKey(key2) || !reason || reason.length > 240)
      return v1Error({ code: "INVALID_SHELF_COUNT", message: "Enter the physical on-shelf quantity and a reason." }, allowOrigin, reqAllowHeaders, 400);
    const variant = await shelfVerifiedVariant(env, variantId);
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const fingerprint = JSON.stringify(["count", variantId, qty, expected, reason]);
    if (await shelfReplay(db, shop.id, key2, fingerprint))
      return jsonResponse({ ok: true, replayed: true }, allowOrigin, reqAllowHeaders);
    const existing = await db.prepare("SELECT version FROM shelf_stock WHERE shop_id = ? AND variant_gid = ?").bind(shop.id, variantId).first();
    if ((existing?.version ?? -1) !== expected)
      return v1Error({ code: "SHELF_VERSION_CONFLICT", message: "Shelf count changed. Refresh before saving." }, allowOrigin, reqAllowHeaders, 409);
    const reserved = await db.prepare("SELECT COALESCE(SUM(qty - pulled_qty), 0) AS units FROM shelf_claims WHERE shop_id = ? AND variant_gid = ?").bind(shop.id, variantId).first();
    if (qty < Number(reserved?.units || 0))
      return v1Error(
        {
          code: "SHELF_COUNT_BELOW_RESERVED",
          message: "The physical shelf count is below units reserved for orders. Review those reservations first."
        },
        allowOrigin,
        reqAllowHeaders,
        409
      );
    const now = isoNow();
    const mutationKey = `count:${key2}`;
    try {
      await db.batch([
        db.prepare(`INSERT INTO shelf_stock (shop_id, variant_gid, sku, available, on_shelf, version, counted_at, updated_at, updated_by, mutation_key, reason)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
                    ON CONFLICT(shop_id, variant_gid) DO UPDATE SET on_shelf = excluded.on_shelf,
                    available = excluded.on_shelf - COALESCE((SELECT SUM(qty - pulled_qty) FROM shelf_claims
                        WHERE shop_id = excluded.shop_id AND variant_gid = excluded.variant_gid), 0),
                    version = shelf_stock.version + 1, counted_at = excluded.counted_at, updated_at = excluded.updated_at,
                    updated_by = excluded.updated_by, mutation_key = excluded.mutation_key, reason = excluded.reason
                    WHERE shelf_stock.version = ? AND shelf_stock.sku = excluded.sku`).bind(shop.id, variantId, variant.sku, qty, qty, now, now, shelfActor(identity), mutationKey, reason, expected),
        db.prepare("INSERT INTO shelf_operations VALUES (?, ?, ?, changes(), ?)").bind(shop.id, key2, fingerprint, now)
      ]);
    } catch (error) {
      if (await shelfReplay(db, shop.id, key2, fingerprint))
        return jsonResponse({ ok: true, replayed: true }, allowOrigin, reqAllowHeaders);
      const belowReserved = /SHELF_COUNT_INCONSISTENT|CHECK constraint failed/.test(String(error?.message || ""));
      return v1Error(
        {
          code: belowReserved ? "SHELF_COUNT_BELOW_RESERVED" : "SHELF_VERSION_CONFLICT",
          message: belowReserved ? "Shelf count is below reserved units. Refresh and review reservations." : "Shelf count changed. Refresh before saving."
        },
        allowOrigin,
        reqAllowHeaders,
        409
      );
    }
    const current = await db.prepare("SELECT on_shelf AS onShelf, available, version, counted_at FROM shelf_stock WHERE shop_id = ? AND variant_gid = ?").bind(shop.id, variantId).first();
    return jsonResponse({ ok: true, variantId, ...current }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error({ code: error.code || "SHELF_COUNT_FAILED", message: error.message }, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleShelfCount, "handleShelfCount");
async function handleShelfReceive(request, env, allowOrigin, reqAllowHeaders, identity) {
  if (!shelfEnabled(env)) return v1Error({ code: "SHELF_DISABLED", message: "Shelf inventory is disabled." }, allowOrigin, reqAllowHeaders, 404);
  try {
    const variantId = shelfVariantId(request);
    const body = await request.json().catch(() => ({}));
    const qty = body.qty;
    const expected = body.expectedVersion;
    const key2 = body.idempotencyKey;
    if (!variantId || !Number.isSafeInteger(qty) || qty < 1 || qty > 1e5 || !Number.isSafeInteger(expected) || expected < 0 || !shelfValidKey(key2))
      return v1Error(
        { code: "INVALID_SHELF_RECEIPT", message: "Enter a positive whole number of received units." },
        allowOrigin,
        reqAllowHeaders,
        400
      );
    const variant = await shelfVerifiedVariant(env, variantId);
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const fingerprint = JSON.stringify(["receive", variantId, qty, expected]);
    if (await shelfReplay(db, shop.id, key2, fingerprint))
      return jsonResponse({ ok: true, replayed: true }, allowOrigin, reqAllowHeaders);
    const now = isoNow();
    try {
      await db.batch([
        db.prepare(`UPDATE shelf_stock SET on_shelf = on_shelf + ?, available = available + ?,
                    version = version + 1, updated_at = ?, updated_by = ?, mutation_key = ?, reason = 'Received stock'
                    WHERE shop_id = ? AND variant_gid = ? AND sku = ? AND version = ?`).bind(qty, qty, now, shelfActor(identity), `receive:${key2}`, shop.id, variantId, variant.sku, expected),
        db.prepare("INSERT INTO shelf_operations VALUES (?, ?, ?, changes(), ?)").bind(shop.id, key2, fingerprint, now)
      ]);
    } catch (error) {
      if (await shelfReplay(db, shop.id, key2, fingerprint))
        return jsonResponse({ ok: true, replayed: true }, allowOrigin, reqAllowHeaders);
      return v1Error(
        { code: "SHELF_VERSION_CONFLICT", message: "Shelf stock changed. Refresh before receiving." },
        allowOrigin,
        reqAllowHeaders,
        409
      );
    }
    return jsonResponse({ ok: true }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(
      { code: error.code || "SHELF_RECEIVE_FAILED", message: error.message },
      allowOrigin,
      reqAllowHeaders,
      error.status || 500
    );
  }
}
__name(handleShelfReceive, "handleShelfReceive");
async function handleShelfOrder(request, env, allowOrigin, reqAllowHeaders, identity) {
  if (!shelfEnabled(env)) return v1Error({ code: "SHELF_DISABLED", message: "Shelf allocation is disabled." }, allowOrigin, reqAllowHeaders, 404);
  try {
    const orderGid = shelfOrderId(request);
    if (!orderGid) return v1Error({ code: "INVALID_ORDER", message: "Invalid Shopify order." }, allowOrigin, reqAllowHeaders, 400);
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const live = await shelfLiveOrder(env, orderGid);
    if (request.method === "GET")
      return jsonResponse(await shelfOrderSnapshot(env, shop.id, orderGid, live), allowOrigin, reqAllowHeaders);
    const body = await request.json().catch(() => ({}));
    const lineId = shelfLineGid(body.lineItemId);
    if (request.method === "PATCH")
      return handleShelfPull(env, allowOrigin, reqAllowHeaders, identity, shop.id, orderGid, live, lineId, body);
    const qty = body.qty;
    const expected = body.expectedVersion;
    const key2 = body.idempotencyKey;
    if (!lineId || !Number.isSafeInteger(qty) || qty < 0 || !Number.isSafeInteger(expected) || expected < -1 || !shelfValidKey(key2))
      return v1Error({ code: "INVALID_SHELF_CLAIM", message: "Choose a valid line and quantity." }, allowOrigin, reqAllowHeaders, 400);
    const line = live.lines.find((candidate) => candidate.lineItemId === lineId);
    if (!line || !line.sku || !Number.isSafeInteger(line.quantity))
      return v1Error({ code: "NOT_TULTEX_202", message: "Only exact Tultex 202 order lines can use shelf stock." }, allowOrigin, reqAllowHeaders, 409);
    const fingerprint = JSON.stringify(["claim", orderGid, lineId, line.variantId, qty, expected]);
    if (await shelfReplay(db, shop.id, key2, fingerprint))
      return jsonResponse({ ok: true, replayed: true, ...await shelfOrderSnapshot(env, shop.id, orderGid, live) }, allowOrigin, reqAllowHeaders);
    const old = await db.prepare("SELECT qty, pulled_qty, version FROM shelf_claims WHERE shop_id = ? AND order_gid = ? AND line_item_gid = ?").bind(shop.id, orderGid, lineId).first();
    const releasing = Boolean(old && qty < old.qty);
    if (old && qty < old.pulled_qty)
      return v1Error(
        {
          code: "SHELF_ALREADY_PULLED",
          message: "Return pulled units to the shelf before releasing this reservation."
        },
        allowOrigin,
        reqAllowHeaders,
        409
      );
    if (qty > line.quantity && !releasing || live.cancelledAt && qty > (old?.qty || 0) || (old?.version ?? -1) !== expected || !old && qty === 0)
      return v1Error({ code: "SHELF_CLAIM_CONFLICT", message: "Order or claim changed. Refresh before saving." }, allowOrigin, reqAllowHeaders, 409);
    if (old?.qty === qty)
      return jsonResponse({ ok: true, unchanged: true, ...await shelfOrderSnapshot(env, shop.id, orderGid, live) }, allowOrigin, reqAllowHeaders);
    const projection = await db.prepare("SELECT active, stage, commerce_json FROM order_projection WHERE shop_id = ? AND order_gid = ?").bind(shop.id, orderGid).first();
    const batch = await db.prepare(`SELECT 1 AS found FROM batch_orders bo JOIN batches b ON b.id = bo.batch_id
            WHERE b.shop_id = ? AND bo.order_gid = ? AND b.state IN ('prepared','submitting','confirmed','unknown') LIMIT 1`).bind(shop.id, orderGid).first();
    if ((!projection?.active || !["received", "to_order"].includes(projection?.stage)) && !(releasing && live.cancelledAt) || batch)
      return v1Error({ code: "SHELF_ORDER_LOCKED", message: "This order has entered supplier purchasing or production." }, allowOrigin, reqAllowHeaders, 409);
    let summary;
    try {
      summary = JSON.parse(projection.commerce_json || "{}");
    } catch {
      summary = null;
    }
    if (!releasing && (summary?.commerce?.lineItemsComplete !== true || !summary.commerce.lineItems.some((item) => item.id === lineId && item.sku === line.sku && Number(item.currentQuantity ?? item.quantity) === line.quantity)))
      return v1Error({ code: "SHELF_ORDER_STALE", message: "Refresh the order before assigning shelf stock." }, allowOrigin, reqAllowHeaders, 409);
    const stock = await db.prepare("SELECT available FROM shelf_stock WHERE shop_id = ? AND variant_gid = ?").bind(shop.id, line.variantId).first();
    if (!stock) return v1Error({ code: "SHELF_UNCOUNTED", message: "Count the free shelf stock first." }, allowOrigin, reqAllowHeaders, 409);
    const now = isoNow();
    try {
      await db.batch([
        db.prepare(`INSERT INTO shelf_claims (shop_id, order_gid, line_item_gid, variant_gid, sku, qty, version, updated_at, updated_by, mutation_key)
                    SELECT ?, ?, ?, ?, ?, ?, 0, ?, ?, ? WHERE ? = -1 OR EXISTS (
                        SELECT 1 FROM shelf_claims WHERE shop_id = ? AND order_gid = ? AND line_item_gid = ? AND version = ?)
                    ON CONFLICT(shop_id, order_gid, line_item_gid) DO UPDATE SET qty = excluded.qty,
                    version = shelf_claims.version + 1, updated_at = excluded.updated_at,
                    updated_by = excluded.updated_by, mutation_key = excluded.mutation_key
                    WHERE shelf_claims.version = ?`).bind(
          shop.id,
          orderGid,
          lineId,
          line.variantId,
          line.sku,
          qty,
          now,
          shelfActor(identity),
          `claim:${key2}`,
          expected,
          shop.id,
          orderGid,
          lineId,
          expected,
          expected
        ),
        db.prepare(`INSERT INTO shelf_operations
                    SELECT ?, ?, ?, changes() * CASE WHEN NOT EXISTS (
                        SELECT 1 FROM batch_orders bo JOIN batches b ON b.id = bo.batch_id
                        WHERE b.shop_id = ? AND bo.order_gid = ?
                        AND b.state IN ('prepared','submitting','confirmed','unknown')
                    ) THEN 1 ELSE 0 END, ?`).bind(shop.id, key2, fingerprint, shop.id, orderGid, now)
      ]);
    } catch (error) {
      if (await shelfReplay(db, shop.id, key2, fingerprint))
        return jsonResponse({ ok: true, replayed: true, ...await shelfOrderSnapshot(env, shop.id, orderGid, live) }, allowOrigin, reqAllowHeaders);
      const insufficient = String(error?.message || "").includes("SHELF_STOCK_INSUFFICIENT");
      return v1Error(
        {
          code: insufficient ? "SHELF_STOCK_INSUFFICIENT" : "SHELF_CLAIM_CONFLICT",
          message: insufficient ? "Not enough free shelf stock remains." : "Shelf claim changed. Refresh before saving."
        },
        allowOrigin,
        reqAllowHeaders,
        409
      );
    }
    return jsonResponse({ ok: true, ...await shelfOrderSnapshot(env, shop.id, orderGid, live) }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error({ code: error.code || "SHELF_CLAIM_FAILED", message: error.message }, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleShelfOrder, "handleShelfOrder");
async function handleShelfPull(env, allowOrigin, reqAllowHeaders, identity, shopId, orderGid, live, lineId, body) {
  const pulledQty = body.pulledQty;
  const expected = body.expectedVersion;
  const key2 = body.idempotencyKey;
  if (!lineId || !Number.isSafeInteger(pulledQty) || pulledQty < 0 || !Number.isSafeInteger(expected) || expected < 0 || !shelfValidKey(key2))
    return v1Error(
      { code: "INVALID_SHELF_PULL", message: "Choose a reserved line and a valid pulled quantity." },
      allowOrigin,
      reqAllowHeaders,
      400
    );
  const db = requireOrderDb(env);
  const line = live.lines.find((candidate) => candidate.lineItemId === lineId);
  if (!line) return v1Error(
    { code: "NOT_TULTEX_202", message: "This is not a current Tultex 202 order line." },
    allowOrigin,
    reqAllowHeaders,
    409
  );
  const fingerprint = JSON.stringify(["pull", orderGid, lineId, pulledQty, expected]);
  if (await shelfReplay(db, shopId, key2, fingerprint))
    return jsonResponse(
      { ok: true, replayed: true, ...await shelfOrderSnapshot(env, shopId, orderGid, live) },
      allowOrigin,
      reqAllowHeaders
    );
  const claim = await db.prepare(`SELECT variant_gid, sku, qty, pulled_qty, version FROM shelf_claims
        WHERE shop_id = ? AND order_gid = ? AND line_item_gid = ?`).bind(shopId, orderGid, lineId).first();
  if (!claim || claim.variant_gid !== line.variantId || claim.sku !== line.sku || claim.version !== expected || pulledQty > claim.qty)
    return v1Error(
      { code: "SHELF_PULL_CONFLICT", message: "Reservation changed. Refresh before updating the pull." },
      allowOrigin,
      reqAllowHeaders,
      409
    );
  if (pulledQty === claim.pulled_qty)
    return jsonResponse(
      { ok: true, unchanged: true, ...await shelfOrderSnapshot(env, shopId, orderGid, live) },
      allowOrigin,
      reqAllowHeaders
    );
  const increasing = pulledQty > claim.pulled_qty;
  const projection = increasing ? await db.prepare("SELECT active FROM order_projection WHERE shop_id = ? AND order_gid = ?").bind(shopId, orderGid).first() : null;
  if (increasing && (body.physicallyPulled !== true || live.cancelledAt || !projection?.active || claim.qty > line.quantity))
    return v1Error(
      {
        code: "SHELF_PULL_CONFLICT",
        message: "Confirm the blanks were physically pulled and the order still needs them."
      },
      allowOrigin,
      reqAllowHeaders,
      409
    );
  if (!increasing && body.returnedToShelf !== true)
    return v1Error(
      {
        code: "SHELF_RETURN_UNCONFIRMED",
        message: "Confirm the blanks are physically back on the shelf before recording a return."
      },
      allowOrigin,
      reqAllowHeaders,
      409
    );
  const now = isoNow();
  try {
    await db.batch([
      db.prepare(`UPDATE shelf_claims SET pulled_qty = ?, version = version + 1,
                updated_at = ?, updated_by = ?, mutation_key = ?
                WHERE shop_id = ? AND order_gid = ? AND line_item_gid = ? AND version = ? AND qty = ?`).bind(
        pulledQty,
        now,
        shelfActor(identity),
        `${increasing ? "pull" : "return"}:${key2}`,
        shopId,
        orderGid,
        lineId,
        expected,
        claim.qty
      ),
      db.prepare("INSERT INTO shelf_operations VALUES (?, ?, ?, changes(), ?)").bind(shopId, key2, fingerprint, now)
    ]);
  } catch (error) {
    if (await shelfReplay(db, shopId, key2, fingerprint))
      return jsonResponse(
        { ok: true, replayed: true, ...await shelfOrderSnapshot(env, shopId, orderGid, live) },
        allowOrigin,
        reqAllowHeaders
      );
    const insufficient = String(error?.message || "").includes("SHELF_PHYSICAL_INSUFFICIENT");
    return v1Error(
      {
        code: insufficient ? "SHELF_PHYSICAL_INSUFFICIENT" : "SHELF_PULL_CONFLICT",
        message: insufficient ? "The physical shelf count is too low. Recount this variant before pulling." : "Reservation changed. Refresh before updating the pull."
      },
      allowOrigin,
      reqAllowHeaders,
      409
    );
  }
  return jsonResponse(
    { ok: true, ...await shelfOrderSnapshot(env, shopId, orderGid, live) },
    allowOrigin,
    reqAllowHeaders
  );
}
__name(handleShelfPull, "handleShelfPull");
function supplierSourcesWithShelfClaims(rows, claims = []) {
  const held = new Map(claims.filter((claim) => claim.qty > 0).map((claim) => [`${claim.order_gid}|${claim.line_item_gid}`, claim]));
  const seen = /* @__PURE__ */ new Set();
  const sources = [];
  for (const row of rows) {
    let summary;
    try {
      summary = JSON.parse(row.commerce_json || "{}");
    } catch (_) {
      summary = {};
    }
    if (summary?.commerce?.lineItemsComplete !== true)
      throw Object.assign(new Error("Current order lines are incomplete. Refresh before submitting garments."), { code: "BATCH_ORDER_LINES_INCOMPLETE", status: 409 });
    const orderName = String(summary?.displayName || row.order_gid || "").trim();
    for (const item of summary?.commerce?.lineItems || []) {
      if (PRINT_TITLES.has(item?.title) || isSupplierService(item)) continue;
      const sku = String(item?.sku || "").trim();
      const total = Number(item?.currentQuantity ?? item?.quantity ?? 0);
      const claimKey = `${row.order_gid}|${item?.id}`;
      const claim = held.get(claimKey);
      if (claim) seen.add(claimKey);
      if (claim && (claim.sku !== sku || claim.variant_gid !== item?.variantId || !Number.isSafeInteger(total) || total < claim.qty))
        throw Object.assign(new Error("Shelf claim no longer matches the order"), { code: "SHELF_ORDER_STALE", status: 409 });
      const qty = total - (claim?.qty || 0);
      if (!sku || !Number.isSafeInteger(qty) || qty <= 0) continue;
      sources.push({
        orderId: row.order_gid,
        orderName,
        lineItemId: String(item?.id || "").trim() || null,
        sku,
        title: String(item?.title || "Garment").trim().slice(0, 160),
        variantTitle: String(item?.variantTitle || "").trim().slice(0, 160),
        qty
      });
    }
  }
  if (seen.size !== held.size)
    throw Object.assign(new Error("Shelf claim line is missing"), { code: "SHELF_ORDER_STALE", status: 409 });
  return sources;
}
__name(supplierSourcesWithShelfClaims, "supplierSourcesWithShelfClaims");
function supplierLinesFromProjectionRows(rows, claims = []) {
  const aggregate = /* @__PURE__ */ new Map();
  for (const source of supplierSourcesWithShelfClaims(rows, claims))
    aggregate.set(source.sku, (aggregate.get(source.sku) || 0) + source.qty);
  return [...aggregate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([sku, qty]) => ({ sku, qty }));
}
__name(supplierLinesFromProjectionRows, "supplierLinesFromProjectionRows");
async function confirmedBatchProductionUpdate(env, shop, row, batchId, poNumber, actor, graphQL = coordinatorGraphQL) {
  const current = await readProductionMetafield(env, row.order_gid, actor, graphQL);
  if (current.state.batchRefs.includes(poNumber) && ["blanks_cart", "blanks_ordered", "print", "completed"].includes(current.state.stage)) {
    await d1ProjectionUpsert(env, shop.id, row.order_gid, current.state, current.compareDigest, void 0, current.order);
    return { repaired: false, revision: current.state.revision };
  }
  const next = normalizeProductionState(current.state, actor);
  next.stage = "blanks_cart";
  next.readiness.blanksOrdered = false;
  next.batchRefs = [.../* @__PURE__ */ new Set([...next.batchRefs, poNumber])].slice(0, 100);
  next.revision = current.state.revision + 1;
  next.lastMutationId = `batch:${batchId}`;
  next.updatedAt = isoNow();
  next.updatedBy = actor;
  const saved = await setProductionMetafield(env, row.order_gid, next, current.compareDigest, graphQL);
  await d1ProjectionUpsert(env, shop.id, row.order_gid, saved.state, saved.compareDigest, void 0, current.order);
  return { repaired: true, revision: saved.state.revision };
}
__name(confirmedBatchProductionUpdate, "confirmedBatchProductionUpdate");
async function handleV1BatchCommit(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const body = await request.json().catch(() => ({}));
    const gids = [...new Set((body.orderIds || []).map(canonicalOrderGid).filter(Boolean))];
    if (!gids.length || gids.length > 50) {
      return v1Error({
        code: "INVALID_BATCH_ORDERS",
        message: "Select between 1 and 50 Shopify orders."
      }, allowOrigin, reqAllowHeaders, 400);
    }
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
      return v1Error({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "A valid idempotency key is required."
      }, allowOrigin, reqAllowHeaders, 400);
    }
    const actor = `${identity?.kind || "unknown"}:${identity?.subject || "unknown"}`;
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const placeholders = gids.map(() => "?").join(",");
    const query = await db.prepare(`
          SELECT order_gid, production_revision, production_json, commerce_json
          FROM order_projection
          WHERE shop_id = ? AND active = 1 AND order_gid IN (${placeholders})
        `).bind(shop.id, ...gids).all();
    const rows = query.results || [];
    if (rows.length !== gids.length) {
      return v1Error({
        code: "BATCH_ORDER_MISSING",
        message: "One or more selected orders are not available in the Shopify board."
      }, allowOrigin, reqAllowHeaders, 409);
    }
    for (const row of rows) {
      const production = normalizeProductionState(JSON.parse(row.production_json || "{}"), actor);
      if (!["to_order", "blanks_cart"].includes(production.stage)) {
        return v1Error({
          code: "INVALID_BATCH_STAGE",
          message: "Every selected order must be in Create blanks order or Blanks cart."
        }, allowOrigin, reqAllowHeaders, 409);
      }
    }
    const claimedRows = await db.prepare(`SELECT order_gid, line_item_gid, variant_gid, sku, qty FROM shelf_claims
            WHERE shop_id = ? AND qty > 0 AND order_gid IN (${placeholders})`).bind(shop.id, ...gids).all();
    const claims = claimedRows.results || [];
    for (const gid2 of new Set(claims.map((claim) => claim.order_gid))) {
      const live = await shelfLiveOrder(env, gid2);
      const row = rows.find((candidate) => candidate.order_gid === gid2);
      let commerce;
      try {
        commerce = JSON.parse(row?.commerce_json || "{}")?.commerce;
      } catch {
        commerce = null;
      }
      if (live.cancelledAt || claims.filter((claim) => claim.order_gid === gid2).some((claim) => {
        const line = live.lines.find((item) => item.lineItemId === claim.line_item_gid);
        const projected = commerce?.lineItems?.find((item) => item.id === claim.line_item_gid);
        return commerce?.lineItemsComplete !== true || !line || !projected || line.variantId !== claim.variant_gid || line.sku !== claim.sku || line.quantity !== Number(projected.currentQuantity ?? projected.quantity) || line.quantity < claim.qty;
      })) return v1Error(
        {
          code: "SHELF_ORDER_STALE",
          message: "A shelf claim no longer matches its live Shopify order. Review it before supplier submission."
        },
        allowOrigin,
        reqAllowHeaders,
        409
      );
    }
    const lines = supplierLinesFromProjectionRows(rows, claims);
    const lineSources = supplierLineSourcesFromProjectionRows(rows, claims);
    const operation = "order_placement";
    const testOrder = env.SS_TEST_ORDER !== "0";
    const excludedLines = supplierExcludedServices(rows.map((row) => JSON.parse(row.commerce_json || "{}")?.commerce?.lineItems || []));
    if (gids.some((gid2) => claims.some((claim) => claim.order_gid === gid2) && !lineSources.some((source) => source.orderId === gid2))) {
      return v1Error(
        {
          code: "SHELF_FULLY_CLAIMED",
          message: "Remove orders fully covered by shelf stock from this S&S batch and mark their blanks ready explicitly."
        },
        allowOrigin,
        reqAllowHeaders,
        409
      );
    }
    if (!lines.length) {
      return v1Error({
        code: "BATCH_HAS_NO_SUPPLIER_SKUS",
        message: "The selected orders do not contain purchasable garment SKUs."
      }, allowOrigin, reqAllowHeaders, 400);
    }
    const lineHash = bytesToHex(await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(lines))
    ));
    const batchId = `ssb-${await stableAssetId(`${shop.shop_domain}:${actor}:${idempotencyKey}`)}`;
    const poNumber = `PM-${batchId.slice(-12).toUpperCase()}`;
    const now = isoNow();
    const requestJson = JSON.stringify({ orderIds: gids, lines, lineSources, orderCount: gids.length, provider: "shopify", operation, testOrder, excludedLines });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1e3).toISOString();
    await db.prepare(`
          INSERT INTO batches (
            id, shop_id, po_number, state, line_hash, request_json, expires_at,
            created_by, created_at, updated_at
          ) VALUES (?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).bind(batchId, shop.id, poNumber, lineHash, requestJson, expiresAt, actor, now, now).run();
    const batch = await db.prepare("SELECT * FROM batches WHERE id = ? AND shop_id = ?").bind(batchId, shop.id).first();
    if (!batch || batch.line_hash !== lineHash || batch.request_json !== requestJson) {
      return v1Error({
        code: "BATCH_IDEMPOTENCY_CONFLICT",
        message: "This batch key was already used for different orders."
      }, allowOrigin, reqAllowHeaders, 409);
    }
    if (batch.state === "confirmed") {
      const confirmed = JSON.parse(batch.response_json || '{"ok":true,"outcome":"confirmed"}');
      return jsonResponse({ ...confirmed, submissionAction: "replayed", supplierRequestSent: false }, allowOrigin, reqAllowHeaders, confirmed.outcome === "partial" ? 207 : 200);
    }
    if (batch.state === "failed") {
      const failed = JSON.parse(batch.response_json || "{}");
      return v1Error({
        code: failed.preflightFailed ? "SUPPLIER_PREFLIGHT_FAILED" : "SUPPLIER_REJECTED",
        message: failed.summary || "S&S rejected this submission."
      }, allowOrigin, reqAllowHeaders, failed.preflightFailed ? 424 : 422, { report: { ...failed, submissionAction: "saved", supplierRequestSent: false } });
    }
    if (["submitting", "unknown"].includes(batch.state)) {
      return v1Error({
        code: "BATCH_RECONCILIATION_REQUIRED",
        message: "This batch may already have reached S&S and must be reconciled before retrying."
      }, allowOrigin, reqAllowHeaders, 409, { report: {
        ...JSON.parse(batch.response_json || "{}"),
        batchId,
        submissionAction: "blocked",
        supplierRequestSent: false,
        actionMessage: "No new S&S request was sent. Review this earlier attempt before submitting the same garments again."
      } });
    }
    await db.batch(rows.map((row) => db.prepare(`
            INSERT OR IGNORE INTO batch_orders (batch_id, order_gid, production_revision, quantity_hash)
            VALUES (?, ?, ?, ?)
        `).bind(batchId, row.order_gid, Number(row.production_revision || 0), lineHash)));
    const lockedClaims = await db.prepare(`SELECT order_gid, line_item_gid, variant_gid, sku, qty FROM shelf_claims
            WHERE shop_id = ? AND qty > 0 AND order_gid IN (${placeholders})`).bind(shop.id, ...gids).all();
    if (JSON.stringify(supplierLineSourcesFromProjectionRows(rows, lockedClaims.results || [])) !== JSON.stringify(lineSources)) {
      await db.prepare("DELETE FROM batches WHERE id = ? AND shop_id = ? AND state = 'prepared'").bind(batchId, shop.id).run();
      return v1Error(
        { code: "SHELF_CLAIM_CHANGED", message: "A shelf claim changed while preparing this batch. Refresh and retry." },
        allowOrigin,
        reqAllowHeaders,
        409
      );
    }
    await claimSupplierAttempt(db, { shopId: shop.id, provider: "shopify", lineSources, batchId, now: isoNow() });
    let supplier;
    try {
      supplier = await upstreamDataRequest(env, "/order-manager/v1/supplier/ss/commit", {
        method: "POST",
        body: JSON.stringify({
          batchId,
          poNumber,
          lineHash,
          lines,
          orderCount: gids.length,
          testOrder: env.SS_TEST_ORDER !== "0"
        })
      });
    } catch (error) {
      const report = normalizeSupplierCommitReport({
        payload: error.body,
        error,
        requestedLines: lines,
        lineSources,
        orderIds: gids,
        batchId,
        poNumber,
        operation,
        excludedLines,
        attemptStartedAt: batch.created_at
      });
      const state = report.outcome === "rejected" ? "failed" : "unknown";
      await db.batch([
        db.prepare(`UPDATE batches SET state = ?, response_json = ?, updated_at = ? WHERE id = ?`).bind(state, JSON.stringify(report), isoNow(), batchId),
        db.prepare(`
                  INSERT INTO supplier_attempts (
                    id, batch_id, attempt_type, outcome, http_status, response_json, created_at
                  ) VALUES (?, ?, 'commit', ?, ?, ?, ?)
                `).bind(crypto.randomUUID(), batchId, report.outcome, Number(error.status || 0) || null, JSON.stringify(report), isoNow())
      ]);
      if (report.outcome === "rejected") {
        return v1Error({
          code: report.preflightFailed ? "SUPPLIER_PREFLIGHT_FAILED" : "SUPPLIER_REJECTED",
          message: report.summary,
          batchId
        }, allowOrigin, reqAllowHeaders, report.preflightFailed ? 424 : 422, { report });
      }
      return v1Error({
        code: "SUPPLIER_RESULT_UNKNOWN",
        message: "S&S did not return a confirmed result. Do not retry until this batch is reconciled.",
        batchId
      }, allowOrigin, reqAllowHeaders, 502, { report });
    }
    const response = normalizeSupplierCommitReport({
      payload: supplier,
      requestedLines: lines,
      lineSources,
      orderIds: gids,
      batchId,
      poNumber,
      operation,
      excludedLines,
      attemptStartedAt: batch.created_at
    });
    response.lineHash = lineHash;
    response.count = gids.length;
    response.skuCount = lines.length;
    response.metadataRepairRequired = [];
    if (response.outcome === "rejected" || response.outcome === "unknown") {
      const state = response.outcome === "rejected" ? "failed" : "unknown";
      await db.batch([
        db.prepare(`UPDATE batches SET state = ?, response_json = ?, updated_at = ? WHERE id = ?`).bind(state, JSON.stringify(response), isoNow(), batchId),
        db.prepare(`
                  INSERT INTO supplier_attempts (
                    id, batch_id, attempt_type, outcome, http_status, response_json, created_at
                  ) VALUES (?, ?, 'commit', ?, 200, ?, ?)
                `).bind(crypto.randomUUID(), batchId, response.outcome, JSON.stringify(response), isoNow())
      ]);
      const unknown = response.outcome === "unknown";
      return v1Error({
        code: unknown ? "SUPPLIER_RESULT_UNKNOWN" : "SUPPLIER_REJECTED",
        message: response.summary,
        batchId
      }, allowOrigin, reqAllowHeaders, unknown ? 502 : 422, { report: response });
    }
    const acceptedOrderIds = new Set(response.orderResults.filter((order) => order.outcome === "confirmed").map((order) => order.orderId));
    const rejectedOrderIds = gids.filter((gid2) => !acceptedOrderIds.has(gid2));
    await db.batch([
      ...rejectedOrderIds.map((gid2) => db.prepare(`DELETE FROM batch_orders WHERE batch_id = ? AND order_gid = ?`).bind(batchId, gid2)),
      db.prepare(`UPDATE batches SET state = 'confirmed', response_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(response), isoNow(), batchId),
      db.prepare(`
              INSERT INTO supplier_attempts (
                id, batch_id, attempt_type, outcome, http_status, response_json, created_at
              ) VALUES (?, ?, 'commit', 'confirmed', 200, ?, ?)
            `).bind(crypto.randomUUID(), batchId, JSON.stringify(response), isoNow())
    ]);
    for (const row of rows.filter((candidate) => acceptedOrderIds.has(candidate.order_gid))) {
      try {
        await confirmedBatchProductionUpdate(env, shop, row, batchId, poNumber, actor);
      } catch (error) {
        console.error(`Confirmed batch metadata repair required for ${row.order_gid}:`, error.message);
        response.metadataRepairRequired.push(row.order_gid);
      }
    }
    await db.prepare(`UPDATE batches SET response_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(response), isoNow(), batchId).run();
    return jsonResponse(response, allowOrigin, reqAllowHeaders, response.metadataRepairRequired.length ? 202 : 200);
  } catch (error) {
    return v1Error(error.body?.error || error, allowOrigin, reqAllowHeaders, error.status || 500, error.body || (error.batchId ? { batchId: error.batchId } : void 0));
  }
}
__name(handleV1BatchCommit, "handleV1BatchCommit");
function assetIdFromPath(pathname) {
  return decodeURIComponent(pathname.replace(/^\/order-manager\/v1\/assets\//, "").replace(/\/(read-ticket|read)$/, ""));
}
__name(assetIdFromPath, "assetIdFromPath");
function supplierLineSourcesFromProjectionRows(rows, claims = []) {
  return supplierSourcesWithShelfClaims(rows, claims);
}
__name(supplierLineSourcesFromProjectionRows, "supplierLineSourcesFromProjectionRows");
function supplierValue(object2, names) {
  if (!object2 || typeof object2 !== "object") return void 0;
  const keys = Object.keys(object2);
  for (const name of names) {
    const key2 = keys.find((candidate) => candidate.toLowerCase() === String(name).toLowerCase());
    if (key2 !== void 0) return object2[key2];
  }
  return void 0;
}
__name(supplierValue, "supplierValue");
function supplierText(value, fallback = "") {
  if (value === void 0 || value === null) return fallback;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, 500);
    } catch (_) {
      return fallback;
    }
  }
  return String(value).trim().slice(0, 500) || fallback;
}
__name(supplierText, "supplierText");
function supplierArray(object2, names) {
  const value = supplierValue(object2, names);
  return Array.isArray(value) ? value : [];
}
__name(supplierArray, "supplierArray");
function supplierOrderRecords(payload) {
  if (Array.isArray(payload)) return payload;
  return supplierArray(payload, ["orders", "orderResults", "supplierOrders"]);
}
__name(supplierOrderRecords, "supplierOrderRecords");
function supplierLineErrorRecords(payload) {
  if (!payload || typeof payload !== "object") return [];
  const direct = supplierArray(payload, ["lineErrors", "line_errors", "rejectedLines", "errors"]);
  if (direct.length) return direct;
  const nestedError = supplierValue(payload, ["error"]);
  if (nestedError && typeof nestedError === "object") {
    return supplierArray(nestedError, ["lineErrors", "line_errors", "rejectedLines", "errors"]);
  }
  return [];
}
__name(supplierLineErrorRecords, "supplierLineErrorRecords");
function supplierSkuFromRecord(record, requestedLines) {
  const direct = supplierText(supplierValue(record, ["sku", "identifier", "skuId", "skuID", "productSku"]));
  if (direct) return direct;
  const field = supplierText(supplierValue(record, ["field", "path"]));
  const index2 = /lines?\s*\[?\s*(\d+)\s*\]?/i.exec(field)?.[1];
  return index2 !== void 0 ? String(requestedLines[Number(index2)]?.sku || "") : "";
}
__name(supplierSkuFromRecord, "supplierSkuFromRecord");
function supplierItemNamesForSku(lineSources, sku) {
  return [...new Set(lineSources.filter((source) => !sku || source.sku === sku).map((source) => [source.title, source.variantTitle].filter(Boolean).join(" \u2014 ")).filter(Boolean))];
}
__name(supplierItemNamesForSku, "supplierItemNamesForSku");
function normalizedSupplierAcceptedLines(payload, requestedLines, lineSources) {
  const candidates = supplierArray(payload, ["acceptedLines", "accepted_lines", "lines"]);
  const orderLines = supplierOrderRecords(payload).flatMap((order) => supplierArray(order, ["lines", "lineItems"]));
  const explicit = candidates.length ? candidates : orderLines;
  if (!explicit.length) return [];
  const bySku = /* @__PURE__ */ new Map();
  for (const line of explicit) {
    const sku = supplierSkuFromRecord(line, requestedLines);
    const rawQty = supplierValue(line, ["acceptedQty", "qtyOrdered", "quantity", "qty"]);
    const qty = rawQty === null || rawQty === void 0 || rawQty === "" ? NaN : Number(rawQty);
    if (!sku || !Number.isSafeInteger(qty) || qty < 0) continue;
    bySku.set(sku, (bySku.get(sku) || 0) + qty);
  }
  return [...bySku.entries()].map(([sku, acceptedQty]) => {
    const requestedQty = Number(requestedLines.find((line) => line.sku === sku)?.qty || acceptedQty);
    const orderNames = [...new Set(lineSources.filter((source) => source.sku === sku).map((source) => source.orderName))];
    const itemNames = supplierItemNamesForSku(lineSources, sku);
    return { sku, requestedQty, acceptedQty, orderNames, itemNames };
  });
}
__name(normalizedSupplierAcceptedLines, "normalizedSupplierAcceptedLines");
function normalizedSupplierRejectedLines(payload, requestedLines, lineSources) {
  return supplierLineErrorRecords(payload).map((record, index2) => {
    const sku = supplierSkuFromRecord(record, requestedLines);
    const requested = requestedLines.find((line) => line.sku === sku);
    const reason = supplierText(
      supplierValue(record, ["message", "reason", "error", "description", "detail"]),
      "S&S rejected this line."
    );
    const code = supplierText(supplierValue(record, ["code", "errorCode", "type"]));
    const availableQtyValue = supplierValue(record, ["availableQty", "available", "inventoryQty"]);
    const availableQty = Number.isFinite(Number(availableQtyValue)) ? Number(availableQtyValue) : null;
    const orderNames = [...new Set(lineSources.filter((source) => !sku || source.sku === sku).map((source) => source.orderName))];
    const itemNames = supplierItemNamesForSku(lineSources, sku);
    return {
      line: index2 + 1,
      sku: sku || null,
      requestedQty: Number(requested?.qty || supplierValue(record, ["requestedQty", "qty", "quantity"]) || 0) || null,
      availableQty,
      code: code || null,
      reason,
      orderNames,
      itemNames
    };
  });
}
__name(normalizedSupplierRejectedLines, "normalizedSupplierRejectedLines");
function supplierOrderNumbers(payload) {
  const values = [
    supplierValue(payload, ["orderNumber", "supplierOrderNumber"]),
    ...supplierOrderRecords(payload).map((order) => supplierValue(order, ["orderNumber", "supplierOrderNumber"]))
  ];
  return [...new Set(values.map((value) => supplierText(value)).filter(Boolean))];
}
__name(supplierOrderNumbers, "supplierOrderNumbers");
function normalizeSupplierCommitReport({ payload, error, requestedLines, lineSources, orderIds, batchId, poNumber, operation = "order_placement", testOrder, excludedLines = [], attemptStartedAt = null }) {
  const source = payload && typeof payload === "object" ? payload : {};
  const directEvidence = supplierArray(source, ["acceptedLines", "accepted_lines", "lines"]);
  const nativeOrderLines = supplierOrderRecords(source).flatMap((order) => supplierArray(order, ["lines", "lineItems"]));
  const rawLineEvidence = directEvidence.length ? directEvidence : nativeOrderLines;
  const invalidLineEvidence = rawLineEvidence.some((line) => {
    const rawQty = supplierValue(line, ["acceptedQty", "qtyOrdered", "quantity", "qty"]);
    return !supplierSkuFromRecord(line, requestedLines) || rawQty === null || rawQty === void 0 || rawQty === "" || !Number.isSafeInteger(Number(rawQty)) || Number(rawQty) < 0;
  });
  let acceptedLines = normalizedSupplierAcceptedLines(source, requestedLines, lineSources);
  let rejectedLines = normalizedSupplierRejectedLines(source, requestedLines, lineSources);
  const orderNumbers = supplierOrderNumbers(source);
  const explicitOutcome = supplierText(supplierValue(source, ["outcome", "status"])).toLowerCase();
  const httpStatus = Number(error?.status || 0) || null;
  const upstreamHttpStatus = Number(source.upstreamHttpStatus) || null;
  const supplierMessage = supplierText(supplierValue(source?.error || {}, ["message"])) || (error?.gatewayEvidence?.bodyFormat !== "json" && error?.gatewayEvidence ? `The gateway returned HTTP ${httpStatus} without a readable supplier response.` : null);
  const supplierErrorCode = supplierText(supplierValue(source?.error || {}, ["code"])) || null;
  const orderSubmissionAttempted = typeof source.orderSubmissionAttempted === "boolean" ? source.orderSubmissionAttempted : null;
  const rateLimited = upstreamHttpStatus === 503 && supplierErrorCode === "503" && source.responseBodyFormat === "json" && orderSubmissionAttempted === true && supplierMessage?.replace(/\s+/g, " ") === "You are being throttled. Please wait 1 minute before your next request." && !orderNumbers.length && !supplierOrderRecords(source).length && !acceptedLines.length && !rawLineEvidence.length;
  const recordedAt = isoNow();
  const upstreamResponseAt = Number.isFinite(Date.parse(source.upstreamResponseAt)) ? source.upstreamResponseAt : recordedAt;
  const retryAfterSeconds = rateLimited ? Math.max(60, Math.min(86400, Number(source.retryAfterSeconds) || 60)) : null;
  const retryAt = rateLimited ? new Date(Math.max(Date.parse(recordedAt), Date.parse(upstreamResponseAt)) + retryAfterSeconds * 1e3).toISOString() : null;
  const deterministicFailure = Boolean(error && httpStatus >= 400 && httpStatus < 500 && ![408, 425, 429].includes(httpStatus));
  let preflightFailed = Boolean(error && source.orderSubmissionAttempted === false);
  const postResultUncertain = rateLimited ? false : error ? orderSubmissionAttempted === null ? null : orderSubmissionAttempted && !deterministicFailure : false;
  const priceWarnings = supplierArray(source, ["priceWarnings"]).map((warning) => ({
    sku: supplierText(supplierValue(warning, ["sku"])),
    code: supplierText(supplierValue(warning, ["code"])),
    message: supplierText(supplierValue(warning, ["message"]), "S&S price estimate unavailable.")
  })).filter((warning) => warning.sku);
  let outcome;
  if (rateLimited) {
    outcome = "rejected";
  } else if (preflightFailed) {
    outcome = "rejected";
  } else if (postResultUncertain) {
    outcome = "unknown";
  } else if (["confirmed", "partial", "rejected", "unknown"].includes(explicitOutcome)) {
    outcome = explicitOutcome;
  } else if (error) {
    outcome = deterministicFailure ? "rejected" : "unknown";
  } else if ((orderNumbers.length || acceptedLines.length) && rejectedLines.length) {
    outcome = "partial";
  } else if (rejectedLines.length) {
    outcome = "rejected";
  } else if (orderNumbers.length || source.ok === true) {
    outcome = "confirmed";
  } else {
    outcome = "unknown";
  }
  if (!rejectedLines.length && error && outcome === "rejected") {
    rejectedLines = [{
      line: 1,
      sku: null,
      requestedQty: null,
      availableQty: null,
      code: supplierText(supplierValue(source?.error || source, ["code"])) || null,
      reason: supplierText(
        supplierValue(source?.error || source, ["message", "error"]),
        supplierText(error.message, "S&S rejected this batch.")
      ),
      orderNames: [...new Set(lineSources.map((sourceLine) => sourceLine.orderName))],
      itemNames: supplierItemNamesForSku(lineSources, "")
    }];
  }
  const legacySummary = orderNumbers.length && supplierOrderRecords(source).length && !nativeOrderLines.length && !invalidLineEvidence && acceptedLines.every((line) => line.acceptedQty > 0 && requestedLines.some((requested) => requested.sku === line.sku));
  const summaryConfirmed = ["confirmed", "partial"].includes(outcome) && (source.acceptanceEvidence === "summary_confirmed" || source.acceptanceEvidence !== "supplier_reported" && legacySummary || outcome === "confirmed" && !acceptedLines.length && !rawLineEvidence.length);
  if (summaryConfirmed && outcome === "confirmed" && !acceptedLines.length) {
    acceptedLines = requestedLines.map((line) => ({
      sku: line.sku,
      requestedQty: line.qty,
      acceptedQty: line.qty,
      orderNames: [...new Set(lineSources.filter((sourceLine) => sourceLine.sku === line.sku).map((sourceLine) => sourceLine.orderName))],
      itemNames: supplierItemNamesForSku(lineSources, line.sku)
    }));
  }
  const evidence = consolidateSupplierEvidence({
    requestedLines,
    lineSources,
    acceptedLines,
    rejectedLines,
    outcome,
    operation,
    summaryConfirmed,
    preflightFailed,
    invalidLineEvidence
  });
  outcome = evidence.outcome;
  if (outcome === "unknown" && acceptedLines.some((line) => Number(line.acceptedQty) > 0)) preflightFailed = false;
  const acceptedSkus = new Set(evidence.lineResults.filter((line) => line.fullyCovered).map((line) => line.sku));
  const genericRejection = rejectedLines.some((line) => !line.sku);
  const orderResults = orderIds.map((orderId) => {
    const sources = lineSources.filter((sourceLine) => sourceLine.orderId === orderId);
    const orderName = sources[0]?.orderName || orderId;
    const rejected = sources.filter((sourceLine) => genericRejection || !acceptedSkus.has(sourceLine.sku));
    const orderOutcome = ["confirmed", "partial"].includes(outcome) && sources.length && !rejected.length ? "confirmed" : outcome === "unknown" ? "unknown" : "rejected";
    return {
      orderId,
      orderName,
      outcome: orderOutcome,
      rejectedSkus: [...new Set(rejected.map((line) => line.sku))]
    };
  });
  const acceptedOrderCount = orderResults.filter((order) => order.outcome === "confirmed").length;
  const preflightMessage = supplierText(supplierValue(source?.error, ["message"]), "Supplier preflight failed.");
  const placementSummary = orderNumbers.length ? `S&S returned ${orderNumbers.length === 1 ? "order" : "orders"} ${orderNumbers.join(", ")}.` : "S&S confirmed the order request.";
  const summary = preflightFailed ? `No S&S order request was sent. ${preflightMessage}` : outcome === "confirmed" ? summaryConfirmed ? `${placementSummary} Individual quantities were not returned.` : evidence.detailOutcome === "unresolved" ? `${placementSummary} Some returned item details need review.` : `${placementSummary} ${evidence.totals.reportedAcceptedUnits} garment units reported accepted.` : outcome === "partial" ? `${placementSummary} Some requested items were not accepted. Review the S&S line errors before sending anything again.` : outcome === "rejected" ? "S&S rejected this order request. Review its error details." : "S&S did not confirm the order request. Check S&S before trying again.";
  return {
    ok: outcome === "confirmed" || outcome === "partial",
    submissionAction: preflightFailed ? "not_sent" : "attempted",
    supplierRequestSent: !preflightFailed,
    postResultUncertain,
    orderSubmissionAttempted,
    upstreamHttpStatus,
    supplierMessage,
    supplierErrorCode,
    failureKind: rateLimited ? "rate_limited" : null,
    retryAfterSeconds,
    retryAt,
    gatewayEvidence: error?.gatewayEvidence || null,
    responseBodyFormat: ["json", "non_json"].includes(source.responseBodyFormat) ? source.responseBodyFormat : null,
    attemptStartedAt,
    outcome,
    preflightFailed,
    batchId,
    poNumber,
    supplierOrderNumbers: orderNumbers,
    supplierOrderNumber: orderNumbers[0] || null,
    lineHash: supplierText(supplierValue(source, ["lineHash"])) || null,
    orderCount: orderIds.length,
    acceptedOrderCount,
    acceptedLines,
    rejectedLines,
    ...evidence,
    autoAdvanceAllowed: ["confirmed", "partial"].includes(outcome),
    excludedLines,
    priceWarnings,
    orderResults,
    subtotal: priceWarnings.length ? null : Number(supplierValue(source, ["subtotal"]) || 0) || null,
    testOrder: typeof testOrder === "boolean" ? testOrder : typeof supplierValue(source, ["testOrder"]) === "boolean" ? supplierValue(source, ["testOrder"]) : null,
    httpStatus,
    summary: priceWarnings.length && ["confirmed", "partial"].includes(outcome) ? `${summary} Estimated S&S pricing was unavailable for ${priceWarnings.length} ${priceWarnings.length === 1 ? "SKU" : "SKUs"}; verify the total in S&S.` : summary,
    recordedAt
  };
}
__name(normalizeSupplierCommitReport, "normalizeSupplierCommitReport");
function supplierExcludedServices(groups) {
  return groups.flatMap((items) => items.filter(isSupplierService).map((item) => ({
    sku: String(item.sku || item.supplierSku),
    title: String(item.title || "Artwork service"),
    qty: Number(item.currentQuantity ?? item.quantity ?? item.qty ?? 0),
    reason: "Service charge; not purchased from S&S."
  })));
}
__name(supplierExcludedServices, "supplierExcludedServices");
function providerCartLinesComplete(contract) {
  return contract?.commerce?.lineItemsComplete === true || contract?.commerce?.lineItemsComplete !== false && contract?.sync?.partial === false && !(contract?.sync?.errors || []).length;
}
__name(providerCartLinesComplete, "providerCartLinesComplete");
async function handleV1LatestBatchResult(env, allowOrigin, reqAllowHeaders) {
  try {
    const shop = await d1Shop(env);
    const row = await requireOrderDb(env).prepare(`
          SELECT response_json FROM batches
          WHERE shop_id = ? AND response_json IS NOT NULL
          ORDER BY created_at DESC LIMIT 1
        `).bind(shop.id).first();
    return jsonResponse({ result: row?.response_json ? { ...JSON.parse(row.response_json), submissionAction: "saved", supplierRequestSent: false } : null }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1LatestBatchResult, "handleV1LatestBatchResult");
function supplierLinesFromProviderRecords(records) {
  const aggregate = /* @__PURE__ */ new Map();
  for (const record of records) {
    for (const item of record.contract?.commerce?.lineItems || []) {
      if (PRINT_TITLES.has(item?.title) || isSupplierService(item)) continue;
      const sku = String(item?.supplierSku || "").trim();
      const qty = Number(item?.currentQuantity ?? item?.quantity ?? 0);
      if (!sku || !Number.isInteger(qty) || qty <= 0) continue;
      aggregate.set(sku, (aggregate.get(sku) || 0) + qty);
    }
  }
  return [...aggregate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([sku, qty]) => ({ sku, qty }));
}
__name(supplierLinesFromProviderRecords, "supplierLinesFromProviderRecords");
function supplierLineSourcesFromProviderRecords(records) {
  const sources = [];
  for (const record of records) {
    const orderName = String(record.contract?.displayName || record.contract?.source?.displayNumber || record.orderKey || "").trim();
    for (const item of record.contract?.commerce?.lineItems || []) {
      if (PRINT_TITLES.has(item?.title) || isSupplierService(item)) continue;
      const sku = String(item?.supplierSku || "").trim();
      const qty = Number(item?.currentQuantity ?? item?.quantity ?? 0);
      if (!sku || !Number.isInteger(qty) || qty <= 0) continue;
      sources.push({
        orderId: record.orderKey,
        orderName,
        lineItemId: String(item?.id || "").trim() || null,
        sku,
        title: String(item?.title || "Garment").trim().slice(0, 160),
        variantTitle: String(item?.variantTitle || "").trim().slice(0, 160),
        qty
      });
    }
  }
  return sources;
}
__name(supplierLineSourcesFromProviderRecords, "supplierLineSourcesFromProviderRecords");
async function refreshEtsySupplierSkusForListing(env, listingId) {
  const shop = await d1Shop(env);
  const db = requireOrderDb(env);
  const rows = await db.prepare(`
      SELECT order_key, commerce_json FROM provider_order_projection
      WHERE shop_id = ? AND provider = 'etsy' AND board_enrolled = 1
        AND commerce_json LIKE ?
    `).bind(shop.id, `%"listingId":"${listingId}"%`).all();
  let updated = 0;
  for (const row of rows.results || []) {
    let contract;
    try {
      contract = JSON.parse(row.commerce_json || "{}");
    } catch (_) {
      continue;
    }
    const resolved = await resolveEtsySupplierSkus(env, contract);
    if (JSON.stringify(resolved) === JSON.stringify(contract)) continue;
    await db.prepare(`
          UPDATE provider_order_projection SET commerce_json = ?, updated_at = ?
          WHERE shop_id = ? AND order_key = ?
        `).bind(JSON.stringify(resolved), isoNow(), shop.id, row.order_key).run();
    updated += 1;
  }
  return updated;
}
__name(refreshEtsySupplierSkusForListing, "refreshEtsySupplierSkusForListing");
async function confirmedProviderBatchProductionUpdate(env, shop, record, batchId, poNumber, actor) {
  const current = record.production;
  if (current.batchRefs.includes(poNumber) && ["blanks_cart", "blanks_ordered", "print", "completed"].includes(current.stage)) return { repaired: false };
  const next = normalizeProductionState(current, actor);
  next.stage = "blanks_cart";
  next.readiness.blanksOrdered = false;
  next.batchRefs = [.../* @__PURE__ */ new Set([...next.batchRefs, poNumber])].slice(0, 100);
  next.revision = current.revision + 1;
  next.lastMutationId = `batch:${batchId}`;
  next.updatedAt = isoNow();
  next.updatedBy = actor;
  const saved = await requireOrderDb(env).prepare(`
      UPDATE provider_production_state
      SET revision = ?, last_mutation_id = ?, state_json = ?, updated_at = ?
      WHERE shop_id = ? AND order_key = ? AND revision = ?
    `).bind(next.revision, next.lastMutationId, JSON.stringify(next), next.updatedAt, shop.id, record.orderKey, current.revision).run();
  if (!saved.meta?.changes) throw Object.assign(new Error("Provider production state changed before batch confirmation."), { code: "VERSION_CONFLICT" });
  return { repaired: true };
}
__name(confirmedProviderBatchProductionUpdate, "confirmedProviderBatchProductionUpdate");
async function handleProviderBatchCommit(request, env, allowOrigin, reqAllowHeaders, identity) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderKeys = [...new Set((body.orderKeys || []).map((value) => String(value || "").trim()).filter((value) => /^etsy:\d+:\d+$/.test(value)))];
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!orderKeys.length || orderKeys.length > 50 || !/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
      return v1Error({ code: "INVALID_PROVIDER_BATCH", message: "Select one to 50 Etsy orders and provide a valid idempotency key." }, allowOrigin, reqAllowHeaders, 400);
    }
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    const actor = `${identity?.kind || "unknown"}:${identity?.subject || "unknown"}`;
    const rows = await db.prepare(`
          SELECT p.*, ps.revision, ps.last_mutation_id, ps.state_json
          FROM provider_order_projection p
          JOIN provider_production_state ps ON ps.shop_id = p.shop_id AND ps.order_key = p.order_key
          WHERE p.shop_id = ? AND p.provider = 'etsy' AND p.board_enrolled = 1
            AND p.order_key IN (${orderKeys.map(() => "?").join(",")})
        `).bind(shop.id, ...orderKeys).all();
    const records = (rows.results || []).map(providerProjectionRecord);
    if (records.some((record) => !providerCartLinesComplete(record.contract)))
      return v1Error({ code: "BATCH_ORDER_LINES_INCOMPLETE", message: "Current Etsy lines are incomplete. Refresh before submitting garments." }, allowOrigin, reqAllowHeaders, 409);
    if (records.length !== orderKeys.length || records.some((record) => !["to_order", "blanks_cart"].includes(record.production.stage))) {
      return v1Error({ code: "INVALID_PROVIDER_BATCH_STAGE", message: "Every Etsy order must be active and in Create blanks order or In S&S cart." }, allowOrigin, reqAllowHeaders, 409);
    }
    const lines = supplierLinesFromProviderRecords(records);
    const lineSources = supplierLineSourcesFromProviderRecords(records);
    const operation = "order_placement";
    const testOrder = env.SS_TEST_ORDER !== "0";
    const excludedLines = supplierExcludedServices(records.map((record) => record.contract?.commerce?.lineItems || []));
    if (!lines.length) return v1Error({ code: "BATCH_HAS_NO_SUPPLIER_SKUS", message: "These Etsy orders need an exact S&S blank recipe before they can be submitted." }, allowOrigin, reqAllowHeaders, 400);
    const lineHash = bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(lines))));
    const batchId = `ssb-${await stableAssetId(`${shop.shop_domain}:${actor}:${idempotencyKey}`)}`;
    const poNumber = `PM-${batchId.slice(-12).toUpperCase()}`;
    const requestJson = JSON.stringify({ orderKeys, lines, lineSources, orderCount: orderKeys.length, provider: "etsy", operation, testOrder, excludedLines });
    const now = isoNow();
    await db.prepare(`
          INSERT INTO batches (id, shop_id, po_number, state, line_hash, request_json, expires_at, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).bind(batchId, shop.id, poNumber, lineHash, requestJson, new Date(Date.now() + 15 * 60 * 1e3).toISOString(), actor, now, now).run();
    const batch = await db.prepare("SELECT * FROM batches WHERE id = ? AND shop_id = ?").bind(batchId, shop.id).first();
    if (!batch || batch.line_hash !== lineHash || batch.request_json !== requestJson) return v1Error({ code: "BATCH_IDEMPOTENCY_CONFLICT", message: "This batch key was already used for different orders." }, allowOrigin, reqAllowHeaders, 409);
    if (batch.state === "confirmed") {
      const confirmed = JSON.parse(batch.response_json || '{"ok":true,"outcome":"confirmed"}');
      return jsonResponse({ ...confirmed, submissionAction: "replayed", supplierRequestSent: false }, allowOrigin, reqAllowHeaders, confirmed.outcome === "partial" ? 207 : 200);
    }
    if (batch.state === "failed") {
      const failed = JSON.parse(batch.response_json || "{}");
      return v1Error(
        {
          code: failed.preflightFailed ? "SUPPLIER_PREFLIGHT_FAILED" : "SUPPLIER_REJECTED",
          message: failed.summary || "S&S rejected this submission."
        },
        allowOrigin,
        reqAllowHeaders,
        failed.preflightFailed ? 424 : 422,
        { report: { ...failed, submissionAction: "saved", supplierRequestSent: false } }
      );
    }
    if (["submitting", "unknown"].includes(batch.state)) return v1Error(
      { code: "BATCH_RECONCILIATION_REQUIRED", message: "This batch may already have reached S&S and must be reconciled before retrying.", batchId },
      allowOrigin,
      reqAllowHeaders,
      409,
      { report: {
        ...JSON.parse(batch.response_json || "{}"),
        batchId,
        submissionAction: "blocked",
        supplierRequestSent: false,
        actionMessage: "No new S&S request was sent. Review this earlier attempt before submitting the same garments again."
      } }
    );
    await db.batch([
      ...records.map((record) => db.prepare(`INSERT OR IGNORE INTO batch_orders (batch_id, order_gid, production_revision, quantity_hash) VALUES (?, ?, ?, ?)`).bind(batchId, record.orderKey, record.production.revision, lineHash))
    ]);
    await claimSupplierAttempt(db, { shopId: shop.id, provider: "etsy", lineSources, batchId, now: isoNow() });
    let supplier;
    try {
      supplier = await upstreamDataRequest(env, "/order-manager/v1/supplier/ss/commit", {
        method: "POST",
        body: JSON.stringify({ batchId, poNumber, lineHash, lines, orderCount: records.length, testOrder: env.SS_TEST_ORDER !== "0" })
      });
    } catch (error) {
      const report = normalizeSupplierCommitReport({ payload: error.body, error, requestedLines: lines, lineSources, orderIds: orderKeys, batchId, poNumber, operation, testOrder, excludedLines, attemptStartedAt: batch.created_at });
      const state = report.outcome === "rejected" ? "failed" : "unknown";
      await db.batch([
        db.prepare(`UPDATE batches SET state = ?, response_json = ?, updated_at = ? WHERE id = ?`).bind(state, JSON.stringify(report), isoNow(), batchId),
        db.prepare(`INSERT INTO supplier_attempts (id, batch_id, attempt_type, outcome, http_status, response_json, created_at) VALUES (?, ?, 'commit', ?, ?, ?, ?)`).bind(crypto.randomUUID(), batchId, report.outcome, Number(error.status || 0) || null, JSON.stringify(report), isoNow())
      ]);
      if (report.outcome === "rejected") {
        return v1Error({
          code: report.preflightFailed ? "SUPPLIER_PREFLIGHT_FAILED" : "SUPPLIER_REJECTED",
          message: report.summary,
          batchId
        }, allowOrigin, reqAllowHeaders, report.preflightFailed ? 424 : 422, { report });
      }
      return v1Error({ code: "SUPPLIER_RESULT_UNKNOWN", message: report.summary, batchId }, allowOrigin, reqAllowHeaders, 502, { report });
    }
    const response = normalizeSupplierCommitReport({ payload: supplier, requestedLines: lines, lineSources, orderIds: orderKeys, batchId, poNumber, operation, testOrder, excludedLines, attemptStartedAt: batch.created_at });
    response.lineHash = lineHash;
    response.count = records.length;
    response.skuCount = lines.length;
    response.metadataRepairRequired = [];
    if (response.outcome === "rejected" || response.outcome === "unknown") {
      const state = response.outcome === "rejected" ? "failed" : "unknown";
      await db.batch([
        db.prepare(`UPDATE batches SET state = ?, response_json = ?, updated_at = ? WHERE id = ?`).bind(state, JSON.stringify(response), isoNow(), batchId),
        db.prepare(`INSERT INTO supplier_attempts (id, batch_id, attempt_type, outcome, http_status, response_json, created_at) VALUES (?, ?, 'commit', ?, 200, ?, ?)`).bind(crypto.randomUUID(), batchId, response.outcome, JSON.stringify(response), isoNow())
      ]);
      const unknown = response.outcome === "unknown";
      return v1Error({ code: unknown ? "SUPPLIER_RESULT_UNKNOWN" : "SUPPLIER_REJECTED", message: response.summary, batchId }, allowOrigin, reqAllowHeaders, unknown ? 502 : 422, { report: response });
    }
    const acceptedOrderIds = new Set(response.orderResults.filter((order) => order.outcome === "confirmed").map((order) => order.orderId));
    const rejectedOrderIds = orderKeys.filter((orderKey) => !acceptedOrderIds.has(orderKey));
    await db.batch([
      ...rejectedOrderIds.map((orderKey) => db.prepare(`DELETE FROM batch_orders WHERE batch_id = ? AND order_gid = ?`).bind(batchId, orderKey)),
      db.prepare(`UPDATE batches SET state = 'confirmed', response_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(response), isoNow(), batchId),
      db.prepare(`INSERT INTO supplier_attempts (id, batch_id, attempt_type, outcome, http_status, response_json, created_at) VALUES (?, ?, 'commit', ?, 200, ?, ?)`).bind(crypto.randomUUID(), batchId, response.outcome, JSON.stringify(response), isoNow())
    ]);
    for (const record of records.filter((candidate) => acceptedOrderIds.has(candidate.orderKey))) {
      try {
        await confirmedProviderBatchProductionUpdate(env, shop, record, batchId, poNumber, actor);
      } catch (_) {
        response.metadataRepairRequired.push(record.orderKey);
      }
    }
    await db.prepare(`UPDATE batches SET response_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(response), isoNow(), batchId).run();
    const status = response.outcome === "partial" ? 207 : response.metadataRepairRequired.length ? 202 : 200;
    return jsonResponse(response, allowOrigin, reqAllowHeaders, status);
  } catch (error) {
    return v1Error(error.body?.error || error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
  }
}
__name(handleProviderBatchCommit, "handleProviderBatchCommit");
function catalogPreviewIdFromPath(pathname) {
  return decodeURIComponent(pathname.replace(/^\/order-manager\/v1\/catalog-previews\//, "").replace(/\/(read-ticket|read)$/, ""));
}
__name(catalogPreviewIdFromPath, "catalogPreviewIdFromPath");
async function signAssetTicket(payload, env) {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${await hmacBase64Url(encoded, env.SHOPIFY_API_SECRET)}`;
}
__name(signAssetTicket, "signAssetTicket");
async function verifyAssetTicket(ticket, env) {
  const [payload, signature] = String(ticket || "").split(".");
  if (!payload || !signature || signature !== await hmacBase64Url(payload, env.SHOPIFY_API_SECRET)) return null;
  const value = decodeJsonBase64Url(payload);
  return Number(value.exp) >= Math.floor(Date.now() / 1e3) ? value : null;
}
__name(verifyAssetTicket, "verifyAssetTicket");
async function handleV1AssetReadTicket(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const assetId2 = assetIdFromPath(new URL(request.url).pathname);
    const shop = await d1Shop(env);
    let asset = await requireOrderDb(env).prepare(`
          SELECT id
          FROM asset_manifests
          WHERE id = ? AND shop_id = ? AND state = 'active'
        `).bind(assetId2, shop.id).first();
    if (!asset && env.DRAFT_ORDERS_ENABLED === "1") asset = await draftOrderService(env).findAsset(assetId2);
    if (!asset) {
      return v1Error({ code: "ASSET_NOT_FOUND", message: "Asset manifest was not found." }, allowOrigin, reqAllowHeaders, 404);
    }
    const ticket = await signAssetTicket({ assetId: assetId2, exp: Math.floor(Date.now() / 1e3) + 60 }, env);
    return jsonResponse({ assetId: assetId2, url: `/order-manager/v1/assets/${encodeURIComponent(assetId2)}/read?ticket=${encodeURIComponent(ticket)}`, expiresIn: 60 }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1AssetReadTicket, "handleV1AssetReadTicket");
async function handleV1AssetRead(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const url = new URL(request.url);
    const assetId2 = assetIdFromPath(url.pathname);
    const ticket = await verifyAssetTicket(url.searchParams.get("ticket"), env);
    if (!ticket || ticket.assetId !== assetId2) return v1Error({ code: "INVALID_ASSET_TICKET", message: "Asset ticket is invalid or expired" }, allowOrigin, reqAllowHeaders, 401);
    if (!env.R2_BUCKET) return v1Error({ code: "R2_NOT_CONFIGURED", message: "Private artwork storage is not configured" }, allowOrigin, reqAllowHeaders, 503);
    const shop = await d1Shop(env);
    let asset = await requireOrderDb(env).prepare(`
          SELECT object_key
          FROM asset_manifests
          WHERE id = ? AND shop_id = ? AND state = 'active'
        `).bind(assetId2, shop.id).first();
    if (!asset && env.DRAFT_ORDERS_ENABLED === "1") asset = await draftOrderService(env).findAsset(assetId2);
    if (!asset) return v1Error({ code: "ASSET_NOT_FOUND", message: "Asset manifest was not found" }, allowOrigin, reqAllowHeaders, 404);
    const object2 = await env.R2_BUCKET.get(asset.object_key);
    if (!object2) return v1Error({ code: "ASSET_NOT_FOUND", message: "Asset object was not found" }, allowOrigin, reqAllowHeaders, 404);
    const headers = new Headers();
    object2.writeHttpMetadata(headers);
    headers.set("ETag", object2.httpEtag);
    headers.set("Cache-Control", "private, max-age=55");
    headers.set("X-Content-Type-Options", "nosniff");
    if (headers.get("Content-Type") === "image/svg+xml") {
      headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    }
    for (const [key2, value] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) headers.set(key2, value);
    return new Response(object2.body, { headers });
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1AssetRead, "handleV1AssetRead");
async function findEtsyCatalogPreviewForRead(env, previewId) {
  const shop = await d1Shop(env);
  return requireOrderDb(env).prepare(`
      SELECT mappings.id, blobs.object_key
      FROM etsy_catalog_preview_mappings AS mappings
      JOIN etsy_catalog_preview_blobs AS blobs ON blobs.id = mappings.blob_id
      WHERE mappings.id = ? AND mappings.shop_id = ? AND mappings.state = 'active'
        AND blobs.state = 'active'
      LIMIT 1
    `).bind(previewId, shop.id).first();
}
__name(findEtsyCatalogPreviewForRead, "findEtsyCatalogPreviewForRead");
async function handleEtsyCatalogPreviewReadTicket(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const previewId = catalogPreviewIdFromPath(new URL(request.url).pathname);
    const preview = await findEtsyCatalogPreviewForRead(env, previewId);
    if (!preview) {
      return v1Error({ code: "CATALOG_PREVIEW_NOT_FOUND", message: "Catalog preview was not found." }, allowOrigin, reqAllowHeaders, 404);
    }
    const expiresIn = 60;
    const ticket = await signAssetTicket({ catalogPreviewId: previewId, exp: Math.floor(Date.now() / 1e3) + expiresIn }, env);
    return jsonResponse({
      previewId,
      url: `/order-manager/v1/catalog-previews/${encodeURIComponent(previewId)}/read?ticket=${encodeURIComponent(ticket)}`,
      expiresIn
    }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyCatalogPreviewReadTicket, "handleEtsyCatalogPreviewReadTicket");
async function handleEtsyCatalogPreviewRead(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const url = new URL(request.url);
    const previewId = catalogPreviewIdFromPath(url.pathname);
    const ticket = await verifyAssetTicket(url.searchParams.get("ticket"), env);
    if (!ticket || ticket.catalogPreviewId !== previewId) {
      return v1Error({ code: "INVALID_ASSET_TICKET", message: "Catalog preview ticket is invalid or expired." }, allowOrigin, reqAllowHeaders, 401);
    }
    if (!env.R2_BUCKET) return v1Error({ code: "R2_NOT_CONFIGURED", message: "Private preview storage is not configured." }, allowOrigin, reqAllowHeaders, 503);
    const preview = await findEtsyCatalogPreviewForRead(env, previewId);
    if (!preview) return v1Error({ code: "CATALOG_PREVIEW_NOT_FOUND", message: "Catalog preview was not found." }, allowOrigin, reqAllowHeaders, 404);
    const object2 = await env.R2_BUCKET.get(preview.object_key);
    if (!object2) return v1Error({ code: "CATALOG_PREVIEW_NOT_FOUND", message: "Catalog preview object was not found." }, allowOrigin, reqAllowHeaders, 404);
    const headers = new Headers();
    object2.writeHttpMetadata(headers);
    headers.set("ETag", object2.httpEtag);
    headers.set("Cache-Control", "private, max-age=55");
    for (const [key2, value] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) headers.set(key2, value);
    return new Response(object2.body, { headers });
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleEtsyCatalogPreviewRead, "handleEtsyCatalogPreviewRead");
async function verifyWebhookHmacSafe(rawBytes, header, secret) {
  if (!header || !secret) return false;
  try {
    const expected = Uint8Array.from(atob(header), (character) => character.charCodeAt(0));
    const key2 = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("HMAC", key2, expected, rawBytes);
  } catch {
    return false;
  }
}
__name(verifyWebhookHmacSafe, "verifyWebhookHmacSafe");
async function forwardPaidWebhookToLegacyQueue(request, rawBytes, env) {
  const upstreamBase = String(env.UPSTREAM_BASE || "").replace(/\/+$/, "");
  if (!upstreamBase) throw Object.assign(new Error("Render legacy ingestion is not configured"), { status: 503 });
  const headers = new Headers({ "Content-Type": request.headers.get("Content-Type") || "application/json" });
  for (const name of ["X-Shopify-Hmac-Sha256", "X-Shopify-Shop-Domain", "X-Shopify-Webhook-Id", "X-Shopify-Topic"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(`${upstreamBase}/webhooks/orders/paid`, { method: "POST", headers, body: rawBytes });
  if (!response.ok) {
    throw Object.assign(new Error(`Legacy queue ingestion failed with HTTP ${response.status}`), { status: 502 });
  }
}
__name(forwardPaidWebhookToLegacyQueue, "forwardPaidWebhookToLegacyQueue");
async function handleV1AssetReadTickets(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const body = await request.json().catch(() => ({}));
    const assetIds = [...new Set((Array.isArray(body.assetIds) ? body.assetIds : []).map((value) => String(value || "").trim()).filter((value) => value && value.length <= 200))].slice(0, 50);
    if (!assetIds.length) {
      return v1Error({ code: "ASSET_IDS_REQUIRED", message: "At least one asset ID is required." }, allowOrigin, reqAllowHeaders, 400);
    }
    const shop = await d1Shop(env);
    const placeholders = assetIds.map(() => "?").join(", ");
    const result = await requireOrderDb(env).prepare(`
          SELECT id
          FROM asset_manifests
          WHERE shop_id = ? AND state = 'active' AND id IN (${placeholders})
        `).bind(shop.id, ...assetIds).all();
    const expiresIn = 60;
    const exp = Math.floor(Date.now() / 1e3) + expiresIn;
    const tickets = await Promise.all((result.results || []).map(async (asset) => ({
      assetId: asset.id,
      url: `/order-manager/v1/assets/${encodeURIComponent(asset.id)}/read?ticket=${encodeURIComponent(
        await signAssetTicket({ assetId: asset.id, exp }, env)
      )}`,
      expiresIn
    })));
    return jsonResponse({ tickets }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1AssetReadTickets, "handleV1AssetReadTickets");
function orderCanEnterCandidateBoard(order = {}) {
  const fulfillmentStatus = String(order.fulfillment_status || order.displayFulfillmentStatus || "").trim().toLowerCase();
  if (fulfillmentStatus === "fulfilled") return false;
  if (order.cancelled_at || order.cancelledAt || order.closed_at || order.closedAt) return false;
  return true;
}
__name(orderCanEnterCandidateBoard, "orderCanEnterCandidateBoard");
function webhookConfirmsPayment(topic, payload) {
  if (!orderCanEnterCandidateBoard(payload)) return false;
  if (topic === "orders/paid") return true;
  if (topic !== "orders/updated") return false;
  const financialStatus = String(payload?.financial_status || payload?.display_financial_status || "").trim().toLowerCase();
  return financialStatus === "paid";
}
__name(webhookConfirmsPayment, "webhookConfirmsPayment");
async function handleShopifyWebhook(request, env, allowOrigin, reqAllowHeaders, ctx) {
  try {
    const rawBytes = await request.arrayBuffer();
    const secret = env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_API_SECRET;
    const valid = await verifyWebhookHmacSafe(rawBytes, request.headers.get("X-Shopify-Hmac-Sha256"), secret);
    if (!valid) return v1Error({ code: "INVALID_WEBHOOK_HMAC", message: "Webhook signature verification failed" }, allowOrigin, reqAllowHeaders, 401);
    const headerShop = String(request.headers.get("X-Shopify-Shop-Domain") || shopDomain(env)).toLowerCase();
    if (headerShop !== shopDomain(env)) return v1Error({ code: "INVALID_WEBHOOK_SHOP", message: "Webhook shop is not authorized" }, allowOrigin, reqAllowHeaders, 403);
    const webhookId = request.headers.get("X-Shopify-Webhook-Id");
    if (!webhookId) return v1Error({ code: "MISSING_WEBHOOK_ID", message: "Webhook delivery ID is required" }, allowOrigin, reqAllowHeaders, 400);
    const payload = JSON.parse(new TextDecoder().decode(rawBytes));
    const topic = request.headers.get("X-Shopify-Topic") || "";
    if (topic === "orders/paid" && env.LEGACY_INGEST_ENABLED === "1") {
      await forwardPaidWebhookToLegacyQueue(request, rawBytes, env);
    }
    const shop = await d1Shop(env, { allowUninstalled: topic === "app/uninstalled" });
    const now = isoNow();
    const isDraftTopic = topic.startsWith("draft_orders/");
    const gid2 = isDraftTopic ? null : canonicalOrderGid(payload.admin_graphql_api_id || payload.order_id || payload.id);
    const receipt = await requireOrderDb(env).prepare(`
          INSERT OR IGNORE INTO webhook_receipts (
            webhook_id, shop_id, topic, order_gid, state, triggered_at, received_at, updated_at
          ) VALUES (?, ?, ?, ?, 'received', ?, ?, ?)
        `).bind(webhookId, shop.id, topic, gid2, payload.updated_at || payload.created_at || null, now, now).run();
    if (!receipt.meta?.changes) {
      if (!isDraftTopic) return jsonResponse({ ok: true, duplicate: true }, allowOrigin, reqAllowHeaders);
      const reclaimed = await requireOrderDb(env).prepare("UPDATE webhook_receipts SET state = 'received', error_code = NULL, updated_at = ? WHERE webhook_id = ? AND state = 'failed'").bind(now, webhookId).run();
      if (!reclaimed.meta?.changes) return jsonResponse({ ok: true, duplicate: true }, allowOrigin, reqAllowHeaders);
    }
    if (topic === "app/uninstalled") {
      await requireOrderDb(env).batch([
        requireOrderDb(env).prepare(`
                  UPDATE shops SET uninstalled_at = ?, updated_at = ? WHERE id = ?
                `).bind(now, now, shop.id),
        requireOrderDb(env).prepare(`
                  UPDATE webhook_receipts SET state = 'processed', updated_at = ? WHERE webhook_id = ?
                `).bind(now, webhookId)
      ]);
      return jsonResponse({ ok: true }, allowOrigin, reqAllowHeaders);
    }
    if (isDraftTopic) {
      if (env.DRAFT_ORDERS_ENABLED !== "1") {
        await requireOrderDb(env).prepare("UPDATE webhook_receipts SET state = 'failed', error_code = 'DRAFT_ACCESS_REQUIRED', updated_at = ? WHERE webhook_id = ?").bind(now, webhookId).run();
        return jsonResponse({ ok: true, deferred: true }, allowOrigin, reqAllowHeaders);
      }
      const draftId = /^gid:\/\/shopify\/DraftOrder\/\d+$/.test(payload.admin_graphql_api_id || "") ? payload.admin_graphql_api_id : `gid://shopify/DraftOrder/${payload.id}`;
      try {
        if (topic === "draft_orders/delete") await draftOrderService(env).deleted(draftId);
        else await draftOrderService(env).detail(draftId);
        await requireOrderDb(env).prepare("UPDATE webhook_receipts SET state = 'processed', updated_at = ? WHERE webhook_id = ?").bind(isoNow(), webhookId).run();
      } catch (error) {
        await requireOrderDb(env).prepare("UPDATE webhook_receipts SET state = 'failed', error_code = ?, updated_at = ? WHERE webhook_id = ?").bind(error.code || "DRAFT_SYNC_FAILED", isoNow(), webhookId).run();
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
      }
      return jsonResponse({ ok: true }, allowOrigin, reqAllowHeaders);
    }
    if (gid2) {
      if (webhookConfirmsPayment(topic, payload)) {
        await ensureCandidateOrder(env, gid2, "shopify-webhook");
        if (env.DRAFT_ORDERS_ENABLED === "1") {
          try {
            await draftOrderService(env).reconcile({ orderId: gid2 });
          } catch (error) {
            console.error("Draft artwork reconciliation failed:", error.code || "DRAFT_SYNC_FAILED");
          }
        }
      }
      await requireOrderDb(env).prepare(`
              UPDATE order_projection
              SET stale_at = ?, updated_at = ?
              WHERE shop_id = ? AND order_gid = ?
            `).bind(now, now, shop.id, gid2).run();
      const refresh = refreshThroughCoordinator(env, [gid2]).then(() => requireOrderDb(env).prepare(`
                  UPDATE webhook_receipts SET state = 'processed', updated_at = ? WHERE webhook_id = ?
                `).bind(isoNow(), webhookId).run()).catch(async (error) => {
        console.error("Webhook refresh failed:", error.message);
        await requireOrderDb(env).prepare(`
                      UPDATE webhook_receipts
                      SET state = 'failed', error_code = ?, updated_at = ?
                      WHERE webhook_id = ?
                    `).bind(String(error.code || "REFRESH_FAILED"), isoNow(), webhookId).run();
      });
      if (ctx?.waitUntil) ctx.waitUntil(refresh);
      else await refresh;
    } else {
      await requireOrderDb(env).prepare(`
              UPDATE webhook_receipts SET state = 'processed', updated_at = ? WHERE webhook_id = ?
            `).bind(isoNow(), webhookId).run();
    }
    return jsonResponse({ ok: true }, allowOrigin, reqAllowHeaders);
  } catch (error) {
    console.error("Shopify webhook error:", error.message);
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleShopifyWebhook, "handleShopifyWebhook");
async function handleV1ParityCheck(request, env, allowOrigin, reqAllowHeaders) {
  try {
    const shop = await d1Shop(env);
    const rows = await requireOrderDb(env).prepare(`
          SELECT
            COUNT(*) AS projected,
            SUM(CASE WHEN stale_at IS NOT NULL THEN 1 ELSE 0 END) AS stale,
            SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS errors
          FROM order_projection WHERE shop_id = ? AND active = 1
        `).bind(shop.id).first();
    const report = {
      ok: Number(rows?.errors || 0) === 0,
      canonicalSource: "shopify-app-owned-metafield",
      projectionSource: "cloudflare-d1",
      projected: Number(rows?.projected || 0),
      stale: Number(rows?.stale || 0),
      errors: Number(rows?.errors || 0),
      checkedAt: isoNow()
    };
    return jsonResponse(report, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1ParityCheck, "handleV1ParityCheck");
async function handleV1ParityReport(request, env, allowOrigin, reqAllowHeaders) {
  try {
    return handleV1ParityCheck(request, env, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1ParityReport, "handleV1ParityReport");
function legacyOrderNumber(order) {
  const value = String(order?.orderNumber || order?.name || "").trim();
  const match = /#?(\d+)/.exec(value);
  return match ? match[1] : null;
}
__name(legacyOrderNumber, "legacyOrderNumber");
var LEGACY_POSITION_CATCHUP_CHECKPOINT = "redis-position-catchup-2026-07-22T15-51-42-430Z";
var LEGACY_POSITION_CATCHUP_SHA256 = "22f099ad077d6a66f2aabf0ccf08ff18aa97faa764787cdb79368e0b77c3aaea";
var LEGACY_POSITION_CATCHUP_RECORDS = Object.freeze([
  { orderNumber: "1556", stage: "received", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1548", stage: "print", blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 23 },
  { orderNumber: "1554", stage: "print", blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 1 },
  { orderNumber: "1555", stage: "print", blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 5 },
  { orderNumber: "1557", stage: "print", blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 24 },
  { orderNumber: "1558", stage: "received", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1559", stage: "print", blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 1 },
  { orderNumber: "1560", stage: "print", blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 1 },
  { orderNumber: "1561", stage: "print", blanksReady: false, printsOrdered: true, printsReady: true, printedCount: 3 },
  { orderNumber: "1562", stage: "blanks_ordered", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1563", stage: "print", blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 2 },
  { orderNumber: "1564", stage: "blanks_ordered", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1566", stage: "blanks_ordered", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1567", stage: "blanks_ordered", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1568", stage: "blanks_ordered", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1569", stage: "blanks_ordered", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1570", stage: "blanks_ordered", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1571", stage: "blanks_cart", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
  { orderNumber: "1572", stage: "blanks_cart", blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 }
]);
function productionMatchesLegacyPosition(state, record) {
  return state.stage === record.stage && state.readiness.blanksReady === record.blanksReady && state.readiness.printsOrdered === record.printsOrdered && state.readiness.printsReady === record.printsReady && state.printedCount === record.printedCount;
}
__name(productionMatchesLegacyPosition, "productionMatchesLegacyPosition");
async function restoreLegacySnapshotPositions(env) {
  const shop = await d1Shop(env);
  const db = requireOrderDb(env);
  const existing = await db.prepare(`
      SELECT last_completed_at, last_result_json
      FROM reconciliation_checkpoints
      WHERE shop_id = ? AND name = ?
    `).bind(shop.id, LEGACY_POSITION_CATCHUP_CHECKPOINT).first();
  if (existing?.last_completed_at) {
    let previous = {};
    try {
      previous = JSON.parse(existing.last_result_json || "{}");
    } catch (_) {
    }
    return { ok: true, alreadyCompleted: true, ...previous };
  }
  const startedAt = isoNow();
  const report = {
    sourceBackup: "shopifyOrdersQueue-backup-2026-07-22T15-51-42-430Z.json",
    sourceSha256: LEGACY_POSITION_CATCHUP_SHA256,
    expected: LEGACY_POSITION_CATCHUP_RECORDS.length,
    matched: 0,
    changed: 0,
    unchanged: 0,
    quarantined: 0,
    errors: []
  };
  await db.prepare(`
      INSERT INTO reconciliation_checkpoints (
        shop_id, name, checkpoint, last_started_at, last_completed_at, last_result_json
      ) VALUES (?, ?, NULL, ?, NULL, ?)
      ON CONFLICT(shop_id, name) DO UPDATE SET
        last_started_at = excluded.last_started_at,
        last_result_json = excluded.last_result_json
    `).bind(shop.id, LEGACY_POSITION_CATCHUP_CHECKPOINT, startedAt, JSON.stringify(report)).run();
  const refreshedGids = [];
  for (const record of LEGACY_POSITION_CATCHUP_RECORDS) {
    const sourceKey = `#${record.orderNumber}`;
    try {
      const match = await matchLegacyOrder(env, record);
      if (!match.gid) {
        report.quarantined++;
        await writeMigrationLedger(env, shop.id, {
          sourceType: "redis-position-catchup",
          sourceKey,
          sourceDigest: LEGACY_POSITION_CATCHUP_SHA256,
          state: "quarantined",
          reason: match.matchResult
        });
        continue;
      }
      report.matched++;
      let current = await ensureCandidateOrder(env, match.gid, "redis-position-catchup");
      if (!productionMatchesLegacyPosition(current.state, record)) {
        const next = normalizeProductionState(current.state, "redis-position-catchup");
        next.stage = record.stage;
        next.readiness = {
          blanksOrdered: ["blanks_ordered", "print", "completed"].includes(record.stage),
          blanksReady: record.blanksReady,
          printsOrdered: record.printsOrdered,
          printsReady: record.printsReady
        };
        next.printedCount = record.printedCount;
        next.revision = current.state.revision + 1;
        next.lastMutationId = `redis-position-catchup:${record.orderNumber}:${LEGACY_POSITION_CATCHUP_SHA256.slice(0, 16)}`;
        next.updatedAt = isoNow();
        next.updatedBy = "redis-position-catchup";
        const saved = await setProductionMetafield(env, match.gid, next, current.compareDigest, coordinatorGraphQL);
        current = { ...current, ...saved };
        report.changed++;
      } else {
        report.unchanged++;
      }
      refreshedGids.push(match.gid);
      await d1ProjectionUpsert(env, shop.id, match.gid, current.state, current.compareDigest, void 0, current.order);
      await writeMigrationLedger(env, shop.id, {
        sourceType: "redis-position-catchup",
        sourceKey,
        sourceDigest: LEGACY_POSITION_CATCHUP_SHA256,
        gid: match.gid,
        destinationKey: `${PRODUCTION_METAFIELD_NAMESPACE}.${PRODUCTION_METAFIELD_KEY}`,
        state: "verified",
        result: {
          matchResult: match.matchResult,
          stage: current.state.stage,
          revision: current.state.revision
        }
      });
    } catch (error) {
      report.errors.push({
        orderNumber: record.orderNumber,
        code: error.code || "POSITION_CATCHUP_ERROR",
        message: error.message
      });
    }
  }
  if (refreshedGids.length) await refreshThroughCoordinator(env, refreshedGids);
  report.completedAt = isoNow();
  if (report.errors.length) {
    await db.prepare(`
          UPDATE reconciliation_checkpoints
          SET last_result_json = ?
          WHERE shop_id = ? AND name = ?
        `).bind(JSON.stringify(report), shop.id, LEGACY_POSITION_CATCHUP_CHECKPOINT).run();
    throw Object.assign(new Error(`Legacy position catch-up left ${report.errors.length} error(s); it will retry.`), {
      code: "LEGACY_POSITION_CATCHUP_INCOMPLETE",
      report
    });
  }
  await db.prepare(`
      UPDATE reconciliation_checkpoints
      SET checkpoint = ?, last_completed_at = ?, last_result_json = ?
      WHERE shop_id = ? AND name = ?
    `).bind(LEGACY_POSITION_CATCHUP_SHA256, report.completedAt, JSON.stringify(report), shop.id, LEGACY_POSITION_CATCHUP_CHECKPOINT).run();
  return { ok: true, ...report };
}
__name(restoreLegacySnapshotPositions, "restoreLegacySnapshotPositions");
async function matchLegacyOrder(env, legacy) {
  const direct = canonicalOrderGid(legacy?.admin_graphql_api_id);
  if (direct) return { gid: direct, matchResult: "admin_graphql_api_id" };
  const number = legacyOrderNumber(legacy);
  if (!number) return { gid: null, matchResult: "missing_identifier" };
  const expectedName = `#${number}`;
  const result = await coordinatorGraphQL(env, ORDER_SEARCH_QUERY, { query: `name:${expectedName}` }, "PrintMOOrderSearch");
  const exact = (requireShopifyData(result, "PrintMOOrderSearch").orders?.nodes || []).filter((order) => order.name === expectedName);
  return exact.length === 1 ? { gid: exact[0].id, matchResult: "unique_order_name" } : { gid: null, matchResult: exact.length > 1 ? "ambiguous_order_name" : "not_found" };
}
__name(matchLegacyOrder, "matchLegacyOrder");
function safeAssetName(value) {
  return String(value || "attachment").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "attachment";
}
__name(safeAssetName, "safeAssetName");
async function stableAssetId(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)))).slice(0, 24);
}
__name(stableAssetId, "stableAssetId");
async function migrateLegacyAssets(env, shopId, gid2, legacy, execute) {
  const orderId = numericIdFromGid(gid2);
  const manifests = [];
  for (const item of Array.isArray(legacy.items) ? legacy.items : []) {
    for (const asset of Array.isArray(item?.assets) ? item.assets : []) {
      if (!asset?.key) continue;
      const name = safeAssetName(String(asset.key).split("/").pop());
      const assetId2 = await stableAssetId(`${gid2}:${asset.key}`);
      const objectKey = `orders/${orderId}/assets/${assetId2}/${name}`;
      let byteSize = null;
      let sha256 = null;
      if (execute) {
        if (!env.R2_BUCKET) throw new Error("R2_BUCKET is required to migrate legacy artwork");
        if (!asset.url || !String(asset.url).startsWith("https://")) throw new Error(`Legacy artwork URL is missing for ${name}`);
        const source = await fetch(asset.url);
        if (!source.ok) throw new Error(`Unable to read legacy artwork ${name}: HTTP ${source.status}`);
        const bytes = new Uint8Array(await source.arrayBuffer());
        if (bytes.byteLength > 50 * 1024 * 1024) throw new Error(`Legacy artwork ${name} exceeds the 50 MiB migration limit`);
        byteSize = bytes.byteLength;
        sha256 = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
        await env.R2_BUCKET.put(objectKey, bytes, {
          httpMetadata: { contentType: source.headers.get("Content-Type") || asset.contentType || "application/octet-stream" },
          customMetadata: { sha256, legacyKey: asset.key }
        });
        const stored = await env.R2_BUCKET.get(objectKey);
        if (!stored) throw new Error(`R2 verification could not read ${name}`);
        const storedBytes = new Uint8Array(await stored.arrayBuffer());
        const storedDigest = bytesToHex(await crypto.subtle.digest("SHA-256", storedBytes));
        if (storedDigest !== sha256) throw new Error(`R2 checksum verification failed for ${name}`);
      }
      manifests.push({
        assetId: assetId2,
        objectKey,
        name,
        contentType: asset.contentType || (asset.ext ? `image/${asset.ext === "jpg" ? "jpeg" : asset.ext}` : null),
        byteSize,
        sha256,
        sourceKey: asset.key,
        migrationState: execute ? "verified" : "planned"
      });
    }
  }
  for (const attachment of Array.isArray(legacy.attachments) ? legacy.attachments : []) {
    const raw = attachment?.data || attachment?.base64 || attachment?.content;
    if (!raw) continue;
    const encoded = String(raw).replace(/^data:[^;]+;base64,/, "");
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("Legacy attachment exceeds the 50 MiB migration limit");
    const name = safeAssetName(attachment.name || attachment.filename);
    const assetId2 = await stableAssetId(`${gid2}:${name}:${bytes.byteLength}`);
    const objectKey = `orders/${orderId}/assets/${assetId2}/${name}`;
    const sha256 = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
    if (execute) {
      if (!env.R2_BUCKET) throw new Error("R2_BUCKET is required to migrate Base64 attachments");
      await env.R2_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: attachment.type || attachment.contentType || "application/octet-stream" }, customMetadata: { sha256 } });
      const stored = await env.R2_BUCKET.get(objectKey);
      if (!stored) throw new Error(`R2 verification could not read ${name}`);
      const storedBytes = new Uint8Array(await stored.arrayBuffer());
      const storedDigest = bytesToHex(await crypto.subtle.digest("SHA-256", storedBytes));
      if (storedDigest !== sha256) throw new Error(`R2 checksum verification failed for ${name}`);
    }
    manifests.push({ assetId: assetId2, objectKey, name, contentType: attachment.type || attachment.contentType || null, byteSize: bytes.byteLength, sha256, sourceKey: attachment.name || attachment.filename || name, migrationState: execute ? "verified" : "planned" });
  }
  if (execute && manifests.length) {
    const now = isoNow();
    const db = requireOrderDb(env);
    await db.batch(manifests.map((asset) => db.prepare(`
          INSERT INTO asset_manifests (
            id, shop_id, order_gid, object_key, filename, content_type, byte_size,
            sha256, state, source_key, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'redis-migration', ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            object_key = excluded.object_key,
            filename = excluded.filename,
            content_type = excluded.content_type,
            byte_size = excluded.byte_size,
            sha256 = excluded.sha256,
            state = 'active',
            updated_at = excluded.updated_at
        `).bind(
      asset.assetId,
      shopId,
      gid2,
      asset.objectKey,
      asset.name,
      asset.contentType || "application/octet-stream",
      asset.byteSize,
      asset.sha256,
      asset.sourceKey || asset.objectKey,
      now,
      now
    )));
    for (const asset of manifests) {
      await insertAssetManifestLink(db, asset.assetId, {
        sourceKey: asset.sourceKey || asset.objectKey
      }, now);
    }
  }
  return manifests;
}
__name(migrateLegacyAssets, "migrateLegacyAssets");
function legacyProductionState(legacy, current, actor) {
  const state = normalizeProductionState(current, actor);
  const legacyStatus = String(legacy?.status || "received");
  state.stage = legacyStatus === "toOrder" ? "to_order" : legacyStatus === "blanks" ? Number(legacy?.blanksOrdered || 0) ? "blanks_ordered" : "blanks_cart" : legacyStatus === "print" ? "print" : "received";
  state.readiness = {
    blanksOrdered: Boolean(Number(legacy?.blanksOrdered || 0)),
    blanksReady: Boolean(Number(legacy?.blanksStatus || 0)),
    printsOrdered: Boolean(Number(legacy?.printsOrdered || 0)),
    printsReady: Boolean(Number(legacy?.printsStatus || 0))
  };
  state.printedCount = Math.max(0, Number(legacy?.progress || 0));
  state.bundleId = legacy?.bundle ? String(legacy.bundle).slice(0, 160) : null;
  state.internalNotes = String(legacy?.notes || "").slice(0, 5e3);
  state.updatedAt = isoNow();
  state.updatedBy = actor;
  return state;
}
__name(legacyProductionState, "legacyProductionState");
async function writeMigrationLedger(env, shopId, values) {
  const now = isoNow();
  const id2 = await stableAssetId(`${values.sourceType}:${values.sourceKey}:${values.sourceDigest}`);
  await requireOrderDb(env).prepare(`
      INSERT INTO migration_ledger (
        id, shop_id, source_type, source_key, source_sha256, order_gid,
        destination_key, state, reason, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, source_type, source_key, source_sha256) DO UPDATE SET
        order_gid = excluded.order_gid,
        destination_key = excluded.destination_key,
        state = excluded.state,
        reason = excluded.reason,
        result_json = excluded.result_json,
        updated_at = excluded.updated_at
    `).bind(
    id2,
    shopId,
    values.sourceType,
    values.sourceKey,
    values.sourceDigest,
    values.gid || null,
    values.destinationKey || null,
    values.state,
    values.reason || null,
    JSON.stringify(values.result || {}),
    now,
    now
  ).run();
}
__name(writeMigrationLedger, "writeMigrationLedger");
async function handleV1MigrationRun(request, env, allowOrigin, reqAllowHeaders) {
  try {
    if (env.MIGRATION_UPSTREAM_ENABLED !== "1") {
      return v1Error({
        code: "MIGRATION_BRIDGE_DISABLED",
        message: "The one-time Redis migration bridge is disabled."
      }, allowOrigin, reqAllowHeaders, 503);
    }
    const body = await request.json().catch(() => ({}));
    const execute = body.execute === true;
    const includeAssets = body.includeAssets === true;
    if (execute && body.confirmShop !== shopDomain(env)) {
      return v1Error({ code: "MIGRATION_CONFIRMATION_REQUIRED", message: "Execution requires confirmShop to exactly match the configured Shopify domain." }, allowOrigin, reqAllowHeaders, 400);
    }
    const limit = Math.min(Math.max(Number(body.limit || 1), 1), 5);
    const offset = Math.max(Number(body.offset || 0), 0);
    const page = await upstreamDataRequest(env, `/order-manager/v1/data/legacy?offset=${offset}&limit=${limit}`);
    const shop = await d1Shop(env);
    const report = {
      execute,
      includeAssets,
      projectionMode: includeAssets ? "metadata_and_assets" : "metadata_only",
      offset,
      total: page.total,
      matched: 0,
      migrated: 0,
      quarantined: 0,
      errors: [],
      nextOffset: page.nextOffset
    };
    const ownerQuarantine = new Set(
      String(env.MIGRATION_QUARANTINE_ORDER_NUMBERS || "1000").split(",").map((value) => value.trim().replace(/^#/, "")).filter(Boolean)
    );
    for (const legacy of page.records || []) {
      const source = JSON.stringify(legacy);
      const sourceDigest = bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
      const identifier = legacy.orderNumber || String(legacy.name || "").split(/[–-]/)[0].trim();
      try {
        const orderNumber = legacyOrderNumber(legacy);
        if (orderNumber && ownerQuarantine.has(orderNumber)) {
          report.quarantined++;
          if (execute) await writeMigrationLedger(env, shop.id, {
            sourceType: "redis-order",
            sourceKey: identifier || `#${orderNumber}`,
            sourceDigest,
            state: "quarantined",
            reason: "owner_approved_quarantine"
          });
          continue;
        }
        const match = await matchLegacyOrder(env, legacy);
        if (!match.gid) {
          report.quarantined++;
          if (execute) await writeMigrationLedger(env, shop.id, {
            sourceType: "redis-order",
            sourceKey: identifier || `offset:${offset}`,
            sourceDigest,
            state: "quarantined",
            reason: match.matchResult
          });
          continue;
        }
        report.matched++;
        if (!execute) continue;
        const current = await ensureCandidateOrder(env, match.gid, "redis-migration");
        if (current.state.revision > 0 && body.overwriteChangedOrders !== true) {
          await writeMigrationLedger(env, shop.id, {
            sourceType: "redis-order",
            sourceKey: identifier || match.gid,
            sourceDigest,
            gid: match.gid,
            state: "quarantined",
            reason: "candidate_state_already_changed"
          });
          report.quarantined++;
          continue;
        }
        const migratedState = legacyProductionState(legacy, current.state, "redis-migration");
        migratedState.revision = current.state.revision + 1;
        migratedState.lastMutationId = `migration:${sourceDigest}`;
        const saved = await setProductionMetafield(env, match.gid, migratedState, current.compareDigest);
        const summaries = await refreshThroughCoordinator(env, [match.gid]);
        const assets = includeAssets ? await migrateLegacyAssets(env, shop.id, match.gid, legacy, true) : [];
        await d1ProjectionUpsert(env, shop.id, match.gid, saved.state, saved.compareDigest, summaries[0]);
        for (const asset of assets) {
          await writeMigrationLedger(env, shop.id, {
            sourceType: "redis-asset",
            sourceKey: asset.sourceKey || asset.name,
            sourceDigest: asset.sha256,
            gid: match.gid,
            destinationKey: asset.objectKey,
            state: "verified",
            result: {
              byteSize: asset.byteSize,
              contentType: asset.contentType,
              assetId: asset.assetId
            }
          });
        }
        await writeMigrationLedger(env, shop.id, {
          sourceType: "redis-order",
          sourceKey: identifier || match.gid,
          sourceDigest,
          gid: match.gid,
          destinationKey: `${PRODUCTION_METAFIELD_NAMESPACE}.${PRODUCTION_METAFIELD_KEY}`,
          state: "verified",
          result: {
            matchResult: match.matchResult,
            revision: saved.state.revision,
            assetCount: assets.length,
            assetChecksums: assets.map((asset) => asset.sha256).filter(Boolean)
          }
        });
        report.migrated++;
      } catch (error) {
        report.errors.push({ orderIdentifier: identifier || "unknown", code: "MIGRATION_ERROR", message: error.message });
      }
    }
    if (execute && page.nextOffset === null && report.errors.length === 0) {
      const now = isoNow();
      await requireOrderDb(env).prepare(`
              INSERT INTO reconciliation_checkpoints (
                shop_id, name, checkpoint, last_started_at, last_completed_at, last_result_json
              ) VALUES (?, 'migration', ?, ?, ?, ?)
              ON CONFLICT(shop_id, name) DO UPDATE SET
                checkpoint = excluded.checkpoint,
                last_started_at = excluded.last_started_at,
                last_completed_at = excluded.last_completed_at,
                last_result_json = excluded.last_result_json
            `).bind(shop.id, now, now, now, JSON.stringify(report)).run();
    }
    return jsonResponse(report, allowOrigin, reqAllowHeaders);
  } catch (error) {
    return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
  }
}
__name(handleV1MigrationRun, "handleV1MigrationRun");
var OrderSyncCoordinator = class {
  static {
    __name(this, "OrderSyncCoordinator");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.throttle = { currentlyAvailable: 1e3, maximumAvailable: 1e3, restoreRate: 50, updatedAt: Date.now() };
    this.estimates = /* @__PURE__ */ new Map();
    this.inflightRefreshes = /* @__PURE__ */ new Map();
    this.inflightBootstrap = null;
  }
  async reserve(operationName) {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.throttle.updatedAt) / 1e3;
    this.throttle.currentlyAvailable = Math.min(this.throttle.maximumAvailable, this.throttle.currentlyAvailable + elapsed * this.throttle.restoreRate);
    this.throttle.updatedAt = now;
    const estimate = Math.max(Number(this.estimates.get(operationName) || 50), 1);
    if (this.throttle.currentlyAvailable < estimate) {
      await sleepMs((estimate - this.throttle.currentlyAvailable) / Math.max(this.throttle.restoreRate, 1) * 1e3 + Math.random() * 200);
    }
    this.throttle.currentlyAvailable = Math.max(0, this.throttle.currentlyAvailable - estimate);
  }
  observe(operationName, result) {
    const cost = result.extensions?.cost;
    if (Number.isFinite(cost?.requestedQueryCost)) this.estimates.set(operationName, cost.requestedQueryCost);
    if (cost?.throttleStatus) this.throttle = { ...cost.throttleStatus, updatedAt: Date.now() };
    if (result.apiVersion && result.apiVersion !== SHOPIFY_API_VERSION) console.error(`Shopify API version fall-forward: requested ${SHOPIFY_API_VERSION}, received ${result.apiVersion}`);
  }
  async graphql(query, variables, operationName = "AnonymousQuery") {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.reserve(operationName);
      last = await performShopifyGraphQL(this.env, query, variables, operationName);
      this.observe(operationName, last);
      if (!isThrottled(last)) return last;
      const throttle = last.extensions?.cost?.throttleStatus || this.throttle;
      const cost = Number(last.extensions?.cost?.requestedQueryCost || this.estimates.get(operationName) || 50);
      await sleepMs(Math.max(cost - Number(throttle.currentlyAvailable || 0), 1) / Math.max(Number(throttle.restoreRate || 50), 1) * 1e3 + Math.random() * 250);
    }
    return last;
  }
  async refresh(gids) {
    const key2 = [...new Set(gids)].sort().join(",");
    if (this.inflightRefreshes.has(key2)) return this.inflightRefreshes.get(key2);
    const promise = refreshSummaries(this.env, gids, (_env, query, variables, operationName) => this.graphql(query, variables, operationName)).finally(() => this.inflightRefreshes.delete(key2));
    this.inflightRefreshes.set(key2, promise);
    return promise;
  }
  async bootstrap() {
    if (this.inflightBootstrap) return this.inflightBootstrap;
    this.inflightBootstrap = bootstrapInitialBoard(
      this.env,
      (_env, query, variables, operationName) => this.graphql(query, variables, operationName)
    ).finally(() => {
      this.inflightBootstrap = null;
    });
    return this.inflightBootstrap;
  }
  async reconcileIncremental() {
    const shop = await d1Shop(this.env);
    const db = requireOrderDb(this.env);
    const checkpointResult = await db.prepare(`
          SELECT checkpoint FROM reconciliation_checkpoints WHERE shop_id = ? AND name = 'incremental'
        `).bind(shop.id).first();
    const startedAt = isoNow();
    const checkpoint = checkpointResult?.checkpoint ? Date.parse(checkpointResult.checkpoint) : Date.now() - 3e5;
    const overlap = new Date(checkpoint - 12e4).toISOString();
    let after = null;
    let newest = checkpoint;
    const gids = [];
    do {
      const result2 = await this.graphql(UPDATED_ORDERS_QUERY, { query: `updated_at:>='${overlap}'`, after }, "PrintMOUpdatedOrders");
      const connection = result2.data?.orders;
      if (!connection) throw new Error("Incremental reconciliation returned no orders connection");
      for (const order of connection.nodes || []) {
        gids.push(order.id);
        newest = Math.max(newest, Date.parse(order.updatedAt) || newest);
        if (order.displayFinancialStatus === "PAID" && orderCanEnterCandidateBoard(order)) {
          await ensureCandidateOrder(
            this.env,
            order.id,
            "reconciliation",
            (_env, query, variables, operationName) => this.graphql(query, variables, operationName)
          );
        }
      }
      after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
    if (gids.length) await this.refresh(gids);
    const completedAt = isoNow();
    const staleReceiptCutoff = new Date(Date.now() - 10 * 60 * 1e3).toISOString();
    const recoveredReceipts = await db.prepare(`
          UPDATE webhook_receipts
          SET state = 'processed', error_code = 'RECONCILED_BY_INCREMENTAL', updated_at = ?
          WHERE shop_id = ? AND state = 'received'
            AND topic IN ('orders/paid', 'orders/updated')
            AND received_at < ?
        `).bind(completedAt, shop.id, staleReceiptCutoff).run();
    const nextCheckpoint = new Date(newest).toISOString();
    const result = {
      ok: true,
      refreshed: gids.length,
      recoveredReceipts: Number(recoveredReceipts.meta?.changes || 0),
      checkpoint: nextCheckpoint
    };
    await db.prepare(`
          INSERT INTO reconciliation_checkpoints (
            shop_id, name, checkpoint, last_started_at, last_completed_at, last_result_json
          ) VALUES (?, 'incremental', ?, ?, ?, ?)
          ON CONFLICT(shop_id, name) DO UPDATE SET
            checkpoint = excluded.checkpoint,
            last_started_at = excluded.last_started_at,
            last_completed_at = excluded.last_completed_at,
            last_result_json = excluded.last_result_json
        `).bind(shop.id, nextCheckpoint, startedAt, completedAt, JSON.stringify(result)).run();
    return result;
  }
  async reconcileIntegrity() {
    const shop = await d1Shop(this.env);
    const db = requireOrderDb(this.env);
    const startedAt = isoNow();
    const counts = await db.prepare(`
          SELECT
            COUNT(*) AS projected,
            SUM(CASE WHEN stale_at IS NOT NULL THEN 1 ELSE 0 END) AS stale,
            SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS errors
          FROM order_projection WHERE shop_id = ? AND active = 1
        `).bind(shop.id).first();
    const pending = await db.prepare(`
          SELECT COUNT(*) AS count
          FROM mutation_requests
          WHERE shop_id = ? AND state = 'pending' AND updated_at < ?
        `).bind(shop.id, new Date(Date.now() - 3e5).toISOString()).first();
    const confirmedOrders = await db.prepare(`
          SELECT bo.order_gid, b.id AS batch_id, b.po_number
          FROM batch_orders bo
          JOIN batches b ON b.id = bo.batch_id
          WHERE b.shop_id = ? AND b.state = 'confirmed'
          ORDER BY b.updated_at DESC
          LIMIT 100
        `).bind(shop.id).all();
    const repairedBatchOrders = [];
    const batchRepairErrors = [];
    const directGraphQL = /* @__PURE__ */ __name((_env, query, variables, operationName) => this.graphql(query, variables, operationName), "directGraphQL");
    for (const row of confirmedOrders.results || []) {
      try {
        const repair = await confirmedBatchProductionUpdate(
          this.env,
          shop,
          row,
          row.batch_id,
          row.po_number,
          "integrity-reconciliation",
          directGraphQL
        );
        if (repair.repaired) repairedBatchOrders.push(row.order_gid);
      } catch (error) {
        batchRepairErrors.push({ gid: row.order_gid, message: error.message });
      }
    }
    const result = {
      ok: Number(counts?.errors || 0) === 0 && Number(pending?.count || 0) === 0 && batchRepairErrors.length === 0,
      projected: Number(counts?.projected || 0),
      stale: Number(counts?.stale || 0),
      projectionErrors: Number(counts?.errors || 0),
      stuckMutations: Number(pending?.count || 0),
      repairedBatchOrders,
      batchRepairErrors,
      checkedAt: isoNow()
    };
    await db.prepare(`
          INSERT INTO reconciliation_checkpoints (
            shop_id, name, checkpoint, last_started_at, last_completed_at, last_result_json
          ) VALUES (?, 'integrity', NULL, ?, ?, ?)
          ON CONFLICT(shop_id, name) DO UPDATE SET
            last_started_at = excluded.last_started_at,
            last_completed_at = excluded.last_completed_at,
            last_result_json = excluded.last_result_json
        `).bind(shop.id, startedAt, isoNow(), JSON.stringify(result)).run();
    return result;
  }
  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/graphql" && request.method === "POST") {
        const body = await request.json();
        return Response.json(await this.graphql(body.query, body.variables, body.operationName));
      }
      if (url.pathname === "/refresh" && request.method === "POST") {
        const body = await request.json();
        return Response.json({ summaries: await this.refresh(body.gids || []) });
      }
      if (url.pathname === "/bootstrap") return Response.json(await this.bootstrap());
      if (url.pathname === "/reconcile-incremental") return Response.json(await this.reconcileIncremental());
      if (url.pathname === "/reconcile-integrity") return Response.json(await this.reconcileIntegrity());
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return Response.json({ error: error.message }, { status: error.status || 500 });
    }
  }
};
export {
  OrderSyncCoordinator,
  applyProductionPatch,
  copyDesignerAsset,
  d1AssetsForOrder,
  d1AssetsForOrders,
  d1MobilePreviewsForOrders,
  worker_default as default,
  designerAssetCandidates,
  etsyShadowEligibility,
  handleLegacyQueueDelete,
  handleProviderBatchCommit,
  handleV1ProductionPatch,
  mobilePreviewForSummary,
  normalizeEtsyOrderContract,
  normalizeProductionState,
  normalizeShopifySummary,
  normalizeSupplierCommitReport,
  orderCanEnterCandidateBoard,
  parseEtsyWebhookResource,
  pickAllowOrigin,
  productionForClient,
  promoteDraftTargetDate,
  reconcileEtsyPaidReceipts,
  redactedJsonFieldShape,
  selectOperationalCustomerName,
  summarizeDeliveryMethods,
  supplierLineSourcesFromProjectionRows,
  supplierLinesFromProjectionRows,
  syncDesignerStudioAssetsForSummary,
  verifyEtsyWebhookSignature,
  webhookConfirmsPayment
};
//# sourceMappingURL=worker.js.map
