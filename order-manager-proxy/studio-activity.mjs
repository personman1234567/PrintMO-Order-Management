const UPSTREAM = 'https://designer-preview-upload.printmobusiness.workers.dev';
const ROOT = '/order-manager/storage/uploads';
const REFERENCE = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function json(body, status) {
    return new Response(JSON.stringify(body), { status, headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
    } });
}

/** Called only below the Worker's staff authentication boundary. */
export async function handleStudioUploads(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const id = url.pathname === ROOT ? '' : url.pathname.slice(ROOT.length + 1);
    if (url.pathname !== ROOT && (!url.pathname.startsWith(ROOT + '/') || id.length > 4096 || !REFERENCE.test(id)))
        return json({ error: 'Choose an available Studio upload.' }, 400);
    if (!env.PREPARED_ORDER_ADMIN_TOKEN) return json({ error: 'Studio uploads are not configured yet.' }, 503);
    const upstream = new URL('/api/admin/studio-uploads' + (id ? '/' + id : ''), UPSTREAM);
    if (!id) for (const name of ['after', 'before', 'cursor', 'limit']) {
        const value = url.searchParams.get(name);
        if (value !== null) upstream.searchParams.set(name, value);
    }
    try {
        const transport = env.PREPARED_ORDER_SERVICE ? env.PREPARED_ORDER_SERVICE.fetch.bind(env.PREPARED_ORDER_SERVICE) : fetch;
        // Workers supports manual/follow; manual also keeps the staff header
        // from being forwarded if the upstream ever returns a redirect.
        const response = await transport(upstream.toString(), { method: 'GET', redirect: 'manual', headers: {
            Origin: 'https://print-mo.com', 'X-PM-Admin-Token': env.PREPARED_ORDER_ADMIN_TOKEN,
            Accept: id ? 'image/*' : 'application/json'
        } });
        if (!response.ok) {
            const status = [400, 404, 410, 429].includes(response.status) ? response.status : 503;
            return json({ error: status === 404 || status === 410 ? 'This upload is no longer available.' : 'Studio uploads could not be loaded. Try again.' }, status);
        }
        const headers = new Headers({
            'Content-Type': response.headers.get('Content-Type') || (id ? 'application/octet-stream' : 'application/json'),
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'
        });
        if (id) {
            headers.set('Content-Disposition', 'inline');
            if (headers.get('Content-Type').split(';')[0].trim() === 'image/svg+xml')
                headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
            return new Response(response.body, { headers });
        }
        const result = await response.json();
        if (!Array.isArray(result.items) || result.items.length > 100 || typeof result.hasMore !== 'boolean' || result.coverage !== 'saved-and-recent-guest'
            || result.hasMore !== Boolean(result.cursor) || (result.cursor !== null && (typeof result.cursor !== 'string' || !REFERENCE.test(result.cursor))))
            throw new Error('Invalid uploads response');
        // An explicit DTO prevents future producer fields from leaking storage
        // keys, owner keys or credentials into browser responses.
        const items = result.items.map(item => {
            if (!item || typeof item.id !== 'string' || item.id.length > 4096 || !REFERENCE.test(item.id)) throw new Error('Invalid upload reference');
            const metadata = item.metadata || {};
            return {
                id: item.id, filename: String(item.filename || 'Upload'), uploadedAt: String(item.uploadedAt || ''),
                size: Number(item.size || 0), contentType: String(item.contentType || 'application/octet-stream'),
                metadata: {
                    audience: String(metadata.audience || ''), source: String(metadata.source || ''),
                    customername: String(metadata.customername || ''), customeremail: String(metadata.customeremail || ''),
                    identitykey: String(metadata.identitykey || '')
                }
            };
        });
        return new Response(JSON.stringify({ items, cursor: result.cursor, hasMore: result.hasMore, coverage: result.coverage }), { headers });
    } catch {
        return json({ error: 'Studio uploads could not be loaded. Try again.' }, 503);
    }
}
