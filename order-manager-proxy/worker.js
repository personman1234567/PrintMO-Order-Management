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

    // Optional safety gate: limit to the two folders you expect
    if (!key.startsWith("previews/") && !key.startsWith("prompts/")) {
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

    // Optional safety gate: limit to the two folders you expect
    if (!key.startsWith("previews/") && !key.startsWith("prompts/")) {
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
