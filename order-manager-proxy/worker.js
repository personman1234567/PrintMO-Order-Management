// worker.js — Order Manager proxy + R2 Storage Browser endpoints
const oidcCache = new Map();

function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function decodeJwt(token) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed bearer token");
    const parse = part => JSON.parse(new TextDecoder().decode(decodeBase64Url(part)));
    return { header: parse(parts[0]), payload: parse(parts[1]), signingInput: `${parts[0]}.${parts[1]}`, signature: decodeBase64Url(parts[2]) };
}

function configuredIds(value) {
    return new Set(String(value || "").split(",").map(v => v.trim()).filter(Boolean));
}

async function verifyShopifyWebhookHmac(rawBody, hmacHeader, secret) {
    if (!hmacHeader || !secret) return false;
    try {
        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
        const bytes = new Uint8Array(signature);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const expected = btoa(binary);
        return expected === hmacHeader;
    } catch (_) {
        return false;
    }
}

function validateJwtTimes(payload) {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp < now - 10) throw new Error("Bearer token expired");
    if (Number.isFinite(payload.nbf) && payload.nbf > now + 10) throw new Error("Bearer token is not active");
}

function audienceIncludes(aud, expected) {
    return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

async function verifyShopifyToken(jwt, env) {
    const clientId = env.SHOPIFY_CLIENT_ID || env.SHOPIFY_API_KEY;
    const secret = env.SHOPIFY_APP_SECRET || env.SHOPIFY_API_SECRET;
    const expectedShop = String(env.SHOPIFY_SHOP_DOMAIN || "").toLowerCase();
    if (!clientId || !secret || !expectedShop) throw new Error("Shopify authentication is not configured");
    if (jwt.header.alg !== "HS256") throw new Error("Unsupported Shopify token algorithm");

    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, jwt.signature, new TextEncoder().encode(jwt.signingInput));
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

async function cachedJson(url) {
    const cached = oidcCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Unable to load OIDC metadata");
    const value = await response.json();
    oidcCache.set(url, { value, expiresAt: Date.now() + 300000 });
    return value;
}

async function verifyOidcToken(jwt, env) {
    const issuer = String(env.OIDC_ISSUER || "").replace(/\/+$/, "");
    const audience = env.OIDC_AUDIENCE || env.OIDC_CLIENT_ID;
    if (!issuer || !audience) throw new Error("Electron OIDC authentication is not configured");
    if (jwt.header.alg !== "RS256" || !jwt.header.kid) throw new Error("Unsupported OIDC token algorithm");
    if (jwt.payload.iss !== issuer) throw new Error("Invalid OIDC issuer");

    const discovery = await cachedJson(`${issuer}/.well-known/openid-configuration`);
    if (discovery.issuer !== issuer || !String(discovery.jwks_uri || "").startsWith("https://")) throw new Error("Invalid OIDC metadata");
    const jwks = await cachedJson(discovery.jwks_uri);
    const jwk = Array.isArray(jwks.keys) ? jwks.keys.find(key => key.kid === jwt.header.kid && key.kty === "RSA") : null;
    if (!jwk) throw new Error("OIDC signing key not found");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, jwt.signature, new TextEncoder().encode(jwt.signingInput));
    if (!valid) throw new Error("Invalid OIDC token signature");

    validateJwtTimes(jwt.payload);
    if (!audienceIncludes(jwt.payload.aud, audience)) throw new Error("Invalid OIDC audience");
    const partners = configuredIds(env.PARTNER_SUBJECT_IDS);
    if (!partners.size || !partners.has(String(jwt.payload.sub))) throw new Error("OIDC user is not authorized");
    return { kind: "oidc", subject: String(jwt.payload.sub) };
}

async function authenticateRequest(request, env) {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
    if (!match) throw new Error("Missing bearer token");
    const jwt = decodeJwt(match[1]);
    return jwt.header.alg === "HS256" ? verifyShopifyToken(jwt, env) : verifyOidcToken(jwt, env);
}

export default {
    async fetch(request, env, ctx) {
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

        // EARLY UNAUTHENTICATED ROUTE: Shopify Webhook signature verification (HMAC)
        if (url.pathname === "/order-manager/v1/webhooks/shopify" && request.method === "POST") {
            return handleShopifyWebhook(request, env, allowOrigin || origin || "*", reqAllowHeaders, ctx);
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

        // -----------------------------
        // AUTHENTICATED R2 STORAGE ENDPOINTS
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

        if (url.pathname === "/order-manager/blanks-batches") {
            return handleBlanksBatches(
                request,
                env,
                allowOrigin || origin || "*",
                reqAllowHeaders
            );
        }

        // -----------------------------
        // UNIFIED LEGACY QUEUE & S&S ENDPOINTS (PHASE 1)
        // -----------------------------
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

        // -----------------------------
        // PHASE 2 SHADOW V1 ENDPOINTS
        // -----------------------------
        if (url.pathname.startsWith("/order-manager/v1/shopify-preview/orders/") && request.method === "GET") {
            return handleShopifyPreviewOrderDetailGet(request, env, allowOrigin || origin || "*", reqAllowHeaders);
        }

        if (url.pathname === "/order-manager/v1/shopify-preview/orders" && request.method === "GET") {
            return handleShopifyPreviewOrdersGet(request, env, allowOrigin || origin || "*", reqAllowHeaders);
        }

        if (url.pathname === "/order-manager/v1/orders" && request.method === "GET") {
            return handleV1OrdersGet(request, env, allowOrigin || origin || "*");
        }

        if (url.pathname.startsWith("/order-manager/v1/orders/") && url.pathname.endsWith("/production") && request.method === "GET") {
            return handleV1ProductionGet(request, env, allowOrigin || origin || "*", reqAllowHeaders);
        }

        if (url.pathname.startsWith("/order-manager/v1/orders/") && url.pathname.endsWith("/production") && request.method === "PATCH") {
            return handleV1ProductionPatch(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
        }

        if (url.pathname.startsWith("/order-manager/v1/orders/") && request.method === "GET") {
            return handleV1OrderDetailGet(request, env, allowOrigin || origin || "*");
        }

        if (url.pathname.startsWith("/order-manager/v1/assets/") && url.pathname.endsWith("/read-ticket") && request.method === "POST") {
            return handleV1AssetReadTicket(request, env, allowOrigin || origin || "*", reqAllowHeaders);
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
        if (env.SHOPIFY_SHOP_DOMAIN) reqHeaders.set("X-Shopify-Shop-Domain", String(env.SHOPIFY_SHOP_DOMAIN).toLowerCase());

        // --- WebSocket upgrade special-case ---
        const isWebSocket = (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
        if (isWebSocket) {
            const wsReq = new Request(upstreamUrl, {
                method: request.method,
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

    async scheduled(event, env, ctx) {
        const shop = (env.SHOPIFY_SHOP_DOMAIN || 'printmo-test.myshopify.com').toLowerCase();
        if (env.ORDER_SYNC_COORDINATOR) {
            const id = env.ORDER_SYNC_COORDINATOR.idFromName(shop);
            const coordinator = env.ORDER_SYNC_COORDINATOR.get(id);
            if (event.cron === "*/5 * * * *") {
                ctx.waitUntil(coordinator.fetch(new Request("https://internal/reconcile-incremental")).catch(err => console.error("Cron incremental error:", err)));
            } else if (event.cron === "0 2 * * *") {
                ctx.waitUntil(coordinator.fetch(new Request("https://internal/reconcile-integrity")).catch(err => console.error("Cron integrity error:", err)));
            }
        }
    }
};

function pickAllowOrigin(origin, env) {
    if (!origin) return ""; // curl/server-to-server has no Origin

    if (origin === "https://extensions.shopifycdn.com") return origin;

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

function batchOrderSortValue(batch, orderName) {
    const order = (Array.isArray(batch?.orders) ? batch.orders : [])
        .find(item => item?.name === orderName);
    const time = Date.parse(order?.receivedAt || "");
    return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function applyOldestFirstAllocation(batch) {
    const orderTotals = new Map();
    (Array.isArray(batch.orders) ? batch.orders : []).forEach(order => {
        orderTotals.set(order.name, {
            expectedGarments: Number(order.garmentCount) || 0,
            accountedGarments: 0,
            missingGarments: Number(order.garmentCount) || 0,
            fullyAccounted: false,
        });
    });

    let expectedGarments = 0;
    let receivedGarments = 0;
    let accountedGarments = 0;
    let missingGarments = 0;

    batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : []).map(line => {
        const expectedQty = Math.max(0, Number(line.expectedQty) || 0);
        const receivedQty = Math.max(0, Number(line.receivedQty) || 0);
        let remaining = receivedQty;
        let lineAccounted = 0;

        const orderLines = (Array.isArray(line.orderLines) ? line.orderLines : [])
            .map(orderLine => ({
                ...orderLine,
                expectedQty: Math.max(0, Number(orderLine.expectedQty) || 0),
                accountedQty: 0,
            }))
            .sort((left, right) => {
                const leftTime = batchOrderSortValue(batch, left.orderName);
                const rightTime = batchOrderSortValue(batch, right.orderName);
                if (leftTime !== rightTime) return leftTime - rightTime;
                return String(left.orderName || "").localeCompare(String(right.orderName || ""));
            });

        orderLines.forEach(orderLine => {
            if (remaining <= 0) return;
            const accountedQty = Math.min(orderLine.expectedQty, remaining);
            orderLine.accountedQty = accountedQty;
            remaining -= accountedQty;
            lineAccounted += accountedQty;

            if (!orderTotals.has(orderLine.orderName)) {
                orderTotals.set(orderLine.orderName, {
                    expectedGarments: 0,
                    accountedGarments: 0,
                    missingGarments: 0,
                    fullyAccounted: false,
                });
            }
            const totals = orderTotals.get(orderLine.orderName);
            totals.accountedGarments += accountedQty;
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
            orderLines,
        };
    });

    batch.orders = (Array.isArray(batch.orders) ? batch.orders : []).map(order => {
        const totals = orderTotals.get(order.name) || {
            expectedGarments: Number(order.garmentCount) || 0,
            accountedGarments: 0,
            missingGarments: Number(order.garmentCount) || 0,
            fullyAccounted: false,
        };
        const expected = totals.expectedGarments;
        const accounted = Math.min(expected, totals.accountedGarments);
        const missing = Math.max(0, expected - accounted);
        return {
            ...order,
            accountedGarments: accounted,
            missingGarments: missing,
            fullyAccounted: expected > 0 && missing === 0,
        };
    });

    batch.totals = {
        ...(batch.totals || {}),
        orderCount: batch.orders.length,
        manifestLineCount: batch.manifest.length,
        expectedGarments,
        receivedGarments,
        accountedGarments,
        missingGarments,
        fullyAccountedOrders: batch.orders.filter(order => order.fullyAccounted).length,
    };
    batch.status = expectedGarments > 0
        ? (missingGarments === 0 ? "received" : "ordered")
        : "empty";
    batch.updatedAt = new Date().toISOString();
    return batch;
}

async function readBlanksBatch(env, batchId) {
    const id = normalizeBlanksBatchId(batchId);
    if (!id) return null;
    const obj = await env.PREVIEWS.get(blanksBatchKey(id));
    if (!obj) return null;
    const batch = JSON.parse(await obj.text());
    return batch && typeof batch === "object" ? batch : null;
}

function receiveQtyUpdatesFromBody(body) {
    if (Array.isArray(body?.updates)) {
        return body.updates
            .map(update => ({
                itemKey: safeText(update?.itemKey, 1000),
                receivedQty: Math.max(0, Number(update?.receivedQty) || 0),
            }))
            .filter(update => update.itemKey);
    }

    if (body?.received && typeof body.received === "object" && !Array.isArray(body.received)) {
        return Object.entries(body.received)
            .map(([itemKey, receivedQty]) => ({
                itemKey: safeText(itemKey, 1000),
                receivedQty: Math.max(0, Number(receivedQty) || 0),
            }))
            .filter(update => update.itemKey);
    }

    return [];
}

function applyReceivingUpdates(batch, body) {
    const updates = receiveQtyUpdatesFromBody(body);
    if (!updates.length) return { ok: false, error: "No receiving updates provided" };

    const byKey = new Map(updates.map(update => [update.itemKey, update.receivedQty]));
    let matched = 0;

    batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : []).map(line => {
        if (!byKey.has(line.itemKey)) return line;
        matched += 1;
        return {
            ...line,
            receivedQty: byKey.get(line.itemKey),
        };
    });

    if (!matched) return { ok: false, error: "No matching manifest lines found" };

    return { ok: true, batch: applyOldestFirstAllocation(batch) };
}

function orderNamesFromBody(body) {
    const rawNames = Array.isArray(body?.orderNames)
        ? body.orderNames
        : Array.isArray(body?.names)
            ? body.names
            : [];
    return Array.from(new Set(rawNames.map(name => safeText(name, 240)).filter(Boolean)));
}

function removeOrdersFromBatch(batch, body) {
    const orderNames = orderNamesFromBody(body);
    if (!orderNames.length) return { ok: false, error: "No order names provided" };

    const removeSet = new Set(orderNames);
    const beforeCount = Array.isArray(batch.orders) ? batch.orders.length : 0;
    batch.orders = (Array.isArray(batch.orders) ? batch.orders : [])
        .filter(order => !removeSet.has(order?.name));
    const removedCount = beforeCount - batch.orders.length;
    if (!removedCount) return { ok: false, error: "No matching batch orders found" };

    batch.orderNames = batch.orders.map(order => order.name).filter(Boolean);
    batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : [])
        .map(line => {
            const orderLines = (Array.isArray(line.orderLines) ? line.orderLines : [])
                .filter(orderLine => !removeSet.has(orderLine?.orderName));
            const expectedQty = orderLines.reduce((sum, orderLine) => {
                return sum + (Math.max(0, Number(orderLine?.expectedQty) || 0));
            }, 0);
            return {
                ...line,
                expectedQty,
                orderLines,
            };
        })
        .filter(line => (Number(line.expectedQty) || 0) > 0);

    return { ok: true, batch: applyOldestFirstAllocation(batch), removedCount };
}

function addOrdersToBatch(batch, body) {
    const addBatch = buildBlanksBatch({
        orders: Array.isArray(body?.orders) ? body.orders : [],
        source: "manual-batch-add",
    });
    if (!addBatch.orders.length) return { ok: false, error: "At least one order is required" };
    if (!addBatch.manifest.length || !addBatch.totals.expectedGarments) {
        return { ok: false, error: "Orders have no garment line items" };
    }

    const existingOrderNames = new Set((Array.isArray(batch.orders) ? batch.orders : [])
        .map(order => order?.name)
        .filter(Boolean));
    const incomingNames = new Set(addBatch.orders.map(order => order.name));
    const duplicateNames = Array.from(incomingNames).filter(name => existingOrderNames.has(name));
    if (duplicateNames.length === incomingNames.size) {
        return { ok: false, error: "All provided orders are already in this batch" };
    }

    const allowedNames = new Set(Array.from(incomingNames).filter(name => !existingOrderNames.has(name)));
    const incomingOrders = addBatch.orders.filter(order => allowedNames.has(order.name));
    batch.orders = [
        ...(Array.isArray(batch.orders) ? batch.orders : []),
        ...incomingOrders,
    ];
    batch.orderNames = batch.orders.map(order => order.name).filter(Boolean);

    const manifestByKey = new Map((Array.isArray(batch.manifest) ? batch.manifest : [])
        .map(line => [line.itemKey, { ...line, orderLines: Array.isArray(line.orderLines) ? line.orderLines.slice() : [] }]));

    addBatch.manifest.forEach(incomingLine => {
        const incomingOrderLines = (Array.isArray(incomingLine.orderLines) ? incomingLine.orderLines : [])
            .filter(orderLine => allowedNames.has(orderLine?.orderName));
        if (!incomingOrderLines.length) return;

        if (!manifestByKey.has(incomingLine.itemKey)) {
            manifestByKey.set(incomingLine.itemKey, {
                ...incomingLine,
                receivedQty: 0,
                accountedQty: 0,
                missingQty: incomingOrderLines.reduce((sum, orderLine) => sum + (Number(orderLine.expectedQty) || 0), 0),
                orderLines: [],
            });
        }

        const line = manifestByKey.get(incomingLine.itemKey);
        line.orderLines.push(...incomingOrderLines);
        line.expectedQty = line.orderLines.reduce((sum, orderLine) => {
            return sum + (Math.max(0, Number(orderLine?.expectedQty) || 0));
        }, 0);
    });

    batch.manifest = Array.from(manifestByKey.values())
        .sort((left, right) => {
            const leftLabel = `${left.title} ${left.variantTitle} ${left.sku}`;
            const rightLabel = `${right.title} ${right.variantTitle} ${right.sku}`;
            return leftLabel.localeCompare(rightLabel);
        });

    return {
        ok: true,
        batch: applyOldestFirstAllocation(batch),
        addedCount: incomingOrders.length,
        duplicateNames,
    };
}

function applyBatchOrderAction(batch, body) {
    const action = safeText(body?.action, 80);
    if (action === "remove-orders") return removeOrdersFromBatch(batch, body);
    if (action === "add-orders") return addOrdersToBatch(batch, body);
    return applyReceivingUpdates(batch, body);
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
// PATCH:
//  - { id, updates: [{ itemKey, receivedQty }] }
//  - { id, action: "remove-orders", orderNames: [] }
//  - { id, action: "add-orders", orders: [] }
//  - updates receiving or batch membership and recalculates oldest-first allocation
// -----------------------------
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

            return jsonResponse({ batch }, allowOrigin, reqAllowHeaders, 200);
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

        const result = applyBatchOrderAction(batch, body);
        if (!result.ok) {
            return jsonResponse({ error: result.error }, allowOrigin, reqAllowHeaders, 400);
        }

        const { key } = await writeBlanksBatch(env, result.batch);
        const index = await upsertBlanksBatchIndexEntry(env, result.batch);

        return jsonResponse(
            {
                ok: true,
                key,
                batch: result.batch,
                indexEntry: blanksBatchIndexEntry(result.batch),
                indexUpdatedAt: index.updatedAt,
            },
            allowOrigin,
            reqAllowHeaders,
            200
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
// Authentication is enforced before route dispatch.
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
// Authentication is enforced before route dispatch.
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

// -----------------------------
// LEGACY QUEUE & SS HANDLERS (PHASE 1)
// -----------------------------
const QUEUE_KEY = "shopifyOrdersQueue";
const MUTATE_QUEUE_LUA = `
local spec = cjson.decode(ARGV[1])
local targets = {}
for _, name in ipairs(spec.orderNames or {}) do targets[name] = true end
local raw = redis.call('LRANGE', KEYS[1], 0, -1)
local updated = {}
for index, value in ipairs(raw) do
  local order = cjson.decode(value)
  local matches = targets[order.name] == true or (spec.bundleName and order.bundle == spec.bundleName)
  if matches then
    local patch = spec.patch or {}
    if patch.status ~= nil then order.status = patch.status end
    if patch.blanksStatus ~= nil then order.blanksStatus = patch.blanksStatus end
    if patch.printsStatus ~= nil then order.printsStatus = patch.printsStatus end
    if patch.blanksOrdered ~= nil then order.blanksOrdered = patch.blanksOrdered end
    if patch.printsOrdered ~= nil then order.printsOrdered = patch.printsOrdered end
    if patch.bundle ~= nil then order.bundle = patch.bundle end
    if patch.notes ~= nil then order.notes = patch.notes end
    if patch.progress ~= nil then order.progress = patch.progress end
    if patch.custName ~= nil then
      local separator = ' – '
      local start = string.find(order.name or '', separator, 1, true)
      local number = start and string.sub(order.name, 1, start - 1) or (order.name or '')
      order.name = number .. separator .. patch.custName
    end
    if patch.addAttachment ~= nil then
      order.attachments = order.attachments or {}
      table.insert(order.attachments, patch.addAttachment)
    end
    if patch.removeAttachmentNames ~= nil then
      local remove = {}
      for _, name in ipairs(patch.removeAttachmentNames) do remove[name] = true end
      local kept = {}
      for _, attachment in ipairs(order.attachments or {}) do
        if not remove[attachment.name] then table.insert(kept, attachment) end
      end
      order.attachments = kept
    end
    redis.call('LSET', KEYS[1], index - 1, cjson.encode(order))
    table.insert(updated, order)
  end
end
return cjson.encode({ success = true, count = #updated, updated = updated })`;

const DELETE_QUEUE_ITEM_LUA = `
local target = ARGV[1]
local raw = redis.call('LRANGE', KEYS[1], 0, -1)
for index, value in ipairs(raw) do
  local order = cjson.decode(value)
  if order.name == target then
    local tombstone = '__printmo_deleted__:' .. redis.call('TIME')[1] .. ':' .. index
    redis.call('LSET', KEYS[1], index - 1, tombstone)
    redis.call('LREM', KEYS[1], 1, tombstone)
    return 1
  end
end
return 0`;

async function upstreamDataRequest(env, path, options = {}) {
    const upstreamBase = String(env.UPSTREAM_BASE || '').replace(/\/+$/, '');
    const adminKey = env.ORDER_MANAGER_ADMIN_KEY;
    if (!upstreamBase || !adminKey) throw new Error('Render data adapter is not configured');
    const headers = new Headers(options.headers || {});
    headers.set('X-Order-Manager-Key', adminKey);
    if (env.SHOPIFY_SHOP_DOMAIN) headers.set('X-Shopify-Shop-Domain', String(env.SHOPIFY_SHOP_DOMAIN).toLowerCase());
    if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${upstreamBase}${path}`, { ...options, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text || `Upstream HTTP ${response.status}` }; }
    if (!response.ok) {
        const error = new Error(body?.error?.message || body?.error || `Render data adapter HTTP ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
    }
    return body;
}

function normalizeQueueOrder(order) {
    let updated = false;
    if (!order.status) { order.status = 'received'; updated = true; }
    if (typeof order.blanksStatus !== 'number') { order.blanksStatus = 0; updated = true; }
    if (typeof order.printsStatus !== 'number') { order.printsStatus = 0; updated = true; }
    if (typeof order.blanksOrdered !== 'number') { order.blanksOrdered = 0; updated = true; }
    if (typeof order.printsOrdered !== 'number') { order.printsOrdered = 0; updated = true; }
    if (typeof order.bundle !== 'string') { order.bundle = ''; updated = true; }
    if (!Array.isArray(order.attachments)) { order.attachments = []; updated = true; }
    if (typeof order.notes !== 'string') { order.notes = ''; updated = true; }
    if (typeof order.progress !== 'number') { order.progress = 0; updated = true; }
    return updated;
}

async function handleLegacyQueueGet(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const orders = await upstreamDataRequest(env, '/order-manager/v1/legacy/queue');
        return jsonResponse(orders, allowOrigin, reqAllowHeaders);
    } catch (err) {
        return jsonResponse({ error: err.message }, allowOrigin, reqAllowHeaders, 500);
    }
}

async function handleLegacyQueueMutate(request, env, allowOrigin, reqAllowHeaders, ctx) {
    try {
        const body = await request.json();
        const { orderName, orderNames, bundleName, patch } = body;
        if ((!orderName && !Array.isArray(orderNames) && !bundleName) || !patch || typeof patch !== "object") {
            return jsonResponse({ error: "Mutation target and patch are required" }, allowOrigin, reqAllowHeaders, 400);
        }
        const spec = {
            orderNames: [...new Set([...(Array.isArray(orderNames) ? orderNames : []), ...(orderName ? [orderName] : [])])],
            bundleName: bundleName || null,
            patch
        };
        const result = await upstreamDataRequest(env, '/order-manager/v1/legacy/queue/mutate', {
            method: 'POST', body: JSON.stringify(spec)
        });
        return jsonResponse(result, allowOrigin, reqAllowHeaders);
    } catch (err) {
        return jsonResponse({ error: err.message }, allowOrigin, reqAllowHeaders, 500);
    }
}

async function handleLegacyQueueDelete(request, env, allowOrigin, reqAllowHeaders, ctx) {
    try {
        const body = await request.json();
        const { orderName } = body;
        if (!orderName) {
            return jsonResponse({ error: "Missing orderName" }, allowOrigin, reqAllowHeaders, 400);
        }

        const result = await upstreamDataRequest(env, '/order-manager/v1/legacy/queue/item', {
            method: 'DELETE', body: JSON.stringify({ orderName })
        });
        return jsonResponse(result, allowOrigin, reqAllowHeaders);
    } catch (err) {
        return jsonResponse({ error: err.message }, allowOrigin, reqAllowHeaders, 500);
    }
}

async function handleLegacySSBatch(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const body = await request.json();
        if (!Array.isArray(body.orderIds) || !body.orderIds.length) {
            return jsonResponse({ error: "No orderIds provided for batch" }, allowOrigin, reqAllowHeaders, 400);
        }
        const result = await upstreamDataRequest(env, '/order-manager/orders/process-batch', {
            method: 'POST',
            body: JSON.stringify({ orderIds: body.orderIds, orderNames: body.orderIds })
        });
        return jsonResponse(result, allowOrigin, reqAllowHeaders);
    } catch (err) {
        return jsonResponse({ error: err.message }, allowOrigin, reqAllowHeaders, err.status || 500);
    }
}
// -----------------------------
// PHASE 2 SHADOW DATA PLANE
// Redis remains private behind the authenticated Render adapter. Shopify access,
// rate coordination, cache refreshes, webhook intake, and R2 reads live here.
// -----------------------------
const shopifyAccessTokenCache = new Map();
const shopifyPreviewCache = new Map();
const SHOPIFY_API_VERSION = '2026-07';
const SHOPIFY_PREVIEW_TTL_MS = 30000;
const SHOPIFY_PREVIEW_DETAIL_TTL_MS = 300000;

const SHOPIFY_PREVIEW_ORDERS_QUERY = `query PrintMOShopifyPreviewOrders($first: Int!) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id name createdAt updatedAt displayFinancialStatus displayFulfillmentStatus cancelledAt currencyCode
      currentSubtotalLineItemsQuantity
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { displayName }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SHOPIFY_PREVIEW_ORDER_DETAIL_QUERY = `query PrintMOShopifyPreviewOrderDetail($id: ID!) {
  order(id: $id) {
    id name createdAt processedAt updatedAt cancelledAt closedAt cancelReason note tags test sourceName
    email phone customerLocale
    customer { id displayName email phone }
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

const SHOPIFY_PREVIEW_ORDER_LINE_ITEMS_QUERY = `query PrintMOShopifyPreviewOrderLineItems($id: ID!, $after: String) {
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

const ORDER_SUMMARIES_QUERY = `query PrintMOOrderSummaries($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id name createdAt updatedAt displayFinancialStatus displayFulfillmentStatus cancelledAt currencyCode
      currentSubtotalLineItemsQuantity
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { displayName }
      lineItems(first: 25) {
        nodes {
          id sku title variantTitle quantity currentQuantity
          variant { id }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const ORDER_LINE_ITEMS_QUERY = `query PrintMOOrderLineItems($id: ID!, $after: String) {
  order(id: $id) {
    lineItems(first: 25, after: $after) {
      nodes {
        id sku title variantTitle quantity currentQuantity
        variant { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const ORDER_DETAIL_QUERY = `query PrintMOOrderDetail($id: ID!, $after: String) {
  order(id: $id) {
    id name createdAt updatedAt note cancelledAt displayFinancialStatus displayFulfillmentStatus currencyCode
    currentSubtotalLineItemsQuantity
    currentSubtotalPriceSet { shopMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    customer { displayName }
    shippingAddress { name address1 address2 city provinceCode zip countryCodeV2 }
    fulfillments { id status createdAt updatedAt trackingInfo { number url company } }
    lineItems(first: 25, after: $after) {
      nodes {
        id sku title variantTitle quantity currentQuantity customAttributes { key value }
        variant { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const ORDER_SEARCH_QUERY = `query PrintMOOrderSearch($query: String!) {
  orders(first: 5, query: $query) { nodes { id name createdAt updatedAt displayFinancialStatus } }
}`;

const UPDATED_ORDERS_QUERY = `query PrintMOUpdatedOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: UPDATED_AT, query: $query) {
    nodes { id name createdAt updatedAt displayFinancialStatus }
    pageInfo { hasNextPage endCursor }
  }
}`;

function v1Error(error, allowOrigin, reqAllowHeaders, status = 500, details) {
    const requestId = crypto.randomUUID();
    const code = typeof error === 'string' ? error : error?.code || 'INTERNAL_ERROR';
    const message = typeof error === 'string' ? error : error?.message || 'Unexpected error';
    return jsonResponse({ error: { code, message, requestId, ...(details ? { details } : {}) } }, allowOrigin, reqAllowHeaders, status);
}

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(ms, 30000))));
}

function base64UrlEncode(value) {
    const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJsonBase64Url(value) {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function bytesToHex(bytes) {
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function hmacBase64Url(payload, secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return base64UrlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

async function encodeSignedCursor(value, env) {
    const payload = base64UrlEncode(JSON.stringify(value));
    return `${payload}.${await hmacBase64Url(payload, env.SHOPIFY_API_SECRET)}`;
}

async function decodeSignedCursor(cursor, expectedFilter, env) {
    if (!cursor) return 0;
    const [payload, signature] = String(cursor).split('.');
    if (!payload || !signature || signature !== await hmacBase64Url(payload, env.SHOPIFY_API_SECRET)) {
        throw Object.assign(new Error('Invalid board cursor'), { code: 'INVALID_CURSOR', status: 400 });
    }
    const value = decodeJsonBase64Url(payload);
    if (value.v !== 1 || value.filter !== expectedFilter || !Number.isInteger(value.offset) || value.offset < 0) {
        throw Object.assign(new Error('Cursor does not match this board query'), { code: 'INVALID_CURSOR', status: 400 });
    }
    return value.offset;
}

function numericIdFromGid(value) {
    const match = /(?:gid:\/\/shopify\/Order\/)?(\d+)$/.exec(String(value || ''));
    return match ? match[1] : null;
}

function canonicalOrderGid(value) {
    const id = numericIdFromGid(value);
    return id ? `gid://shopify/Order/${id}` : null;
}

function shopDomain(env) {
    const shop = String(env.SHOPIFY_SHOP_DOMAIN || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error('SHOPIFY_SHOP_DOMAIN is invalid');
    return shop;
}

async function getShopifyAccessToken(env) {
    const shop = shopDomain(env);
    const cached = shopifyAccessTokenCache.get(shop);
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
    if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) throw new Error('Shopify client credentials are not configured');
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.SHOPIFY_API_KEY,
        client_secret: env.SHOPIFY_API_SECRET
    });
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.access_token) {
        const message = json.error_description || json.error || `Shopify token exchange failed with HTTP ${response.status}`;
        throw new Error(message);
    }
    const expiresIn = Number(json.expires_in || 86399);
    shopifyAccessTokenCache.set(shop, { token: json.access_token, expiresAt: Date.now() + expiresIn * 1000 });
    return json.access_token;
}

async function performShopifyGraphQL(env, query, variables, operationName) {
    const token = await getShopifyAccessToken(env);
    const headers = {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
    };
    if (env.SHOPIFY_COST_DEBUG === '1') headers['Shopify-GraphQL-Cost-Debug'] = '1';
    const response = await fetch(`https://${shopDomain(env)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables: variables || {}, ...(operationName ? { operationName } : {}) })
    });
    const apiVersion = response.headers.get('X-Shopify-API-Version');
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

function isThrottled(result) {
    return result.httpStatus === 429 || result.errors.some(error => error?.extensions?.code === 'THROTTLED');
}

function requireShopifyData(result, operationName) {
    if (result?.ok !== false && result?.data) return result.data;
    const first = result?.errors?.[0];
    const error = new Error(first?.message || `${operationName} failed with Shopify HTTP ${result?.httpStatus || 'unknown'}`);
    error.code = first?.extensions?.code || 'SHOPIFY_API_ERROR';
    error.status = result?.httpStatus === 404 ? 404 : 502;
    throw error;
}

async function shopifyGraphQLWithRetry(env, query, variables, operationName) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
        last = await performShopifyGraphQL(env, query, variables, operationName);
        if (!isThrottled(last)) return last;
        const throttle = last.extensions?.cost?.throttleStatus || {};
        const requested = Number(last.extensions?.cost?.requestedQueryCost || 50);
        const available = Number(throttle.currentlyAvailable || 0);
        const rate = Math.max(Number(throttle.restoreRate || 50), 1);
        await sleepMs(((Math.max(requested - available, 1) / rate) * 1000) + Math.random() * 250);
    }
    return last;
}

async function coordinatorGraphQL(env, query, variables, operationName) {
    if (!env.ORDER_SYNC_COORDINATOR) return shopifyGraphQLWithRetry(env, query, variables, operationName);
    const id = env.ORDER_SYNC_COORDINATOR.idFromName(shopDomain(env));
    const response = await env.ORDER_SYNC_COORDINATOR.get(id).fetch(new Request('https://internal/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables, operationName })
    }));
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body?.error || 'Shopify coordinator failed'), { status: response.status });
    return body;
}

function moneyValue(moneySet, fallbackCurrency) {
    const money = moneySet?.shopMoney;
    return money ? { amount: String(money.amount), currencyCode: money.currencyCode || fallbackCurrency } : null;
}

function normalizeLineItem(item) {
    return {
        id: item.id,
        variantId: item.variant?.id || null,
        sku: item.sku || null,
        title: item.title || '',
        variantTitle: item.variantTitle || '',
        quantity: Number(item.quantity || 0),
        currentQuantity: Number(item.currentQuantity || 0),
        unitPrice: String(item.originalUnitPriceSet?.shopMoney?.amount || '0'),
        ...(item.customAttributes ? { customAttributes: item.customAttributes } : {}),
        ...(item.discountAllocations ? { discountAllocations: item.discountAllocations } : {})
    };
}

async function completeLineItems(env, orderId, connection, graphQL = coordinatorGraphQL) {
    const items = (connection?.nodes || []).map(normalizeLineItem);
    let pageInfo = connection?.pageInfo || { hasNextPage: false, endCursor: null };
    while (pageInfo.hasNextPage) {
        const result = await graphQL(env, ORDER_LINE_ITEMS_QUERY, { id: orderId, after: pageInfo.endCursor }, 'PrintMOOrderLineItems');
        const next = result.data?.order?.lineItems;
        if (!next) return { items, complete: false, errors: result.errors || [] };
        items.push(...(next.nodes || []).map(normalizeLineItem));
        pageInfo = next.pageInfo || { hasNextPage: false, endCursor: null };
    }
    return { items, complete: true, errors: [] };
}

async function normalizeShopifySummary(env, node, resultErrors = [], graphQL = coordinatorGraphQL) {
    const now = new Date();
    const lines = await completeLineItems(env, node.id, node.lineItems, graphQL);
    const currency = node.currencyCode || node.currentTotalPriceSet?.shopMoney?.currencyCode || null;
    const errors = [...resultErrors, ...lines.errors].map(error => ({ message: error.message, code: error?.extensions?.code || null }));
    return {
        id: node.id,
        displayName: node.name,
        createdAt: node.createdAt,
        shopifyUpdatedAt: node.updatedAt,
        customer: { displayName: node.customer?.displayName || null },
        commerce: {
            financialStatus: node.displayFinancialStatus || null,
            fulfillmentStatus: node.displayFulfillmentStatus || null,
            cancelledAt: node.cancelledAt || null,
            currencyCode: currency,
            subtotal: moneyValue(node.currentSubtotalPriceSet, currency)?.amount || null,
            total: moneyValue(node.currentTotalPriceSet, currency)?.amount || null,
            currentLineItemQuantity: Number(node.currentSubtotalLineItemsQuantity || 0),
            lineItemsComplete: lines.complete,
            lineItems: lines.items
        },
        sync: {
            fetchedAt: now.toISOString(),
            freshUntil: new Date(now.getTime() + 60000).toISOString(),
            hardExpiresAt: new Date(now.getTime() + 86400000).toISOString(),
            stale: false,
            partial: errors.length > 0 || !lines.complete,
            cacheRevision: now.getTime(),
            errors
        }
    };
}

async function storeSummaries(env, summaries) {
    if (!summaries.length) return;
    await upstreamDataRequest(env, '/order-manager/v1/data/cache/summaries', {
        method: 'POST', body: JSON.stringify({ shop: shopDomain(env), summaries })
    });
}

async function refreshSummaries(env, gids, graphQL = coordinatorGraphQL) {
    const valid = [...new Set(gids.map(canonicalOrderGid).filter(Boolean))];
    const summaries = [];
    for (let index = 0; index < valid.length; index += 20) {
        const chunk = valid.slice(index, index + 20);
        const result = await graphQL(env, ORDER_SUMMARIES_QUERY, { ids: chunk }, 'PrintMOOrderSummaries');
        const data = requireShopifyData(result, 'PrintMOOrderSummaries');
        for (const node of data.nodes || []) {
            if (node?.id) summaries.push(await normalizeShopifySummary(env, node, result.errors || [], graphQL));
        }
    }
    await storeSummaries(env, summaries);
    return summaries;
}

async function refreshThroughCoordinator(env, gids) {
    if (!env.ORDER_SYNC_COORDINATOR) return refreshSummaries(env, gids, coordinatorGraphQL);
    const id = env.ORDER_SYNC_COORDINATOR.idFromName(shopDomain(env));
    const response = await env.ORDER_SYNC_COORDINATOR.get(id).fetch(new Request('https://internal/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gids })
    }));
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || 'Shopify refresh failed');
    return body.summaries || [];
}

function computeProductionDiff(summary, snapshot) {
    if (!snapshot || !summary?.commerce) return [];
    const reasons = [];
    const before = new Map((snapshot.lineItems || []).map(item => [item.id, item]));
    const live = new Map((summary.commerce.lineItems || []).map(item => [item.id, item]));
    for (const [id, item] of live) {
        const prior = before.get(id);
        if (!prior) reasons.push('LINE_ITEM_ADDED');
        else {
            if ((prior.sku || null) !== (item.sku || null)) reasons.push('SKU_CHANGED');
            if (Number(item.currentQuantity) > Number(prior.currentQuantity)) reasons.push('QUANTITY_INCREASED');
            if (Number(item.currentQuantity) < Number(prior.currentQuantity)) reasons.push('QUANTITY_DECREASED');
        }
    }
    for (const id of before.keys()) if (!live.has(id)) reasons.push('LINE_ITEM_REMOVED');
    if (summary.commerce.cancelledAt) reasons.push('ORDER_CANCELLED');
    if (String(summary.commerce.financialStatus || '').includes('REFUND')) reasons.push('ORDER_REFUNDED');
    return [...new Set(reasons)];
}

async function handleShopifyPreviewOrdersGet(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 50);
        const forceRefresh = url.searchParams.get('refresh') === '1';
        const cacheKey = `${shopDomain(env)}:${limit}`;
        const cached = shopifyPreviewCache.get(cacheKey);
        if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
            return jsonResponse({ ...cached.payload, cached: true }, allowOrigin, reqAllowHeaders);
        }

        const result = await coordinatorGraphQL(
            env,
            SHOPIFY_PREVIEW_ORDERS_QUERY,
            { first: limit },
            'PrintMOShopifyPreviewOrders'
        );
        const connection = requireShopifyData(result, 'PrintMOShopifyPreviewOrders').orders;
        const fetchedAt = new Date().toISOString();
        const data = (connection?.nodes || []).map(node => ({
            id: node.id,
            displayName: node.name,
            createdAt: node.createdAt,
            shopifyUpdatedAt: node.updatedAt,
            customer: { displayName: node.customer?.displayName || null },
            commerce: {
                financialStatus: node.displayFinancialStatus || null,
                fulfillmentStatus: node.displayFulfillmentStatus || null,
                cancelledAt: node.cancelledAt || null,
                currencyCode: node.currencyCode || node.currentTotalPriceSet?.shopMoney?.currencyCode || null,
                subtotal: node.currentSubtotalPriceSet?.shopMoney?.amount || null,
                total: node.currentTotalPriceSet?.shopMoney?.amount || null,
                currentLineItemQuantity: Number(node.currentSubtotalLineItemsQuantity || 0)
            }
        }));
        const payload = {
            source: 'shopify-admin-graphql',
            readOnly: true,
            cached: false,
            fetchedAt,
            apiVersion: result.apiVersion || SHOPIFY_API_VERSION,
            data,
            pageInfo: {
                returned: data.length,
                hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
                limit
            },
            errors: (result.errors || []).map(error => ({
                code: error?.extensions?.code || null,
                message: error?.message || 'Shopify returned a partial error'
            }))
        };
        shopifyPreviewCache.set(cacheKey, { payload, expiresAt: Date.now() + SHOPIFY_PREVIEW_TTL_MS });
        return jsonResponse(payload, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 502);
    }
}

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

function normalizePreviewDiscount(discount) {
    const value = discount?.value || null;
    return {
        type: discount?.__typename || 'DiscountApplication',
        label: discount?.code || discount?.title || discount?.description || 'Discount',
        code: discount?.code || null,
        description: discount?.description || null,
        allocationMethod: discount?.allocationMethod || null,
        targetSelection: discount?.targetSelection || null,
        targetType: discount?.targetType || null,
        value: value?.__typename === 'MoneyV2'
            ? { type: 'money', amount: String(value.amount), currencyCode: value.currencyCode }
            : value?.__typename === 'PricingPercentageValue'
                ? { type: 'percentage', percentage: Number(value.percentage) }
                : null
    };
}

function normalizePreviewLineItem(item, fallbackCurrency) {
    return {
        id: item.id,
        variantId: item.variant?.id || null,
        sku: item.sku || null,
        title: item.title || '',
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
        discountAllocations: (item.discountAllocations || []).map(allocation =>
            moneyValue(allocation.allocatedAmountSet, fallbackCurrency)
        ).filter(Boolean)
    };
}

async function completePreviewLineItems(env, orderId, connection, fallbackCurrency) {
    const items = (connection?.nodes || []).map(item => normalizePreviewLineItem(item, fallbackCurrency));
    const errors = [];
    let pageInfo = connection?.pageInfo || { hasNextPage: false, endCursor: null };
    while (pageInfo.hasNextPage) {
        const result = await coordinatorGraphQL(
            env,
            SHOPIFY_PREVIEW_ORDER_LINE_ITEMS_QUERY,
            { id: orderId, after: pageInfo.endCursor },
            'PrintMOShopifyPreviewOrderLineItems'
        );
        errors.push(...(result.errors || []));
        const next = result.data?.order?.lineItems;
        if (!next) return { items, complete: false, errors };
        items.push(...(next.nodes || []).map(item => normalizePreviewLineItem(item, fallbackCurrency)));
        pageInfo = next.pageInfo || { hasNextPage: false, endCursor: null };
    }
    return { items, complete: true, errors };
}

function previewError(error) {
    return {
        code: error?.extensions?.code || null,
        message: error?.message || 'Shopify returned a partial error',
        path: Array.isArray(error?.path) ? error.path : []
    };
}

async function handleShopifyPreviewOrderDetailGet(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const url = new URL(request.url);
        const prefix = '/order-manager/v1/shopify-preview/orders/';
        const rawId = decodeURIComponent(url.pathname.slice(prefix.length));
        const gid = canonicalOrderGid(rawId);
        if (!gid) return v1Error({ code: 'INVALID_ORDER_ID', message: 'A valid Shopify order ID is required' }, allowOrigin, reqAllowHeaders, 400);

        const forceRefresh = url.searchParams.get('refresh') === '1';
        const cacheKey = `detail:${shopDomain(env)}:${gid}`;
        const cached = shopifyPreviewCache.get(cacheKey);
        if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
            return jsonResponse({ ...cached.payload, cached: true }, allowOrigin, reqAllowHeaders);
        }

        const result = await coordinatorGraphQL(
            env,
            SHOPIFY_PREVIEW_ORDER_DETAIL_QUERY,
            { id: gid },
            'PrintMOShopifyPreviewOrderDetail'
        );
        const order = requireShopifyData(result, 'PrintMOShopifyPreviewOrderDetail').order;
        if (!order) return v1Error({ code: 'ORDER_NOT_FOUND', message: 'Shopify order was not found' }, allowOrigin, reqAllowHeaders, 404);

        const currency = order.currencyCode || order.currentTotalPriceSet?.shopMoney?.currencyCode || null;
        const lineItems = await completePreviewLineItems(env, gid, order.lineItems, currency);
        const rawErrors = [...(result.errors || []), ...lineItems.errors];
        const identityReturned = Boolean(
            order.customer?.displayName || order.customer?.email || order.customer?.phone ||
            order.email || order.phone || order.shippingAddress?.name || order.billingAddress?.name
        );
        const protectedDataError = rawErrors.some(error => {
            const message = String(error?.message || '').toLowerCase();
            const path = Array.isArray(error?.path) ? error.path.join('.').toLowerCase() : '';
            return message.includes('protected customer') ||
                (error?.extensions?.code === 'ACCESS_DENIED' && /customer|email|phone|address/.test(path || message));
        });

        const payload = {
            source: 'shopify-admin-graphql',
            readOnly: true,
            cached: false,
            fetchedAt: new Date().toISOString(),
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
                    displayName: order.customer?.displayName || null,
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
                    transactions: (order.transactions || []).map(transaction => ({
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
                    shippingLines: (order.shippingLines?.nodes || []).map(line => ({
                        id: line.id,
                        title: line.title,
                        code: line.code || null,
                        source: line.source || null,
                        deliveryCategory: line.deliveryCategory || null,
                        custom: Boolean(line.custom),
                        originalPrice: moneyValue(line.originalPriceSet, currency),
                        currentPrice: moneyValue(line.currentDiscountedPriceSet, currency),
                        discountAllocations: (line.discountAllocations || []).map(allocation =>
                            moneyValue(allocation.allocatedAmountSet, currency)
                        ).filter(Boolean)
                    })),
                    fulfillmentOrders: (order.fulfillmentOrders?.nodes || []).map(fulfillmentOrder => ({
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
                    fulfillments: (order.fulfillments || []).map(fulfillment => ({
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
                timeline: (order.events?.nodes || []).map(event => ({
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

function boardDto(record) {
    const production = record.production || { stage: 'received', version: 0, assets: [] };
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
            attention: { required: false, reasons: [], acknowledgedAt: null },
            sync: { fetchedAt: null, freshUntil: null, hardExpiresAt: null, stale: true, partial: true, errors: [{ code: 'SHOPIFY_UNAVAILABLE', message: 'Live Shopify fields are unavailable.' }] }
        };
    }
    const reasons = computeProductionDiff(summary, production.productionSnapshot);
    return {
        ...summary,
        production,
        attention: { required: reasons.length > 0, reasons, acknowledgedAt: null }
    };
}

async function loadDataPage(env, stage, limit, offset) {
    const query = new URLSearchParams({ shop: shopDomain(env), limit: String(limit), offset: String(offset) });
    if (stage) query.set('stage', stage);
    return upstreamDataRequest(env, `/order-manager/v1/data/orders?${query}`);
}

async function handleV1OrdersGet(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const url = new URL(request.url);
        const stage = url.searchParams.get('stage') || '';
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 50);
        const filter = JSON.stringify({ stage, limit });
        const offset = await decodeSignedCursor(url.searchParams.get('cursor'), filter, env);
        let page = await loadDataPage(env, stage, limit, offset);
        const staleGids = (page.records || []).filter(record => {
            const summary = record.summary;
            return !summary || summary.sync?.stale || !summary.sync?.freshUntil || Date.parse(summary.sync.freshUntil) <= Date.now();
        }).map(record => record.gid);
        if (staleGids.length) {
            try {
                await refreshThroughCoordinator(env, staleGids);
                page = await loadDataPage(env, stage, limit, offset);
            } catch (error) {
                console.error('Shopify summary refresh failed:', error.message);
            }
        }
        const nextCursor = page.nextOffset === null ? null : await encodeSignedCursor({ v: 1, filter, offset: page.nextOffset }, env);
        return jsonResponse({ data: (page.records || []).map(boardDto), pageInfo: { nextCursor, total: page.total } }, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
    }
}

function orderIdFromV1Path(pathname) {
    const raw = pathname.replace(/^\/order-manager\/v1\/orders\//, '').replace(/\/production$/, '');
    try { return canonicalOrderGid(decodeURIComponent(raw)); } catch { return null; }
}

async function fetchOrderDetail(env, gid) {
    let result = await coordinatorGraphQL(env, ORDER_DETAIL_QUERY, { id: gid, after: null }, 'PrintMOOrderDetail');
    const node = requireShopifyData(result, 'PrintMOOrderDetail').order;
    if (!node) throw Object.assign(new Error('Shopify order not found'), { status: 404, code: 'ORDER_NOT_FOUND' });
    const lines = await completeLineItems(env, gid, node.lineItems, coordinatorGraphQL);
    const summary = await normalizeShopifySummary(env, { ...node, lineItems: { nodes: lines.items.map(item => ({
        ...item,
        variant: { id: item.variantId },
        originalUnitPriceSet: { shopMoney: { amount: item.unitPrice, currencyCode: node.currencyCode } }
    })), pageInfo: { hasNextPage: false } } }, result.errors || [], coordinatorGraphQL);
    const now = Date.now();
    const detail = {
        id: gid,
        summary,
        orderNote: node.note || null,
        shippingAddress: node.shippingAddress || null,
        fulfillments: node.fulfillments || [],
        lineItems: lines.items,
        fetchedAt: new Date(now).toISOString(),
        freshUntil: new Date(now + 300000).toISOString(),
        hardExpiresAt: new Date(now + 900000).toISOString(),
        partial: !lines.complete || (result.errors || []).length > 0,
        errors: result.errors || []
    };
    await upstreamDataRequest(env, '/order-manager/v1/data/cache/details', {
        method: 'POST', body: JSON.stringify({ shop: shopDomain(env), detail })
    });
    return detail;
}

async function handleV1OrderDetailGet(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const gid = orderIdFromV1Path(new URL(request.url).pathname);
        if (!gid) return v1Error({ code: 'INVALID_ORDER_ID', message: 'Invalid Shopify order GID' }, allowOrigin, reqAllowHeaders, 400);
        const id = numericIdFromGid(gid);
        let record = await upstreamDataRequest(env, `/order-manager/v1/data/orders/${id}?shop=${encodeURIComponent(shopDomain(env))}`);
        let detail = record.detail;
        if (!detail || !detail.freshUntil || Date.parse(detail.freshUntil) <= Date.now()) {
            try { detail = await fetchOrderDetail(env, gid); } catch (error) {
                if (!detail || !detail.hardExpiresAt || Date.parse(detail.hardExpiresAt) <= Date.now()) throw error;
                detail = { ...detail, stale: true, errors: [...(detail.errors || []), { message: error.message, code: 'STALE_FALLBACK' }] };
            }
            record = await upstreamDataRequest(env, `/order-manager/v1/data/orders/${id}?shop=${encodeURIComponent(shopDomain(env))}`);
        }
        return jsonResponse({ ...boardDto(record), detail: detail || record.detail }, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
    }
}

async function handleV1ProductionGet(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const gid = orderIdFromV1Path(new URL(request.url).pathname);
        if (!gid) return v1Error({ code: 'INVALID_ORDER_ID', message: 'Invalid Shopify order GID' }, allowOrigin, reqAllowHeaders, 400);
        const record = await upstreamDataRequest(
            env,
            `/order-manager/v1/data/orders/${numericIdFromGid(gid)}?shop=${encodeURIComponent(shopDomain(env))}`
        );
        return jsonResponse({ gid, production: record.production }, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error.body?.error || error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
    }
}

async function handleV1ProductionPatch(request, env, allowOrigin, reqAllowHeaders, identity) {
    try {
        const gid = orderIdFromV1Path(new URL(request.url).pathname);
        if (!gid) return v1Error({ code: 'INVALID_ORDER_ID', message: 'Invalid Shopify order GID' }, allowOrigin, reqAllowHeaders, 400);
        const body = await request.json();
        const result = await upstreamDataRequest(env, `/order-manager/v1/data/orders/${numericIdFromGid(gid)}/production`, {
            method: 'PATCH',
            body: JSON.stringify({ ...body, shop: shopDomain(env), actor: identity?.subject || 'unknown' })
        });
        return jsonResponse(result, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error.body?.error || error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
    }
}

function assetIdFromPath(pathname) {
    return decodeURIComponent(pathname.replace(/^\/order-manager\/v1\/assets\//, '').replace(/\/(read-ticket|read)$/, ''));
}

async function signAssetTicket(payload, env) {
    const encoded = base64UrlEncode(JSON.stringify(payload));
    return `${encoded}.${await hmacBase64Url(encoded, env.SHOPIFY_API_SECRET)}`;
}

async function verifyAssetTicket(ticket, env) {
    const [payload, signature] = String(ticket || '').split('.');
    if (!payload || !signature || signature !== await hmacBase64Url(payload, env.SHOPIFY_API_SECRET)) return null;
    const value = decodeJsonBase64Url(payload);
    return Number(value.exp) >= Math.floor(Date.now() / 1000) ? value : null;
}

async function handleV1AssetReadTicket(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const assetId = assetIdFromPath(new URL(request.url).pathname);
        const asset = await upstreamDataRequest(env, `/order-manager/v1/data/assets/${encodeURIComponent(assetId)}?shop=${encodeURIComponent(shopDomain(env))}`);
        const ticket = await signAssetTicket({ assetId, key: asset.objectKey, exp: Math.floor(Date.now() / 1000) + 60 }, env);
        return jsonResponse({ assetId, url: `/order-manager/v1/assets/${encodeURIComponent(assetId)}/read?ticket=${encodeURIComponent(ticket)}`, expiresIn: 60 }, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
    }
}

async function handleV1AssetRead(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const url = new URL(request.url);
        const assetId = assetIdFromPath(url.pathname);
        const ticket = await verifyAssetTicket(url.searchParams.get('ticket'), env);
        if (!ticket || ticket.assetId !== assetId) return v1Error({ code: 'INVALID_ASSET_TICKET', message: 'Asset ticket is invalid or expired' }, allowOrigin, reqAllowHeaders, 401);
        if (!env.R2_BUCKET) return v1Error({ code: 'R2_NOT_CONFIGURED', message: 'Private artwork storage is not configured' }, allowOrigin, reqAllowHeaders, 503);
        const object = await env.R2_BUCKET.get(ticket.key);
        if (!object) return v1Error({ code: 'ASSET_NOT_FOUND', message: 'Asset object was not found' }, allowOrigin, reqAllowHeaders, 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('ETag', object.httpEtag);
        headers.set('Cache-Control', 'private, no-store');
        for (const [key, value] of Object.entries(corsHeaders(allowOrigin, reqAllowHeaders))) headers.set(key, value);
        return new Response(object.body, { headers });
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
    }
}

async function verifyWebhookHmacSafe(rawBytes, header, secret) {
    if (!header || !secret) return false;
    try {
        const expected = Uint8Array.from(atob(header), character => character.charCodeAt(0));
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        return crypto.subtle.verify('HMAC', key, expected, rawBytes);
    } catch { return false; }
}

async function forwardPaidWebhookToLegacyQueue(request, rawBytes, env) {
    const upstreamBase = String(env.UPSTREAM_BASE || '').replace(/\/+$/, '');
    if (!upstreamBase) throw Object.assign(new Error('Render legacy ingestion is not configured'), { status: 503 });
    const headers = new Headers({ 'Content-Type': request.headers.get('Content-Type') || 'application/json' });
    for (const name of ['X-Shopify-Hmac-Sha256', 'X-Shopify-Shop-Domain', 'X-Shopify-Webhook-Id', 'X-Shopify-Topic']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    const response = await fetch(`${upstreamBase}/webhooks/orders/paid`, { method: 'POST', headers, body: rawBytes });
    if (!response.ok) {
        throw Object.assign(new Error(`Legacy queue ingestion failed with HTTP ${response.status}`), { status: 502 });
    }
}

async function handleShopifyWebhook(request, env, allowOrigin, reqAllowHeaders, ctx) {
    try {
        const rawBytes = await request.arrayBuffer();
        const secret = env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_API_SECRET;
        const valid = await verifyWebhookHmacSafe(rawBytes, request.headers.get('X-Shopify-Hmac-Sha256'), secret);
        if (!valid) return v1Error({ code: 'INVALID_WEBHOOK_HMAC', message: 'Webhook signature verification failed' }, allowOrigin, reqAllowHeaders, 401);
        const headerShop = String(request.headers.get('X-Shopify-Shop-Domain') || shopDomain(env)).toLowerCase();
        if (headerShop !== shopDomain(env)) return v1Error({ code: 'INVALID_WEBHOOK_SHOP', message: 'Webhook shop is not authorized' }, allowOrigin, reqAllowHeaders, 403);
        const webhookId = request.headers.get('X-Shopify-Webhook-Id');
        if (!webhookId) return v1Error({ code: 'MISSING_WEBHOOK_ID', message: 'Webhook delivery ID is required' }, allowOrigin, reqAllowHeaders, 400);
        const payload = JSON.parse(new TextDecoder().decode(rawBytes));
        const topic = request.headers.get('X-Shopify-Topic') || '';
        if (topic === 'orders/paid') {
            // Phase 2 remains shadow-only: preserve the authoritative legacy ingestion path.
            // The Render endpoint is idempotent, so retries and any overlapping old subscription are safe.
            await forwardPaidWebhookToLegacyQueue(request, rawBytes, env);
        }
        const dedupe = await upstreamDataRequest(env, '/order-manager/v1/data/webhooks/dedupe', {
            method: 'POST', body: JSON.stringify({ shop: shopDomain(env), webhookId })
        });
        if (!dedupe.accepted) return jsonResponse({ ok: true, duplicate: true }, allowOrigin, reqAllowHeaders);
        const gid = canonicalOrderGid(payload.admin_graphql_api_id || payload.order_id || payload.id);
        if (gid && topic === 'orders/paid') {
            const legacy = { status: 'received', name: payload.name || `#${payload.order_number || payload.id}`, orderNumber: String(payload.order_number || '').replace('#', ''), receivedAt: payload.created_at };
            await upstreamDataRequest(env, '/order-manager/v1/data/project', {
                method: 'POST', body: JSON.stringify({ shop: shopDomain(env), gid, legacy, preserveExistingStage: true })
            });
            for (const key of [legacy.name, legacy.orderNumber].filter(Boolean)) {
                await upstreamDataRequest(env, '/order-manager/v1/data/mappings', {
                    method: 'POST', body: JSON.stringify({ shop: shopDomain(env), legacyKey: key, gid, ledger: { matchResult: 'webhook' } })
                });
            }
        }
        if (gid) {
            await upstreamDataRequest(env, '/order-manager/v1/data/cache/dirty', {
                method: 'POST', body: JSON.stringify({ shop: shopDomain(env), gids: [gid] })
            });
            const refresh = refreshThroughCoordinator(env, [gid]).catch(error => console.error('Webhook refresh failed:', error.message));
            if (ctx?.waitUntil) ctx.waitUntil(refresh);
        }
        return jsonResponse({ ok: true }, allowOrigin, reqAllowHeaders);
    } catch (error) {
        console.error('Shopify webhook error:', error.message);
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
    }
}

async function handleV1ParityCheck(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const report = await upstreamDataRequest(env, '/order-manager/v1/data/parity', {
            method: 'POST', body: JSON.stringify({ shop: shopDomain(env) })
        });
        return jsonResponse(report, allowOrigin, reqAllowHeaders);
    } catch (error) { return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500); }
}

async function handleV1ParityReport(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const report = await upstreamDataRequest(env, `/order-manager/v1/data/parity/reports?shop=${encodeURIComponent(shopDomain(env))}`);
        return jsonResponse(report, allowOrigin, reqAllowHeaders);
    } catch (error) { return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500); }
}

function legacyOrderNumber(order) {
    const value = String(order?.orderNumber || order?.name || '').trim();
    const match = /#?(\d+)/.exec(value);
    return match ? match[1] : null;
}

async function matchLegacyOrder(env, legacy) {
    const direct = canonicalOrderGid(legacy?.admin_graphql_api_id);
    if (direct) return { gid: direct, matchResult: 'admin_graphql_api_id' };
    const number = legacyOrderNumber(legacy);
    if (!number) return { gid: null, matchResult: 'missing_identifier' };
    const expectedName = `#${number}`;
    const result = await coordinatorGraphQL(env, ORDER_SEARCH_QUERY, { query: `name:${expectedName}` }, 'PrintMOOrderSearch');
    const exact = (requireShopifyData(result, 'PrintMOOrderSearch').orders?.nodes || []).filter(order => order.name === expectedName);
    return exact.length === 1
        ? { gid: exact[0].id, matchResult: 'unique_order_name' }
        : { gid: null, matchResult: exact.length > 1 ? 'ambiguous_order_name' : 'not_found' };
}

function safeAssetName(value) {
    return String(value || 'attachment').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'attachment';
}

async function stableAssetId(value) {
    return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))).slice(0, 24);
}

async function migrateLegacyAssets(env, gid, legacy, execute) {
    const orderId = numericIdFromGid(gid);
    const manifests = [];
    for (const item of Array.isArray(legacy.items) ? legacy.items : []) {
        for (const asset of Array.isArray(item?.assets) ? item.assets : []) {
            if (!asset?.key) continue;
            const name = safeAssetName(String(asset.key).split('/').pop());
            const assetId = await stableAssetId(`${gid}:${asset.key}`);
            const objectKey = `orders/${orderId}/assets/${assetId}/${name}`;
            let byteSize = null;
            let sha256 = null;
            if (execute) {
                if (!env.R2_BUCKET) throw new Error('R2_BUCKET is required to migrate legacy artwork');
                if (!asset.url || !String(asset.url).startsWith('https://')) throw new Error(`Legacy artwork URL is missing for ${name}`);
                const source = await fetch(asset.url);
                if (!source.ok) throw new Error(`Unable to read legacy artwork ${name}: HTTP ${source.status}`);
                const bytes = new Uint8Array(await source.arrayBuffer());
                if (bytes.byteLength > 50 * 1024 * 1024) throw new Error(`Legacy artwork ${name} exceeds the 50 MiB migration limit`);
                byteSize = bytes.byteLength;
                sha256 = bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
                await env.R2_BUCKET.put(objectKey, bytes, {
                    httpMetadata: { contentType: source.headers.get('Content-Type') || asset.contentType || 'application/octet-stream' },
                    customMetadata: { sha256, legacyKey: asset.key }
                });
            }
            manifests.push({
                assetId,
                objectKey,
                name,
                contentType: asset.contentType || (asset.ext ? `image/${asset.ext === 'jpg' ? 'jpeg' : asset.ext}` : null),
                byteSize,
                sha256,
                migrationState: execute ? 'verified' : 'planned'
            });
        }
    }
    for (const attachment of Array.isArray(legacy.attachments) ? legacy.attachments : []) {
        const raw = attachment?.data || attachment?.base64 || attachment?.content;
        if (!raw) continue;
        const encoded = String(raw).replace(/^data:[^;]+;base64,/, '');
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('Legacy attachment exceeds the 50 MiB migration limit');
        const name = safeAssetName(attachment.name || attachment.filename);
        const assetId = await stableAssetId(`${gid}:${name}:${bytes.byteLength}`);
        const objectKey = `orders/${orderId}/assets/${assetId}/${name}`;
        const sha256 = bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
        if (execute) {
            if (!env.R2_BUCKET) throw new Error('R2_BUCKET is required to migrate Base64 attachments');
            await env.R2_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: attachment.type || attachment.contentType || 'application/octet-stream' }, customMetadata: { sha256 } });
        }
        manifests.push({ assetId, objectKey, name, contentType: attachment.type || attachment.contentType || null, byteSize: bytes.byteLength, sha256, migrationState: execute ? 'verified' : 'planned' });
    }
    return manifests;
}

async function handleV1MigrationRun(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const body = await request.json().catch(() => ({}));
        const execute = body.execute === true;
        const includeAssets = body.includeAssets === true;
        if (execute && body.confirmShop !== shopDomain(env)) {
            return v1Error({ code: 'MIGRATION_CONFIRMATION_REQUIRED', message: 'Execution requires confirmShop to exactly match the configured Shopify domain.' }, allowOrigin, reqAllowHeaders, 400);
        }
        const limit = Math.min(Math.max(Number(body.limit || 1), 1), 5);
        const offset = Math.max(Number(body.offset || 0), 0);
        const page = await upstreamDataRequest(env, `/order-manager/v1/data/legacy?offset=${offset}&limit=${limit}`);
        const report = {
            execute,
            includeAssets,
            projectionMode: includeAssets ? 'metadata_and_assets' : 'metadata_only',
            offset,
            total: page.total,
            matched: 0,
            migrated: 0,
            quarantined: 0,
            errors: [],
            nextOffset: page.nextOffset
        };
        for (const legacy of page.records || []) {
            const source = JSON.stringify(legacy);
            const sourceDigest = bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
            const identifier = legacy.orderNumber || String(legacy.name || '').split(/[–-]/)[0].trim();
            try {
                const match = await matchLegacyOrder(env, legacy);
                if (!match.gid) {
                    report.quarantined++;
                    if (execute) await upstreamDataRequest(env, '/order-manager/v1/data/quarantine', {
                        method: 'POST', body: JSON.stringify({ shop: shopDomain(env), sourceDigest, legacyIdentifier: identifier, reason: match.matchResult })
                    });
                    continue;
                }
                report.matched++;
                if (!execute) continue;
                const summaries = await refreshThroughCoordinator(env, [match.gid]);
                const assets = includeAssets ? await migrateLegacyAssets(env, match.gid, legacy, true) : [];
                const keys = [...new Set([identifier, legacy.orderNumber, legacy.name, `source:${sourceDigest}`].filter(Boolean))];
                for (const key of keys) await upstreamDataRequest(env, '/order-manager/v1/data/mappings', {
                    method: 'POST',
                    body: JSON.stringify({ shop: shopDomain(env), legacyKey: key, gid: match.gid, ledger: { matchResult: match.matchResult, assetCount: assets.length, assetChecksums: assets.map(asset => asset.sha256).filter(Boolean) } })
                });
                await upstreamDataRequest(env, '/order-manager/v1/data/project', {
                    method: 'POST',
                    body: JSON.stringify({
                        shop: shopDomain(env),
                        gid: match.gid,
                        legacy: includeAssets ? { ...legacy, v1Assets: assets } : legacy,
                        commerce: summaries[0] || null
                    })
                });
                report.migrated++;
            } catch (error) {
                report.errors.push({ orderIdentifier: identifier || 'unknown', code: 'MIGRATION_ERROR', message: error.message });
            }
        }
        return jsonResponse(report, allowOrigin, reqAllowHeaders);
    } catch (error) { return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500); }
}

export class OrderSyncCoordinator {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.throttle = { currentlyAvailable: 1000, maximumAvailable: 1000, restoreRate: 50, updatedAt: Date.now() };
        this.estimates = new Map();
        this.inflightRefreshes = new Map();
    }

    async reserve(operationName) {
        const now = Date.now();
        const elapsed = Math.max(0, now - this.throttle.updatedAt) / 1000;
        this.throttle.currentlyAvailable = Math.min(this.throttle.maximumAvailable, this.throttle.currentlyAvailable + elapsed * this.throttle.restoreRate);
        this.throttle.updatedAt = now;
        const estimate = Math.max(Number(this.estimates.get(operationName) || 50), 1);
        if (this.throttle.currentlyAvailable < estimate) {
            await sleepMs(((estimate - this.throttle.currentlyAvailable) / Math.max(this.throttle.restoreRate, 1)) * 1000 + Math.random() * 200);
        }
        this.throttle.currentlyAvailable = Math.max(0, this.throttle.currentlyAvailable - estimate);
    }

    observe(operationName, result) {
        const cost = result.extensions?.cost;
        if (Number.isFinite(cost?.requestedQueryCost)) this.estimates.set(operationName, cost.requestedQueryCost);
        if (cost?.throttleStatus) this.throttle = { ...cost.throttleStatus, updatedAt: Date.now() };
        if (result.apiVersion && result.apiVersion !== SHOPIFY_API_VERSION) console.error(`Shopify API version fall-forward: requested ${SHOPIFY_API_VERSION}, received ${result.apiVersion}`);
    }

    async graphql(query, variables, operationName = 'AnonymousQuery') {
        let last;
        for (let attempt = 0; attempt < 3; attempt++) {
            await this.reserve(operationName);
            last = await performShopifyGraphQL(this.env, query, variables, operationName);
            this.observe(operationName, last);
            if (!isThrottled(last)) return last;
            const throttle = last.extensions?.cost?.throttleStatus || this.throttle;
            const cost = Number(last.extensions?.cost?.requestedQueryCost || this.estimates.get(operationName) || 50);
            await sleepMs(((Math.max(cost - Number(throttle.currentlyAvailable || 0), 1) / Math.max(Number(throttle.restoreRate || 50), 1)) * 1000) + Math.random() * 250);
        }
        return last;
    }

    async refresh(gids) {
        const key = [...new Set(gids)].sort().join(',');
        if (this.inflightRefreshes.has(key)) return this.inflightRefreshes.get(key);
        const promise = refreshSummaries(this.env, gids, (_env, query, variables, operationName) => this.graphql(query, variables, operationName))
            .finally(() => this.inflightRefreshes.delete(key));
        this.inflightRefreshes.set(key, promise);
        return promise;
    }

    async reconcileIncremental() {
        const checkpointResult = await upstreamDataRequest(this.env, `/order-manager/v1/data/checkpoint?shop=${encodeURIComponent(shopDomain(this.env))}`);
        const checkpoint = checkpointResult.checkpoint ? Date.parse(checkpointResult.checkpoint) : Date.now() - 300000;
        const overlap = new Date(checkpoint - 120000).toISOString();
        let after = null;
        let newest = checkpoint;
        const gids = [];
        do {
            const result = await this.graphql(UPDATED_ORDERS_QUERY, { query: `updated_at:>='${overlap}'`, after }, 'PrintMOUpdatedOrders');
            const connection = result.data?.orders;
            if (!connection) throw new Error('Incremental reconciliation returned no orders connection');
            for (const order of connection.nodes || []) {
                gids.push(order.id);
                newest = Math.max(newest, Date.parse(order.updatedAt) || newest);
                if (order.displayFinancialStatus === 'PAID') {
                    await upstreamDataRequest(this.env, '/order-manager/v1/data/project', {
                        method: 'POST', body: JSON.stringify({
                            shop: shopDomain(this.env),
                            gid: order.id,
                            legacy: { status: 'received', name: order.name, receivedAt: order.createdAt },
                            preserveExistingStage: true
                        })
                    });
                }
            }
            after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
        } while (after);
        if (gids.length) await this.refresh(gids);
        await upstreamDataRequest(this.env, '/order-manager/v1/data/checkpoint', {
            method: 'POST', body: JSON.stringify({ shop: shopDomain(this.env), checkpoint: new Date(newest).toISOString() })
        });
        return { ok: true, refreshed: gids.length, checkpoint: new Date(newest).toISOString() };
    }

    async reconcileIntegrity() {
        const integrity = await upstreamDataRequest(this.env, '/order-manager/v1/data/integrity', {
            method: 'POST', body: JSON.stringify({ shop: shopDomain(this.env) })
        });
        const parity = await upstreamDataRequest(this.env, '/order-manager/v1/data/parity', {
            method: 'POST', body: JSON.stringify({ shop: shopDomain(this.env) })
        });
        return { ok: true, integrity, parity };
    }

    async fetch(request) {
        try {
            const url = new URL(request.url);
            if (url.pathname === '/graphql' && request.method === 'POST') {
                const body = await request.json();
                return Response.json(await this.graphql(body.query, body.variables, body.operationName));
            }
            if (url.pathname === '/refresh' && request.method === 'POST') {
                const body = await request.json();
                return Response.json({ summaries: await this.refresh(body.gids || []) });
            }
            if (url.pathname === '/reconcile-incremental') return Response.json(await this.reconcileIncremental());
            if (url.pathname === '/reconcile-integrity') return Response.json(await this.reconcileIntegrity());
            return new Response('Not Found', { status: 404 });
        } catch (error) {
            return Response.json({ error: error.message }, { status: error.status || 500 });
        }
    }
}
