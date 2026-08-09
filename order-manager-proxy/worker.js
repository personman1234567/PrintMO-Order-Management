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

        // EARLY UNAUTHENTICATED ROUTES: provider signatures are the only
        // authorization. Neither route accepts browser bearer credentials.
        if (url.pathname === "/order-manager/v1/webhooks/shopify" && request.method === "POST") {
            return handleShopifyWebhook(request, env, allowOrigin || origin || "*", reqAllowHeaders, ctx);
        }
        if (url.pathname === ETSY_WEBHOOK_PATH) {
            if (request.method !== "POST") {
                return etsyWebhookResponse({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }, 405, { Allow: 'POST' });
            }
            return handleEtsyWebhook(request, env, ctx);
        }

        // EARLY UNAUTHENTICATED ROUTE: Etsy returns the OAuth authorization
        // code here. Single-use state + PKCE authorize this callback; it never
        // returns or logs token values.
        if (url.pathname === "/order-manager/v1/oauth/etsy/callback" && request.method === "GET") {
            return handleEtsyOauthCallback(request, env);
        }

        // The signed one-minute ticket is the authorization for cross-origin
        // image-tag reads. Its payload contains only the opaque manifest ID.
        if (url.pathname.startsWith("/order-manager/v1/assets/") && url.pathname.endsWith("/read") && request.method === "GET") {
            return handleV1AssetRead(request, env, allowOrigin || origin || "*", reqAllowHeaders);
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
        // ETSY CONNECTION PROBE
        // -----------------------------
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

        if (url.pathname === "/order-manager/v1/integrations/etsy/shadow-sync" && request.method === "POST") {
            return handleEtsyShadowSync(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
        }

        if (url.pathname === "/order-manager/v1/integrations/etsy/synthetic-order" && ["POST", "DELETE"].includes(request.method)) {
            return handleEtsySyntheticOrder(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
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
            return handleV1OrdersGet(request, env, allowOrigin || origin || "*", reqAllowHeaders, ctx);
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

        if (url.pathname === "/order-manager/v1/batches/commit" && request.method === "POST") {
            return handleV1BatchCommit(request, env, allowOrigin || origin || "*", reqAllowHeaders, identity);
        }

        if (url.pathname === "/order-manager/v1/assets/read-tickets" && request.method === "POST") {
            return handleV1AssetReadTickets(request, env, allowOrigin || origin || "*", reqAllowHeaders);
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
                ctx.waitUntil(
                    restoreLegacySnapshotPositions(env)
                        .then(() => coordinator.fetch(new Request("https://internal/reconcile-incremental")))
                        .catch(err => console.error("Legacy position catch-up or incremental reconciliation error:", err))
                );
                ctx.waitUntil(backfillDesignerStudioAssets(env).catch(err => console.error("Designer Studio asset backfill error:", err)));
            } else if (event.cron === "0 2 * * *") {
                ctx.waitUntil(coordinator.fetch(new Request("https://internal/reconcile-integrity")).catch(err => console.error("Cron integrity error:", err)));
            }
        }
        if (event.cron === "*/5 * * * *") {
            ctx.waitUntil(runEtsyWebhookMaintenance(env, 'incremental').catch(err => {
                console.error('Etsy webhook maintenance error:', String(err?.code || 'ETSY_MAINTENANCE_FAILED'));
            }));
        } else if (event.cron === "0 2 * * *") {
            ctx.waitUntil(runEtsyWebhookMaintenance(env, 'integrity').catch(err => {
                console.error('Etsy webhook integrity error:', String(err?.code || 'ETSY_INTEGRITY_FAILED'));
            }));
        }
    }
};

function pickAllowOrigin(origin, env) {
    if (!origin) return ""; // curl/server-to-server has no Origin

    let parsedOrigin;
    try { parsedOrigin = new URL(origin); } catch (_) { return ""; }
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.username || parsedOrigin.password
        || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) return "";
    const normalizedOrigin = parsedOrigin.origin;

    if (normalizedOrigin === "https://extensions.shopifycdn.com") return normalizedOrigin;

    const exact = (env.ALLOW_ORIGIN_EXACT || "").replace(/\/+$/, "");
    const suffix = (env.ALLOW_ORIGIN_SUFFIX || "").trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\./, '');

    // exact allow
    if (exact && normalizedOrigin === exact) return normalizedOrigin;

    // Hostname-boundary suffix allow (e.g. an explicitly configured Pages
    // project family). Raw string suffix matching can accept attacker-owned
    // lookalike hosts such as evil-example.pages.dev.
    const hostname = parsedOrigin.hostname.toLowerCase();
    if (suffix && (hostname === suffix || hostname.endsWith(`.${suffix}`))) return normalizedOrigin;

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

function isBatchGarmentItem(item) {
    return !isBatchPrintItem(item) && Boolean(safeText(item?.sku, 120));
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

        const orderId = safeText(rawOrder?.orderId || rawOrder?.gid || rawOrder?.id, 240);
        const parts = batchOrderParts(name);
        const orderNumber = safeText(rawOrder?.orderNumber, 80) || parts.number;
        const customer = safeText(rawOrder?.customer, 160) || parts.customer;
        const receivedAt = safeText(rawOrder?.receivedAt, 80);
        let garmentCount = 0;

        const items = Array.isArray(rawOrder?.items) ? rawOrder.items : [];
        items.forEach((item, index) => {
            if (!item || !isBatchGarmentItem(item)) return;

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
                orderId,
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
            orderId,
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
        orderIds: orders.map(order => order.orderId).filter(Boolean),
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
        orderIds: Array.isArray(batch.orderIds)
            ? batch.orderIds
            : (Array.isArray(batch.orders) ? batch.orders.map(order => order?.orderId).filter(Boolean) : []),
        orderCount: batch.totals?.orderCount || 0,
        manifestLineCount: batch.totals?.manifestLineCount || 0,
        expectedGarments: batch.totals?.expectedGarments || 0,
        receivedGarments: batch.totals?.receivedGarments || 0,
        missingGarments: batch.totals?.missingGarments || 0,
    };
}

function blanksBatchOrderIdentity(order) {
    const orderId = safeText(order?.orderId || order?.gid || order?.id, 240);
    if (orderId) return `id:${orderId}`;
    const name = safeText(order?.name || order?.orderName, 240);
    return name ? `name:${name}` : "";
}

function blanksBatchOrderIdentities(orders) {
    return new Set((Array.isArray(orders) ? orders : [])
        .map(blanksBatchOrderIdentity)
        .filter(Boolean));
}

function batchContainsIncomingOrder(batch, incomingOrder) {
    const incomingIdentity = blanksBatchOrderIdentity(incomingOrder);
    if (!incomingIdentity) return false;
    return (Array.isArray(batch?.orders) ? batch.orders : []).some(order => {
        const storedIdentity = blanksBatchOrderIdentity(order);
        if (storedIdentity === incomingIdentity) return true;
        if (storedIdentity.startsWith("id:") && incomingIdentity.startsWith("id:")) return false;
        // Batch records created before orderId existed still match by order name.
        return safeText(order?.name, 240) === safeText(incomingOrder?.name || incomingOrder?.orderName, 240);
    });
}

function indexEntryContainsIncomingOrder(entry, incomingOrder) {
    const orderId = safeText(incomingOrder?.orderId || incomingOrder?.gid || incomingOrder?.id, 240);
    const name = safeText(incomingOrder?.name || incomingOrder?.orderName, 240);
    return Boolean(
        (orderId && (Array.isArray(entry?.orderIds) ? entry.orderIds : []).includes(orderId))
        || (name && (Array.isArray(entry?.orderNames) ? entry.orderNames : []).includes(name))
    );
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
    const result = removeIncomingOrdersFromBatch(batch, orderNames.map(name => ({ name })));
    if (!result.removedCount) return { ok: false, error: "No matching batch orders found" };
    return { ok: true, batch: result.batch, removedCount: result.removedCount };
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

    const duplicateOrders = addBatch.orders.filter(order => batchContainsIncomingOrder(batch, order));
    if (duplicateOrders.length === addBatch.orders.length) {
        return { ok: false, error: "All provided orders are already in this batch" };
    }

    const duplicateIdentities = blanksBatchOrderIdentities(duplicateOrders);
    const incomingOrders = addBatch.orders.filter(order => !duplicateIdentities.has(blanksBatchOrderIdentity(order)));
    const allowedNames = new Set(incomingOrders.map(order => order.name));
    batch.orders = [
        ...(Array.isArray(batch.orders) ? batch.orders : []),
        ...incomingOrders,
    ];
    batch.orderNames = batch.orders.map(order => order.name).filter(Boolean);
    batch.orderIds = batch.orders.map(order => order.orderId).filter(Boolean);

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
        duplicateNames: duplicateOrders.map(order => order.name),
    };
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function removeIncomingOrdersFromBatch(batch, incomingOrders) {
    const matchingOrders = (Array.isArray(batch?.orders) ? batch.orders : [])
        .filter(order => incomingOrders.some(incoming => batchContainsIncomingOrder({ orders: [order] }, incoming)));
    if (!matchingOrders.length) return { batch, removedCount: 0, movedReceivedByItemKey: new Map() };

    const identities = blanksBatchOrderIdentities(matchingOrders);
    const names = new Set(matchingOrders.map(order => order.name).filter(Boolean));
    const matchesStoredOrder = value => {
        const identity = blanksBatchOrderIdentity(value);
        return Boolean((identity && identities.has(identity)) || names.has(value?.name || value?.orderName));
    };
    const movedReceivedByItemKey = new Map();

    batch.orders = (Array.isArray(batch.orders) ? batch.orders : []).filter(order => !matchesStoredOrder(order));
    batch.orderNames = batch.orders.map(order => order.name).filter(Boolean);
    batch.orderIds = batch.orders.map(order => order.orderId).filter(Boolean);
    batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : []).map(line => {
        const orderLines = Array.isArray(line.orderLines) ? line.orderLines : [];
        const removedLines = orderLines.filter(orderLine => matchesStoredOrder({
            orderId: orderLine?.orderId,
            name: orderLine?.orderName,
        }));
        const movedReceived = removedLines.reduce((sum, orderLine) => {
            return sum + Math.max(0, Number(orderLine?.accountedQty) || 0);
        }, 0);
        if (movedReceived) {
            movedReceivedByItemKey.set(line.itemKey, (movedReceivedByItemKey.get(line.itemKey) || 0) + movedReceived);
        }
        const keptLines = orderLines.filter(orderLine => !removedLines.includes(orderLine));
        return {
            ...line,
            expectedQty: keptLines.reduce((sum, orderLine) => sum + Math.max(0, Number(orderLine?.expectedQty) || 0), 0),
            receivedQty: Math.max(0, (Number(line.receivedQty) || 0) - movedReceived),
            orderLines: keptLines,
        };
    }).filter(line => (Number(line.expectedQty) || 0) > 0);

    return {
        batch: applyOldestFirstAllocation(batch),
        removedCount: matchingOrders.length,
        movedReceivedByItemKey,
    };
}

function applyTransferredReceiving(batch, movedReceivedByItemKey, incomingOrders) {
    const incomingBatch = buildBlanksBatch({ orders: incomingOrders });
    const incomingExpectedByKey = new Map((incomingBatch.manifest || []).map(line => [
        line.itemKey,
        Math.max(0, Number(line.expectedQty) || 0),
    ]));
    batch.manifest = (Array.isArray(batch.manifest) ? batch.manifest : []).map(line => {
        const transferred = Math.min(
            incomingExpectedByKey.get(line.itemKey) || 0,
            movedReceivedByItemKey.get(line.itemKey) || 0
        );
        return transferred ? { ...line, receivedQty: (Number(line.receivedQty) || 0) + transferred } : line;
    });
    return applyOldestFirstAllocation(batch);
}

async function assignOrdersToBatch(env, targetBatch, body) {
    const incomingOrders = Array.isArray(body?.orders) ? body.orders : [];
    const incomingBatch = buildBlanksBatch({
        orders: incomingOrders,
        source: "manual-batch-assignment",
    });
    if (!incomingBatch.orders.length) return { ok: false, error: "At least one order is required" };
    if (!incomingBatch.manifest.length || !incomingBatch.totals.expectedGarments) {
        return { ok: false, error: "Orders have no garment line items" };
    }

    const newOrders = incomingOrders.filter(order => !batchContainsIncomingOrder(targetBatch, order));
    if (!newOrders.length) return { ok: false, error: "All provided orders are already in this batch" };

    const originalIndex = await readBlanksBatchIndex(env);
    const sourceEntries = originalIndex.batches.filter(entry => {
        return entry?.id !== targetBatch.id && newOrders.some(order => indexEntryContainsIncomingOrder(entry, order));
    });
    const sources = [];
    for (const entry of sourceEntries) {
        const source = await readBlanksBatch(env, entry.id);
        if (source && newOrders.some(order => batchContainsIncomingOrder(source, order))) sources.push(source);
    }

    const originals = new Map([[targetBatch.id, cloneJson(targetBatch)]]);
    sources.forEach(source => originals.set(source.id, cloneJson(source)));
    const movedReceivedByItemKey = new Map();
    const affectedBatches = [];
    const emptiedBatchIds = [];

    sources.forEach(source => {
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
    const changedIds = new Set(changedBatches.map(batch => batch.id));
    const removedIds = new Set(emptiedBatchIds);
    const nextIndex = {
        ...originalIndex,
        batches: originalIndex.batches
            .filter(entry => !changedIds.has(entry?.id) && !removedIds.has(entry?.id))
            .concat(changedBatches.map(blanksBatchIndexEntry))
            .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))),
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
            movedFromBatchIds: sources.map(source => source.id),
            indexUpdatedAt: writtenIndex.updatedAt,
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
//  - { id, action: "assign-orders", orders: [] }
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

        const currentIndex = await readBlanksBatchIndex(env);
        const duplicateEntries = currentIndex.batches.filter(entry => {
            return batch.orders.some(order => indexEntryContainsIncomingOrder(entry, order));
        });
        if (duplicateEntries.length) {
            return jsonResponse({
                error: {
                    code: "ORDER_ALREADY_BATCHED",
                    message: "One or more orders already belong to a receiving batch. Add or move them from the existing batch instead.",
                    batchIds: duplicateEntries.map(entry => entry.id),
                },
            }, allowOrigin, reqAllowHeaders, 409);
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

        const action = safeText(body?.action, 80);
        const result = action === "assign-orders"
            ? await assignOrdersToBatch(env, batch, body)
            : applyBatchOrderAction(batch, body);
        if (!result.ok) {
            return jsonResponse({ error: result.error }, allowOrigin, reqAllowHeaders, 400);
        }

        if (action === "assign-orders") {
            return jsonResponse(result, allowOrigin, reqAllowHeaders, 200);
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
// SHOPIFY-PRIMARY DATA PLANE
// Shopify owns commerce and the canonical app-owned production metafield.
// D1 owns the rebuildable board projection and app-only durable records.
// Redis remains reachable only through the explicitly named legacy routes until
// the final cutover flag is switched; candidate routes below never use it.
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
      currentTotalDiscountsSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { firstName lastName displayName }
      shippingAddress { name }
      billingAddress { name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SHOPIFY_PREVIEW_ORDER_DETAIL_QUERY = `query PrintMOShopifyPreviewOrderDetail($id: ID!) {
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
      currentTotalDiscountsSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      shippingAddress { name }
      billingAddress { name }
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

const ORDER_LINE_ITEMS_QUERY = `query PrintMOOrderLineItems($id: ID!, $after: String) {
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

const ORDER_DETAIL_QUERY = `query PrintMOOrderDetail($id: ID!, $after: String) {
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
    fulfillmentOrders(first: 10) { nodes { id status requestStatus fulfillAt fulfillBy deliveryMethod { id methodType presentedName serviceCode minDeliveryDateTime maxDeliveryDateTime } } }
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

const ORDER_DETAIL_LINE_ITEMS_QUERY = `query PrintMOOrderDetailLineItems($id: ID!, $after: String) {
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

const ORDER_SEARCH_QUERY = `query PrintMOOrderSearch($query: String!) {
  orders(first: 5, query: $query) { nodes { id name createdAt updatedAt displayFinancialStatus } }
}`;

const UPDATED_ORDERS_QUERY = `query PrintMOUpdatedOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: UPDATED_AT, query: $query) {
    nodes {
      id name createdAt updatedAt cancelledAt closedAt
      displayFinancialStatus displayFulfillmentStatus
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
const PRODUCTION_METAFIELD_NAMESPACE = '$app:printmo';
const PRODUCTION_METAFIELD_KEY = 'production_state_v1';
const BOOTSTRAP_ORDERS_QUERY = `query PrintMOBootstrapOrders($query: String!, $first: Int!) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
    nodes {
      id name createdAt updatedAt displayFinancialStatus
      metafield(namespace: "${PRODUCTION_METAFIELD_NAMESPACE}", key: "${PRODUCTION_METAFIELD_KEY}") {
        id namespace key type value compareDigest createdAt updatedAt
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const PRODUCTION_STAGES = new Set(['received', 'to_order', 'blanks_cart', 'blanks_ordered', 'print', 'completed']);
const PRODUCTION_STATE_QUERY = `query PrintMOProductionState($id: ID!) {
  order(id: $id) {
    id name createdAt updatedAt
    lineItems(first: 50) {
      nodes {
        id sku title quantity currentQuantity
      }
      pageInfo { hasNextPage endCursor }
    }
    metafield(namespace: "${PRODUCTION_METAFIELD_NAMESPACE}", key: "${PRODUCTION_METAFIELD_KEY}") {
      id namespace key type value compareDigest createdAt updatedAt
    }
  }
}`;
const PRODUCTION_STATE_MUTATION = `mutation PrintMOSetProductionState($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value compareDigest createdAt updatedAt }
    userErrors { field message code }
  }
}`;

function requireOrderDb(env) {
    if (!env.ORDER_DB) {
        throw Object.assign(new Error('The Redis-free order database is not configured.'), {
            code: 'ORDER_DB_NOT_CONFIGURED',
            status: 503
        });
    }
    return env.ORDER_DB;
}

function isoNow() {
    return new Date().toISOString();
}

const ETSY_CONNECTION_ID = 'primary';
const ETSY_OAUTH_SCOPE = 'transactions_r';
const ETSY_OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;
const ETSY_ACCESS_REFRESH_SKEW_MS = 60 * 1000;
const ETSY_AUTHORIZATION_URL = 'https://www.etsy.com/oauth/connect';
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const ETSY_API_BASE_URL = 'https://api.etsy.com/v3/application';
const ETSY_API_PING_URL = `${ETSY_API_BASE_URL}/openapi-ping`;
const ETSY_FIELD_SHAPE_VERSION = 1;
const ETSY_FIELD_SHAPE_MAX_DEPTH = 8;
const ETSY_FIELD_SHAPE_MAX_ENTRIES = 300;
const ETSY_FIELD_SHAPE_ARRAY_SAMPLE = 5;
const SAFE_JSON_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ETSY_SYNTHETIC_EXTERNAL_ID = 'synthetic-pilot-1';
const ETSY_SYNTHETIC_CONFIRM_CREATE = 'CREATE_LIVE_ETSY_TEST_ORDER';
const ETSY_SYNTHETIC_CONFIRM_DELETE = 'DELETE_LIVE_ETSY_TEST_ORDER';
const ETSY_WEBHOOK_PATH = '/order-manager/v1/webhooks/etsy';
const ETSY_WEBHOOK_EVENT = 'order.paid';
const ETSY_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
const ETSY_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
const ETSY_WEBHOOK_MAX_ATTEMPTS = 8;
const ETSY_WEBHOOK_PROCESSING_LEASE_MS = 10 * 60 * 1000;
const ETSY_WEBHOOK_RETRY_DELAYS_SECONDS = Object.freeze([300, 900, 1800, 7200, 18000, 36000, 36000, 86400]);
const ETSY_RECONCILIATION_CHECKPOINT = 'etsy-webhook-reconciliation-v1';
const ETSY_RECONCILIATION_LIMIT = 25;
const ETSY_RECONCILIATION_OVERLAP_SECONDS = 15 * 60;
const ETSY_RECONCILIATION_INITIAL_SECONDS = 24 * 60 * 60;
const ETSY_RECONCILIATION_INTEGRITY_SECONDS = 30 * 24 * 60 * 60;
const ETSY_WEBHOOK_ALLOWED_HOSTS = new Set(['api.etsy.com', 'openapi.etsy.com']);

function etsyWebhookError(code, message, status = 400) {
    return Object.assign(new Error(message), { code, status });
}

function etsyWebhookResponse(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            ...extraHeaders
        }
    });
}

function decodeBase64Standard(value, code = 'ETSY_WEBHOOK_SECRET_INVALID') {
    const normalized = String(value || '').trim();
    if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
        throw etsyWebhookError(code, 'Etsy webhook base64 material is invalid.', 503);
    }
    try {
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    } catch (_) {
        throw etsyWebhookError(code, 'Etsy webhook base64 material is invalid.', 503);
    }
}

function etsyWebhookSecretBytes(value) {
    const encoded = String(value || '').trim();
    if (!encoded.startsWith('whsec_')) {
        throw etsyWebhookError('ETSY_WEBHOOK_SECRET_INVALID', 'Etsy webhook signing secret is invalid.', 503);
    }
    const bytes = decodeBase64Standard(encoded.slice('whsec_'.length));
    if (bytes.byteLength < 16 || bytes.byteLength > 128) {
        throw etsyWebhookError('ETSY_WEBHOOK_SECRET_INVALID', 'Etsy webhook signing secret has an invalid length.', 503);
    }
    return bytes;
}

function etsyWebhookSecrets(env, { required = true } = {}) {
    const current = String(env.ETSY_WEBHOOK_SECRET || '').trim();
    const previous = String(env.ETSY_WEBHOOK_SECRET_PREVIOUS || '').trim();
    if (!current) {
        if (!required) return [];
        throw etsyWebhookError('ETSY_WEBHOOK_NOT_CONFIGURED', 'Etsy webhook signing is not configured.', 503);
    }
    return [current, previous].filter(Boolean).map(etsyWebhookSecretBytes);
}

function etsyWebhookSignatureValues(header) {
    return String(header || '').trim().split(/\s+/).map(entry => {
        const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(entry);
        if (!match) return null;
        try { return decodeBase64Standard(match[1], 'ETSY_WEBHOOK_SIGNATURE_INVALID'); } catch (_) { return null; }
    }).filter(Boolean);
}

async function sha256BytesHex(bytes) {
    return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
}

async function verifyEtsyWebhookSignature(rawBytes, headers, env, nowSeconds = Math.floor(Date.now() / 1000)) {
    const webhookId = String(headers.get('webhook-id') || '').trim();
    const timestampValue = String(headers.get('webhook-timestamp') || '').trim();
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(webhookId)) {
        throw etsyWebhookError('ETSY_WEBHOOK_ID_INVALID', 'Etsy webhook delivery ID is missing or invalid.', 400);
    }
    if (!/^\d{10,13}$/.test(timestampValue)) {
        throw etsyWebhookError('ETSY_WEBHOOK_TIMESTAMP_INVALID', 'Etsy webhook timestamp is missing or invalid.', 400);
    }
    const timestamp = Number(timestampValue);
    if (!Number.isSafeInteger(timestamp)
        || Math.abs(nowSeconds - timestamp) > ETSY_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
        throw etsyWebhookError('ETSY_WEBHOOK_TIMESTAMP_STALE', 'Etsy webhook timestamp is outside the replay window.', 401);
    }
    const signatures = etsyWebhookSignatureValues(headers.get('webhook-signature'));
    if (!signatures.length) {
        throw etsyWebhookError('ETSY_WEBHOOK_SIGNATURE_INVALID', 'Etsy webhook signature is missing or invalid.', 401);
    }
    const prefix = new TextEncoder().encode(`${webhookId}.${timestampValue}.`);
    const signedContent = new Uint8Array(prefix.byteLength + rawBytes.byteLength);
    signedContent.set(prefix, 0);
    signedContent.set(rawBytes, prefix.byteLength);
    const secrets = etsyWebhookSecrets(env);
    for (const secret of secrets) {
        const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        for (const signature of signatures) {
            if (await crypto.subtle.verify('HMAC', key, signature, signedContent)) {
                return { webhookId, timestamp, timestampValue };
            }
        }
    }
    throw etsyWebhookError('ETSY_WEBHOOK_SIGNATURE_INVALID', 'Etsy webhook signature verification failed.', 401);
}

function parseEtsyWebhookResource(value, expectedShopId) {
    let parsed;
    try { parsed = new URL(String(value || '')); } catch (_) {}
    if (!parsed || parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password
        || parsed.search || parsed.hash || !ETSY_WEBHOOK_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
        throw etsyWebhookError('ETSY_WEBHOOK_RESOURCE_INVALID', 'Etsy webhook resource URL is invalid.', 400);
    }
    const match = /^\/v3\/application\/shops\/(\d+)\/receipts\/(\d+)$/.exec(parsed.pathname);
    if (!match || match[1] !== String(expectedShopId)) {
        throw etsyWebhookError('ETSY_WEBHOOK_RESOURCE_INVALID', 'Etsy webhook resource does not match the authorized shop.', 403);
    }
    return { shopId: match[1], receiptId: etsyNumericIdentity(match[2], 'receipt ID') };
}

function etsyConfig(env) {
    const keystring = String(env.ETSY_API_KEY || '').trim();
    const sharedSecret = String(env.ETSY_SHARED_SECRET || '').trim();
    const redirectUri = String(env.ETSY_REDIRECT_URI || '').trim();
    if (!keystring || !sharedSecret) {
        throw Object.assign(new Error('Etsy API credentials are not configured.'), {
            code: 'ETSY_NOT_CONFIGURED',
            status: 503
        });
    }
    let parsedRedirect;
    try { parsedRedirect = new URL(redirectUri); } catch (_) {}
    if (!parsedRedirect || parsedRedirect.protocol !== 'https:'
        || parsedRedirect.pathname !== '/order-manager/v1/oauth/etsy/callback'
        || parsedRedirect.search || parsedRedirect.hash) {
        throw Object.assign(new Error('ETSY_REDIRECT_URI must be the exact HTTPS Etsy callback URL.'), {
            code: 'ETSY_REDIRECT_URI_INVALID',
            status: 503
        });
    }
    return { keystring, sharedSecret, redirectUri };
}

function randomBase64Url(byteLength = 32) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

async function sha256Hex(value) {
    return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

async function etsyEncryptionKey(env) {
    const encoded = String(env.ETSY_TOKEN_ENCRYPTION_KEY || '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
        throw Object.assign(new Error('Etsy token encryption is not configured.'), {
            code: 'ETSY_ENCRYPTION_NOT_CONFIGURED',
            status: 503
        });
    }
    const bytes = decodeBase64Url(encoded);
    if (bytes.byteLength !== 32) {
        throw Object.assign(new Error('ETSY_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.'), {
            code: 'ETSY_ENCRYPTION_KEY_INVALID',
            status: 503
        });
    }
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptEtsySecret(env, value) {
    const key = await etsyEncryptionKey(env);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
    return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

async function decryptEtsySecret(env, encoded) {
    const [version, ivEncoded, ciphertextEncoded] = String(encoded || '').split('.');
    if (version !== 'v1' || !ivEncoded || !ciphertextEncoded) {
        throw Object.assign(new Error('Stored Etsy credentials are unreadable.'), {
            code: 'ETSY_CREDENTIALS_INVALID',
            status: 503
        });
    }
    try {
        const key = await etsyEncryptionKey(env);
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: decodeBase64Url(ivEncoded) },
            key,
            decodeBase64Url(ciphertextEncoded)
        );
        return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (error) {
        if (error?.code) throw error;
        throw Object.assign(new Error('Stored Etsy credentials could not be decrypted.'), {
            code: 'ETSY_CREDENTIALS_INVALID',
            status: 503
        });
    }
}

function etsyApiHeaders(config, accessToken) {
    const headers = {
        Accept: 'application/json',
        'x-api-key': `${config.keystring}:${config.sharedSecret}`
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
}

async function verifyEtsyApiCredentials(env) {
    const config = etsyConfig(env);
    const response = await fetch(ETSY_API_PING_URL, {
        headers: etsyApiHeaders(config)
    });
    if (!response.ok) {
        throw Object.assign(new Error(`Etsy rejected the configured API key with HTTP ${response.status}.`), {
            code: 'ETSY_API_KEY_INVALID',
            status: response.status >= 500 ? 502 : response.status
        });
    }
}

async function etsyJson(response, code) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        throw Object.assign(new Error(`Etsy request failed with HTTP ${response.status}.`), {
            code,
            upstreamStatus: response.status,
            retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(Math.ceil(retryAfter), 86400) : null,
            status: response.status >= 500 ? 502 : response.status
        });
    }
    return body;
}

async function etsyAuthorizedJson(env, url, code, connection = null) {
    let active = connection || await freshEtsyConnection(env, false);
    const request = () => fetch(url, {
        headers: etsyApiHeaders(etsyConfig(env), active.accessToken)
    });
    let response = await request();
    if (response.status === 401) {
        active = await freshEtsyConnection(env, true);
        response = await request();
    }
    return { body: await etsyJson(response, code), connection: active };
}

async function requestEtsyToken(env, params) {
    const config = etsyConfig(env);
    const response = await fetch(ETSY_TOKEN_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-api-key': `${config.keystring}:${config.sharedSecret}`
        },
        body: new URLSearchParams(params)
    });
    const token = await etsyJson(response, 'ETSY_TOKEN_EXCHANGE_FAILED');
    if (!token.access_token || token.token_type !== 'Bearer' || !Number.isFinite(Number(token.expires_in))) {
        throw Object.assign(new Error('Etsy returned an invalid OAuth token response.'), {
            code: 'ETSY_TOKEN_RESPONSE_INVALID',
            status: 502
        });
    }
    return token;
}

function etsyUserIdFromAccessToken(accessToken) {
    const match = /^(\d+)\./.exec(String(accessToken || ''));
    if (!match) {
        throw Object.assign(new Error('Etsy access token does not contain an owner ID.'), {
            code: 'ETSY_TOKEN_RESPONSE_INVALID',
            status: 502
        });
    }
    return match[1];
}

function requireEtsyScope(scope) {
    const scopes = new Set(String(scope || '').split(/\s+/).filter(Boolean));
    if (!scopes.has(ETSY_OAUTH_SCOPE)) {
        throw Object.assign(new Error('Etsy did not grant the required read-only transaction scope.'), {
            code: 'ETSY_SCOPE_MISSING',
            status: 403
        });
    }
    return [...scopes].sort().join(' ');
}

async function etsyShopForUser(env, userId, accessToken) {
    const config = etsyConfig(env);
    const response = await fetch(`${ETSY_API_BASE_URL}/users/${encodeURIComponent(userId)}/shops`, {
        headers: etsyApiHeaders(config, accessToken)
    });
    const shop = await etsyJson(response, 'ETSY_SHOP_READ_FAILED');
    if (!shop.shop_id || !shop.shop_name) {
        throw Object.assign(new Error('Etsy did not return a shop owned by the authorized user.'), {
            code: 'ETSY_SHOP_NOT_FOUND',
            status: 404
        });
    }
    return shop;
}

async function persistEtsyConnection(env, { token, scope, actorId, userId, shop }) {
    const now = isoNow();
    const expiresAt = new Date(Date.now() + Number(token.expires_in) * 1000).toISOString();
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
        ETSY_CONNECTION_ID, String(userId), String(shop.shop_id), String(shop.shop_name),
        scope, tokenCiphertext, expiresAt, actorId, now, now
    ).run();
}

async function loadEtsyConnection(env) {
    const row = await requireOrderDb(env).prepare('SELECT * FROM etsy_connections WHERE id = ?')
        .bind(ETSY_CONNECTION_ID).first();
    if (!row) {
        throw Object.assign(new Error('Etsy has not been connected yet.'), {
            code: 'ETSY_NOT_CONNECTED',
            status: 409
        });
    }
    return row;
}

async function freshEtsyConnection(env, forceRefresh = false) {
    const row = await loadEtsyConnection(env);
    const stored = await decryptEtsySecret(env, row.token_ciphertext);
    let accessToken = stored.accessToken;
    let refreshToken = stored.refreshToken;
    let refreshed = false;
    if (forceRefresh || Date.parse(row.access_expires_at) <= Date.now() + ETSY_ACCESS_REFRESH_SKEW_MS) {
        if (!refreshToken) {
            throw Object.assign(new Error('Etsy must be reconnected because no refresh token is available.'), {
                code: 'ETSY_REFRESH_TOKEN_MISSING',
                status: 409
            });
        }
        const config = etsyConfig(env);
        const token = await requestEtsyToken(env, {
            grant_type: 'refresh_token',
            client_id: config.keystring,
            refresh_token: refreshToken
        });
        const scope = requireEtsyScope(token.scope || row.scope);
        accessToken = token.access_token;
        refreshToken = token.refresh_token || refreshToken;
        const tokenCiphertext = await encryptEtsySecret(env, { accessToken, refreshToken });
        const updatedAt = isoNow();
        const accessExpiresAt = new Date(Date.now() + Number(token.expires_in) * 1000).toISOString();
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

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function etsyCallbackPage(status, title, message) {
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>You can close this window and return to Print-MO Order Manager.</p></main></body></html>`, {
        status,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

async function handleEtsyConnect(request, env, allowOrigin, reqAllowHeaders, identity) {
    try {
        const config = etsyConfig(env);
        await verifyEtsyApiCredentials(env);
        const db = requireOrderDb(env);
        const state = randomBase64Url(32);
        const verifier = randomBase64Url(64);
        const stateHash = await sha256Hex(state);
        const challenge = base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        const now = isoNow();
        const expiresAt = new Date(Date.now() + ETSY_OAUTH_SESSION_TTL_MS).toISOString();
        const actorId = `${identity.kind}:${identity.subject}`;
        const encryptedVerifier = await encryptEtsySecret(env, { verifier });
        await db.prepare('DELETE FROM etsy_oauth_sessions WHERE expires_at < ? OR consumed_at IS NOT NULL')
            .bind(now).run();
        await db.prepare(`
          INSERT INTO etsy_oauth_sessions (
            state_hash, code_verifier_ciphertext, redirect_uri, requested_scope,
            actor_id, expires_at, consumed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
        `).bind(stateHash, encryptedVerifier, config.redirectUri, ETSY_OAUTH_SCOPE, actorId, expiresAt, now).run();
        const authorizationUrl = new URL(ETSY_AUTHORIZATION_URL);
        authorizationUrl.search = new URLSearchParams({
            response_type: 'code',
            client_id: config.keystring,
            redirect_uri: config.redirectUri,
            scope: ETSY_OAUTH_SCOPE,
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256'
        }).toString();
        return jsonResponse({
            authorizationUrl: authorizationUrl.toString(),
            callbackUrl: config.redirectUri,
            scope: ETSY_OAUTH_SCOPE,
            expiresIn: Math.floor(ETSY_OAUTH_SESSION_TTL_MS / 1000)
        }, allowOrigin, reqAllowHeaders, 201);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
    }
}

async function handleEtsyOauthCallback(request, env) {
    try {
        const url = new URL(request.url);
        const state = url.searchParams.get('state') || '';
        if (!state) {
            throw Object.assign(new Error('The Etsy callback did not include OAuth state.'), {
                code: 'ETSY_OAUTH_STATE_MISSING',
                status: 400
            });
        }
        const db = requireOrderDb(env);
        const stateHash = await sha256Hex(state);
        const session = await db.prepare('SELECT * FROM etsy_oauth_sessions WHERE state_hash = ?')
            .bind(stateHash).first();
        if (!session || session.consumed_at || Date.parse(session.expires_at) <= Date.now()) {
            throw Object.assign(new Error('The Etsy authorization request is invalid, expired, or already used.'), {
                code: 'ETSY_OAUTH_STATE_INVALID',
                status: 400
            });
        }
        const consumedAt = isoNow();
        const consumed = await db.prepare(`
          UPDATE etsy_oauth_sessions SET consumed_at = ?
          WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?
        `).bind(consumedAt, stateHash, consumedAt).run();
        if (!consumed.meta?.changes) {
            throw Object.assign(new Error('The Etsy authorization request has already been used.'), {
                code: 'ETSY_OAUTH_STATE_INVALID',
                status: 400
            });
        }
        if (url.searchParams.get('error')) {
            return etsyCallbackPage(400, 'Etsy connection was not completed', 'Etsy authorization was denied or canceled.');
        }
        const code = url.searchParams.get('code') || '';
        if (!code) {
            throw Object.assign(new Error('The Etsy callback did not include an authorization code.'), {
                code: 'ETSY_OAUTH_CODE_MISSING',
                status: 400
            });
        }
        const config = etsyConfig(env);
        const { verifier } = await decryptEtsySecret(env, session.code_verifier_ciphertext);
        const token = await requestEtsyToken(env, {
            grant_type: 'authorization_code',
            client_id: config.keystring,
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
        return etsyCallbackPage(200, 'Etsy connected', `${shop.shop_name} is authorized for the read-only connection test.`);
    } catch (error) {
        const errorCode = typeof error?.code === 'string' ? `${error.code}: ` : '';
        return etsyCallbackPage(
            error.status || 500,
            'Etsy connection failed',
            `${errorCode}${error.message || 'The Etsy connection could not be completed.'}`
        );
    }
}

async function handleEtsyStatus(env, allowOrigin, reqAllowHeaders) {
    try {
        const row = await requireOrderDb(env).prepare('SELECT * FROM etsy_connections WHERE id = ?')
            .bind(ETSY_CONNECTION_ID).first();
        if (!row) {
            return jsonResponse({ connected: false, scope: ETSY_OAUTH_SCOPE }, allowOrigin, reqAllowHeaders);
        }
        let lastTest = null;
        try { lastTest = row.last_test_result_json ? JSON.parse(row.last_test_result_json) : null; } catch (_) {}
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

function jsonFieldType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    if (typeof value === 'string' || typeof value === 'boolean') return typeof value;
    if (value && typeof value === 'object') return 'object';
    return 'unknown';
}

function redactedJsonFieldShape(value) {
    const observed = new Map();
    let truncated = false;

    const record = (path, type) => {
        if (!observed.has(path) && observed.size >= ETSY_FIELD_SHAPE_MAX_ENTRIES) {
            truncated = true;
            return false;
        }
        const types = observed.get(path) || new Set();
        types.add(type);
        observed.set(path, types);
        return true;
    };

    const visit = (current, path, depth) => {
        const type = jsonFieldType(current);
        if (!record(path, type)) return;
        if (depth >= ETSY_FIELD_SHAPE_MAX_DEPTH) {
            if (type === 'array' || type === 'object') truncated = true;
            return;
        }
        if (type === 'array') {
            current.slice(0, ETSY_FIELD_SHAPE_ARRAY_SAMPLE).forEach(item => visit(item, `${path}[]`, depth + 1));
            if (current.length > ETSY_FIELD_SHAPE_ARRAY_SAMPLE) truncated = true;
            return;
        }
        if (type !== 'object') return;
        for (const [rawKey, child] of Object.entries(current)) {
            const key = SAFE_JSON_FIELD_NAME.test(rawKey) ? rawKey : '[dynamic-key]';
            visit(child, path === '$' ? key : `${path}.${key}`, depth + 1);
            if (observed.size >= ETSY_FIELD_SHAPE_MAX_ENTRIES) break;
        }
    };

    visit(value, '$', 0);
    return {
        fields: Array.from(observed.entries())
            .map(([path, types]) => ({ path, types: Array.from(types).sort() }))
            .sort((left, right) => left.path.localeCompare(right.path)),
        truncated,
        valuesIncluded: false
    };
}

function etsyNumericIdentity(value, field) {
    const normalized = String(value ?? '').trim();
    if (!/^\d+$/.test(normalized) || normalized === '0') {
        throw Object.assign(new Error(`Etsy ${field} is invalid.`), {
            code: 'ETSY_IDENTITY_INVALID',
            status: 502
        });
    }
    return normalized;
}

function etsyMoney(value) {
    if (!value || typeof value !== 'object') return null;
    const amount = Number(value.amount);
    const divisor = Number(value.divisor);
    if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor <= 0) return null;
    return {
        amount: amount / divisor,
        currencyCode: String(value.currency_code || '').trim().toUpperCase() || null
    };
}

function etsyTimestamp(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const parsed = new Date(seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mergeEtsyTransactions(receipt, transactions) {
    const merged = new Map();
    const apply = (transaction) => {
        if (!transaction || typeof transaction !== 'object') return;
        const id = String(transaction.transaction_id ?? '').trim();
        if (!id) return;
        const next = { ...(merged.get(id) || {}) };
        Object.entries(transaction).forEach(([key, value]) => {
            if (value !== null && value !== undefined) next[key] = value;
        });
        merged.set(id, next);
    };
    (Array.isArray(transactions) ? transactions : []).forEach(transaction => apply(transaction));
    (Array.isArray(receipt?.transactions) ? receipt.transactions : []).forEach(transaction => apply(transaction));
    return Array.from(merged.values());
}

function normalizeEtsyOrderContract({ providerAccountId, receipt, transactions = [], fetchedAt = isoNow() } = {}) {
    const accountId = etsyNumericIdentity(providerAccountId, 'shop ID');
    const receiptId = etsyNumericIdentity(receipt?.receipt_id, 'receipt ID');
    const orderKey = `etsy:${accountId}:${receiptId}`;
    const total = etsyMoney(receipt?.grandtotal) || etsyMoney(receipt?.total_price);
    const subtotal = etsyMoney(receipt?.subtotal);
    const discount = etsyMoney(receipt?.discount_amt);
    const normalizedLines = mergeEtsyTransactions(receipt, transactions).map(transaction => {
        const transactionId = etsyNumericIdentity(transaction.transaction_id, 'transaction ID');
        const variations = (Array.isArray(transaction.variations) ? transaction.variations : []).map(variation => ({
            propertyId: variation?.property_id == null ? null : String(variation.property_id),
            valueId: variation?.value_id == null ? null : String(variation.value_id),
            questionId: variation?.question_id == null ? null : String(variation.question_id),
            name: String(variation?.formatted_name || '').trim(),
            value: String(variation?.formatted_value || '').trim()
        }));
        const linePrice = etsyMoney(transaction.price);
        return {
            id: `${orderKey}:${transactionId}`,
            externalLineId: transactionId,
            listingId: transaction.listing_id == null ? null : String(transaction.listing_id),
            title: String(transaction.title || '').trim() || 'Untitled Etsy item',
            sku: String(transaction.sku || '').trim() || null,
            quantity: Math.max(0, Number(transaction.quantity) || 0),
            unitPrice: linePrice?.amount ?? null,
            currencyCode: linePrice?.currencyCode || total?.currencyCode || subtotal?.currencyCode || null,
            variations,
            personalization: variations.filter(variation => variation.questionId || /personal/i.test(variation.name)),
            expectedShipAt: etsyTimestamp(transaction.expected_ship_date),
            listingImageId: transaction.listing_image_id == null ? null : String(transaction.listing_image_id),
            listingImageIsProductionArtwork: false
        };
    });
    const status = String(receipt?.status || '').trim().toLowerCase();
    const paid = Boolean(receipt?.is_paid ?? receipt?.was_paid ?? status === 'paid');
    const canceled = Boolean(receipt?.is_canceled ?? receipt?.was_canceled ?? ['canceled', 'cancelled'].includes(status));
    const shipped = Boolean(receipt?.is_shipped ?? receipt?.was_shipped);
    return {
        id: orderKey,
        orderKey,
        displayName: receiptId,
        createdAt: etsyTimestamp(receipt?.create_timestamp ?? receipt?.created_timestamp),
        sourceUpdatedAt: etsyTimestamp(receipt?.update_timestamp ?? receipt?.updated_timestamp),
        source: {
            provider: 'etsy',
            label: 'Etsy',
            providerAccountId: accountId,
            externalOrderId: receiptId,
            displayNumber: receiptId,
            adminUrl: null
        },
        customer: { displayName: String(receipt?.name || '').trim() || null },
        commerce: {
            paid,
            canceled,
            shipped,
            delivered: null,
            financialStatus: paid ? 'paid' : (status || 'unknown'),
            fulfillmentStatus: shipped ? 'shipped' : 'unshipped',
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
            authority: 'printmo-d1',
            provider: 'etsy',
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

async function handleEtsyTestRead(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const body = await request.json().catch(() => ({}));
        const connection = await freshEtsyConnection(env, body.forceRefresh === true);
        const config = etsyConfig(env);
        const receiptsResponse = await fetch(
            `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts?limit=1&offset=0`,
            { headers: etsyApiHeaders(config, connection.accessToken) }
        );
        const receipts = await etsyJson(receiptsResponse, 'ETSY_RECEIPT_READ_FAILED');
        const receipt = Array.isArray(receipts.results) ? receipts.results[0] : null;
        let transactionCount = 0;
        let transactionRecords = [];
        if (receipt?.receipt_id) {
            const transactionsResponse = await fetch(
                `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts/${encodeURIComponent(receipt.receipt_id)}/transactions`,
                { headers: etsyApiHeaders(config, connection.accessToken) }
            );
            const transactions = await etsyJson(transactionsResponse, 'ETSY_TRANSACTION_READ_FAILED');
            transactionRecords = Array.isArray(transactions.results) ? transactions.results : [];
            transactionCount = transactionRecords.length || Number(transactions.count || 0);
        }
        const result = {
            ok: true,
            source: 'etsy',
            shop: { id: connection.row.etsy_shop_id, name: connection.row.shop_name },
            scope: connection.row.scope,
            tokenRefreshed: connection.refreshed,
            receiptRead: {
                found: Boolean(receipt),
                paid: Boolean(receipt && (receipt.is_paid ?? receipt.was_paid ?? receipt.status === 'paid')),
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

function etsyShadowEligibility(receipt) {
    const status = String(receipt?.status || '').trim().toLowerCase();
    const paid = Boolean(receipt?.is_paid ?? receipt?.was_paid ?? status === 'paid');
    const canceled = Boolean(receipt?.is_canceled ?? receipt?.was_canceled ?? ['canceled', 'cancelled'].includes(status));
    const shipped = Boolean(receipt?.is_shipped ?? receipt?.was_shipped);
    if (!paid) return { eligible: false, reason: 'NOT_PAID' };
    if (canceled) return { eligible: false, reason: 'CANCELED' };
    if (shipped) return { eligible: false, reason: 'ALREADY_SHIPPED' };
    return { eligible: true, reason: 'PAID_UNSHIPPED' };
}

async function readEtsyReceiptForShadow(env, connection, { receiptId = null } = {}) {
    let receipt;
    let activeConnection = connection;
    if (receiptId) {
        const result = await etsyAuthorizedJson(
            env,
            `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts/${encodeURIComponent(receiptId)}`,
            'ETSY_RECEIPT_READ_FAILED',
            activeConnection
        );
        receipt = result.body;
        activeConnection = result.connection;
    } else {
        const result = await etsyAuthorizedJson(
            env,
            `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts?limit=1&offset=0`,
            'ETSY_RECEIPT_READ_FAILED',
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
        'ETSY_TRANSACTION_READ_FAILED',
        activeConnection
    );
    return {
        receipt,
        transactions: Array.isArray(transactionResult.body.results) ? transactionResult.body.results : []
    };
}

async function persistEtsyShadowOrder(env, contract, eligibility, actorId, { enroll = false } = {}) {
    const db = requireOrderDb(env);
    const shop = await d1Shop(env);
    const now = isoNow();
    const production = defaultProductionState(actorId || 'etsy-shadow');
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
            shop.id, source.provider, source.providerAccountId, source.externalOrderId, contract.orderKey,
            source.displayNumber, contract.createdAt, contract.sourceUpdatedAt, JSON.stringify(contract),
            eligibility.reason, contract.sync.fetchedAt, now, now
        ),
        db.prepare(`
          INSERT INTO provider_production_state (
            shop_id, order_key, provider, provider_account_id, external_order_id,
            revision, last_mutation_id, state_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
          ON CONFLICT(shop_id, order_key) DO NOTHING
        `).bind(
            shop.id, contract.orderKey, source.provider, source.providerAccountId,
            source.externalOrderId, JSON.stringify(production), now, now
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

async function handleEtsyShadowSync(request, env, allowOrigin, reqAllowHeaders, identity) {
    try {
        const body = await request.json().catch(() => ({}));
        const dryRun = body.dryRun === true;
        const latest = body.latest === true;
        const receiptId = body.receiptId == null ? null : etsyNumericIdentity(body.receiptId, 'receipt ID');
        if (!receiptId && !(latest && dryRun)) {
            throw Object.assign(new Error('Shadow persistence requires an explicit Etsy receipt ID. Latest-receipt checks must be dry-run only.'), {
                code: 'ETSY_SHADOW_TARGET_REQUIRED',
                status: 400
            });
        }
        if (receiptId && latest) {
            throw Object.assign(new Error('Choose either an explicit Etsy receipt ID or a latest-receipt dry run.'), {
                code: 'ETSY_SHADOW_TARGET_INVALID',
                status: 400
            });
        }
        const connection = await freshEtsyConnection(env, false);
        const observed = await readEtsyReceiptForShadow(env, connection, { receiptId });
        if (!observed.receipt) {
            return jsonResponse({
                ok: true,
                source: 'etsy',
                found: false,
                eligible: false,
                reason: 'NO_RECEIPT',
                persisted: false,
                boardChanged: false
            }, allowOrigin, reqAllowHeaders);
        }
        const eligibility = etsyShadowEligibility(observed.receipt);
        if (!eligibility.eligible) {
            return jsonResponse({
                ok: true,
                source: 'etsy',
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
                source: 'etsy',
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
        const actorId = String(identity?.sub || identity?.userId || identity?.id || 'etsy-shadow').slice(0, 160);
        const persisted = await persistEtsyShadowOrder(env, contract, eligibility, actorId);
        return jsonResponse({
            ok: true,
            source: 'etsy',
            found: true,
            eligible: true,
            reason: eligibility.reason,
            persisted: true,
            orderKey: contract.orderKey,
            lineCount: contract.commerce.lineItems.length,
            currencyCode: contract.commerce.currencyCode,
            productionRevision: persisted.revision,
            enrollmentState: 'shadow',
            boardChanged: false
        }, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
    }
}

function etsyWebhookEnrollmentEnabled(env) {
    return String(env.ETSY_WEBHOOK_ENROLLMENT_ENABLED || '0').trim() === '1';
}

function etsyWebhookReconciliationEnabled(env) {
    return String(env.ETSY_WEBHOOK_RECONCILIATION_ENABLED || '1').trim() !== '0';
}

async function handleEtsyWebhook(request, env, ctx) {
    try {
        const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
        const contentEncoding = String(request.headers.get('Content-Encoding') || '').trim().toLowerCase();
        const declaredLength = Number(request.headers.get('Content-Length'));
        if (!contentType.startsWith('application/json')) {
            throw etsyWebhookError('ETSY_WEBHOOK_CONTENT_TYPE_INVALID', 'Etsy webhook content type must be JSON.', 415);
        }
        if (contentEncoding && contentEncoding !== 'identity') {
            throw etsyWebhookError('ETSY_WEBHOOK_CONTENT_ENCODING_INVALID', 'Encoded Etsy webhook bodies are not accepted.', 415);
        }
        if (Number.isFinite(declaredLength) && declaredLength > ETSY_WEBHOOK_MAX_BODY_BYTES) {
            throw etsyWebhookError('ETSY_WEBHOOK_BODY_TOO_LARGE', 'Etsy webhook body is too large.', 413);
        }
        const rawBytes = new Uint8Array(await request.arrayBuffer());
        if (!rawBytes.byteLength || rawBytes.byteLength > ETSY_WEBHOOK_MAX_BODY_BYTES) {
            throw etsyWebhookError('ETSY_WEBHOOK_BODY_INVALID', 'Etsy webhook body is empty or too large.', rawBytes.byteLength ? 413 : 400);
        }
        const verified = await verifyEtsyWebhookSignature(rawBytes, request.headers, env);
        let payload;
        try {
            payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes));
        } catch (_) {
            throw etsyWebhookError('ETSY_WEBHOOK_JSON_INVALID', 'Etsy webhook body is not valid JSON.', 400);
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw etsyWebhookError('ETSY_WEBHOOK_PAYLOAD_INVALID', 'Etsy webhook payload is invalid.', 400);
        }
        if (String(payload.event_type || '') !== ETSY_WEBHOOK_EVENT) {
            throw etsyWebhookError('ETSY_WEBHOOK_EVENT_UNSUPPORTED', 'Etsy webhook event is not supported.', 422);
        }
        const connection = await loadEtsyConnection(env);
        const payloadShopId = etsyNumericIdentity(payload.shop_id, 'shop ID');
        if (payloadShopId !== String(connection.etsy_shop_id)) {
            throw etsyWebhookError('ETSY_WEBHOOK_SHOP_INVALID', 'Etsy webhook shop is not authorized.', 403);
        }
        const resource = parseEtsyWebhookResource(payload.resource_url, payloadShopId);
        const bodyHash = await sha256BytesHex(rawBytes);
        const shop = await d1Shop(env);
        const now = isoNow();
        const triggeredAt = new Date(verified.timestamp * 1000).toISOString();
        const insert = await requireOrderDb(env).prepare(`
          INSERT OR IGNORE INTO etsy_webhook_deliveries (
            webhook_id, shop_id, event_type, etsy_shop_id, receipt_id, body_sha256,
            state, outcome_code, error_code, attempt_count, triggered_at,
            received_at, next_attempt_at, processed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'received', NULL, NULL, 0, ?, ?, NULL, NULL, ?)
        `).bind(
            verified.webhookId, shop.id, ETSY_WEBHOOK_EVENT, payloadShopId, resource.receiptId,
            bodyHash, triggeredAt, now, now
        ).run();
        if (!insert.meta?.changes) {
            const existing = await requireOrderDb(env).prepare(`
              SELECT event_type, etsy_shop_id, receipt_id, body_sha256, state
              FROM etsy_webhook_deliveries
              WHERE webhook_id = ?
            `).bind(verified.webhookId).first();
            const sameDelivery = existing
                && existing.event_type === ETSY_WEBHOOK_EVENT
                && existing.etsy_shop_id === payloadShopId
                && existing.receipt_id === resource.receiptId
                && existing.body_sha256 === bodyHash;
            if (!sameDelivery) {
                throw etsyWebhookError('ETSY_WEBHOOK_ID_CONFLICT', 'Etsy webhook delivery ID was reused with different content.', 409);
            }
            return etsyWebhookResponse({ ok: true, duplicate: true, state: existing.state }, 200);
        }
        const processing = processEtsyWebhookDelivery(env, verified.webhookId).catch(error => {
            console.error('Etsy webhook processing error:', String(error?.code || 'ETSY_WEBHOOK_PROCESSING_FAILED'));
        });
        if (ctx?.waitUntil) ctx.waitUntil(processing);
        else await processing;
        return etsyWebhookResponse({ ok: true, accepted: true }, 202);
    } catch (error) {
        const status = Number(error?.status) || 500;
        const code = String(error?.code || 'ETSY_WEBHOOK_FAILED');
        if (status >= 500) console.error('Etsy webhook endpoint error:', code);
        return etsyWebhookResponse({ ok: false, error: { code } }, status);
    }
}

function etsyWebhookRetryAt(error, attemptCount) {
    const providerDelay = Number(error?.retryAfterSeconds);
    const fallback = ETSY_WEBHOOK_RETRY_DELAYS_SECONDS[
        Math.min(Math.max(0, attemptCount - 1), ETSY_WEBHOOK_RETRY_DELAYS_SECONDS.length - 1)
    ];
    const delaySeconds = Number.isFinite(providerDelay) && providerDelay > 0 ? providerDelay : fallback;
    return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

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
    return db.prepare('SELECT * FROM etsy_webhook_deliveries WHERE webhook_id = ?').bind(webhookId).first();
}

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

async function processEtsyWebhookDelivery(env, webhookId) {
    const delivery = await claimEtsyWebhookDelivery(env, webhookId);
    if (!delivery) return { claimed: false };
    try {
        const connection = await freshEtsyConnection(env, false);
        if (String(connection.row.etsy_shop_id) !== String(delivery.etsy_shop_id)) {
            throw etsyWebhookError('ETSY_WEBHOOK_SHOP_INVALID', 'Stored webhook shop is not authorized.', 403);
        }
        const observed = await readEtsyReceiptForShadow(env, connection, { receiptId: delivery.receipt_id });
        if (!observed.receipt) {
            await completeEtsyWebhookDelivery(env, webhookId, 'ignored', 'NO_RECEIPT');
            return { claimed: true, outcome: 'NO_RECEIPT' };
        }
        if (String(observed.receipt.receipt_id) !== String(delivery.receipt_id)) {
            throw etsyWebhookError('ETSY_RECEIPT_ID_MISMATCH', 'Etsy returned an unexpected receipt identity.', 502);
        }
        const eligibility = etsyShadowEligibility(observed.receipt);
        if (!eligibility.eligible) {
            await completeEtsyWebhookDelivery(env, webhookId, 'ignored', eligibility.reason);
            return { claimed: true, outcome: eligibility.reason };
        }
        const contract = normalizeEtsyOrderContract({
            providerAccountId: connection.row.etsy_shop_id,
            receipt: observed.receipt,
            transactions: observed.transactions,
            fetchedAt: isoNow()
        });
        const enroll = etsyWebhookEnrollmentEnabled(env);
        await persistEtsyShadowOrder(env, contract, eligibility, 'etsy-webhook', { enroll });
        const outcome = enroll ? 'BOARD_ENROLLED' : 'SHADOW_SYNCED';
        await completeEtsyWebhookDelivery(env, webhookId, 'processed', outcome);
        return { claimed: true, outcome };
    } catch (error) {
        const attemptCount = Number(delivery.attempt_count || 1);
        const terminal = attemptCount >= ETSY_WEBHOOK_MAX_ATTEMPTS;
        const state = terminal ? 'failed' : 'retry';
        await completeEtsyWebhookDelivery(
            env,
            webhookId,
            state,
            terminal ? 'RETRY_EXHAUSTED' : 'RETRY_SCHEDULED',
            String(error?.code || 'ETSY_WEBHOOK_PROCESSING_FAILED').slice(0, 120),
            terminal ? null : etsyWebhookRetryAt(error, attemptCount)
        );
        throw error;
    }
}

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
            // State and redacted error code were persisted by the processor.
        }
    }
    return { due: (due.results || []).length, processed };
}

async function reconcileEtsyPaidReceipts(env, mode = 'incremental') {
    if (!etsyWebhookReconciliationEnabled(env) || !etsyWebhookSecrets(env, { required: false }).length) {
        return { skipped: true, reason: 'NOT_ACTIVE' };
    }
    const db = requireOrderDb(env);
    const shop = await d1Shop(env);
    const now = isoNow();
    const existing = await db.prepare(`
      SELECT checkpoint, last_started_at, last_completed_at
      FROM reconciliation_checkpoints
      WHERE shop_id = ? AND name = ?
    `).bind(shop.id, ETSY_RECONCILIATION_CHECKPOINT).first();
    const activeStart = Date.parse(existing?.last_started_at || '');
    const activeComplete = Date.parse(existing?.last_completed_at || '');
    if (Number.isFinite(activeStart) && activeStart > (Number.isFinite(activeComplete) ? activeComplete : 0)
        && activeStart > Date.now() - ETSY_WEBHOOK_PROCESSING_LEASE_MS) {
        return { skipped: true, reason: 'ALREADY_RUNNING' };
    }
    await db.prepare(`
      INSERT INTO reconciliation_checkpoints (shop_id, name, checkpoint, last_started_at, last_completed_at, last_result_json)
      VALUES (?, ?, NULL, ?, NULL, NULL)
      ON CONFLICT(shop_id, name) DO UPDATE SET last_started_at = excluded.last_started_at
    `).bind(shop.id, ETSY_RECONCILIATION_CHECKPOINT, now).run();
    try {
        let priorCompletedAt = null;
        try { priorCompletedAt = JSON.parse(existing?.checkpoint || '{}').lastCompletedAt || null; } catch (_) {}
        const baseLookback = mode === 'integrity' ? ETSY_RECONCILIATION_INTEGRITY_SECONDS : ETSY_RECONCILIATION_INITIAL_SECONDS;
        const priorSeconds = Math.floor(Date.parse(priorCompletedAt || '') / 1000);
        const minimumSeconds = Number.isFinite(priorSeconds)
            ? priorSeconds - ETSY_RECONCILIATION_OVERLAP_SECONDS
            : Math.floor(Date.now() / 1000) - baseLookback;
        const connection = await freshEtsyConnection(env, false);
        const maxPages = mode === 'integrity' ? 4 : 2;
        let activeConnection = connection;
        let observed = 0;
        let eligible = 0;
        let persisted = 0;
        let truncated = false;
        for (let page = 0; page < maxPages; page += 1) {
            const url = new URL(`${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts`);
            url.searchParams.set('min_last_modified', String(Math.max(946684800, minimumSeconds)));
            url.searchParams.set('was_paid', 'true');
            url.searchParams.set('was_shipped', 'false');
            url.searchParams.set('sort_on', 'updated');
            url.searchParams.set('sort_order', 'asc');
            url.searchParams.set('limit', String(ETSY_RECONCILIATION_LIMIT));
            url.searchParams.set('offset', String(page * ETSY_RECONCILIATION_LIMIT));
            const pageResult = await etsyAuthorizedJson(env, url.toString(), 'ETSY_RECONCILIATION_READ_FAILED', activeConnection);
            activeConnection = pageResult.connection;
            const receipts = Array.isArray(pageResult.body.results) ? pageResult.body.results : [];
            observed += receipts.length;
            for (const receipt of receipts) {
                const eligibility = etsyShadowEligibility(receipt);
                if (!eligibility.eligible) continue;
                eligible += 1;
                const receiptId = etsyNumericIdentity(receipt.receipt_id, 'receipt ID');
                const transactionResult = await etsyAuthorizedJson(
                    env,
                    `${ETSY_API_BASE_URL}/shops/${encodeURIComponent(connection.row.etsy_shop_id)}/receipts/${encodeURIComponent(receiptId)}/transactions`,
                    'ETSY_TRANSACTION_READ_FAILED',
                    activeConnection
                );
                activeConnection = transactionResult.connection;
                const contract = normalizeEtsyOrderContract({
                    providerAccountId: connection.row.etsy_shop_id,
                    receipt,
                    transactions: Array.isArray(transactionResult.body.results) ? transactionResult.body.results : [],
                    fetchedAt: isoNow()
                });
                await persistEtsyShadowOrder(env, contract, eligibility, 'etsy-reconciliation', {
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
            JSON.stringify({ mode, failed: true, errorCode: String(error?.code || 'ETSY_RECONCILIATION_FAILED') }),
            shop.id,
            ETSY_RECONCILIATION_CHECKPOINT
        ).run();
        throw error;
    }
}

async function runEtsyWebhookMaintenance(env, mode = 'incremental') {
    const retry = await retryDueEtsyWebhookDeliveries(env);
    const reconciliation = await reconcileEtsyPaidReceipts(env, mode);
    return { retry, reconciliation };
}

async function handleEtsyWebhookStatus(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const shop = await d1Shop(env);
        let secretConfigured = false;
        let secretConfigurationError = null;
        try { secretConfigured = etsyWebhookSecrets(env, { required: false }).length > 0; }
        catch (error) { secretConfigurationError = String(error?.code || 'ETSY_WEBHOOK_SECRET_INVALID'); }
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
        try { reconciliationResult = checkpoint?.last_result_json ? JSON.parse(checkpoint.last_result_json) : null; } catch (_) {}
        return jsonResponse({
            endpoint: String(env.ETSY_WEBHOOK_CALLBACK_URL || ''),
            event: ETSY_WEBHOOK_EVENT,
            secretConfigured,
            secretConfigurationError,
            mode: etsyWebhookEnrollmentEnabled(env) ? 'automatic-enrollment' : 'shadow-only',
            reconciliationEnabled: etsyWebhookReconciliationEnabled(env),
            deliveries: Object.fromEntries((counts.results || []).map(row => [row.state, Number(row.count || 0)])),
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

function etsySyntheticOrderKey(providerAccountId) {
    return `etsy-synthetic:${etsyNumericIdentity(providerAccountId, 'shop ID')}:${ETSY_SYNTHETIC_EXTERNAL_ID}`;
}

function syntheticEtsyOrderContract(providerAccountId, fetchedAt = isoNow()) {
    const accountId = etsyNumericIdentity(providerAccountId, 'shop ID');
    const orderKey = etsySyntheticOrderKey(accountId);
    return {
        id: orderKey,
        orderKey,
        displayName: '#ETSY-TEST-001',
        createdAt: fetchedAt,
        sourceUpdatedAt: fetchedAt,
        source: {
            provider: 'etsy',
            label: 'Etsy',
            providerAccountId: accountId,
            externalOrderId: ETSY_SYNTHETIC_EXTERNAL_ID,
            displayNumber: 'ETSY-TEST-001',
            adminUrl: null,
            synthetic: true
        },
        customer: { displayName: 'Etsy test order' },
        commerce: {
            paid: true,
            canceled: false,
            shipped: false,
            delivered: false,
            synthetic: true,
            financialStatus: 'paid',
            fulfillmentStatus: 'unshipped',
            currencyCode: 'USD',
            subtotal: 53.75,
            discount: 4.25,
            total: 58.13,
            lineItems: [
                {
                    id: `${orderKey}:line-1`,
                    externalLineId: 'synthetic-line-1',
                    listingId: null,
                    title: 'Comfort Colors 1717 T-Shirt',
                    sku: '1717-BLACK-L',
                    quantity: 2,
                    currentQuantity: 2,
                    unitPrice: 18.5,
                    currencyCode: 'USD',
                    variations: [
                        { propertyId: '100', valueId: '200', questionId: null, name: 'Color', value: 'Black' },
                        { propertyId: '101', valueId: '201', questionId: null, name: 'Size', value: 'Large' }
                    ],
                    personalization: [],
                    expectedShipAt: null,
                    listingImageId: null,
                    listingImageIsProductionArtwork: false
                },
                {
                    id: `${orderKey}:line-2`,
                    externalLineId: 'synthetic-line-2',
                    listingId: null,
                    title: 'Gildan 18500 Hoodie',
                    sku: '18500-SAND-M',
                    quantity: 1,
                    currentQuantity: 1,
                    unitPrice: 21,
                    currencyCode: 'USD',
                    variations: [
                        { propertyId: '100', valueId: '202', questionId: null, name: 'Color', value: 'Sand' },
                        { propertyId: '101', valueId: '203', questionId: null, name: 'Size', value: 'Medium' },
                        { propertyId: '102', valueId: null, questionId: 'fixture-question-1', name: 'Personalization', value: 'PRINTMO TEST' }
                    ],
                    personalization: [
                        { propertyId: '102', valueId: null, questionId: 'fixture-question-1', name: 'Personalization', value: 'PRINTMO TEST' }
                    ],
                    expectedShipAt: null,
                    listingImageId: null,
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
            authority: 'printmo-d1',
            provider: 'etsy',
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

async function handleEtsySyntheticOrder(request, env, allowOrigin, reqAllowHeaders, identity) {
    try {
        const body = await request.json().catch(() => ({}));
        const connection = await loadEtsyConnection(env);
        const contract = syntheticEtsyOrderContract(connection.etsy_shop_id);
        const orderKey = contract.orderKey;
        const db = requireOrderDb(env);
        const shop = await d1Shop(env);
        if (request.method === 'DELETE') {
            if (body.confirm !== ETSY_SYNTHETIC_CONFIRM_DELETE) {
                throw Object.assign(new Error('Deleting the live Etsy test order requires the exact confirmation phrase.'), {
                    code: 'ETSY_SYNTHETIC_CONFIRMATION_REQUIRED',
                    status: 400
                });
            }
            const removed = await db.prepare(`
              DELETE FROM provider_order_projection
              WHERE shop_id = ? AND order_key = ? AND enrollment_state = 'pilot'
            `).bind(shop.id, orderKey).run();
            return jsonResponse({
                ok: true,
                source: 'etsy',
                synthetic: true,
                orderKey,
                removed: Boolean(removed.meta?.changes)
            }, allowOrigin, reqAllowHeaders);
        }
        if (body.confirm !== ETSY_SYNTHETIC_CONFIRM_CREATE) {
            throw Object.assign(new Error('Creating the live Etsy test order requires the exact confirmation phrase.'), {
                code: 'ETSY_SYNTHETIC_CONFIRMATION_REQUIRED',
                status: 400
            });
        }
        const existing = await db.prepare(`
          SELECT order_key FROM provider_order_projection
          WHERE shop_id = ? AND order_key = ?
        `).bind(shop.id, orderKey).first();
        const actor = `${identity?.kind || 'unknown'}:${identity?.subject || 'unknown'}`;
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
                shop.id, contract.source.providerAccountId, contract.source.externalOrderId, orderKey,
                contract.source.displayNumber, contract.createdAt, contract.sourceUpdatedAt,
                JSON.stringify(contract), contract.sync.fetchedAt, now, now
            ),
            db.prepare(`
              INSERT INTO provider_production_state (
                shop_id, order_key, provider, provider_account_id, external_order_id,
                revision, last_mutation_id, state_json, created_at, updated_at
              ) VALUES (?, ?, 'etsy', ?, ?, 0, NULL, ?, ?, ?)
              ON CONFLICT(shop_id, order_key) DO NOTHING
            `).bind(
                shop.id, orderKey, contract.source.providerAccountId,
                contract.source.externalOrderId, JSON.stringify(production), now, now
            )
        ]);
        return jsonResponse({
            ok: true,
            source: 'etsy',
            synthetic: true,
            created: !existing,
            orderKey,
            displayName: contract.displayName,
            boardEnrolled: true,
            cleanupConfirmation: ETSY_SYNTHETIC_CONFIRM_DELETE
        }, allowOrigin, reqAllowHeaders, existing ? 200 : 201);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
    }
}

async function d1Shop(env, { allowUninstalled = false } = {}) {
    const db = requireOrderDb(env);
    const shop = shopDomain(env);
    const now = isoNow();
    await db.prepare(`
      INSERT INTO shops (shop_domain, installed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(shop_domain) DO UPDATE SET updated_at = excluded.updated_at
    `).bind(shop, now, now, now).run();
    const row = await db.prepare('SELECT id, shop_domain, uninstalled_at FROM shops WHERE shop_domain = ?')
        .bind(shop).first();
    if (!row) throw Object.assign(new Error('Unable to initialize the shop database record.'), { code: 'SHOP_DB_INIT_FAILED', status: 503 });
    if (row.uninstalled_at && !allowUninstalled) {
        throw Object.assign(new Error('This Shopify installation is disabled.'), { code: 'SHOP_UNINSTALLED', status: 403 });
    }
    return row;
}

function defaultProductionState(actor = 'system') {
    const now = isoNow();
    return {
        schemaVersion: 1,
        revision: 0,
        lastMutationId: null,
        stage: 'received',
        readiness: { blanksOrdered: false, blanksReady: false, printsOrdered: false, printsReady: false },
        printedCount: 0,
        bundleId: null,
        batchRefs: [],
        internalNotes: '',
        attention: { required: false, reasons: [], acknowledgedAt: null },
        archivedAt: null,
        archivedBy: null,
        updatedAt: now,
        updatedBy: actor
    };
}

function normalizeProductionState(value, actor = 'system') {
    const base = defaultProductionState(actor);
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const readiness = input.readiness && typeof input.readiness === 'object' ? input.readiness : {};
    const attention = input.attention && typeof input.attention === 'object' ? input.attention : {};
    return {
        ...base,
        schemaVersion: 1,
        revision: Math.max(0, Number.isInteger(Number(input.revision)) ? Number(input.revision) : 0),
        lastMutationId: input.lastMutationId ? String(input.lastMutationId).slice(0, 160) : null,
        stage: PRODUCTION_STAGES.has(input.stage) ? input.stage : 'received',
        readiness: {
            blanksOrdered: 'blanksOrdered' in readiness
                ? Boolean(readiness.blanksOrdered)
                : ['blanks_ordered', 'print', 'completed'].includes(input.stage),
            blanksReady: Boolean(readiness.blanksReady),
            printsOrdered: Boolean(readiness.printsOrdered),
            printsReady: Boolean(readiness.printsReady)
        },
        printedCount: Math.min(Math.max(Number(input.printedCount) || 0, 0), 1000000),
        bundleId: input.bundleId ? String(input.bundleId).slice(0, 160) : null,
        batchRefs: Array.isArray(input.batchRefs) ? [...new Set(input.batchRefs.map(String))].slice(0, 100) : [],
        internalNotes: String(input.internalNotes || '').slice(0, 5000),
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

function parseProductionMetafield(metafield, actor = 'system') {
    if (!metafield?.value) return { state: defaultProductionState(actor), compareDigest: null, exists: false };
    try {
        return {
            state: normalizeProductionState(JSON.parse(metafield.value), actor),
            compareDigest: metafield.compareDigest || null,
            exists: true
        };
    } catch (_) {
        throw Object.assign(new Error('The Shopify production metafield contains invalid JSON.'), {
            code: 'INVALID_PRODUCTION_METAFIELD',
            status: 409
        });
    }
}

function productionForClient(gid, state, compareDigest, assets = [], garmentCount = null) {
    return {
        id: gid,
        stage: state.stage,
        version: state.revision,
        revision: state.revision,
        compareDigest: compareDigest || null,
        bundleId: state.bundleId || '',
        blanksPo: state.batchRefs || [],
        garmentCount: Number.isInteger(garmentCount) && garmentCount >= 0 ? garmentCount : null,
        printedCount: state.printedCount,
        blanksOrdered: state.readiness.blanksOrdered ? 1 : 0,
        blanksStatus: state.readiness.blanksReady ? 1 : 0,
        printsStatus: state.readiness.printsReady ? 1 : 0,
        printsOrdered: state.readiness.printsOrdered ? 1 : 0,
        internalNotes: state.internalNotes,
        attention: state.attention,
        archivedAt: state.archivedAt,
        archivedBy: state.archivedBy,
        updatedAt: state.updatedAt,
        updatedBy: state.updatedBy,
        assets
    };
}

async function readProductionMetafield(env, gid, actor = 'system', graphQL = coordinatorGraphQL) {
    const result = await graphQL(env, PRODUCTION_STATE_QUERY, { id: gid }, 'PrintMOProductionState');
    const data = requireShopifyData(result, 'PrintMOProductionState');
    if (!data.order) throw Object.assign(new Error('Shopify order not found.'), { code: 'ORDER_NOT_FOUND', status: 404 });
    const parsed = parseProductionMetafield(data.order.metafield, actor);
    return { gid, order: data.order, ...parsed };
}

function normalizeProductionPatch(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw Object.assign(new Error('Production patch must be an object.'), { code: 'INVALID_PATCH', status: 400 });
    }
    const aliases = {
        stage: 'stage',
        bundleId: 'bundleId',
        bundle_id: 'bundleId',
        internalNotes: 'internalNotes',
        internal_notes: 'internalNotes',
        printedCount: 'printedCount',
        printed_count: 'printedCount',
        blanksStatus: 'blanksStatus',
        blanks_status: 'blanksStatus',
        blanksOrdered: 'blanksOrdered',
        blanks_ordered: 'blanksOrdered',
        printsStatus: 'printsStatus',
        prints_status: 'printsStatus',
        printsOrdered: 'printsOrdered',
        prints_ordered: 'printsOrdered',
        attention: 'attention',
        archivedAt: 'archivedAt',
        archived_at: 'archivedAt'
    };
    const normalized = {};
    for (const [key, value] of Object.entries(patch)) {
        const target = aliases[key];
        if (!target) throw Object.assign(new Error(`Production field "${key}" is not mutable.`), { code: 'INVALID_PATCH_FIELD', status: 400 });
        normalized[target] = value;
    }
    if ('stage' in normalized && !PRODUCTION_STAGES.has(normalized.stage)) {
        throw Object.assign(new Error('Production stage is invalid.'), { code: 'INVALID_STAGE', status: 400 });
    }
    if ('bundleId' in normalized && normalized.bundleId !== null && String(normalized.bundleId).length > 160) {
        throw Object.assign(new Error('Bundle is too long.'), { code: 'INVALID_BUNDLE', status: 400 });
    }
    if ('internalNotes' in normalized && String(normalized.internalNotes || '').length > 5000) {
        throw Object.assign(new Error('Internal notes exceed 5,000 characters.'), { code: 'INVALID_NOTES', status: 400 });
    }
    if ('printedCount' in normalized) {
        const count = Number(normalized.printedCount);
        if (!Number.isInteger(count) || count < 0 || count > 1000000) {
            throw Object.assign(new Error('Printed count must be a non-negative integer.'), { code: 'INVALID_PRINTED_COUNT', status: 400 });
        }
    }
    for (const flag of ['blanksStatus', 'blanksOrdered', 'printsStatus', 'printsOrdered']) {
        if (flag in normalized && ![0, 1, false, true].includes(normalized[flag])) {
            throw Object.assign(new Error(`${flag} must be boolean or 0/1.`), { code: 'INVALID_READINESS', status: 400 });
        }
    }
    if (
        'archivedAt' in normalized
        && normalized.archivedAt !== null
        && normalized.archivedAt !== true
        && (typeof normalized.archivedAt !== 'string' || !normalized.archivedAt.trim())
    ) {
        throw Object.assign(new Error('Archive state must be a timestamp, true, or null.'), { code: 'INVALID_ARCHIVE_STATE', status: 400 });
    }
    return normalized;
}

function applyProductionPatch(current, patch, actor, mutationId) {
    const next = normalizeProductionState(current, actor);
    if ('stage' in patch) next.stage = patch.stage;
    if ('bundleId' in patch) next.bundleId = patch.bundleId ? String(patch.bundleId) : null;
    if ('internalNotes' in patch) next.internalNotes = String(patch.internalNotes || '');
    if ('printedCount' in patch) next.printedCount = Number(patch.printedCount);
    if ('blanksStatus' in patch) next.readiness.blanksReady = Boolean(Number(patch.blanksStatus));
    if ('blanksOrdered' in patch) next.readiness.blanksOrdered = Boolean(Number(patch.blanksOrdered));
    if ('printsStatus' in patch) next.readiness.printsReady = Boolean(Number(patch.printsStatus));
    if ('printsOrdered' in patch) next.readiness.printsOrdered = Boolean(Number(patch.printsOrdered));
    // Blanks Cart and Blanks Ordered are canonical substages. Keep the
    // compatibility readiness flag aligned so older render surfaces cannot
    // classify an otherwise valid blanks_ordered record as In S&S Cart.
    if (next.stage === 'blanks_cart' || next.stage === 'blanks_ordered') {
        next.readiness.blanksOrdered = next.stage === 'blanks_ordered';
    }
    if ('attention' in patch) next.attention = normalizeProductionState({ attention: patch.attention }, actor).attention;
    if ('archivedAt' in patch) {
        next.archivedAt = patch.archivedAt ? isoNow() : null;
        next.archivedBy = next.archivedAt ? actor : null;
    }
    next.revision = current.revision + 1;
    next.lastMutationId = mutationId;
    next.updatedAt = isoNow();
    next.updatedBy = actor;
    return next;
}

async function setProductionMetafield(env, gid, state, compareDigest, graphQL = performShopifyGraphQL) {
    const result = await graphQL(env, PRODUCTION_STATE_MUTATION, {
        metafields: [{
            ownerId: gid,
            namespace: PRODUCTION_METAFIELD_NAMESPACE,
            key: PRODUCTION_METAFIELD_KEY,
            type: 'json',
            value: JSON.stringify(state),
            compareDigest: compareDigest === undefined ? null : compareDigest
        }]
    }, 'PrintMOSetProductionState');
    const data = requireShopifyData(result, 'PrintMOSetProductionState');
    const payload = data.metafieldsSet;
    const userError = payload?.userErrors?.[0];
    if (userError) {
        const conflict = /digest|stale|compare/i.test(`${userError.code || ''} ${userError.message || ''}`);
        throw Object.assign(new Error(userError.message || 'Shopify rejected the production update.'), {
            code: conflict ? 'VERSION_CONFLICT' : (userError.code || 'SHOPIFY_MUTATION_ERROR'),
            status: conflict ? 409 : 422,
            details: payload.userErrors
        });
    }
    const metafield = payload?.metafields?.[0];
    if (!metafield) throw Object.assign(new Error('Shopify did not return the saved production metafield.'), { code: 'SHOPIFY_MUTATION_EMPTY', status: 502 });
    return parseProductionMetafield(metafield, state.updatedBy);
}

async function ensureCandidateOrder(env, gid, actor = 'system', graphQL = coordinatorGraphQL) {
    const shop = await d1Shop(env);
    let current = await readProductionMetafield(env, gid, actor, graphQL);
    if (!current.exists) {
        try {
            const saved = await setProductionMetafield(env, gid, current.state, null, graphQL);
            current = { ...current, ...saved };
        } catch (error) {
            if (error.code !== 'VERSION_CONFLICT') throw error;
            current = await readProductionMetafield(env, gid, actor, graphQL);
        }
    }
    await d1ProjectionUpsert(env, shop.id, gid, current.state, current.compareDigest, undefined, current.order);
    return current;
}

async function d1AssetsForOrder(env, shopId, gid) {
    const result = await requireOrderDb(env).prepare(`
      SELECT manifests.id, manifests.filename, manifests.content_type,
             manifests.byte_size, manifests.sha256,
             COALESCE(links.line_item_id, manifests.line_item_id, '') AS line_item_id,
             COALESCE(links.design_ref, manifests.design_ref, '') AS design_ref,
             COALESCE(links.role, manifests.role, '') AS role,
             COALESCE(links.side, manifests.side, '') AS side,
             manifests.created_at
      FROM asset_manifests AS manifests
      LEFT JOIN asset_manifest_links AS links ON links.asset_id = manifests.id
      WHERE manifests.shop_id = ? AND manifests.order_gid = ? AND manifests.state = 'active'
      ORDER BY manifests.created_at, manifests.id, links.line_item_id, links.role, links.side
    `).bind(shopId, gid).all();
    return (result.results || []).map(row => ({
        assetId: row.id,
        name: row.filename,
        contentType: row.content_type,
        byteSize: row.byte_size,
        sha256: row.sha256,
        lineItemId: row.line_item_id || null,
        designRef: row.design_ref || null,
        role: row.role || null,
        side: row.side || null
    }));
}

async function d1AssetsForOrders(env, shopId, gids) {
    const valid = [...new Set((gids || []).map(canonicalOrderGid).filter(Boolean))];
    const byOrder = new Map(valid.map(gid => [gid, []]));
    for (let index = 0; index < valid.length; index += 50) {
        const chunk = valid.slice(index, index + 50);
        const placeholders = chunk.map(() => '?').join(', ');
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

async function d1ProjectionUpsert(env, shopId, gid, state, compareDigest, summary = undefined, order = {}) {
    const db = requireOrderDb(env);
    const now = isoNow();
    const active = state.archivedAt ? 0 : 1;
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
        gid,
        summary?.displayName || order.name || null,
        state.stage,
        active,
        state.revision,
        compareDigest || null,
        JSON.stringify(state),
        summary === undefined ? null : JSON.stringify(summary),
        summary?.shopifyUpdatedAt || order.updatedAt || null,
        summary?.sync?.fetchedAt || null,
        order.createdAt || summary?.createdAt || now,
        now
    ).run();
}

function d1ProjectionRecord(row) {
    let production = defaultProductionState();
    let summary = null;
    try { production = normalizeProductionState(JSON.parse(row.production_json || '{}')); } catch (_) {}
    try { summary = row.commerce_json ? JSON.parse(row.commerce_json) : null; } catch (_) {}
    if (summary?.sync) {
        const stale = Boolean(row.stale_at) || !summary.sync.freshUntil || Date.parse(summary.sync.freshUntil) <= Date.now();
        summary.sync = { ...summary.sync, stale };
    }
    return {
        kind: 'shopify',
        gid: row.order_gid,
        production: productionForClient(row.order_gid, production, row.production_digest),
        summary,
        staleAt: row.stale_at,
        lastError: row.last_error
    };
}

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

function garmentCountFromLineItems(items = []) {
    return items.reduce((total, item) => {
        if (PRINT_TITLES.has(item?.title) || !safeText(item?.sku, 120)) return total;
        const quantity = Number(item?.currentQuantity ?? item?.quantity ?? 0);
        return total + (Number.isInteger(quantity) && quantity > 0 ? quantity : 0);
    }, 0);
}

async function productionGarmentCount(env, productionRead, graphQL = coordinatorGraphQL) {
    if (!productionRead?.order?.lineItems) {
        throw Object.assign(new Error('Shopify did not return order line items for garment counting.'), {
            code: 'GARMENT_COUNT_UNAVAILABLE',
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
        throw Object.assign(new Error('Shopify line-item pagination did not complete.'), {
            code: 'GARMENT_COUNT_INCOMPLETE',
            status: 502,
            details: lines.errors
        });
    }
    return garmentCountFromLineItems(lines.items);
}

function selectOperationalCustomerName(node) {
    if (!node) return null;
    const shipping = String(node.shippingAddress?.name || '').trim();
    if (shipping) return shipping;
    const billing = String(node.billingAddress?.name || '').trim();
    if (billing) return billing;
    const first = String(node.customer?.firstName || '').trim();
    const last = String(node.customer?.lastName || '').trim();
    if (first && last) return `${first} ${last}`;
    if (first) return first;
    if (last) return last;
    return null;
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
        customer: {
            displayName: selectOperationalCustomerName(node)
        },
        commerce: {
            financialStatus: node.displayFinancialStatus || null,
            fulfillmentStatus: node.displayFulfillmentStatus || null,
            cancelledAt: node.cancelledAt || null,
            currencyCode: currency,
            subtotal: moneyValue(node.currentSubtotalPriceSet, currency)?.amount || null,
            discount: moneyValue(node.currentTotalDiscountsSet, currency)?.amount || null,
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

const DESIGNER_REFERENCE_KEYS = new Set(['_designref', '_design_ref']);
const DESIGNER_PREVIEW_KEYS = new Set(['design_preview_url', 'design-preview-url']);
const DESIGNER_ASSET_MAX_BYTES = 50 * 1024 * 1024;
const DESIGNER_ASSET_BACKFILL_CHECKPOINT = 'designer-studio-assets-v1';

function designerAttributeMap(attributes) {
    const values = new Map();
    for (const attribute of Array.isArray(attributes) ? attributes : []) {
        const key = String(attribute?.key || '').trim().toLowerCase();
        if (key && !values.has(key)) values.set(key, String(attribute?.value || '').trim());
    }
    return values;
}

function designerSideFromName(name) {
    const value = String(name || '').toLowerCase();
    if (/(^|[_./-])front([_.-]|$)/.test(value)) return 'front';
    if (/(^|[_./-])back([_.-]|$)/.test(value)) return 'back';
    return null;
}

function designerAssetCandidates(summary) {
    const orderNumber = /^#?(\d+)$/.exec(String(summary?.displayName || '').trim())?.[1] || null;
    if (!orderNumber) return [];
    const candidates = [];
    for (const item of summary?.commerce?.lineItems || []) {
        const values = designerAttributeMap(item.customAttributes);
        const designRef = [...DESIGNER_REFERENCE_KEYS].map(key => values.get(key)).find(Boolean);
        const previewUrl = [...DESIGNER_PREVIEW_KEYS].map(key => values.get(key)).find(Boolean);
        if (!designRef || !previewUrl || !/^[A-Za-z0-9_-]{8,160}$/.test(designRef)) continue;
        let parsed;
        try { parsed = new URL(previewUrl); } catch (_) { continue; }
        if (parsed.protocol !== 'https:') continue;
        const match = parsed.pathname.match(/^\/previews\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/(.+)$/);
        if (!match) continue;
        let pathDesignRef;
        let rest;
        try {
            pathDesignRef = decodeURIComponent(match[2]);
            rest = match[3].split('/').map(segment => decodeURIComponent(segment)).join('/');
        } catch (_) {
            continue;
        }
        if (pathDesignRef !== designRef) continue;
        if (!rest || rest.split('/').some(segment => !segment || segment === '.' || segment === '..')) continue;
        const groupRole = String(values.get('batch_role') || values.get('group_role') || '').toLowerCase();
        candidates.push({
            lineItemId: item.id,
            designRef,
            previewKey: `previews/${match[1]}/${designRef}/${rest}`,
            orderNumber,
            rest,
            name: safeAssetName(rest.split('/').pop()),
            role: groupRole === 'garment'
                ? 'mockup'
                : groupRole === 'print'
                    ? 'design'
                    : item.sku ? 'mockup' : 'design',
            side: designerSideFromName(rest)
        });
    }
    return candidates;
}

async function resolveDesignerSourceKey(env, candidate) {
    if (!env.PREVIEWS) throw new Error('Designer Studio preview storage is not configured.');
    if (await env.PREVIEWS.head(candidate.previewKey)) return candidate.previewKey;
    const promotedKey = `orders/${candidate.orderNumber}/${candidate.designRef}/${candidate.rest}`;
    if (await env.PREVIEWS.head(promotedKey)) return promotedKey;
    const prefix = `orders/${candidate.orderNumber}_`;
    const suffix = `/${candidate.designRef}/${candidate.rest}`;
    let cursor;
    const matches = [];
    for (let page = 0; page < 5; page += 1) {
        const result = await env.PREVIEWS.list({ prefix, cursor, limit: 1000 });
        for (const object of result.objects || []) {
            if (String(object.key || '').endsWith(suffix)) matches.push(object.key);
        }
        if (!result.truncated || !result.cursor) break;
        cursor = result.cursor;
    }
    if (matches.length > 1) throw new Error(`Designer Studio asset is ambiguous for ${candidate.designRef}/${candidate.rest}.`);
    return matches[0] || null;
}

async function copyDesignerAsset(env, shopId, gid, candidate) {
    const db = requireOrderDb(env);
    const linkValues = {
        lineItemId: String(candidate.lineItemId || ''),
        designRef: String(candidate.designRef || ''),
        role: String(candidate.role || ''),
        side: String(candidate.side || ''),
        sourceKey: String(candidate.previewKey || '')
    };
    const existingLink = await db.prepare(`
      SELECT manifests.id
      FROM asset_manifest_links AS links
      JOIN asset_manifests AS manifests ON manifests.id = links.asset_id
      WHERE manifests.shop_id = ? AND manifests.order_gid = ? AND manifests.state = 'active'
        AND links.line_item_id = ? AND links.design_ref = ? AND links.role = ?
        AND links.side = ? AND links.source_key = ?
      LIMIT 1
    `).bind(
        shopId, gid, linkValues.lineItemId, linkValues.designRef, linkValues.role,
        linkValues.side, linkValues.sourceKey
    ).first();
    if (existingLink) return { state: 'existing', assetId: existingLink.id };

    const sourceKey = await resolveDesignerSourceKey(env, candidate);
    if (!sourceKey) throw new Error(`Designer Studio asset was not found for ${candidate.designRef}/${candidate.rest}.`);
    const source = await env.PREVIEWS.get(sourceKey);
    if (!source) throw new Error(`Designer Studio source disappeared during import: ${sourceKey}.`);
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > DESIGNER_ASSET_MAX_BYTES) {
        throw new Error(`Designer Studio asset size is invalid for ${candidate.name}.`);
    }
    const sha256 = bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
    const sourceHeaders = new Headers();
    if (typeof source.writeHttpMetadata === 'function') source.writeHttpMetadata(sourceHeaders);
    const contentType = sourceHeaders.get('Content-Type') || guessContentTypeFromKey(candidate.name);
    const existingBlob = await db.prepare(`
      SELECT id
      FROM asset_manifests
      WHERE shop_id = ? AND order_gid = ? AND state = 'active'
        AND sha256 = ? AND byte_size = ? AND content_type = ?
      ORDER BY created_at, id
      LIMIT 1
    `).bind(shopId, gid, sha256, bytes.byteLength, contentType).first();
    const now = isoNow();
    if (existingBlob) {
        await insertAssetManifestLink(db, existingBlob.id, linkValues, now);
        return { state: 'existing', assetId: existingBlob.id };
    }

    const assetId = await stableAssetId(`${gid}:sha256:${sha256}:${bytes.byteLength}:${contentType}`);
    const objectKey = `orders/${numericIdFromGid(gid)}/assets/${assetId}/${candidate.name}`;
    if (!env.R2_BUCKET) throw new Error('Private artwork storage is not configured.');
    await env.R2_BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType },
        customMetadata: { sha256, source: 'designer-studio' }
    });
    const stored = await env.R2_BUCKET.get(objectKey);
    if (!stored) throw new Error(`Private R2 verification could not read ${candidate.name}.`);
    const storedBytes = new Uint8Array(await stored.arrayBuffer());
    const storedDigest = bytesToHex(await crypto.subtle.digest('SHA-256', storedBytes));
    if (storedDigest !== sha256) throw new Error(`Private R2 checksum verification failed for ${candidate.name}.`);

    await db.prepare(`
      INSERT INTO asset_manifests (
        id, shop_id, order_gid, object_key, filename, content_type, byte_size,
        sha256, state, source_key, created_by, created_at, updated_at,
        line_item_id, design_ref, role, side
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'designer-studio-sync', ?, ?, ?, ?, ?, ?)
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
        deleted_at = NULL,
        updated_at = excluded.updated_at
    `).bind(
        assetId, shopId, gid, objectKey, candidate.name, contentType, bytes.byteLength,
        sha256, sourceKey, now, now, candidate.lineItemId, candidate.designRef,
        candidate.role, candidate.side
    ).run();
    await insertAssetManifestLink(db, assetId, linkValues, now);
    return { state: 'imported', assetId };
}

async function insertAssetManifestLink(db, assetId, values, createdAt = isoNow()) {
    await db.prepare(`
      INSERT OR IGNORE INTO asset_manifest_links (
        asset_id, line_item_id, design_ref, role, side, source_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
        assetId,
        String(values?.lineItemId || ''),
        String(values?.designRef || ''),
        String(values?.role || ''),
        String(values?.side || ''),
        String(values?.sourceKey || ''),
        createdAt
    ).run();
}

async function syncDesignerStudioAssetsForSummary(env, shopId, summary) {
    const report = { candidates: 0, imported: 0, existing: 0, errors: [] };
    const candidates = designerAssetCandidates(summary);
    report.candidates = candidates.length;
    for (const candidate of candidates) {
        try {
            const result = await copyDesignerAsset(env, shopId, summary.id, candidate);
            report[result.state] += 1;
        } catch (error) {
            report.errors.push({
                code: 'DESIGNER_ASSET_SYNC_FAILED',
                message: error.message,
                lineItemId: candidate.lineItemId,
                designRef: candidate.designRef
            });
        }
    }
    return report;
}

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
        try { state = normalizeProductionState(JSON.parse(row.production_json)); }
        catch (_) { state = defaultProductionState(); }
        await d1ProjectionUpsert(env, shop.id, summary.id, state, row.production_digest, summary);
    }
}

async function refreshSummaries(env, gids, graphQL = coordinatorGraphQL) {
    const valid = [...new Set(gids.map(canonicalOrderGid).filter(Boolean))];
    const summaries = [];
    for (let index = 0; index < valid.length; index += 20) {
        const chunk = valid.slice(index, index + 20);
        const result = await graphQL(env, ORDER_SUMMARIES_QUERY, { ids: chunk }, 'PrintMOOrderSummaries');
        const data = requireShopifyData(result, 'PrintMOOrderSummaries');
        for (const [nodeIndex, node] of (data.nodes || []).entries()) {
            if (node?.id) {
                const nodeErrors = (result.errors || []).filter(error => {
                    const path = Array.isArray(error?.path) ? error.path : null;
                    if (!path || path[0] !== 'nodes' || !Number.isInteger(path[1])) return true;
                    return path[1] === nodeIndex;
                });
                summaries.push(await normalizeShopifySummary(env, node, nodeErrors, graphQL));
            }
        }
    }
    const shop = await d1Shop(env);
    const projected = new Set();
    for (let index = 0; index < summaries.length; index += 50) {
        const ids = summaries.slice(index, index + 50).map(summary => summary.id);
        if (!ids.length) continue;
        const placeholders = ids.map(() => '?').join(', ');
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
        try { previous = JSON.parse(completed.last_result_json || '{}'); } catch (_) {}
        return { ok: true, alreadyCompleted: true, ...previous };
    }
    const rows = await db.prepare(`
      SELECT order_gid
      FROM order_projection
      WHERE shop_id = ? AND active = 1
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(shop.id).all();
    const gids = (rows.results || []).map(row => row.order_gid);
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
            { code: 'DESIGNER_ASSET_BACKFILL_INCOMPLETE', report: result }
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
        JSON.stringify(result),
    ).run();
    return { ok: true, ...result };
}

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
        try { previous = existing.last_result_json ? JSON.parse(existing.last_result_json) : null; } catch (_) {}
        return { ok: true, alreadyInitialized: true, ...(previous || {}) };
    }

    const startedAt = isoNow();
    const result = await graphQL(
        env,
        BOOTSTRAP_ORDERS_QUERY,
        { query: 'financial_status:paid status:open', first: 50 },
        'PrintMOBootstrapOrders'
    );
    const connection = requireShopifyData(result, 'PrintMOBootstrapOrders').orders;
    if (!connection) {
        throw Object.assign(new Error('Initial Shopify reconciliation returned no orders connection.'), {
            code: 'BOOTSTRAP_ORDERS_MISSING',
            status: 502
        });
    }

    const gids = [];
    for (const order of connection.nodes || []) {
        const gid = canonicalOrderGid(order?.id);
        if (!gid) continue;
        const production = parseProductionMetafield(order.metafield, 'bootstrap');
        await d1ProjectionUpsert(
            env,
            shop.id,
            gid,
            production.state,
            production.compareDigest,
            undefined,
            order
        );
        gids.push(gid);
    }
    if (gids.length) await refreshSummaries(env, gids, graphQL);

    const completedAt = isoNow();
    const report = {
        ok: true,
        projected: gids.length,
        truncated: Boolean(connection.pageInfo?.hasNextPage),
        query: 'financial_status:paid status:open',
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

async function bootstrapThroughCoordinator(env) {
    if (!env.ORDER_SYNC_COORDINATOR) return bootstrapInitialBoard(env, shopifyGraphQLWithRetry);
    const id = env.ORDER_SYNC_COORDINATOR.idFromName(shopDomain(env));
    const response = await env.ORDER_SYNC_COORDINATOR.get(id).fetch(new Request('https://internal/bootstrap'));
    const body = await response.json();
    if (!response.ok) {
        throw Object.assign(new Error(body?.error || 'Initial Shopify reconciliation failed'), {
            code: 'BOARD_BOOTSTRAP_FAILED',
            status: response.status
        });
    }
    return body;
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
        taxLines: (item.taxLines || []).map(taxLine => ({
            title: taxLine.title || 'Tax',
            rate: Number(taxLine.rate || 0),
            amount: moneyValue(taxLine.priceSet, fallbackCurrency)
        })),
        discountAllocations: (item.discountAllocations || []).map(allocation =>
            moneyValue(allocation.allocatedAmountSet, fallbackCurrency)
        ).filter(Boolean)
    };
}

async function completeCanonicalDetailLineItems(env, orderId, connection, fallbackCurrency) {
    const items = (connection?.nodes || []).map(item => normalizePreviewLineItem(item, fallbackCurrency));
    const errors = [];
    let pageInfo = connection?.pageInfo || { hasNextPage: false, endCursor: null };
    while (pageInfo.hasNextPage) {
        const result = await coordinatorGraphQL(env, ORDER_DETAIL_LINE_ITEMS_QUERY, { id: orderId, after: pageInfo.endCursor }, 'PrintMOOrderDetailLineItems');
        errors.push(...(result.errors || []));
        const next = result.data?.order?.lineItems;
        if (!next) return { items, complete: false, errors };
        items.push(...(next.nodes || []).map(item => normalizePreviewLineItem(item, fallbackCurrency)));
        pageInfo = next.pageInfo || { hasNextPage: false, endCursor: null };
    }
    return { items, complete: true, errors };
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
            selectOperationalCustomerName(order) || order.customer?.email || order.customer?.phone ||
            order.email || order.phone
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
    if (record?.kind === 'provider') return providerBoardDto(record);
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

function providerProjectionRecord(row) {
    let contract = null;
    let production = defaultProductionState();
    try { contract = row.commerce_json ? JSON.parse(row.commerce_json) : null; } catch (_) {}
    try { production = normalizeProductionState(JSON.parse(row.state_json || '{}')); } catch (_) {}
    return {
        kind: 'provider',
        orderKey: row.order_key,
        provider: row.provider,
        contract,
        production,
        enrollmentState: row.enrollment_state,
        staleAt: row.stale_at,
        lastError: row.last_error
    };
}

function providerGarmentCount(contract) {
    return garmentCountFromLineItems(contract?.commerce?.lineItems || []);
}

function providerBoardDto(record) {
    const contract = record.contract || {};
    const production = productionForClient(
        record.orderKey,
        record.production,
        null,
        [],
        providerGarmentCount(contract)
    );
    const source = {
        provider: record.provider || contract?.source?.provider || 'unknown',
        label: contract?.source?.label || record.provider || 'Unknown',
        providerAccountId: contract?.source?.providerAccountId || null,
        externalOrderId: contract?.source?.externalOrderId || null,
        displayNumber: contract?.source?.displayNumber || contract?.displayName || record.orderKey,
        adminUrl: contract?.source?.adminUrl || null,
        synthetic: Boolean(contract?.source?.synthetic)
    };
    const errors = [...(Array.isArray(contract?.sync?.errors) ? contract.sync.errors : [])];
    if (record.lastError) errors.push({ code: 'PROVIDER_PROJECTION_ERROR', message: record.lastError });
    return {
        ...contract,
        id: record.orderKey,
        orderKey: record.orderKey,
        source,
        production,
        productionRef: {
            authority: 'printmo-d1',
            provider: source.provider,
            orderKey: record.orderKey,
            revision: production.revision
        },
        attention: record.production.attention,
        capabilities: {
            ...(contract?.capabilities || {}),
            productionWrite: ['pilot', 'active'].includes(record.enrollmentState)
        },
        sync: {
            ...(contract?.sync || {}),
            stale: Boolean(record.staleAt || contract?.sync?.stale),
            partial: Boolean(record.lastError || contract?.sync?.partial),
            errors
        }
    };
}

async function loadDataPage(env, stage, limit, offset) {
    const shop = await d1Shop(env);
    const db = requireOrderDb(env);
    if (stage) {
        if (!PRODUCTION_STAGES.has(stage)) throw Object.assign(new Error('Stage filter is invalid.'), { code: 'INVALID_STAGE', status: 400 });
    }
    const shopifyStage = stage ? ' AND stage = ?' : '';
    const providerStage = stage ? ` AND json_extract(ps.state_json, '$.stage') = ?` : '';
    const shopifyValues = [shop.id, ...(stage ? [stage] : [])];
    const providerValues = [shop.id, ...(stage ? [stage] : [])];
    const refs = await db.prepare(`
      SELECT source_kind, source_id, source_created_at
      FROM (
        SELECT 'shopify' AS source_kind, order_gid AS source_id, created_at AS source_created_at
        FROM order_projection
        WHERE shop_id = ? AND active = 1${shopifyStage}
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
          WHERE shop_id = ? AND active = 1${shopifyStage}
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
    const shopifyIds = refList.filter(ref => ref.source_kind === 'shopify').map(ref => ref.source_id);
    const providerIds = refList.filter(ref => ref.source_kind === 'provider').map(ref => ref.source_id);
    const [shopifyRows, providerRows] = await Promise.all([
        shopifyIds.length
            ? db.prepare(`SELECT * FROM order_projection WHERE shop_id = ? AND order_gid IN (${shopifyIds.map(() => '?').join(',')})`)
                .bind(shop.id, ...shopifyIds).all()
            : Promise.resolve({ results: [] }),
        providerIds.length
            ? db.prepare(`
                SELECT p.*, ps.revision, ps.last_mutation_id, ps.state_json,
                       ps.created_at AS production_created_at, ps.updated_at AS production_updated_at
                FROM provider_order_projection p
                JOIN provider_production_state ps
                  ON ps.shop_id = p.shop_id AND ps.order_key = p.order_key
                WHERE p.shop_id = ? AND p.order_key IN (${providerIds.map(() => '?').join(',')})
              `).bind(shop.id, ...providerIds).all()
            : Promise.resolve({ results: [] })
    ]);
    const shopifyById = new Map((shopifyRows.results || []).map(row => [row.order_gid, row]));
    const providerById = new Map((providerRows.results || []).map(row => [row.order_key, row]));
    const assetsByOrder = await d1AssetsForOrders(env, shop.id, shopifyIds);
    const records = refList.map(ref => {
        if (ref.source_kind === 'provider') return providerProjectionRecord(providerById.get(ref.source_id) || {});
        const row = shopifyById.get(ref.source_id) || {};
        const record = d1ProjectionRecord(row);
        record.production.assets = assetsByOrder.get(row.order_gid) || [];
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

async function handleV1OrdersGet(request, env, allowOrigin, reqAllowHeaders, ctx) {
    try {
        const url = new URL(request.url);
        const stage = url.searchParams.get('stage') || '';
        const forceRefresh = url.searchParams.get('refresh') === '1';
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 50);
        const filter = JSON.stringify({ stage, limit });
        const offset = await decodeSignedCursor(url.searchParams.get('cursor'), filter, env);
        let page = await loadDataPage(env, stage, limit, offset);
        if (page.shopifyTotal === 0 && offset === 0) {
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
                    page = await loadDataPage(env, stage, limit, offset);
                } catch (error) {
                    console.error('Initial Shopify board reconciliation failed:', error.message);
                    return v1Error({
                        code: 'BOARD_NOT_INITIALIZED',
                        message: `The Shopify board could not complete its initial read: ${error.message}`
                    }, allowOrigin, reqAllowHeaders, 503);
                }
            }
        }
        const staleGids = (page.records || []).filter(record => {
            if (record.kind !== 'shopify') return false;
            if (forceRefresh) return true;
            const summary = record.summary;
            return !summary || summary.sync?.stale || !summary.sync?.freshUntil || Date.parse(summary.sync.freshUntil) <= Date.now();
        }).map(record => record.gid);
        if (staleGids.length) {
            if (forceRefresh || !ctx?.waitUntil) {
                try {
                    await refreshThroughCoordinator(env, staleGids);
                    page = await loadDataPage(env, stage, limit, offset);
                } catch (error) {
                    console.error('Shopify summary refresh failed:', error.message);
                }
            } else {
                ctx.waitUntil(refreshThroughCoordinator(env, staleGids).catch(error => {
                    console.error('Background Shopify summary refresh failed:', error.message);
                }));
            }
        }
        if (ctx?.waitUntil) {
            ctx.waitUntil(backfillDesignerStudioAssets(env).catch(error => {
                console.error('Designer Studio asset backfill error:', error.message);
            }));
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

function providerOrderKeyFromV1Path(pathname) {
    const raw = pathname.replace(/^\/order-manager\/v1\/orders\//, '').replace(/\/production$/, '');
    try {
        const decoded = decodeURIComponent(raw);
        return /^etsy(?:-synthetic)?:[A-Za-z0-9._-]{1,80}:[A-Za-z0-9._-]{1,120}$/.test(decoded)
            ? decoded
            : null;
    } catch (_) {
        return null;
    }
}

function orderIdentityFromV1Path(pathname) {
    const providerKey = providerOrderKeyFromV1Path(pathname);
    if (providerKey) return { provider: 'etsy', id: providerKey };
    const gid = orderIdFromV1Path(pathname);
    return gid ? { provider: 'shopify', id: gid } : null;
}

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
        throw Object.assign(new Error('Provider order not found on the active board.'), {
            code: 'ORDER_NOT_FOUND',
            status: 404
        });
    }
    return { shop, row, record: providerProjectionRecord(row) };
}

function providerDetailLineItems(contract) {
    const currencyCode = contract?.commerce?.currencyCode || 'USD';
    return (contract?.commerce?.lineItems || []).map(item => {
        const variations = Array.isArray(item.variations) ? item.variations : [];
        const variantTitle = variations
            .filter(variation => !variation?.questionId && !/personal/i.test(String(variation?.name || '')))
            .map(variation => variation?.value)
            .filter(Boolean)
            .join(' / ');
        const quantity = Math.max(0, Number(item.currentQuantity ?? item.quantity ?? 0));
        const unitPrice = Number(item.unitPrice || 0);
        return {
            ...item,
            quantity,
            currentQuantity: quantity,
            unfulfilledQuantity: contract?.commerce?.shipped ? 0 : quantity,
            variantTitle,
            customAttributes: variations
                .filter(variation => variation?.name && variation?.value)
                .map(variation => ({ key: variation.name, value: variation.value })),
            unitPrice: { amount: unitPrice, currencyCode: item.currencyCode || currencyCode },
            currentTotal: { amount: unitPrice * quantity, currencyCode: item.currencyCode || currencyCode },
            discountAllocations: [],
            requiresShipping: true
        };
    });
}

async function providerProductionEvents(env, shopId, orderKey) {
    const result = await requireOrderDb(env).prepare(`
      SELECT actor_id, old_revision, new_revision, changed_fields_json, outcome, created_at
      FROM provider_production_events
      WHERE shop_id = ? AND order_key = ?
      ORDER BY created_at DESC
      LIMIT 25
    `).bind(shopId, orderKey).all();
    return (result.results || []).map(row => {
        let fields = [];
        try {
            const parsed = JSON.parse(row.changed_fields_json || '{}');
            fields = Array.isArray(parsed) ? parsed : Object.keys(parsed);
        } catch (_) {}
        return {
            action: 'provider.production.patch',
            actor: row.actor_id || null,
            fields,
            outcome: row.outcome || null,
            oldRevision: row.old_revision,
            newRevision: row.new_revision,
            createdAt: row.created_at || null
        };
    });
}

async function handleProviderOrderDetailGet(env, orderKey, allowOrigin, reqAllowHeaders) {
    const { shop, record } = await readProviderOrder(env, orderKey);
    const dto = providerBoardDto(record);
    const lineItems = providerDetailLineItems(dto);
    const productionEvents = await providerProductionEvents(env, shop.id, orderKey);
    const synthetic = Boolean(dto.source?.synthetic);
    return jsonResponse({
        ...dto,
        productionEvents,
        detail: {
            id: orderKey,
            provider: dto.source?.provider || 'etsy',
            fetchedAt: dto.sync?.fetchedAt || isoNow(),
            partial: Boolean(dto.sync?.partial),
            errors: dto.sync?.errors || [],
            orderNote: null,
            customer: { displayName: dto.customer?.displayName || null, email: null, phone: null },
            lineItems,
            data: {
                source: dto.source,
                customer: { displayName: dto.customer?.displayName || null, email: null, phone: null },
                commerce: { ...dto.commerce, lineItems },
                delivery: {
                    shippingAddress: null,
                    billingAddress: null,
                    shippingLines: [],
                    fulfillmentOrders: [],
                    fulfillments: []
                },
                discounts: [],
                timeline: [{
                    id: `${orderKey}:enrolled`,
                    type: synthetic ? 'SYNTHETIC_PILOT' : 'ETSY_RECEIPT',
                    createdAt: dto.createdAt,
                    action: 'provider.enrolled',
                    message: synthetic ? 'Synthetic Etsy pilot order created' : 'Etsy receipt enrolled',
                    author: 'PrintMO Order Manager'
                }]
            }
        }
    }, allowOrigin, reqAllowHeaders);
}

async function handleProviderProductionGet(env, orderKey, allowOrigin, reqAllowHeaders) {
    const { record } = await readProviderOrder(env, orderKey);
    const dto = providerBoardDto(record);
    return jsonResponse({
        orderKey,
        canonicalSource: 'printmo-d1-provider-production',
        production: dto.production
    }, allowOrigin, reqAllowHeaders);
}

async function completeProviderMutation(env, shopId, requestRow, record, nextState, patch) {
    const db = requireOrderDb(env);
    const contract = record.contract || {};
    const production = productionForClient(
        requestRow.order_key,
        nextState,
        null,
        [],
        providerGarmentCount(contract)
    );
    const result = {
        ok: true,
        canonicalSource: 'printmo-d1-provider-production',
        syncPending: false,
        production
    };
    const now = isoNow();
    const changedFields = Object.fromEntries(Object.keys(patch).map(key => [key, true]));
    await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO provider_production_events (
            id, shop_id, order_key, mutation_request_id, actor_id,
            old_revision, new_revision, changed_fields_json, outcome, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?)
        `).bind(
            `event:${requestRow.id}`, shopId, requestRow.order_key, requestRow.id,
            requestRow.actor_id, Number(requestRow.expected_revision || 0), nextState.revision,
            JSON.stringify(changedFields), now
        ),
        db.prepare(`
          UPDATE provider_mutation_requests
          SET state = 'complete', result_revision = ?, result_json = ?, error_code = NULL, updated_at = ?
          WHERE id = ?
        `).bind(nextState.revision, JSON.stringify(result), now, requestRow.id)
    ]);
    return result;
}

async function handleProviderProductionPatch(request, env, orderKey, allowOrigin, reqAllowHeaders, identity) {
    const body = await request.json().catch(() => ({}));
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        return v1Error({ code: 'EXPECTED_VERSION_REQUIRED', message: 'A non-negative expectedVersion is required.' }, allowOrigin, reqAllowHeaders, 400);
    }
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
        return v1Error({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid idempotency key is required.' }, allowOrigin, reqAllowHeaders, 400);
    }
    let patch;
    try {
        patch = normalizeProductionPatch(body.patch);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 400);
    }
    if (!Object.keys(patch).length) {
        return v1Error({ code: 'EMPTY_PATCH', message: 'At least one production field must change.' }, allowOrigin, reqAllowHeaders, 400);
    }
    const actor = `${identity?.kind || 'unknown'}:${identity?.subject || 'unknown'}`;
    const { shop, record } = await readProviderOrder(env, orderKey);
    if (record.enrollmentState !== 'pilot') {
        return v1Error({
            code: 'PROVIDER_PRODUCTION_WRITE_DISABLED',
            message: 'Production updates are disabled for this provider order.'
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
    if (!requestRow) throw Object.assign(new Error('Unable to persist the provider mutation request.'), { code: 'MUTATION_REQUEST_FAILED', status: 503 });
    if (
        requestRow.order_key !== orderKey
        || requestRow.patch_json !== patchJson
        || Number(requestRow.expected_revision) !== expectedVersion
    ) {
        return v1Error({ code: 'IDEMPOTENCY_KEY_REUSE', message: 'This idempotency key was already used for a different request.' }, allowOrigin, reqAllowHeaders, 409);
    }
    if (requestRow.state === 'complete' && requestRow.result_json) {
        return jsonResponse(JSON.parse(requestRow.result_json), allowOrigin, reqAllowHeaders);
    }
    const currentRead = await readProviderOrder(env, orderKey);
    const current = currentRead.record.production;
    const garmentCount = providerGarmentCount(currentRead.record.contract);
    if ('printedCount' in patch && patch.printedCount > garmentCount) {
        await db.prepare(`
          UPDATE provider_mutation_requests
          SET state = 'failed', error_code = 'INVALID_PRINTED_COUNT', updated_at = ?
          WHERE id = ?
        `).bind(isoNow(), requestRow.id).run();
        return v1Error({
            code: 'INVALID_PRINTED_COUNT',
            message: `Printed count cannot exceed the current garment count of ${garmentCount}.`
        }, allowOrigin, reqAllowHeaders, 400);
    }
    if (current.lastMutationId === requestRow.id) {
        const repaired = await completeProviderMutation(env, shop.id, requestRow, currentRead.record, current, patch);
        return jsonResponse(repaired, allowOrigin, reqAllowHeaders);
    }
    if (current.revision !== expectedVersion) {
        return v1Error({
            code: 'VERSION_CONFLICT',
            message: 'Production metadata changed on another client.'
        }, allowOrigin, reqAllowHeaders, 409, {
            currentVersion: current.revision,
            current: productionForClient(orderKey, current, null, [], garmentCount)
        });
    }
    const next = applyProductionPatch(current, patch, actor, requestRow.id);
    const saved = await db.prepare(`
      UPDATE provider_production_state
      SET revision = ?, last_mutation_id = ?, state_json = ?, updated_at = ?
      WHERE shop_id = ? AND order_key = ? AND revision = ?
    `).bind(next.revision, next.lastMutationId, JSON.stringify(next), next.updatedAt, shop.id, orderKey, expectedVersion).run();
    if (!saved.meta?.changes) {
        const conflictRead = await readProviderOrder(env, orderKey);
        const conflict = conflictRead.record.production;
        return v1Error({
            code: 'VERSION_CONFLICT',
            message: 'Production metadata changed on another client.'
        }, allowOrigin, reqAllowHeaders, 409, {
            currentVersion: conflict.revision,
            current: productionForClient(orderKey, conflict, null, [], providerGarmentCount(conflictRead.record.contract))
        });
    }
    const result = await completeProviderMutation(env, shop.id, requestRow, currentRead.record, next, patch);
    return jsonResponse(result, allowOrigin, reqAllowHeaders);
}

async function fetchOrderDetail(env, gid) {
    const result = await coordinatorGraphQL(env, ORDER_DETAIL_QUERY, { id: gid, after: null }, 'PrintMOOrderDetail');
    const node = requireShopifyData(result, 'PrintMOOrderDetail').order;
    if (!node) throw Object.assign(new Error('Shopify order not found'), { status: 404, code: 'ORDER_NOT_FOUND' });
    const currency = node.currencyCode || node.currentTotalPriceSet?.shopMoney?.currencyCode || null;
    const lines = await completeCanonicalDetailLineItems(env, gid, node.lineItems, currency);
    const summary = await normalizeShopifySummary(env, { ...node, lineItems: { nodes: lines.items.map(item => ({
        ...item,
        originalUnitPriceSet: { shopMoney: { amount: item.unitPrice?.amount || '0', currencyCode: currency } }
    })), pageInfo: { hasNextPage: false } } }, result.errors || [], coordinatorGraphQL);
    const now = Date.now();
    const rawErrors = [...(result.errors || []), ...lines.errors];
    const detail = {
        id: gid,
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
                transactions: (node.transactions || []).map(transaction => ({
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
                shippingLines: (node.shippingLines?.nodes || []).map(line => ({
                    id: line.id, title: line.title, code: line.code || null, source: line.source || null,
                    deliveryCategory: line.deliveryCategory || null, custom: Boolean(line.custom),
                    originalPrice: moneyValue(line.originalPriceSet, currency), currentPrice: moneyValue(line.currentDiscountedPriceSet, currency)
                })),
                fulfillmentOrders: (node.fulfillmentOrders?.nodes || []).map(fulfillmentOrder => ({
                    id: fulfillmentOrder.id, status: fulfillmentOrder.status, requestStatus: fulfillmentOrder.requestStatus,
                    fulfillAt: fulfillmentOrder.fulfillAt || null, fulfillBy: fulfillmentOrder.fulfillBy || null,
                    method: fulfillmentOrder.deliveryMethod ? {
                        type: fulfillmentOrder.deliveryMethod.methodType,
                        presentedName: fulfillmentOrder.deliveryMethod.presentedName || null,
                        serviceCode: fulfillmentOrder.deliveryMethod.serviceCode || null,
                        minDeliveryAt: fulfillmentOrder.deliveryMethod.minDeliveryDateTime || null,
                        maxDeliveryAt: fulfillmentOrder.deliveryMethod.maxDeliveryDateTime || null
                    } : null
                })),
                fulfillments: (node.fulfillments || []).map(fulfillment => ({
                    id: fulfillment.id, name: fulfillment.name, status: fulfillment.status,
                    displayStatus: fulfillment.displayStatus || null, createdAt: fulfillment.createdAt,
                    updatedAt: fulfillment.updatedAt, deliveredAt: fulfillment.deliveredAt || null,
                    estimatedDeliveryAt: fulfillment.estimatedDeliveryAt || null,
                    totalQuantity: Number(fulfillment.totalQuantity || 0), tracking: fulfillment.trackingInfo || []
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
            timeline: (node.events?.nodes || []).map(event => ({
                id: event.id, type: event.__typename, createdAt: event.createdAt,
                critical: Boolean(event.criticalAlert), message: event.message || event.rawMessage || null,
                action: event.action || null, appTitle: event.appTitle || null,
                author: event.author || null, secondaryMessage: event.secondaryMessage || null
            }))
        },
        fetchedAt: new Date(now).toISOString(),
        freshUntil: new Date(now + 300000).toISOString(),
        hardExpiresAt: new Date(now + 900000).toISOString(),
        partial: !lines.complete || rawErrors.length > 0,
        errors: rawErrors.map(previewError)
    };
    return detail;
}

async function d1ProductionEventsForOrder(env, shopId, gid) {
    const result = await requireOrderDb(env).prepare(`
      SELECT action, actor_id, changed_fields_json, outcome, created_at
      FROM production_events
      WHERE shop_id = ? AND order_gid = ?
      ORDER BY created_at DESC
      LIMIT 25
    `).bind(shopId, gid).all();
    return (result.results || []).map(row => {
        let changedFields = [];
        try { changedFields = Object.keys(JSON.parse(row.changed_fields_json || '{}')); } catch (_) { /* display remains useful without the field list */ }
        return {
            action: row.action || 'production.patch',
            actor: row.actor_id || null,
            fields: changedFields,
            outcome: row.outcome || null,
            createdAt: row.created_at || null
        };
    });
}

async function handleV1OrderDetailGet(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const orderIdentity = orderIdentityFromV1Path(new URL(request.url).pathname);
        if (!orderIdentity) return v1Error({ code: 'INVALID_ORDER_ID', message: 'Invalid order identity' }, allowOrigin, reqAllowHeaders, 400);
        if (orderIdentity.provider === 'etsy') {
            return await handleProviderOrderDetailGet(env, orderIdentity.id, allowOrigin, reqAllowHeaders);
        }
        const gid = orderIdentity.id;
        const [detail, productionRead] = await Promise.all([
            fetchOrderDetail(env, gid),
            readProductionMetafield(env, gid)
        ]);
        const shop = await d1Shop(env);
        const [assets, productionEvents] = await Promise.all([
            d1AssetsForOrder(env, shop.id, gid),
            d1ProductionEventsForOrder(env, shop.id, gid)
        ]);
        await d1ProjectionUpsert(env, shop.id, gid, productionRead.state, productionRead.compareDigest, detail.summary, productionRead.order);
        return jsonResponse({
            ...detail.summary,
            production: productionForClient(
                gid,
                productionRead.state,
                productionRead.compareDigest,
                assets,
                garmentCountFromLineItems(detail.summary?.commerce?.lineItems || [])
            ),
            attention: productionRead.state.attention,
            productionEvents,
            detail
        }, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
    }
}

async function handleV1ProductionGet(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const orderIdentity = orderIdentityFromV1Path(new URL(request.url).pathname);
        if (!orderIdentity) return v1Error({ code: 'INVALID_ORDER_ID', message: 'Invalid order identity' }, allowOrigin, reqAllowHeaders, 400);
        if (orderIdentity.provider === 'etsy') {
            return await handleProviderProductionGet(env, orderIdentity.id, allowOrigin, reqAllowHeaders);
        }
        const gid = orderIdentity.id;
        const productionRead = await readProductionMetafield(env, gid);
        const shop = await d1Shop(env);
        const [assets, garmentCount] = await Promise.all([
            d1AssetsForOrder(env, shop.id, gid),
            productionGarmentCount(env, productionRead)
        ]);
        await d1ProjectionUpsert(env, shop.id, gid, productionRead.state, productionRead.compareDigest, undefined, productionRead.order);
        return jsonResponse({
            gid,
            canonicalSource: 'shopify-app-owned-metafield',
            production: productionForClient(gid, productionRead.state, productionRead.compareDigest, assets, garmentCount)
        }, allowOrigin, reqAllowHeaders);
    } catch (error) {
        return v1Error(error.body?.error || error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
    }
}

async function d1FinalizeProductionMutation(env, shopId, requestRow, gid, state, compareDigest, production, changedFields, order) {
    const db = requireOrderDb(env);
    const now = isoNow();
    const active = state.archivedAt ? 0 : 1;
    const resultJson = JSON.stringify({
        ok: true,
        canonicalSource: 'shopify-app-owned-metafield',
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
        shopId, gid, order?.name || null, state.stage, active, state.revision,
        compareDigest || null, JSON.stringify(state), order?.updatedAt || null,
        now, order?.createdAt || now, now
    );
    const event = db.prepare(`
      INSERT OR IGNORE INTO production_events (
        id, shop_id, order_gid, mutation_request_id, actor_id, action,
        old_revision, new_revision, changed_fields_json, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, 'production.patch', ?, ?, ?, 'committed', ?)
    `).bind(
        `event:${requestRow.id}`, shopId, gid, requestRow.id, requestRow.actor_id,
        Number(requestRow.expected_revision || 0), state.revision, JSON.stringify(changedFields), now
    );
    const complete = db.prepare(`
      UPDATE mutation_requests
      SET state = 'complete', result_json = ?, error_code = NULL, updated_at = ?
      WHERE id = ?
    `).bind(resultJson, now, requestRow.id);
    await db.batch([projection, event, complete]);
    return JSON.parse(resultJson);
}

async function handleV1ProductionPatch(request, env, allowOrigin, reqAllowHeaders, identity) {
    try {
        const orderIdentity = orderIdentityFromV1Path(new URL(request.url).pathname);
        if (!orderIdentity) return v1Error({ code: 'INVALID_ORDER_ID', message: 'Invalid order identity' }, allowOrigin, reqAllowHeaders, 400);
        if (orderIdentity.provider === 'etsy') {
            return await handleProviderProductionPatch(request, env, orderIdentity.id, allowOrigin, reqAllowHeaders, identity);
        }
        const gid = orderIdentity.id;
        const body = await request.json().catch(() => ({}));
        const expectedVersion = Number(body.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
            return v1Error({ code: 'EXPECTED_VERSION_REQUIRED', message: 'A non-negative expectedVersion is required.' }, allowOrigin, reqAllowHeaders, 400);
        }
        const idempotencyKey = String(body.idempotencyKey || '').trim();
        if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
            return v1Error({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid idempotency key is required.' }, allowOrigin, reqAllowHeaders, 400);
        }
        const patch = normalizeProductionPatch(body.patch);
        if (!Object.keys(patch).length) {
            return v1Error({ code: 'EMPTY_PATCH', message: 'At least one production field must change.' }, allowOrigin, reqAllowHeaders, 400);
        }
        const actor = `${identity?.kind || 'unknown'}:${identity?.subject || 'unknown'}`;
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
        `).bind(requestId, shop.id, actor, idempotencyKey, gid, patchJson, expectedVersion, now, now).run();
        const requestRow = await db.prepare(`
          SELECT * FROM mutation_requests
          WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?
        `).bind(shop.id, actor, idempotencyKey).first();
        if (!requestRow) throw Object.assign(new Error('Unable to persist the mutation request.'), { code: 'MUTATION_REQUEST_FAILED', status: 503 });
        if (requestRow.order_gid !== gid || requestRow.requested_patch_json !== patchJson || Number(requestRow.expected_revision) !== expectedVersion) {
            return v1Error({ code: 'IDEMPOTENCY_KEY_REUSE', message: 'This idempotency key was already used for a different request.' }, allowOrigin, reqAllowHeaders, 409);
        }
        if (requestRow.state === 'complete' && requestRow.result_json) {
            return jsonResponse(JSON.parse(requestRow.result_json), allowOrigin, reqAllowHeaders);
        }

        const current = await readProductionMetafield(env, gid, actor);
        const garmentCount = await productionGarmentCount(env, current);
        if ('printedCount' in patch && patch.printedCount > garmentCount) {
            await db.prepare(`
              UPDATE mutation_requests
              SET state = 'failed', error_code = 'INVALID_PRINTED_COUNT', updated_at = ?
              WHERE id = ?
            `).bind(isoNow(), requestRow.id).run();
            return v1Error({
                code: 'INVALID_PRINTED_COUNT',
                message: `Printed count cannot exceed the current garment count of ${garmentCount}.`
            }, allowOrigin, reqAllowHeaders, 400);
        }
        if (current.state.lastMutationId === requestRow.id) {
            const assets = await d1AssetsForOrder(env, shop.id, gid);
            const production = productionForClient(gid, current.state, current.compareDigest, assets, garmentCount);
            const repaired = await d1FinalizeProductionMutation(
                env, shop.id, requestRow, gid, current.state, current.compareDigest,
                production, Object.keys(patch), current.order
            );
            return jsonResponse(repaired, allowOrigin, reqAllowHeaders);
        }
        if (current.state.revision !== expectedVersion) {
            return v1Error({
                code: 'VERSION_CONFLICT',
                message: 'Production metadata changed on another client.'
            }, allowOrigin, reqAllowHeaders, 409, {
                currentVersion: current.state.revision,
                current: productionForClient(gid, current.state, current.compareDigest, [], garmentCount)
            });
        }

        const nextState = applyProductionPatch(current.state, patch, actor, requestRow.id);
        const saved = await setProductionMetafield(env, gid, nextState, current.compareDigest);
        const assets = await d1AssetsForOrder(env, shop.id, gid);
        const production = productionForClient(gid, saved.state, saved.compareDigest, assets, garmentCount);
        try {
            const result = await d1FinalizeProductionMutation(
                env, shop.id, requestRow, gid, saved.state, saved.compareDigest,
                production, Object.keys(patch), current.order
            );
            return jsonResponse(result, allowOrigin, reqAllowHeaders);
        } catch (error) {
            console.error('D1 finalization failed after Shopify production commit:', error.message);
            return jsonResponse({
                ok: true,
                canonicalSource: 'shopify-app-owned-metafield',
                syncPending: true,
                production,
                warning: { code: 'SYNC_PENDING', message: 'Shopify saved the change; PrintMO is repairing its board projection.' }
            }, allowOrigin, reqAllowHeaders, 202);
        }
    } catch (error) {
        return v1Error(error.body?.error || error, allowOrigin, reqAllowHeaders, error.status || 500, error.body);
    }
}

function supplierLinesFromProjectionRows(rows) {
    const aggregate = new Map();
    for (const row of rows) {
        let summary;
        try { summary = JSON.parse(row.commerce_json || '{}'); } catch (_) { summary = {}; }
        for (const item of summary?.commerce?.lineItems || []) {
            if (PRINT_TITLES.has(item?.title)) continue;
            const sku = String(item?.sku || '').trim();
            const qty = Number(item?.currentQuantity ?? item?.quantity ?? 0);
            if (!sku || !Number.isInteger(qty) || qty <= 0) continue;
            aggregate.set(sku, (aggregate.get(sku) || 0) + qty);
        }
    }
    return [...aggregate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sku, qty]) => ({ sku, qty }));
}

async function confirmedBatchProductionUpdate(env, shop, row, batchId, poNumber, actor, graphQL = coordinatorGraphQL) {
    const current = await readProductionMetafield(env, row.order_gid, actor, graphQL);
    if (
        current.state.batchRefs.includes(poNumber)
        && ['blanks_cart', 'blanks_ordered', 'print', 'completed'].includes(current.state.stage)
    ) {
        await d1ProjectionUpsert(env, shop.id, row.order_gid, current.state, current.compareDigest);
        return { repaired: false, revision: current.state.revision };
    }
    const next = normalizeProductionState(current.state, actor);
    next.stage = 'blanks_cart';
    next.readiness.blanksOrdered = false;
    next.batchRefs = [...new Set([...next.batchRefs, poNumber])].slice(0, 100);
    next.revision = current.state.revision + 1;
    next.lastMutationId = `batch:${batchId}`;
    next.updatedAt = isoNow();
    next.updatedBy = actor;
    const saved = await setProductionMetafield(env, row.order_gid, next, current.compareDigest, graphQL);
    await d1ProjectionUpsert(env, shop.id, row.order_gid, saved.state, saved.compareDigest);
    return { repaired: true, revision: saved.state.revision };
}

async function handleV1BatchCommit(request, env, allowOrigin, reqAllowHeaders, identity) {
    try {
        const body = await request.json().catch(() => ({}));
        const gids = [...new Set((body.orderIds || []).map(canonicalOrderGid).filter(Boolean))];
        if (!gids.length || gids.length > 50) {
            return v1Error({
                code: 'INVALID_BATCH_ORDERS',
                message: 'Select between 1 and 50 Shopify orders.'
            }, allowOrigin, reqAllowHeaders, 400);
        }
        const idempotencyKey = String(body.idempotencyKey || '').trim();
        if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
            return v1Error({
                code: 'IDEMPOTENCY_KEY_REQUIRED',
                message: 'A valid idempotency key is required.'
            }, allowOrigin, reqAllowHeaders, 400);
        }
        const actor = `${identity?.kind || 'unknown'}:${identity?.subject || 'unknown'}`;
        const shop = await d1Shop(env);
        const db = requireOrderDb(env);
        const placeholders = gids.map(() => '?').join(',');
        const query = await db.prepare(`
          SELECT order_gid, production_revision, production_json, commerce_json
          FROM order_projection
          WHERE shop_id = ? AND active = 1 AND order_gid IN (${placeholders})
        `).bind(shop.id, ...gids).all();
        const rows = query.results || [];
        if (rows.length !== gids.length) {
            return v1Error({
                code: 'BATCH_ORDER_MISSING',
                message: 'One or more selected orders are not available in the Shopify board.'
            }, allowOrigin, reqAllowHeaders, 409);
        }
        for (const row of rows) {
            const production = normalizeProductionState(JSON.parse(row.production_json || '{}'), actor);
            if (!['to_order', 'blanks_cart'].includes(production.stage)) {
                return v1Error({
                    code: 'INVALID_BATCH_STAGE',
                    message: 'Every selected order must be in Create blanks order or Blanks cart.'
                }, allowOrigin, reqAllowHeaders, 409);
            }
        }
        const lines = supplierLinesFromProjectionRows(rows);
        if (!lines.length) {
            return v1Error({
                code: 'BATCH_HAS_NO_SUPPLIER_SKUS',
                message: 'The selected orders do not contain purchasable garment SKUs.'
            }, allowOrigin, reqAllowHeaders, 400);
        }
        const lineHash = bytesToHex(await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(JSON.stringify(lines))
        ));
        const batchId = `ssb-${await stableAssetId(`${shop.shop_domain}:${actor}:${idempotencyKey}`)}`;
        const poNumber = `PM-${batchId.slice(-12).toUpperCase()}`;
        const now = isoNow();
        const requestJson = JSON.stringify({ orderIds: gids, lines, orderCount: gids.length });
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await db.prepare(`
          INSERT INTO batches (
            id, shop_id, po_number, state, line_hash, request_json, expires_at,
            created_by, created_at, updated_at
          ) VALUES (?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).bind(batchId, shop.id, poNumber, lineHash, requestJson, expiresAt, actor, now, now).run();
        const batch = await db.prepare('SELECT * FROM batches WHERE id = ? AND shop_id = ?')
            .bind(batchId, shop.id).first();
        if (!batch || batch.line_hash !== lineHash || batch.request_json !== requestJson) {
            return v1Error({
                code: 'BATCH_IDEMPOTENCY_CONFLICT',
                message: 'This batch key was already used for different orders.'
            }, allowOrigin, reqAllowHeaders, 409);
        }
        if (batch.state === 'confirmed') {
            return jsonResponse(JSON.parse(batch.response_json || '{"ok":true}'), allowOrigin, reqAllowHeaders);
        }
        if (['submitting', 'unknown'].includes(batch.state)) {
            return v1Error({
                code: 'BATCH_RECONCILIATION_REQUIRED',
                message: 'This batch may already have reached S&S and must be reconciled before retrying.'
            }, allowOrigin, reqAllowHeaders, 409);
        }
        await db.batch([
            ...rows.map(row => db.prepare(`
              INSERT OR IGNORE INTO batch_orders (batch_id, order_gid, production_revision, quantity_hash)
              VALUES (?, ?, ?, ?)
            `).bind(batchId, row.order_gid, Number(row.production_revision || 0), lineHash)),
            db.prepare(`UPDATE batches SET state = 'submitting', updated_at = ? WHERE id = ?`)
                .bind(isoNow(), batchId)
        ]);

        let supplier;
        try {
            supplier = await upstreamDataRequest(env, '/order-manager/v1/supplier/ss/commit', {
                method: 'POST',
                body: JSON.stringify({
                    batchId,
                    poNumber,
                    lineHash,
                    lines,
                    orderCount: gids.length,
                    testOrder: env.SS_TEST_ORDER !== '0'
                })
            });
        } catch (error) {
            await db.batch([
                db.prepare(`UPDATE batches SET state = 'unknown', response_json = ?, updated_at = ? WHERE id = ?`)
                    .bind(JSON.stringify({ error: error.message }), isoNow(), batchId),
                db.prepare(`
                  INSERT INTO supplier_attempts (
                    id, batch_id, attempt_type, outcome, http_status, response_json, created_at
                  ) VALUES (?, ?, 'commit', 'unknown', ?, ?, ?)
                `).bind(crypto.randomUUID(), batchId, Number(error.status || 0) || null, JSON.stringify({ error: error.message }), isoNow())
            ]);
            return v1Error({
                code: 'SUPPLIER_RESULT_UNKNOWN',
                message: 'S&S did not return a confirmed result. Do not retry until this batch is reconciled.',
                batchId
            }, allowOrigin, reqAllowHeaders, 502);
        }

        const response = {
            ok: true,
            batchId,
            poNumber,
            supplierOrderNumber: supplier.orderNumber,
            lineHash,
            count: gids.length,
            subtotal: supplier.subtotal,
            skuCount: supplier.skuCount,
            testOrder: Boolean(supplier.testOrder),
            metadataRepairRequired: []
        };
        await db.batch([
            db.prepare(`UPDATE batches SET state = 'confirmed', response_json = ?, updated_at = ? WHERE id = ?`)
                .bind(JSON.stringify(response), isoNow(), batchId),
            db.prepare(`
              INSERT INTO supplier_attempts (
                id, batch_id, attempt_type, outcome, http_status, response_json, created_at
              ) VALUES (?, ?, 'commit', 'confirmed', 200, ?, ?)
            `).bind(crypto.randomUUID(), batchId, JSON.stringify(supplier), isoNow())
        ]);
        for (const row of rows) {
            try {
                await confirmedBatchProductionUpdate(env, shop, row, batchId, poNumber, actor);
            } catch (error) {
                console.error(`Confirmed batch metadata repair required for ${row.order_gid}:`, error.message);
                response.metadataRepairRequired.push(row.order_gid);
            }
        }
        await db.prepare(`UPDATE batches SET response_json = ?, updated_at = ? WHERE id = ?`)
            .bind(JSON.stringify(response), isoNow(), batchId).run();
        return jsonResponse(response, allowOrigin, reqAllowHeaders, response.metadataRepairRequired.length ? 202 : 200);
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
        const shop = await d1Shop(env);
        const asset = await requireOrderDb(env).prepare(`
          SELECT id
          FROM asset_manifests
          WHERE id = ? AND shop_id = ? AND state = 'active'
        `).bind(assetId, shop.id).first();
        if (!asset) {
            return v1Error({ code: 'ASSET_NOT_FOUND', message: 'Asset manifest was not found.' }, allowOrigin, reqAllowHeaders, 404);
        }
        const ticket = await signAssetTicket({ assetId, exp: Math.floor(Date.now() / 1000) + 60 }, env);
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
        const shop = await d1Shop(env);
        const asset = await requireOrderDb(env).prepare(`
          SELECT object_key
          FROM asset_manifests
          WHERE id = ? AND shop_id = ? AND state = 'active'
        `).bind(assetId, shop.id).first();
        if (!asset) return v1Error({ code: 'ASSET_NOT_FOUND', message: 'Asset manifest was not found' }, allowOrigin, reqAllowHeaders, 404);
        const object = await env.R2_BUCKET.get(asset.object_key);
        if (!object) return v1Error({ code: 'ASSET_NOT_FOUND', message: 'Asset object was not found' }, allowOrigin, reqAllowHeaders, 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('ETag', object.httpEtag);
        // The short-lived signed URL remains the authorization boundary. Let a
        // browser reuse bytes while that ticket is valid so a board repaint
        // does not re-download the same private mockup.
        headers.set('Cache-Control', 'private, max-age=55');
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

async function handleV1AssetReadTickets(request, env, allowOrigin, reqAllowHeaders) {
    try {
        const body = await request.json().catch(() => ({}));
        const assetIds = [...new Set((Array.isArray(body.assetIds) ? body.assetIds : [])
            .map(value => String(value || '').trim())
            .filter(value => value && value.length <= 200))].slice(0, 50);
        if (!assetIds.length) {
            return v1Error({ code: 'ASSET_IDS_REQUIRED', message: 'At least one asset ID is required.' }, allowOrigin, reqAllowHeaders, 400);
        }
        const shop = await d1Shop(env);
        const placeholders = assetIds.map(() => '?').join(', ');
        const result = await requireOrderDb(env).prepare(`
          SELECT id
          FROM asset_manifests
          WHERE shop_id = ? AND state = 'active' AND id IN (${placeholders})
        `).bind(shop.id, ...assetIds).all();
        const expiresIn = 60;
        const exp = Math.floor(Date.now() / 1000) + expiresIn;
        const tickets = await Promise.all((result.results || []).map(async asset => ({
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

function orderCanEnterCandidateBoard(order = {}) {
    const fulfillmentStatus = String(order.fulfillment_status || order.displayFulfillmentStatus || '')
        .trim().toLowerCase();
    if (fulfillmentStatus === 'fulfilled') return false;
    if (order.cancelled_at || order.cancelledAt || order.closed_at || order.closedAt) return false;
    return true;
}

function webhookConfirmsPayment(topic, payload) {
    if (!orderCanEnterCandidateBoard(payload)) return false;
    if (topic === 'orders/paid') return true;
    if (topic !== 'orders/updated') return false;
    const financialStatus = String(payload?.financial_status || payload?.display_financial_status || '')
        .trim().toLowerCase();
    return financialStatus === 'paid';
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
        if (topic === 'orders/paid' && env.LEGACY_INGEST_ENABLED === '1') {
            // Explicit rollback bridge only. Candidate mode never reads this legacy write.
            await forwardPaidWebhookToLegacyQueue(request, rawBytes, env);
        }
        const shop = await d1Shop(env, { allowUninstalled: topic === 'app/uninstalled' });
        const now = isoNow();
        const gid = canonicalOrderGid(payload.admin_graphql_api_id || payload.order_id || payload.id);
        const receipt = await requireOrderDb(env).prepare(`
          INSERT OR IGNORE INTO webhook_receipts (
            webhook_id, shop_id, topic, order_gid, state, triggered_at, received_at, updated_at
          ) VALUES (?, ?, ?, ?, 'received', ?, ?, ?)
        `).bind(webhookId, shop.id, topic, gid, payload.updated_at || payload.created_at || null, now, now).run();
        if (!receipt.meta?.changes) return jsonResponse({ ok: true, duplicate: true }, allowOrigin, reqAllowHeaders);
        if (topic === 'app/uninstalled') {
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
        if (gid) {
            if (webhookConfirmsPayment(topic, payload)) {
                await ensureCandidateOrder(env, gid, 'shopify-webhook');
            }
            await requireOrderDb(env).prepare(`
              UPDATE order_projection
              SET stale_at = ?, updated_at = ?
              WHERE shop_id = ? AND order_gid = ?
            `).bind(now, now, shop.id, gid).run();
            const refresh = refreshThroughCoordinator(env, [gid])
                .then(() => requireOrderDb(env).prepare(`
                  UPDATE webhook_receipts SET state = 'processed', updated_at = ? WHERE webhook_id = ?
                `).bind(isoNow(), webhookId).run())
                .catch(async error => {
                    console.error('Webhook refresh failed:', error.message);
                    await requireOrderDb(env).prepare(`
                      UPDATE webhook_receipts
                      SET state = 'failed', error_code = ?, updated_at = ?
                      WHERE webhook_id = ?
                    `).bind(String(error.code || 'REFRESH_FAILED'), isoNow(), webhookId).run();
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
        console.error('Shopify webhook error:', error.message);
        return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500);
    }
}

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
            canonicalSource: 'shopify-app-owned-metafield',
            projectionSource: 'cloudflare-d1',
            projected: Number(rows?.projected || 0),
            stale: Number(rows?.stale || 0),
            errors: Number(rows?.errors || 0),
            checkedAt: isoNow()
        };
        return jsonResponse(report, allowOrigin, reqAllowHeaders);
    } catch (error) { return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500); }
}

async function handleV1ParityReport(request, env, allowOrigin, reqAllowHeaders) {
    try {
        return handleV1ParityCheck(request, env, allowOrigin, reqAllowHeaders);
    } catch (error) { return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500); }
}

function legacyOrderNumber(order) {
    const value = String(order?.orderNumber || order?.name || '').trim();
    const match = /#?(\d+)/.exec(value);
    return match ? match[1] : null;
}

const LEGACY_POSITION_CATCHUP_CHECKPOINT = 'redis-position-catchup-2026-07-22T15-51-42-430Z';
const LEGACY_POSITION_CATCHUP_SHA256 = '22f099ad077d6a66f2aabf0ccf08ff18aa97faa764787cdb79368e0b77c3aaea';
const LEGACY_POSITION_CATCHUP_RECORDS = Object.freeze([
    { orderNumber: '1556', stage: 'received', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1548', stage: 'print', blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 23 },
    { orderNumber: '1554', stage: 'print', blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 1 },
    { orderNumber: '1555', stage: 'print', blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 5 },
    { orderNumber: '1557', stage: 'print', blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 24 },
    { orderNumber: '1558', stage: 'received', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1559', stage: 'print', blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 1 },
    { orderNumber: '1560', stage: 'print', blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 1 },
    { orderNumber: '1561', stage: 'print', blanksReady: false, printsOrdered: true, printsReady: true, printedCount: 3 },
    { orderNumber: '1562', stage: 'blanks_ordered', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1563', stage: 'print', blanksReady: true, printsOrdered: true, printsReady: true, printedCount: 2 },
    { orderNumber: '1564', stage: 'blanks_ordered', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1566', stage: 'blanks_ordered', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1567', stage: 'blanks_ordered', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1568', stage: 'blanks_ordered', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1569', stage: 'blanks_ordered', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1570', stage: 'blanks_ordered', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1571', stage: 'blanks_cart', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 },
    { orderNumber: '1572', stage: 'blanks_cart', blanksReady: false, printsOrdered: false, printsReady: false, printedCount: 0 }
]);

function productionMatchesLegacyPosition(state, record) {
    return state.stage === record.stage
        && state.readiness.blanksReady === record.blanksReady
        && state.readiness.printsOrdered === record.printsOrdered
        && state.readiness.printsReady === record.printsReady
        && state.printedCount === record.printedCount;
}

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
        try { previous = JSON.parse(existing.last_result_json || '{}'); } catch (_) {}
        return { ok: true, alreadyCompleted: true, ...previous };
    }

    const startedAt = isoNow();
    const report = {
        sourceBackup: 'shopifyOrdersQueue-backup-2026-07-22T15-51-42-430Z.json',
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
                    sourceType: 'redis-position-catchup',
                    sourceKey,
                    sourceDigest: LEGACY_POSITION_CATCHUP_SHA256,
                    state: 'quarantined',
                    reason: match.matchResult
                });
                continue;
            }

            report.matched++;
            let current = await ensureCandidateOrder(env, match.gid, 'redis-position-catchup');
            if (!productionMatchesLegacyPosition(current.state, record)) {
                const next = normalizeProductionState(current.state, 'redis-position-catchup');
                next.stage = record.stage;
                next.readiness = {
                    blanksOrdered: ['blanks_ordered', 'print', 'completed'].includes(record.stage),
                    blanksReady: record.blanksReady,
                    printsOrdered: record.printsOrdered,
                    printsReady: record.printsReady
                };
                next.printedCount = record.printedCount;
                next.revision = current.state.revision + 1;
                next.lastMutationId = `redis-position-catchup:${record.orderNumber}:${LEGACY_POSITION_CATCHUP_SHA256.slice(0, 16)}`;
                next.updatedAt = isoNow();
                next.updatedBy = 'redis-position-catchup';
                const saved = await setProductionMetafield(env, match.gid, next, current.compareDigest, coordinatorGraphQL);
                current = { ...current, ...saved };
                report.changed++;
            } else {
                report.unchanged++;
            }

            refreshedGids.push(match.gid);
            await d1ProjectionUpsert(env, shop.id, match.gid, current.state, current.compareDigest, undefined, current.order);
            await writeMigrationLedger(env, shop.id, {
                sourceType: 'redis-position-catchup',
                sourceKey,
                sourceDigest: LEGACY_POSITION_CATCHUP_SHA256,
                gid: match.gid,
                destinationKey: `${PRODUCTION_METAFIELD_NAMESPACE}.${PRODUCTION_METAFIELD_KEY}`,
                state: 'verified',
                result: {
                    matchResult: match.matchResult,
                    stage: current.state.stage,
                    revision: current.state.revision
                }
            });
        } catch (error) {
            report.errors.push({
                orderNumber: record.orderNumber,
                code: error.code || 'POSITION_CATCHUP_ERROR',
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
            code: 'LEGACY_POSITION_CATCHUP_INCOMPLETE',
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

async function migrateLegacyAssets(env, shopId, gid, legacy, execute) {
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
                const stored = await env.R2_BUCKET.get(objectKey);
                if (!stored) throw new Error(`R2 verification could not read ${name}`);
                const storedBytes = new Uint8Array(await stored.arrayBuffer());
                const storedDigest = bytesToHex(await crypto.subtle.digest('SHA-256', storedBytes));
                if (storedDigest !== sha256) throw new Error(`R2 checksum verification failed for ${name}`);
            }
            manifests.push({
                assetId,
                objectKey,
                name,
                contentType: asset.contentType || (asset.ext ? `image/${asset.ext === 'jpg' ? 'jpeg' : asset.ext}` : null),
                byteSize,
                sha256,
                sourceKey: asset.key,
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
            const stored = await env.R2_BUCKET.get(objectKey);
            if (!stored) throw new Error(`R2 verification could not read ${name}`);
            const storedBytes = new Uint8Array(await stored.arrayBuffer());
            const storedDigest = bytesToHex(await crypto.subtle.digest('SHA-256', storedBytes));
            if (storedDigest !== sha256) throw new Error(`R2 checksum verification failed for ${name}`);
        }
        manifests.push({ assetId, objectKey, name, contentType: attachment.type || attachment.contentType || null, byteSize: bytes.byteLength, sha256, sourceKey: attachment.name || attachment.filename || name, migrationState: execute ? 'verified' : 'planned' });
    }
    if (execute && manifests.length) {
        const now = isoNow();
        const db = requireOrderDb(env);
        await db.batch(manifests.map(asset => db.prepare(`
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
            asset.assetId, shopId, gid, asset.objectKey, asset.name,
            asset.contentType || 'application/octet-stream', asset.byteSize,
            asset.sha256, asset.sourceKey || asset.objectKey, now, now
        )));
        for (const asset of manifests) {
            await insertAssetManifestLink(db, asset.assetId, {
                sourceKey: asset.sourceKey || asset.objectKey
            }, now);
        }
    }
    return manifests;
}

function legacyProductionState(legacy, current, actor) {
    const state = normalizeProductionState(current, actor);
    const legacyStatus = String(legacy?.status || 'received');
    state.stage = legacyStatus === 'toOrder'
        ? 'to_order'
        : legacyStatus === 'blanks'
            ? (Number(legacy?.blanksOrdered || 0) ? 'blanks_ordered' : 'blanks_cart')
            : legacyStatus === 'print'
                ? 'print'
                : 'received';
    state.readiness = {
        blanksOrdered: Boolean(Number(legacy?.blanksOrdered || 0)),
        blanksReady: Boolean(Number(legacy?.blanksStatus || 0)),
        printsOrdered: Boolean(Number(legacy?.printsOrdered || 0)),
        printsReady: Boolean(Number(legacy?.printsStatus || 0))
    };
    state.printedCount = Math.max(0, Number(legacy?.progress || 0));
    state.bundleId = legacy?.bundle ? String(legacy.bundle).slice(0, 160) : null;
    state.internalNotes = String(legacy?.notes || '').slice(0, 5000);
    state.updatedAt = isoNow();
    state.updatedBy = actor;
    return state;
}

async function writeMigrationLedger(env, shopId, values) {
    const now = isoNow();
    const id = await stableAssetId(`${values.sourceType}:${values.sourceKey}:${values.sourceDigest}`);
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
        id, shopId, values.sourceType, values.sourceKey, values.sourceDigest,
        values.gid || null, values.destinationKey || null, values.state,
        values.reason || null, JSON.stringify(values.result || {}), now, now
    ).run();
}

async function handleV1MigrationRun(request, env, allowOrigin, reqAllowHeaders) {
    try {
        if (env.MIGRATION_UPSTREAM_ENABLED !== '1') {
            return v1Error({
                code: 'MIGRATION_BRIDGE_DISABLED',
                message: 'The one-time Redis migration bridge is disabled.'
            }, allowOrigin, reqAllowHeaders, 503);
        }
        const body = await request.json().catch(() => ({}));
        const execute = body.execute === true;
        const includeAssets = body.includeAssets === true;
        if (execute && body.confirmShop !== shopDomain(env)) {
            return v1Error({ code: 'MIGRATION_CONFIRMATION_REQUIRED', message: 'Execution requires confirmShop to exactly match the configured Shopify domain.' }, allowOrigin, reqAllowHeaders, 400);
        }
        const limit = Math.min(Math.max(Number(body.limit || 1), 1), 5);
        const offset = Math.max(Number(body.offset || 0), 0);
        const page = await upstreamDataRequest(env, `/order-manager/v1/data/legacy?offset=${offset}&limit=${limit}`);
        const shop = await d1Shop(env);
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
        const ownerQuarantine = new Set(
            String(env.MIGRATION_QUARANTINE_ORDER_NUMBERS || '1000')
                .split(',')
                .map(value => value.trim().replace(/^#/, ''))
                .filter(Boolean)
        );
        for (const legacy of page.records || []) {
            const source = JSON.stringify(legacy);
            const sourceDigest = bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
            const identifier = legacy.orderNumber || String(legacy.name || '').split(/[–-]/)[0].trim();
            try {
                const orderNumber = legacyOrderNumber(legacy);
                if (orderNumber && ownerQuarantine.has(orderNumber)) {
                    report.quarantined++;
                    if (execute) await writeMigrationLedger(env, shop.id, {
                        sourceType: 'redis-order',
                        sourceKey: identifier || `#${orderNumber}`,
                        sourceDigest,
                        state: 'quarantined',
                        reason: 'owner_approved_quarantine'
                    });
                    continue;
                }
                const match = await matchLegacyOrder(env, legacy);
                if (!match.gid) {
                    report.quarantined++;
                    if (execute) await writeMigrationLedger(env, shop.id, {
                        sourceType: 'redis-order',
                        sourceKey: identifier || `offset:${offset}`,
                        sourceDigest,
                        state: 'quarantined',
                        reason: match.matchResult
                    });
                    continue;
                }
                report.matched++;
                if (!execute) continue;
                const current = await ensureCandidateOrder(env, match.gid, 'redis-migration');
                if (current.state.revision > 0 && body.overwriteChangedOrders !== true) {
                    await writeMigrationLedger(env, shop.id, {
                        sourceType: 'redis-order',
                        sourceKey: identifier || match.gid,
                        sourceDigest,
                        gid: match.gid,
                        state: 'quarantined',
                        reason: 'candidate_state_already_changed'
                    });
                    report.quarantined++;
                    continue;
                }
                const migratedState = legacyProductionState(legacy, current.state, 'redis-migration');
                migratedState.revision = current.state.revision + 1;
                migratedState.lastMutationId = `migration:${sourceDigest}`;
                const saved = await setProductionMetafield(env, match.gid, migratedState, current.compareDigest);
                const summaries = await refreshThroughCoordinator(env, [match.gid]);
                const assets = includeAssets ? await migrateLegacyAssets(env, shop.id, match.gid, legacy, true) : [];
                await d1ProjectionUpsert(env, shop.id, match.gid, saved.state, saved.compareDigest, summaries[0]);
                for (const asset of assets) {
                    await writeMigrationLedger(env, shop.id, {
                        sourceType: 'redis-asset',
                        sourceKey: asset.sourceKey || asset.name,
                        sourceDigest: asset.sha256,
                        gid: match.gid,
                        destinationKey: asset.objectKey,
                        state: 'verified',
                        result: {
                            byteSize: asset.byteSize,
                            contentType: asset.contentType,
                            assetId: asset.assetId
                        }
                    });
                }
                await writeMigrationLedger(env, shop.id, {
                    sourceType: 'redis-order',
                    sourceKey: identifier || match.gid,
                    sourceDigest,
                    gid: match.gid,
                    destinationKey: `${PRODUCTION_METAFIELD_NAMESPACE}.${PRODUCTION_METAFIELD_KEY}`,
                    state: 'verified',
                    result: {
                        matchResult: match.matchResult,
                        revision: saved.state.revision,
                        assetCount: assets.length,
                        assetChecksums: assets.map(asset => asset.sha256).filter(Boolean)
                    }
                });
                report.migrated++;
            } catch (error) {
                report.errors.push({ orderIdentifier: identifier || 'unknown', code: 'MIGRATION_ERROR', message: error.message });
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
    } catch (error) { return v1Error(error, allowOrigin, reqAllowHeaders, error.status || 500); }
}

export class OrderSyncCoordinator {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.throttle = { currentlyAvailable: 1000, maximumAvailable: 1000, restoreRate: 50, updatedAt: Date.now() };
        this.estimates = new Map();
        this.inflightRefreshes = new Map();
        this.inflightBootstrap = null;
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
        const checkpoint = checkpointResult?.checkpoint ? Date.parse(checkpointResult.checkpoint) : Date.now() - 300000;
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
                if (order.displayFinancialStatus === 'PAID' && orderCanEnterCandidateBoard(order)) {
                    await ensureCandidateOrder(
                        this.env,
                        order.id,
                        'reconciliation',
                        (_env, query, variables, operationName) => this.graphql(query, variables, operationName)
                    );
                }
            }
            after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
        } while (after);
        if (gids.length) await this.refresh(gids);
        const completedAt = isoNow();
        const staleReceiptCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
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
        `).bind(shop.id, new Date(Date.now() - 300000).toISOString()).first();
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
        const directGraphQL = (_env, query, variables, operationName) =>
            this.graphql(query, variables, operationName);
        for (const row of confirmedOrders.results || []) {
            try {
                const repair = await confirmedBatchProductionUpdate(
                    this.env, shop, row, row.batch_id, row.po_number,
                    'integrity-reconciliation', directGraphQL
                );
                if (repair.repaired) repairedBatchOrders.push(row.order_gid);
            } catch (error) {
                batchRepairErrors.push({ gid: row.order_gid, message: error.message });
            }
        }
        const result = {
            ok: Number(counts?.errors || 0) === 0
                && Number(pending?.count || 0) === 0
                && batchRepairErrors.length === 0,
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
            if (url.pathname === '/graphql' && request.method === 'POST') {
                const body = await request.json();
                return Response.json(await this.graphql(body.query, body.variables, body.operationName));
            }
            if (url.pathname === '/refresh' && request.method === 'POST') {
                const body = await request.json();
                return Response.json({ summaries: await this.refresh(body.gids || []) });
            }
            if (url.pathname === '/bootstrap') return Response.json(await this.bootstrap());
            if (url.pathname === '/reconcile-incremental') return Response.json(await this.reconcileIncremental());
            if (url.pathname === '/reconcile-integrity') return Response.json(await this.reconcileIntegrity());
            return new Response('Not Found', { status: 404 });
        } catch (error) {
            return Response.json({ error: error.message }, { status: error.status || 500 });
        }
    }
}
export {
    copyDesignerAsset,
    designerAssetCandidates,
    normalizeEtsyOrderContract,
    orderCanEnterCandidateBoard,
    parseEtsyWebhookResource,
    pickAllowOrigin,
    redactedJsonFieldShape,
    reconcileEtsyPaidReceipts,
    selectOperationalCustomerName,
    etsyShadowEligibility,
    verifyEtsyWebhookSignature,
    webhookConfirmsPayment
};
