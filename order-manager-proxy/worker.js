// worker.js — Order Manager proxy + R2 Storage Browser endpoints
export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Only proxy the order-manager API paths
        if (!url.pathname.startsWith("/order-manager/")) {
            return new Response("Not Found", { status: 404 });
        }

        const origin = (request.headers.get("Origin") || "").replace(/\/+$/, "");
        const allowOrigin = pickAllowOrigin(origin, env);

        // If browser sends an Origin and it's not allowed, block
        if (origin && !allowOrigin) {
            return new Response("CORS blocked", {
                status: 403,
                headers: { Vary: "Origin" },
            });
        }

        // Requested headers from preflight (so we don't randomly break new headers later)
        const reqAllowHeaders =
            request.headers.get("Access-Control-Request-Headers") || "Content-Type";

        // CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(allowOrigin || origin || "*", reqAllowHeaders),
            });
        }

        // -----------------------------
        // LOCAL R2 STORAGE ENDPOINTS
        // NOTE: These MUST NOT require browser-sent auth headers.
        // We rely on your Origin allowlist above + the fact this app runs in your admin.
        // -----------------------------
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

        // ✅ Added: metadata/head endpoint used by storage-browser.js (GET /order-manager/storage/head?key=...)
        if (url.pathname === "/order-manager/storage/head") {
            return handleStorageHead(
                request,
                env,
                allowOrigin || origin || "*",
                reqAllowHeaders
            );
        }

        if (url.pathname === "/order-manager/orders/manual-mockups") {
            return handleManualMockups(
                request,
                env,
                allowOrigin || origin || "*",
                reqAllowHeaders
            );
        }

        if (url.pathname === "/order-manager/orders/manual-mockups/bulk") {
            return handleManualMockupsBulk(
                request,
                env,
                allowOrigin || origin || "*",
                reqAllowHeaders
            );
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

        if (url.pathname === "/order-manager/blanks-batches") {
            return handleBlanksBatches(
                request,
                env,
                allowOrigin || origin || "*",
                reqAllowHeaders
            );
        }

        // -----------------------------
        // PROXY EVERYTHING ELSE UPSTREAM
        // -----------------------------
        const upstreamBase = (env.UPSTREAM_BASE || "").replace(/\/+$/, "");
        if (!upstreamBase) return new Response("Missing UPSTREAM_BASE", { status: 500 });

        const upstreamUrl = `${upstreamBase}${url.pathname}${url.search}`;

        // Build upstream headers + inject admin key server-side
        const reqHeaders = new Headers(request.headers);
        reqHeaders.delete("Origin");
        reqHeaders.delete("Host");

        const adminKey = env.ORDER_MANAGER_ADMIN_KEY || "";
        if (!adminKey) {
            return new Response("Missing ORDER_MANAGER_ADMIN_KEY", { status: 500 });
        }
        reqHeaders.set("X-Order-Manager-Key", adminKey);

        // --- WebSocket upgrade special-case ---
        // For WS, you must return fetch() directly so the upgrade can be proxied.
        const isWebSocket = (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
        if (isWebSocket) {
            const wsReq = new Request(upstreamUrl, {
                method: request.method, // should be GET
                headers: reqHeaders,
            });
            return fetch(wsReq);
        }

        // Normal HTTP proxy path
        const upstreamRes = await fetch(upstreamUrl, {
            method: request.method,
            headers: reqHeaders,
            body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
            redirect: "follow",
        });

        const outHeaders = new Headers(upstreamRes.headers);
        outHeaders.set("Cache-Control", "no-store");

        const finalAllowOrigin = allowOrigin || origin || "*";
        for (const [k, v] of Object.entries(corsHeaders(finalAllowOrigin, reqAllowHeaders))) {
            outHeaders.set(k, v);
        }

        return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            headers: outHeaders,
        });
    },
};

function pickAllowOrigin(origin, env) {
    if (!origin) return ""; // curl/server-to-server has no Origin

    const exact = (env.ALLOW_ORIGIN_EXACT || "").replace(/\/+$/, "");
    const suffix = (env.ALLOW_ORIGIN_SUFFIX || "").trim();

    // exact allow
    if (exact && origin === exact) return origin;

    // suffix allow (e.g. any deployment subdomain)
    if (suffix && origin.endsWith(suffix)) return origin;

    return "";
}

function corsHeaders(allowOrigin, allowHeaders) {
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": allowHeaders || "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

// -----------------------------
// R2 HELPERS
// -----------------------------
function jsonResponse(body, allowOrigin, reqAllowHeaders, status = 200) {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) {
        headers.set(k, v);
    }
    return new Response(JSON.stringify(body), { status, headers });
}

function guessContentTypeFromKey(key) {
    const lower = String(key || "").toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".avif")) return "image/avif";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".json")) return "application/json";
    return "application/octet-stream";
}

const MANUAL_ASSETS_PREFIX = "manual-order-assets/";
const BLANKS_BATCHES_PREFIX = `${MANUAL_ASSETS_PREFIX}blanks-batches/`;
const BLANKS_BATCH_INDEX_KEY = `${BLANKS_BATCHES_PREFIX}index.json`;
const MANUAL_MOCKUP_CONTENT_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
]);

const PRINT_TITLES = new Set([
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
    "DTF Print",
]);

function isAllowedStorageKey(key) {
    return (
        key.startsWith("previews/") ||
        key.startsWith("prompts/") ||
        key.startsWith(MANUAL_ASSETS_PREFIX)
    );
}

function normalizeManualOrderNumber(value) {
    const raw = String(value || "").trim().replace(/^#+/, "");
    if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return "";
    return raw;
}

function manualManifestKey(orderNumber) {
    return `${MANUAL_ASSETS_PREFIX}orders/${orderNumber}/manifest.json`;
}

function manualMockupKey(orderNumber, assetId, ext) {
    return `${MANUAL_ASSETS_PREFIX}orders/${orderNumber}/mockups/${assetId}.${ext}`;
}

function manualChecklistKey(orderNumber) {
    return `${MANUAL_ASSETS_PREFIX}orders/${orderNumber}/manual-checklist.json`;
}

function blanksBatchKey(batchId) {
    return `${BLANKS_BATCHES_PREFIX}${batchId}.json`;
}

function normalizeBlanksBatchId(value) {
    const raw = String(value || "").trim();
    if (!raw || raw.length > 80 || !/^[A-Za-z0-9_-]+$/.test(raw)) return "";
    return raw;
}

function makeBlanksBatchId() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
        : Math.random().toString(36).slice(2, 12);
    return `ssb-${date}-${random}`;
}

function safeText(value, max = 240) {
    return String(value || "").trim().slice(0, max);
}

function normalizeBatchKeyPart(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function batchOrderParts(orderName) {
    const parts = String(orderName || "").split(" – ");
    return {
        number: safeText(parts[0] || orderName, 80),
        customer: safeText(parts.slice(1).join(" – "), 160),
    };
}

function batchItemStableId(item, index) {
    const stableId =
        item?.lineItemId ||
        item?.shopifyLineItemId ||
        item?.admin_graphql_api_id ||
        item?.id;
    if (stableId) return `line:${String(stableId).slice(0, 160)}`;

    return [
        "manual",
        index,
        normalizeBatchKeyPart(item?.title),
        normalizeBatchKeyPart(item?.variantTitle),
        Number(item?.qty) || 0,
    ].join("|");
}

function batchManifestItemKey(item) {
    const sku = safeText(item?.sku, 120);
    if (sku) return `sku:${sku.toLowerCase()}`;

    return [
        "variant",
        normalizeBatchKeyPart(item?.title),
        normalizeBatchKeyPart(item?.variantTitle),
    ].join("|");
}

function isBatchPrintItem(item) {
    return PRINT_TITLES.has(item?.title);
}

function makeBlanksBatchLabel(now) {
    const day = now.toISOString().slice(0, 10);
    return `S&S Batch ${day}`;
}

function buildBlanksBatch(body) {
    const now = new Date();
    const nowIso = now.toISOString();
    const rawOrders = Array.isArray(body?.orders) ? body.orders.slice(0, 300) : [];
    const id = normalizeBlanksBatchId(body?.id) || makeBlanksBatchId();
    const label = safeText(body?.label, 120) || makeBlanksBatchLabel(now);
    const source = safeText(body?.source, 80) || "mark-in-cart-ordered";

    const orders = [];
    const manifestByKey = new Map();

    rawOrders.forEach(rawOrder => {
        const name = safeText(rawOrder?.name, 240);
        if (!name) return;

        const parts = batchOrderParts(name);
        const orderNumber = safeText(rawOrder?.orderNumber, 80) || parts.number;
        const customer = safeText(rawOrder?.customer, 160) || parts.customer;
        const receivedAt = safeText(rawOrder?.receivedAt, 80);
        let garmentCount = 0;

        const items = Array.isArray(rawOrder?.items) ? rawOrder.items : [];
        items.forEach((item, index) => {
            if (!item || isBatchPrintItem(item)) return;

            const qty = Math.max(0, Number(item.qty) || 0);
            if (!qty) return;

            const title = safeText(item.title, 240) || "Untitled garment";
            const variantTitle = safeText(item.variantTitle, 240);
            const sku = safeText(item.sku, 120);
            const itemKey = batchManifestItemKey(item);
            const lineId = batchItemStableId(item, index);
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
                    orderLines: [],
                });
            }

            const manifestLine = manifestByKey.get(itemKey);
            manifestLine.expectedQty += qty;
            manifestLine.orderLines.push({
                orderName: name,
                orderNumber,
                customer,
                lineId,
                title,
                variantTitle,
                sku,
                expectedQty: qty,
                accountedQty: 0,
            });
        });

        orders.push({
            name,
            orderNumber,
            customer,
            receivedAt,
            garmentCount,
        });
    });

    const manifest = Array.from(manifestByKey.values())
        .map(line => ({
            ...line,
            missingQty: Math.max(0, line.expectedQty - line.receivedQty),
        }))
        .sort((left, right) => {
            const leftLabel = `${left.title} ${left.variantTitle} ${left.sku}`;
            const rightLabel = `${right.title} ${right.variantTitle} ${right.sku}`;
            return leftLabel.localeCompare(rightLabel);
        });

    const expectedGarments = manifest.reduce((sum, line) => sum + line.expectedQty, 0);

    return {
        version: 1,
        id,
        label,
        status: "ordered",
        source,
        createdAt: nowIso,
        updatedAt: nowIso,
        orderNames: orders.map(order => order.name),
        orders,
        manifest,
        totals: {
            orderCount: orders.length,
            manifestLineCount: manifest.length,
            expectedGarments,
            receivedGarments: 0,
            accountedGarments: 0,
            missingGarments: expectedGarments,
        },
    };
}

function blanksBatchIndexEntry(batch) {
    return {
        id: batch.id,
        key: blanksBatchKey(batch.id),
        label: batch.label,
        status: batch.status,
        source: batch.source,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        orderNames: Array.isArray(batch.orderNames) ? batch.orderNames : [],
        orderCount: batch.totals?.orderCount || 0,
        manifestLineCount: batch.totals?.manifestLineCount || 0,
        expectedGarments: batch.totals?.expectedGarments || 0,
        receivedGarments: batch.totals?.receivedGarments || 0,
        missingGarments: batch.totals?.missingGarments || 0,
    };
}

async function readBlanksBatchIndex(env) {
    const obj = await env.PREVIEWS.get(BLANKS_BATCH_INDEX_KEY);
    if (!obj) return { version: 1, updatedAt: "", batches: [] };

    try {
        const state = JSON.parse(await obj.text());
        return {
            version: 1,
            updatedAt: safeText(state?.updatedAt, 80),
            batches: Array.isArray(state?.batches) ? state.batches : [],
        };
    } catch (err) {
        return { version: 1, updatedAt: "", batches: [] };
    }
}

async function writeBlanksBatchIndex(env, index) {
    const updatedAt = new Date().toISOString();
    const body = JSON.stringify({
        version: 1,
        updatedAt,
        batches: Array.isArray(index?.batches) ? index.batches : [],
    }, null, 2);

    await env.PREVIEWS.put(BLANKS_BATCH_INDEX_KEY, body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
            role: "blanks-batch-index",
            updatedAt,
        },
    });

    return JSON.parse(body);
}

async function writeBlanksBatch(env, batch) {
    const key = blanksBatchKey(batch.id);
    const body = JSON.stringify(batch, null, 2);
    await env.PREVIEWS.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
            role: "blanks-batch",
            batchId: batch.id,
            status: batch.status,
            createdAt: batch.createdAt,
            expectedGarments: String(batch.totals?.expectedGarments || 0),
            orderCount: String(batch.totals?.orderCount || 0),
        },
    });
    return { key, batch };
}

async function upsertBlanksBatchIndexEntry(env, batch) {
    const index = await readBlanksBatchIndex(env);
    const entry = blanksBatchIndexEntry(batch);
    const existingIndex = index.batches.findIndex(item => item?.id === entry.id);
    if (existingIndex >= 0) {
        index.batches[existingIndex] = entry;
    } else {
        index.batches.unshift(entry);
    }
    index.batches.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
    return writeBlanksBatchIndex(env, index);
}

function extensionForManualMockup(file, contentType) {
    const name = String(file?.name || "").toLowerCase();
    if (contentType === "image/png" || name.endsWith(".png")) return "png";
    if (contentType === "image/webp" || name.endsWith(".webp")) return "webp";
    if (contentType === "image/jpeg" || /\.jpe?g$/i.test(name)) return "jpg";
    return "";
}

function contentTypeForManualMockup(file) {
    const declared = String(file?.type || "").toLowerCase();
    if (MANUAL_MOCKUP_CONTENT_TYPES.has(declared)) return declared;
    const guessed = guessContentTypeFromKey(file?.name || "");
    return MANUAL_MOCKUP_CONTENT_TYPES.has(guessed) ? guessed : "";
}

function publicObjectUrl(request, key) {
    return `${new URL(request.url).origin}/order-manager/storage/object?key=${encodeURIComponent(key)}`;
}

function hydrateManualManifest(manifest, request) {
    const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
    return {
        orderNumber: String(manifest?.orderNumber || ""),
        assets: assets
            .filter(asset => asset && typeof asset.key === "string" && asset.id)
            .map(asset => {
                const url = publicObjectUrl(request, asset.key);
                return {
                    ...asset,
                    url,
                    objectUrl: url,
                    thumbUrl: url,
                };
            }),
    };
}

async function readManualManifest(env, orderNumber) {
    const key = manualManifestKey(orderNumber);
    const obj = await env.PREVIEWS.get(key);
    if (!obj) {
        return { orderNumber, assets: [] };
    }
    try {
        const manifest = JSON.parse(await obj.text());
        return {
            orderNumber,
            assets: Array.isArray(manifest.assets) ? manifest.assets : [],
        };
    } catch (err) {
        return { orderNumber, assets: [] };
    }
}

async function writeManualManifest(env, orderNumber, manifest) {
    const key = manualManifestKey(orderNumber);
    const body = JSON.stringify({
        orderNumber,
        assets: Array.isArray(manifest.assets) ? manifest.assets : [],
    }, null, 2);
    await env.PREVIEWS.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
            role: "manual-mockup-manifest",
            orderNumber,
        },
    });
}

async function readManualChecklist(env, orderNumber) {
    const key = manualChecklistKey(orderNumber);
    const obj = await env.PREVIEWS.get(key);
    if (!obj) {
        return { orderNumber, version: 1, items: {}, updatedAt: "" };
    }
    try {
        const state = JSON.parse(await obj.text());
        return {
            orderNumber,
            version: 1,
            items: state && typeof state.items === "object" && !Array.isArray(state.items)
                ? state.items
                : {},
            updatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : "",
        };
    } catch (err) {
        return { orderNumber, version: 1, items: {}, updatedAt: "" };
    }
}

async function writeManualChecklist(env, orderNumber, state) {
    const key = manualChecklistKey(orderNumber);
    const updatedAt = new Date().toISOString();
    const body = JSON.stringify({
        orderNumber,
        version: 1,
        updatedAt,
        items: state && typeof state.items === "object" && !Array.isArray(state.items)
            ? state.items
            : {},
    }, null, 2);
    await env.PREVIEWS.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
            role: "manual-add-checklist",
            orderNumber,
            updatedAt,
        },
    });
    return { orderNumber, version: 1, updatedAt, items: JSON.parse(body).items };
}

function normalizeManualChecklistItemId(value) {
    const itemId = String(value || "").trim();
    if (!itemId || itemId.length > 300) return "";
    return itemId;
}

function checklistItemMetadata(value) {
    const item = value && typeof value === "object" ? value : {};
    return {
        title: String(item.title || "").slice(0, 240),
        variantTitle: String(item.variantTitle || "").slice(0, 240),
        qty: Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0,
        orderName: String(item.orderName || "").slice(0, 240),
        customer: String(item.customer || "").slice(0, 160),
    };
}

async function applyManualChecklistUpdate(env, update) {
    const orderNumber = normalizeManualOrderNumber(update?.orderNumber || update?.orderKey);
    const itemId = normalizeManualChecklistItemId(update?.itemId || update?.key);
    if (!orderNumber || !itemId) {
        return { ok: false, error: "Missing or invalid orderNumber/itemId" };
    }

    const state = await readManualChecklist(env, orderNumber);
    state.items = state.items && typeof state.items === "object" && !Array.isArray(state.items)
        ? state.items
        : {};

    if (Boolean(update.checked)) {
        state.items[itemId] = {
            checked: true,
            updatedAt: new Date().toISOString(),
            item: checklistItemMetadata(update.item),
        };
    } else {
        delete state.items[itemId];
    }

    const saved = await writeManualChecklist(env, orderNumber, state);
    return { ok: true, orderNumber, itemId, state: saved };
}

function makeManualAssetId() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
        : Math.random().toString(36).slice(2, 12);
    return `${date}-${random}`;
}

function getManualOrderNumberFromUrl(url) {
    return normalizeManualOrderNumber(
        url.searchParams.get("orderNumber") ||
        url.searchParams.get("orderKey")
    );
}

function isFileLike(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        typeof value.arrayBuffer === "function" &&
        typeof value.name === "string"
    );
}

// -----------------------------
// /order-manager/blanks-batches
// GET:
//  - without id: returns batch index
//  - with id: returns one batch manifest
// POST:
//  - { orders: [], source?: string, label?: string }
//  - creates an ordered blanks batch manifest from garment line items
// -----------------------------
async function handleBlanksBatches(request, env, allowOrigin, reqAllowHeaders) {
    if (!env.PREVIEWS) {
        return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
    }

    const url = new URL(request.url);

    if (request.method === "GET") {
        const batchId = normalizeBlanksBatchId(url.searchParams.get("id"));
        if (batchId) {
            const key = blanksBatchKey(batchId);
            const obj = await env.PREVIEWS.get(key);
            if (!obj) {
                return jsonResponse({ error: "Not Found", id: batchId }, allowOrigin, reqAllowHeaders, 404);
            }

            try {
                return jsonResponse({ batch: JSON.parse(await obj.text()) }, allowOrigin, reqAllowHeaders, 200);
            } catch (err) {
                return jsonResponse({ error: "Invalid stored batch", id: batchId }, allowOrigin, reqAllowHeaders, 500);
            }
        }

        const index = await readBlanksBatchIndex(env);
        return jsonResponse(index, allowOrigin, reqAllowHeaders, 200);
    }

    if (request.method === "POST") {
        let body = {};
        try {
            body = await request.json();
        } catch (err) {
            return jsonResponse({ error: "Invalid JSON body" }, allowOrigin, reqAllowHeaders, 400);
        }

        const batch = buildBlanksBatch(body);
        if (!batch.orders.length) {
            return jsonResponse({ error: "At least one order is required" }, allowOrigin, reqAllowHeaders, 400);
        }
        if (!batch.manifest.length || !batch.totals.expectedGarments) {
            return jsonResponse({ error: "Batch has no garment line items" }, allowOrigin, reqAllowHeaders, 400);
        }

        const { key } = await writeBlanksBatch(env, batch);
        const index = await upsertBlanksBatchIndexEntry(env, batch);

        return jsonResponse(
            {
                ok: true,
                key,
                batch,
                indexEntry: blanksBatchIndexEntry(batch),
                indexUpdatedAt: index.updatedAt,
            },
            allowOrigin,
            reqAllowHeaders,
            201
        );
    }

    return new Response("Method Not Allowed", { status: 405 });
}

// -----------------------------
// /order-manager/storage/list
// Query:
//  - prefix (required)
//  - cursor (optional)
//  - limit (optional, default 150)
//  - delimiter (optional, e.g. "/")
// Returns:
//  { prefix, cursor, truncated, items[], commonPrefixes[] }
// -----------------------------
async function handleStorageList(request, env, allowOrigin, reqAllowHeaders) {
    if (!env.PREVIEWS) {
        return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
    }

    if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const prefix = (url.searchParams.get("prefix") || "").trim();
    const cursor = (url.searchParams.get("cursor") || "").trim() || undefined;
    const delimiter = (url.searchParams.get("delimiter") || "").trim() || undefined;

    const limitRaw = url.searchParams.get("limit");
    const limitNum = Number(limitRaw);
    const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(limitNum, 1000) : 150;

    if (!prefix) {
        return jsonResponse({ error: "Missing prefix" }, allowOrigin, reqAllowHeaders, 400);
    }

    const page = await env.PREVIEWS.list({
        prefix,
        cursor,
        limit,
        delimiter,
        include: ['customMetadata', 'httpMetadata'],
    });

    const workerOrigin = new URL(request.url).origin;

    const items = (page.objects || []).map(o => {
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
            thumbUrl: objectUrl,
        };
    });

    const commonPrefixes = Array.isArray(page.delimitedPrefixes) ? page.delimitedPrefixes : [];

    return jsonResponse(
        {
            prefix,
            cursor: page.cursor || null,
            truncated: Boolean(page.truncated),
            items,
            commonPrefixes,
        },
        allowOrigin,
        reqAllowHeaders,
        200
    );
}

// -----------------------------
// /order-manager/storage/head
// Query:
//  - key (required)
// Returns JSON including customMetadata for storage-browser.js hydration.
// IMPORTANT: No auth required from browser (no 401).
// -----------------------------
async function handleStorageHead(request, env, allowOrigin, reqAllowHeaders) {
    if (!env.PREVIEWS) {
        return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
    }

    // storage-browser.js calls this as GET
    if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const key = (url.searchParams.get("key") || "").trim();
    if (!key) return jsonResponse({ error: "Missing key" }, allowOrigin, reqAllowHeaders, 400);

    if (!isAllowedStorageKey(key)) {
        return jsonResponse({ error: "Invalid key" }, allowOrigin, reqAllowHeaders, 400);
    }

    const head = await env.PREVIEWS.head(key);
    if (!head) return jsonResponse({ error: "Not Found", key }, allowOrigin, reqAllowHeaders, 404);

    const customMetadata =
        head.customMetadata ||
        head.custom_metadata ||
        null;

    const httpMetadata =
        head.httpMetadata ||
        head.http_metadata ||
        null;

    // Provide both `customMetadata` and `metadata` aliases (storage-browser checks either)
    return jsonResponse(
        {
            key: head.key || key,
            size: typeof head.size === "number" ? head.size : null,
            etag: head.etag || null,
            uploadedAt: head.uploaded instanceof Date ? head.uploaded.toISOString() : null,
            httpMetadata,
            customMetadata,
            metadata: customMetadata,
        },
        allowOrigin,
        reqAllowHeaders,
        200
    );
}

// -----------------------------
// /order-manager/storage/object
// Query:
//  - key (required)
// Behavior:
//  - GET returns bytes
//  - HEAD returns metadata headers only
// IMPORTANT: No auth required from browser (no 401).
// -----------------------------
async function handleStorageObject(request, env, allowOrigin, reqAllowHeaders) {
    if (!env.PREVIEWS) {
        return new Response("Missing R2 binding: PREVIEWS", { status: 500 });
    }

    const url = new URL(request.url);
    const key = (url.searchParams.get("key") || "").trim();
    if (!key) return new Response("Missing key", { status: 400 });

    if (!isAllowedStorageKey(key)) {
        return new Response("Invalid key", { status: 400 });
    }

    // HEAD: metadata only
    if (request.method === "HEAD") {
        const head = await env.PREVIEWS.head(key);
        if (!head) return new Response("Not Found", { status: 404 });

        const headers = new Headers();
        headers.set("Cache-Control", "no-store");

        const contentType =
            head.httpMetadata?.contentType || guessContentTypeFromKey(key);
        headers.set("Content-Type", contentType);

        // Expose some useful metadata (optional)
        if (typeof head.size === "number") headers.set("Content-Length", String(head.size));
        if (head.etag) headers.set("ETag", head.etag);

        for (const [k, v] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) {
            headers.set(k, v);
        }

        return new Response(null, { status: 200, headers });
    }

    // GET: bytes
    if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const obj = await env.PREVIEWS.get(key);
    if (!obj) return new Response("Not Found", { status: 404 });

    const headers = new Headers();
    headers.set("Cache-Control", "no-store");

    const contentType =
        obj.httpMetadata?.contentType || guessContentTypeFromKey(key);
    headers.set("Content-Type", contentType);

    for (const [k, v] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) {
        headers.set(k, v);
    }

    return new Response(obj.body, { status: 200, headers });
}

// -----------------------------
// /order-manager/orders/manual-mockups
// Query:
//  - orderNumber (required, orderKey alias accepted)
// Behavior:
//  - GET returns manifest metadata
//  - POST uploads one PNG/JPG/WebP file and updates manifest
//  - DELETE removes one manual asset by assetId and updates manifest
// -----------------------------
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

        const assetId = makeManualAssetId();
        const key = manualMockupKey(orderNumber, assetId, ext);
        const uploadedAt = new Date().toISOString();
        const filename = String(file.name || `mockup.${ext}`);

        await env.PREVIEWS.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType },
            customMetadata: {
                role: "manual-mockup",
                orderNumber,
                assetId,
                filename,
                uploadedAt,
            },
        });

        const manifest = await readManualManifest(env, orderNumber);
        const asset = {
            id: assetId,
            key,
            role: "mockup",
            type: "mockup",
            filename,
            contentType,
            uploadedAt,
        };
        manifest.assets = [
            ...(Array.isArray(manifest.assets) ? manifest.assets : []),
            asset,
        ];
        await writeManualManifest(env, orderNumber, manifest);

        return jsonResponse(
            {
                orderNumber,
                asset: hydrateManualManifest({ orderNumber, assets: [asset] }, request).assets[0],
                manifest: hydrateManualManifest(manifest, request),
            },
            allowOrigin,
            reqAllowHeaders,
            201
        );
    }

    if (request.method === "DELETE") {
        const assetId = String(url.searchParams.get("assetId") || "").trim();
        if (!assetId) {
            return jsonResponse({ error: "Missing assetId" }, allowOrigin, reqAllowHeaders, 400);
        }

        const manifest = await readManualManifest(env, orderNumber);
        const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
        const asset = assets.find(item => item && item.id === assetId);
        if (!asset) {
            return jsonResponse({ error: "Not Found", assetId }, allowOrigin, reqAllowHeaders, 404);
        }

        if (typeof asset.key === "string" && asset.key.startsWith(`${MANUAL_ASSETS_PREFIX}orders/${orderNumber}/mockups/`)) {
            await env.PREVIEWS.delete(asset.key);
        }

        manifest.assets = assets.filter(item => item && item.id !== assetId);
        await writeManualManifest(env, orderNumber, manifest);

        return jsonResponse(
            {
                ok: true,
                orderNumber,
                assetId,
                manifest: hydrateManualManifest(manifest, request),
            },
            allowOrigin,
            reqAllowHeaders,
            200
        );
    }

    return new Response("Method Not Allowed", { status: 405 });
}

// -----------------------------
// /order-manager/orders/manual-mockups/bulk
// Body:
//  - { orderNumbers: [] }
// Returns hydrated manifests keyed by order number.
// -----------------------------
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

    const rawOrderNumbers = Array.isArray(body.orderNumbers)
        ? body.orderNumbers
        : Array.isArray(body.orderKeys)
            ? body.orderKeys
            : [];
    const orderNumbers = Array.from(new Set(
        rawOrderNumbers.map(normalizeManualOrderNumber).filter(Boolean)
    )).slice(0, 250);

    const orders = {};
    await Promise.all(orderNumbers.map(async orderNumber => {
        const manifest = await readManualManifest(env, orderNumber);
        orders[orderNumber] = hydrateManualManifest(manifest, request);
    }));

    return jsonResponse({ orders }, allowOrigin, reqAllowHeaders, 200);
}

// -----------------------------
// /order-manager/orders/manual-checklist
// Query:
//  - orderNumber (required for GET)
// Body for PATCH/POST:
//  - { orderNumber, itemId, checked, item }
// -----------------------------
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

// -----------------------------
// /order-manager/orders/manual-checklist/bulk
// Body:
//  - { orderNumbers: [] } reads state for many orders
//  - { updates: [{ orderNumber, itemId, checked, item }] } writes many checks
// -----------------------------
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
        const grouped = new Map();
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

        const orders = {};
        for (const [orderNumber, orderUpdates] of grouped.entries()) {
            const state = await readManualChecklist(env, orderNumber);
            state.items = state.items && typeof state.items === "object" && !Array.isArray(state.items)
                ? state.items
                : {};

            orderUpdates.forEach(update => {
                if (Boolean(update.checked)) {
                    state.items[update.itemId] = {
                        checked: true,
                        updatedAt: new Date().toISOString(),
                        item: checklistItemMetadata(update.item),
                    };
                } else {
                    delete state.items[update.itemId];
                }
                results.push({ ok: true, orderNumber, itemId: update.itemId });
            });

            orders[orderNumber] = await writeManualChecklist(env, orderNumber, state);
        }

        return jsonResponse({ ok: true, results, orders }, allowOrigin, reqAllowHeaders, 200);
    }

    const rawOrderNumbers = Array.isArray(body.orderNumbers)
        ? body.orderNumbers
        : Array.isArray(body.orderKeys)
            ? body.orderKeys
            : [];
    const orderNumbers = Array.from(new Set(
        rawOrderNumbers.map(normalizeManualOrderNumber).filter(Boolean)
    )).slice(0, 250);

    const orders = {};
    await Promise.all(orderNumbers.map(async orderNumber => {
        orders[orderNumber] = await readManualChecklist(env, orderNumber);
    }));

    return jsonResponse({ orders }, allowOrigin, reqAllowHeaders, 200);
}
